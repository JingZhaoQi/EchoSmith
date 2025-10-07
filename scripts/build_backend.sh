#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VENV_DIR="$ROOT_DIR/.venv"
BACKEND_DIR="$ROOT_DIR/backend"
DIST_DIR="$ROOT_DIR/backend/dist"

# Create and activate virtual environment
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# Install dependencies
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"
pip install pyinstaller

# Clean dist directory
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/backend"

# Build standalone backend executable with PyInstaller
cd "$BACKEND_DIR"
pyinstaller \
  --name backend \
  --onefile \
  --clean \
  --distpath "$DIST_DIR/backend" \
  --workpath "$DIST_DIR/build" \
  --specpath "$DIST_DIR" \
  --add-data "__init__.py:." \
  --add-data "app.py:." \
  --add-data "asr_engine.py:." \
  --add-data "task_store.py:." \
  __main__.py

echo "Backend executable built at $DIST_DIR/backend/backend"
