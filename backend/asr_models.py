"""Local ASR model selection (single bundled SenseVoice model)."""

from __future__ import annotations

DEFAULT_ASR_MODEL_ID = "sensevoice-sherpa-2024"
VALID_ASR_MODEL_IDS = frozenset({DEFAULT_ASR_MODEL_ID})


def is_valid_model_id(model_id: object) -> bool:
    return isinstance(model_id, str) and model_id in VALID_ASR_MODEL_IDS


def sanitize_model_id(model_id: object) -> str:
    return model_id if is_valid_model_id(model_id) else DEFAULT_ASR_MODEL_ID
