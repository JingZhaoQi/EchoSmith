"""Tests for transcript export formats."""

from __future__ import annotations

from exporters import EXPORT_FORMATS, render_export

CUES = [
    {
        "index": 0,
        "start_ms": 1_000,
        "end_ms": 3_500,
        "text": "弟兄姐妹们，今天读约翰福音。",
    },
    {"index": 1, "start_ms": 3_600, "end_ms": 5_000, "text": "他爱他们到底。"},
    {"index": 2, "start_ms": 9_000, "end_ms": 61_234, "text": "新的一段。"},
]


def test_formats_are_txt_srt_md() -> None:
    assert set(EXPORT_FORMATS) == {"txt", "srt", "md"}


def test_srt_uses_cue_times_verbatim() -> None:
    body, media = render_export("srt", "讲道", CUES, "")
    assert media == "application/x-subrip"
    assert body.startswith(
        "1\n00:00:01,000 --> 00:00:03,500\n弟兄姐妹们，今天读约翰福音。\n"
    )
    assert "3\n00:00:09,000 --> 00:01:01,234\n新的一段。\n" in body


def test_markdown_title_and_pause_paragraphs_without_timecodes() -> None:
    body, media = render_export("md", "约13-21-38-1", CUES, "")
    assert media == "text/markdown"
    assert (
        body
        == "# 约13-21-38-1\n\n弟兄姐妹们，今天读约翰福音。他爱他们到底。\n\n新的一段。\n"
    )


def test_txt_is_paragraphs() -> None:
    body, _ = render_export("txt", "x", CUES, "")
    assert body == "弟兄姐妹们，今天读约翰福音。他爱他们到底。\n\n新的一段。\n"


def test_falls_back_to_plain_text_without_cues() -> None:
    assert render_export("txt", "x", [], "只有文本")[0] == "只有文本\n"
    assert render_export("md", "x", [], "只有文本")[0] == "# x\n\n只有文本\n"
    assert render_export("srt", "x", [], "只有文本")[0] == ""  # no invented timing


def test_unknown_format_raises() -> None:
    import pytest

    with pytest.raises(KeyError):
        render_export("json", "x", CUES, "")
