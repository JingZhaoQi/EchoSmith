"""Tests for ASR engine configuration helpers."""

from __future__ import annotations

import threading
import time

from asr_engine import ASREngine, Segment, _audio_filter_for_accuracy_mode


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


def test_post_correction_runs_chunks_concurrently_and_preserves_order() -> None:
    class SlowCorrectionEngine:
        def __init__(self) -> None:
            self._lock = threading.Lock()
            self._active = 0
            self.max_active = 0

        def set_transcription_context(self, **_kwargs: object) -> None:
            return None

        def correct(self, texts: list[str], preceding_text: str = "") -> list[str]:
            with self._lock:
                self._active += 1
                self.max_active = max(self.max_active, self._active)
            try:
                time.sleep(0.05)
                return [f"{text[0]}-corrected" for text in texts]
            finally:
                with self._lock:
                    self._active -= 1

    correction_engine = SlowCorrectionEngine()
    engine = ASREngine(correction_engine=correction_engine)
    segments = [
        Segment(
            index=i,
            start_ms=i * 1000,
            end_ms=(i + 1) * 1000,
            text=chr(ord("A") + i) + ("字" * 1199),
        )
        for i in range(8)
    ]

    corrected, final_text = engine._post_correct(segments)

    assert correction_engine.max_active > 1
    assert [segment.text for segment in corrected] == [
        "A-corrected",
        "B-corrected",
        "C-corrected",
        "D-corrected",
        "E-corrected",
        "F-corrected",
        "G-corrected",
        "H-corrected",
    ]
    assert final_text.startswith("A-corrected B-corrected")
