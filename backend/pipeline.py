"""Dual-thread producer-consumer pipeline for ASR + correction."""
from __future__ import annotations

import queue
import threading
from dataclasses import replace
from typing import TYPE_CHECKING, Callable

from asr_engine import Segment

if TYPE_CHECKING:
    from correction_engine import CorrectionEngine

SENTINEL = object()

MAX_PRECEDING_CHARS = 500


def correction_worker(
    seg_queue: queue.Queue,
    output: list[Segment],
    output_lock: threading.Lock,
    correction_engine: CorrectionEngine | None,
    batch_size: int = 5,
    progress_cb: Callable[[float, str], None] | None = None,
) -> None:
    """Consume segments from queue, correct in batches, append to output.

    If correction_engine is None or has no model, segments pass through
    unchanged. If correction raises, original text is preserved.
    """
    buffer: list[Segment] = []
    preceding_text = ""
    total_corrected = 0

    def flush(batch: list[Segment]) -> None:
        nonlocal preceding_text, total_corrected
        if not batch:
            return

        texts = [seg.text for seg in batch]

        if correction_engine and correction_engine.has_model():
            try:
                corrected_texts = correction_engine.correct(
                    texts, preceding_text=preceding_text
                )
            except Exception:
                corrected_texts = texts
        else:
            corrected_texts = texts

        with output_lock:
            for seg, corrected in zip(batch, corrected_texts):
                output.append(replace(seg, text=corrected))

        preceding_text += "".join(corrected_texts)
        if len(preceding_text) > MAX_PRECEDING_CHARS:
            preceding_text = preceding_text[-MAX_PRECEDING_CHARS:]

        total_corrected += len(batch)
        if progress_cb:
            progress_cb(total_corrected, "智能纠错中")

    while True:
        item = seg_queue.get()
        if item is SENTINEL:
            flush(buffer)
            break
        buffer.append(item)
        if len(buffer) >= batch_size:
            flush(buffer)
            buffer = []
