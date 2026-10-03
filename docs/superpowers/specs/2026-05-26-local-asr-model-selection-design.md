# EchoSmith Local ASR Model Selection Design

## Goal

Let users choose and download local ASR models from EchoSmith settings. The supported local families are:

- SenseVoice via sherpa-onnx: the stable default path.
- Qwen3-ASR: optional high-accuracy multilingual local provider.
- FunASR: optional local provider for Paraformer/SenseVoice/Fun-ASR-Nano style pipelines.

## Current Model Research

Qwen3-ASR official repository describes Qwen3-ASR-0.6B and Qwen3-ASR-1.7B as all-in-one ASR models supporting language identification and ASR for 52 languages and dialects, with both streaming and offline inference. It provides a `qwen-asr` Python package and model downloads through ModelScope or Hugging Face.

FunASR official documentation describes a Python toolkit and service interface that can perform ASR, VAD, punctuation restoration, timestamps, speaker diarization, emotion detection, and OpenAI-compatible transcription. It supports `funasr.AutoModel(...)`, local/server deployment, and models including SenseVoiceSmall, Paraformer, Fun-ASR-Nano, and Qwen3-ASR integrations.

sherpa-onnx SenseVoice remains the lowest-risk bundled/default engine. A 2025-09-09 SenseVoice model exists, but it is primarily Cantonese-tuned and not a broad Mandarin accuracy replacement.

References:

- https://github.com/QwenLM/Qwen3-ASR
- https://github.com/modelscope/FunASR
- https://www.funasr.com/
- https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html

## Product Behavior

The settings panel gains a "本地识别模型" section:

- Shows model family, accuracy/speed intent, size hint, install status, and dependency note.
- Users can select any installed model as the default for future tasks.
- Users can start a model download from the UI.
- Download state is visible in the model list.
- If a selected optional provider is missing Python dependencies, transcription fails with a clear message instead of crashing the backend.

## Model Catalog

Initial catalog:

| ID | Provider | Label | Role |
| --- | --- | --- | --- |
| `sensevoice-sherpa-2024` | `sherpa` | SenseVoice INT8 | Stable default |
| `qwen3-asr-0.6b` | `qwen3` | Qwen3-ASR 0.6B | Local high-accuracy balanced option |
| `qwen3-asr-1.7b` | `qwen3` | Qwen3-ASR 1.7B | Higher-accuracy, heavier option |
| `funasr-sensevoice-small` | `funasr` | FunASR SenseVoiceSmall | FunASR integrated SenseVoice |
| `funasr-paraformer-zh` | `funasr` | FunASR Paraformer zh | Chinese ASR with hotword support |
| `funasr-nano` | `funasr` | Fun-ASR-Nano | Multilingual FunASR route |

## Architecture

```text
SettingsPanel
  -> GET /api/asr/models
  -> POST /api/asr/models/{id}/download
  -> POST /api/settings { transcription: { asr_model } }

backend/asr_models.py
  -> static model catalog
  -> install status
  -> optional ModelScope/Hugging Face snapshot download

backend/asr_providers.py
  -> qwen_asr adapter
  -> funasr adapter
  -> clear dependency/model errors

backend/asr_engine.py
  -> SenseVoice path unchanged for sherpa model
  -> external provider path for Qwen3-ASR/FunASR
  -> shared transcript enhancer and optional correction
```

## Download Strategy

The UI starts downloads through the backend, but the backend treats Qwen3-ASR and FunASR packages as optional. Downloading model weights should use ModelScope first where available and Hugging Face as fallback. If neither downloader dependency exists, the response should provide an actionable dependency message.

EchoSmith should not install heavy Python packages automatically inside the app without explicit packaging work. The optional provider error should name the missing package, for example `qwen-asr` or `funasr`.

## Non-Goals

- No benchmark automation in this stage.
- No automatic migration away from SenseVoice.
- No bundled Qwen/FunASR weights in the app package.
- No GPU/Metal optimization work in this stage.

## Verification

- Unit tests cover catalog contents, selection validation, settings persistence, and provider dependency errors.
- Backend test suite passes.
- Frontend build passes.
- Browser check confirms the settings panel shows the local model list and download/select controls.
