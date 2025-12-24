<div align="center">
  <img src="frontend/echo_logo.svg" alt="EchoSmith Logo" width="200"/>

  # 闻见 · EchoSmith

  **高性能本地语音转录桌面应用，基于 SenseVoice + sherpa-onnx**

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-blue)](https://github.com/JingZhaoQi/EchoSmith/releases)
  [![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/JingZhaoQi/EchoSmith/releases)

</div>

## ✨ 特性

- 🎯 **完全离线** - 本地运行，无需联网，保护隐私
- ⚡ **极速转录** - RTF ~0.042，1小时音频仅需2.5分钟
- 🎨 **现代界面** - React + TailwindCSS，支持浅色/深色模式
- 📁 **批量处理** - 支持多文件批量转写，自动导出
- 🔄 **实时进度** - WebSocket 实时显示转录进度
- 📝 **多格式导出** - TXT、SRT、JSON 格式导出
- 🪶 **轻量安装** - 安装包仅 195MB

## 🚀 性能

| 指标 | 数值 |
|------|------|
| RTF (实时率) | ~0.042 |
| 1小时音频转写时间 | ~2.5 分钟 |
| 模型大小 | 228 MB (INT8) |
| 安装包大小 | 195 MB |
| 内存占用 | ~500 MB |

## 🏗️ 技术栈

### 前端
- **Tauri 2.x** - 轻量级桌面应用框架
- **React 18** - 现代化 UI 框架
- **TypeScript** - 类型安全
- **TailwindCSS** - 实用优先的 CSS 框架
- **Vite** - 快速构建工具
- **Zustand** - 轻量级状态管理

### 后端
- **FastAPI** - 高性能 Python Web 框架
- **sherpa-onnx** - ONNX Runtime 推理引擎
- **SenseVoice** - 阿里 FunAudioLLM 语音识别模型 (INT8 量化)
- **FFmpeg** - 音视频处理

## 📦 安装

### 下载预编译版本

前往 [Releases](https://github.com/JingZhaoQi/EchoSmith/releases) 页面下载：

- **macOS (Apple Silicon)**: `EchoSmith_x.x.x_aarch64.dmg`

> 首次运行：右键点击应用 → 打开（绕过 Gatekeeper）

### 从源码构建

#### 前置要求

- **Node.js** 20+
- **Python** 3.12+
- **Rust** (最新稳定版)
- **pnpm**
- **FFmpeg**

#### 快速开始

```bash
# 克隆仓库
git clone https://github.com/JingZhaoQi/EchoSmith.git
cd EchoSmith

# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装 Python 依赖
pip install -r backend/requirements.txt

# 安装前端依赖
cd frontend && pnpm install && cd ..
cd tauri && pnpm install && cd ..

# 下载模型 (首次运行)
python scripts/download_models.py

# 启动开发模式
./start_dev.sh
```

#### 构建 DMG

```bash
bash scripts/build_local_dmg.sh
```

构建完成后，DMG 位于项目根目录。

## 📖 使用说明

### 单文件转写
1. 启动应用
2. 点击上传区域或拖拽文件
3. 点击"开始转写"
4. 转写完成后导出结果

### 批量转写
1. 切换到"批量转写"标签
2. 选择导出格式 (TXT/SRT/JSON)
3. 点击选择多个文件
4. 点击"开始转写"
5. 结果自动保存到源文件目录

## 🔧 配置

### 模型位置

模型文件存储在 `~/.cache/sherpa-onnx/sense-voice/`：
- `model.int8.onnx` - INT8 量化模型 (228MB)
- `tokens.txt` - 词表文件

### 支持的格式

音频：MP3、WAV、M4A、FLAC、OGG、AAC、WMA
视频：MP4、MOV、AVI、MKV、WEBM

## 📂 项目结构

```
EchoSmith/
├── backend/              # FastAPI 后端
│   ├── __main__.py      # 入口文件
│   ├── app.py           # API 路由
│   ├── asr_engine.py    # sherpa-onnx 引擎
│   └── task_store.py    # 任务存储
├── frontend/            # React 前端
│   └── src/
│       ├── components/  # UI 组件
│       ├── lib/         # 工具库
│       └── hooks/       # React Hooks
├── tauri/               # Tauri 桌面应用
│   └── src-tauri/
├── scripts/             # 构建脚本
│   ├── build_backend.sh
│   ├── build_local_dmg.sh
│   └── download_models.py
└── docs/
    └── ASR_OPTIMIZATION.md  # 性能优化文档
```

## 🛠️ API 接口

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/tasks` | 创建转写任务 |
| GET | `/api/tasks` | 获取任务列表 |
| GET | `/api/tasks/{id}` | 获取任务详情 |
| DELETE | `/api/tasks/{id}` | 删除任务 |
| GET | `/api/tasks/{id}/export` | 导出结果 (txt/srt/json) |

### WebSocket

`ws://localhost:{port}/ws/tasks/{id}` - 实时接收任务进度

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

## 🙏 致谢

- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) - 阿里 FunAudioLLM 语音识别模型
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) - 高性能 ONNX 推理引擎
- [Tauri](https://tauri.app/) - 现代化桌面应用框架
- [FastAPI](https://fastapi.tiangolo.com/) - 高性能 Web 框架

---

<div align="center">
  Made with ❤️ by JingZhaoQi
</div>
