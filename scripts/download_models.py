#!/usr/bin/env python3
"""Download sherpa-onnx SenseVoice models for EchoSmith.

Cross-platform compatible: Windows, macOS, Linux.
"""

import os
import sys
import shutil
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

# SenseVoice model download URLs
# Primary: tar.bz2 (smaller, for Unix systems)
# Fallback: zip (for Windows compatibility)
MODEL_URL_BZ2 = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"
MODEL_URL_ZIP = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.zip"
MODEL_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"

IS_WINDOWS = sys.platform == "win32"


def check_bz2_support() -> bool:
    """Check if bz2 module is available for tarfile."""
    try:
        import bz2
        # Test that bz2 actually works
        bz2.compress(b"test")
        return True
    except (ImportError, OSError):
        return False


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

    urllib.request.urlretrieve(url, str(dest), progress_hook)
    print()  # New line after progress


def extract_tar_bz2(archive_path: Path, extract_dir: Path) -> None:
    """Extract a tar.bz2 archive."""
    print("Extracting tar.bz2 archive...")
    with tarfile.open(str(archive_path), "r:bz2") as tar:
        # Security: filter to prevent path traversal attacks
        def safe_extract(tar, path):
            for member in tar.getmembers():
                member_path = Path(path) / member.name
                # Prevent path traversal
                try:
                    member_path.resolve().relative_to(Path(path).resolve())
                except ValueError:
                    raise Exception(f"Attempted path traversal in tar: {member.name}")
            tar.extractall(path)
        
        safe_extract(tar, str(extract_dir))


def extract_zip(archive_path: Path, extract_dir: Path) -> None:
    """Extract a zip archive."""
    print("Extracting zip archive...")
    with zipfile.ZipFile(str(archive_path), 'r') as zf:
        zf.extractall(str(extract_dir))


def move_file_safe(src: Path, dst: Path) -> None:
    """Move a file safely, handling cross-device moves."""
    try:
        # Use shutil.move which handles cross-device moves
        shutil.move(str(src), str(dst))
    except Exception as e:
        # Fallback: copy then delete
        print(f"  Note: Using copy+delete for {src.name} ({e})")
        shutil.copy2(str(src), str(dst))
        src.unlink()


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
    print(f"Platform: {sys.platform}")

    # Determine which archive format to use
    use_zip = IS_WINDOWS or not check_bz2_support()
    
    if use_zip:
        print("Using ZIP format (Windows or bz2 not available)")
        model_url = MODEL_URL_ZIP
        archive_name = "model.zip"
        extract_func = extract_zip
    else:
        print("Using tar.bz2 format")
        model_url = MODEL_URL_BZ2
        archive_name = "model.tar.bz2"
        extract_func = extract_tar_bz2

    # Download archive to temp directory first (better for Windows)
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        archive_path = temp_path / archive_name

        try:
            download_file(model_url, archive_path, "Downloading SenseVoice model")
        except Exception as e:
            # If ZIP download fails, try the other format
            if use_zip:
                print(f"ZIP download failed ({e}), trying tar.bz2...")
                if check_bz2_support():
                    model_url = MODEL_URL_BZ2
                    archive_path = temp_path / "model.tar.bz2"
                    extract_func = extract_tar_bz2
                    download_file(model_url, archive_path, "Downloading SenseVoice model (tar.bz2)")
                else:
                    raise
            else:
                raise

        # Extract archive
        extract_func(archive_path, temp_path)

        # Move files from extracted folder to cache_dir
        extracted_dir = temp_path / MODEL_NAME
        if extracted_dir.exists():
            print("Moving model files to cache directory...")
            
            # Copy INT8 model and tokens
            int8_model = extracted_dir / "model.int8.onnx"
            tokens = extracted_dir / "tokens.txt"

            if int8_model.exists():
                move_file_safe(int8_model, cache_dir / "model.int8.onnx")
                print("  - Moved model.int8.onnx")
            else:
                raise FileNotFoundError(f"model.int8.onnx not found in {extracted_dir}")
            
            if tokens.exists():
                move_file_safe(tokens, cache_dir / "tokens.txt")
                print("  - Moved tokens.txt")
            else:
                raise FileNotFoundError(f"tokens.txt not found in {extracted_dir}")

            # Also copy FP32 model if exists (optional)
            fp32_model = extracted_dir / "model.onnx"
            if fp32_model.exists():
                move_file_safe(fp32_model, cache_dir / "model.onnx")
                print("  - Moved model.onnx (FP32)")

        else:
            # Some archives might extract directly without subdirectory
            raise FileNotFoundError(
                f"Expected extracted directory {MODEL_NAME} not found. "
                f"Contents: {list(temp_path.iterdir())}"
            )

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


def get_default_cache_dir() -> Path:
    """Get the default cache directory based on platform."""
    if IS_WINDOWS:
        # Use LOCALAPPDATA on Windows
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / "sherpa-onnx" / "sense-voice"
        else:
            return Path.home() / ".cache" / "sherpa-onnx" / "sense-voice"
    else:
        # Use XDG cache or ~/.cache on Unix
        xdg_cache = os.environ.get("XDG_CACHE_HOME")
        if xdg_cache:
            return Path(xdg_cache) / "sherpa-onnx" / "sense-voice"
        else:
            return Path.home() / ".cache" / "sherpa-onnx" / "sense-voice"


if __name__ == "__main__":
    # Default cache directory (platform-aware)
    default_cache = get_default_cache_dir()

    # Allow override via command line
    if len(sys.argv) > 1:
        cache_dir = Path(sys.argv[1])
    else:
        cache_dir = default_cache

    try:
        download_models(cache_dir)
    except Exception as e:
        print(f"\n❌ Error downloading models: {e}", file=sys.stderr)
        sys.exit(1)
