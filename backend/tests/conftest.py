"""Shared fixtures for EchoSmith backend tests."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure backend modules are importable without package prefix
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
