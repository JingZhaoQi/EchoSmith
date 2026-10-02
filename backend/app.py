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
    from hotwords import HotwordManager
    from settings import SettingsManager
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
    from .hotwords import HotwordManager
    from .settings import SettingsManager
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

app = FastAPI(title="EchoSmith Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_ROOT = Path(tempfile.gettempdir()) / "echosmith_uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
SRT_MAX_CHARS_PER_CUE = 40
SRT_MAX_CHARS_PER_LINE = 20


def _get_hotwords_path() -> Path:
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "com.echosmith.app" / "hotwords.json"
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
LANGUAGE_FORM_FIELD = Form(default="zh")


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
            debug_info["ffmpeg_bin_contents"] = [f.name for f in bundled_ffmpeg_dir.iterdir()]

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
async def add_hotword(request: Request, _: None = Depends(verify_token)) -> JSONResponse:
    body = await request.json()
    word = body.get("word", "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="热词不能为空")
    hotword_manager.add(word)
    return JSONResponse({"words": hotword_manager.list_all()})


@app.post("/api/hotwords/import")
async def import_hotwords(request: Request, _: None = Depends(verify_token)) -> JSONResponse:
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
    return JSONResponse({"words": hotword_manager.list_all(), "count": len(hotword_manager.list_all())})


@app.delete("/api/hotwords/{word}")
async def remove_hotword(word: str, _: None = Depends(verify_token)) -> JSONResponse:
    hotword_manager.remove(word)
    return JSONResponse({"words": hotword_manager.list_all()})


@app.get("/api/settings")
async def get_settings(_: None = Depends(verify_token)) -> JSONResponse:
    return JSONResponse(settings_manager.snapshot())


@app.post("/api/settings")
async def update_settings(request: Request, _: None = Depends(verify_token)) -> JSONResponse:
    global _correction_engine
    body = await request.json()
    transcription = body.get("transcription", {})
    if transcription:
        settings_manager.update_transcription(**transcription)

    correction = body.get("correction", {})
    if correction:
        # If api_key is masked placeholder, keep the existing key
        if "api_key" in correction and "****" in correction["api_key"]:
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
    language = body.get("language", "zh")

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
    language = body.get("language", "zh")

    if not raw_url:
        raise HTTPException(status_code=400, detail="URL 不能为空")

    # Extract actual URL from share text (e.g. Douyin paste includes extra text)
    url = extract_url_from_text(raw_url)

    task_id = uuid.uuid4().hex
    cleanup_paths: list[str] = []

    try:
        # Fetch title without downloading (fast)
        try:
            title = extract_video_title(url)
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
    if source_path and record.source.get("type") != "local" and Path(source_path).exists():
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

    _max_progress = 0.0
    _correction_started = False

    def progress_cb(progress: float, stage: str, partial: str) -> None:
        nonlocal _max_progress
        if control and not control.pause_event.is_set():
            status = TaskStatus.PAUSED
        else:
            status = TaskStatus.RUNNING
        # Ensure progress only goes forward
        if progress > _max_progress:
            _max_progress = progress
        else:
            progress = _max_progress
        update_kwargs: dict = {
            "status": status,
            "progress": progress,
            "message": stage,
            "log": {
                "timestamp": time.time(),
                "type": "progress",
                "message": stage,
                "progress": progress,
            },
        }
        # The final "完成" callback carries corrected text; keep raw_text
        # strictly for pre-correction transcript updates.
        if progress < 1.0:
            update_kwargs["raw_text"] = partial
        # Until correction starts producing text, the raw transcript doubles
        # as the displayed result so the UI streams as usual.
        if not _correction_started:
            update_kwargs["result_text"] = partial
        asyncio.run_coroutine_threadsafe(
            task_store.update_task(task_id, **update_kwargs),
            loop,
        )

    def correction_cb(done: int, total: int, corrected_prefix: str) -> None:
        nonlocal _correction_started
        _correction_started = True
        ratio = done / total if total > 0 else 0.0
        progress = 0.92 + 0.07 * min(ratio, 1.0)
        asyncio.run_coroutine_threadsafe(
            task_store.update_task(
                task_id,
                status=TaskStatus.RUNNING,
                progress=progress,
                message=f"智能纠错中 {done}/{total}",
                result_text=corrected_prefix,
                log={
                    "timestamp": time.time(),
                    "type": "progress",
                    "message": f"智能纠错中 {done}/{total}",
                    "progress": progress,
                },
            ),
            loop,
        )

    def model_download_cb(stage: str, progress: float, message: str) -> None:
        """Callback for model download progress."""
        asyncio.run_coroutine_threadsafe(
            task_store.update_task(
                task_id,
                status=TaskStatus.RUNNING,
                progress=progress * 0.3,  # Model download takes first 30% of progress
                message=f"模型{stage}",
                log={
                    "timestamp": time.time(),
                    "type": "model_download",
                    "stage": stage,
                    "message": message,
                    "progress": progress,
                },
            ),
            loop,
        )

    try:
        await task_store.update_task(
            task_id, status=TaskStatus.RUNNING, message="准备中", progress=0.01
        )

        # Initialize engine with download callback
        if engine._download_callback is None:
            engine._download_callback = model_download_cb

        if source_info.get("type") == "url":
            # --- URL download branch ---
            await task_store.update_task(task_id, message="下载中…", progress=0.01)

            def _dl_progress(ratio: float, msg: str) -> None:
                # Map download progress to 0 ~ 0.3
                mapped = ratio * 0.3
                asyncio.run_coroutine_threadsafe(
                    task_store.update_task(
                        task_id,
                        status=TaskStatus.RUNNING,
                        progress=mapped,
                        message=msg,
                        log={
                            "timestamp": time.time(),
                            "type": "progress",
                            "message": msg,
                            "progress": mapped,
                        },
                    ),
                    loop,
                )

            downloaded_path = await loop.run_in_executor(
                None,
                lambda: download_audio(
                    source_info["url"],
                    task_id,
                    progress_cb=_dl_progress,
                    cancelled_checker=(lambda: control.cancelled) if control else None,
                ),
            )
            cleanup_paths.append(downloaded_path)
            audio_path = Path(downloaded_path)
        else:
            audio_path = Path(source_info["path"])

        await task_store.update_task(task_id, message="转写中", progress=0.05 if source_info.get("type") != "url" else 0.30)

        # Apply language setting from task
        await engine.set_language(source_info.get("language", "zh"))

        # Update correction engine hotwords for this task
        if engine._correction_engine:
            engine._correction_engine.set_hot_words(hotword_manager.list_all())

        transcription = settings_manager.get().transcription
        engine.set_transcription_options(transcription.asr_model)

        # For URL tasks, map transcription progress from 0.3 to 1.0
        if source_info.get("type") == "url":
            def url_progress_cb(progress: float, stage: str, partial: str) -> None:
                mapped_progress = 0.3 + progress * 0.7
                progress_cb(mapped_progress, stage, partial)

            actual_progress_cb = url_progress_cb
        else:
            actual_progress_cb = progress_cb

        result = await engine.transcribe(
            audio_path,
            progress_cb=actual_progress_cb,
            pause_event=control.pause_event if control else None,
            cancelled_checker=(lambda: control.cancelled) if control else None,
            correction_cb=correction_cb,
        )

        if control and control.cancelled:
            updated = await task_store.update_task(
                task_id,
                status=TaskStatus.CANCELLED,
                message="已取消",
                log={
                    "timestamp": time.time(),
                    "type": "info",
                    "message": "任务中途取消",
                },
            )
            if updated is None:
                # Task was deleted, exit gracefully
                return
        else:
            updated = await task_store.update_task(
                task_id,
                status=TaskStatus.COMPLETED,
                progress=1.0,
                message="完成",
                result_text=result.text,
                raw_text=result.raw_text or None,
                segments=[segment.__dict__ for segment in result.segments],
                log={"timestamp": time.time(), "type": "info", "message": "任务完成"},
            )
            if updated is None:
                # Task was deleted, exit gracefully
                return
    except Exception as exc:  # noqa: BLE001
        import traceback
        print(f"[TASK ERROR] {task_id}: {exc}", flush=True)
        traceback.print_exc()
        updated = await task_store.update_task(
            task_id,
            status=TaskStatus.FAILED,
            message="失败",
            error=str(exc),
            log={"timestamp": time.time(), "type": "error", "message": str(exc)},
        )
        if updated is None:
            # Task was deleted, exit gracefully
            return
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


def _split_text_to_length(text: str, max_chars: int) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    if " " in text:
        lines: list[str] = []
        current = ""
        for word in text.split():
            if not current:
                if len(word) <= max_chars:
                    current = word
                else:
                    chunks = [word[i : i + max_chars] for i in range(0, len(word), max_chars)]
                    lines.extend(chunks[:-1])
                    current = chunks[-1]
                continue

            candidate = f"{current} {word}"
            if len(candidate) <= max_chars:
                current = candidate
                continue

            lines.append(current)
            if len(word) <= max_chars:
                current = word
            else:
                chunks = [word[i : i + max_chars] for i in range(0, len(word), max_chars)]
                lines.extend(chunks[:-1])
                current = chunks[-1]
        if current:
            lines.append(current)
        return lines

    return [
        text[i : i + max_chars].strip()
        for i in range(0, len(text), max_chars)
        if text[i : i + max_chars].strip()
    ]


def _split_segment_text(text: str, max_chars: int = SRT_MAX_CHARS_PER_CUE) -> list[str]:
    """Split long text into smaller chunks respecting punctuation, then length."""
    text = (text or "").strip()
    if not text:
        return []

    # First split by sentence-ending punctuation
    parts: list[str] = []
    buf = ""
    for ch in text:
        buf += ch
        if ch in "。！？!?；;，,":
            parts.append(buf.strip())
            buf = ""
    if buf.strip():
        parts.append(buf.strip())

    # Flatten any overly long part into fixed-size chunks
    final_parts: list[str] = []
    for part in parts or [text]:
        if len(part) <= max_chars:
            final_parts.append(part)
            continue
        final_parts.extend(_split_text_to_length(part, max_chars))
    return [p for p in final_parts if p]


def _wrap_srt_text(text: str, max_chars: int = SRT_MAX_CHARS_PER_LINE) -> str:
    """Wrap one subtitle cue across display-safe SRT text lines."""
    wrapped_lines: list[str] = []
    for paragraph in (text or "").splitlines() or [text or ""]:
        wrapped_lines.extend(_split_text_to_length(paragraph, max_chars))
    return "\n".join(wrapped_lines)


def _normalize_sub_durations(
    durations: list[int], target: int, min_duration: int
) -> list[int]:
    """Adjust durations to sum to target while enforcing min_duration."""
    if not durations:
        return []
    durations = [max(min_duration, d) for d in durations]
    current = sum(durations)
    if current == 0:
        return [target // len(durations)] * len(durations)

    # Scale down or up to match target
    scaled = [max(min_duration, int(d * target / current)) for d in durations]
    diff = target - sum(scaled)
    if diff != 0:
        # Distribute remainder across items
        for i in range(len(scaled)):
            if diff == 0:
                break
            scaled[i] += 1 if diff > 0 else -1
            diff += -1 if diff > 0 else 1
    return scaled


def _split_segment(
    seg: dict, max_chars: int = SRT_MAX_CHARS_PER_CUE, max_duration_ms: int = 6000
) -> list[dict]:
    """Split a segment into smaller SRT-friendly pieces."""
    start_ms = int(seg.get("start_ms", 0))
    end_ms = int(seg.get("end_ms", start_ms))
    text = seg.get("text", "") or ""
    if end_ms <= start_ms:
        # Fallback duration: 250ms per 10 chars, minimum 2s
        end_ms = start_ms + max(2000, int(len(text) / 10 * 250))

    duration = end_ms - start_ms
    pieces = _split_segment_text(text, max_chars=max_chars)
    if not pieces:
        return []

    # If already short enough and duration is acceptable, keep as-is
    if len(pieces) == 1 and duration <= max_duration_ms and len(text) <= max_chars:
        return [
            {
                "start_ms": start_ms,
                "end_ms": end_ms,
                "text": text,
            }
        ]

    # Allocate durations proportionally to text length
    weights = [len(p) for p in pieces]
    total_weight = sum(weights) or 1
    raw_durations = [max(1, int(duration * w / total_weight)) for w in weights]
    sub_durations = _normalize_sub_durations(raw_durations, duration, min_duration=800)

    sub_segments = []
    cursor = start_ms
    for piece, seg_dur in zip(pieces, sub_durations):
        sub_segments.append(
            {
                "start_ms": cursor,
                "end_ms": cursor + seg_dur,
                "text": piece,
            }
        )
        cursor += seg_dur
    return sub_segments


def _segments_to_srt(segments: list[dict]) -> str:
    lines = []
    index = 1
    for seg in segments:
        for sub in _split_segment(seg):
            start = _ms_to_timestamp(sub.get("start_ms", 0))
            end = _ms_to_timestamp(sub.get("end_ms", 0))
            text = _wrap_srt_text(str(sub.get("text", "")))
            lines.append(f"{index}\n{start} --> {end}\n{text}\n")
            index += 1
    return "\n".join(lines)


def _ms_to_timestamp(ms: int) -> str:
    seconds, millis = divmod(int(ms), 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


@app.get("/api/tasks/{task_id}/export")
async def export_task(
    task_id: str, format: str = "txt", _: None = Depends(verify_token)
):
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
            yield _json.dumps({"type": "error", "detail": str(exc)}, ensure_ascii=False) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")
