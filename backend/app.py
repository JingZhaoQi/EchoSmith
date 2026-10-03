"""FastAPI application exposing EchoSmith transcription services."""

from __future__ import annotations

import asyncio
import os
import platform
import shutil
import tempfile
import threading
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict
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
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

try:
    from asr_engine import ASREngine
    from correction_engine import CorrectionEngine
    from exporters import EXPORT_FORMATS, render_export
    from hotwords import HotwordManager
    from settings import SettingsManager
    from task_progress import TaskProgress
    from task_store import TaskRecord, TaskStatus, task_store
    from url_downloader import (
        download_audio,
        download_media,
        extract_url_from_text,
        extract_video_title,
    )
except ImportError:
    from .asr_engine import ASREngine
    from .correction_engine import CorrectionEngine
    from .exporters import EXPORT_FORMATS, render_export
    from .hotwords import HotwordManager
    from .settings import SettingsManager
    from .task_progress import TaskProgress
    from .task_store import TaskRecord, TaskStatus, task_store
    from .url_downloader import (
        download_audio,
        download_media,
        extract_url_from_text,
        extract_video_title,
    )


class TaskControl:
    __slots__ = ("pause_event", "cancelled")

    def __init__(self) -> None:
        self.pause_event = asyncio.Event()
        self.pause_event.set()
        self.cancelled = False


TASK_CONTROLS: dict[str, TaskControl] = {}


async def _preload_model() -> None:
    """Load the ASR model at startup so the first task starts recognizing immediately."""
    try:
        await engine.ensure_model()
    except (
        Exception
    ) as exc:  # noqa: BLE001 - a missing model is reported when a task runs
        print(f"[INIT] 模型预加载失败: {exc}", flush=True)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    preload = asyncio.create_task(_preload_model())
    yield
    preload.cancel()


app = FastAPI(title="EchoSmith Backend", version="0.1.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_ROOT = Path(tempfile.gettempdir()) / "echosmith_uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def _get_hotwords_path() -> Path:
    if platform.system() == "Darwin":
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "com.echosmith.app"
            / "hotwords.json"
        )
    elif platform.system() == "Windows":
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            return Path(appdata) / "echosmith" / "hotwords.json"
    return Path.home() / ".config" / "echosmith" / "hotwords.json"


hotword_manager = HotwordManager(_get_hotwords_path())
settings_manager = SettingsManager(_get_hotwords_path().parent / "settings.json")


def _build_correction_engine() -> CorrectionEngine | None:
    settings = settings_manager.get()
    cfg = settings.correction
    if cfg.mode == "none":
        return None
    return CorrectionEngine(
        mode=cfg.mode,
        hot_words=hotword_manager.list_all(),
        api_provider=cfg.api_provider,
        api_key=cfg.api_key,
        api_model=cfg.api_model,
        api_base_url=cfg.api_base_url,
        on_api_call=lambda segs, failed: settings_manager.record_api_call(segs, failed),
    )


_correction_engine = _build_correction_engine()
_settings = settings_manager.get()
engine = ASREngine(
    correction_engine=_correction_engine,
    asr_model=_settings.transcription.asr_model,
)
API_TOKEN = os.environ.get("ECHOSMITH_TOKEN")
UPLOAD_FILE_REQUIRED = File(...)
LANGUAGE_FORM_FIELD = Form(default="auto")


@app.get("/api/health")
async def healthcheck() -> JSONResponse:
    import sys

    ffmpeg_ok = _command_exists("ffmpeg")
    ffmpeg_path = shutil.which("ffmpeg")
    model_downloading = engine.is_downloading()
    download_progress, download_message = engine.get_download_progress()
    model_cache_dir = engine.get_model_cache_dir()
    models_ready = engine.has_model() or Path(model_cache_dir).exists()

    # Debug info for bundled ffmpeg
    debug_info = {}
    if getattr(sys, "frozen", False):
        bundle_dir = Path(sys._MEIPASS)  # type: ignore
        bundled_ffmpeg_dir = bundle_dir / "ffmpeg_bin"
        debug_info["bundle_dir"] = str(bundle_dir)
        debug_info["ffmpeg_bin_exists"] = bundled_ffmpeg_dir.exists()
        if bundled_ffmpeg_dir.exists():
            debug_info["ffmpeg_bin_contents"] = [
                f.name for f in bundled_ffmpeg_dir.iterdir()
            ]

    try:
        import yt_dlp as _yt_dlp  # noqa: F401

        ytdlp_ok = True
    except ImportError:
        ytdlp_ok = False

    return JSONResponse(
        {
            "ffmpeg": ffmpeg_ok,
            "ffmpeg_path": ffmpeg_path,
            "models": models_ready,
            "model_downloading": model_downloading,
            "download_progress": download_progress,
            "download_message": download_message,
            "model_cache_dir": model_cache_dir,
            "ytdlp": ytdlp_ok,
            "correction_mode": settings_manager.get().correction.mode,
            "asr_model": settings_manager.get().transcription.asr_model,
            "status": "ok" if ffmpeg_ok else "degraded",
            "debug": debug_info,
        }
    )


def verify_token(request: Request) -> None:
    if not API_TOKEN:
        return
    header = request.headers.get("Authorization", "")
    if header != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="未授权")


@app.post("/api/models/download")
async def trigger_model_download(_: None = Depends(verify_token)) -> JSONResponse:
    if engine.has_model():
        return JSONResponse({"status": "already_exists"})
    if engine.is_downloading():
        return JSONResponse({"status": "already_downloading"})

    asyncio.create_task(engine.ensure_model())
    return JSONResponse({"status": "started"})


@app.get("/api/hotwords")
async def list_hotwords(_: None = Depends(verify_token)) -> JSONResponse:
    return JSONResponse({"words": hotword_manager.list_all()})


@app.post("/api/hotwords")
async def add_hotword(
    request: Request, _: None = Depends(verify_token)
) -> JSONResponse:
    body = await request.json()
    word = body.get("word")
    if not isinstance(word, str) or not word.strip():
        raise HTTPException(status_code=400, detail="热词不能为空")
    word = word.strip()
    hotword_manager.add(word)
    return JSONResponse({"words": hotword_manager.list_all()})


@app.post("/api/hotwords/import")
async def import_hotwords(
    request: Request, _: None = Depends(verify_token)
) -> JSONResponse:
    """Bulk import hotwords, replacing existing list."""
    body = await request.json()
    new_words = body.get("words", [])
    if not isinstance(new_words, list):
        raise HTTPException(status_code=400, detail="words must be a list")
    # Clear and re-add
    for word in hotword_manager.list_all():
        hotword_manager.remove(word)
    for word in new_words:
        w = str(word).strip()
        if w:
            hotword_manager.add(w)
    return JSONResponse(
        {"words": hotword_manager.list_all(), "count": len(hotword_manager.list_all())}
    )


@app.delete("/api/hotwords/{word:path}")  # words may contain "/" (e.g. AC/DC)
async def remove_hotword(word: str, _: None = Depends(verify_token)) -> JSONResponse:
    hotword_manager.remove(word)
    return JSONResponse({"words": hotword_manager.list_all()})


@app.get("/api/settings")
async def get_settings(_: None = Depends(verify_token)) -> JSONResponse:
    return JSONResponse(settings_manager.snapshot())


@app.post("/api/settings")
async def update_settings(
    request: Request, _: None = Depends(verify_token)
) -> JSONResponse:
    global _correction_engine
    body = await request.json()
    transcription = body.get("transcription", {})
    if transcription:
        settings_manager.update_transcription(**transcription)

    correction = body.get("correction", {})
    if correction:
        # If api_key is masked placeholder, keep the existing key
        if "****" in str(correction.get("api_key") or ""):
            del correction["api_key"]
        settings_manager.update_correction(**correction)

    # Rebuild correction engine with new settings
    _correction_engine = _build_correction_engine()
    engine._correction_engine = _correction_engine
    latest = settings_manager.get().transcription
    engine.set_transcription_options(latest.asr_model)

    return JSONResponse(settings_manager.snapshot())


@app.post("/api/settings/reset-usage")
async def reset_usage(_: None = Depends(verify_token)) -> JSONResponse:
    settings_manager.reset_usage()
    return JSONResponse(settings_manager.snapshot())


@app.get("/api/tasks")
async def list_tasks(
    summary: bool = False, _: None = Depends(verify_token)
) -> JSONResponse:
    """All tasks; summary=true omits texts so the list can be polled cheaply."""
    records = await task_store.list_tasks()
    return JSONResponse(
        [task.summary() if summary else task.snapshot() for task in records]
    )


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str, _: None = Depends(verify_token)) -> JSONResponse:
    try:
        record = await task_store.get_task(task_id)
    except KeyError as exc:  # noqa: B904
        raise HTTPException(status_code=404, detail="任务不存在") from exc
    return JSONResponse(record.snapshot())


@app.post("/api/tasks", status_code=201)
async def create_task(
    file: UploadFile = UPLOAD_FILE_REQUIRED,
    language: str = LANGUAGE_FORM_FIELD,
    _: None = Depends(verify_token),
) -> JSONResponse:
    task_id = uuid.uuid4().hex
    source_info = {"language": language}
    cleanup_paths = []

    try:
        saved_path = await _save_upload(file, task_id)
        cleanup_paths.append(saved_path)
        source_info.update(
            {"type": "upload", "name": file.filename, "path": str(saved_path)}
        )

        record = TaskRecord(id=task_id, status=TaskStatus.QUEUED, source=source_info)
        await task_store.create_task(record)

        TASK_CONTROLS[task_id] = TaskControl()

        asyncio.create_task(_run_task(task_id, source_info, cleanup_paths))
        return JSONResponse({"id": task_id})
    except Exception as exc:  # noqa: BLE001
        for path in cleanup_paths:
            Path(path).unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/tasks/local", status_code=201)
async def create_task_from_local(
    request: Request,
    _: None = Depends(verify_token),
) -> JSONResponse:
    """Accept a local file path and transcribe directly from disk."""
    body = await request.json()
    path = body.get("path", "").strip()
    language = body.get("language", "auto")

    if not path:
        raise HTTPException(status_code=400, detail="路径不能为空")

    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=400, detail=f"文件不存在: {path}")

    task_id = uuid.uuid4().hex
    source_info = {
        "type": "local",
        "name": file_path.name,
        "path": str(file_path),
        "language": language,
    }

    record = TaskRecord(id=task_id, status=TaskStatus.QUEUED, source=source_info)
    await task_store.create_task(record)

    TASK_CONTROLS[task_id] = TaskControl()
    # Empty cleanup_paths — we don't own the user's original file
    asyncio.create_task(_run_task(task_id, source_info, []))
    return JSONResponse({"id": task_id})


@app.post("/api/tasks/url", status_code=201)
async def create_task_from_url(
    request: Request,
    _: None = Depends(verify_token),
) -> JSONResponse:
    body = await request.json()
    raw_url = body.get("url", "").strip()
    language = body.get("language", "auto")

    if not raw_url:
        raise HTTPException(status_code=400, detail="URL 不能为空")

    # Extract actual URL from share text (e.g. Douyin paste includes extra text)
    url = extract_url_from_text(raw_url)

    task_id = uuid.uuid4().hex
    cleanup_paths: list[str] = []

    try:
        # Fetch title without downloading (fast)
        try:
            title = await asyncio.to_thread(
                extract_video_title, url
            )  # network call: keep the event loop free
        except Exception:
            title = url

        source_info = {
            "type": "url",
            "url": url,
            "name": title or url,
            "language": language,
        }

        record = TaskRecord(id=task_id, status=TaskStatus.QUEUED, source=source_info)
        await task_store.create_task(record)

        TASK_CONTROLS[task_id] = TaskControl()
        asyncio.create_task(_run_task(task_id, source_info, cleanup_paths))
        return JSONResponse({"id": task_id})
    except HTTPException:
        raise
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

    # Delete the uploaded file if it exists (but not user's original local files)
    source_path = record.source.get("path")
    if (
        source_path
        and record.source.get("type") != "local"
        and Path(source_path).exists()
    ):
        try:
            Path(source_path).unlink()
        except Exception:
            pass  # Ignore file deletion errors

    # Delete the task from store
    await task_store.delete_task(task_id)
    return JSONResponse({"status": "deleted", "id": task_id})


@app.post("/api/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, _: None = Depends(verify_token)) -> JSONResponse:
    """Stop a task but keep it (and its partial transcript) in the library."""
    control = TASK_CONTROLS.get(task_id)
    if not control:
        raise HTTPException(status_code=404, detail="任务不存在或已结束")
    control.cancelled = True
    control.pause_event.set()
    return JSONResponse({"id": task_id, "status": "cancelling"})


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
    is_url = source_info.get("type") == "url"
    correction_enabled = engine.correction_active()
    progress = TaskProgress(has_download=is_url, correction_enabled=correction_enabled)
    finished = (
        threading.Event()
    )  # set before the final state is written; late callbacks are dropped

    def cancelled() -> bool:
        return bool(control and control.cancelled)

    def push(**changes) -> None:
        """Thread-safe live update; keeps PAUSED while paused and never touches a finished task."""
        if finished.is_set():
            return
        paused = control is not None and not control.pause_event.is_set()
        status = TaskStatus.PAUSED if paused else TaskStatus.RUNNING
        asyncio.run_coroutine_threadsafe(
            task_store.update_task(task_id, status=status, **changes), loop
        )

    def on_download(ratio: float, message: str) -> None:
        push(
            phase="downloading",
            message=message,
            progress=progress.overall(download=ratio),
        )

    def on_model(stage: str, _progress: float, _message: str) -> None:
        push(message="模型加载中" if stage != "完成" else "准备音频")

    def on_asr(asr: float, stage: str, raw: str) -> None:
        done = asr >= 1.0
        changes = {
            "phase": "correcting" if done and correction_enabled else "transcribing",
            "asr_progress": asr,
            "message": stage,
            "raw_text": raw,
            "progress": progress.overall(asr=asr),
        }
        if not correction_enabled:
            changes["result_text"] = raw
        push(**changes)

    def on_correction(text: str, ratio: float) -> None:
        overall = progress.overall(correction=ratio)
        push(
            result_text=text, correction_progress=progress.correction, progress=overall
        )

    def log(kind: str, message: str) -> dict:
        return {"timestamp": time.time(), "type": kind, "message": message}

    try:
        await task_store.update_task(
            task_id,
            status=TaskStatus.RUNNING,
            phase="downloading" if is_url else "transcribing",
            message="准备中",
            correction_enabled=correction_enabled,
            progress=0.01,
        )
        if is_url:
            downloaded = await loop.run_in_executor(
                None,
                lambda: download_audio(
                    source_info["url"],
                    task_id,
                    progress_cb=on_download,
                    cancelled_checker=cancelled,
                ),
            )
            cleanup_paths.append(downloaded)
            audio_path = Path(downloaded)
        else:
            audio_path = Path(source_info["path"])

        if engine._correction_engine:
            engine._correction_engine.set_hot_words(hotword_manager.list_all())
        engine.set_transcription_options(settings_manager.get().transcription.asr_model)

        result = await engine.transcribe(
            audio_path,
            progress_cb=on_asr,
            pause_event=control.pause_event if control else None,
            cancelled_checker=cancelled,
            correction_cb=on_correction,
            model_progress_cb=on_model,
        )
        finished.set()
        final = {
            "raw_text": result.raw_text,
            "segments": [asdict(seg) for seg in result.segments],
            "corrected_segments": [asdict(seg) for seg in result.corrected_segments],
            "correction_failed_batches": result.correction_failed_batches,
            "phase": "done",
        }
        if cancelled() or result.cancelled:
            if not correction_enabled:
                final["result_text"] = result.text
            # with correction on, keep the corrected text streamed so far
            await task_store.update_task(
                task_id,
                status=TaskStatus.CANCELLED,
                message="已取消",
                log=log("info", "任务已取消"),
                **final,
            )
            return
        failed = result.correction_failed_batches
        await task_store.update_task(
            task_id,
            status=TaskStatus.COMPLETED,
            progress=1.0,
            asr_progress=1.0,
            correction_progress=1.0 if correction_enabled else None,
            result_text=result.text,
            message=(
                "完成" if not failed else f"完成（{failed} 批纠错失败，已保留原文）"
            ),
            log=log(
                "warning" if failed else "info",
                "任务完成" if not failed else f"{failed} 批纠错失败，已保留原文",
            ),
            **final,
        )
    except Exception as exc:  # noqa: BLE001
        import traceback

        finished.set()
        if cancelled():
            await task_store.update_task(
                task_id,
                status=TaskStatus.CANCELLED,
                phase="done",
                message="已取消",
                log=log("info", "任务已取消"),
            )
            return
        print(f"[TASK ERROR] {task_id}: {exc}", flush=True)
        traceback.print_exc()
        await task_store.update_task(
            task_id,
            status=TaskStatus.FAILED,
            phase="done",
            message="失败",
            error=str(exc),
            log=log("error", str(exc)),
        )
    finally:
        finished.set()
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


@app.get("/api/tasks/{task_id}/export")
async def export_task(
    task_id: str, format: str = "txt", _: None = Depends(verify_token)
) -> PlainTextResponse:
    try:
        record = await task_store.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc
    fmt = format.lower()
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail="不支持的导出格式")
    cues = record.corrected_segments or record.segments
    name = str(record.source.get("name") or record.id)
    # files: drop the extension; video titles are kept whole ("Dr. Smith talk", "AC/DC live")
    title = (
        name
        if record.source.get("type") == "url"
        else os.path.splitext(os.path.basename(name))[0]
    )
    body, media = render_export(
        fmt, title, cues, record.result_text or record.raw_text or ""
    )
    return PlainTextResponse(body, media_type=f"{media}; charset=utf-8")


@app.post("/api/download")
async def download_media_endpoint(
    request: Request,
    _: None = Depends(verify_token),
) -> StreamingResponse:
    """Download video or audio from URL, streaming progress via NDJSON."""
    import json as _json

    body = await request.json()
    raw_url = body.get("url", "").strip()
    mode = body.get("mode", "video")  # "video" or "audio"
    save_dir = body.get("save_dir", "").strip()

    if not raw_url:
        raise HTTPException(status_code=400, detail="URL 不能为空")
    if not save_dir:
        raise HTTPException(status_code=400, detail="保存目录不能为空")
    if mode not in ("video", "audio"):
        raise HTTPException(status_code=400, detail="mode 必须是 video 或 audio")

    url = extract_url_from_text(raw_url)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    def progress_cb(ratio: float, message: str) -> None:
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {"type": "progress", "ratio": ratio, "message": message},
        )

    async def generate():
        def _run():
            return download_media(url, save_dir, mode, progress_cb=progress_cb)

        task = loop.run_in_executor(None, _run)

        # Drain progress events while download runs
        while True:
            done = task.done()
            # Flush all queued events
            while not queue.empty():
                event = queue.get_nowait()
                if event is not None:
                    yield _json.dumps(event, ensure_ascii=False) + "\n"
            if done:
                break
            # Wait a short interval or until the task completes
            try:
                event = await asyncio.wait_for(queue.get(), timeout=0.25)
                if event is not None:
                    yield _json.dumps(event, ensure_ascii=False) + "\n"
            except asyncio.TimeoutError:
                pass

        try:
            result = task.result()
            yield _json.dumps({"type": "done", **result}, ensure_ascii=False) + "\n"
        except Exception as exc:
            yield _json.dumps(
                {"type": "error", "detail": str(exc)}, ensure_ascii=False
            ) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")
