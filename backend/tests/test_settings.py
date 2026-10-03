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


def test_legacy_and_invalid_correction_values_are_migrated(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text(
        '{"correction": {"mode": "local_3b", "api_provider": "bogus", "api_key": 123, "api_model": 5}}'
    )

    cfg = SettingsManager(path).get().correction

    assert cfg.mode == "none"
    assert cfg.api_provider == "openai"
    assert cfg.api_key == "123"
    assert cfg.api_model == "5"


def test_corrupt_file_is_backed_up_not_overwritten(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text('{"correction": {"api_key": "sk-keep-me"')  # truncated write

    manager = SettingsManager(path)
    manager.record_api_call(3)

    backups = list(tmp_path.glob("settings.json.corrupt-*"))
    assert len(backups) == 1 and "sk-keep-me" in backups[0].read_text()


def test_null_correction_section_does_not_crash(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text('{"correction": null, "api_usage": null}')

    assert SettingsManager(path).get().correction.mode == "none"


def test_update_correction_validates_and_coerces(tmp_path: Path) -> None:
    manager = SettingsManager(tmp_path / "settings.json")

    manager.update_correction(
        mode="cloud_api",
        api_provider="deepseek",
        api_key=None,
        api_model="deepseek-v4-flash",
        unknown=1,
    )
    cfg = manager.get().correction

    assert (cfg.mode, cfg.api_provider, cfg.api_key) == ("cloud_api", "deepseek", "")
    manager.update_correction(mode="local_3b")
    assert manager.get().correction.mode == "cloud_api"  # invalid value ignored


def test_concurrent_writes_never_leave_partial_file(tmp_path: Path) -> None:
    import json
    import threading

    path = tmp_path / "settings.json"
    manager = SettingsManager(path)
    manager.update_correction(api_key="sk-secret")
    stop = threading.Event()
    bad: list[str] = []

    def reader() -> None:
        while not stop.is_set():
            try:
                json.loads(path.read_text())
            except (json.JSONDecodeError, FileNotFoundError) as exc:
                bad.append(str(exc))

    t = threading.Thread(target=reader)
    t.start()
    writers = [
        threading.Thread(target=lambda: [manager.record_api_call(1) for _ in range(50)])
        for _ in range(4)
    ]
    for w in writers:
        w.start()
    for w in writers:
        w.join()
    stop.set()
    t.join()

    assert bad == []
    assert SettingsManager(path).get().api_usage.total_calls == 200
