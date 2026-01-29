# EchoSmith CI/CD 修复说明

## 概述

本次修复解决了两个主要问题：
1. **Windows 构建失败** - 模型下载脚本在 Windows 上不兼容
2. **macOS 安装包无法在其他电脑运行** - 缺少代码签名和公证

---

## 问题 1: Windows 构建兼容性修复

### 文件: `scripts/download_models.py`

#### 问题根因
1. **bz2 模块问题**: Windows Python 可能缺少 bz2 支持，导致 `tarfile.open(..., "r:bz2")` 失败
2. **Path.rename() 跨设备问题**: Windows 上跨驱动器移动文件时 `Path.rename()` 会失败
3. **路径格式**: 未考虑 Windows 路径分隔符差异

#### 修复内容

```python
# 1. 添加 ZIP 格式回退
MODEL_URL_ZIP = "...sherpa-onnx-sense-voice-....zip"  # ZIP 作为备选

# 2. 检测 bz2 支持
def check_bz2_support() -> bool:
    try:
        import bz2
        bz2.compress(b"test")
        return True
    except (ImportError, OSError):
        return False

# 3. 使用 shutil.move 替代 Path.rename
def move_file_safe(src: Path, dst: Path) -> None:
    shutil.move(str(src), str(dst))  # 处理跨设备移动

# 4. 使用临时目录安全解压
with tempfile.TemporaryDirectory() as temp_dir:
    # 解压到临时目录，再移动到目标

# 5. Windows 专用缓存目录
if IS_WINDOWS:
    return Path(os.environ.get("LOCALAPPDATA")) / "sherpa-onnx" / "sense-voice"
```

---

## 问题 2: macOS 代码签名与公证

### 文件: `.github/workflows/build.yml`

#### 问题根因
macOS Gatekeeper 会阻止未签名/未公证的应用运行，显示"无法验证开发者"错误。

#### 修复内容

##### 2.1 代码签名流程

```yaml
- name: Import Apple signing certificate
  run: |
    # 创建临时 keychain
    security create-keychain -p "$PASSWORD" "$KEYCHAIN_PATH"
    # 导入 .p12 证书
    security import certificate.p12 -k "$KEYCHAIN_PATH"
    # 设置 keychain 访问权限
    security set-key-partition-list -S apple-tool:,codesign: ...

- name: Sign Universal Binary
  run: |
    codesign --force --deep --sign "$APPLE_SIGNING_IDENTITY" \
      --options runtime \
      --entitlements entitlements.plist \
      "EchoSmith.app"
```

##### 2.2 公证 (Notarization)

```yaml
- name: Notarize app
  run: |
    # 提交公证
    xcrun notarytool submit "EchoSmith.dmg" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait
    
    # 装订公证票据
    xcrun stapler staple "EchoSmith.dmg"
```

##### 2.3 Universal Binary (Intel + ARM)

```yaml
# 安装双架构 Rust 目标
- uses: dtolnay/rust-toolchain@stable
  with:
    targets: x86_64-apple-darwin,aarch64-apple-darwin

# 分别构建
- run: npm run build -- --target x86_64-apple-darwin
- run: npm run build -- --target aarch64-apple-darwin

# 合并为 Universal Binary
- run: |
    lipo -create \
      "x86_64/.../EchoSmith" \
      "aarch64/.../EchoSmith" \
      -output "universal/.../EchoSmith"
```

---

### 新文件: `tauri/src-tauri/entitlements.plist`

macOS 权限声明文件，用于：
- `com.apple.security.cs.allow-jit` - 允许 JIT 编译（PyInstaller 需要）
- `com.apple.security.cs.allow-unsigned-executable-memory` - 允许未签名可执行内存
- `com.apple.security.cs.disable-library-validation` - 禁用库验证（Python 运行时需要）
- `com.apple.security.device.audio-input` - 麦克风权限
- `com.apple.security.network.client` - 网络权限

---

### 文件: `tauri/src-tauri/tauri.conf.json`

添加了 macOS 和 Windows 签名配置：

```json
{
  "bundle": {
    "macOS": {
      "entitlements": "entitlements.plist"
    },
    "windows": {
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

---

## 需要配置的 GitHub Secrets

在 GitHub 仓库的 Settings → Secrets 中添加：

| Secret 名称 | 说明 | 获取方式 |
|------------|------|---------|
| `APPLE_SIGNING_IDENTITY` | 证书名称，如 `Developer ID Application: Your Name (TEAMID)` | Keychain Access 中查看 |
| `APPLE_CERTIFICATE` | Base64 编码的 .p12 证书 | `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 .p12 时设置的密码 | 自己设置 |
| `APPLE_ID` | Apple 开发者账号邮箱 | Apple Developer 账户 |
| `APPLE_PASSWORD` | App-Specific Password | appleid.apple.com 生成 |
| `APPLE_TEAM_ID` | 10 位团队 ID | Apple Developer 会员中心 |

### 生成 App-Specific Password

1. 访问 https://appleid.apple.com
2. 登录 → 安全 → App 专用密码
3. 点击"生成密码"
4. 使用生成的密码作为 `APPLE_PASSWORD`

### 导出证书为 Base64

```bash
# 从 Keychain 导出 .p12
security export -k ~/Library/Keychains/login.keychain-db \
  -t identities -f pkcs12 -o cert.p12

# 转换为 Base64
base64 -i cert.p12 | pbcopy  # 复制到剪贴板
```

---

## 构建产物

修复后，CI 会生成以下产物：

| 产物 | 文件 | 说明 |
|-----|------|-----|
| macOS Universal | `EchoSmith_*_universal.dmg` | 同时支持 Intel 和 Apple Silicon |
| macOS x86_64 | `EchoSmith_*_x64.dmg` | 仅 Intel Mac |
| macOS aarch64 | `EchoSmith_*_aarch64.dmg` | 仅 Apple Silicon |
| Windows | `EchoSmith_*.msi` / `.exe` | Windows 安装包 |

---

## 验证修复

### Windows
```powershell
# 手动测试模型下载
python scripts/download_models.py
```

### macOS
```bash
# 验证签名
codesign --verify --verbose EchoSmith.app

# 验证公证
spctl --assess --type execute EchoSmith.app
xcrun stapler validate EchoSmith.dmg
```

---

## 提交信息

```
commit d8eb1f8
Author: CI Bot
Date:   [今天]

fix: Windows build compatibility and macOS code signing/notarization
```

修改了 4 个文件，新增 468 行，删除 78 行。
