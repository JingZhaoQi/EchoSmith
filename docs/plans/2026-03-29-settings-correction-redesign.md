# Settings Panel & Correction Engine Redesign

## Overview

Replace the non-functional 0.5B LLM correction with a user-configurable correction system. Add a Settings panel to the UI where users choose between: no correction, local 3B model, or cloud API correction.

## Decisions

- Remove 0.5B model and llama-cpp-python dependency (proven ineffective)
- 3B model is optional, user-initiated download (~2GB)
- Cloud API supports OpenAI-compatible endpoints (OpenAI, Anthropic, DeepSeek, custom)
- Hotword management moves into the Settings panel
- Settings persist in a JSON file alongside hotwords

## Architecture

### Backend Settings (`backend/settings.py`)

```python
@dataclass
class CorrectionSettings:
    correction_mode: str = "none"     # "none" | "local_3b" | "cloud_api"
    api_provider: str = "openai"      # "openai" | "anthropic" | "deepseek" | "custom"
    api_key: str = ""
    api_model: str = "gpt-4o-mini"
    api_base_url: str = ""            # for custom provider
```

Storage path: same directory as hotwords.json.

### Correction Engine Refactor (`backend/correction_engine.py`)

Single `CorrectionEngine` class with pluggable backends:

```
CorrectionEngine
  ├── correct(segments, preceding_text) -> list[str]
  ├── _correct_local(...)    # llama-cpp-python + Qwen2.5-3B Q4
  └── _correct_cloud(...)    # httpx POST to OpenAI-compatible API
```

- `correction_mode == "none"`: return original segments unchanged
- `correction_mode == "local_3b"`: load 3B model via llama-cpp-python, same prompt design
- `correction_mode == "cloud_api"`: POST to provider's chat completion endpoint

Cloud API uses httpx (already available via FastAPI deps) with OpenAI-compatible format. Anthropic uses its own format but maps to the same interface.

### API Endpoints

- `GET /api/settings` — return current settings (api_key masked)
- `POST /api/settings` — update settings, reinitialize correction engine
- `GET /api/hotwords` — list hotwords (existing)
- `POST /api/hotwords` — add hotword (existing)
- `DELETE /api/hotwords/{word}` — remove hotword (existing)
- `POST /api/models/correction/download` — trigger 3B model download
- `GET /api/models/correction/status` — download progress

### Frontend Settings Panel

New `SettingsPanel.tsx` component, accessed via a gear icon in the header.

Sections:
1. **Correction Mode** — radio group: Off / Local 3B / Cloud API
2. **Local 3B** (shown when selected):
   - Model status (downloaded / not downloaded / downloading)
   - Download button with progress bar
3. **Cloud API** (shown when selected):
   - Provider dropdown (OpenAI / Anthropic / DeepSeek / Custom)
   - API Key input (password field)
   - Model name input
   - Custom base URL (shown for "Custom" provider)
4. **Hotword Management** — tag input UI (already built, move here)

### Model Details

- Qwen2.5-3B-Instruct Q4_K_M GGUF: ~2GB
- Download from ModelScope (faster in China) with HuggingFace fallback
- Cache at: `~/.cache/sherpa-onnx/correction/qwen2.5-3b-q4.gguf`
- llama-cpp-python installed only when user chooses local 3B (or pre-bundled)

### Thread Allocation (unchanged)

When local 3B is active, split physical cores 2:1 (transcribe:correction). When cloud API or none, all cores to transcription.

### Progress & Pipeline (unchanged)

Dual-thread producer-consumer pipeline remains. Monotonic progress guard stays. Correction progress callback sends actual corrected text.

### Prompt Design (for both local and cloud)

System prompt + hotwords + preceding context + numbered segments. Same format for local and cloud, only the transport differs.

### Error Handling

- Cloud API failure → keep original text, log error
- Local model load failure → fall back to "none" mode
- Invalid API key → return error to frontend, don't start task
- Network timeout → 30s per batch, keep original on timeout
