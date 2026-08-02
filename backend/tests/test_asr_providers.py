"""Tests for optional ASR provider adapters."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys

import numpy as np
import pytest

from asr_models import ASRModelManager
from asr_providers import OptionalASRDependencyError, transcribe_with_external_provider


def test_qwen3_provider_reports_missing_dependency(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "qwen_asr", None)

    with pytest.raises(OptionalASRDependencyError) as excinfo:
        transcribe_with_external_provider(
            model_id="qwen3-asr-0.6b",
            audio_path=Path("sample.wav"),
            duration_ms=1000,
            language="zh",
            hotwords=[],
        )

    assert "qwen-asr" in str(excinfo.value)


def test_qwen3_provider_maps_language_and_reads_transcription_text(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    calls: dict[str, object] = {}
    monkeypatch.setitem(
        sys.modules,
        "soundfile",
        SimpleNamespace(
            read=lambda path, dtype="float32", always_2d=False: (
                np.zeros(16000, dtype=np.float32),
                16000,
            )
        ),
    )

    class FakeQwen3ASRModel:
        @classmethod
        def from_pretrained(cls, model_ref: str, **kwargs):
            calls["model_ref"] = model_ref
            calls["loader_kwargs"] = kwargs
            return cls()

        def transcribe(self, audio: tuple[np.ndarray, int], language: str):
            calls["audio"] = audio
            calls["language"] = language
            return [SimpleNamespace(text="识别文本")]

    monkeypatch.setitem(
        sys.modules,
        "qwen_asr",
        SimpleNamespace(Qwen3ASRModel=FakeQwen3ASRModel),
    )
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = manager.model_dir("qwen3-asr-0.6b")
    model_dir.mkdir(parents=True)
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / "model.safetensors").write_bytes(b"x")

    result = transcribe_with_external_provider(
        model_id="qwen3-asr-0.6b",
        audio_path=Path("sample.wav"),
        duration_ms=1000,
        language="zh",
        hotwords=[],
        model_manager=manager,
    )

    assert calls["model_ref"] == str(model_dir)
    assert isinstance(calls["audio"], tuple)
    assert calls["loader_kwargs"] == {"max_inference_batch_size": 1}
    assert calls["language"] == "Chinese"
    assert result.text == "识别文本"


def test_qwen3_provider_reuses_loaded_model(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    load_count = 0
    monkeypatch.setitem(
        sys.modules,
        "soundfile",
        SimpleNamespace(
            read=lambda path, dtype="float32", always_2d=False: (
                np.zeros(16000, dtype=np.float32),
                16000,
            )
        ),
    )

    class FakeQwen3ASRModel:
        @classmethod
        def from_pretrained(cls, model_ref: str, **kwargs):
            nonlocal load_count
            load_count += 1
            return cls()

        def transcribe(self, audio: tuple[np.ndarray, int], language: str):
            return SimpleNamespace(text="cached")

    monkeypatch.setitem(
        sys.modules,
        "qwen_asr",
        SimpleNamespace(Qwen3ASRModel=FakeQwen3ASRModel),
    )
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = manager.model_dir("qwen3-asr-0.6b")
    model_dir.mkdir(parents=True)
    (model_dir / "config.json").write_text("{}", encoding="utf-8")

    for _ in range(2):
        result = transcribe_with_external_provider(
            model_id="qwen3-asr-0.6b",
            audio_path=Path("sample.wav"),
            duration_ms=1000,
            language="zh",
            hotwords=[],
            model_manager=manager,
        )
        assert result.text == "cached"

    assert load_count == 1


def test_qwen3_provider_reports_chunk_progress_and_partial_text(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr("asr_providers._QWEN3_CHUNK_SECONDS", 2, raising=False)
    monkeypatch.setitem(
        sys.modules,
        "soundfile",
        SimpleNamespace(
            read=lambda path, dtype="float32", always_2d=False: (
                np.zeros(16000 * 5, dtype=np.float32),
                16000,
            )
        ),
    )
    chunk_lengths: list[int] = []

    class FakeQwen3ASRModel:
        @classmethod
        def from_pretrained(cls, model_ref: str, **kwargs):
            return cls()

        def transcribe(self, audio: tuple[np.ndarray, int], language: str):
            samples, _sample_rate = audio
            chunk_lengths.append(len(samples))
            return SimpleNamespace(text=f"第{len(chunk_lengths)}段")

    monkeypatch.setitem(
        sys.modules,
        "qwen_asr",
        SimpleNamespace(Qwen3ASRModel=FakeQwen3ASRModel),
    )
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = manager.model_dir("qwen3-asr-0.6b")
    model_dir.mkdir(parents=True)
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    events: list[tuple[float, str, str]] = []

    result = transcribe_with_external_provider(
        model_id="qwen3-asr-0.6b",
        audio_path=Path("sample.wav"),
        duration_ms=5000,
        language="zh",
        hotwords=[],
        model_manager=manager,
        progress_cb=lambda progress, stage, partial: events.append((progress, stage, partial)),
    )

    assert chunk_lengths == [32000, 32000, 16000]
    assert result.text == "第1段\n第2段\n第3段"
    assert [(seg.start_ms, seg.end_ms, seg.text) for seg in result.segments] == [
        (0, 2000, "第1段"),
        (2000, 4000, "第2段"),
        (4000, 5000, "第3段"),
    ]
    assert any(stage == "Qwen3-ASR 转写中 3/3" for _, stage, _ in events)
    assert events[-1][2] == result.text


def test_qwen3_provider_stops_between_chunks(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr("asr_providers._QWEN3_CHUNK_SECONDS", 2, raising=False)
    monkeypatch.setitem(
        sys.modules,
        "soundfile",
        SimpleNamespace(
            read=lambda path, dtype="float32", always_2d=False: (
                np.zeros(16000 * 5, dtype=np.float32),
                16000,
            )
        ),
    )
    chunk_lengths: list[int] = []

    class FakeQwen3ASRModel:
        @classmethod
        def from_pretrained(cls, model_ref: str, **kwargs):
            return cls()

        def transcribe(self, audio: tuple[np.ndarray, int], language: str):
            samples, _sample_rate = audio
            chunk_lengths.append(len(samples))
            return SimpleNamespace(text=f"第{len(chunk_lengths)}段")

    monkeypatch.setitem(
        sys.modules,
        "qwen_asr",
        SimpleNamespace(Qwen3ASRModel=FakeQwen3ASRModel),
    )
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = manager.model_dir("qwen3-asr-0.6b")
    model_dir.mkdir(parents=True)
    (model_dir / "config.json").write_text("{}", encoding="utf-8")

    result = transcribe_with_external_provider(
        model_id="qwen3-asr-0.6b",
        audio_path=Path("sample.wav"),
        duration_ms=5000,
        language="zh",
        hotwords=[],
        model_manager=manager,
        cancelled_checker=lambda: len(chunk_lengths) >= 1,
    )

    assert chunk_lengths == [32000]
    assert result.text == "第1段"
    assert len(result.segments) == 1


def test_funasr_provider_reports_missing_dependency(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "funasr", None)

    with pytest.raises(OptionalASRDependencyError) as excinfo:
        transcribe_with_external_provider(
            model_id="funasr-paraformer-zh",
            audio_path=Path("sample.wav"),
            duration_ms=1000,
            language="zh",
            hotwords=[],
        )

    assert "funasr" in str(excinfo.value)


def test_funasr_provider_reuses_loaded_model(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    load_count = 0
    monkeypatch.setitem(
        sys.modules,
        "soundfile",
        SimpleNamespace(
            read=lambda path, dtype="float32", always_2d=False: (
                np.zeros(16000, dtype=np.float32),
                16000,
            )
        ),
    )

    class FakeAutoModel:
        def __init__(self, **kwargs):
            nonlocal load_count
            load_count += 1
            self.kwargs = kwargs

        def generate(self, **kwargs):
            return [{"text": "cached"}]

    monkeypatch.setitem(sys.modules, "funasr", SimpleNamespace(AutoModel=FakeAutoModel))
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = manager.model_dir("funasr-paraformer-zh")
    model_dir.mkdir(parents=True)
    (model_dir / "config.yaml").write_text("{}", encoding="utf-8")
    (model_dir / "model.pt").write_bytes(b"x")

    for _ in range(2):
        result = transcribe_with_external_provider(
            model_id="funasr-paraformer-zh",
            audio_path=Path("sample.wav"),
            duration_ms=1000,
            language="zh",
            hotwords=[],
            model_manager=manager,
        )
        assert result.text == "cached"

    assert load_count == 1


def test_funasr_provider_reports_chunk_progress_and_partial_text(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr("asr_providers._FUNASR_CHUNK_SECONDS", 2, raising=False)
    monkeypatch.setitem(
        sys.modules,
        "soundfile",
        SimpleNamespace(
            read=lambda path, dtype="float32", always_2d=False: (
                np.zeros(16000 * 5, dtype=np.float32),
                16000,
            )
        ),
    )
    chunk_lengths: list[int] = []
    generate_kwargs: list[dict] = []

    class FakeAutoModel:
        def __init__(self, **kwargs):
            pass

        def generate(self, **kwargs):
            samples = kwargs["input"]
            chunk_lengths.append(len(samples))
            generate_kwargs.append(kwargs)
            return [{"text": f"第{len(chunk_lengths)}段"}]

    monkeypatch.setitem(sys.modules, "funasr", SimpleNamespace(AutoModel=FakeAutoModel))
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = manager.model_dir("funasr-paraformer-zh")
    model_dir.mkdir(parents=True)
    (model_dir / "config.yaml").write_text("{}", encoding="utf-8")
    (model_dir / "model.pt").write_bytes(b"x")
    events: list[tuple[float, str, str]] = []

    result = transcribe_with_external_provider(
        model_id="funasr-paraformer-zh",
        audio_path=Path("sample.wav"),
        duration_ms=5000,
        language="zh",
        hotwords=["护教学", "教会"],
        model_manager=manager,
        progress_cb=lambda progress, stage, partial: events.append((progress, stage, partial)),
    )

    assert chunk_lengths == [32000, 32000, 16000]
    assert result.text == "第1段\n第2段\n第3段"
    assert generate_kwargs[0]["hotword"] == "护教学 教会"
    assert [(seg.start_ms, seg.end_ms, seg.text) for seg in result.segments] == [
        (0, 2000, "第1段"),
        (2000, 4000, "第2段"),
        (4000, 5000, "第3段"),
    ]
    assert any(stage == "FunASR 转写中 3/3" for _, stage, _ in events)
    assert events[-1][2] == result.text


def test_funasr_provider_strips_sensevoice_metadata_tokens(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr("asr_providers._FUNASR_CHUNK_SECONDS", 2, raising=False)
    monkeypatch.setitem(
        sys.modules,
        "soundfile",
        SimpleNamespace(
            read=lambda path, dtype="float32", always_2d=False: (
                np.zeros(16000 * 3, dtype=np.float32),
                16000,
            )
        ),
    )

    class FakeAutoModel:
        def __init__(self, **kwargs):
            pass

        def generate(self, **kwargs):
            return [{"text": "<|zh|><|NEUTRAL|><|Speech|><|woitn|>识别文本"}]

    monkeypatch.setitem(sys.modules, "funasr", SimpleNamespace(AutoModel=FakeAutoModel))
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = manager.model_dir("funasr-sensevoice-small")
    model_dir.mkdir(parents=True)
    (model_dir / "config.yaml").write_text("{}", encoding="utf-8")
    (model_dir / "model.pt").write_bytes(b"x")
    events: list[tuple[float, str, str]] = []

    result = transcribe_with_external_provider(
        model_id="funasr-sensevoice-small",
        audio_path=Path("sample.wav"),
        duration_ms=3000,
        language="zh",
        hotwords=[],
        model_manager=manager,
        progress_cb=lambda progress, stage, partial: events.append((progress, stage, partial)),
    )

    assert result.text == "识别文本\n识别文本"
    assert [segment.text for segment in result.segments] == ["识别文本", "识别文本"]
    assert events[-1][2] == result.text
    assert "<|" not in result.text


def test_funasr_provider_stops_between_chunks(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr("asr_providers._FUNASR_CHUNK_SECONDS", 2, raising=False)
    monkeypatch.setitem(
        sys.modules,
        "soundfile",
        SimpleNamespace(
            read=lambda path, dtype="float32", always_2d=False: (
                np.zeros(16000 * 5, dtype=np.float32),
                16000,
            )
        ),
    )
    chunk_lengths: list[int] = []

    class FakeAutoModel:
        def __init__(self, **kwargs):
            pass

        def generate(self, **kwargs):
            samples = kwargs["input"]
            chunk_lengths.append(len(samples))
            return [{"text": f"第{len(chunk_lengths)}段"}]

    monkeypatch.setitem(sys.modules, "funasr", SimpleNamespace(AutoModel=FakeAutoModel))
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = manager.model_dir("funasr-paraformer-zh")
    model_dir.mkdir(parents=True)
    (model_dir / "config.yaml").write_text("{}", encoding="utf-8")
    (model_dir / "model.pt").write_bytes(b"x")

    result = transcribe_with_external_provider(
        model_id="funasr-paraformer-zh",
        audio_path=Path("sample.wav"),
        duration_ms=5000,
        language="zh",
        hotwords=[],
        model_manager=manager,
        cancelled_checker=lambda: len(chunk_lengths) >= 1,
    )

    assert chunk_lengths == [32000]
    assert result.text == "第1段"
    assert len(result.segments) == 1
