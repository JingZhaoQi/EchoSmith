# Transcription Accuracy Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve EchoSmith batch media transcription accuracy by adding a local deterministic enhancement layer, transcription settings, and domain-aware correction context.

**Architecture:** Keep SenseVoice as the default ASR provider. Add settings-driven audio normalization and deterministic transcript enhancement before and after optional LLM correction. Expose accuracy mode and domain profile in the settings UI.

**Tech Stack:** Python/FastAPI/sherpa-onnx/pytest, React/TypeScript/Tailwind/Vite.

---

### Task 1: Transcript Enhancer

**Files:**
- Create: `backend/transcript_enhancer.py`
- Test: `backend/tests/test_transcript_enhancer.py`

- [ ] **Step 1: Write failing tests**

Cover:
- Chinese segment spaces are removed.
- Spaces before punctuation are removed.
- Sermon profile replaces common ASR homophone errors such as `岛高尔` -> `祷告`.
- Fast mode skips filler cleanup.
- Balanced mode removes standalone filler tokens conservatively.

- [ ] **Step 2: Run tests and confirm failure**

Run: `python3 -m pytest backend/tests/test_transcript_enhancer.py -q`

- [ ] **Step 3: Implement enhancer**

Implement:
- `EnhancementOptions`
- `SegmentLike`
- `enhance_text`
- `enhance_segments`
- domain profiles for `general`, `sermon`, `academic`, `meeting`, `tech`

- [ ] **Step 4: Run targeted tests**

Run: `python3 -m pytest backend/tests/test_transcript_enhancer.py -q`

### Task 2: Settings Persistence

**Files:**
- Modify: `backend/settings.py`
- Test: `backend/tests/test_settings.py`

- [ ] **Step 1: Write failing tests**

Cover:
- default `transcription.accuracy_mode == "balanced"`
- default `transcription.domain_profile == "general"`
- updating transcription settings persists and reloads
- invalid values fall back to safe defaults

- [ ] **Step 2: Run tests and confirm failure**

Run: `python3 -m pytest backend/tests/test_settings.py -q`

- [ ] **Step 3: Implement settings changes**

Add `TranscriptionConfig`, load/save/snapshot support, and `update_transcription()`.

- [ ] **Step 4: Run targeted tests**

Run: `python3 -m pytest backend/tests/test_settings.py -q`

### Task 3: Pipeline Integration

**Files:**
- Modify: `backend/asr_engine.py`
- Modify: `backend/app.py`
- Modify: `backend/correction_engine.py`
- Test: `backend/tests/test_correction_engine.py`
- Test: `backend/tests/test_asr_engine.py`

- [ ] **Step 1: Write failing tests**

Cover:
- correction prompt includes domain/accuracy context.
- ASR engine chooses no ffmpeg filter in fast mode.
- ASR engine chooses a mild audio filter in balanced/accurate modes.

- [ ] **Step 2: Run tests and confirm failure**

Run: `python3 -m pytest backend/tests/test_correction_engine.py backend/tests/test_asr_engine.py -q`

- [ ] **Step 3: Implement pipeline changes**

Add `set_transcription_options()` to `ASREngine`, enhancer calls around correction, app settings update handling, and correction prompt context.

- [ ] **Step 4: Run targeted tests**

Run: `python3 -m pytest backend/tests/test_correction_engine.py backend/tests/test_asr_engine.py -q`

### Task 4: Default Hotwords

**Files:**
- Modify: `backend/default_hotwords.json`
- Test: `backend/tests/test_hotwords.py`

- [ ] **Step 1: Write or adjust tests**

Verify the default file is valid JSON and includes useful domain terms.

- [ ] **Step 2: Update built-in hotwords**

Seed sermon/theology and technical terms without making the list too large.

- [ ] **Step 3: Run hotword tests**

Run: `python3 -m pytest backend/tests/test_hotwords.py -q`

### Task 5: Frontend Settings UI

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/SettingsPanel.tsx`

- [ ] **Step 1: Add TypeScript API types**

Add `TranscriptionConfig` and include it in `AppSettings`.

- [ ] **Step 2: Add settings controls**

Add accuracy mode and domain profile controls to the existing settings panel.

- [ ] **Step 3: Build frontend**

Run: `npm run build` in `frontend`.

### Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run backend test suite**

Run: `python3 -m pytest backend/tests`

- [ ] **Step 2: Run frontend build**

Run: `npm run build` in `frontend`.

- [ ] **Step 3: Open local UI in browser**

Start backend and frontend, open `http://127.0.0.1:5173/`, verify nonblank UI and settings controls.
