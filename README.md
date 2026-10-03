<div align="center">
  <img src="frontend/echo_logo.svg" alt="EchoSmith Logo" width="200"/>

  # 闻见 · EchoSmith

  **高性能本地语音转录桌面应用，基于 SenseVoice + sherpa-onnx**

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/JingZhaoQi/EchoSmith/releases)
  [![Version](https://img.shields.io/badge/version-2.0.0-green)](https://github.com/JingZhaoQi/EchoSmith/releases)

</div>

## 特性

- **本地优先** — 识别完全在本机运行，无需联网，音频不出本机；智能纠错为可选项，开启后只把文字发给你选择的服务商
- **本地识别** — SenseVoice INT8（sherpa-onnx）离线转写，模型首次运行自动下载
- **极速转录** — SenseVoice 路径 RTF ~0.042，1 小时音频约 2.5 分钟完成；边解码边识别，开始后约 1 秒出字
- **智能纠错** — 接入大模型 API（OpenAI / DeepSeek / 豆包 / Anthropic / 兼容接口）修正同音字与术语错误；流式输出，边转写边纠错，数秒内出字（DeepSeek / 豆包默认关闭推理模式：实测每千字从约 14 秒降到约 5 秒，首字约 3 秒）
- **原文对照** — 左侧导入，右侧 ASR 原文与纠错结果左右对照，各有进度条；栏宽可拖动调整，关闭纠错时原文铺满
- **热词表** — 纠错时优先使用的正确写法（堂会名、人名、少见术语），设置中可查看、搜索、添加、删除、导入、导出
- **精确时间码** — Silero VAD 按停顿切分，SenseVoice 逐字时间戳切字幕句；纠错后的文字按字对齐回原文时间轴
- **批量处理** — 多文件批量转写；文件列表兼任务列表，点击查看结果，可暂停 / 继续 / 移除
- **URL 下载** — 粘贴链接直接下载并转写（基于 yt-dlp）
- **实时进度** — WebSocket 推送转录进度和中间结果
- **默认保存** — 点亮 TXT / SRT / Markdown，任务完成即自动保存到源文件旁（在线视频存到「下载」）；Markdown 按停顿分段
- **跨平台** — 支持 macOS（Intel / Apple Silicon）和 Windows
- **现代界面** — 液态玻璃质感 UI，浅色 / 深色 / 跟随系统，中文 / English 界面切换；设置实时保存

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
cd tauri && pnpm tauri dev
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

### 本地文件（单个或批量）
1. 在左侧「本地批量」点击选择文件，或把音视频文件拖进窗口任意位置
2. 在右上角点亮要自动保存的格式（TXT / SRT / Markdown，可多选）
3. 点击「开始转写」：右侧实时显示 ASR 原文和纠错结果，完成后自动保存到源文件旁
4. 点击左侧列表中的文件查看它的结果；任务完成后再点亮某种格式会立刻补存

### 在线视频
1. 切换到「在线视频」标签，粘贴链接或分享文本（B 站、YouTube、抖音等）
2. 点击「开始转写」：自动下载音频并转写，结果保存到「下载」文件夹；也可只下载视频或音频

### 智能纠错（可选）
在「设置」中开启云端 API 纠错，选择服务商并填入 API Key；所有设置改动即时生效。

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
| 文本纠错 | 大模型云 API（OpenAI 兼容 / Anthropic），流式并发纠错 |
| 语音分段 | Silero VAD |
| 音视频处理 | FFmpeg（内置） |
| URL 下载 | yt-dlp |

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
