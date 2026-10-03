"""Tests for deterministic transcript enhancement."""

from __future__ import annotations

from transcript_enhancer import enhance_text


def test_removes_artificial_spaces_between_chinese_segments() -> None:
    result = enhance_text("这是 一段 中文 。 下一句 ？")

    assert result == "这是一段中文。下一句？"


def test_removes_standalone_spoken_fillers() -> None:
    result = enhance_text("嗯，今天我们开始。呃，然后看下一段。")

    assert result == "今天我们开始。然后看下一段。"


def test_collapses_stacked_sentence_punctuation() -> None:
    assert enhance_text("启示了什么样的？。") == "启示了什么样的？"
    assert enhance_text("到了，。他爱") == "到了。他爱"
    assert enhance_text("真的！！") == "真的！！"  # repeated emphasis is kept
    assert enhance_text("Really?.") == "Really?"
