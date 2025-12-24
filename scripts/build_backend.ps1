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
$SherpaModelSrc = Join-Path $env:USERPROFILE ".cache\sherpa-onnx\sense-voice"

if (Test-Path $SherpaModelSrc) {
    Write-Host "Found sherpa-onnx models at: $SherpaModelSrc"
    if (Test-Path $ModelsCache) {
        Remove-Item -Recurse -Force $ModelsCache
    }
    New-Item -ItemType Directory -Path $ModelsCache -Force | Out-Null

    # Only copy essential files (INT8 model + tokens)
    Copy-Item (Join-Path $SherpaModelSrc "model.int8.onnx") $ModelsCache
    Copy-Item (Join-Path $SherpaModelSrc "tokens.txt") $ModelsCache
    Write-Host "Copied INT8 model to: $ModelsCache"
    Get-ChildItem $ModelsCache
} else {
    Write-Host "WARNING: No sherpa-onnx models found at $SherpaModelSrc"
    Write-Host "Please run: python scripts/download_models.py first"
}

# Build standalone backend executable with PyInstaller
Set-Location $Backend

# Build arguments
$AddDataArgs = @()
$ModelsCacheParent = Join-Path $Root "models_cache"
if (Test-Path $ModelsCache) {
    $AddDataArgs = @("--add-data", "$ModelsCacheParent;models_cache")
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
    "--collect-all", "sherpa_onnx"
) + $AddDataArgs + @("__main__.py")

& pyinstaller @PyInstallerArgs

# Cleanup temporary venv
deactivate
Remove-Item -Recurse -Force $TempVenv

Write-Host ""
Write-Host "=== Backend build complete ==="
Write-Host "Output: $BuildOutput\backend\"
