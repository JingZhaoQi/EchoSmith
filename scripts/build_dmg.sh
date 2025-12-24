#!/usr/bin/env bash
# Complete build script for EchoSmith DMG with bundled models
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MODELS_DIR="$ROOT_DIR/models"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
TAURI_DIR="$ROOT_DIR/tauri"
BUILD_OUTPUT_DIR="$ROOT_DIR/tauri_backend_dist"

echo "🚀 开始构建 EchoSmith DMG 安装包"
echo "📁 项目目录: $ROOT_DIR"
echo ""

# Step 1: Check and download models if needed
echo "📥 步骤 1/5: 检查并下载 AI 模型"
if [ ! -d "$MODELS_DIR/modelscope_hub" ]; then
    echo "   ⚠️  模型未找到，开始下载..."
    echo "   这可能需要 5-10 分钟，取决于网络速度"
    echo ""

    # Create and activate temporary venv for model download
    TEMP_VENV_MODELS=$(mktemp -d)
    python3 -m venv "$TEMP_VENV_MODELS"
    source "$TEMP_VENV_MODELS/bin/activate"

    # Install dependencies for model download
    pip install --quiet --upgrade pip
    pip install --quiet -r "$BACKEND_DIR/requirements.txt"

    # Download models
    python3 "$ROOT_DIR/scripts/download_models.py"

    # Cleanup
    deactivate
    rm -rf "$TEMP_VENV_MODELS"
    echo ""
else
    echo "   ✅ 模型已存在，跳过下载"

    # Show model size
    MODELS_SIZE=$(du -sh "$MODELS_DIR/modelscope_hub" | cut -f1)
    echo "   💾 模型大小: $MODELS_SIZE"
    echo ""
fi

# Step 2: Build backend with PyInstaller
echo "🔧 步骤 2/5: 构建 Python 后端"
echo "   正在打包 backend + 模型..."

# Create temporary virtual environment for build
TEMP_VENV=$(mktemp -d)
python3 -m venv "$TEMP_VENV"
source "$TEMP_VENV/bin/activate"

# Install dependencies
pip install --quiet --upgrade pip
pip install --quiet -r "$BACKEND_DIR/requirements.txt"
pip install --quiet pyinstaller

# Clean output directory
rm -rf "$BUILD_OUTPUT_DIR"
mkdir -p "$BUILD_OUTPUT_DIR"

# Build standalone backend executable with PyInstaller
# Include models directory in the bundle
# Use --onedir for better startup performance with large models
cd "$BACKEND_DIR"
pyinstaller \
  --name backend \
  --onedir \
  --clean \
  --distpath "$BUILD_OUTPUT_DIR" \
  --workpath "$BUILD_OUTPUT_DIR/build" \
  --specpath "$BUILD_OUTPUT_DIR" \
  --hidden-import backend \
  --hidden-import backend.app \
  --hidden-import backend.asr_engine \
  --hidden-import backend.task_store \
  --add-data "$MODELS_DIR/modelscope_hub:models/modelscope_hub" \
  __main__.py

# Cleanup temporary venv
deactivate
rm -rf "$TEMP_VENV"

echo "   ✅ Backend 构建完成"
BACKEND_SIZE=$(du -sh "$BUILD_OUTPUT_DIR/backend" | cut -f1)
echo "   💾 Backend 大小: $BACKEND_SIZE"
echo ""

# Step 3: Build frontend
echo "🎨 步骤 3/5: 构建前端资源"
cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
    echo "   📦 安装前端依赖..."
    pnpm install
fi

echo "   🏗️  构建前端..."
pnpm run build

# Copy frontend dist to tauri expected location
FRONTEND_DIST="$TAURI_DIR/src-tauri/frontend_resources"
rm -rf "$FRONTEND_DIST"
cp -r "$FRONTEND_DIR/dist" "$FRONTEND_DIST"

echo "   ✅ 前端构建完成"
echo ""

# Step 4: Copy backend to tauri resources
# Now using --onedir mode, so we copy the entire backend directory
echo "📦 步骤 4/5: 准备 Tauri 资源"
TAURI_BACKEND_DIR="$TAURI_DIR/src-tauri/backend"
rm -rf "$TAURI_BACKEND_DIR"
# Copy the entire backend directory (contains backend executable + _internal dependencies)
cp -r "$BUILD_OUTPUT_DIR/backend" "$TAURI_BACKEND_DIR"

echo "   ✅ 资源准备完成"
echo ""

# Step 5: Build Tauri DMG
echo "🍎 步骤 5/5: 构建 macOS DMG 安装包"
cd "$TAURI_DIR"

echo "   正在编译 Rust 代码并打包 DMG..."
echo "   这可能需要几分钟..."
echo ""

pnpm tauri build --target universal-apple-darwin

echo ""
echo "🎉 ========== 构建完成！ =========="
echo ""
echo "📦 DMG 文件位置:"
DMG_PATH=$(find "$TAURI_DIR/src-tauri/target/universal-apple-darwin/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)
if [ -n "$DMG_PATH" ]; then
    echo "   $DMG_PATH"
    DMG_SIZE=$(du -sh "$DMG_PATH" | cut -f1)
    echo "   💾 文件大小: $DMG_SIZE"
else
    echo "   ⚠️  DMG 文件未找到，请检查构建日志"
fi

echo ""
echo "✨ 现在可以在任意 macOS 电脑上安装此 DMG 文件！"
echo "   所有模型和依赖已包含在内，无需联网下载。"
echo ""
