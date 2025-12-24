#!/usr/bin/env python3
"""Download FunASR models for bundling with the application."""

import os
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from asr_engine import MODEL_IDS

def download_models(cache_dir: Path) -> None:
    """Download all required models to the specified cache directory."""
    print(f"Downloading models to: {cache_dir}")
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Set ModelScope cache directory
    os.environ["MODELSCOPE_CACHE"] = str(cache_dir)

    # Import after setting environment variable
    from funasr import AutoModel

    print("\nDownloading models...")
    print(f"  - Model: {MODEL_IDS['model']}")
    print(f"  - VAD: {MODEL_IDS['vad']}")
    print(f"  - Punctuation: {MODEL_IDS['punc']}")

    # This will download all models
    model = AutoModel(
        model=MODEL_IDS["model"],
        vad_model=MODEL_IDS["vad"],
        punc_model=MODEL_IDS["punc"],
    )

    print("\n✅ All models downloaded successfully!")
    print(f"Cache directory: {cache_dir}")
    print(f"Total size: {get_dir_size(cache_dir) / 1024 / 1024:.1f} MB")

def get_dir_size(path: Path) -> int:
    """Get total size of directory in bytes."""
    total = 0
    for entry in path.rglob("*"):
        if entry.is_file():
            total += entry.stat().st_size
    return total

if __name__ == "__main__":
    # Download to models directory in project root
    project_root = Path(__file__).parent.parent
    models_dir = project_root / "models_cache"

    download_models(models_dir)
