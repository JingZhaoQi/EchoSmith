#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VENV_DIR="$ROOT_DIR/.venv"
BACKEND_DIR="$ROOT_DIR/backend"
DIST_DIR="$ROOT_DIR/backend/dist"

python -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
rsync -a --exclude "dist" --exclude "__pycache__" "$BACKEND_DIR/" "$DIST_DIR/"

echo "Backend build artifacts ready in $DIST_DIR"
