# 闻见 · EchoSmith

Cross-platform desktop speech transcription suite built with Tauri + React + FastAPI.

> **Status:** in active migration from legacy Gradio prototype. Follow this document while implementing each milestone of the task book.

## Repository layout

```
backend/    # FastAPI service (REST + WebSocket) for ASR tasks and media fetching
frontend/   # React + Tailwind + shadcn/ui interface served inside Tauri WebView
tauri/      # Tauri runner configuration and Rust bindings
scripts/    # Build & packaging helper scripts (shell + PowerShell)
assets/     # App icons and branding resources
models/     # Local FunASR model cache (ignored in VCS)
```

## Current goals

1. Rebuild the Python layer as an API-first backend exposing:
   - `GET /api/health`
   - `POST /api/tasks`
   - `GET /api/tasks/{id}`
   - `DELETE /api/tasks/{id}`
   - `WebSocket /ws/tasks/{id}` for progress streaming.
2. Wrap existing ASR logic (`probe_duration_ms`, chunking, yt-dlp fetch, etc.) inside reusable modules under `backend/`.
3. Implement the EchoSmith desktop experience with Tauri + React + Tailwind + shadcn/ui, following the wireframes in 《任务书.md》.
4. Provide one-click packaging workflows for macOS (.dmg/.app) and Windows (.msi/.exe).

## Naming

- English name: **EchoSmith**
- Chinese name: **闻见**

## Development prerequisites

- Node.js ≥ 18
- Rust toolchain with cargo
- Python ≥ 3.10
- FFmpeg available on `PATH`
- FunASR model directories placed in `models/`

## Next steps

- [x] Implement backend FastAPI service in `backend/app.py`
- [x] Port ASR engine helpers into `backend/asr_engine.py`
- [x] Set up React/Vite project in `frontend/`
- [ ] Configure Tauri bridge under `tauri/`
- [x] Add build scripts inside `scripts/`

## Backend endpoints (M1)

- `GET /api/health`: ffmpeg + FunASR 模型检查。
- `POST /api/tasks`: 上传文件或提供链接创建任务。
- `GET /api/tasks`: 列出所有任务；`GET /api/tasks/{id}` 查询单个任务。
- `POST /api/tasks/{id}/pause` / `resume` / `DELETE /api/tasks/{id}`：控制任务生命周期。
- `GET /api/tasks/{id}/export?format=txt|srt|json`: 导出转写结果。
- `WebSocket /ws/tasks/{id}`: 推送进度、日志与实时文本。

Refer to 《任务书.md》 for the complete milestone checklist and UI guidelines.

## Branding

- English name: **EchoSmith**
- 中文名：**闻见**
- Primary icon: `assets/icons/echo_logo.svg`
