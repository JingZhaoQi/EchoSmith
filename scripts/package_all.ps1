$Root = Resolve-Path "$PSScriptRoot/.."

Write-Host "[1/3] Building backend distribution"
& (Join-Path $Root "scripts/build_backend.ps1")

Write-Host "[2/3] Building frontend assets"
Push-Location (Join-Path $Root "frontend")
npm install
npm run build
Pop-Location

Write-Host "[3/3] Building Tauri bundle"
Push-Location (Join-Path $Root "tauri")
npm install
npm run tauri build
Pop-Location
