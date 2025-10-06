#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

echo "[1/3] Building backend distribution"
"$ROOT_DIR/scripts/build_backend.sh"

echo "[2/3] Building frontend assets"
cd "$ROOT_DIR/frontend"
npm install
npm run build

cd "$ROOT_DIR/tauri"
npm install
npm run build

echo "[3/3] Building Tauri bundle"
npm run tauri build
