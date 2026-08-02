"""Reusable transcript accuracy and speed metrics."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


ASR_METADATA_PATTERN = re.compile(r"<\|[^>]*?\|>")
MARKDOWN_HEADING_PATTERN = re.compile(r"^\s{0,3}#{1,6}\s+.*$", re.MULTILINE)
MARKDOWN_QUOTE_PATTERN = re.compile(r"^\s{0,3}>\s?", re.MULTILINE)


@dataclass(frozen=True)
class AccuracyResult:
    accuracy: float
    cer: float
    edit_distance: int
    reference_chars: int
    hypothesis_chars: int


def normalize_transcript(text: str, *, strip_markdown_headings: bool = True) -> str:
    """Normalize transcript text before character-level comparison."""
    cleaned = ASR_METADATA_PATTERN.sub("", text or "")
    if strip_markdown_headings:
        cleaned = MARKDOWN_HEADING_PATTERN.sub("", cleaned)
    cleaned = MARKDOWN_QUOTE_PATTERN.sub("", cleaned)
    cleaned = cleaned.lower()

    return "".join(ch for ch in cleaned if _is_counted_char(ch))


def character_accuracy(reference: str, hypothesis: str) -> AccuracyResult:
    """Return normalized character accuracy based on Levenshtein distance."""
    ref = normalize_transcript(reference)
    hyp = normalize_transcript(hypothesis)
    distance = levenshtein_distance(ref, hyp)

    if not ref:
        accuracy = 1.0 if not hyp else 0.0
        cer = 0.0 if not hyp else 1.0
    else:
        cer = distance / len(ref)
        accuracy = max(0.0, 1.0 - cer)

    return AccuracyResult(
        accuracy=accuracy,
        cer=cer,
        edit_distance=distance,
        reference_chars=len(ref),
        hypothesis_chars=len(hyp),
    )


def levenshtein_distance(reference: str, hypothesis: str) -> int:
    """Compute edit distance with Myers' bit-vector algorithm."""
    if reference == hypothesis:
        return 0
    if not reference:
        return len(hypothesis)
    if not hypothesis:
        return len(reference)

    pattern, text = reference, hypothesis
    if len(pattern) > len(text):
        pattern, text = text, pattern

    char_masks: dict[str, int] = {}
    for index, char in enumerate(pattern):
        char_masks[char] = char_masks.get(char, 0) | (1 << index)

    pattern_len = len(pattern)
    top_bit = 1 << (pattern_len - 1)
    all_bits = (1 << pattern_len) - 1
    positive = all_bits
    negative = 0
    distance = pattern_len

    for char in text:
        equality = char_masks.get(char, 0)
        vertical = equality | negative
        horizontal = (((equality & positive) + positive) ^ positive) | equality
        positive_horizontal = negative | ~(horizontal | positive)
        negative_horizontal = positive & horizontal

        if positive_horizontal & top_bit:
            distance += 1
        elif negative_horizontal & top_bit:
            distance -= 1

        positive_horizontal = ((positive_horizontal << 1) | 1) & all_bits
        negative_horizontal = (negative_horizontal << 1) & all_bits
        positive = (negative_horizontal | ~(vertical | positive_horizontal)) & all_bits
        negative = (positive_horizontal & vertical) & all_bits

    return distance


def chars_per_minute(chars: int, elapsed_seconds: float) -> float:
    if elapsed_seconds <= 0:
        return 0.0
    return chars / elapsed_seconds * 60


def passes_thresholds(
    *,
    accuracy: float,
    chars_per_min: float,
    min_accuracy: float = 0.95,
    min_chars_per_min: float = 2000,
) -> bool:
    return accuracy >= min_accuracy and chars_per_min >= min_chars_per_min


def _is_counted_char(ch: str) -> bool:
    category = unicodedata.category(ch)
    return category[0] in {"L", "N"}
