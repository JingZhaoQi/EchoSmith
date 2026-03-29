"""Tests for the dual-thread correction pipeline."""
from __future__ import annotations

import queue
import threading
from unittest.mock import MagicMock

import pytest

from correction_engine import CorrectionEngine
from asr_engine import Segment


def test_producer_consumer_flow() -> None:
    """Verify segments flow through queue and get corrected."""
    from pipeline import correction_worker, SENTINEL

    seg_queue: queue.Queue = queue.Queue()
    corrected_segments: list[Segment] = []
    lock = threading.Lock()

    # Mock correction engine
    mock_engine = MagicMock(spec=CorrectionEngine)
    mock_engine.has_model.return_value = True
    mock_engine.correct.side_effect = lambda segs, **kw: [
        s.replace("original", "corrected") for s in segs
    ]

    # Feed segments
    input_segments = [
        Segment(index=i, start_ms=i * 1000, end_ms=(i + 1) * 1000, text=f"original{i}.")
        for i in range(7)
    ]

    for seg in input_segments:
        seg_queue.put(seg)
    seg_queue.put(SENTINEL)

    # Run worker
    correction_worker(
        seg_queue=seg_queue,
        output=corrected_segments,
        output_lock=lock,
        correction_engine=mock_engine,
        batch_size=5,
        progress_cb=None,
    )

    assert len(corrected_segments) == 7
    assert all("corrected" in s.text for s in corrected_segments)
    # Called twice: batch of 5 + flush of 2
    assert mock_engine.correct.call_count == 2


def test_pipeline_without_correction_engine() -> None:
    """When engine is None, segments pass through unchanged."""
    from pipeline import correction_worker, SENTINEL

    seg_queue: queue.Queue = queue.Queue()
    corrected_segments: list[Segment] = []
    lock = threading.Lock()

    input_segments = [
        Segment(index=0, start_ms=0, end_ms=1000, text="unchanged.")
    ]
    for seg in input_segments:
        seg_queue.put(seg)
    seg_queue.put(SENTINEL)

    correction_worker(
        seg_queue=seg_queue,
        output=corrected_segments,
        output_lock=lock,
        correction_engine=None,
        batch_size=5,
        progress_cb=None,
    )

    assert len(corrected_segments) == 1
    assert corrected_segments[0].text == "unchanged."


def test_pipeline_correction_failure_keeps_original() -> None:
    """If LLM raises, original text is preserved."""
    from pipeline import correction_worker, SENTINEL

    seg_queue: queue.Queue = queue.Queue()
    corrected_segments: list[Segment] = []
    lock = threading.Lock()

    mock_engine = MagicMock(spec=CorrectionEngine)
    mock_engine.has_model.return_value = True
    mock_engine.correct.side_effect = RuntimeError("LLM crashed")

    seg_queue.put(Segment(index=0, start_ms=0, end_ms=1000, text="keep original."))
    seg_queue.put(SENTINEL)

    correction_worker(
        seg_queue=seg_queue,
        output=corrected_segments,
        output_lock=lock,
        correction_engine=mock_engine,
        batch_size=5,
        progress_cb=None,
    )

    assert corrected_segments[0].text == "keep original."
