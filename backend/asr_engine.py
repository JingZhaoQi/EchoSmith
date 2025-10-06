"""ASR engine and audio utilities for EchoSmith backend."""
from __future__ import annotations

import asyncio
import math
import os
import re
import shlex
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional

from funasr import AutoModel

CHUNK_DURATION_MS = 15_000
MODEL_CARD = "FunASR Paraformer Large (zh-CN)"
MODEL_ROOT = Path(__file__).resolve().parent.parent / "models"


@dataclass
class Segment:
    index: int
    start_ms: int
    end_ms: int
    text: str


@dataclass
class TranscriptionResult:
    text: str
    segments: List[Segment]
    duration_ms: int


ProgressCallback = Callable[[float, str, str], None]

SENTENCE_PATTERN = re.compile(r"[^。！？!?…\n]+[。！？!?…]+|[^。！？!?…\n]+", re.UNICODE)


def _split_sentences(text: str) -> List[str]:
    """Split text into sentences while keeping ending punctuation."""
    if not text:
        return []
    sentences = [segment.strip() for segment in SENTENCE_PATTERN.findall(text) if segment.strip()]
    return sentences


class ASREngine:
    """Stateful ASR engine that wraps FunASR for repeated use."""

    def __init__(self, chunk_duration_ms: int = CHUNK_DURATION_MS) -> None:
        self._model: Optional[AutoModel] = None
        self._model_lock = asyncio.Lock()
        self.chunk_duration_ms = chunk_duration_ms

    async def ensure_model(self) -> None:
        async with self._model_lock:
            if self._model is not None:
                return

            model_paths = {
                "model": MODEL_ROOT / "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                "vad": MODEL_ROOT / "speech_fsmn_vad_zh-cn-16k-common-pytorch",
                "punc": MODEL_ROOT / "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
            }
            missing = [key for key, path in model_paths.items() if not path.exists()]
            if missing:
                missing_desc = "\n".join(f"- {model_paths[key]}" for key in missing)
                raise FileNotFoundError(
                    "缺少 FunASR 模型文件，请将模型复制到 models/ 目录:\n" + missing_desc
                )

            self._model = AutoModel(
                model=str(model_paths["model"]),
                vad_model=str(model_paths["vad"]),
                punc_model=str(model_paths["punc"]),
                disable_update=True,
            )

    async def transcribe(
        self,
        audio_path: Path,
        progress_cb: Optional[ProgressCallback] = None,
        pause_event: Optional[asyncio.Event] = None,
        cancelled_checker: Optional[Callable[[], bool]] = None,
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
        progress_cb: Optional[ProgressCallback] = None,
        pause_event: Optional[asyncio.Event] = None,
        cancelled_checker: Optional[Callable[[], bool]] = None,
    ) -> TranscriptionResult:
        assert self._model is not None

        duration_ms = probe_duration_ms(audio_path)
        chunk_count = max(1, math.ceil(duration_ms / self.chunk_duration_ms))

        accumulated: List[Segment] = []
        partial_text = ""

        for index in range(chunk_count):
            if cancelled_checker and cancelled_checker():
                break

            if pause_event is not None:
                while not pause_event.is_set():
                    if cancelled_checker and cancelled_checker():
                        break
                    time.sleep(0.1)
                if cancelled_checker and cancelled_checker():
                    break

            start_ms = index * self.chunk_duration_ms
            end_ms = min((index + 1) * self.chunk_duration_ms, duration_ms)
            span_ms = end_ms - start_ms

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                tmp_path = Path(tmp_file.name)

            try:
                slice_chunk(audio_path, start_ms, span_ms, tmp_path)
                result = self._model.generate(input=str(tmp_path), batch_size_s=300)
            finally:
                if tmp_path.exists():
                    tmp_path.unlink(missing_ok=True)

            text_segment = ""
            if result:
                first = result[0]
                if isinstance(first, dict):
                    text_segment = str(first.get("text", "")).strip()
                else:
                    text_segment = str(first).strip()

            if text_segment:
                sentences = _split_sentences(text_segment) or [text_segment.strip()]
                sentences = [sentence for sentence in sentences if sentence]
                if sentences:
                    total_chars = sum(len(sentence) for sentence in sentences)
                    prev_end = start_ms
                    cumulative_chars = 0
                    total_sentences = len(sentences)
                    for sentence_index, sentence_text in enumerate(sentences):
                        cumulative_chars += len(sentence_text)
                        if total_chars > 0 and sentence_index < total_sentences - 1:
                            proportion = cumulative_chars / total_chars
                            current_end = start_ms + int(round(span_ms * proportion))
                        else:
                            current_end = end_ms
                        if current_end <= prev_end:
                            min_step = max(1, span_ms // max(total_sentences, 1))
                            current_end = min(end_ms, prev_end + min_step)
                        segment = Segment(
                            index=len(accumulated),
                            start_ms=prev_end,
                            end_ms=current_end,
                            text=sentence_text,
                        )
                        accumulated.append(segment)
                        prev_end = current_end
                    partial_text = " ".join(seg.text for seg in accumulated).strip()

            if progress_cb:
                progress = (index + 1) / chunk_count
                progress_cb(progress, f"chunk {index + 1}/{chunk_count}", partial_text)

        final_text = partial_text
        return TranscriptionResult(text=final_text, segments=accumulated, duration_ms=duration_ms)


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


def slice_chunk(audio_path: Path, start_ms: int, duration_ms: int, output_path: Path) -> None:
    """Extract a mono 16 kHz WAV chunk using ffmpeg."""
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_ms / 1000:.3f}",
        "-i",
        str(audio_path),
        "-t",
        f"{duration_ms / 1000:.3f}",
        "-ac",
        "1",
        "-ar",
        "16000",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 截取失败: {result.stderr.strip()}")
