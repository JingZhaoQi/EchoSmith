#!/usr/bin/env python3
"""Download sherpa-onnx SenseVoice models for EchoSmith."""

import os
import sys
import tarfile
import urllib.request
from pathlib import Path

# SenseVoice model download URL (from sherpa-onnx releases)
MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"
MODEL_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"


def download_file(url: str, dest: Path, desc: str = "Downloading") -> None:
    """Download a file with progress indicator."""
    print(f"{desc}: {url}")

    def progress_hook(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            percent = min(100, downloaded * 100 / total_size)
            mb_downloaded = downloaded / 1024 / 1024
            mb_total = total_size / 1024 / 1024
            sys.stdout.write(f"\r  {percent:.1f}% ({mb_downloaded:.1f}/{mb_total:.1f} MB)")
            sys.stdout.flush()

    urllib.request.urlretrieve(url, dest, progress_hook)
    print()  # New line after progress


def download_models(cache_dir: Path) -> None:
    """Download sherpa-onnx SenseVoice models to the specified cache directory."""
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Check if models already exist
    model_file = cache_dir / "model.int8.onnx"
    tokens_file = cache_dir / "tokens.txt"

    if model_file.exists() and tokens_file.exists():
        print(f"Models already exist at: {cache_dir}")
        print(f"  - model.int8.onnx: {model_file.stat().st_size / 1024 / 1024:.1f} MB")
        print(f"  - tokens.txt: {tokens_file.stat().st_size / 1024:.1f} KB")
        return

    print(f"Downloading SenseVoice models to: {cache_dir}")

    # Download archive
    archive_path = cache_dir / "model.tar.bz2"
    download_file(MODEL_URL, archive_path, "Downloading SenseVoice model")

    # Extract archive
    print("Extracting archive...")
    with tarfile.open(archive_path, "r:bz2") as tar:
        tar.extractall(cache_dir)

    # Move files from extracted folder to cache_dir
    extracted_dir = cache_dir / MODEL_NAME
    if extracted_dir.exists():
        # Copy INT8 model and tokens
        int8_model = extracted_dir / "model.int8.onnx"
        tokens = extracted_dir / "tokens.txt"

        if int8_model.exists():
            int8_model.rename(cache_dir / "model.int8.onnx")
        if tokens.exists():
            tokens.rename(cache_dir / "tokens.txt")

        # Also copy FP32 model if exists (optional)
        fp32_model = extracted_dir / "model.onnx"
        if fp32_model.exists():
            fp32_model.rename(cache_dir / "model.onnx")

        # Remove extracted directory
        import shutil
        shutil.rmtree(extracted_dir)

    # Remove archive
    archive_path.unlink()

    print("\n✅ Models downloaded successfully!")
    print(f"Cache directory: {cache_dir}")

    # List downloaded files
    for f in cache_dir.iterdir():
        if f.is_file():
            size = f.stat().st_size
            if size > 1024 * 1024:
                print(f"  - {f.name}: {size / 1024 / 1024:.1f} MB")
            else:
                print(f"  - {f.name}: {size / 1024:.1f} KB")


if __name__ == "__main__":
    # Default cache directory (same as sherpa-onnx default)
    default_cache = Path.home() / ".cache" / "sherpa-onnx" / "sense-voice"

    # Allow override via command line
    if len(sys.argv) > 1:
        cache_dir = Path(sys.argv[1])
    else:
        cache_dir = default_cache

    download_models(cache_dir)
