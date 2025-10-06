# 发布新版本指南

本项目使用GitHub Actions自动构建macOS和Windows安装包。

## 自动构建流程

### 方式1：创建Git Tag触发（推荐）

1. **提交所有更改**
   ```bash
   git add .
   git commit -m "准备发布 v0.1.0"
   ```

2. **创建版本标签**
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. **查看构建进度**
   - 访问：https://github.com/你的用户名/你的仓库名/actions
   - 等待构建完成（约10-15分钟）

4. **下载安装包**
   - 构建完成后，在 [Releases](https://github.com/你的用户名/你的仓库名/releases) 页面会自动创建草稿
   - 下载dmg（macOS）和exe/msi（Windows）文件
   - 编辑发布说明后点击"Publish release"发布

### 方式2：手动触发构建

1. 访问：https://github.com/你的用户名/你的仓库名/actions
2. 选择"Build and Release"工作流
3. 点击"Run workflow"按钮
4. 选择分支（通常是main），点击"Run workflow"
5. 等待构建完成后，在Actions页面下载Artifacts

## 构建产物

- **macOS**: `echosmith-macos/闻见_0.1.0_aarch64.dmg` 或 `闻见_0.1.0_x64.dmg`
- **Windows**:
  - `echosmith-windows/闻见_0.1.0_x64_en-US.msi` (MSI安装包)
  - `echosmith-windows/闻见_0.1.0_x64-setup.exe` (NSIS安装包)

## 本地构建

### macOS
```bash
./scripts/package_all.sh
# 构建产物在: tauri/src-tauri/target/release/bundle/dmg/
```

### Windows
```powershell
.\scripts\package_all.ps1
# 构建产物在: tauri\src-tauri\target\release\bundle\
```

## 版本号管理

版本号在以下文件中定义：
- `tauri/src-tauri/tauri.conf.json` - `package.version`
- `tauri/package.json` - `version`
- `frontend/package.json` - `version`

发布新版本前，请确保这三个文件的版本号一致。

## 故障排除

### 构建失败
1. 检查GitHub Actions日志查看具体错误
2. 确保所有依赖文件都已提交到仓库
3. 检查Python和Node.js依赖是否正确

### 无法创建Release
1. 确保推送了Git Tag
2. 检查GitHub仓库是否有Releases权限
3. 确认GITHUB_TOKEN权限正确
