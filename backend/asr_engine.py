"""ASR engine using sherpa-onnx for fast SenseVoice inference."""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import sherpa_onnx

MODEL_CARD = "SenseVoice INT8 (sherpa-onnx)"

# Default model directory
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
    samples: list[float]


ProgressCallback = Callable[[float, str, str], None]

SENTENCE_PATTERN = re.compile(
    r"[^。！？!?…\n]+[。！？!?…]+|[^。！？!?…\n]+", re.UNICODE
)


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences while keeping ending punctuation."""
    if not text:
        return []
    sentences = [
        segment.strip() for segment in SENTENCE_PATTERN.findall(text) if segment.strip()
    ]
    return sentences


class ASREngine:
    """Fast ASR engine using sherpa-onnx with INT8 quantized SenseVoice."""

    @staticmethod
    def _default_num_threads() -> int:
        """Use performance core count on Apple Silicon, otherwise all cores."""
        try:
            import subprocess as _sp
            out = _sp.check_output(
                ["sysctl", "-n", "hw.perflevel0.logicalcpu"], text=True
            ).strip()
            return int(out)
        except Exception:
            return os.cpu_count() or 4

    SUPPORTED_LANGUAGES = {"zh", "en"}

    def __init__(
        self,
        model_dir: str = DEFAULT_MODEL_DIR,
        download_callback: ModelDownloadCallback | None = None,
        num_threads: int = 0,
        use_int8: bool = True,
        language: str = "zh",
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
        vad = sherpa_onnx.VoiceActivityDetector(self._vad_config, buffer_size_in_seconds=600)
        window = self._vad_config.silero_vad.window_size
        total = len(samples)
        last_pct = -1

        for i in range(0, total, window):
            chunk = samples[i : i + window]
            if len(chunk) < window:
                break
            vad.accept_waveform(chunk)
            if progress_cb:
                pct = i * 100 // total
                if pct > last_pct:
                    last_pct = pct
                    progress_cb(0.12 + 0.03 * (i / total), "语音检测中", "")
        vad.flush()

        regions: list[SpeechRegion] = []
        while not vad.empty():
            seg = vad.front
            regions.append(SpeechRegion(
                start_sample=int(seg.start),
                samples=list(seg.samples),
            ))
            vad.pop()
        return regions

    def _transcribe_sync(
        self,
        audio_path: Path,
        progress_cb: ProgressCallback | None = None,
        pause_event: asyncio.Event | None = None,
        cancelled_checker: Callable[[], bool] | None = None,
    ) -> TranscriptionResult:
        assert self._recognizer is not None

        duration_ms = probe_duration_ms(audio_path)

        if progress_cb:
            progress_cb(0.05, "准备音频", "")

        if self._check_interrupted(pause_event, cancelled_checker):
            return TranscriptionResult(text="", segments=[], duration_ms=duration_ms)

        wav_path = self._ensure_wav_format(audio_path)

        try:
            if progress_cb:
                progress_cb(0.1, "读取音频", "")

            samples, sample_rate = self._read_wav(wav_path)

            # Use VAD if available, otherwise fall back to fixed chunking
            if self._vad_config is not None:
                return self._transcribe_with_vad(
                    samples, sample_rate, duration_ms, progress_cb, pause_event, cancelled_checker
                )

            return self._transcribe_fixed_chunks(
                samples, sample_rate, duration_ms, progress_cb, pause_event, cancelled_checker
            )
        finally:
            if wav_path != audio_path and wav_path.exists():
                wav_path.unlink(missing_ok=True)

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

        speech_segments = self._detect_speech_segments(samples, sample_rate, progress_cb)

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

            # Split into sentence-level segments within this VAD region
            sentences = _split_sentences(text) or [text]
            seg_duration_ms = end_ms - start_ms
            total_chars = sum(len(s) for s in sentences)
            cursor_ms = start_ms

            for s_idx, sentence in enumerate(sentences):
                proportion = len(sentence) / total_chars if total_chars > 0 else 1.0
                s_end = cursor_ms + int(seg_duration_ms * proportion)
                if s_idx == len(sentences) - 1:
                    s_end = end_ms
                all_segments.append(Segment(
                    index=len(all_segments),
                    start_ms=cursor_ms,
                    end_ms=s_end,
                    text=sentence,
                ))
                cursor_ms = s_end

        final_text = " ".join(all_texts).strip()

        if progress_cb:
            progress_cb(1.0, "完成", final_text)

        return TranscriptionResult(text=final_text, segments=all_segments, duration_ms=duration_ms)

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
                progress_cb(progress, f"转写中 {chunk_idx + 1}/{num_chunks}", " ".join(all_texts))

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

        final_text = " ".join(all_texts).strip()
        if progress_cb:
            progress_cb(1.0, "完成", final_text)

        return TranscriptionResult(text=final_text, segments=all_segments, duration_ms=duration_ms)

    def _ensure_wav_format(self, audio_path: Path) -> Path:
        """Convert audio to 16kHz mono WAV if needed."""
        # If already a WAV file, check format
        if audio_path.suffix.lower() == ".wav":
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
            "-i",
            str(audio_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            str(tmp_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg 转换失败: {result.stderr.strip()}")

        return tmp_path

    def _read_wav(self, wav_path: Path) -> tuple[np.ndarray, int]:
        """Read WAV file and return float32 numpy array."""
        with wave.open(str(wav_path), "rb") as wf:
            sample_rate = wf.getframerate()
            raw_data = wf.readframes(wf.getnframes())
        return (
            np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32768.0,
            sample_rate,
        )

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
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 调用失败: {result.stderr.strip()}")
    try:
        seconds = float(result.stdout.strip())
    except ValueError as exc:
        raise RuntimeError("无法解析音频时长") from exc
    return int(seconds * 1000)
