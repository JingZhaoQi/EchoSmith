#!/usr/bin/env bash
set -e

# EchoSmith 开发模式启动脚本
# 直接运行: bash start_dev.sh 或 ./start_dev.sh

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "=== 启动 EchoSmith 开发模式 ==="
echo "项目目录: $ROOT_DIR"
echo ""

# Activate local Python virtualenv if present (avoids Anaconda conflicts)
if [ -d "$ROOT_DIR/.venv" ]; then
  echo "使用本地虚拟环境: $ROOT_DIR/.venv"
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.venv/bin/activate"
elif [ -d "$ROOT_DIR/venv" ]; then
  echo "使用本地虚拟环境: $ROOT_DIR/venv"
  # shellcheck disable=SC1091
  source "$ROOT_DIR/venv/bin/activate"
else
  echo "未检测到本地虚拟环境 (.venv/venv)，将使用系统 Python"
fi

cd "$ROOT_DIR/tauri"
pnpm tauri dev
