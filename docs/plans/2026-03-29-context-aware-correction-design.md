# Context-Aware Post-Correction Design

## Overview

EchoSmith transcription pipeline enhancement: add LLM-based context-aware error correction after SenseVoice ASR, plus a user-managed hotword table for domain-specific term correction.

**Core principle**: SenseVoice produces a fast initial transcript; a local small LLM refines it using preceding context and hotwords. The two stages run as a parallel pipeline — transcription never waits for correction, correction never blocks transcription.

## Architecture

```
Transcription Thread                    Correction Thread
─────────────────                       ─────────────────
[VAD seg 0] ──┐
[VAD seg 1] ──┤── queue.Queue ──► [correct seg 0-4] → corrected
[VAD seg 2] ──┤
[VAD seg 3] ──┤                   [correct seg 5-9] → corrected
[VAD seg 4] ──┘
[VAD seg 5] ──┐
  ...         │                     ...
[SENTINEL]  ──┘                   [flush remaining] → corrected
```

## Module 1: CorrectionEngine (`backend/correction_engine.py`)

New file, peer to `asr_engine.py`. Single responsibility: load LLM, accept text, return corrected text.

### Model

- **Qwen2.5-0.5B Q4 GGUF** (~400MB)
- Inference via `llama-cpp-python`
- Context window: 2048 tokens
- Thread count: dynamically allocated (see Thread Allocation)

### Interface

```python
class CorrectionEngine:
    def __init__(self, model_path: str, hot_words: list[str] | None = None, num_threads: int = 1):
        ...

    def load_model(self) -> None: ...
    def has_model(self) -> bool: ...

    def correct(
        self,
        segments: list[str],
        preceding_text: str = "",
    ) -> list[str]: ...
```

### Prompt Design

- System: "You are a speech transcription error corrector. Fix homophones, proper nouns, and punctuation based on context."
- Inject hotword list: "Preferred terms: {hotwords}"
- Inject preceding context: "Confirmed preceding text: {preceding_text}" (last 500 chars)
- Input segments numbered, output must match count
- Constraint: "Do not change meaning. Do not add or remove content. Only fix errors."

### Model File Location

- Bundled (PyInstaller): `{MEIPASS}/models_cache/correction/qwen2.5-0.5b-q4.gguf`
- Cache (dev): `~/.cache/sherpa-onnx/correction/qwen2.5-0.5b-q4.gguf`
- Windows cache: `%LOCALAPPDATA%/sherpa-onnx/correction/qwen2.5-0.5b-q4.gguf`

## Module 2: Pipeline Coordination (modify `backend/asr_engine.py`)

### Changes to `_transcribe_with_vad`

Replace sequential transcribe-and-return with dual-thread producer-consumer:

1. **Transcription thread** (existing logic): transcribes VAD segments, puts results into `queue.Queue`, sends `SENTINEL` when done.
2. **Correction thread** (new): consumes from queue, buffers N=5 segments per batch, calls `CorrectionEngine.correct()` with preceding context.

### Thread Allocation

```python
total_physical = ASREngine._default_num_threads()

# When correction is active: 2:1 split
transcribe_threads = max(2, total_physical * 2 // 3)
correction_threads = max(1, total_physical - transcribe_threads)

# When correction is inactive: all threads to transcription (current behavior)
```

### Key Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Window size N | 5 segments | ~15-30s audio, balances context vs latency |
| Preceding context | 500 chars max | Diminishing returns beyond this |
| Failure handling | Keep original text | Correction is additive, must not break transcription |

### Progress Mapping

- Transcription: 0.15 ~ 0.70
- Correction: 0.70 ~ 0.95
- Finalization: 0.95 ~ 1.0

### Opt-in via Constructor

`ASREngine.__init__` gains `correction_engine: CorrectionEngine | None`. When `None`, behavior is identical to current version.

## Module 3: Hotword Manager (`backend/hotwords.py`)

### Interface

```python
class HotwordManager:
    def __init__(self, storage_path: Path): ...
    def load(self) -> None: ...
    def save(self) -> None: ...
    def add(self, word: str) -> None: ...
    def remove(self, word: str) -> None: ...
    def list_all(self) -> list[str]: ...
```

### Storage

```json
{
  "version": 1,
  "words": ["term1", "term2"]
}
```

Location follows Tauri `app_data_dir` convention:
- macOS: `~/Library/Application Support/com.echosmith.app/hotwords.json`
- Windows: `%APPDATA%/echosmith/hotwords.json`

### API Endpoints (added to `app.py`)

- `GET /api/hotwords` — list all hotwords
- `POST /api/hotwords` — add hotword (`{"word": "..."}`)
- `DELETE /api/hotwords/{word}` — remove hotword

Hotword changes take effect on the next task (not mid-task).

## Module 4: Frontend Changes

### Settings Panel — Hotword Management

- Input field + "Add" button (or Enter key)
- Tags display with × delete button per tag
- Calls `GET/POST/DELETE /api/hotwords`

### Transcription Progress UI

```
0%~70%:   "转写中 3/12"        (unchanged)
70%~95%:  "智能纠错中 2/3"      (new stage)
95%~100%: "完成"
```

ResultPanel displays final corrected text. No before/after diff.

### No Toggle

Correction auto-enables when model is available, auto-skips when not. No user-facing switch.

## Module 5: Model Lifecycle

### Health Check Extension

`/api/health` response gains:

```json
{
  "correction_model": true,
  "correction_model_loaded": false,
  "correction_model_path": "..."
}
```

### Loading Strategy

- Lazy load on first task (not at startup)
- Stay resident after loading
- Mirrors `ASREngine.ensure_model()` pattern

### Download

- `scripts/download_models.py` extended with correction model download
- New endpoint: `POST /api/models/correction/download`
- Frontend prompts download when `correction_model: false` in health check

### Graceful Degradation

```python
if correction_engine and correction_engine.has_model():
    # Pipeline mode: transcribe + correct in parallel
else:
    # Legacy mode: transcribe only (zero behavioral change)
```

## Module 6: Dependencies & Packaging

### New Python Dependency

```
llama-cpp-python>=0.3.0
```

Platform support:
- macOS Apple Silicon: Metal acceleration (automatic)
- macOS Intel: CPU only
- Windows: CPU or optional CUDA

### PyInstaller

- Add `--collect-all llama_cpp` for native libraries
- Bundle GGUF model in `models_cache/correction/`
- Installer size: ~300MB → ~700MB

### `download_models.py` Extension

Add `download_correction_model(cache_dir)` function alongside existing `download_models()` and `download_silero_vad()`.
