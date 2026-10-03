<div align="center">
  <img src="frontend/echo_logo.svg" alt="EchoSmith Logo" width="200"/>

  # EchoSmith · 闻见

  **Fast, local speech-to-text desktop app built on SenseVoice + sherpa-onnx**

  **English** | [简体中文](README.zh-CN.md)

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/JingZhaoQi/EchoSmith/releases)
  [![Version](https://img.shields.io/badge/version-2.0.1-green)](https://github.com/JingZhaoQi/EchoSmith/releases)

</div>

## Features

- **Local first** — recognition runs entirely on your computer, no internet needed, audio never leaves it; smart correction is optional and, when on, sends only text to the provider you choose
- **Local recognition** — offline SenseVoice INT8 (sherpa-onnx); the model downloads automatically on first run
- **Fast** — RTF ≈ 0.042: one hour of audio in about 2.5 minutes; audio is decoded and recognized as a stream, so text appears about 1 second after you start
- **Smart correction** — fixes sound-alike errors and terminology through an LLM API (OpenAI / DeepSeek / Doubao / Anthropic / any OpenAI-compatible API); streamed while transcribing, text appears within seconds (reasoning is turned off for DeepSeek / Doubao: measured ~14 s → ~5 s per 1,000 characters, first text in ~3 s)
- **Side-by-side review** — import on the left; ASR text and corrected text side by side on the right, each with its own progress; drag to resize columns; with correction off, the ASR text fills the space
- **Hotwords** — preferred spellings for correction (church names, people's names, rare terms); view, search, add, delete, import and export them in Settings
- **Accurate timestamps** — Silero VAD splits on pauses, SenseVoice token timestamps cut subtitle lines, and corrected text is re-aligned to the original timeline
- **Batch processing** — transcribe many files in one go; the file list doubles as the task list: click to view a result, pause / resume / remove per file
- **Online videos** — paste a link to download and transcribe (powered by yt-dlp)
- **Live progress** — transcription progress and partial results pushed over WebSocket
- **Save as** — light up TXT / SRT / Markdown and every finished task is saved next to its source file (online videos go to Downloads); Markdown is split into paragraphs at pauses
- **Cross-platform** — macOS (Intel / Apple Silicon) and Windows
- **Modern UI** — liquid-glass look, light / dark / system theme, English / Chinese interface; settings save instantly

## Performance

| Metric | Value |
|--------|-------|
| RTF (real-time factor) | ~0.042 |
| 1 hour of audio | ~2.5 minutes |
| Model size | 228 MB (INT8 quantized) |
| Installer size | ~290 MB |
| Memory | ~500 MB |

> Measured on an Apple M1 Max (8 performance cores). The app detects the CPU core count to pick the best thread setting.

## Install

### Download a release

Get it from the [Releases](https://github.com/JingZhaoQi/EchoSmith/releases) page:

| Platform | File | Notes |
|----------|------|-------|
| macOS | `EchoSmith_x.x.x_universal.dmg` | Universal (Intel + Apple Silicon) |
| Windows | `EchoSmith_x.x.x_x64-setup.exe` | NSIS installer |
| Windows | `EchoSmith_x.x.x_x64_en-US.msi` | MSI installer |

**First launch on macOS**: right-click the app → Open (to get past Gatekeeper), or run:

```bash
xattr -cr /Applications/EchoSmith.app
```

### Build from source

#### Requirements

- Node.js 20+, pnpm
- Python 3.12+
- Rust (latest stable)
- FFmpeg

#### Quick start

```bash
# Clone
git clone https://github.com/JingZhaoQi/EchoSmith.git
cd EchoSmith

# Virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Dependencies
pip install -r backend/requirements.txt
cd frontend && pnpm install && cd ..
cd tauri && pnpm install && cd ..

# Models (first run, ~230 MB)
python scripts/download_models.py

# Development mode
cd tauri && pnpm tauri dev
```

#### Build installers

```bash
# macOS DMG
bash scripts/build_local_dmg.sh

# Windows (run on Windows)
powershell scripts/build_backend.ps1
cd tauri && npm run build
```

## Usage

### Local files (one or many)
1. Under **Local Files** on the left, click to choose files, or drop audio/video files anywhere in the window
2. Top right, light up the formats to save automatically (TXT / SRT / Markdown, any combination)
3. Click **Start Transcription**: ASR and corrected text stream in on the right, and results are saved next to the source files when done
4. Click a file in the list to view its result; lighting a format for a finished task saves it right away

### Online videos
1. Switch to **Online Video** and paste a link or share text (YouTube, Bilibili, Douyin and more)
2. Click **Start Transcription**: the audio is downloaded and transcribed, and results go to your Downloads folder; you can also just download the video or audio

### Smart correction (optional)
Turn on cloud API correction in **Settings**, choose a provider and enter your API key; every change takes effect immediately.

### Supported formats

Audio: MP3, WAV, M4A, FLAC, OGG, AAC, WMA, AIFF, CAF
Video: MP4, MOV, AVI, MKV, WEBM, M4V

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2.x + Rust |
| Frontend | React 18 + TypeScript + TailwindCSS + Vite |
| State | Zustand |
| Backend | FastAPI + uvicorn |
| ASR engine | sherpa-onnx + SenseVoice INT8 |
| Text correction | LLM cloud APIs (OpenAI-compatible / Anthropic), streamed and concurrent |
| Speech segmentation | Silero VAD |
| Audio/video | FFmpeg (bundled) |
| Online downloads | yt-dlp |

## License

MIT License — see [LICENSE](LICENSE)

## Acknowledgements

- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) — speech recognition model by Alibaba FunAudioLLM
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — high-performance ONNX inference engine
- [Silero VAD](https://github.com/snakers4/silero-vad) — voice activity detection
- [Tauri](https://tauri.app/) — modern desktop app framework
- [FastAPI](https://fastapi.tiangolo.com/) — high-performance web framework
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — video downloader

---

<div align="center">
  Made with ❤️ by JingZhaoQi
</div>
