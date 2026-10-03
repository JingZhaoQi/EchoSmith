"""Transcript timing: per-character timestamps from ASR tokens, subtitle cues, alignment and paragraphs."""

from __future__ import annotations

import re
from bisect import bisect_left
from dataclasses import dataclass
from difflib import SequenceMatcher

SENTENCE_END = "。！？!?…"
SOFT_BREAK = "，,；;：:、"
CLOSING = "”’」』）)】》\"'"
CUE_TAIL_MS = 500  # how long a cue stays on screen after its last character starts
CUE_MAX_CJK = 20
CUE_MAX_LATIN = 42


@dataclass
class TimedText:
    """Text with the start time (ms) of every character."""

    text: str
    ms: list[int]
    end_ms: int


@dataclass
class Cue:
    start_ms: int
    end_ms: int
    text: str


def _is_cjk(ch: str) -> bool:
    return "㐀" <= ch <= "鿿" or "豈" <= ch <= "﫿"


def _is_ascii_word(ch: str) -> bool:
    return ch.isascii() and ch.isalnum()


def _needs_space(left: str, right: str) -> bool:
    if _is_ascii_word(right):
        return _is_ascii_word(left) or _is_cjk(left) or left in ".,?!;:)\"'"
    return _is_ascii_word(left) and _is_cjk(right)


def join_text(left: str, right: str) -> str:
    """Join two transcript pieces: no space between CJK, one space around Latin words."""
    left, right = left.rstrip(), right.lstrip()
    if not left or not right:
        return left + right
    return left + (" " if _needs_space(left[-1], right[0]) else "") + right


def concat(left: TimedText, right: TimedText) -> TimedText:
    """join_text for timed text; an inserted space takes the time of the next character."""
    if not left.text:
        return right
    if not right.text:
        return TimedText(left.text, left.ms, max(left.end_ms, right.end_ms))
    gap = " " if _needs_space(left.text[-1], right.text[0]) else ""
    ms = left.ms + ([right.ms[0]] if gap else []) + right.ms
    return TimedText(left.text + gap + right.text, ms, right.end_ms)


def timed_from_tokens(
    tokens: list[str], timestamps: list[float], offset_ms: int, end_ms: int
) -> TimedText:
    """Spread each token's start time over its characters; trims surrounding whitespace."""
    text_parts: list[str] = []
    ms: list[int] = []
    starts = [offset_ms + round(t * 1000) for t in timestamps]
    for k, token in enumerate(tokens):
        t0 = starts[k]
        t1 = starts[k + 1] if k + 1 < len(starts) else t0
        for j, ch in enumerate(token):
            text_parts.append(ch)
            ms.append(round(t0 + (t1 - t0) * j / len(token)))
    text = "".join(text_parts)
    lead = len(text) - len(text.lstrip())
    trail = len(text.rstrip())
    return TimedText(text[lead:trail], ms[lead:trail], end_ms)


def _max_chars(text: str) -> int:
    cjk = sum(_is_cjk(c) for c in text)
    return CUE_MAX_CJK if cjk * 2 >= len(text.replace(" ", "")) else CUE_MAX_LATIN


def _sentence_ends_at(text: str, i: int) -> bool:
    ch = text[i]
    if ch == ".":
        return i + 1 == len(text) or text[i + 1] == " "
    return ch in SENTENCE_END


def cut_cues(tt: TimedText, max_chars: int | None = None) -> list[Cue]:
    """Split timed text into subtitle cues: at sentence ends, then at soft breaks / spaces when too long."""
    text = tt.text
    limit = max_chars or _max_chars(text)
    spans: list[tuple[int, int]] = []
    start = 0
    i = 0
    while i < len(text):
        if _sentence_ends_at(text, i):
            end = i + 1
            while end < len(text) and (
                text[end] in SENTENCE_END or text[end] in CLOSING
            ):
                end += 1
            spans.append((start, end))
            start = i = end
            continue
        if i + 1 - start > limit:
            # prefer a pause mark that keeps the cue reasonably full, then the last space, then a hard cut
            soft = [k + 1 for k in range(start + 3, i) if text[k] in SOFT_BREAK]
            spaces = [k + 1 for k in range(start + 3, i) if text[k] == " "]
            if soft and soft[-1] - start >= limit * 0.4:
                cut = soft[-1]
            else:
                cut = spaces[-1] if spaces else (soft[-1] if soft else i)
            spans.append((start, cut))
            start = i = cut
            continue
        i += 1
    if start < len(text):
        spans.append((start, len(text)))

    cues: list[Cue] = []
    for a, b in spans:
        while a < b and text[a] == " ":
            a += 1
        while b > a and text[b - 1] == " ":
            b -= 1
        if a < b:
            cues.append(Cue(tt.ms[a], tt.ms[b - 1], text[a:b]))
    for k, cue in enumerate(cues):
        nxt = cues[k + 1].start_ms if k + 1 < len(cues) else tt.end_ms
        cue.end_ms = max(
            cue.start_ms + 1, min(nxt, cue.end_ms + CUE_TAIL_MS, tt.end_ms)
        )
    return cues


def _norm_index(text: str) -> tuple[str, list[int]]:
    keep = [(i, ch.lower()) for i, ch in enumerate(text) if ch.isalnum()]
    return "".join(ch for _, ch in keep), [i for i, _ in keep]


def align_corrected(raw: TimedText, corrected: str) -> TimedText:
    """Give every character of the corrected text a time by matching it against the raw text."""
    if not raw.text:
        return TimedText(corrected, [0] * len(corrected), raw.end_ms)
    rn, rmap = _norm_index(raw.text)
    cn, cmap = _norm_index(corrected)
    known: dict[int, int] = {}
    for block in SequenceMatcher(None, rn, cn, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            known[cmap[block.b + k]] = raw.ms[rmap[block.a + k]]
    ms: list[int | None] = [known.get(i) for i in range(len(corrected))]
    anchors = sorted(known)
    first, last = raw.ms[0], raw.ms[-1]
    for i in range(len(corrected)):
        if ms[i] is not None:
            continue
        k = bisect_left(anchors, i)
        prev = anchors[k - 1] if k > 0 else None
        nxt = anchors[k] if k < len(anchors) else None
        t_prev = known[prev] if prev is not None else first
        t_next = known[nxt] if nxt is not None else last
        p_idx = prev if prev is not None else -1
        n_idx = nxt if nxt is not None else len(corrected)
        ms[i] = round(t_prev + (t_next - t_prev) * (i - p_idx) / (n_idx - p_idx))
    out: list[int] = []
    for t in ms:
        out.append(max(out[-1], t) if out else t)  # type: ignore[arg-type]
    return TimedText(corrected, out, raw.end_ms)


PARAGRAPH_PAUSE_MS = 2000
PARAGRAPH_MAX_CHARS = 300


def paragraphs(
    cues: list[Cue],
    pause_ms: int = PARAGRAPH_PAUSE_MS,
    max_chars: int = PARAGRAPH_MAX_CHARS,
) -> list[str]:
    """Group cues into paragraphs at long pauses, or at a sentence end once a paragraph gets long."""
    out: list[str] = []
    current = ""
    prev: Cue | None = None
    for cue in cues:
        if prev is not None and current:
            long_pause = cue.start_ms - prev.end_ms >= pause_ms
            too_long = len(current) >= max_chars and re.search(
                r"[。！？!?….]\W*$", current
            )
            if long_pause or too_long:
                out.append(current)
                current = ""
        current = join_text(current, cue.text)
        prev = cue
    if current:
        out.append(current)
    return out
