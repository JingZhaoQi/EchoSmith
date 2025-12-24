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

import sherpa_onnx

MODEL_CARD = "SenseVoice INT8 (sherpa-onnx)"

# Default model directory
DEFAULT_MODEL_DIR = os.path.expanduser("~/.cache/sherpa-onnx/sense-voice")

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


ProgressCallback = Callable[[float, str, str], None]

SENTENCE_PATTERN = re.compile(r"[^。！？!?…\n]+[。！？!?…]+|[^。！？!?…\n]+", re.UNICODE)


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences while keeping ending punctuation."""
    if not text:
        return []
    sentences = [segment.strip() for segment in SENTENCE_PATTERN.findall(text) if segment.strip()]
    return sentences


class ASREngine:
    """Fast ASR engine using sherpa-onnx with INT8 quantized SenseVoice."""

    def __init__(
        self,
        model_dir: str = DEFAULT_MODEL_DIR,
        download_callback: ModelDownloadCallback | None = None,
        num_threads: int = 4,
        use_int8: bool = True,
    ) -> None:
        self._recognizer: sherpa_onnx.OfflineRecognizer | None = None
        self._model_lock = asyncio.Lock()
        self._model_dir = model_dir
        self._download_callback = download_callback
        self._model_downloading = False
        self._download_progress = 0.0
        self._download_message = ""
        self._num_threads = num_threads
        self._use_int8 = use_int8

    def get_model_cache_dir(self) -> str:
        """Get the directory where models will be cached."""
        import sys

        # If running from PyInstaller bundle, use bundled models
        if getattr(sys, 'frozen', False):
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

    def _report_download_progress(self, stage: str, progress: float, message: str) -> None:
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
                f"模型文件不存在: {model_path}\n"
                f"请先下载模型到 {model_dir}"
            )

        if not os.path.exists(tokens_path):
            raise RuntimeError(f"tokens.txt 不存在: {tokens_path}")

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=model_path,
            tokens=tokens_path,
            num_threads=self._num_threads,
            language="auto",
            use_itn=True,
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

    def _transcribe_sync(
        self,
        audio_path: Path,
        progress_cb: ProgressCallback | None = None,
        pause_event: asyncio.Event | None = None,
        cancelled_checker: Callable[[], bool] | None = None,
    ) -> TranscriptionResult:
        assert self._recognizer is not None

        # Get audio duration
        duration_ms = probe_duration_ms(audio_path)

        if progress_cb:
            progress_cb(0.05, "准备音频", "")

        # Check for cancellation
        if cancelled_checker and cancelled_checker():
            return TranscriptionResult(text="", segments=[], duration_ms=duration_ms)

        # Handle pause
        if pause_event is not None:
            while not pause_event.is_set():
                if cancelled_checker and cancelled_checker():
                    return TranscriptionResult(text="", segments=[], duration_ms=duration_ms)
                import time
                time.sleep(0.1)

        # Convert audio to 16kHz mono WAV if needed
        wav_path = self._ensure_wav_format(audio_path)

        try:
            if progress_cb:
                progress_cb(0.1, "读取音频", "")

            # Read audio samples
            samples, sample_rate = self._read_wav(wav_path)
            total_samples = len(samples)

            # Process in chunks for long audio (30 seconds per chunk)
            chunk_size = sample_rate * 30  # 30 seconds
            all_texts = []
            all_segments = []
            current_offset_ms = 0

            num_chunks = max(1, (total_samples + chunk_size - 1) // chunk_size)

            for chunk_idx in range(num_chunks):
                # Check for cancellation
                if cancelled_checker and cancelled_checker():
                    break

                # Handle pause
                if pause_event is not None:
                    while not pause_event.is_set():
                        if cancelled_checker and cancelled_checker():
                            break
                        import time
                        time.sleep(0.1)

                start_idx = chunk_idx * chunk_size
                end_idx = min((chunk_idx + 1) * chunk_size, total_samples)
                chunk_samples = samples[start_idx:end_idx]
                chunk_duration_ms = int((end_idx - start_idx) / sample_rate * 1000)

                # Update progress
                progress = 0.1 + 0.8 * (chunk_idx / num_chunks)
                if progress_cb:
                    partial_text = " ".join(all_texts)
                    progress_cb(progress, f"转写中 {chunk_idx + 1}/{num_chunks}", partial_text)

                # Create stream and decode this chunk
                stream = self._recognizer.create_stream()
                stream.accept_waveform(sample_rate, chunk_samples)
                self._recognizer.decode_stream(stream)

                # Get result for this chunk
                chunk_text = stream.result.text.strip()
                if chunk_text:
                    all_texts.append(chunk_text)

                    # Create segments for this chunk
                    chunk_segments = self._create_segments(chunk_text, chunk_duration_ms)
                    for seg in chunk_segments:
                        seg.index = len(all_segments)
                        seg.start_ms += current_offset_ms
                        seg.end_ms += current_offset_ms
                        all_segments.append(seg)

                current_offset_ms += chunk_duration_ms

            if progress_cb:
                progress_cb(0.95, "处理结果", "")

            # Combine all text
            final_text = " ".join(all_texts).strip()

            if progress_cb:
                progress_cb(1.0, "完成", final_text)

            return TranscriptionResult(
                text=final_text,
                segments=all_segments,
                duration_ms=duration_ms,
            )
        finally:
            # Clean up temp file if we created one
            if wav_path != audio_path and wav_path.exists():
                wav_path.unlink(missing_ok=True)

    def _ensure_wav_format(self, audio_path: Path) -> Path:
        """Convert audio to 16kHz mono WAV if needed."""
        # If already a WAV file, check format
        if audio_path.suffix.lower() == ".wav":
            try:
                with wave.open(str(audio_path), 'rb') as wf:
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
            "ffmpeg", "-y", "-i", str(audio_path),
            "-ac", "1", "-ar", "16000",
            str(tmp_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg 转换失败: {result.stderr.strip()}")

        return tmp_path

    def _read_wav(self, wav_path: Path) -> tuple[list[float], int]:
        """Read WAV file and return samples as float list."""
        with wave.open(str(wav_path), 'rb') as wf:
            sample_rate = wf.getframerate()
            num_frames = wf.getnframes()
            raw_data = wf.readframes(num_frames)

            # Convert to float samples
            import struct
            num_samples = len(raw_data) // 2
            samples = struct.unpack(f'{num_samples}h', raw_data)
            samples = [s / 32768.0 for s in samples]

            return samples, sample_rate

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

            segments.append(Segment(
                index=i,
                start_ms=current_ms,
                end_ms=end_ms,
                text=sentence,
            ))
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
