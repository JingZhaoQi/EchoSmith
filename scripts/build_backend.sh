#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BACKEND_DIR="$ROOT_DIR/backend"
BUILD_OUTPUT_DIR="$ROOT_DIR/tauri_backend_dist"

# Create temporary virtual environment for build
TEMP_VENV=$(mktemp -d)
python3 -m venv "$TEMP_VENV"
source "$TEMP_VENV/bin/activate"

# Install dependencies
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"
pip install pyinstaller

# Clean output directory
rm -rf "$BUILD_OUTPUT_DIR"
mkdir -p "$BUILD_OUTPUT_DIR"

# Build standalone backend executable with PyInstaller
cd "$BACKEND_DIR"
pyinstaller \
  --name backend \
  --onefile \
  --clean \
  --distpath "$BUILD_OUTPUT_DIR/backend" \
  --workpath "$BUILD_OUTPUT_DIR/build" \
  --specpath "$BUILD_OUTPUT_DIR" \
  --hidden-import backend \
  --hidden-import backend.app \
  --hidden-import backend.asr_engine \
  --hidden-import backend.task_store \
  __main__.py

# Cleanup temporary venv
deactivate
rm -rf "$TEMP_VENV"

echo "Backend executable built at $BUILD_OUTPUT_DIR/backend/backend"
