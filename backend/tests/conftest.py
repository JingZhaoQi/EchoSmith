"""Shared fixtures for EchoSmith backend tests."""
from __future__ import annotations

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# Ensure backend modules are importable without package prefix
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Mock heavy native dependencies that may not be installed in test env
for mod_name in ("sherpa_onnx",):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = types.ModuleType(mod_name)

# llama_cpp needs a Llama attribute for CorrectionEngine.load_model()
if "llama_cpp" not in sys.modules:
    _llama_cpp_mock = types.ModuleType("llama_cpp")
    _llama_cpp_mock.Llama = MagicMock  # type: ignore[attr-defined]
    sys.modules["llama_cpp"] = _llama_cpp_mock
