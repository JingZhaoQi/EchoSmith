"""Tests for SRT export formatting."""
from __future__ import annotations

from app import _segments_to_srt


def _subtitle_text_lines(srt_body: str) -> list[str]:
    lines: list[str] = []
    for line in srt_body.splitlines():
        if not line or line.isdigit() or "-->" in line:
            continue
        lines.append(line)
    return lines


def test_srt_export_wraps_long_chinese_subtitle_lines() -> None:
    text = "这是一个很长的字幕文本如果直接放在同一行里面播放器就会截断显示影响观看体验"

    srt_body = _segments_to_srt(
        [
            {
                "start_ms": 0,
                "end_ms": 6000,
                "text": text,
            }
        ]
    )

    subtitle_lines = _subtitle_text_lines(srt_body)

    assert subtitle_lines
    assert all(len(line) <= 20 for line in subtitle_lines)
    assert "\n".join(subtitle_lines).replace("\n", "") == text


def test_srt_export_wraps_long_space_separated_subtitle_lines() -> None:
    text = "This is a long subtitle line that should wrap without overflowing the video frame"

    srt_body = _segments_to_srt(
        [
            {
                "start_ms": 0,
                "end_ms": 6000,
                "text": text,
            }
        ]
    )

    subtitle_lines = _subtitle_text_lines(srt_body)

    assert subtitle_lines
    assert all(len(line) <= 20 for line in subtitle_lines)
    assert " ".join(subtitle_lines).replace("  ", " ") == text
