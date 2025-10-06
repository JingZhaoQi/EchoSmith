<div align="center">
  <img src="assets/icons/echo_logo.svg" alt="EchoSmith Logo" width="200"/>

  # 闻见 · EchoSmith

  **一款基于 FunASR 的本地语音转录桌面应用**

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/JingZhaoQi/EchoSmith/releases)
  [![Version](https://img.shields.io/badge/version-0.1.0-green)](https://github.com/JingZhaoQi/EchoSmith/releases)

</div>

## ✨ 特性

- 🎯 **本地转录** - 完全离线运行，保护隐私
- 🚀 **高性能** - 基于阿里达摩院 FunASR 引擎
- 🎨 **现代化界面** - React + TailwindCSS，支持浅色/深色模式
- 📁 **多格式支持** - MP3、WAV、M4A、MP4、MOV 等常见格式
- 🔄 **实时进度** - WebSocket 实时显示转录进度
- 📝 **任务管理** - 查看历史任务，导出转录结果
- 💻 **跨平台** - 支持 macOS 和 Windows

## 📸 界面预览

> 简洁优雅的用户界面，支持深色模式

## 🏗️ 技术栈

### 前端
- **Tauri** - 轻量级桌面应用框架
- **React 18** - 现代化 UI 框架
- **TypeScript** - 类型安全
- **TailwindCSS** - 实用优先的 CSS 框架
- **Vite** - 快速构建工具
- **TanStack Query** - 数据获取和缓存
- **Zustand** - 轻量级状态管理

### 后端
- **FastAPI** - 高性能 Python Web 框架
- **FunASR** - 阿里达摩院语音识别引擎
- **FFmpeg** - 音视频处理
- **WebSocket** - 实时通信

## 📦 安装

### 下载预编译版本

前往 [Releases](https://github.com/JingZhaoQi/EchoSmith/releases) 页面下载适合你系统的版本：

- **macOS**: `EchoSmith_0.1.0_x64.dmg`
- **Windows**: `EchoSmith_0.1.0_x64.exe` 或 `EchoSmith_0.1.0_x64.msi`

### 从源码构建

#### 前置要求

- **Node.js** 20+
- **Python** 3.12+
- **Rust** (最新稳定版)
- **FFmpeg**

#### 克隆仓库

```bash
git clone https://github.com/JingZhaoQi/EchoSmith.git
cd EchoSmith
```

#### 安装依赖

```bash
# 安装 Python 依赖
pip install -r backend/requirements.txt

# 安装前端依赖
cd frontend
npm install
cd ..

# 安装 Tauri 依赖
cd tauri
npm install
cd ..
```

#### 构建后端

**macOS/Linux:**
```bash
bash scripts/build_backend.sh
```

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build_backend.ps1
```

#### 构建前端

```bash
cd frontend
npm run build
cp ../echo_logo.svg dist/
cd ..
```

#### 构建 Tauri 应用

```bash
cd tauri
npm run build
```

构建完成后，安装包位于 `tauri/src-tauri/target/release/bundle/` 目录。

## 🚀 开发

### 启动后端

```bash
python -m backend
```

后端将在 `http://localhost:5179` 运行。

### 启动前端

```bash
cd frontend
npm run dev
```

前端将在 `http://localhost:5173` 运行。

### 启动 Tauri

```bash
cd tauri
npm run tauri dev
```

## 📖 使用说明

1. **启动应用** - 打开 闻见·EchoSmith
2. **上传文件** - 点击上传区域或拖拽文件
3. **选择语言** - 支持中文、英文等多种语言
4. **开始转录** - 点击"开始转录"按钮
5. **查看结果** - 实时查看转录进度和结果
6. **导出文本** - 转录完成后可导出为文本文件

## 🔧 配置

### FunASR 模型

首次运行时，应用会自动下载所需的 FunASR 模型。模型文件存储在：

- **macOS/Linux**: `~/.cache/modelscope/`
- **Windows**: `%USERPROFILE%\.cache\modelscope\`

### 端口配置

- 后端 API: `5179`
- 前端开发服务器: `5173`

可在以下文件中修改：
- 后端: `backend/__main__.py`
- 前端代理: `frontend/vite.config.ts`

## 📂 项目结构

```
EchoSmith/
├── backend/              # FastAPI 后端
│   ├── __init__.py
│   ├── __main__.py      # 入口文件
│   ├── app.py           # API 路由
│   ├── asr_engine.py    # FunASR 引擎
│   └── task_store.py    # 任务存储
├── frontend/            # React 前端
│   ├── src/
│   │   ├── components/  # UI 组件
│   │   ├── lib/         # 工具库
│   │   ├── hooks/       # React Hooks
│   │   └── App.tsx      # 主应用
│   └── vite.config.ts
├── tauri/               # Tauri 桌面应用
│   ├── src-tauri/
│   │   ├── icons/       # 应用图标
│   │   └── tauri.conf.json
│   └── package.json
├── scripts/             # 构建脚本
│   ├── build_backend.sh
│   └── build_backend.ps1
└── .github/
    └── workflows/       # GitHub Actions
        └── build.yml
```

## 🛠️ API 接口

### REST API

- `GET /api/health` - 健康检查，验证 FFmpeg 和 FunASR 模型状态
- `POST /api/tasks` - 创建转录任务（上传本地文件）
- `GET /api/tasks` - 获取所有任务列表
- `GET /api/tasks/{id}` - 获取特定任务详情
- `DELETE /api/tasks/{id}` - 删除任务
- `GET /api/tasks/{id}/export?format=txt|json` - 导出转录结果

### WebSocket

- `ws://localhost:5179/ws/tasks/{id}` - 实时接收任务进度和转录结果

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [FunASR](https://github.com/alibaba-damo-academy/FunASR) - 阿里达摩院语音识别引擎
- [Tauri](https://tauri.app/) - 现代化桌面应用框架
- [React](https://react.dev/) - UI 框架
- [FastAPI](https://fastapi.tiangolo.com/) - 高性能 Web 框架

## 📮 联系方式

- GitHub: [@JingZhaoQi](https://github.com/JingZhaoQi)
- 项目地址: [https://github.com/JingZhaoQi/EchoSmith](https://github.com/JingZhaoQi/EchoSmith)

---

<div align="center">
  Made with ❤️ by JingZhaoQi
</div>
