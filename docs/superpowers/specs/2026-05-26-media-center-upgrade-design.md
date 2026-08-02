# EchoSmith Media Center Upgrade Design

## Goal

Upgrade EchoSmith from a single transcription form into a local media processing center for downloading, queuing, transcribing, correcting, reviewing, and exporting audio/video content.

## Product Direction

EchoSmith should feel like a focused macOS desktop production tool. The first screen is the actual workspace: task library, media source intake, processing controls, transcript review, correction review, and export actions. It should not feel like a web landing page or a stack of disconnected cards.

## First-Stage Scope

This implementation builds the first production-ready slice of the media center:

- A macOS-style Liquid Glass shell with a translucent header, glass sidebar, glass workspace panels, stable spacing, and visible light/dark mode treatment.
- A task and history library that makes existing and new jobs visible, selectable, and actionable.
- A media source center that keeps local batch files and online video URLs in one intake area.
- Stronger online-platform handling, including the Bilibili/b23.tv yt-dlp options already verified locally.
- A three-stage review workspace: raw recognition, corrected text, and export/copy actions.
- Stabilized backend tests for the current cloud correction architecture.

## Explicit Non-Goals

This first stage does not add cloud sync, accounts, collaboration, audio editing, translation, diarization, or chapter generation. Those are later product layers after the local queue and review loop are stable.

## Information Architecture

The main window is divided into four persistent regions:

1. Header toolbar: product identity, backend/correction status, settings, theme.
2. Left task library: active queue and history, status counts, selection.
3. Source center: local batch intake and online media intake with download/transcribe choices.
4. Review workspace: raw ASR result, corrected result, copy/export controls, empty/error states.

The active task is the center of the experience. All panels derive their displayed state from the active task and the global task store.

## Visual System

The visual language uses macOS-inspired Liquid Glass, implemented with CSS that works in Tauri WKWebView:

- Use rgba/hex and backdrop filters, not oklch/color-mix/container queries.
- Glass surfaces must have visible background opacity, blur, border, and inset highlight.
- The page background must include subtle soft gradients so backdrop blur has real material behind it.
- Buttons and controls use compact icon-first macOS sizing.
- The UI should remain dense enough for repeated work, not a marketing hero layout.

## Functional Requirements

- Users can add local files, drag files, choose export formats, and start a batch from the media center.
- Users can paste online links, transcribe online video audio, or save downloaded video/audio to Downloads.
- Users can see all tasks in a persistent library with source name, status, progress, and time.
- Users can pause/resume/skip/stop/clear from the task controls.
- Users can copy corrected text and export TXT/SRT/JSON from completed or paused tasks.
- Existing failed states must explain what happened instead of leaving a blank panel.
- Bilibili and b23.tv links must use browser-like yt-dlp headers, timeout, and retry options.
- Correction tests must match the current cloud API correction engine.

## Verification

- Backend targeted tests must pass for downloader, pipeline, hotwords, and correction engine.
- Frontend build must pass.
- The local UI must be opened in the browser after implementation and checked at desktop size.
- The visual check must confirm that the app is not blank, text does not overlap, glass effects are visible, and primary workflows are discoverable.
