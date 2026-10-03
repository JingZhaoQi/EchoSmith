# Settings Panel & Correction Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace non-functional 0.5B correction with configurable correction system: local 3B model or cloud API, managed via a new Settings panel.

**Architecture:** Backend stores settings in JSON, `CorrectionEngine` dispatches to local (llama-cpp-python) or cloud (httpx) backends. Frontend adds a Settings panel accessed via gear icon in header, with correction mode selection, API key management, model download, and hotword editing.

**Tech Stack:** Python 3.12, httpx, llama-cpp-python (optional), FastAPI, React 18 + TypeScript, Tauri 2.x

**Design doc:** `docs/plans/2026-03-29-settings-correction-redesign.md`

---

### Task 1: Backend Settings Manager

**Files:**
- Create: `backend/settings.py`

**Step 1: Implement SettingsManager**

```python
"""Persistent application settings for EchoSmith."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class CorrectionConfig:
    mode: str = "none"  # "none" | "local_3b" | "cloud_api"
    api_provider: str = "openai"  # "openai" | "anthropic" | "deepseek" | "custom"
    api_key: str = ""
    api_model: str = "gpt-4o-mini"
    api_base_url: str = ""


@dataclass
class AppSettings:
    correction: CorrectionConfig = field(default_factory=CorrectionConfig)


class SettingsManager:
    def __init__(self, storage_path: Path) -> None:
        self._path = storage_path
        self._settings = AppSettings()
        self.load()

    def load(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            correction_data = data.get("correction", {})
            self._settings.correction = CorrectionConfig(
                mode=correction_data.get("mode", "none"),
                api_provider=correction_data.get("api_provider", "openai"),
                api_key=correction_data.get("api_key", ""),
                api_model=correction_data.get("api_model", "gpt-4o-mini"),
                api_base_url=correction_data.get("api_base_url", ""),
            )
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    def save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(asdict(self._settings), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get(self) -> AppSettings:
        return self._settings

    def update_correction(self, **kwargs) -> CorrectionConfig:
        for key, value in kwargs.items():
            if hasattr(self._settings.correction, key):
                setattr(self._settings.correction, key, value)
        self.save()
        return self._settings.correction

    def snapshot(self) -> dict:
        """Return settings with api_key masked for frontend."""
        data = asdict(self._settings)
        key = data["correction"]["api_key"]
        if key:
            data["correction"]["api_key_set"] = True
            data["correction"]["api_key"] = key[:4] + "****" + key[-4:] if len(key) > 8 else "****"
        else:
            data["correction"]["api_key_set"] = False
        return data
```

**Step 2: Commit**

```bash
git add backend/settings.py
git commit -m "feat: add SettingsManager with correction config persistence"
```

---

### Task 2: Rewrite CorrectionEngine — Cloud API Backend

**Files:**
- Rewrite: `backend/correction_engine.py`

**Step 1: Rewrite with dual backends**

```python
"""Correction engine with local LLM and cloud API backends."""
from __future__ import annotations

import json
import re
from pathlib import Path

MAX_PRECEDING_CHARS = 500
SEGMENT_PATTERN = re.compile(r"\[(\d+)\]\s*(.*?)(?=\[\d+\]|\Z)", re.DOTALL)

SYSTEM_PROMPT = (
    "你是语音转写纠错助手。根据上下文和专业术语表修正语音识别错误，"
    "包括同音字、近音字、专有名词。\n"
    "规则：\n"
    "- 只修正明显的语音识别错误（同音/近音替换）\n"
    "- 不要改变原意，不要增删内容\n"
    "- 每段以 [N] 开头输出，保持段数不变\n"
    "- 直接输出纠正结果，不要解释"
)


def build_correction_prompt(
    segments: list[str],
    preceding_text: str = "",
    hot_words: list[str] | None = None,
) -> str:
    parts: list[str] = []
    if hot_words:
        parts.append(f"专业术语（优先使用这些正确写法）：{', '.join(hot_words[:100])}")
    if preceding_text:
        truncated = preceding_text[-MAX_PRECEDING_CHARS:]
        parts.append(f"已确认的前文：{truncated}")
    parts.append("请纠正以下语音转写文本中的同音字错误：")
    for i, seg in enumerate(segments, 1):
        parts.append(f"[{i}] {seg}")
    return "\n".join(parts)


def parse_correction_response(
    response: str,
    num_segments: int,
    originals: list[str] | None = None,
) -> list[str]:
    if not response or not response.strip():
        return list(originals) if originals else [""] * num_segments
    matches = SEGMENT_PATTERN.findall(response)
    parsed = [text.strip() for _, text in matches]
    if len(parsed) != num_segments:
        return list(originals) if originals else [""] * num_segments
    return parsed


class CorrectionEngine:
    def __init__(
        self,
        mode: str = "none",
        model_path: str = "",
        hot_words: list[str] | None = None,
        num_threads: int = 1,
        api_provider: str = "openai",
        api_key: str = "",
        api_model: str = "gpt-4o-mini",
        api_base_url: str = "",
    ) -> None:
        self._mode = mode
        self._model_path = model_path
        self._hot_words = hot_words or []
        self._num_threads = num_threads
        self._api_provider = api_provider
        self._api_key = api_key
        self._api_model = api_model
        self._api_base_url = api_base_url
        self._llm = None  # lazy loaded

    def has_model(self) -> bool:
        if self._mode == "local_3b":
            return self._llm is not None
        if self._mode == "cloud_api":
            return bool(self._api_key)
        return False

    def set_hot_words(self, words: list[str]) -> None:
        self._hot_words = list(words)

    def correct(
        self,
        segments: list[str],
        preceding_text: str = "",
    ) -> list[str]:
        if self._mode == "none":
            return list(segments)
        if self._mode == "local_3b":
            return self._correct_local(segments, preceding_text)
        if self._mode == "cloud_api":
            return self._correct_cloud(segments, preceding_text)
        return list(segments)

    def _correct_local(self, segments: list[str], preceding_text: str) -> list[str]:
        if self._llm is None:
            try:
                from llama_cpp import Llama
                self._llm = Llama(
                    model_path=self._model_path,
                    n_ctx=4096,
                    n_threads=self._num_threads,
                    verbose=False,
                )
            except Exception as exc:
                print(f"[CORRECTION] Local model load failed: {exc}", flush=True)
                return list(segments)

        prompt = build_correction_prompt(segments, preceding_text, self._hot_words)
        try:
            response = self._llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=2048,
                temperature=0.1,
            )
            content = response["choices"][0]["message"]["content"] or ""
            print(f"[CORRECTION] Local response: {content[:200]}", flush=True)
            return parse_correction_response(content, len(segments), segments)
        except Exception as exc:
            print(f"[CORRECTION] Local inference error: {exc}", flush=True)
            return list(segments)

    def _correct_cloud(self, segments: list[str], preceding_text: str) -> list[str]:
        if not self._api_key:
            return list(segments)

        prompt = build_correction_prompt(segments, preceding_text, self._hot_words)

        try:
            import httpx
        except ImportError:
            print("[CORRECTION] httpx not installed", flush=True)
            return list(segments)

        # Determine endpoint and headers
        if self._api_provider == "anthropic":
            url = "https://api.anthropic.com/v1/messages"
            headers = {
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            body = {
                "model": self._api_model,
                "max_tokens": 2048,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": prompt}],
            }
        else:
            # OpenAI-compatible (openai, deepseek, custom)
            base = self._api_base_url or {
                "openai": "https://api.openai.com/v1",
                "deepseek": "https://api.deepseek.com/v1",
            }.get(self._api_provider, "https://api.openai.com/v1")
            url = f"{base}/chat/completions"
            headers = {
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            }
            body = {
                "model": self._api_model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 2048,
                "temperature": 0.1,
            }

        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, json=body, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            # Extract content based on provider
            if self._api_provider == "anthropic":
                content = data["content"][0]["text"]
            else:
                content = data["choices"][0]["message"]["content"]

            print(f"[CORRECTION] Cloud response: {content[:200]}", flush=True)
            return parse_correction_response(content, len(segments), segments)
        except Exception as exc:
            print(f"[CORRECTION] Cloud API error: {exc}", flush=True)
            return list(segments)
```

**Step 2: Commit**

```bash
git add backend/correction_engine.py
git commit -m "feat: rewrite CorrectionEngine with cloud API and local 3B backends"
```

---

### Task 3: Settings & Correction API Endpoints

**Files:**
- Modify: `backend/app.py`

**Step 1: Replace correction engine initialization and add settings endpoints**

At the top of `app.py`, replace the correction engine init block (lines 88-116) with:

```python
from settings import SettingsManager  # add to try/except import block

# After hotword_manager init:
settings_manager = SettingsManager(_get_hotwords_path().parent / "settings.json")

def _build_correction_engine() -> CorrectionEngine | None:
    cfg = settings_manager.get().correction
    if cfg.mode == "none":
        return None
    total_threads = ASREngine._default_num_threads()
    _, c_threads = ASREngine._allocate_threads(total_threads, correction_active=(cfg.mode == "local_3b"))
    return CorrectionEngine(
        mode=cfg.mode,
        model_path=_get_correction_model_path().replace("0.5b", "3b"),
        hot_words=hotword_manager.list_all(),
        num_threads=c_threads,
        api_provider=cfg.api_provider,
        api_key=cfg.api_key,
        api_model=cfg.api_model,
        api_base_url=cfg.api_base_url,
    )

_correction_engine = _build_correction_engine()
engine = ASREngine(correction_engine=_correction_engine)
```

Add settings endpoints:

```python
@app.get("/api/settings")
async def get_settings(_: None = Depends(verify_token)) -> JSONResponse:
    return JSONResponse(settings_manager.snapshot())

@app.post("/api/settings")
async def update_settings(request: Request, _: None = Depends(verify_token)) -> JSONResponse:
    global _correction_engine
    body = await request.json()
    correction = body.get("correction", {})
    if correction:
        # If api_key is masked placeholder, keep the existing key
        if "api_key" in correction and "****" in correction["api_key"]:
            del correction["api_key"]
        settings_manager.update_correction(**correction)

    # Rebuild correction engine with new settings
    _correction_engine = _build_correction_engine()
    engine._correction_engine = _correction_engine

    return JSONResponse(settings_manager.snapshot())
```

Update `_get_correction_model_path` for 3B model:

```python
def _get_correction_model_path() -> str:
    import sys as _sys
    if getattr(_sys, "frozen", False):
        bundled = Path(_sys._MEIPASS) / "models_cache" / "correction" / "qwen2.5-3b-q4.gguf"
        if bundled.exists():
            return str(bundled)
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            return os.path.join(local, "sherpa-onnx", "correction", "qwen2.5-3b-q4.gguf")
    return os.path.expanduser("~/.cache/sherpa-onnx/correction/qwen2.5-3b-q4.gguf")
```

Update the health endpoint correction fields:

```python
"correction_mode": settings_manager.get().correction.mode,
"correction_model_available": Path(_get_correction_model_path()).exists(),
"correction_model_path": _get_correction_model_path(),
```

Update the 3B model download endpoint to use ModelScope URL:

```python
@app.post("/api/models/correction/download")
async def trigger_correction_download(_: None = Depends(verify_token)) -> JSONResponse:
    model_path = _get_correction_model_path()
    if Path(model_path).exists():
        return JSONResponse({"status": "already_exists"})
    asyncio.create_task(_download_correction_model_bg(model_path))
    return JSONResponse({"status": "started"})

async def _download_correction_model_bg(model_path: str) -> None:
    import urllib.request
    url = "https://modelscope.cn/models/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/master/qwen2.5-3b-instruct-q4_k_m.gguf"
    dest = Path(model_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(urllib.request.urlretrieve, url, str(dest))
    print(f"[MODEL] 3B correction model downloaded to {dest}", flush=True)

@app.get("/api/models/correction/status")
async def correction_model_status(_: None = Depends(verify_token)) -> JSONResponse:
    model_path = _get_correction_model_path()
    exists = Path(model_path).exists()
    size_mb = Path(model_path).stat().st_size / 1024 / 1024 if exists else 0
    return JSONResponse({"exists": exists, "size_mb": round(size_mb, 1), "path": model_path})
```

Add `settings` import to the try/except import block at top of app.py.

**Step 2: Commit**

```bash
git add backend/app.py backend/settings.py
git commit -m "feat: add settings API and rewire correction engine initialization"
```

---

### Task 4: Update Pipeline for New CorrectionEngine

**Files:**
- Modify: `backend/pipeline.py`

**Step 1: Simplify pipeline check — remove has_model check**

The `correction_worker` in `pipeline.py` already has the fix from earlier (uses `correction_engine is not None` instead of `has_model()`). Verify it looks correct and keep the debug logging.

No code change needed if the fix from the earlier session is in place. Just verify.

**Step 2: Commit (if changed)**

---

### Task 5: Update download_models.py for 3B Model

**Files:**
- Modify: `scripts/download_models.py`

**Step 1: Update correction model URL and filename**

Change the correction model constants:

```python
CORRECTION_MODEL_URL = "https://modelscope.cn/models/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/master/qwen2.5-3b-instruct-q4_k_m.gguf"
CORRECTION_MODEL_NAME = "qwen2.5-3b-q4.gguf"
```

**Step 2: Commit**

```bash
git add scripts/download_models.py
git commit -m "feat: update correction model to Qwen2.5-3B Q4"
```

---

### Task 6: Frontend — Settings API Client

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1: Add settings types and API functions**

```typescript
// Types
export interface CorrectionConfig {
  mode: "none" | "local_3b" | "cloud_api";
  api_provider: "openai" | "anthropic" | "deepseek" | "custom";
  api_key: string;
  api_key_set: boolean;
  api_model: string;
  api_base_url: string;
}

export interface AppSettings {
  correction: CorrectionConfig;
}

export interface CorrectionModelStatus {
  exists: boolean;
  size_mb: number;
  path: string;
}

// API functions
export async function fetchSettings(): Promise<AppSettings> {
  await ensureBackendBase();
  const response = await apiClient.get<AppSettings>("/settings");
  return response.data;
}

export async function updateSettings(settings: { correction?: Partial<CorrectionConfig> }): Promise<AppSettings> {
  await ensureBackendBase();
  const response = await apiClient.post<AppSettings>("/settings", settings);
  return response.data;
}

export async function fetchCorrectionModelStatus(): Promise<CorrectionModelStatus> {
  await ensureBackendBase();
  const response = await apiClient.get<CorrectionModelStatus>("/models/correction/status");
  return response.data;
}

export async function triggerCorrectionModelDownload(): Promise<{ status: string }> {
  await ensureBackendBase();
  const response = await apiClient.post<{ status: string }>("/models/correction/download");
  return response.data;
}
```

**Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add settings and correction model API client"
```

---

### Task 7: Frontend — Settings Panel Component

**Files:**
- Create: `frontend/src/components/SettingsPanel.tsx`

**Step 1: Create SettingsPanel**

Build a slide-over or modal panel with three sections:

1. **Correction Mode** — radio group (Off / Local 3B / Cloud API)
2. **Local 3B section** — model download status + button (shown when local_3b selected)
3. **Cloud API section** — provider dropdown, API key, model name, base URL (shown when cloud_api selected)
4. **Hotwords section** — tag input (reuse HotwordSettings logic)

Key implementation details:
- Use `fetchSettings()` on mount to load current config
- `updateSettings()` on any change (debounced or on explicit save)
- API key field uses `type="password"`, shows placeholder if `api_key_set` is true
- Provider dropdown changes default model name (openai→gpt-4o-mini, anthropic→claude-sonnet-4-20250514, deepseek→deepseek-chat)
- Download button calls `triggerCorrectionModelDownload()`, polls `fetchCorrectionModelStatus()` for progress

The component should be a full-height slide-over from the right side, toggled by a gear icon in the header.

**Step 2: Commit**

```bash
git add frontend/src/components/SettingsPanel.tsx
git commit -m "feat: add SettingsPanel with correction config and hotwords"
```

---

### Task 8: Frontend — Integrate Settings into Layout

**Files:**
- Modify: `frontend/src/app/App.tsx`

**Step 1: Add gear icon and SettingsPanel to header**

Add a settings toggle button (gear icon from lucide-react) next to ThemeToggle in the header. When clicked, toggle the SettingsPanel slide-over.

```tsx
import { SettingsPanel } from "../components/SettingsPanel";
import { SettingsIcon } from "lucide-react";

// In AppShell:
const [showSettings, setShowSettings] = useState(false);

// In header, before ThemeToggle:
<button
  onClick={() => setShowSettings(!showSettings)}
  className="p-2 rounded-lg hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
>
  <SettingsIcon className="h-4 w-4" />
</button>

// After main content:
{showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
```

Remove the old HotwordSettings import if still present.

**Step 2: Commit**

```bash
git add frontend/src/app/App.tsx
git commit -m "feat: add settings gear icon and panel toggle to header"
```

---

### Task 9: Clean Up Old 0.5B Artifacts

**Files:**
- Delete old 0.5B model file if present
- Update `backend/backend.spec` hiddenimports to include `settings`
- Remove or update old correction model references

**Step 1: Clean up**

```bash
# Remove old 0.5B model
rm -f ~/.cache/sherpa-onnx/correction/qwen2.5-0.5b-q4.gguf

# Update backend.spec hiddenimports to include 'backend.settings'
```

Add `'backend.settings'` to hiddenimports in `backend/backend.spec`.

**Step 2: Install httpx if not present**

```bash
pip install httpx
```

**Step 3: Commit**

```bash
git add backend/backend.spec
git commit -m "chore: clean up 0.5B artifacts, add settings to PyInstaller"
```

---

### Task 10: Smoke Test

**Step 1: Start backend and verify settings API**

```bash
curl http://127.0.0.1:5179/api/settings | python -m json.tool
# Should return: {"correction": {"mode": "none", ...}}
```

**Step 2: Test settings update**

```bash
curl -X POST http://127.0.0.1:5179/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"correction": {"mode": "cloud_api", "api_provider": "deepseek", "api_key": "sk-test", "api_model": "deepseek-chat"}}'
```

**Step 3: Test transcription in each mode**

- `mode=none`: transcription works, no correction
- `mode=cloud_api` with valid key: transcription + correction
- `mode=local_3b` without model: graceful fallback

**Step 4: Test frontend settings panel**

- Gear icon visible in header
- Can switch modes
- API key saves and masks correctly
- Hotwords manageable

**Step 5: Commit**

```bash
git commit -m "test: verify settings panel and correction modes"
```

---

## Task Dependency Graph

```
Task 1 (settings.py)
  ↓
Task 2 (correction_engine.py rewrite)
  ↓
Task 3 (app.py endpoints + wiring)
  ↓
Task 4 (pipeline.py verify)
  ↓
Task 5 (download_models.py update)
  ↓
Task 6 (frontend API client)
  ↓
Task 7 (SettingsPanel component)
  ↓
Task 8 (App.tsx integration)
  ↓
Task 9 (cleanup)
  ↓
Task 10 (smoke test)
```

All tasks are sequential.
