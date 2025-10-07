"""FastAPI application exposing EchoSmith transcription services."""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from .asr_engine import ASREngine, MODEL_ROOT, Segment
from .task_store import TaskRecord, TaskStatus, task_store


class TaskControl:
    __slots__ = ("pause_event", "cancelled")

    def __init__(self) -> None:
        self.pause_event = asyncio.Event()
        self.pause_event.set()
        self.cancelled = False


TASK_CONTROLS: dict[str, TaskControl] = {}

app = FastAPI(title="EchoSmith Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_ROOT = Path(tempfile.gettempdir()) / "echosmith_uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

engine = ASREngine()
API_TOKEN = os.environ.get("ECHOSMITH_TOKEN")


@app.get("/api/health")
async def healthcheck() -> JSONResponse:
    ffmpeg_ok = _command_exists("ffmpeg")
    models_ok = _models_available()
    return JSONResponse(
        {
            "ffmpeg": ffmpeg_ok,
            "models": models_ok,
            "status": "ok" if ffmpeg_ok and models_ok else "degraded",
        }
    )


def verify_token(request: Request) -> None:
    if not API_TOKEN:
        return
    header = request.headers.get("Authorization", "")
    if header != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="未授权")


@app.get("/api/tasks")
async def list_tasks(_: None = Depends(verify_token)) -> JSONResponse:
    records = await task_store.list_tasks()
    return JSONResponse([task.snapshot() for task in records])


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str, _: None = Depends(verify_token)) -> JSONResponse:
    try:
        record = await task_store.get_task(task_id)
    except KeyError as exc:  # noqa: B904
        raise HTTPException(status_code=404, detail="任务不存在") from exc
    return JSONResponse(record.snapshot())


@app.post("/api/tasks", status_code=201)
async def create_task(
    file: UploadFile = File(...),
    language: str = Form(default="zh"),
    _: None = Depends(verify_token),
) -> JSONResponse:
    task_id = uuid.uuid4().hex
    source_info = {"language": language}
    cleanup_paths = []

    try:
        saved_path = await _save_upload(file, task_id)
        cleanup_paths.append(saved_path)
        source_info.update({"type": "upload", "name": file.filename, "path": str(saved_path)})

        record = TaskRecord(id=task_id, status=TaskStatus.QUEUED, source=source_info)
        await task_store.create_task(record)

        TASK_CONTROLS[task_id] = TaskControl()

        asyncio.create_task(_run_task(task_id, source_info, cleanup_paths))
        return JSONResponse({"id": task_id})
    except Exception as exc:  # noqa: BLE001
        for path in cleanup_paths:
            Path(path).unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str, _: None = Depends(verify_token)) -> JSONResponse:
    try:
        record = await task_store.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc

    # Cancel the task if it's still running
    control = TASK_CONTROLS.get(task_id)
    if control:
        control.cancelled = True
        control.pause_event.set()
        TASK_CONTROLS.pop(task_id, None)

    # Delete the uploaded file if it exists
    source_path = record.source.get("path")
    if source_path and Path(source_path).exists():
        try:
            Path(source_path).unlink()
        except Exception:
            pass  # Ignore file deletion errors

    # Delete the task from store
    await task_store.delete_task(task_id)
    return JSONResponse({"status": "deleted", "id": task_id})


@app.post("/api/tasks/{task_id}/pause")
async def pause_task(task_id: str, _: None = Depends(verify_token)) -> JSONResponse:
    control = TASK_CONTROLS.get(task_id)
    if not control:
        raise HTTPException(status_code=404, detail="任务不存在")
    control.pause_event.clear()
    await task_store.update_task(
        task_id,
        status=TaskStatus.PAUSED,
        message="已暂停",
        log={"timestamp": time.time(), "type": "info", "message": "任务已暂停"},
    )
    return JSONResponse({"id": task_id, "status": "paused"})


@app.post("/api/tasks/{task_id}/resume")
async def resume_task(task_id: str, _: None = Depends(verify_token)) -> JSONResponse:
    control = TASK_CONTROLS.get(task_id)
    if not control:
        raise HTTPException(status_code=404, detail="任务不存在")
    control.pause_event.set()
    await task_store.update_task(
        task_id,
        status=TaskStatus.RUNNING,
        message="恢复处理",
        log={"timestamp": time.time(), "type": "info", "message": "任务恢复"},
    )
    return JSONResponse({"id": task_id, "status": "resumed"})


@app.websocket("/ws/tasks/{task_id}")
async def task_updates(task_id: str, websocket: WebSocket) -> None:
    token_ok = False
    if API_TOKEN:
        auth = websocket.headers.get("authorization")
        if auth == f"Bearer {API_TOKEN}":
            token_ok = True
        else:
            query_token = websocket.query_params.get("token")
            if query_token == API_TOKEN:
                token_ok = True
    else:
        token_ok = True

    if not token_ok:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        async for event in task_store.subscribe(task_id):
            await websocket.send_json(event)
    except WebSocketDisconnect:
        return


async def _run_task(task_id: str, source_info: dict, cleanup_paths: list[str]) -> None:
    loop = asyncio.get_running_loop()
    control = TASK_CONTROLS.get(task_id)

    def progress_cb(progress: float, stage: str, partial: str) -> None:
        if control and not control.pause_event.is_set():
            status = TaskStatus.PAUSED
        else:
            status = TaskStatus.RUNNING
        loop.call_soon_threadsafe(
            asyncio.create_task,
            task_store.update_task(
                task_id,
                status=status,
                progress=progress,
                message=stage,
                result_text=partial,
                log={
                    "timestamp": time.time(),
                    "type": "progress",
                    "message": stage,
                    "progress": progress,
                },
            ),
        )

    try:
        await task_store.update_task(task_id, status=TaskStatus.RUNNING, message="准备中", progress=0.01)
        audio_path = Path(source_info["path"])
        await task_store.update_task(task_id, message="转写中", progress=0.05)

        result = await engine.transcribe(
            audio_path,
            progress_cb=progress_cb,
            pause_event=control.pause_event if control else None,
            cancelled_checker=(lambda: control.cancelled) if control else None,
        )

        if control and control.cancelled:
            await task_store.update_task(
                task_id,
                status=TaskStatus.CANCELLED,
                message="已取消",
                log={"timestamp": time.time(), "type": "info", "message": "任务中途取消"},
            )
        else:
            await task_store.update_task(
                task_id,
                status=TaskStatus.COMPLETED,
                progress=1.0,
                message="完成",
                result_text=result.text,
                segments=[segment.__dict__ for segment in result.segments],
                log={"timestamp": time.time(), "type": "info", "message": "任务完成"},
            )
    except Exception as exc:  # noqa: BLE001
        await task_store.update_task(
            task_id,
            status=TaskStatus.FAILED,
            message="失败",
            error=str(exc),
            log={"timestamp": time.time(), "type": "error", "message": str(exc)},
        )
    finally:
        for path in cleanup_paths:
            Path(path).unlink(missing_ok=True)
        TASK_CONTROLS.pop(task_id, None)


async def _save_upload(upload: UploadFile, task_id: str) -> str:
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    suffix = Path(upload.filename or "audio").suffix or ".wav"
    target = UPLOAD_ROOT / f"{task_id}{suffix}"
    with target.open("wb") as outfile:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            outfile.write(chunk)
    return str(target)


def _command_exists(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _models_available() -> bool:
    return all(
        (MODEL_ROOT / name).exists()
        for name in [
            "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            "speech_fsmn_vad_zh-cn-16k-common-pytorch",
            "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        ]
    )


def _segments_to_srt(segments: list[dict]) -> str:
    lines = []
    for index, seg in enumerate(segments, start=1):
        start = _ms_to_timestamp(seg.get("start_ms", 0))
        end = _ms_to_timestamp(seg.get("end_ms", 0))
        text = seg.get("text", "")
        lines.append(f"{index}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def _ms_to_timestamp(ms: int) -> str:
    seconds, millis = divmod(int(ms), 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"
@app.get("/api/tasks/{task_id}/export")
async def export_task(task_id: str, format: str = "txt", _: None = Depends(verify_token)):
    try:
        record = await task_store.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc

    format = format.lower()
    if format == "txt":
        return PlainTextResponse(record.result_text or "", media_type="text/plain")
    if format == "json":
        return JSONResponse(
            {
                "id": record.id,
                "text": record.result_text,
                "segments": record.segments,
            }
        )
    if format == "srt":
        segments = record.segments
        if not segments and record.result_text:
            text = record.result_text.strip()
            if text:
                segments = [
                    {
                        "index": 0,
                        "start_ms": 0,
                        "end_ms": max(2000, len(text.split()) * 500),
                        "text": text,
                    }
                ]
        srt_body = _segments_to_srt(segments)
        return PlainTextResponse(srt_body, media_type="application/x-subrip")

    raise HTTPException(status_code=400, detail="不支持的导出格式")
