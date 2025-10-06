$Root = Resolve-Path "$PSScriptRoot/.."
$Backend = Join-Path $Root "backend"
$Dist = Join-Path $Backend "dist"
$Venv = Join-Path $Root ".venv"

python -m venv $Venv
& "$Venv/Scripts/Activate.ps1"
python -m pip install --upgrade pip
python -m pip install -r (Join-Path $Backend "requirements.txt")

New-Item -ItemType Directory -Path $Dist -Force | Out-Null
Copy-Item $Backend -Destination $Dist -Recurse -Force

Write-Host "Backend build artifacts ready in $Dist"
