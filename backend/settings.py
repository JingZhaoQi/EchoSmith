"""Persistent application settings for EchoSmith."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


VALID_ASR_MODELS = {"sensevoice-sherpa-2024"}
DEFAULT_ASR_MODEL = "sensevoice-sherpa-2024"


@dataclass
class CorrectionConfig:
    mode: str = "none"  # "none" | "local_3b" | "cloud_api"
    api_provider: str = "openai"  # "openai" | "anthropic" | "deepseek" | "custom"
    api_key: str = ""
    api_model: str = "gpt-4o-mini"
    api_base_url: str = ""


@dataclass
class TranscriptionConfig:
    asr_model: str = DEFAULT_ASR_MODEL


@dataclass
class ApiUsageStats:
    total_calls: int = 0
    total_segments: int = 0
    failed_calls: int = 0


@dataclass
class AppSettings:
    transcription: TranscriptionConfig = field(default_factory=TranscriptionConfig)
    correction: CorrectionConfig = field(default_factory=CorrectionConfig)
    api_usage: ApiUsageStats = field(default_factory=ApiUsageStats)


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
            transcription_data = data.get("transcription", {})
            self._settings.transcription = TranscriptionConfig(
                asr_model=self._sanitize_asr_model(
                    transcription_data.get("asr_model", DEFAULT_ASR_MODEL)
                ),
            )
            correction_data = data.get("correction", {})
            self._settings.correction = CorrectionConfig(
                mode=correction_data.get("mode", "none"),
                api_provider=correction_data.get("api_provider", "openai"),
                api_key=correction_data.get("api_key", ""),
                api_model=correction_data.get("api_model", "gpt-4o-mini"),
                api_base_url=correction_data.get("api_base_url", ""),
            )
            usage_data = data.get("api_usage", {})
            self._settings.api_usage = ApiUsageStats(
                total_calls=usage_data.get("total_calls", 0),
                total_segments=usage_data.get("total_segments", 0),
                failed_calls=usage_data.get("failed_calls", 0),
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

    def update_transcription(self, **kwargs) -> TranscriptionConfig:
        if "asr_model" in kwargs:
            self._settings.transcription.asr_model = self._sanitize_asr_model(
                kwargs["asr_model"]
            )
        self.save()
        return self._settings.transcription

    def update_correction(self, **kwargs) -> CorrectionConfig:
        for key, value in kwargs.items():
            if hasattr(self._settings.correction, key):
                setattr(self._settings.correction, key, value)
        self.save()
        return self._settings.correction

    def record_api_call(self, num_segments: int, failed: bool = False) -> None:
        self._settings.api_usage.total_calls += 1
        self._settings.api_usage.total_segments += num_segments
        if failed:
            self._settings.api_usage.failed_calls += 1
        self.save()

    def reset_usage(self) -> None:
        self._settings.api_usage = ApiUsageStats()
        self.save()

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

    @staticmethod
    def _sanitize_asr_model(value: object) -> str:
        return value if isinstance(value, str) and value in VALID_ASR_MODELS else DEFAULT_ASR_MODEL
