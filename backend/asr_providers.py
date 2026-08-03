"""Optional local ASR provider adapters for Qwen3-ASR and FunASR."""
from __future__ import annotations

from pathlib import Path
import re
import threading
from typing import Callable

try:
    from asr_models import ASRModelManager, get_model_spec
    from asr_engine import Segment, TranscriptionResult
except ImportError:
    from .asr_models import ASRModelManager, get_model_spec
    from .asr_engine import Segment, TranscriptionResult


class OptionalASRDependencyError(RuntimeError):
    """Raised when an optional ASR provider dependency is not installed."""


ProviderProgressCallback = Callable[[float, str, str], None]
ProviderSegmentsCallback = Callable[[list], None]

_QWEN3_CHUNK_SECONDS = 60
_FUNASR_CHUNK_SECONDS = 30
_QWEN3_MODEL_CACHE: dict[str, object] = {}
_FUNASR_MODEL_CACHE: dict[str, object] = {}
_QWEN3_MODEL_LOCK = threading.Lock()
_FUNASR_MODEL_LOCK = threading.Lock()
_QWEN3_INFERENCE_LOCK = threading.Lock()
_FUNASR_INFERENCE_LOCK = threading.Lock()
_ASR_METADATA_TOKEN_RE = re.compile(r"<\|[^<>|]+\|>")


def transcribe_with_external_provider(
    model_id: str,
    audio_path: Path,
    duration_ms: int,
    language: str = "zh",
    hotwords: list[str] | None = None,
    model_manager: ASRModelManager | None = None,
    progress_cb: ProviderProgressCallback | None = None,
    cancelled_checker: Callable[[], bool] | None = None,
    segments_cb: ProviderSegmentsCallback | None = None,
) -> TranscriptionResult:
    spec = get_model_spec(model_id)
    manager = model_manager or ASRModelManager()
    model_path = manager.model_dir(model_id)
    hotwords = hotwords or []

    if spec.provider == "qwen3":
        return _transcribe_qwen3(
            spec.repo_id,
            model_path,
            audio_path,
            duration_ms,
            language,
            progress_cb,
            cancelled_checker,
            segments_cb,
        )
    if spec.provider == "funasr":
        return _transcribe_funasr(
            spec.repo_id,
            model_path,
            audio_path,
            duration_ms,
            hotwords,
            progress_cb,
            cancelled_checker,
            segments_cb,
        )
    raise RuntimeError(f"模型 {model_id} 不是外部 ASR provider")


def _transcribe_qwen3(
    repo_id: str,
    model_path: Path,
    audio_path: Path,
    duration_ms: int,
    language: str,
    progress_cb: ProviderProgressCallback | None,
    cancelled_checker: Callable[[], bool] | None,
    segments_cb: ProviderSegmentsCallback | None = None,
) -> TranscriptionResult:
    try:
        from qwen_asr import Qwen3ASRModel
    except Exception as exc:  # noqa: BLE001
        raise OptionalASRDependencyError(
            "Qwen3-ASR 需要安装可选依赖 qwen-asr。请先安装 qwen-asr，"
            "并在设置里下载对应模型。"
        ) from exc

    model_ref = str(model_path) if model_path.exists() and any(model_path.iterdir()) else repo_id
    model = _load_qwen3_model(Qwen3ASRModel, model_ref, progress_cb)
    return _transcribe_qwen3_chunks(
        model,
        audio_path,
        duration_ms,
        _qwen3_language(language),
        progress_cb,
        cancelled_checker,
        segments_cb,
    )


def _load_qwen3_model(
    model_cls: type,
    model_ref: str,
    progress_cb: ProviderProgressCallback | None,
) -> object:
    cached = _QWEN3_MODEL_CACHE.get(model_ref)
    if cached is not None:
        if progress_cb:
            progress_cb(0.08, "本地识别模型已就绪", "")
        return cached

    with _QWEN3_MODEL_LOCK:
        cached = _QWEN3_MODEL_CACHE.get(model_ref)
        if cached is not None:
            if progress_cb:
                progress_cb(0.08, "本地识别模型已就绪", "")
            return cached

        if progress_cb:
            progress_cb(0.02, "首次加载本地识别模型", "")
        model = model_cls.from_pretrained(model_ref, max_inference_batch_size=1)
        _QWEN3_MODEL_CACHE[model_ref] = model
        if progress_cb:
            progress_cb(0.12, "本地识别模型已加载", "")
        return model


def _transcribe_qwen3_chunks(
    model: object,
    audio_path: Path,
    duration_ms: int,
    language: str | None,
    progress_cb: ProviderProgressCallback | None,
    cancelled_checker: Callable[[], bool] | None,
    segments_cb: ProviderSegmentsCallback | None = None,
) -> TranscriptionResult:
    chunks = _read_audio_chunks(audio_path, _QWEN3_CHUNK_SECONDS)
    if not chunks:
        return TranscriptionResult(text="", segments=[], duration_ms=duration_ms)

    all_texts: list[str] = []
    all_segments: list[Segment] = []
    total = len(chunks)

    for idx, (samples, sample_rate, start_ms, end_ms) in enumerate(chunks):
        if cancelled_checker and cancelled_checker():
            break

        partial = "\n".join(all_texts).strip()
        if progress_cb:
            progress_cb(
                0.12 + 0.78 * (idx / total),
                f"Qwen3-ASR 转写中 {idx + 1}/{total}",
                partial,
            )

        with _QWEN3_INFERENCE_LOCK:
            result = model.transcribe((samples, sample_rate), language=language)

        text = _extract_text(result)
        if text:
            all_texts.append(text)
            segment = Segment(
                index=len(all_segments),
                start_ms=start_ms,
                end_ms=min(end_ms, duration_ms),
                text=text,
            )
            all_segments.append(segment)
            if segments_cb:
                segments_cb([segment])

        partial = "\n".join(all_texts).strip()
        if progress_cb:
            progress_cb(
                0.12 + 0.78 * ((idx + 1) / total),
                f"Qwen3-ASR 转写中 {idx + 1}/{total}",
                partial,
            )

    final_text = "\n".join(all_texts).strip()
    return TranscriptionResult(text=final_text, segments=all_segments, duration_ms=duration_ms)


def _read_audio_chunks(audio_path: Path, chunk_seconds: int) -> list[tuple[object, int, int, int]]:
    try:
        import numpy as np
        import soundfile as sf
    except Exception as exc:  # noqa: BLE001
        raise OptionalASRDependencyError(
            "本地 ASR 分块转写需要 soundfile 和 numpy。请重新安装依赖后再试。"
        ) from exc

    samples, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=False)
    if getattr(samples, "ndim", 1) > 1:
        samples = np.mean(samples, axis=1).astype("float32")
    samples = np.ascontiguousarray(samples, dtype=np.float32)

    total_samples = len(samples)
    if total_samples <= 0:
        return []

    chunk_size = max(1, int(sample_rate * chunk_seconds))
    chunks: list[tuple[object, int, int, int]] = []
    for start in range(0, total_samples, chunk_size):
        end = min(start + chunk_size, total_samples)
        chunks.append(
            (
                np.ascontiguousarray(samples[start:end], dtype=np.float32),
                int(sample_rate),
                int(start / sample_rate * 1000),
                int(end / sample_rate * 1000),
            )
        )
    return chunks


def _qwen3_language(language: str | None) -> str | None:
    if language == "zh":
        return "Chinese"
    if language == "en":
        return "English"
    return language


def _transcribe_funasr(
    repo_id: str,
    model_path: Path,
    audio_path: Path,
    duration_ms: int,
    hotwords: list[str],
    progress_cb: ProviderProgressCallback | None,
    cancelled_checker: Callable[[], bool] | None = None,
    segments_cb: ProviderSegmentsCallback | None = None,
) -> TranscriptionResult:
    try:
        from funasr import AutoModel
    except Exception as exc:  # noqa: BLE001
        raise OptionalASRDependencyError(
            "FunASR 模型需要安装可选依赖 funasr。请先安装 funasr，"
            "并在设置里下载对应模型。"
        ) from exc

    model_ref = str(model_path) if model_path.exists() and any(model_path.iterdir()) else repo_id
    model = _load_funasr_model(AutoModel, model_ref, progress_cb)
    return _transcribe_funasr_chunks(
        model,
        audio_path,
        duration_ms,
        hotwords,
        progress_cb,
        cancelled_checker,
        segments_cb,
    )


def _load_funasr_model(
    model_cls: type,
    model_ref: str,
    progress_cb: ProviderProgressCallback | None,
) -> object:
    cached = _FUNASR_MODEL_CACHE.get(model_ref)
    if cached is not None:
        if progress_cb:
            progress_cb(0.08, "本地识别模型已就绪", "")
        return cached

    with _FUNASR_MODEL_LOCK:
        cached = _FUNASR_MODEL_CACHE.get(model_ref)
        if cached is not None:
            if progress_cb:
                progress_cb(0.08, "本地识别模型已就绪", "")
            return cached

        if progress_cb:
            progress_cb(0.02, "首次加载本地识别模型", "")
        model = model_cls(model=model_ref, disable_pbar=True, disable_update=True)
        _FUNASR_MODEL_CACHE[model_ref] = model
        if progress_cb:
            progress_cb(0.12, "本地识别模型已加载", "")
        return model


def _transcribe_funasr_chunks(
    model: object,
    audio_path: Path,
    duration_ms: int,
    hotwords: list[str],
    progress_cb: ProviderProgressCallback | None,
    cancelled_checker: Callable[[], bool] | None,
    segments_cb: ProviderSegmentsCallback | None = None,
) -> TranscriptionResult:
    chunks = _read_audio_chunks(audio_path, _FUNASR_CHUNK_SECONDS)
    if not chunks:
        return TranscriptionResult(text="", segments=[], duration_ms=duration_ms)

    all_texts: list[str] = []
    all_segments: list[Segment] = []
    total = len(chunks)
    hotword_text = " ".join(hotwords[:200]) if hotwords else ""

    for idx, (samples, _sample_rate, start_ms, end_ms) in enumerate(chunks):
        if cancelled_checker and cancelled_checker():
            break

        partial = "\n".join(all_texts).strip()
        if progress_cb:
            progress_cb(
                0.12 + 0.78 * (idx / total),
                f"FunASR 转写中 {idx + 1}/{total}",
                partial,
            )

        kwargs = {"input": samples}
        if hotword_text:
            kwargs["hotword"] = hotword_text

        with _FUNASR_INFERENCE_LOCK:
            result = model.generate(**kwargs)

        text = _extract_text(result)
        if text:
            all_texts.append(text)
            segment = Segment(
                index=len(all_segments),
                start_ms=start_ms,
                end_ms=min(end_ms, duration_ms),
                text=text,
            )
            all_segments.append(segment)
            if segments_cb:
                segments_cb([segment])

        partial = "\n".join(all_texts).strip()
        if progress_cb:
            progress_cb(
                0.12 + 0.78 * ((idx + 1) / total),
                f"FunASR 转写中 {idx + 1}/{total}",
                partial,
            )

    final_text = "\n".join(all_texts).strip()
    return TranscriptionResult(text=final_text, segments=all_segments, duration_ms=duration_ms)


def _extract_text(result: object) -> str:
    if isinstance(result, str):
        return _clean_asr_text(result)
    if isinstance(result, dict):
        return _clean_asr_text(str(result.get("text", "")))
    if isinstance(result, list) and result:
        texts = [_extract_text(item) for item in result]
        return "\n".join(text for text in texts if text).strip()
    text = getattr(result, "text", None)
    if text is not None:
        return _clean_asr_text(str(text))
    return _clean_asr_text(str(result or ""))


def _clean_asr_text(text: str) -> str:
    cleaned = _ASR_METADATA_TOKEN_RE.sub("", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"[ \t]*\n[ \t]*", "\n", cleaned)
    return cleaned.strip()
