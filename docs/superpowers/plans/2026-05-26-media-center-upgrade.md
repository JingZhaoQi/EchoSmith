# Media Center Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-stage EchoSmith media center upgrade with a Liquid Glass macOS UI, stronger task library, and stabilized backend tests.

**Architecture:** Keep the existing React/Tauri/FastAPI architecture. Add focused frontend components around the existing task store instead of rewriting backend task semantics. Keep backend changes narrow: downloader hardening and correction test alignment.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Zustand, TanStack Query, FastAPI, pytest, yt-dlp.

---

### Task 1: Product Design Artifacts

**Files:**
- Create: `docs/superpowers/specs/2026-05-26-media-center-upgrade-design.md`
- Create: `docs/superpowers/plans/2026-05-26-media-center-upgrade.md`

- [x] **Step 1: Save the design spec**

Write the approved media center scope, non-goals, information architecture, visual system, functional requirements, and verification checklist.

- [x] **Step 2: Save this implementation plan**

Create a concrete execution checklist that keeps the work scoped to the first-stage media center.

### Task 2: Backend Stabilization

**Files:**
- Modify: `backend/tests/test_correction_engine.py`
- Modify: `backend/url_downloader.py`
- Modify: `backend/requirements.txt`
- Test: `backend/tests/test_url_downloader.py`

- [x] **Step 1: Align correction tests to cloud API mode**

Replace outdated local `load_model()` expectations with mocked cloud API calls through `httpx.Client`.

- [x] **Step 2: Keep Bilibili downloader hardening**

Ensure `extract_video_title`, `download_audio`, and `_ytdlp_download_media` apply Bilibili headers, socket timeout, and finite retries.

- [x] **Step 3: Run backend tests**

Run `python3 -m pytest backend/tests` and verify the correction, downloader, hotword, and pipeline tests pass.

### Task 3: Liquid Glass Design System

**Files:**
- Modify: `frontend/src/styles/tailwind.css`
- Modify: `frontend/src/components/ui/card.tsx`
- Modify: `frontend/src/components/ui/button.tsx`
- Modify: `frontend/src/components/ui/progress.tsx`
- Modify: `frontend/src/components/ui/aurora-background.tsx`

- [x] **Step 1: Add glass tokens and utility classes**

Define stable classes for app background, glass surfaces, sidebar glass, toolbar glass, status pills, and icon buttons using WKWebView-safe CSS.

- [x] **Step 2: Update shared UI primitives**

Make `Card`, `Button`, and `Progress` use the new visual language while preserving their APIs.

### Task 4: Media Center Shell

**Files:**
- Modify: `frontend/src/app/App.tsx`
- Create: `frontend/src/components/TaskLibraryPanel.tsx`
- Create: `frontend/src/components/WorkspaceOverview.tsx`

- [x] **Step 1: Add task library**

Create a persistent left panel that lists tasks, counts statuses, shows progress, and selects the active task.

- [x] **Step 2: Add workspace overview**

Create a compact active-task overview with source, status, progress, error, and current message.

- [x] **Step 3: Recompose the app shell**

Use a three-region layout: task library, source center, review workspace.

### Task 5: Source and Review Workflow Polish

**Files:**
- Modify: `frontend/src/components/BatchTaskComposer.tsx`
- Modify: `frontend/src/components/UrlTaskComposer.tsx`
- Modify: `frontend/src/components/ResultPanel.tsx`
- Modify: `frontend/src/components/CorrectionPanel.tsx`
- Modify: `frontend/src/components/TaskStreamPanel.tsx`

- [x] **Step 1: Restyle intake panels**

Make local files and online URL intake look like one source center with compact glass controls.

- [x] **Step 2: Restyle review panels**

Improve raw and corrected text empty states, status labels, copy/export controls, and failure visibility.

- [x] **Step 3: Restyle task controls**

Make pause/resume/skip/stop/clear readable inside the media center without relying on a tiny select as the main history UI.

### Task 6: Verification

**Files:**
- Build and test outputs only.

- [x] **Step 1: Run backend tests**

Run `python3 -m pytest backend/tests`.

- [x] **Step 2: Run frontend build**

Run `npm run build` from `frontend`.

- [x] **Step 3: Open browser visual check**

Run the local dev server, open the app, and verify the desktop UI is not blank, does not overlap, and visibly uses glass surfaces.
