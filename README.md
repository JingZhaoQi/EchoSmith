<div align="center">
  <img src="frontend/echo_logo.svg" alt="EchoSmith Logo" width="200"/>

  # 闻见 · EchoSmith

  **高性能本地语音转录桌面应用，基于 SenseVoice + sherpa-onnx**

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/JingZhaoQi/EchoSmith/releases)
  [![Version](https://img.shields.io/badge/version-1.2.0-green)](https://github.com/JingZhaoQi/EchoSmith/releases)

</div>

## 特性

- **完全离线** — 本地运行，无需联网，数据不出本机
- **极速转录** — RTF ~0.042，1 小时音频约 2.5 分钟完成
- **智能分句** — Silero VAD 语音活动检测，按语音停顿自动断句
- **批量处理** — 多文件批量转写，自动导出到源文件目录
- **URL 下载** — 粘贴链接直接下载并转写（基于 yt-dlp）
- **实时进度** — WebSocket 推送转录进度和中间结果
- **多格式导出** — TXT、SRT 字幕、JSON 三种格式
- **跨平台** — 支持 macOS（Intel / Apple Silicon）和 Windows
- **现代界面** — 毛玻璃质感 UI，支持浅色 / 深色模式

## 性能

| 指标 | 数值 |
|------|------|
| RTF（实时率） | ~0.042 |
| 1 小时音频转写 | ~2.5 分钟 |
| 模型大小 | 228 MB（INT8 量化） |
| 安装包大小 | ~290 MB |
| 内存占用 | ~500 MB |

> 测试环境：Apple M1 Max，8 性能核心。应用会自动检测 CPU 核心数以获得最佳性能。

## 安装

### 下载预编译版本

前往 [Releases](https://github.com/JingZhaoQi/EchoSmith/releases) 页面下载：

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS | `EchoSmith_x.x.x_universal.dmg` | Intel + Apple Silicon 通用 |
| Windows | `EchoSmith_x.x.x_x64-setup.exe` | NSIS 安装包 |
| Windows | `EchoSmith_x.x.x_x64_en-US.msi` | MSI 安装包 |

**macOS 首次运行**：右键点击应用 → 打开（绕过 Gatekeeper），或在终端执行：

```bash
xattr -cr /Applications/EchoSmith.app
```

### 从源码构建

#### 前置要求

- Node.js 20+、pnpm
- Python 3.12+
- Rust（最新稳定版）
- FFmpeg

#### 快速开始

```bash
# 克隆仓库
git clone https://github.com/JingZhaoQi/EchoSmith.git
cd EchoSmith

# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r backend/requirements.txt
cd frontend && pnpm install && cd ..
cd tauri && pnpm install && cd ..

# 下载模型（首次运行，约 230MB）
python scripts/download_models.py

# 启动开发模式
./start_dev.sh
```

#### 构建安装包

```bash
# macOS DMG
bash scripts/build_local_dmg.sh

# Windows（在 Windows 上运行）
powershell scripts/build_backend.ps1
cd tauri && npm run build
```

## 使用说明

### 单文件转写
1. 点击上传区域或拖拽音视频文件
2. 等待转写完成
3. 导出为 TXT / SRT / JSON

### 批量转写
1. 切换到「批量转写」标签
2. 选择导出格式
3. 添加多个文件
4. 点击「开始转写」，结果自动保存到源文件目录

### URL 转写
1. 切换到「URL 转写」标签
2. 粘贴音视频链接
3. 自动下载并转写

### 支持的格式

音频：MP3、WAV、M4A、FLAC、OGG、AAC、WMA、AIFF、CAF
视频：MP4、MOV、AVI、MKV、WEBM、M4V

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2.x + Rust |
| 前端 | React 18 + TypeScript + TailwindCSS + Vite |
| 状态管理 | Zustand |
| 后端 | FastAPI + uvicorn |
| ASR 引擎 | sherpa-onnx + SenseVoice INT8 |
| 语音分段 | Silero VAD |
| 音视频处理 | FFmpeg（内置） |
| URL 下载 | yt-dlp |

## 项目结构

```
EchoSmith/
├── backend/                # FastAPI 后端
│   ├── __main__.py         # 入口
│   ├── app.py              # API 路由 + WebSocket
│   ├── asr_engine.py       # sherpa-onnx + VAD 引擎
│   ├── task_store.py       # 任务状态管理
│   └── url_downloader.py   # URL 下载（yt-dlp）
├── frontend/               # React 前端
│   └── src/
│       ├── app/            # 主应用 + Tab 切换
│       ├── components/     # UI 组件
│       ├── hooks/          # React Hooks
│       └── lib/            # API 客户端 + 工具
├── tauri/src-tauri/        # Tauri 桌面壳
│   ├── src/main.rs         # 后端生命周期管理
│   └── icons/              # 应用图标 + NSIS 安装图
└── scripts/                # 构建 + 模型下载脚本
```

## API

### REST

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/tasks` | 创建转写任务（文件上传） |
| POST | `/api/tasks/from-path` | 从本地路径创建任务 |
| POST | `/api/tasks/from-url` | 从 URL 下载并创建任务 |
| GET | `/api/tasks` | 获取任务列表 |
| GET | `/api/tasks/{id}` | 获取任务详情 |
| POST | `/api/tasks/{id}/pause` | 暂停任务 |
| POST | `/api/tasks/{id}/resume` | 恢复任务 |
| POST | `/api/tasks/{id}/cancel` | 取消任务 |
| GET | `/api/tasks/{id}/export` | 导出结果 |
| POST | `/api/tasks/{id}/auto-export` | 自动导出到源文件目录 |

### WebSocket

`ws://localhost:{port}/ws/tasks/{id}` — 实时接收任务进度和转录结果

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

## 致谢

- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) — 阿里 FunAudioLLM 语音识别模型
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — 高性能 ONNX 推理引擎
- [Silero VAD](https://github.com/snakers4/silero-vad) — 语音活动检测模型
- [Tauri](https://tauri.app/) — 现代桌面应用框架
- [FastAPI](https://fastapi.tiangolo.com/) — 高性能 Web 框架
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — 视频下载工具

---

<div align="center">
  Made with ❤️ by JingZhaoQi
</div>
