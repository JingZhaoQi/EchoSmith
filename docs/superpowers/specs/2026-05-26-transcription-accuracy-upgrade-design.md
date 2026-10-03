# EchoSmith Transcription Accuracy Upgrade Design

## Goal

Improve EchoSmith's batch media transcription accuracy without adding real-time voice input. The product remains a local media transcription center, but the transcription pipeline should borrow the practical strengths of modern voice input products: cleaner audio input, contextual vocabulary, domain-aware correction, punctuation/number cleanup, and conservative second-pass recovery.

## Research Summary

Modern voice input products do not rely on streaming alone for accuracy. The useful patterns for EchoSmith are:

- Context and user vocabulary: Doubao Input Method describes context-aware association and voice correction that adapts to user habits.
- Audio-file ASR features: Volcengine Doubao recording-file recognition supports non-real-time audio transcription with automatic punctuation, semantic smoothing, number normalization, smart sentence splitting, timestamps, hotword correction, replacement words, and context input.
- Local/cloud choice: Shandianshuo presents local and cloud ASR as configurable choices, with automatic structuring and spoken-filler filtering.
- Current local model route: sherpa-onnx has a newer SenseVoice package dated 2025-09-09, but its documented benefit is Cantonese fine-tuning and it explicitly does not support punctuation. It should not replace the current Mandarin-focused default blindly.
- Stronger future local route: Qwen3-ASR provides 0.6B/1.7B models with 52 languages/dialects and long-audio support, but it is a heavier dependency than the current sherpa-onnx SenseVoice path. It should be introduced through a provider boundary after the pipeline is stable.
- Practical open-source stack: FunASR/Paraformer provides ASR, VAD, punctuation restoration, timestamps, hotwords, and speaker diarization, but it adds PyTorch/model management complexity.

References:

- https://apps.apple.com/cn/app/id6752316550
- https://shandianshuo.cn/
- https://www.volcengine.com/docs/6561/1354871?lang=zh
- https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/sense-voice/pretrained.rst
- https://github.com/QwenLM/Qwen3-ASR
- https://www.funasr.com/

## First-Stage Scope

This stage implements a local accuracy enhancement layer around the existing SenseVoice pipeline:

1. Add global transcription settings:
   - Accuracy mode: `fast`, `balanced`, `accurate`.
   - Domain profile: `general`, `sermon`, `academic`, `meeting`, `tech`.
2. Add deterministic transcript enhancement:
   - Remove artificial spaces between Chinese segments.
   - Normalize spacing around Chinese punctuation.
   - Apply domain-specific replacement rules for common ASR homophone errors.
   - Apply light spoken-filler cleanup in balanced/accurate modes.
3. Improve correction prompts:
   - Include accuracy mode and domain profile.
   - Keep the current conservative behavior: do not rewrite content.
4. Seed useful built-in domain hotwords, especially for sermon/theology and technical speech.
5. Add mild optional audio normalization in balanced/accurate modes during ffmpeg conversion.
6. Expose settings in the existing settings panel so users can select accuracy behavior without changing each task manually.

## Explicit Non-Goals

- No microphone capture or real-time input mode.
- No immediate hard dependency on Qwen3-ASR, FunASR, or cloud recording-file ASR.
- No automatic upload to cloud ASR without explicit user configuration.
- No aggressive rewriting, summarization, translation, diarization, or chapter generation in this stage.

## Architecture

The pipeline becomes:

```text
media file / URL audio
  -> ffmpeg normalization according to accuracy mode
  -> SenseVoice ASR with VAD
  -> deterministic TranscriptEnhancer
  -> optional cloud LLM correction with domain context
  -> deterministic TranscriptEnhancer again
  -> task result / TXT / SRT / JSON export
```

The first enhancer pass fixes obvious structured issues before the LLM sees the text. The second pass keeps output formatting stable after correction.

## Backend Components

### `backend/transcript_enhancer.py`

Owns deterministic, testable post-processing:

- `EnhancementOptions`
- `enhance_segments(segments, options)`
- `enhance_text(text, options)`
- `get_domain_profile(profile_id)`

This module must not call external APIs or load ASR models.

### `backend/settings.py`

Adds:

```python
@dataclass
class TranscriptionConfig:
    accuracy_mode: str = "balanced"
    domain_profile: str = "general"
```

The settings snapshot includes `transcription` next to `correction`.

### `backend/asr_engine.py`

Adds:

- `set_transcription_options(accuracy_mode, domain_profile)`
- Optional ffmpeg audio filter for balanced/accurate modes.
- Enhancer pass before and after correction.

### `backend/correction_engine.py`

Adds optional correction context fields:

- `accuracy_mode`
- `domain_profile`

The prompt should explain the domain and request conservative correction only.

## Frontend Components

### `frontend/src/components/SettingsPanel.tsx`

Add a "转写准确率" section:

- Accuracy segmented control:
  - 快速: shortest processing, least post-processing.
  - 均衡: default; deterministic cleanup + conservative correction.
  - 高准确率: stronger cleanup and audio normalization; may be slower.
- Domain select:
  - 通用媒体
  - 讲道/神学
  - 学术讲座
  - 会议访谈
  - 编程技术

## Model Strategy

Default model remains current SenseVoice 2024-07-17 via sherpa-onnx for now. The 2025-09-09 SenseVoice model is not a general Mandarin upgrade because it is Cantonese fine-tuned and lacks punctuation support. The next model-provider candidate should be Qwen3-ASR 0.6B for local high-accuracy mode, evaluated in a separate stage after the provider interface is introduced.

Cloud recording-file ASR, especially Doubao recording-file recognition, should be treated as an optional high-accuracy provider because it matches EchoSmith's non-real-time media workflow and includes hotword/context features. It requires explicit user API credentials and cost/privacy disclosure.

## Verification

- Unit tests for transcript enhancement.
- Unit tests for transcription settings persistence.
- Existing backend tests remain passing.
- Frontend build remains passing.
- Browser check confirms the settings panel exposes accuracy mode and domain profile without blank screens or layout overlap.
