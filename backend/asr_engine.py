"""ASR engine using sherpa-onnx for fast SenseVoice inference."""

from __future__ import annotations

import asyncio
import os
import platform
import re
import subprocess
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import sherpa_onnx

try:
    from transcript_enhancer import EnhancementOptions, enhance_segments, enhance_text
    from asr_models import DEFAULT_ASR_MODEL_ID, is_sherpa_model, sanitize_model_id
except ImportError:
    from .transcript_enhancer import EnhancementOptions, enhance_segments, enhance_text
    from .asr_models import DEFAULT_ASR_MODEL_ID, is_sherpa_model, sanitize_model_id


def _subprocess_kwargs() -> dict:
    """Return extra kwargs for subprocess.run() to work reliably on Windows.

    On Windows GUI apps (e.g. launched via Tauri with CREATE_NO_WINDOW),
    child processes need:
      - CREATE_NO_WINDOW to avoid console window flash / allocation failure
      - stdin=DEVNULL because ffmpeg reads stdin by default and a missing
        console makes stdin unavailable, causing hangs
      - explicit encoding='utf-8' with errors='replace' because the default
        text=True uses the system code page (cp936 on Chinese Windows) which
        can choke on ffmpeg's UTF-8 output
    """
    kwargs: dict = {
        "stdin": subprocess.DEVNULL,
        "capture_output": True,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if platform.system() == "Windows":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW  # 0x08000000
    return kwargs


MODEL_CARD = "SenseVoice INT8 (sherpa-onnx)"
VALID_ACCURACY_MODES = {"fast", "balanced", "accurate"}
VALID_DOMAIN_PROFILES = {"general", "sermon", "academic", "meeting", "tech"}

# Default model directory (platform-aware, matches download_models.py)
if platform.system() == "Windows":
    _local_app_data = os.environ.get("LOCALAPPDATA", "")
    if _local_app_data:
        DEFAULT_MODEL_DIR = os.path.join(_local_app_data, "sherpa-onnx", "sense-voice")
        DEFAULT_VAD_MODEL = os.path.join(
            _local_app_data, "sherpa-onnx", "silero_vad.onnx"
        )
    else:
        DEFAULT_MODEL_DIR = os.path.expanduser("~/.cache/sherpa-onnx/sense-voice")
        DEFAULT_VAD_MODEL = os.path.expanduser("~/.cache/sherpa-onnx/silero_vad.onnx")
else:
    DEFAULT_MODEL_DIR = os.path.expanduser("~/.cache/sherpa-onnx/sense-voice")
    DEFAULT_VAD_MODEL = os.path.expanduser("~/.cache/sherpa-onnx/silero_vad.onnx")

# Model download progress callback
ModelDownloadCallback = Callable[[str, float, str], None]


@dataclass
class Segment:
    index: int
    start_ms: int
    end_ms: int
    text: str


@dataclass
class TranscriptionResult:
    text: str
    segments: list[Segment]
    duration_ms: int


@dataclass
class SpeechRegion:
    """Copied speech data from VAD (safe after vad.pop())."""

    start_sample: int
    samples: np.ndarray  # float32 numpy array (NOT Python list)


ProgressCallback = Callable[[float, str, str], None]

SENTENCE_PATTERN = re.compile(
    r"[^。！？!?…\n]+[。！？!?…]+|[^。！？!?…\n]+", re.UNICODE
)
CORRECTION_CHUNK_CHARS = 2000
MAX_PARALLEL_CORRECTIONS = 3


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences while keeping ending punctuation."""
    if not text:
        return []
    sentences = [
        segment.strip() for segment in SENTENCE_PATTERN.findall(text) if segment.strip()
    ]
    return sentences


def _audio_filter_for_accuracy_mode(accuracy_mode: str) -> str | None:
    """Return ffmpeg audio filter for the requested accuracy mode."""
    if accuracy_mode == "fast":
        return None
    if accuracy_mode in {"balanced", "accurate"}:
        return "highpass=f=80,lowpass=f=7800,loudnorm=I=-16:TP=-1.5:LRA=11"
    return "highpass=f=80,lowpass=f=7800,loudnorm=I=-16:TP=-1.5:LRA=11"


class ASREngine:
    """Fast ASR engine using sherpa-onnx with INT8 quantized SenseVoice."""

    @staticmethod
    def _default_num_threads() -> int:
        """Pick optimal thread count per platform.

        - macOS Apple Silicon: use performance-core count via sysctl.
        - Windows / Linux: use *physical* core count (or half of logical
          cores) capped to a single NUMA node.  For ONNX Runtime inference,
          using more threads than physical cores hurts because hyper-threads
          compete for execution units and cross-CCD/NUMA traffic stalls.
        """
        try:
            import subprocess as _sp

            out = _sp.check_output(
                ["sysctl", "-n", "hw.perflevel0.logicalcpu"], text=True
            ).strip()
            return int(out)
        except Exception:
            pass

        logical = os.cpu_count() or 4
        # Approximate physical core count (logical / 2 for SMT/HT).
        physical = max(1, logical // 2)
        # Cap at 8: beyond that, memory-bandwidth becomes the bottleneck
        # for ONNX int8 inference and more threads just add overhead.
        return min(physical, 8)

    @staticmethod
    def _allocate_threads(total: int, correction_active: bool) -> tuple[int, int]:
        """Return (transcribe_threads, correction_threads).

        When correction is active, split physical cores 2:1.
        When inactive, all cores go to transcription.
        """
        if not correction_active:
            return total, 0
        transcribe = max(2, total * 2 // 3)
        correction = max(1, total - transcribe)
        return transcribe, correction

    SUPPORTED_LANGUAGES = {"zh", "en"}

    def __init__(
        self,
        model_dir: str = DEFAULT_MODEL_DIR,
        download_callback: ModelDownloadCallback | None = None,
        num_threads: int = 0,
        use_int8: bool = True,
        language: str = "zh",
        correction_engine=None,  # CorrectionEngine | None
        accuracy_mode: str = "balanced",
        domain_profile: str = "general",
        asr_model: str = DEFAULT_ASR_MODEL_ID,
    ) -> None:
        self._recognizer: sherpa_onnx.OfflineRecognizer | None = None
        self._vad_config: sherpa_onnx.VadModelConfig | None = None
        self._model_lock = asyncio.Lock()
        self._model_dir = model_dir
        self._download_callback = download_callback
        self._model_downloading = False
        self._download_progress = 0.0
        self._download_message = ""
        self._num_threads = num_threads or self._default_num_threads()
        self._use_int8 = use_int8
        self._language = language if language in self.SUPPORTED_LANGUAGES else "zh"
        self._correction_engine = correction_engine
        self._accuracy_mode = "balanced"
        self._domain_profile = "general"
        self._asr_model = DEFAULT_ASR_MODEL_ID
        self.set_transcription_options(accuracy_mode, domain_profile, asr_model)

    @property
    def accuracy_mode(self) -> str:
        return self._accuracy_mode

    @property
    def domain_profile(self) -> str:
        return self._domain_profile

    @property
    def asr_model(self) -> str:
        return self._asr_model

    def set_transcription_options(
        self,
        accuracy_mode: str,
        domain_profile: str,
        asr_model: str = DEFAULT_ASR_MODEL_ID,
    ) -> None:
        self._accuracy_mode = (
            accuracy_mode if accuracy_mode in VALID_ACCURACY_MODES else "balanced"
        )
        self._domain_profile = (
            domain_profile if domain_profile in VALID_DOMAIN_PROFILES else "general"
        )
        self._asr_model = sanitize_model_id(asr_model)
        if self._correction_engine is not None and hasattr(
            self._correction_engine, "set_transcription_context"
        ):
            self._correction_engine.set_transcription_context(
                accuracy_mode=self._accuracy_mode,
                domain_profile=self._domain_profile,
            )

    def get_model_cache_dir(self) -> str:
        """Get the directory where models will be cached."""
        import sys

        # If running from PyInstaller bundle, use bundled models
        if getattr(sys, "frozen", False):
            bundle_dir = Path(sys._MEIPASS)  # type: ignore
            bundled_models = bundle_dir / "models_cache" / "sherpa-onnx"
            if bundled_models.exists():
                return str(bundled_models)

        return self._model_dir

    def is_downloading(self) -> bool:
        """Check if model is currently being downloaded."""
        return self._model_downloading

    def has_model(self) -> bool:
        """Return whether the model has been loaded."""
        if not is_sherpa_model(self._asr_model):
            return True
        return self._recognizer is not None

    async def set_language(self, language: str) -> None:
        """Switch recognition language, reloading model if needed."""
        lang = language if language in self.SUPPORTED_LANGUAGES else "zh"
        if lang == self._language:
            return
        async with self._model_lock:
            self._language = lang
            if self._recognizer is not None:
                self._recognizer = None
                self._load_model_sync()

    def _report_download_progress(
        self, stage: str, progress: float, message: str
    ) -> None:
        """Record and forward model download progress."""
        self._download_progress = progress
        self._download_message = message

        if self._download_callback:
            self._download_callback(stage, progress, message)

    def get_download_progress(self) -> tuple[float, str]:
        """Return current download progress and message."""
        return self._download_progress, self._download_message

    async def ensure_model(self) -> None:
        """Load sherpa-onnx SenseVoice model."""
        async with self._model_lock:
            if self._recognizer is not None:
                self._download_progress = 1.0
                self._download_message = "模型已加载"
                return

            self._model_downloading = True
            try:
                cache_dir = self.get_model_cache_dir()

                self._report_download_progress(
                    "初始化",
                    0.0,
                    f"正在加载模型...\n目录: {cache_dir}",
                )

                await asyncio.to_thread(self._load_model_sync)

                self._report_download_progress("完成", 1.0, "模型加载完成")
            finally:
                if self._recognizer is not None:
                    self._download_progress = 1.0
                    self._download_message = "模型已加载"
                self._model_downloading = False

    def _load_model_sync(self) -> None:
        """Synchronously load the sherpa-onnx recognizer."""
        model_dir = self.get_model_cache_dir()
        model_name = "model.int8.onnx" if self._use_int8 else "model.onnx"
        model_path = os.path.join(model_dir, model_name)
        tokens_path = os.path.join(model_dir, "tokens.txt")

        if not os.path.exists(model_path):
            raise RuntimeError(
                f"模型文件不存在: {model_path}\n" f"请先下载模型到 {model_dir}"
            )

        if not os.path.exists(tokens_path):
            raise RuntimeError(f"tokens.txt 不存在: {tokens_path}")

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=model_path,
            tokens=tokens_path,
            num_threads=self._num_threads,
            language=self._language,
            use_itn=True,
            provider="cpu",
        )

        # Load Silero VAD for intelligent speech segmentation
        # Check bundled location first (PyInstaller), then default cache
        vad_path = os.path.join(model_dir, "silero_vad.onnx")
        if not os.path.exists(vad_path):
            vad_path = DEFAULT_VAD_MODEL
        if os.path.exists(vad_path):
            self._vad_config = sherpa_onnx.VadModelConfig(
                silero_vad=sherpa_onnx.SileroVadModelConfig(
                    model=vad_path,
                    min_silence_duration=0.5,
                    min_speech_duration=0.25,
                    max_speech_duration=30,
                ),
                sample_rate=16000,
                num_threads=1,
                provider="cpu",
            )

    async def transcribe(
        self,
        audio_path: Path,
        progress_cb: ProgressCallback | None = None,
        pause_event: asyncio.Event | None = None,
        cancelled_checker: Callable[[], bool] | None = None,
    ) -> TranscriptionResult:
        if is_sherpa_model(self._asr_model):
            await self.ensure_model()
        return await asyncio.to_thread(
            self._transcribe_sync,
            audio_path,
            progress_cb,
            pause_event,
            cancelled_checker,
        )

    def _check_interrupted(
        self,
        pause_event: asyncio.Event | None,
        cancelled_checker: Callable[[], bool] | None,
    ) -> bool:
        """Return True if cancelled; block while paused."""
        if cancelled_checker and cancelled_checker():
            return True
        if pause_event is not None:
            import time

            while not pause_event.is_set():
                if cancelled_checker and cancelled_checker():
                    return True
                time.sleep(0.1)
        return False

    def _detect_speech_segments(
        self,
        samples: np.ndarray,
        sample_rate: int,
        progress_cb: ProgressCallback | None = None,
    ) -> list[SpeechRegion]:
        """Use Silero VAD to find speech regions.

        IMPORTANT: vad.front returns a C++ reference invalidated by pop(),
        so we must copy start + samples before calling pop().
        """
        assert self._vad_config is not None
        vad = sherpa_onnx.VoiceActivityDetector(
            self._vad_config, buffer_size_in_seconds=600
        )
        window = self._vad_config.silero_vad.window_size
        total = len(samples)
        last_pct = -1

        # Feed audio to VAD in window-sized chunks.
        # Progress reporting every 5% to avoid callback overhead in hot loop.
        for i in range(0, total, window):
            chunk = samples[i : i + window]
            if len(chunk) < window:
                break
            vad.accept_waveform(chunk)
            if progress_cb:
                pct = i * 20 // total  # 0..20 (5% granularity)
                if pct > last_pct:
                    last_pct = pct
                    progress_cb(0.12 + 0.03 * (i / total), "语音检测中", "")
        vad.flush()

        regions: list[SpeechRegion] = []
        while not vad.empty():
            seg = vad.front
            regions.append(
                SpeechRegion(
                    start_sample=int(seg.start),
                    samples=np.array(seg.samples, dtype=np.float32),
                )
            )
            vad.pop()
        return regions

    def _transcribe_sync(
        self,
        audio_path: Path,
        progress_cb: ProgressCallback | None = None,
        pause_event: asyncio.Event | None = None,
        cancelled_checker: Callable[[], bool] | None = None,
    ) -> TranscriptionResult:
        duration_ms = probe_duration_ms(audio_path)

        if progress_cb:
            progress_cb(0.05, "准备音频", "")

        if self._check_interrupted(pause_event, cancelled_checker):
            return TranscriptionResult(text="", segments=[], duration_ms=duration_ms)

        wav_path = self._ensure_wav_format(audio_path)

        try:
            if not is_sherpa_model(self._asr_model):
                return self._transcribe_external(
                    wav_path,
                    duration_ms,
                    progress_cb,
                    pause_event,
                    cancelled_checker,
                )

            assert self._recognizer is not None

            if progress_cb:
                progress_cb(0.1, "读取音频", "")

            samples, sample_rate = self._read_wav(wav_path)

            # Use VAD if available, otherwise fall back to fixed chunking
            if self._vad_config is not None:
                return self._transcribe_with_vad(
                    samples,
                    sample_rate,
                    duration_ms,
                    progress_cb,
                    pause_event,
                    cancelled_checker,
                )

            return self._transcribe_fixed_chunks(
                samples,
                sample_rate,
                duration_ms,
                progress_cb,
                pause_event,
                cancelled_checker,
            )
        finally:
            if wav_path != audio_path and wav_path.exists():
                wav_path.unlink(missing_ok=True)

    def _transcribe_external(
        self,
        audio_path: Path,
        duration_ms: int,
        progress_cb: ProgressCallback | None,
        pause_event: asyncio.Event | None,
        cancelled_checker: Callable[[], bool] | None,
    ) -> TranscriptionResult:
        if progress_cb:
            progress_cb(0.12, "准备本地识别模型", "")
        try:
            from asr_providers import transcribe_with_external_provider
        except ImportError:
            from .asr_providers import transcribe_with_external_provider

        hotwords: list[str] = []
        if self._correction_engine is not None:
            hotwords = list(getattr(self._correction_engine, "_hot_words", []))

        def provider_progress(provider_value: float, stage: str, partial: str) -> None:
            if not progress_cb:
                return
            clamped = min(max(provider_value, 0.0), 1.0)
            progress_cb(0.15 + 0.70 * clamped, stage, partial)

        def provider_cancelled() -> bool:
            return self._check_interrupted(pause_event, cancelled_checker)

        result = transcribe_with_external_provider(
            model_id=self._asr_model,
            audio_path=audio_path,
            duration_ms=duration_ms,
            language=self._language,
            hotwords=hotwords,
            progress_cb=provider_progress,
            cancelled_checker=provider_cancelled,
        )
        if provider_cancelled():
            return result
        if progress_cb:
            progress_cb(0.85, "转写完成", result.text)
        segments, final_text = self._enhance_output(result.segments)
        if self._correction_engine is not None and segments:
            if progress_cb:
                progress_cb(0.9, "智能纠错中…", final_text)
            segments, final_text = self._post_correct(segments, progress_cb)
            segments, final_text = self._enhance_output(segments)
        if progress_cb:
            progress_cb(1.0, "完成", final_text)
        return TranscriptionResult(
            text=final_text, segments=segments, duration_ms=duration_ms
        )

    def _transcribe_with_vad(
        self,
        samples: np.ndarray,
        sample_rate: int,
        duration_ms: int,
        progress_cb: ProgressCallback | None,
        pause_event: asyncio.Event | None,
        cancelled_checker: Callable[[], bool] | None,
    ) -> TranscriptionResult:
        """VAD-guided transcription: split on silence, not on fixed intervals."""
        assert self._recognizer is not None

        if progress_cb:
            progress_cb(0.12, "语音检测中", "")

        speech_segments = self._detect_speech_segments(
            samples, sample_rate, progress_cb
        )

        if not speech_segments:
            if progress_cb:
                progress_cb(1.0, "完成", "")
            return TranscriptionResult(text="", segments=[], duration_ms=duration_ms)

        all_texts: list[str] = []
        all_segments: list[Segment] = []
        total = len(speech_segments)

        for idx, seg in enumerate(speech_segments):
            if self._check_interrupted(pause_event, cancelled_checker):
                break

            progress = 0.15 + 0.80 * (idx / total)
            if progress_cb:
                progress_cb(progress, f"转写中 {idx + 1}/{total}", " ".join(all_texts))

            stream = self._recognizer.create_stream()
            stream.accept_waveform(sample_rate, seg.samples)
            self._recognizer.decode_stream(stream)

            text = stream.result.text.strip()
            if not text:
                continue

            all_texts.append(text)

            start_ms = int(seg.start_sample / sample_rate * 1000)
            end_ms = start_ms + int(len(seg.samples) / sample_rate * 1000)

            sentences = _split_sentences(text) or [text]
            seg_duration_ms = end_ms - start_ms
            total_chars = sum(len(s) for s in sentences)
            cursor_ms = start_ms

            for s_idx, sentence in enumerate(sentences):
                proportion = len(sentence) / total_chars if total_chars > 0 else 1.0
                s_end = cursor_ms + int(seg_duration_ms * proportion)
                if s_idx == len(sentences) - 1:
                    s_end = end_ms
                all_segments.append(
                    Segment(
                        index=len(all_segments),
                        start_ms=cursor_ms,
                        end_ms=s_end,
                        text=sentence,
                    )
                )
                cursor_ms = s_end

        all_segments, final_text = self._enhance_output(all_segments)

        if progress_cb:
            progress_cb(0.95, "转写完成", final_text)

        # Post-correction: one-shot full-text correction via API
        if self._correction_engine is not None and all_segments:
            if progress_cb:
                progress_cb(0.96, "智能纠错中…", final_text)
            all_segments, final_text = self._post_correct(all_segments, progress_cb)
            all_segments, final_text = self._enhance_output(all_segments)

        if progress_cb:
            progress_cb(1.0, "完成", final_text)

        return TranscriptionResult(
            text=final_text, segments=all_segments, duration_ms=duration_ms
        )

    def _transcribe_fixed_chunks(
        self,
        samples: np.ndarray,
        sample_rate: int,
        duration_ms: int,
        progress_cb: ProgressCallback | None,
        pause_event: asyncio.Event | None,
        cancelled_checker: Callable[[], bool] | None,
    ) -> TranscriptionResult:
        """Fallback: fixed 30-second chunking when VAD is unavailable."""
        assert self._recognizer is not None

        chunk_size = sample_rate * 30
        total_samples = len(samples)
        all_texts: list[str] = []
        all_segments: list[Segment] = []
        current_offset_ms = 0
        num_chunks = max(1, (total_samples + chunk_size - 1) // chunk_size)

        for chunk_idx in range(num_chunks):
            if self._check_interrupted(pause_event, cancelled_checker):
                break

            start_idx = chunk_idx * chunk_size
            end_idx = min(start_idx + chunk_size, total_samples)
            chunk_samples = samples[start_idx:end_idx]
            chunk_duration_ms = int((end_idx - start_idx) / sample_rate * 1000)

            progress = 0.1 + 0.8 * (chunk_idx / num_chunks)
            if progress_cb:
                progress_cb(
                    progress,
                    f"转写中 {chunk_idx + 1}/{num_chunks}",
                    " ".join(all_texts),
                )

            stream = self._recognizer.create_stream()
            stream.accept_waveform(sample_rate, chunk_samples)
            self._recognizer.decode_stream(stream)

            chunk_text = stream.result.text.strip()
            if chunk_text:
                all_texts.append(chunk_text)
                chunk_segs = self._create_segments(chunk_text, chunk_duration_ms)
                for s in chunk_segs:
                    s.index = len(all_segments)
                    s.start_ms += current_offset_ms
                    s.end_ms += current_offset_ms
                    all_segments.append(s)

            current_offset_ms += chunk_duration_ms

        all_segments, final_text = self._enhance_output(all_segments)
        if progress_cb:
            progress_cb(1.0, "完成", final_text)

        return TranscriptionResult(
            text=final_text, segments=all_segments, duration_ms=duration_ms
        )

    def _enhance_output(self, segments: list[Segment]) -> tuple[list[Segment], str]:
        options = EnhancementOptions(
            accuracy_mode=self._accuracy_mode,
            domain_profile=self._domain_profile,
        )
        enhanced_segments = enhance_segments(segments, options)
        final_text = enhance_text(" ".join(s.text for s in enhanced_segments), options)
        return enhanced_segments, final_text

    def _ensure_wav_format(self, audio_path: Path) -> Path:
        """Convert audio to 16kHz mono WAV if needed."""
        audio_filter = _audio_filter_for_accuracy_mode(self._accuracy_mode)
        # If already a WAV file, check format
        if audio_filter is None and audio_path.suffix.lower() == ".wav":
            try:
                with wave.open(str(audio_path), "rb") as wf:
                    if wf.getnchannels() == 1 and wf.getframerate() == 16000:
                        return audio_path
            except Exception:
                pass

        # Convert using ffmpeg
        import tempfile

        tmp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp_path = Path(tmp_file.name)
        tmp_file.close()

        cmd = [
            "ffmpeg",
            "-y",
            "-nostdin",
            "-i",
            str(audio_path),
            "-ac",
            "1",
            "-ar",
            "16000",
        ]
        if audio_filter:
            cmd.extend(["-af", audio_filter])
        cmd.append(str(tmp_path))
        result = subprocess.run(cmd, **_subprocess_kwargs())
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg 转换失败: {result.stderr.strip()}")

        return tmp_path

    def _read_wav(self, wav_path: Path) -> tuple[np.ndarray, int]:
        """Read WAV file and return contiguous float32 numpy array."""
        with wave.open(str(wav_path), "rb") as wf:
            sample_rate = wf.getframerate()
            raw_data = wf.readframes(wf.getnframes())
        # ascontiguousarray ensures optimal memory layout for ONNX Runtime
        samples = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32768.0
        return np.ascontiguousarray(samples), sample_rate

    def _post_correct(
        self,
        segments: list[Segment],
        progress_cb: ProgressCallback | None = None,
    ) -> tuple[list[Segment], str]:
        """One-shot full-text correction after transcription completes.

        Sends all text to the correction engine in chunks of ~2000 chars.
        Returns (corrected_segments, corrected_full_text).
        """
        assert self._correction_engine is not None

        # Group segments into chunks sized for API correction.
        chunks: list[list[Segment]] = []
        current_chunk: list[Segment] = []
        current_len = 0
        for seg in segments:
            current_chunk.append(seg)
            current_len += len(seg.text)
            if current_len >= CORRECTION_CHUNK_CHARS:
                chunks.append(current_chunk)
                current_chunk = []
                current_len = 0
        if current_chunk:
            chunks.append(current_chunk)

        contexts: list[str] = []
        preceding = ""
        for chunk in chunks:
            contexts.append(preceding[-500:])
            preceding += "".join(seg.text for seg in chunk)
            if len(preceding) > 500:
                preceding = preceding[-500:]

        def correct_chunk(
            i: int, chunk: list[Segment], context: str
        ) -> tuple[int, list[str]]:
            texts = [s.text for s in chunk]
            try:
                corrected = self._correction_engine.correct(
                    texts, preceding_text=context
                )
                print(f"[CORRECTION] 纠错 {i + 1}/{len(chunks)} 完成", flush=True)
            except Exception as exc:
                print(f"[CORRECTION] 纠错异常: {exc}", flush=True)
                corrected = texts
            if len(corrected) != len(texts):
                corrected = texts
            return i, corrected

        corrected_text_chunks: list[list[str] | None] = [None] * len(chunks)
        completed = 0
        max_workers = min(MAX_PARALLEL_CORRECTIONS, len(chunks))

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [
                pool.submit(correct_chunk, i, chunk, contexts[i])
                for i, chunk in enumerate(chunks)
            ]
            for future in as_completed(futures):
                chunk_idx, corrected = future.result()
                corrected_text_chunks[chunk_idx] = corrected
                completed += 1
                if progress_cb:
                    ratio = completed / len(chunks)
                    progress_cb(
                        0.96 + 0.03 * ratio,
                        f"智能纠错中 {completed}/{len(chunks)}",
                        _join_completed_correction_chunks(
                            chunks, corrected_text_chunks
                        ),
                    )

        corrected_segments: list[Segment] = []
        for chunk, corrected in zip(chunks, corrected_text_chunks):
            corrected = corrected or [seg.text for seg in chunk]
            for seg, ct in zip(chunk, corrected):
                corrected_segments.append(
                    Segment(
                        index=len(corrected_segments),
                        start_ms=seg.start_ms,
                        end_ms=seg.end_ms,
                        text=ct,
                    )
                )

        final_text = " ".join(s.text for s in corrected_segments).strip()
        return corrected_segments, final_text

    def _create_segments(self, text: str, duration_ms: int) -> list[Segment]:
        """Split text into segments with estimated timestamps."""
        sentences = _split_sentences(text) or ([text.strip()] if text.strip() else [])
        sentences = [s for s in sentences if s]

        if not sentences:
            return []

        segments = []
        total_chars = sum(len(s) for s in sentences)
        if total_chars == 0:
            return []

        current_ms = 0
        for i, sentence in enumerate(sentences):
            # Estimate end time based on character proportion
            char_proportion = len(sentence) / total_chars
            segment_duration = int(duration_ms * char_proportion)
            end_ms = min(current_ms + segment_duration, duration_ms)

            # Ensure last segment goes to end
            if i == len(sentences) - 1:
                end_ms = duration_ms

            segments.append(
                Segment(
                    index=i,
                    start_ms=current_ms,
                    end_ms=end_ms,
                    text=sentence,
                )
            )
            current_ms = end_ms

        return segments


def probe_duration_ms(audio_path: Path) -> int:
    """Return audio duration (ms) via ffprobe."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(audio_path),
    ]
    result = subprocess.run(cmd, **_subprocess_kwargs())
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 调用失败: {result.stderr.strip()}")
    try:
        seconds = float(result.stdout.strip())
    except ValueError as exc:
        raise RuntimeError("无法解析音频时长") from exc
    return int(seconds * 1000)


def _join_completed_correction_chunks(
    chunks: list[list[Segment]],
    corrected_text_chunks: list[list[str] | None],
) -> str:
    texts: list[str] = []
    for chunk, corrected in zip(chunks, corrected_text_chunks):
        if corrected is None:
            break
        texts.extend(corrected[: len(chunk)])
    return " ".join(texts).strip()
