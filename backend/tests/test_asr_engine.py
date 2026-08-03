"""Tests for ASR engine configuration helpers."""

from __future__ import annotations

import threading
import time

from asr_engine import (
    ASREngine,
    Segment,
    StreamingCorrector,
    _audio_filter_for_accuracy_mode,
)


def test_fast_mode_uses_no_ffmpeg_audio_filter() -> None:
    assert _audio_filter_for_accuracy_mode("fast") is None


def test_balanced_and_accurate_modes_use_mild_audio_filter() -> None:
    balanced = _audio_filter_for_accuracy_mode("balanced")
    accurate = _audio_filter_for_accuracy_mode("accurate")

    assert balanced is not None
    assert "loudnorm" in balanced
    assert "highpass" in balanced
    assert accurate is not None
    assert "loudnorm" in accurate


def test_set_transcription_options_sanitizes_invalid_values() -> None:
    engine = ASREngine()

    engine.set_transcription_options("turbo", "unknown", "bad-model")

    assert engine.accuracy_mode == "balanced"
    assert engine.domain_profile == "general"
    assert engine.asr_model == "sensevoice-sherpa-2024"


def test_set_transcription_options_accepts_qwen3_model() -> None:
    engine = ASREngine()

    engine.set_transcription_options("accurate", "general", "qwen3-asr-0.6b")

    assert engine.asr_model == "qwen3-asr-0.6b"


class _FakeCorrectionEngine:
    """Correction engine double that uppercases each segment."""

    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay
        self.calls: list[list[str]] = []
        self.contexts: list[str] = []
        self._lock = threading.Lock()
        self._active = 0
        self.max_active = 0

    def correct(self, texts: list[str], preceding_text: str = "") -> list[str]:
        with self._lock:
            self.calls.append(list(texts))
            self.contexts.append(preceding_text)
            self._active += 1
            self.max_active = max(self.max_active, self._active)
        try:
            if self.delay:
                time.sleep(self.delay)
            return [text.upper() for text in texts]
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

    assert merged == ["AAA", "BBB", "CCC", "DDD", "EEE"]
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

    assert merged == ["AAA", "BBB", "CCC", "DDD"]
    assert engine.max_active > 1


def test_streaming_corrector_falls_back_to_raw_on_error() -> None:
    class FlakyEngine:
        def correct(self, texts: list[str], preceding_text: str = "") -> list[str]:
            if texts[0] == "boom":
                raise RuntimeError("api down")
            if texts[0] == "short":
                return ["only-one"]  # wrong segment count
            return [text.upper() for text in texts]

    corrector = StreamingCorrector(FlakyEngine(), chunk_chars=4, max_workers=2)
    corrector.add(_segments(["boom", "fine"]))
    corrector.add(_segments(["short", "tail"]))
    merged = corrector.finish()

    assert merged == ["boom", "fine", "short", "tail"]


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

    assert merged == ["AAA", "BBB"]
    assert len(events) == 2
    # Callback appends can interleave across workers; sort by done count.
    events.sort(key=lambda event: event[0])
    final_done, _final_total, final_prefix = events[-1]
    assert final_done == 2
    assert final_prefix == "AAA BBB"


def test_streaming_corrector_cancel_returns_none() -> None:
    engine = _FakeCorrectionEngine(delay=0.2)
    corrector = StreamingCorrector(engine, chunk_chars=100, max_workers=1)

    corrector.add(_segments(["aaa"]))
    assert corrector.finish(cancelled=True) is None
