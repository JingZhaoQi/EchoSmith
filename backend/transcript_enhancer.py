"""Deterministic transcript cleanup for ASR output."""

from __future__ import annotations

import re

_CJK = r"㐀-䶿一-鿿"
_PUNCT = "。！？!?，,；;：:、"
_FILLER_PATTERN = re.compile(rf"(^|[{_PUNCT}\n])\s*(嗯|呃|额|啊)[，,、\s]+")


def enhance_text(text: str) -> str:
    cleaned = _normalize_spacing(text or "")
    cleaned = _remove_spoken_fillers(cleaned)
    cleaned = _normalize_spacing(cleaned)
    cleaned = _normalize_punctuation(cleaned)
    return cleaned.strip()


def _normalize_spacing(text: str) -> str:
    text = re.sub(rf"(?<=[{_CJK}])\s+(?=[{_CJK}])", "", text)
    text = re.sub(rf"\s+([{_PUNCT}])", r"\1", text)
    text = re.sub(rf"([{_PUNCT}])\s+(?=[{_CJK}])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text


def _normalize_punctuation(text: str) -> str:
    """SenseVoice sometimes stacks marks ("？。", "，。"): keep the stronger one."""
    text = re.sub(r"([？！?!])[。.]+", r"\1", text)
    return re.sub(r"[，,、]+([。！？.!?])", r"\1", text)


def _remove_spoken_fillers(text: str) -> str:
    previous = None
    result = text
    while result != previous:
        previous = result
        result = _FILLER_PATTERN.sub(r"\1", result)
    return result
