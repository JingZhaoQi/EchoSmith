# Local ASR Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose and download local ASR models, including SenseVoice, Qwen3-ASR, and FunASR providers.

**Architecture:** Add a backend model catalog and optional provider adapters. Store selected model in transcription settings. Expose model statuses and download actions to the settings panel.

**Tech Stack:** Python/FastAPI/pytest, optional qwen-asr/funasr/modelscope/huggingface_hub, React/TypeScript/Tailwind/Vite.

---

### Task 1: Model Catalog

**Files:**
- Create: `backend/asr_models.py`
- Test: `backend/tests/test_asr_models.py`

- [x] Write failing tests for catalog IDs, default model, install status, and selected state.
- [x] Implement static model specs and an `ASRModelManager`.
- [x] Run `python3 -m pytest backend/tests/test_asr_models.py -q`.

### Task 2: Settings Selection

**Files:**
- Modify: `backend/settings.py`
- Test: `backend/tests/test_settings.py`

- [x] Add failing tests for `transcription.asr_model` default, persistence, and invalid fallback.
- [x] Add `asr_model` to `TranscriptionConfig`.
- [x] Run `python3 -m pytest backend/tests/test_settings.py -q`.

### Task 3: Optional Provider Adapters

**Files:**
- Create: `backend/asr_providers.py`
- Test: `backend/tests/test_asr_providers.py`

- [x] Write tests for Qwen3-ASR and FunASR missing dependency errors.
- [x] Implement provider dispatch and result normalization.
- [x] Run `python3 -m pytest backend/tests/test_asr_providers.py -q`.

### Task 4: Backend API and Engine Routing

**Files:**
- Modify: `backend/app.py`
- Modify: `backend/asr_engine.py`
- Test: `backend/tests/test_asr_engine.py`

- [x] Add tests for model option sanitization and external model routing.
- [x] Add `/api/asr/models`, `/api/asr/models/{model_id}/download`, and model selection plumbing.
- [x] Run targeted backend tests.

### Task 5: Settings UI

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/SettingsPanel.tsx`

- [x] Add API types and functions for ASR model statuses/download.
- [x] Add local model picker and download controls.
- [x] Run `npm run build` in `frontend`.

### Task 6: Final Verification

- [x] Run `python3 -m pytest backend/tests -q`.
- [x] Run `npm run build` in `frontend`.
- [x] Start backend/frontend and verify settings UI in browser.
