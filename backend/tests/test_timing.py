"""Tests for transcript timing: token timestamps → cues, text joining, alignment, paragraphs."""

from __future__ import annotations

from timing import (
    TimedText,
    align_corrected,
    cut_cues,
    join_text,
    paragraphs,
    timed_from_tokens,
)


def test_join_text_spaces_only_between_latin_words() -> None:
    assert join_text("今天。", "明天") == "今天。明天"
    assert join_text("hours.", "Every") == "hours. Every"
    assert join_text("讲到 GPT", "模型") == "讲到 GPT 模型"
    assert join_text("", "abc") == "abc"
    assert join_text("abc ", " def") == "abc def"


def test_timed_from_tokens_offsets_and_interpolates_multichar_tokens() -> None:
    tt = timed_from_tokens(
        ["4", "7", " hours", "."],
        [0.3, 0.6, 0.96, 2.46],
        offset_ms=10_000,
        end_ms=13_000,
    )
    assert tt.text == "47 hours."
    assert tt.ms[0] == 10_300 and tt.ms[1] == 10_600
    # " hours" spans 10_960 → 12_460 across its 6 characters
    assert tt.ms[2] == 10_960
    assert 10_960 < tt.ms[5] < 12_460
    assert tt.ms[-1] == 12_460
    assert tt.end_ms == 13_000


def test_cut_cues_uses_real_char_times() -> None:
    text = "弟兄姐妹们，今天读约翰福音第十三章。他爱他们到底。"
    ms = [i * 200 for i in range(len(text))]
    cues = cut_cues(TimedText(text, ms, end_ms=len(text) * 200 + 300), max_chars=40)
    assert [c.text for c in cues] == [
        "弟兄姐妹们，今天读约翰福音第十三章。",
        "他爱他们到底。",
    ]
    second = text.index("他")
    assert cues[0].start_ms == 0
    assert cues[1].start_ms == second * 200
    assert cues[0].end_ms <= cues[1].start_ms


def test_cut_cues_splits_long_sentences_at_commas_then_length() -> None:
    text = "这是一个非常长的句子，后面还有很多很多内容需要继续说下去直到超过上限为止。"
    ms = list(range(0, len(text) * 100, 100))
    cues = cut_cues(TimedText(text, ms, end_ms=len(text) * 100), max_chars=16)
    assert all(len(c.text) <= 16 for c in cues)
    assert "".join(c.text for c in cues) == text
    assert cues[0].text.endswith("，")


def test_cut_cues_end_does_not_cover_long_pause() -> None:
    text = "第一句。第二句。"
    ms = [0, 200, 400, 600, 10_000, 10_200, 10_400, 10_600]
    cues = cut_cues(TimedText(text, ms, end_ms=11_000), max_chars=20)
    assert cues[0].end_ms < 2_000  # does not stretch over the 9 s silence
    assert cues[1].start_ms == 10_000


def test_align_corrected_maps_fixed_words_onto_raw_times() -> None:
    raw = TimedText(
        "主耶稣在于月结以前。犹大心里。", [i * 100 for i in range(15)], end_ms=1_600
    )
    corrected = "主耶稣在逾越节以前，犹大心里。"
    tt = align_corrected(raw, corrected)
    assert tt.text == corrected
    assert len(tt.ms) == len(corrected)
    assert tt.ms == sorted(tt.ms)
    # "犹" keeps its raw timestamp
    assert tt.ms[corrected.index("犹")] == raw.ms[raw.text.index("犹")]
    # replaced word lies between its neighbours
    assert raw.ms[3] <= tt.ms[corrected.index("逾")] <= raw.ms[8]


def test_paragraphs_break_on_long_pauses() -> None:
    from timing import Cue

    cues = [
        Cue(0, 1000, "第一句。"),
        Cue(1100, 2000, "第二句。"),
        Cue(6000, 7000, "新段落。"),
    ]
    assert paragraphs(cues) == ["第一句。第二句。", "新段落。"]


def test_default_cue_length_fits_one_subtitle_line() -> None:
    zh = "这是一个很长的字幕文本如果直接放在同一行里面播放器就会截断显示影响观看体验"
    en = "This is a long subtitle line that should wrap without overflowing the video frame"
    for text, limit in ((zh, 20), (en, 42)):
        cues = cut_cues(
            TimedText(
                text, list(range(0, len(text) * 100, 100)), end_ms=len(text) * 100
            )
        )
        assert all(len(c.text) <= limit for c in cues)
        assert join_text("", " ".join(c.text for c in cues)).replace(
            " ", ""
        ) == text.replace(" ", "")


def test_long_latin_sentence_breaks_at_commas_before_spaces() -> None:
    text = "47 hours of interviews, every word matters, typing it all out would take weeks."
    cues = cut_cues(
        TimedText(text, list(range(0, len(text) * 50, 50)), end_ms=len(text) * 50)
    )
    assert [c.text for c in cues] == [
        "47 hours of interviews,",
        "every word matters,",
        "typing it all out would take weeks.",
    ]
