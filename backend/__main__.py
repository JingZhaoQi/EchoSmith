"""Entrypoint to run EchoSmith backend with uvicorn."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn

# Set MODELSCOPE_CACHE and PATH early if running from PyInstaller bundle
if getattr(sys, "frozen", False):
    bundle_dir = Path(sys._MEIPASS)  # type: ignore
    bundled_models = bundle_dir / "models_cache"
    if bundled_models.exists():
        os.environ["MODELSCOPE_CACHE"] = str(bundled_models)
        print(f"[INIT] Set MODELSCOPE_CACHE to: {bundled_models}")

    # Add common macOS binary paths to PATH for ffmpeg/ffprobe
    # This is needed because macOS apps don't inherit shell PATH
    current_path = os.environ.get("PATH", "")
    additional_paths = [
        "/opt/homebrew/bin",  # Homebrew on Apple Silicon
        "/usr/local/bin",  # Homebrew on Intel Macs
        "/usr/bin",
        "/bin",
    ]
    new_paths = [p for p in additional_paths if p not in current_path.split(":")]
    if new_paths:
        os.environ["PATH"] = ":".join(new_paths) + ":" + current_path
        print(f"[INIT] Enhanced PATH with: {', '.join(new_paths)}")

# Handle both direct execution and PyInstaller packaging
if getattr(sys, "frozen", False):
    # Running in PyInstaller bundle
    # When frozen, Python can't find 'backend' package, so we need to add it to path
    import sys
    from pathlib import Path

    # PyInstaller extracts to _MEIPASS, add it to path so backend package can be found
    bundle_dir = Path(sys._MEIPASS)  # type: ignore
    if str(bundle_dir) not in sys.path:
        sys.path.insert(0, str(bundle_dir))
    from app import app
else:
    # Running in development
    try:
        from .app import app
    except ImportError:
        from backend.app import app

if __name__ == "__main__":
    port = int(os.environ.get("ECHOSMITH_PORT", "5179"))
    host = os.environ.get("ECHOSMITH_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, log_level="info")
