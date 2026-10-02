"""Tests for ASR engine configuration helpers."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from asr_engine import (
    ASREngine,
    AUDIO_FILTER,
    Segment,
    StreamingCorrector,
)


def test_audio_filter_is_mild_cleanup() -> None:
    assert "volume={gain}dB" in AUDIO_FILTER
    assert "alimiter" in AUDIO_FILTER
    assert "highpass" in AUDIO_FILTER


def test_measure_loudness_gain_clamps_and_handles_bad_output() -> None:
    class Result:
        def __init__(self, stderr: str) -> None:
            self.stderr = stderr

    cases = {
        "I:         -22.9 LUFS": 6.9,  # -16 - (-22.9)
        "I:         -70.0 LUFS": 0.0,  # silence
        "I:         -60.0 LUFS": 24.0,  # clamped boost
        "I:           10.0 LUFS": -24.0,  # clamped cut
        "garbage": 0.0,
    }
    for stderr, expected in cases.items():
        with patch(
            "asr_engine.subprocess.run", return_value=Result(stderr)
        ):
            assert ASREngine._measure_loudness_gain(
                Path("x.m4a")
            ) == pytest.approx(expected)


def test_set_transcription_options_sanitizes_invalid_model() -> None:
    engine = ASREngine()

    engine.set_transcription_options("bad-model")

    assert engine.asr_model == "sensevoice-sherpa-2024"


def test_set_transcription_options_keeps_explicit_default_model() -> None:
    engine = ASREngine()

    engine.set_transcription_options("sensevoice-sherpa-2024")

    assert engine.asr_model == "sensevoice-sherpa-2024"


class _FakeCorrectionEngine:
    """Correction engine double that uppercases each batch into one block."""

    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay
        self.calls: list[list[str]] = []
        self.contexts: list[str] = []
        self._lock = threading.Lock()
        self._active = 0
        self.max_active = 0

    def correct(self, texts: list[str], preceding_text: str = "") -> str:
        with self._lock:
            self.calls.append(list(texts))
            self.contexts.append(preceding_text)
            self._active += 1
            self.max_active = max(self.max_active, self._active)
        try:
            if self.delay:
                time.sleep(self.delay)
            return " ".join(text.upper() for text in texts)
        finally:
            with self._lock:
                self._active -= 1


def _segments(texts: list[str]) -> list[Segment]:
    return [
        Segment(index=i, start_ms=i * 1000, end_ms=(i + 1) * 1000, text=text)
        for i, text in enumerate(texts)
    ]


def test_streaming_corrector_corrects_in_order_and_preserves_text() -> None:
    engine = _FakeCorrectionEngine(delay=0.02)
    corrector = StreamingCorrector(engine, chunk_chars=9, max_workers=3)

    corrector.add(_segments(["aaa", "bbb", "ccc"]))
    corrector.add(_segments(["ddd", "eee"]))
    merged = corrector.finish()

    assert merged == "AAA BBB CCC\nDDD EEE"
    # 9 chars triggers one batch per add(); the rest flushes at finish()
    assert engine.calls == [["aaa", "bbb", "ccc"], ["ddd", "eee"]]
    # Second batch receives the first batch's text as preceding context
    assert engine.contexts[0] == ""
    assert engine.contexts[1] == "aaabbbccc"


def test_streaming_corrector_runs_batches_concurrently() -> None:
    engine = _FakeCorrectionEngine(delay=0.05)
    corrector = StreamingCorrector(engine, chunk_chars=3, max_workers=4)

    for text in ["aaa", "bbb", "ccc", "ddd"]:
        corrector.add(_segments([text]))
    merged = corrector.finish()

    assert merged == "AAA\nBBB\nCCC\nDDD"
    assert engine.max_active > 1


def test_streaming_corrector_falls_back_to_raw_on_error() -> None:
    class FlakyEngine:
        def correct(self, texts: list[str], preceding_text: str = "") -> str:
            if texts[0] == "boom":
                raise RuntimeError("api down")
            if texts[0] == "short":
                return ""  # empty response
            return " ".join(text.upper() for text in texts)

    corrector = StreamingCorrector(FlakyEngine(), chunk_chars=4, max_workers=2)
    corrector.add(_segments(["boom", "fine"]))
    corrector.add(_segments(["short", "tail"]))
    merged = corrector.finish()

    assert merged == "boom fine\nshort tail"


def test_streaming_corrector_reports_progressive_prefix() -> None:
    engine = _FakeCorrectionEngine()
    events: list[tuple[int, int, str]] = []
    corrector = StreamingCorrector(
        engine, chunk_chars=3, max_workers=2,
        on_progress=lambda done, total, prefix: events.append((done, total, prefix)),
    )

    corrector.add(_segments(["aaa"]))
    corrector.add(_segments(["bbb"]))
    merged = corrector.finish()

    assert merged == "AAA\nBBB"
    assert len(events) == 2
    # Callback appends can interleave across workers; sort by done count.
    events.sort(key=lambda event: event[0])
    final_done, _final_total, final_prefix = events[-1]
    assert final_done == 2
    assert final_prefix == "AAA\nBBB"


def test_streaming_corrector_cancel_returns_none() -> None:
    engine = _FakeCorrectionEngine(delay=0.2)
    corrector = StreamingCorrector(engine, chunk_chars=100, max_workers=1)

    corrector.add(_segments(["aaa"]))
    assert corrector.finish(cancelled=True) is None
