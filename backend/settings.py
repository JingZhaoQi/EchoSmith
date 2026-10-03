"""Persistent application settings for EchoSmith."""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

try:
    from asr_models import DEFAULT_ASR_MODEL_ID, sanitize_model_id
except ImportError:
    from .asr_models import DEFAULT_ASR_MODEL_ID, sanitize_model_id

CORRECTION_MODES = ("none", "cloud_api")
API_PROVIDERS = ("openai", "anthropic", "deepseek", "doubao", "custom")
LEGACY_MODES = {"local_3b": "none"}


@dataclass
class CorrectionConfig:
    mode: str = "none"
    api_provider: str = "openai"
    api_key: str = ""
    api_model: str = "gpt-4o-mini"
    api_base_url: str = ""


@dataclass
class TranscriptionConfig:
    asr_model: str = DEFAULT_ASR_MODEL_ID


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


def _section(data: dict, key: str) -> dict:
    value = data.get(key)
    return value if isinstance(value, dict) else {}


def _text(value: object, default: str = "") -> str:
    return default if value is None else str(value)


def _count(value: object) -> int:
    return value if isinstance(value, int) and value >= 0 else 0


class SettingsManager:
    """Settings backed by a JSON file; writes are serialized and atomic (tmp file + rename)."""

    def __init__(self, storage_path: Path) -> None:
        self._path = storage_path
        self._lock = threading.Lock()
        self._settings = AppSettings()
        self.load()

    def load(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("settings root is not an object")
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            # Keep the unreadable file (it may hold the API key) instead of overwriting it on next save.
            self._path.rename(
                self._path.with_name(f"{self._path.name}.corrupt-{int(time.time())}")
            )
            return
        self._settings.transcription = TranscriptionConfig(
            asr_model=sanitize_model_id(
                _section(data, "transcription").get("asr_model")
            )
        )
        c = _section(data, "correction")
        mode = LEGACY_MODES.get(c.get("mode"), c.get("mode"))
        provider = c.get("api_provider")
        self._settings.correction = CorrectionConfig(
            mode=mode if mode in CORRECTION_MODES else "none",
            api_provider=provider if provider in API_PROVIDERS else "openai",
            api_key=_text(c.get("api_key")),
            api_model=_text(c.get("api_model"), "gpt-4o-mini"),
            api_base_url=_text(c.get("api_base_url")),
        )
        u = _section(data, "api_usage")
        self._settings.api_usage = ApiUsageStats(
            total_calls=_count(u.get("total_calls")),
            total_segments=_count(u.get("total_segments")),
            failed_calls=_count(u.get("failed_calls")),
        )

    def _save_locked(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_name(f"{self._path.name}.{threading.get_ident()}.tmp")
        tmp.write_text(
            json.dumps(asdict(self._settings), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(tmp, self._path)

    def get(self) -> AppSettings:
        return self._settings

    def update_transcription(self, **kwargs) -> TranscriptionConfig:
        with self._lock:
            if "asr_model" in kwargs:
                self._settings.transcription.asr_model = sanitize_model_id(
                    kwargs["asr_model"]
                )
            self._save_locked()
        return self._settings.transcription

    def update_correction(self, **kwargs) -> CorrectionConfig:
        """Apply known fields; invalid mode/provider values are ignored, other values coerced to str."""
        with self._lock:
            cfg = self._settings.correction
            for key, value in kwargs.items():
                if key == "mode":
                    if value in CORRECTION_MODES:
                        cfg.mode = value
                elif key == "api_provider":
                    if value in API_PROVIDERS:
                        cfg.api_provider = value
                elif key in ("api_key", "api_model", "api_base_url"):
                    setattr(cfg, key, _text(value).strip())
            self._save_locked()
        return self._settings.correction

    def record_api_call(self, num_segments: int, failed: bool = False) -> None:
        with self._lock:
            usage = self._settings.api_usage
            usage.total_calls += 1
            usage.total_segments += num_segments
            if failed:
                usage.failed_calls += 1
            self._save_locked()

    def reset_usage(self) -> None:
        with self._lock:
            self._settings.api_usage = ApiUsageStats()
            self._save_locked()

    def snapshot(self) -> dict:
        """Return settings with api_key masked for frontend."""
        data = asdict(self._settings)
        key = data["correction"]["api_key"]
        data["correction"]["api_key_set"] = bool(key)
        data["correction"]["api_key"] = (
            (key[:3] + "****" + key[-4:] if len(key) > 12 else "****") if key else ""
        )
        return data
