# Three-Stage UI Redesign

## Layout

Left narrow column (audio source + controls) + Right side split vertically (ASR results top / correction results bottom).

```
┌──────────────────────┬──────────────────────────────────┐
│  Audio Source (slim)  │  ASR Results Panel               │
│  - Batch/URL tabs     │  - Progress bar                  │
│  - Drop zone          │  - Raw transcription text        │
│  - Export format       │                                  │
│  - File list          ├──────────────────────────────────┤
│                       │  Correction Results Panel        │
│  Controls:            │  - Progress bar / status         │
│  - Start Transcribe   │  - Corrected text                │
│  - Pause / Skip       │  - Or "waiting" / "click start"  │
│  - Stop All / Clear   │                                  │
│                       ├──────────────────────────────────┤
│  ⚙ Correction Setup  │  Export: Copy | TXT | SRT | JSON │
└──────────────────────┴──────────────────────────────────┘
```

## Key Decisions

- Left panel: audio input + file list + all control buttons + settings entry
- Right top: ASR raw results with own progress bar
- Right bottom: correction results with own progress bar
- Export buttons at bottom export corrected text (fallback to raw if no correction)
- Correction panel doubles as standalone feature — can import text to correct
- Control buttons below "开始转写": pause, skip, stop all, clear
- Settings button opens correction config slide-over (same as current)
