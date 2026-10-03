from __future__ import annotations

from transcription_metrics import (
    character_accuracy,
    chars_per_minute,
    normalize_transcript,
    passes_thresholds,
)


def test_normalize_transcript_removes_markdown_and_punctuation() -> None:
    text = """# 底稿

> 约翰福音 13:21-38
弟兄姊妹，大家主日平安。
<|zh|><|SPEECH|>
"""

    normalized = normalize_transcript(text)

    assert normalized == "约翰福音132138弟兄姊妹大家主日平安"


def test_normalize_transcript_can_keep_markdown_heading_text() -> None:
    text = "# 讲道逐字稿\n正文。"

    normalized = normalize_transcript(text, strip_markdown_headings=False)

    assert normalized == "讲道逐字稿正文"


def test_character_accuracy_reports_edit_distance_and_lengths() -> None:
    result = character_accuracy("约翰福音十三章", "约翰福音三章")

    assert result.edit_distance == 1
    assert result.reference_chars == 7
    assert result.hypothesis_chars == 6
    assert result.cer == 1 / 7
    assert result.accuracy == 1 - 1 / 7


def test_character_accuracy_handles_empty_reference() -> None:
    assert character_accuracy("", "").accuracy == 1.0
    assert character_accuracy("", "多余文本").accuracy == 0.0


def test_chars_per_minute_and_thresholds() -> None:
    speed = chars_per_minute(chars=10_000, elapsed_seconds=240)

    assert speed == 2500
    assert passes_thresholds(accuracy=0.951, chars_per_min=speed)
    assert not passes_thresholds(accuracy=0.949, chars_per_min=speed)
    assert not passes_thresholds(accuracy=0.951, chars_per_min=1999)
