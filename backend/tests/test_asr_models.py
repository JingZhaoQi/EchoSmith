"""Tests for local ASR model catalog and status."""
from __future__ import annotations

import sys
from types import SimpleNamespace
from pathlib import Path

from asr_models import ASRModelManager, DEFAULT_ASR_MODEL_ID, format_bytes, get_model_spec


def test_catalog_includes_qwen3_and_funasr_models() -> None:
    manager = ASRModelManager(cache_root=Path("/tmp/echosmith-test-models"))
    ids = {model["id"] for model in manager.list_models(selected_model_id=DEFAULT_ASR_MODEL_ID)}

    assert DEFAULT_ASR_MODEL_ID in ids
    assert "qwen3-asr-0.6b" in ids
    assert "qwen3-asr-1.7b" in ids
    assert "funasr-sensevoice-small" in ids
    assert "funasr-paraformer-zh" in ids
    assert "funasr-nano" in ids


def test_model_status_marks_selected_and_installed(tmp_path: Path) -> None:
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = tmp_path / "qwen3-asr-0.6b"
    model_dir.mkdir()
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / ".echosmith-model-ready").write_text("ready", encoding="utf-8")

    models = manager.list_models(selected_model_id="qwen3-asr-0.6b")
    qwen = next(model for model in models if model["id"] == "qwen3-asr-0.6b")

    assert qwen["selected"] is True
    assert qwen["installed"] is True
    assert qwen["path"] == str(model_dir)
    assert qwen["estimated_size_label"] == "1.88 GB"
    assert qwen["installed_size_bytes"] == 2
    assert qwen["installed_size_label"] == "2 B"


def test_partial_model_directory_is_not_installed(tmp_path: Path) -> None:
    manager = ASRModelManager(cache_root=tmp_path)
    model_dir = tmp_path / "qwen3-asr-0.6b"
    model_dir.mkdir()
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / "partial.bin").write_bytes(b"x" * 1024)

    models = manager.list_models(selected_model_id="qwen3-asr-0.6b")
    qwen = next(model for model in models if model["id"] == "qwen3-asr-0.6b")

    assert qwen["installed"] is False
    assert qwen["installed_size_bytes"] == 1026
    assert qwen["installed_size_label"] == "1.03 KB"


def test_format_bytes_uses_readable_decimal_units() -> None:
    assert format_bytes(0) == "未知"
    assert format_bytes(240_000_000) == "240 MB"
    assert format_bytes(1_880_000_000) == "1.88 GB"


def test_download_model_uses_huggingface_fallback(monkeypatch, tmp_path: Path) -> None:
    manager = ASRModelManager(cache_root=tmp_path)
    messages: list[tuple[float, str]] = []
    downloaded: dict[str, str] = {}

    def fail_modelscope_download(*_: object, **__: object) -> None:
        raise RuntimeError("modelscope unavailable")

    def fake_hf_download(repo_id: str, local_dir: str) -> None:
        downloaded["repo_id"] = repo_id
        downloaded["local_dir"] = local_dir
        Path(local_dir).mkdir(parents=True, exist_ok=True)
        (Path(local_dir) / "config.json").write_text("{}", encoding="utf-8")

    monkeypatch.setitem(
        sys.modules,
        "modelscope",
        SimpleNamespace(snapshot_download=fail_modelscope_download),
    )
    monkeypatch.setitem(
        sys.modules,
        "huggingface_hub",
        SimpleNamespace(snapshot_download=fake_hf_download),
    )

    target = manager.download_model(
        "funasr-sensevoice-small",
        progress_cb=lambda progress, message: messages.append((progress, message)),
    )

    assert target == tmp_path / "funasr-sensevoice-small"
    assert downloaded["repo_id"] == "FunAudioLLM/SenseVoiceSmall"
    assert downloaded["local_dir"] == str(target)
    assert messages[0] == (0.05, "准备下载 FunASR SenseVoiceSmall")
    assert messages[-1] == (1.0, "下载完成")


def test_get_model_spec_rejects_unknown_model() -> None:
    try:
        get_model_spec("missing-model")
    except KeyError as exc:
        assert "missing-model" in str(exc)
    else:
        raise AssertionError("unknown model should raise KeyError")
