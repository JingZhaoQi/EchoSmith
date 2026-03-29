"""Persistent application settings for EchoSmith."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class CorrectionConfig:
    mode: str = "none"  # "none" | "local_3b" | "cloud_api"
    api_provider: str = "openai"  # "openai" | "anthropic" | "deepseek" | "custom"
    api_key: str = ""
    api_model: str = "gpt-4o-mini"
    api_base_url: str = ""


@dataclass
class AppSettings:
    correction: CorrectionConfig = field(default_factory=CorrectionConfig)


class SettingsManager:
    def __init__(self, storage_path: Path) -> None:
        self._path = storage_path
        self._settings = AppSettings()
        self.load()

    def load(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            correction_data = data.get("correction", {})
            self._settings.correction = CorrectionConfig(
                mode=correction_data.get("mode", "none"),
                api_provider=correction_data.get("api_provider", "openai"),
                api_key=correction_data.get("api_key", ""),
                api_model=correction_data.get("api_model", "gpt-4o-mini"),
                api_base_url=correction_data.get("api_base_url", ""),
            )
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    def save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(asdict(self._settings), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get(self) -> AppSettings:
        return self._settings

    def update_correction(self, **kwargs) -> CorrectionConfig:
        for key, value in kwargs.items():
            if hasattr(self._settings.correction, key):
                setattr(self._settings.correction, key, value)
        self.save()
        return self._settings.correction

    def snapshot(self) -> dict:
        """Return settings with api_key masked for frontend."""
        data = asdict(self._settings)
        key = data["correction"]["api_key"]
        if key:
            data["correction"]["api_key_set"] = True
            data["correction"]["api_key"] = key[:4] + "****" + key[-4:] if len(key) > 8 else "****"
        else:
            data["correction"]["api_key_set"] = False
        return data
