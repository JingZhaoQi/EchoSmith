"""Render a transcript as TXT / SRT / Markdown from timed cues."""

from __future__ import annotations

from typing import Any, Callable

try:
    from timing import Cue, paragraphs
except ImportError:
    from .timing import Cue, paragraphs


def _cues(items: list[dict[str, Any]]) -> list[Cue]:
    return [Cue(int(c["start_ms"]), int(c["end_ms"]), str(c["text"])) for c in items]


def _body(items: list[dict[str, Any]], fallback_text: str) -> str:
    paras = paragraphs(_cues(items)) if items else [fallback_text.strip()]
    return "\n\n".join(p for p in paras if p)


def _timestamp(ms: int) -> str:
    seconds, millis = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def _txt(_title: str, items: list[dict[str, Any]], fallback_text: str) -> str:
    body = _body(items, fallback_text)
    return body + "\n" if body else ""


def _md(title: str, items: list[dict[str, Any]], fallback_text: str) -> str:
    body = _body(items, fallback_text)
    return f"# {title}\n\n{body}\n" if body else f"# {title}\n"


def _srt(_title: str, items: list[dict[str, Any]], _fallback_text: str) -> str:
    # No cues means no real timing: an empty file beats invented timestamps.
    return "\n".join(
        f"{i}\n{_timestamp(c.start_ms)} --> {_timestamp(c.end_ms)}\n{c.text}\n"
        for i, c in enumerate(_cues(items), 1)
    )


EXPORT_FORMATS: dict[
    str, tuple[Callable[[str, list[dict[str, Any]], str], str], str]
] = {
    "txt": (_txt, "text/plain"),
    "srt": (_srt, "application/x-subrip"),
    "md": (_md, "text/markdown"),
}


def render_export(
    fmt: str, title: str, cues: list[dict[str, Any]], fallback_text: str
) -> tuple[str, str]:
    """Return (body, media type); raises KeyError for unknown formats."""
    render, media = EXPORT_FORMATS[fmt]
    return render(title, cues, fallback_text), media
