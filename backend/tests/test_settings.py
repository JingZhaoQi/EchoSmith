"""Tests for persistent application settings."""
from __future__ import annotations

from pathlib import Path

from settings import SettingsManager


def test_transcription_defaults(tmp_path: Path) -> None:
    manager = SettingsManager(tmp_path / "settings.json")

    settings = manager.get()

    assert settings.transcription.asr_model == "sensevoice-sherpa-2024"
    assert manager.snapshot()["transcription"] == {
        "asr_model": "sensevoice-sherpa-2024",
    }


def test_update_transcription_persists_and_reloads(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    manager = SettingsManager(settings_path)

    manager.update_transcription(asr_model="sensevoice-sherpa-2024")
    reloaded = SettingsManager(settings_path)

    assert reloaded.get().transcription.asr_model == "sensevoice-sherpa-2024"


def test_invalid_transcription_values_fall_back_to_defaults(tmp_path: Path) -> None:
    manager = SettingsManager(tmp_path / "settings.json")

    manager.update_transcription(asr_model="bad-model")

    assert manager.get().transcription.asr_model == "sensevoice-sherpa-2024"
