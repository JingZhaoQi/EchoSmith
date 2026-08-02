"""Dual-thread producer-consumer pipeline for ASR + correction."""
from __future__ import annotations

import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import TYPE_CHECKING, Callable

try:
    from asr_engine import Segment
except ImportError:
    from .asr_engine import Segment

if TYPE_CHECKING:
    try:
        from correction_engine import CorrectionEngine
    except ImportError:
        from .correction_engine import CorrectionEngine

SENTINEL = object()

MAX_PRECEDING_CHARS = 500
CONCURRENT_WORKERS = 3


def correction_worker(
    seg_queue: queue.Queue,
    output: list[Segment],
    output_lock: threading.Lock,
    correction_engine: CorrectionEngine | None,
    batch_size: int = 5,
    progress_cb: Callable[[float, str], None] | None = None,
) -> None:
    """Consume segments from queue, correct in batches concurrently.

    Results are written to output progressively as each batch completes,
    maintaining original order.
    """
    # Phase 1: Collect all segments into batches
    all_batches: list[list[Segment]] = []
    buffer: list[Segment] = []

    while True:
        item = seg_queue.get()
        if item is SENTINEL:
            if buffer:
                all_batches.append(buffer)
            break
        buffer.append(item)
        if len(buffer) >= batch_size:
            all_batches.append(buffer)
            buffer = []

    if not all_batches:
        return

    total_batches = len(all_batches)
    total_segments = sum(len(b) for b in all_batches)

    # Phase 2: No correction engine — pass through
    if correction_engine is None:
        with output_lock:
            for batch in all_batches:
                output.extend(batch)
        if progress_cb:
            progress_cb(total_segments, "完成")
        return

    # Phase 3: Concurrent correction with progressive output
    # Pre-allocate slots so we can fill them in order
    results: list[list[str] | None] = [None] * total_batches
    completed_count = 0
    results_lock = threading.Lock()
    # Track how many leading batches are done for progressive output
    next_to_output = 0

    def correct_batch(batch_idx: int, texts: list[str], context: str) -> None:
        nonlocal completed_count, next_to_output
        try:
            corrected = correction_engine.correct(texts, preceding_text=context)
            print(f"[CORRECTION] 批次 {batch_idx + 1}/{total_batches} 完成", flush=True)
        except Exception as exc:
            print(f"[CORRECTION] 批次 {batch_idx + 1} 异常: {exc}", flush=True)
            corrected = texts

        with results_lock:
            results[batch_idx] = corrected
            completed_count += 1

            # Output all consecutive completed batches starting from next_to_output
            while next_to_output < total_batches and results[next_to_output] is not None:
                batch = all_batches[next_to_output]
                corrected_texts = results[next_to_output]
                with output_lock:
                    for seg, ct in zip(batch, corrected_texts):
                        output.append(replace(seg, text=ct))
                next_to_output += 1

            if progress_cb:
                done_segs = sum(len(all_batches[i]) for i in range(next_to_output))
                progress_cb(done_segs, f"智能纠错中 {next_to_output}/{total_batches}")

    # Build contexts and submit
    with ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as pool:
        preceding_text = ""
        for i, batch in enumerate(all_batches):
            texts = [seg.text for seg in batch]
            pool.submit(correct_batch, i, texts, preceding_text)
            preceding_text += "".join(texts)
            if len(preceding_text) > MAX_PRECEDING_CHARS:
                preceding_text = preceding_text[-MAX_PRECEDING_CHARS:]

    # All futures done — ensure any remaining batches are output
    with results_lock:
        while next_to_output < total_batches:
            batch = all_batches[next_to_output]
            corrected_texts = results[next_to_output] or [seg.text for seg in batch]
            with output_lock:
                for seg, ct in zip(batch, corrected_texts):
                    output.append(replace(seg, text=ct))
            next_to_output += 1

    if progress_cb:
        progress_cb(total_segments, f"智能纠错中 {total_batches}/{total_batches}")
