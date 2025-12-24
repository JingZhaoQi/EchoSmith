#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BACKEND_DIR="$ROOT_DIR/backend"
BUILD_OUTPUT_DIR="$ROOT_DIR/tauri_backend_dist"

echo "=== Building EchoSmith Backend ==="
echo "Root: $ROOT_DIR"

# Create temporary virtual environment for build
TEMP_VENV=$(mktemp -d)
echo "Creating temp venv at: $TEMP_VENV"
python3 -m venv "$TEMP_VENV"
source "$TEMP_VENV/bin/activate"

# Install dependencies
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"
pip install pyinstaller

# Clean output directory
rm -rf "$BUILD_OUTPUT_DIR"
mkdir -p "$BUILD_OUTPUT_DIR"

# Prepare models cache directory (only INT8 model + tokens)
MODELS_CACHE="$ROOT_DIR/models_cache/sherpa-onnx"
SHERPA_MODEL_SRC="$HOME/.cache/sherpa-onnx/sense-voice"

if [ -d "$SHERPA_MODEL_SRC" ]; then
  echo "Found sherpa-onnx models at: $SHERPA_MODEL_SRC"
  rm -rf "$MODELS_CACHE"
  mkdir -p "$MODELS_CACHE"
  # Only copy essential files (INT8 model + tokens)
  cp "$SHERPA_MODEL_SRC/model.int8.onnx" "$MODELS_CACHE/"
  cp "$SHERPA_MODEL_SRC/tokens.txt" "$MODELS_CACHE/"
  echo "Copied INT8 model to: $MODELS_CACHE"
  ls -lh "$MODELS_CACHE"
else
  echo "WARNING: No sherpa-onnx models found at $SHERPA_MODEL_SRC"
  echo "Please run: python scripts/download_models.py first"
fi

# Build standalone backend executable with PyInstaller
cd "$BACKEND_DIR"

# Build arguments
ADD_DATA_ARGS=""
if [ -d "$MODELS_CACHE" ]; then
  ADD_DATA_ARGS="--add-data $ROOT_DIR/models_cache:models_cache"
fi

pyinstaller \
  --name backend \
  --onedir \
  --clean \
  --distpath "$BUILD_OUTPUT_DIR" \
  --workpath "$BUILD_OUTPUT_DIR/build" \
  --specpath "$BUILD_OUTPUT_DIR" \
  --paths "$BACKEND_DIR" \
  --hidden-import app \
  --hidden-import asr_engine \
  --hidden-import task_store \
  --collect-all sherpa_onnx \
  $ADD_DATA_ARGS \
  __main__.py

# Cleanup temporary venv
deactivate
rm -rf "$TEMP_VENV"

echo ""
echo "=== Backend build complete ==="
echo "Output: $BUILD_OUTPUT_DIR/backend/"
