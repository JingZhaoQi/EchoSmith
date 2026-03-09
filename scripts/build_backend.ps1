# Build EchoSmith Backend for Windows
$ErrorActionPreference = "Stop"

$Root = Resolve-Path "$PSScriptRoot/.."
$Backend = Join-Path $Root "backend"
$BuildOutput = Join-Path $Root "tauri_backend_dist"

Write-Host "=== Building EchoSmith Backend (Windows) ==="
Write-Host "Root: $Root"

# Create temporary virtual environment for build
$TempVenv = Join-Path $env:TEMP "echosmith_build_venv"
if (Test-Path $TempVenv) {
    Remove-Item -Recurse -Force $TempVenv
}

Write-Host "Creating temp venv at: $TempVenv"
python -m venv $TempVenv
& "$TempVenv\Scripts\Activate.ps1"

# Install dependencies
python -m pip install --upgrade pip
python -m pip install -r (Join-Path $Backend "requirements.txt")
python -m pip install pyinstaller

# Clean output directory
if (Test-Path $BuildOutput) {
    Remove-Item -Recurse -Force $BuildOutput
}
New-Item -ItemType Directory -Path $BuildOutput -Force | Out-Null

# Prepare models cache directory (only INT8 model + tokens)
$ModelsCache = Join-Path $Root "models_cache\sherpa-onnx"

# Try multiple possible model locations (download_models.py uses LOCALAPPDATA on Windows)
$PossibleModelPaths = @(
    (Join-Path $env:LOCALAPPDATA "sherpa-onnx\sense-voice"),
    (Join-Path $env:USERPROFILE ".cache\sherpa-onnx\sense-voice"),
    (Join-Path $env:APPDATA "sherpa-onnx\sense-voice")
)

$SherpaModelSrc = $null
foreach ($path in $PossibleModelPaths) {
    if (Test-Path $path) {
        $SherpaModelSrc = $path
        break
    }
}

if ($SherpaModelSrc) {
    Write-Host "Found sherpa-onnx models at: $SherpaModelSrc"
    if (Test-Path $ModelsCache) {
        Remove-Item -Recurse -Force $ModelsCache
    }
    New-Item -ItemType Directory -Path $ModelsCache -Force | Out-Null

    # Only copy essential files (INT8 model + tokens)
    Copy-Item (Join-Path $SherpaModelSrc "model.int8.onnx") $ModelsCache
    Copy-Item (Join-Path $SherpaModelSrc "tokens.txt") $ModelsCache

    # Copy Silero VAD model if available
    # download_models.py saves to parent of sense-voice dir, check all possible locations
    $PossibleVadPaths = @(
        (Join-Path (Split-Path $SherpaModelSrc -Parent) "silero_vad.onnx"),
        (Join-Path $env:LOCALAPPDATA "sherpa-onnx\silero_vad.onnx"),
        (Join-Path $env:USERPROFILE ".cache\sherpa-onnx\silero_vad.onnx"),
        (Join-Path $env:APPDATA "sherpa-onnx\silero_vad.onnx")
    )
    $SileroVad = $null
    foreach ($vp in $PossibleVadPaths) {
        if (Test-Path $vp) {
            $SileroVad = $vp
            break
        }
    }
    if ($SileroVad) {
        Copy-Item $SileroVad $ModelsCache
        Write-Host "Copied Silero VAD model from: $SileroVad"
    } else {
        Write-Host "WARNING: silero_vad.onnx not found in any expected location"
        Write-Host "  Searched: $($PossibleVadPaths -join ', ')"
    }

    Write-Host "Copied models to: $ModelsCache"
    Get-ChildItem $ModelsCache
} else {
    Write-Host "WARNING: No sherpa-onnx models found at $SherpaModelSrc"
    Write-Host "Please run: python scripts/download_models.py first"
}

# Prepare ffmpeg binaries
$FfmpegDir = Join-Path $Root "ffmpeg_bin"
if (Test-Path $FfmpegDir) {
    Remove-Item -Recurse -Force $FfmpegDir
}
New-Item -ItemType Directory -Path $FfmpegDir -Force | Out-Null

Write-Host "=== Bundling ffmpeg ==="

# Helper: resolve Chocolatey shim to the actual binary.
# Choco shims are tiny (~25KB) wrappers that won't work outside the choco environment.
function Resolve-RealBinary {
    param([string]$ShimPath)

    # If the file is larger than 200KB, it's likely the real binary
    $size = (Get-Item $ShimPath).Length
    if ($size -gt 200KB) {
        return $ShimPath
    }

    # Small file -> probably a Chocolatey shim. Find the real binary.
    $name = [System.IO.Path]::GetFileNameWithoutExtension($ShimPath)
    Write-Host "  $ShimPath looks like a shim ($([math]::Round($size/1KB))KB), searching for real binary..."

    # Chocolatey typically installs ffmpeg under lib\ffmpeg\tools\...
    $chocoLib = Join-Path $env:ChocolateyInstall "lib"
    if (Test-Path $chocoLib) {
        $real = Get-ChildItem -Path $chocoLib -Recurse -Filter "$name.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.Length -gt 200KB } |
            Select-Object -First 1
        if ($real) {
            Write-Host "  Resolved to: $($real.FullName) ($([math]::Round($real.Length/1MB))MB)"
            return $real.FullName
        }
    }

    # Fallback: return original (will likely fail at runtime, but download fallback below will catch it)
    Write-Host "  WARNING: Could not resolve shim to real binary"
    return $null
}

# Try to find ffmpeg from PATH
$FfmpegPath = Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
$FfprobePath = Get-Command ffprobe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source

$RealFfmpeg = $null
$RealFfprobe = $null

if ($FfmpegPath -and $FfprobePath) {
    Write-Host "Found ffmpeg at: $FfmpegPath"
    Write-Host "Found ffprobe at: $FfprobePath"
    $RealFfmpeg = Resolve-RealBinary $FfmpegPath
    $RealFfprobe = Resolve-RealBinary $FfprobePath
}

if ($RealFfmpeg -and $RealFfprobe) {
    Copy-Item $RealFfmpeg (Join-Path $FfmpegDir "ffmpeg.exe")
    Copy-Item $RealFfprobe (Join-Path $FfmpegDir "ffprobe.exe")
    Write-Host "Bundled real ffmpeg binaries:"
    Get-ChildItem $FfmpegDir | ForEach-Object { Write-Host "  $($_.Name): $([math]::Round($_.Length/1MB))MB" }
} else {
    Write-Host "ffmpeg not found or shim unresolvable, downloading static build..."
    $FfmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    $ZipPath = Join-Path $FfmpegDir "ffmpeg.zip"

    Invoke-WebRequest -Uri $FfmpegUrl -OutFile $ZipPath
    Expand-Archive -Path $ZipPath -DestinationPath $FfmpegDir -Force

    # Find and move binaries
    $ExtractedDir = Get-ChildItem $FfmpegDir -Directory | Select-Object -First 1
    if ($ExtractedDir) {
        $BinDir = Join-Path $ExtractedDir.FullName "bin"
        Copy-Item (Join-Path $BinDir "ffmpeg.exe") $FfmpegDir
        Copy-Item (Join-Path $BinDir "ffprobe.exe") $FfmpegDir
        Remove-Item $ExtractedDir.FullName -Recurse -Force
    }
    Remove-Item $ZipPath -Force
    Get-ChildItem $FfmpegDir | ForEach-Object { Write-Host "  $($_.Name): $([math]::Round($_.Length/1MB))MB" }
}

# Build standalone backend executable with PyInstaller
Set-Location $Backend

# Build arguments
$AddDataArgs = @()
$ModelsCacheParent = Join-Path $Root "models_cache"
if (Test-Path $ModelsCache) {
    $AddDataArgs += @("--add-data", "$ModelsCacheParent;models_cache")
}

# Add ffmpeg binaries
if ((Test-Path $FfmpegDir) -and (Test-Path (Join-Path $FfmpegDir "ffmpeg.exe"))) {
    $AddDataArgs += @("--add-data", "$FfmpegDir;ffmpeg_bin")
}

$PyInstallerArgs = @(
    "--name", "backend",
    "--onedir",
    "--clean",
    "--distpath", $BuildOutput,
    "--workpath", (Join-Path $BuildOutput "build"),
    "--specpath", $BuildOutput,
    "--paths", $Backend,
    "--hidden-import", "app",
    "--hidden-import", "asr_engine",
    "--hidden-import", "task_store",
    "--hidden-import", "url_downloader",
    "--hidden-import", "certifi",
    "--collect-all", "sherpa_onnx"
) + $AddDataArgs + @("__main__.py")

& pyinstaller @PyInstallerArgs

# Cleanup temporary venv
deactivate
Remove-Item -Recurse -Force $TempVenv

Write-Host ""
Write-Host "=== Backend build complete ==="
Write-Host "Output: $BuildOutput\backend\"
Get-ChildItem (Join-Path $BuildOutput "backend")
