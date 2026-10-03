"""Tests for ASR engine configuration helpers."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from asr_engine import (
    AUDIO_FILTER,
    ASREngine,
    Segment,
    StreamingCorrector,
    segments_from_cues,
)
from timing import Cue, TimedText


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
        with patch("asr_engine.subprocess.run", return_value=Result(stderr)):
            assert ASREngine._measure_loudness_gain(Path("x.m4a")) == pytest.approx(
                expected
            )


def test_set_transcription_options_sanitizes_invalid_model() -> None:
    engine = ASREngine()

    engine.set_transcription_options("bad-model")

    assert engine.asr_model == "sensevoice-sherpa-2024"


def test_set_transcription_options_keeps_explicit_default_model() -> None:
    engine = ASREngine()

    engine.set_transcription_options("sensevoice-sherpa-2024")

    assert engine.asr_model == "sensevoice-sherpa-2024"


class _FakeCorrectionEngine:
    """Correction double: uppercases each batch, streaming it in two halves."""

    def __init__(
        self,
        delay: float = 0.0,
        delays: dict[str, float] | None = None,
        fail: set[str] | None = None,
    ) -> None:
        self.delay = delay
        self.delays = delays or {}
        self.fail = fail or set()
        self.calls: list[list[str]] = []
        self.contexts: list[str] = []
        self._lock = threading.Lock()
        self._active = 0
        self.max_active = 0
        self.stopped = 0

    def correct(self, texts, preceding_text="", on_delta=None, should_stop=None) -> str:
        with self._lock:
            self.calls.append(list(texts))
            self.contexts.append(preceding_text)
            self._active += 1
            self.max_active = max(self.max_active, self._active)
        try:
            out = " ".join(t.upper() for t in texts)
            delay = self.delays.get(texts[0], self.delay)
            if on_delta:
                on_delta(out[: len(out) // 2])
            deadline = time.time() + delay
            while time.time() < deadline:
                if should_stop and should_stop():
                    with self._lock:
                        self.stopped += 1
                    return ""
                time.sleep(0.005)
            if texts[0] in self.fail:
                raise RuntimeError("api down")
            if on_delta:
                on_delta(out)
            return out
        finally:
            with self._lock:
                self._active -= 1


def _segments(texts: list[str]) -> list[Segment]:
    return [
        Segment(index=i, start_ms=i * 1000, end_ms=(i + 1) * 1000, text=t)
        for i, t in enumerate(texts)
    ]


def _timed(text: str, start_ms: int = 0) -> TimedText:
    return TimedText(
        text, [start_ms + 100 * i for i in range(len(text))], start_ms + 100 * len(text)
    )


def _add(corrector: StreamingCorrector, texts: list[str]) -> None:
    corrector.add(_segments(texts), _timed(" ".join(texts)))


def test_streaming_corrector_merges_in_order_with_raw_context() -> None:
    engine = _FakeCorrectionEngine(delay=0.02)
    corrector = StreamingCorrector(
        engine, first_chunk_chars=5, chunk_chars=9, max_workers=3
    )

    _add(corrector, ["aaa", "bbb"])  # >= first batch size (5)
    _add(corrector, ["ccc"])
    _add(corrector, ["ddd", "eee"])  # buffer reaches 9 chars
    batches = corrector.finish()

    assert [b.text for b in batches] == ["AAA BBB", "CCC DDD EEE"]
    assert engine.calls == [["aaa", "bbb"], ["ccc", "ddd", "eee"]]
    assert engine.contexts == ["", "aaa bbb"]
    assert not any(b.failed for b in batches)


def test_streaming_corrector_runs_batches_concurrently() -> None:
    engine = _FakeCorrectionEngine(delay=0.05)
    corrector = StreamingCorrector(
        engine, first_chunk_chars=3, chunk_chars=3, max_workers=4
    )
    for text in ["aaa", "bbb", "ccc", "ddd"]:
        _add(corrector, [text])
    corrector.finish()
    assert engine.max_active > 1


def test_streaming_corrector_falls_back_to_raw_and_counts_failures() -> None:
    engine = _FakeCorrectionEngine(fail={"boom"})
    corrector = StreamingCorrector(
        engine, first_chunk_chars=4, chunk_chars=4, max_workers=2
    )
    _add(corrector, ["boom", "x"])
    _add(corrector, ["fine"])
    batches = corrector.finish()

    assert [(b.text, b.failed) for b in batches] == [("boom x", True), ("FINE", False)]


def test_visible_text_only_grows_even_when_later_batch_finishes_first() -> None:
    engine = _FakeCorrectionEngine(delays={"aaaa": 0.15, "bbbb": 0.0})
    updates: list[tuple[str, float]] = []
    lock = threading.Lock()

    def on_update(text: str, progress: float) -> None:
        with lock:
            updates.append((text, progress))

    corrector = StreamingCorrector(
        engine,
        first_chunk_chars=4,
        chunk_chars=4,
        max_workers=2,
        on_update=on_update,
        emit_interval=0,
    )
    _add(corrector, ["aaaa"])
    _add(corrector, ["bbbb"])
    corrector.finish()

    texts = [t for t, _ in updates]
    assert texts[-1] == "AAAA BBBB"
    assert all(
        texts[k + 1].startswith(texts[k][: len(texts[k]) - 0]) or len(texts[k]) == 0
        for k in range(len(texts) - 1)
    )
    assert all(
        "BBBB" not in t for t in texts if "AAAA" not in t
    )  # never shown out of order
    # ratio of the text transcribed so far: may dip as more text arrives (TaskProgress smooths it)
    assert all(0.0 <= p <= 1.0 for _, p in updates)
    assert updates[-1][1] == 1.0


def test_cancel_stops_inflight_and_skips_pending_batches() -> None:
    engine = _FakeCorrectionEngine(delay=2.0)
    corrector = StreamingCorrector(
        engine, first_chunk_chars=3, chunk_chars=3, max_workers=1
    )
    for text in ["aaa", "bbb", "ccc"]:
        _add(corrector, [text])

    t0 = time.time()
    assert corrector.finish(cancelled_checker=lambda: time.time() - t0 > 0.1) is None
    time.sleep(0.1)
    assert time.time() - t0 < 1.0
    assert engine.stopped == 1
    assert len(engine.calls) == 1  # pending batches never reached the API


class _FakeResult:
    def __init__(self, tokens: list[str], timestamps: list[float]) -> None:
        self.tokens, self.timestamps = tokens, timestamps
        self.text = "".join(tokens)


class _FakeRecognizer:
    """Returns scripted tokens per decode call and records window lengths."""

    def __init__(self, scripts: list[tuple[list[str], list[float]]]) -> None:
        self.scripts = list(scripts)
        self.window_lengths: list[int] = []

    def create_stream(self):
        rec = self

        class Stream:
            def accept_waveform(self, _sr: int, samples) -> None:
                rec.window_lengths.append(len(samples))
                if hasattr(rec, "on_decode"):
                    rec.on_decode()
                self.result = _FakeResult(*rec.scripts.pop(0))

        return Stream()

    def decode_stream(self, _stream) -> None:
        return None


class _FakeVad:
    """Emits each scripted (start, end) region once 0.5 s of audio after it has been fed."""

    def __init__(self, regions: list[tuple[int, int]]) -> None:
        self.pending = list(regions)
        self.fed = 0

    def accept(self, chunk) -> list[tuple[int, int]]:
        self.fed += len(chunk)
        ready = [r for r in self.pending if r[1] + 8000 <= self.fed]
        self.pending = [r for r in self.pending if r not in ready]
        return ready

    def flush(self) -> list[tuple[int, int]]:
        rest, self.pending = self.pending, []
        return rest


SECONDS = 20


def _engine_with(scripts, regions, correction=None, seconds=SECONDS) -> ASREngine:
    import numpy as np

    engine = ASREngine(correction_engine=correction)
    engine._recognizer = _FakeRecognizer(scripts)
    engine._vad_config = object()
    engine._new_vad = lambda: _FakeVad(regions)  # type: ignore[method-assign]
    engine.chunks_read = 0  # type: ignore[attr-defined]

    def pcm(_path, _gain):
        for _ in range(seconds):
            engine.chunks_read += 1  # type: ignore[attr-defined]
            yield np.zeros(16000, dtype=np.int16)

    engine._pcm_chunks = pcm  # type: ignore[method-assign]
    return engine


def _run(engine: ASREngine, seconds=SECONDS, **kwargs):
    with patch(
        "asr_engine.probe_duration_ms", return_value=seconds * 1000
    ), patch.object(ASREngine, "_measure_loudness_gain", staticmethod(lambda p: 0.0)):
        return engine._transcribe_sync(Path("x.wav"), **kwargs)


def test_pipeline_streams_first_region_before_audio_is_fully_read() -> None:
    scripts = [(list("一。"), [0.15, 0.3]), (list("二。"), [0.15, 0.3])]
    engine = _engine_with(scripts, [(16000 * 1, 16000 * 2), (16000 * 15, 16000 * 16)])
    seen: list[int] = []
    engine._recognizer.on_decode = lambda: seen.append(engine.chunks_read)  # type: ignore[attr-defined]

    result = _run(engine)

    assert result.raw_text == "一。二。"
    assert seen[0] < SECONDS / 2  # first text long before the whole file was decoded


def test_pipeline_uses_token_timestamps_and_padded_windows() -> None:
    scripts = [
        (list("第一句话。"), [0.15, 0.35, 0.55, 0.75, 0.95]),
        (list("第二句。"), [0.15, 0.3, 0.45, 0.6]),
    ]
    regions = [(16000 * 1, 16000 * 2), (16000 * 10, 16000 * 11)]
    engine = _engine_with(scripts, regions)

    result = _run(engine)

    # windows widened by 0.15 s before / 0.35 s after
    assert engine._recognizer.window_lengths == [int(16000 * 1.5)] * 2
    first, second = result.segments
    assert first.text == "第一句话。" and second.text == "第二句。"
    assert (
        first.start_ms == 1000 and second.start_ms == 10_000
    )  # window start (0.85 s) + 0.15 s token offset
    assert first.end_ms < second.start_ms
    assert result.raw_text == "第一句话。第二句。"


def test_pipeline_correction_produces_retimed_corrected_segments() -> None:
    class Fixer:
        def has_model(self) -> bool:
            return True

        def correct(
            self, texts, preceding_text="", on_delta=None, should_stop=None
        ) -> str:
            return "".join(texts).replace("于月结", "逾越节")

    scripts = [(list("在于月结以前。"), [0.15 + 0.2 * i for i in range(7)])]
    engine = _engine_with(scripts, [(16000 * 2, 16000 * 4)], correction=Fixer())
    updates: list[tuple[str, float]] = []

    result = _run(engine, correction_cb=lambda text, p: updates.append((text, p)))

    assert result.text == "在逾越节以前。"
    assert result.raw_text == "在于月结以前。"
    seg = result.corrected_segments[0]
    assert seg.text == "在逾越节以前。"
    assert seg.start_ms == result.segments[0].start_ms
    assert updates[-1] == ("在逾越节以前。", 1.0)


def test_pipeline_cancel_returns_partial_raw_result() -> None:
    scripts = [(list("一。"), [0.15, 0.3]), (list("二。"), [0.15, 0.3])]
    engine = _engine_with(scripts, [(16000, 32000), (16000 * 10, 16000 * 11)])

    # stop after ~5 s of audio: the first region is decoded, the second never is
    result = _run(engine, cancelled_checker=lambda: engine.chunks_read > 5)
    assert result.cancelled and result.raw_text == "一。"
    assert engine.chunks_read < SECONDS  # stopped reading the audio


def test_segments_from_cues_cleans_text_keeps_times_and_drops_empty() -> None:
    cues = [
        Cue(1200, 2400, "嗯，开始 。"),
        Cue(2400, 2600, "嗯，"),
        Cue(3000, 4000, "下一句？。"),
    ]
    segs = segments_from_cues(cues, first_index=3)
    assert [(s.index, s.start_ms, s.end_ms, s.text) for s in segs] == [
        (3, 1200, 2400, "开始。"),
        (4, 3000, 4000, "下一句？"),
    ]


def test_forced_split_regions_do_not_share_audio() -> None:
    scripts = [(list("长段。"), [0.2, 0.4, 0.6]), (list("接着。"), [0.2, 0.4, 0.6])]
    sr = 16000
    engine = _engine_with(scripts, [(0, 30 * sr), (30 * sr, 35 * sr)], seconds=40)

    result = _run(engine, seconds=40)

    first, second = engine._recognizer.window_lengths
    assert first == 30 * sr  # no tail pad into the next region
    assert second == int(
        5.35 * sr
    )  # starts at the shared boundary, keeps its own tail pad
    assert result.raw_text == "长段。接着。"
