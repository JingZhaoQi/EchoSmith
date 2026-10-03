"""ASR engine using sherpa-onnx for fast SenseVoice inference."""

from __future__ import annotations

import asyncio
import os
import platform
import re
import subprocess
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator

import numpy as np
import sherpa_onnx

try:
    from asr_models import DEFAULT_ASR_MODEL_ID, sanitize_model_id
    from timing import (
        Cue,
        TimedText,
        align_corrected,
        concat,
        cut_cues,
        join_text,
        timed_from_tokens,
    )
    from transcript_enhancer import enhance_text
except ImportError:
    from .asr_models import DEFAULT_ASR_MODEL_ID, sanitize_model_id
    from .timing import (
        Cue,
        TimedText,
        align_corrected,
        concat,
        cut_cues,
        join_text,
        timed_from_tokens,
    )
    from .transcript_enhancer import enhance_text


def _no_window_kwargs() -> dict:
    """On Windows GUI apps (Tauri, CREATE_NO_WINDOW) child processes must not allocate a console."""
    if platform.system() == "Windows":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}  # 0x08000000
    return {}


def _subprocess_kwargs() -> dict:
    """Return extra kwargs for subprocess.run() to work reliably on Windows.

    - stdin=DEVNULL because ffmpeg reads stdin by default and a missing
      console makes stdin unavailable, causing hangs
    - explicit encoding='utf-8' with errors='replace' because the default
      text=True uses the system code page (cp936 on Chinese Windows) which
      can choke on ffmpeg's UTF-8 output
    """
    return {
        "stdin": subprocess.DEVNULL,
        "capture_output": True,
        "encoding": "utf-8",
        "errors": "replace",
        **_no_window_kwargs(),
    }


# ffmpeg audio cleanup applied before recognition.
# loudnorm was dropped: it internally resamples to 192kHz and took ~90s on a
# 76-minute file. Instead we measure integrated loudness with ebur128 (fast)
# and apply a static gain + true-peak limiter, which lands within ~0.5 LU of
# the loudnorm output while running ~9x faster.
LOUDNESS_TARGET_LUFS = -16.0
TRUE_PEAK_LIMIT = 0.841  # -1.5 dBTP
MAX_LOUDNESS_GAIN_DB = 24.0  # avoid amplifying noise floor on very quiet audio
# Loudness is measured on the opening minutes only: a full-file pass cost ~6 s per hour of
# audio before any text appeared, and speech recordings keep a steady level.
LOUDNESS_PROBE_S = 180
SAMPLE_RATE = 16000
READ_CHUNK_S = 1
AUDIO_FILTER = (
    "highpass=f=80,lowpass=f=7800,"
    "volume={gain}dB,"
    f"alimiter=limit={TRUE_PEAK_LIMIT}:level=false"
)

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
    text: str  # final text: corrected when correction ran, else the raw transcript
    segments: list[Segment]  # raw transcript cues with real timestamps
    duration_ms: int
    raw_text: str = ""
    corrected_segments: list[Segment] = field(
        default_factory=list
    )  # corrected text re-timed onto the audio
    correction_failed_batches: int = 0
    cancelled: bool = False


ProgressCallback = Callable[
    [float, str, str], None
]  # (asr_progress 0..1, stage, raw text so far)
CorrectionCallback = Callable[
    [str, float], None
]  # (corrected text so far, correction progress 0..1)

FIRST_CHUNK_CHARS = (
    200  # small first batch: corrected text starts appearing within seconds
)
CORRECTION_CHUNK_CHARS = 800
MAX_PARALLEL_CORRECTIONS = 6
CORRECTION_CONTEXT_CHARS = 500
EMIT_INTERVAL_S = 0.1  # throttle for streamed correction updates

# Silero VAD trims speech tightly; decoding a slightly wider window keeps the last syllable
# (measured: "什么样的爱" lost its final character without the tail pad).
VAD_PAD_BEFORE_S = 0.15
VAD_PAD_AFTER_S = 0.35
FIXED_CHUNK_S = 30
VAD_MAX_SPEECH_S = 30  # longer speech is force-split with no gap to the next region


def segments_from_cues(cues: list[Cue], first_index: int = 0) -> list[Segment]:
    """Display segments: cleaned cue text, empty cues dropped, indexes continuous."""
    out: list[Segment] = []
    for cue in cues:
        text = enhance_text(cue.text)
        if text:
            out.append(Segment(first_index + len(out), cue.start_ms, cue.end_ms, text))
    return out


@dataclass
class CorrectedBatch:
    segments: list[Segment]  # raw display segments of this batch
    timed: TimedText  # raw text with per-character times
    text: str  # corrected text (raw text when the batch failed)
    failed: bool


@dataclass
class _Batch:
    segments: list[Segment]
    timed: TimedText
    raw: str
    partial: str = ""
    result: str | None = None
    failed: bool = False


class StreamingCorrector:
    """Overlap LLM correction with transcription and stream the corrected text.

    Segments accumulate into batches (small first batch, then CORRECTION_CHUNK_CHARS)
    that are corrected concurrently while transcription continues. The visible text is
    every finished batch in order plus the streamed part of the first unfinished one,
    so it only ever grows. Failed batches fall back to their raw text.
    """

    def __init__(
        self,
        correction_engine,  # CorrectionEngine-compatible: correct(texts, preceding_text, on_delta, should_stop)
        first_chunk_chars: int = FIRST_CHUNK_CHARS,
        chunk_chars: int = CORRECTION_CHUNK_CHARS,
        max_workers: int = MAX_PARALLEL_CORRECTIONS,
        on_update: CorrectionCallback | None = None,
        emit_interval: float = EMIT_INTERVAL_S,
    ) -> None:
        self._engine = correction_engine
        self._first_chunk_chars = first_chunk_chars
        self._chunk_chars = chunk_chars
        self._pool = ThreadPoolExecutor(max_workers=max_workers)
        self._on_update = on_update
        self._emit_interval = emit_interval
        self._batches: list[_Batch] = []
        self._futures: list[Future] = []
        self._buffer: list[Segment] = []
        self._buffer_timed = TimedText("", [], 0)
        self._context = ""
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._last_emit = 0.0

    def add(self, segments: list[Segment], timed: TimedText) -> None:
        """Feed newly transcribed segments (and their timed raw text); submits a batch once full."""
        if not segments:
            return
        with self._lock:
            self._buffer.extend(segments)
            self._buffer_timed = concat(self._buffer_timed, timed)
            limit = self._chunk_chars if self._batches else self._first_chunk_chars
            if len(self._buffer_timed.text) >= limit:
                self._submit_buffer_locked()

    def _submit_buffer_locked(self) -> None:
        if not self._buffer:
            return
        raw = ""
        for seg in self._buffer:
            raw = join_text(raw, seg.text)
        batch = _Batch(self._buffer, self._buffer_timed, raw)
        self._buffer, self._buffer_timed = [], TimedText("", [], 0)
        self._batches.append(batch)
        context = self._context
        self._context = join_text(self._context, raw)[-CORRECTION_CONTEXT_CHARS:]
        self._futures.append(self._pool.submit(self._correct_batch, batch, context))

    def _correct_batch(self, batch: _Batch, context: str) -> None:
        def on_delta(text: str) -> None:
            with self._lock:
                batch.partial = text
                self._emit_locked(force=False)

        try:
            corrected = self._engine.correct(
                [seg.text for seg in batch.segments],
                preceding_text=context,
                on_delta=on_delta,
                should_stop=self._stop.is_set,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[CORRECTION] 批次异常: {exc}", flush=True)
            corrected = ""
        with self._lock:
            batch.failed = not corrected.strip()
            batch.result = batch.raw if batch.failed else corrected.strip()
            self._emit_locked(force=True)

    def _visible_locked(self) -> tuple[str, float]:
        text, covered = "", 0.0
        for batch in self._batches:
            if batch.result is not None:
                text = join_text(text, batch.result)
                covered += len(batch.raw)
                continue
            text = join_text(text, batch.partial)
            covered += min(len(batch.partial), len(batch.raw))
            break
        total = sum(len(b.raw) for b in self._batches) + len(self._buffer_timed.text)
        return text, (covered / total if total else 0.0)

    def _emit_locked(self, force: bool) -> None:
        if self._on_update is None or self._stop.is_set():
            return
        now = time.monotonic()
        if not force and now - self._last_emit < self._emit_interval:
            return
        self._last_emit = now
        self._on_update(*self._visible_locked())

    def finish(
        self, cancelled_checker: Callable[[], bool] | None = None
    ) -> list[CorrectedBatch] | None:
        """Flush the buffer and wait for all batches; returns None as soon as cancelled_checker() is true."""
        with self._lock:
            self._submit_buffer_locked()
        pending = set(self._futures)
        while pending:
            if cancelled_checker and cancelled_checker():
                self.cancel()
                return None
            _done, pending = wait(pending, timeout=0.2, return_when=FIRST_COMPLETED)
        self._pool.shutdown(wait=True)
        return [
            CorrectedBatch(b.segments, b.timed, b.result or b.raw, b.failed)
            for b in self._batches
        ]

    def cancel(self) -> None:
        """Stop in-flight streams and drop batches that have not started."""
        self._stop.set()
        self._pool.shutdown(wait=False, cancel_futures=True)


class _StreamingVad:
    """Silero VAD fed incrementally; returns finished speech regions as (start, end) sample indexes."""

    def __init__(self, config: sherpa_onnx.VadModelConfig) -> None:
        self._vad = sherpa_onnx.VoiceActivityDetector(
            config, buffer_size_in_seconds=600
        )
        self._window = config.silero_vad.window_size
        self._rest = np.zeros(0, dtype=np.float32)

    def accept(self, chunk: np.ndarray) -> list[tuple[int, int]]:
        data = np.concatenate([self._rest, chunk])
        usable = len(data) // self._window * self._window
        for i in range(0, usable, self._window):
            self._vad.accept_waveform(data[i : i + self._window])
        self._rest = data[usable:]
        return self._drain()

    def flush(self) -> list[tuple[int, int]]:
        self._vad.flush()
        return self._drain()

    def _drain(self) -> list[tuple[int, int]]:
        regions: list[tuple[int, int]] = []
        while not self._vad.empty():
            seg = self._vad.front  # C++ reference, invalid after pop(): copy first
            regions.append((int(seg.start), int(seg.start) + len(seg.samples)))
            self._vad.pop()
        return regions


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

    def __init__(
        self,
        model_dir: str = DEFAULT_MODEL_DIR,
        num_threads: int = 0,
        use_int8: bool = True,
        correction_engine=None,  # CorrectionEngine | None
        asr_model: str = DEFAULT_ASR_MODEL_ID,
    ) -> None:
        self._recognizer: sherpa_onnx.OfflineRecognizer | None = None
        self._vad_config: sherpa_onnx.VadModelConfig | None = None
        self._model_lock = asyncio.Lock()
        self._model_dir = model_dir
        self._model_downloading = False
        self._download_progress = 0.0
        self._download_message = ""
        self._num_threads = num_threads or self._default_num_threads()
        self._use_int8 = use_int8
        self._correction_engine = correction_engine
        self._asr_model = DEFAULT_ASR_MODEL_ID
        self.set_transcription_options(asr_model)

    @property
    def asr_model(self) -> str:
        return self._asr_model

    def set_transcription_options(
        self,
        asr_model: str = DEFAULT_ASR_MODEL_ID,
    ) -> None:
        self._asr_model = sanitize_model_id(asr_model)

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

    def _report_download_progress(
        self,
        stage: str,
        progress: float,
        message: str,
        on_progress: ModelDownloadCallback | None,
    ) -> None:
        """Record and forward model loading progress."""
        self._download_progress = progress
        self._download_message = message
        if on_progress:
            on_progress(stage, progress, message)

    def get_download_progress(self) -> tuple[float, str]:
        """Return current download progress and message."""
        return self._download_progress, self._download_message

    async def ensure_model(
        self, on_progress: ModelDownloadCallback | None = None
    ) -> None:
        """Load the sherpa-onnx model; on_progress reports loading to the calling task only."""
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
                    on_progress,
                )

                await asyncio.to_thread(self._load_model_sync)

                self._report_download_progress("完成", 1.0, "模型加载完成", on_progress)
            finally:
                if self._recognizer is not None:
                    self._download_progress = 1.0
                    self._download_message = "模型已加载"
                self._model_downloading = False

    def _load_model_sync(self) -> None:
        """Synchronously load the sherpa-onnx SenseVoice recognizer."""
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
            language="auto",  # SenseVoice detects zh/en/yue/ja/ko itself; same zh quality as "zh"
            use_itn=True,
            provider="cpu",
        )

        # Load Silero VAD for intelligent speech segmentation
        # Check bundled location first (PyInstaller), then default cache
        vad_path = os.path.join(self.get_model_cache_dir(), "silero_vad.onnx")
        if not os.path.exists(vad_path):
            vad_path = DEFAULT_VAD_MODEL
        if os.path.exists(vad_path):
            self._vad_config = sherpa_onnx.VadModelConfig(
                silero_vad=sherpa_onnx.SileroVadModelConfig(
                    model=vad_path,
                    min_silence_duration=0.5,
                    min_speech_duration=0.25,
                    max_speech_duration=VAD_MAX_SPEECH_S,
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
        correction_cb: CorrectionCallback | None = None,
        model_progress_cb: ModelDownloadCallback | None = None,
    ) -> TranscriptionResult:
        await self.ensure_model(model_progress_cb)
        return await asyncio.to_thread(
            self._transcribe_sync,
            audio_path,
            progress_cb,
            pause_event,
            cancelled_checker,
            correction_cb,
        )

    def correction_active(self) -> bool:
        """Whether transcriptions started now will be LLM-corrected."""
        engine = self._correction_engine
        return engine is not None and engine.has_model()

    def _check_interrupted(
        self,
        pause_event: asyncio.Event | None,
        cancelled_checker: Callable[[], bool] | None,
    ) -> bool:
        """Return True if cancelled; block while paused."""
        if cancelled_checker and cancelled_checker():
            return True
        if pause_event is not None:
            while not pause_event.is_set():
                if cancelled_checker and cancelled_checker():
                    return True
                time.sleep(0.1)
        return False

    def _new_vad(self) -> _StreamingVad | None:
        return _StreamingVad(self._vad_config) if self._vad_config is not None else None

    def _pcm_chunks(self, audio_path: Path, gain_db: float) -> Iterator[np.ndarray]:
        """Decode to 16 kHz mono int16 through a pipe, yielding ~1 s chunks as ffmpeg produces them."""
        cmd = [
            "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(audio_path),
            "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-af", AUDIO_FILTER.format(gain=f"{gain_db:.1f}"),
            "-f", "s16le", "-",
        ]  # fmt: skip
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            **_no_window_kwargs(),
        )
        try:
            assert proc.stdout is not None and proc.stderr is not None
            while data := proc.stdout.read(SAMPLE_RATE * 2 * READ_CHUNK_S):
                yield np.frombuffer(data[: len(data) // 2 * 2], dtype=np.int16)
            if proc.wait() != 0:
                err = proc.stderr.read().decode("utf-8", "replace").strip()
                raise RuntimeError(f"ffmpeg 转换失败: {err}")
        finally:
            if proc.poll() is None:  # cancelled or failed mid-stream
                proc.kill()
                proc.wait()

    def _decode(
        self, samples: np.ndarray, sample_rate: int
    ) -> tuple[list[str], list[float]]:
        assert self._recognizer is not None
        stream = self._recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self._recognizer.decode_stream(stream)
        return list(stream.result.tokens), list(stream.result.timestamps)

    def _create_corrector(
        self, correction_cb: CorrectionCallback | None
    ) -> StreamingCorrector | None:
        if not self.correction_active():
            return None
        return StreamingCorrector(self._correction_engine, on_update=correction_cb)

    def _transcribe_sync(
        self,
        audio_path: Path,
        progress_cb: ProgressCallback | None = None,
        pause_event: asyncio.Event | None = None,
        cancelled_checker: Callable[[], bool] | None = None,
        correction_cb: CorrectionCallback | None = None,
    ) -> TranscriptionResult:
        duration_ms = probe_duration_ms(audio_path)
        if progress_cb:
            progress_cb(0.0, "准备音频", "")
        if self._check_interrupted(pause_event, cancelled_checker):
            return TranscriptionResult(
                text="", segments=[], duration_ms=duration_ms, cancelled=True
            )
        gain_db = self._measure_loudness_gain(audio_path)
        corrector = self._create_corrector(correction_cb)
        try:
            with closing(self._pcm_chunks(audio_path, gain_db)) as chunks:
                return self._transcribe_stream(
                    chunks,
                    duration_ms,
                    corrector,
                    progress_cb,
                    pause_event,
                    cancelled_checker,
                )
        finally:
            if corrector is not None:
                corrector.cancel()  # no-op once finished; stops LLM calls on cancel/error

    def _transcribe_stream(
        self,
        chunks: Iterable[np.ndarray],
        duration_ms: int,
        corrector: StreamingCorrector | None,
        progress_cb: ProgressCallback | None,
        pause_event: asyncio.Event | None,
        cancelled_checker: Callable[[], bool] | None,
    ) -> TranscriptionResult:
        """Detect speech and recognize while the audio is still being decoded.

        A region that ended in silence is recognized as soon as its tail pad has been read
        (VAD guarantees >= 0.5 s of silence before the next one, more than both pads).
        A region force-split at VAD_MAX_SPEECH_S has no gap, so it waits for the next
        region and its window stops at their midpoint.
        """
        expected = max(1, duration_ms * SAMPLE_RATE // 1000)
        audio = np.zeros(expected + SAMPLE_RATE, dtype=np.int16)
        filled = 0
        vad = self._new_vad()
        pending: list[tuple[int, int]] = []
        prev_end: int | None = None
        fixed_pos = 0
        segments: list[Segment] = []
        raw_text = ""
        reported = -1.0
        before = int(VAD_PAD_BEFORE_S * SAMPLE_RATE)
        after = int(VAD_PAD_AFTER_S * SAMPLE_RATE)
        forced = int((VAD_MAX_SPEECH_S - 0.5) * SAMPLE_RATE)

        def recognize(a: int, b: int) -> None:
            nonlocal raw_text
            samples = audio[a:b].astype(np.float32) / 32768.0
            tokens, stamps = self._decode(samples, SAMPLE_RATE)
            timed = timed_from_tokens(
                tokens,
                stamps,
                offset_ms=a * 1000 // SAMPLE_RATE,
                end_ms=b * 1000 // SAMPLE_RATE,
            )
            if not timed.text:
                return
            new = segments_from_cues(cut_cues(timed), first_index=len(segments))
            segments.extend(new)
            for seg in new:
                raw_text = join_text(raw_text, seg.text)
            if corrector is not None:
                corrector.add(new, timed)

        def recognize_region(region: tuple[int, int], next_start: int | None) -> None:
            nonlocal prev_end
            a, b = region
            lo = (prev_end + a) // 2 if prev_end is not None else 0
            hi = (b + next_start) // 2 if next_start is not None else filled
            recognize(max(lo, a - before), min(hi, b + after))
            prev_end = b

        def report(force: bool) -> None:
            nonlocal reported
            progress = min(1.0, filled / expected) * 0.99
            if progress_cb and (force or progress - reported >= 0.01):
                reported = progress
                progress_cb(progress, "转写中", raw_text)

        for chunk in chunks:
            if self._check_interrupted(pause_event, cancelled_checker):
                text = enhance_text(raw_text)
                return TranscriptionResult(
                    text=text,
                    segments=segments,
                    duration_ms=duration_ms,
                    raw_text=text,
                    cancelled=True,
                )
            if filled + len(chunk) > len(audio):  # duration probe was short
                grow = max(len(chunk), 60 * SAMPLE_RATE)
                audio = np.concatenate([audio, np.zeros(grow, dtype=np.int16)])
            audio[filled : filled + len(chunk)] = chunk
            filled += len(chunk)
            count = len(segments)
            if vad is not None:
                pending.extend(vad.accept(chunk.astype(np.float32) / 32768.0))
                while pending:
                    a, b = pending[0]
                    if (
                        b - a >= forced
                    ):  # no gap after a forced split: need the next start
                        if len(pending) < 2:
                            break
                        recognize_region(pending.pop(0), pending[0][0])
                    elif filled >= b + after:
                        recognize_region(pending.pop(0), None)
                    else:
                        break
            else:
                step = FIXED_CHUNK_S * SAMPLE_RATE
                while filled - fixed_pos >= step:
                    recognize(fixed_pos, fixed_pos + step)
                    fixed_pos += step
            report(force=len(segments) > count)

        if vad is not None:
            pending.extend(vad.flush())
            for k, region in enumerate(pending):
                nxt = pending[k + 1][0] if k + 1 < len(pending) else None
                recognize_region(region, nxt)
        elif fixed_pos < filled:
            recognize(fixed_pos, filled)

        raw_text = enhance_text(raw_text)
        if progress_cb:
            progress_cb(1.0, "转写完成", raw_text)
        result = TranscriptionResult(
            text=raw_text, segments=segments, duration_ms=duration_ms, raw_text=raw_text
        )
        if corrector is None or not segments:
            return result
        batches = corrector.finish(cancelled_checker)
        if batches is None:
            result.cancelled = True
            return result
        corrected_text = ""
        for batch in batches:
            corrected_text = join_text(corrected_text, batch.text)
            cues = (
                [Cue(s.start_ms, s.end_ms, s.text) for s in batch.segments]
                if batch.failed
                else cut_cues(align_corrected(batch.timed, batch.text))
            )
            result.corrected_segments.extend(
                segments_from_cues(cues, first_index=len(result.corrected_segments))
            )
        result.text = corrected_text
        result.correction_failed_batches = sum(b.failed for b in batches)
        return result

    @staticmethod
    def _measure_loudness_gain(audio_path: Path) -> float:
        """Measure integrated loudness (EBU R128) and return gain to target."""
        cmd = [
            "ffmpeg",
            "-nostdin",
            "-t",
            str(LOUDNESS_PROBE_S),
            "-i",
            str(audio_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-af",
            "highpass=f=80,lowpass=f=7800,ebur128",
            "-f",
            "null",
            "-",
        ]
        result = subprocess.run(cmd, **_subprocess_kwargs())
        matches = re.findall(r"I:\s*(-?[\d.]+) LUFS", result.stderr)
        if not matches:
            return 0.0
        integrated = float(matches[-1])
        if integrated <= -70.0:  # silence, nothing to normalize
            return 0.0
        gain = LOUDNESS_TARGET_LUFS - integrated
        return max(-MAX_LOUDNESS_GAIN_DB, min(MAX_LOUDNESS_GAIN_DB, gain))


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
