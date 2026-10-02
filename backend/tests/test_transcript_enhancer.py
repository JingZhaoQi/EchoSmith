"""Tests for deterministic transcript enhancement."""

from __future__ import annotations

from asr_engine import Segment
from transcript_enhancer import enhance_segments, enhance_text


def test_removes_artificial_spaces_between_chinese_segments() -> None:
    result = enhance_text("这是 一段 中文 。 下一句 ？")

    assert result == "这是一段中文。下一句？"


def test_removes_standalone_spoken_fillers() -> None:
    result = enhance_text("嗯，今天我们开始。呃，然后看下一段。")

    assert result == "今天我们开始。然后看下一段。"


def test_enhance_segments_preserves_timestamps_and_indexes() -> None:
    segments = [
        Segment(index=3, start_ms=1200, end_ms=2400, text="嗯，开始 。"),
    ]

    enhanced = enhance_segments(segments)

    assert enhanced[0].index == 3
    assert enhanced[0].start_ms == 1200
    assert enhanced[0].end_ms == 2400
    assert enhanced[0].text == "开始。"
