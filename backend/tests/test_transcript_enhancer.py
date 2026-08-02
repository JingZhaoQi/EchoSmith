"""Tests for deterministic transcript enhancement."""

from __future__ import annotations

from asr_engine import Segment
from transcript_enhancer import EnhancementOptions, enhance_segments, enhance_text


def test_removes_artificial_spaces_between_chinese_segments() -> None:
    options = EnhancementOptions(accuracy_mode="balanced", domain_profile="general")

    result = enhance_text("这是 一段 中文 。 下一句 ？", options)

    assert result == "这是一段中文。下一句？"


def test_sermon_profile_restores_common_homophone_errors() -> None:
    options = EnhancementOptions(accuracy_mode="balanced", domain_profile="sermon")

    result = enhance_text("我们一起岛高尔，来到斯温的保座，仰望基录的恩点。", options)

    assert result == "我们一起祷告，来到施恩的宝座，仰望基督的恩典。"


def test_sermon_profile_restores_observed_long_audio_terms() -> None:
    options = EnhancementOptions(accuracy_mode="accurate", domain_profile="sermon")

    result = enhance_text(
        "按年以前，雅各过了玉览河，带着加券回来。"
        "真大的的赐福，使书们见证福音。组长需要呼教学意识，"
        "在心神病里分辨福印、经门和属林的眼睛，也谈到苏房市场。",
        options,
    )

    assert result == (
        "八年以前，雅各过了约旦河，带着家眷回来。"
        "神大大的赐福，使我们见证福音。组长需要护教学意识，"
        "在新生命里分辨福音、经文和属灵的眼睛，也谈到租房市场。"
    )


def test_fast_mode_keeps_spoken_fillers() -> None:
    options = EnhancementOptions(accuracy_mode="fast", domain_profile="general")

    result = enhance_text("嗯，今天我们开始。", options)

    assert result == "嗯，今天我们开始。"


def test_balanced_mode_removes_standalone_spoken_fillers() -> None:
    options = EnhancementOptions(accuracy_mode="balanced", domain_profile="general")

    result = enhance_text("嗯，今天我们开始。呃，然后看下一段。", options)

    assert result == "今天我们开始。然后看下一段。"


def test_enhance_segments_preserves_timestamps_and_indexes() -> None:
    options = EnhancementOptions(accuracy_mode="balanced", domain_profile="sermon")
    segments = [
        Segment(index=3, start_ms=1200, end_ms=2400, text="岛高尔 。"),
    ]

    enhanced = enhance_segments(segments, options)

    assert enhanced[0].index == 3
    assert enhanced[0].start_ms == 1200
    assert enhanced[0].end_ms == 2400
    assert enhanced[0].text == "祷告。"
