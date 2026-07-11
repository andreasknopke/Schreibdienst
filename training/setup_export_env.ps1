# ============================================================
# setup_export_env.ps1
# Richtet Python-Venv + Abhängigkeiten für das Export-Skript ein.
#
# Usage:
#   .\training\setup_export_env.ps1
#   .venv-export\Scripts\Activate.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $ProjectRoot ".venv-export"

Write-Host "=== Export-Umgebung einrichten ===" -ForegroundColor Cyan
Write-Host ""

# Prüfe Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "Python nicht gefunden. Bitte installieren: https://www.python.org/" -ForegroundColor Red
    exit 1
}
Write-Host "Python: $($python.Source)"

# Venv anlegen
if (-not (Test-Path $VenvDir)) {
    Write-Host "Lege venv an: $VenvDir" -ForegroundColor Yellow
    & python -m venv $VenvDir
    Write-Host "      OK" -ForegroundColor Green
} else {
    Write-Host "Venv existiert bereits: $VenvDir" -ForegroundColor Yellow
}

# Aktivieren + Pakete installieren
$pip = Join-Path $VenvDir "Scripts\pip.exe"

Write-Host "Installiere Abhängigkeiten..." -ForegroundColor Yellow
& $pip install --upgrade pip

& $pip install `
    pymysql `
    python-dotenv `
    tqdm `
    soundfile `
    librosa `
    numpy `
    datasets `
    huggingface-hub `
    jsonlines

Write-Host ""
Write-Host "=== Fertig ===" -ForegroundColor Green
Write-Host ""
Write-Host "Zum Aktivieren:" -ForegroundColor Cyan
Write-Host "  .venv-export\Scripts\Activate.ps1"
Write-Host ""
Write-Host "Dann starten:" -ForegroundColor Cyan
Write-Host "  cd training"
Write-Host "  python export_training_data.py"
