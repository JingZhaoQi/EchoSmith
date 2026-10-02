"""Deterministic transcript cleanup for ASR output."""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Any

_CJK = r"㐀-䶿一-鿿"
_PUNCT = "。！？!?，,；;：:、"
_FILLER_PATTERN = re.compile(rf"(^|[{_PUNCT}\n])\s*(嗯|呃|额|啊)[，,、\s]+")


def enhance_text(text: str) -> str:
    cleaned = _normalize_spacing(text or "")
    cleaned = _remove_spoken_fillers(cleaned)
    cleaned = _normalize_spacing(cleaned)
    return cleaned.strip()


def enhance_segments(segments: list[Any]) -> list[Any]:
    enhanced: list[Any] = []
    for segment in segments:
        text = enhance_text(getattr(segment, "text", ""))
        enhanced.append(replace(segment, text=text))
    return enhanced


def _normalize_spacing(text: str) -> str:
    text = re.sub(rf"(?<=[{_CJK}])\s+(?=[{_CJK}])", "", text)
    text = re.sub(rf"\s+([{_PUNCT}])", r"\1", text)
    text = re.sub(rf"([{_PUNCT}])\s+(?=[{_CJK}])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text


def _remove_spoken_fillers(text: str) -> str:
    previous = None
    result = text
    while result != previous:
        previous = result
        result = _FILLER_PATTERN.sub(r"\1", result)
    return result
