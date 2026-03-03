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
  # Only copy essential files (INT8 model + tokens + VAD)
  cp "$SHERPA_MODEL_SRC/model.int8.onnx" "$MODELS_CACHE/"
  cp "$SHERPA_MODEL_SRC/tokens.txt" "$MODELS_CACHE/"
  # Copy Silero VAD model if available
  SILERO_VAD="$HOME/.cache/sherpa-onnx/silero_vad.onnx"
  if [ -f "$SILERO_VAD" ]; then
    cp "$SILERO_VAD" "$MODELS_CACHE/"
    echo "Copied Silero VAD model"
  else
    echo "WARNING: silero_vad.onnx not found at $SILERO_VAD"
  fi
  echo "Copied models to: $MODELS_CACHE"
  ls -lh "$MODELS_CACHE"
else
  echo "WARNING: No sherpa-onnx models found at $SHERPA_MODEL_SRC"
  echo "Please run: python scripts/download_models.py first"
fi

# Prepare ffmpeg binaries
FFMPEG_DIR="$ROOT_DIR/ffmpeg_bin"
rm -rf "$FFMPEG_DIR"
mkdir -p "$FFMPEG_DIR"

echo "=== Bundling ffmpeg ==="
# Try to find ffmpeg from common locations
FFMPEG_PATH=$(which ffmpeg 2>/dev/null || echo "")
FFPROBE_PATH=$(which ffprobe 2>/dev/null || echo "")

if [ -n "$FFMPEG_PATH" ] && [ -n "$FFPROBE_PATH" ]; then
  echo "Found ffmpeg at: $FFMPEG_PATH"
  echo "Found ffprobe at: $FFPROBE_PATH"
  cp "$FFMPEG_PATH" "$FFMPEG_DIR/"
  cp "$FFPROBE_PATH" "$FFMPEG_DIR/"
  chmod +x "$FFMPEG_DIR/ffmpeg" "$FFMPEG_DIR/ffprobe"

  # Recursively collect all non-system dylib dependencies so ffmpeg works
  # on Macs without homebrew.
  echo "Collecting ffmpeg dynamic library dependencies..."
  collect_dylib_deps() {
    local binary="$1"
    local dest="$2"
    while read -r dep; do
      # Skip system frameworks / libs / empty lines
      case "$dep" in
        /usr/lib/*|/System/*|"") continue ;;
      esac
      local libname actual
      if [[ "$dep" == @rpath/* ]]; then
        libname="${dep#@rpath/}"
        actual=""
        for d in /opt/homebrew/lib /usr/local/lib; do
          [ -f "$d/$libname" ] && { actual="$d/$libname"; break; }
        done
      elif [[ "$dep" == @loader_path/* ]]; then
        libname="${dep#@loader_path/}"
        actual="$(dirname "$binary")/$libname"
      elif [[ "$dep" == @* ]]; then
        continue
      else
        libname=$(basename "$dep")
        actual="$dep"
      fi
      [ -z "$actual" ] || [ ! -f "$actual" ] && continue
      [ -f "$dest/$libname" ] && continue
      cp "$actual" "$dest/$libname"
      chmod 644 "$dest/$libname"
      echo "  + $libname"
      collect_dylib_deps "$dest/$libname" "$dest"
    done < <(otool -L "$binary" 2>/dev/null | tail -n +2 | awk '{print $1}')
  }
  collect_dylib_deps "$FFMPEG_DIR/ffmpeg" "$FFMPEG_DIR"
  collect_dylib_deps "$FFMPEG_DIR/ffprobe" "$FFMPEG_DIR"
  DYLIB_COUNT=$(find "$FFMPEG_DIR" -name "*.dylib" 2>/dev/null | wc -l | tr -d ' ')
  echo "Collected $DYLIB_COUNT dynamic libraries"

  # Rewrite library paths: change absolute/rpath references to @loader_path
  echo "Rewriting library paths with install_name_tool..."
  rewrite_dylib_paths() {
    local binary="$1"
    local dir="$2"
    while read -r dep; do
      case "$dep" in
        /usr/lib/*|/System/*|@loader_path/*|"") continue ;;
      esac
      local libname
      if [[ "$dep" == @rpath/* ]]; then
        libname="${dep#@rpath/}"
      else
        libname=$(basename "$dep")
      fi
      [ -f "$dir/$libname" ] || continue
      install_name_tool -change "$dep" "@loader_path/$libname" "$binary" 2>/dev/null || true
    done < <(otool -L "$binary" 2>/dev/null | tail -n +2 | awk '{print $1}')
  }
  for binary in "$FFMPEG_DIR"/*; do
    [ -f "$binary" ] || continue
    rewrite_dylib_paths "$binary" "$FFMPEG_DIR"
  done
  echo "Library paths rewritten"

  ls -lh "$FFMPEG_DIR"
else
  echo "WARNING: ffmpeg/ffprobe not found, downloading..."
  # Download static ffmpeg for macOS
  ARCH=$(uname -m)
  if [ "$ARCH" = "arm64" ]; then
    FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/ffmpeg/7.1/arm64"
    FFPROBE_URL="https://evermeet.cx/ffmpeg/getrelease/ffprobe/7.1/arm64"
  else
    FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/ffmpeg/7.1"
    FFPROBE_URL="https://evermeet.cx/ffmpeg/getrelease/ffprobe/7.1"
  fi
  curl -L "$FFMPEG_URL" -o "$FFMPEG_DIR/ffmpeg.7z"
  curl -L "$FFPROBE_URL" -o "$FFMPEG_DIR/ffprobe.7z"
  cd "$FFMPEG_DIR"
  7z x ffmpeg.7z || unzip ffmpeg.7z || tar -xf ffmpeg.7z 2>/dev/null || true
  7z x ffprobe.7z || unzip ffprobe.7z || tar -xf ffprobe.7z 2>/dev/null || true
  rm -f *.7z
  chmod +x ffmpeg ffprobe 2>/dev/null || true
  cd "$ROOT_DIR"
  ls -lh "$FFMPEG_DIR"
fi

# Build standalone backend executable with PyInstaller
cd "$BACKEND_DIR"

# Build arguments
ADD_DATA_ARGS=""
if [ -d "$MODELS_CACHE" ]; then
  ADD_DATA_ARGS="--add-data $ROOT_DIR/models_cache:models_cache"
fi

# Add ffmpeg binaries
if [ -d "$FFMPEG_DIR" ] && [ -f "$FFMPEG_DIR/ffmpeg" ]; then
  ADD_DATA_ARGS="$ADD_DATA_ARGS --add-data $FFMPEG_DIR:ffmpeg_bin"
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
  --hidden-import url_downloader \
  --hidden-import certifi \
  --collect-all sherpa_onnx \
  $ADD_DATA_ARGS \
  __main__.py

# Cleanup temporary venv
deactivate
rm -rf "$TEMP_VENV"

echo ""
echo "=== Backend build complete ==="
echo "Output: $BUILD_OUTPUT_DIR/backend/"
ls -lh "$BUILD_OUTPUT_DIR/backend/"
