param(
    [string]$RemoteHost = "192.168.188.173",
    [string]$RemoteUser = "ksai0001_local",
    [string]$RemoteDir = "~/voxtral-training",
    [string]$DataDir = "../data"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dataAbsolute = Resolve-Path (Join-Path $repoRoot $DataDir)

$sshTarget = "${RemoteUser}@${RemoteHost}"
$targetDisplay = "${sshTarget}:${RemoteDir}"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Trainingsdaten auf DGX Spark deployen" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Quelle:     $dataAbsolute"
Write-Host "Ziel:       $targetDisplay"
Write-Host ""

if (-not (Test-Path $dataAbsolute)) {
    Write-Host "FEHLER: Datenverzeichnis nicht gefunden: $dataAbsolute" -ForegroundColor Red
    Write-Host "Führe zuerst export_training_data.py aus!" -ForegroundColor Yellow
    exit 1
}

# Prüfe SSH
Write-Host "[1/4] Prüfe SSH-Verbindung..." -ForegroundColor Yellow
$sshTest = ssh -q -o BatchMode=yes -o ConnectTimeout=5 $sshTarget "echo OK" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FEHLER: Keine SSH-Verbindung zu $sshTarget" -ForegroundColor Red
    Write-Host "Bitte SSH-Key einrichten oder Host/IP prüfen." -ForegroundColor Yellow
    exit 1
}
Write-Host "      OK" -ForegroundColor Green

# Zielverzeichnis
Write-Host "[2/4] Erstelle Zielverzeichnisse..." -ForegroundColor Yellow
ssh $sshTarget "mkdir -p ${RemoteDir}/audio ${RemoteDir}/dataset ${RemoteDir}/models"
Write-Host "      OK" -ForegroundColor Green

# Daten kopieren
Write-Host "[3/4] Kopiere Trainingsdaten..." -ForegroundColor Yellow
$rsyncAvailable = Get-Command rsync -ErrorAction SilentlyContinue
if ($rsyncAvailable) {
    Write-Host "      Nutze rsync..." -ForegroundColor Gray
    & rsync -avzP --progress "${dataAbsolute}/audio/" "${sshTarget}:${RemoteDir}/audio/"
    & rsync -avzP --progress "${dataAbsolute}/dataset/" "${sshTarget}:${RemoteDir}/dataset/"
    & rsync -avzP --progress "${dataAbsolute}/manifest.json" "${sshTarget}:${RemoteDir}/"
} else {
    Write-Host "      Nutze scp..." -ForegroundColor Gray
    scp -r "${dataAbsolute}/audio/" "${targetDisplay}/audio/"
    scp -r "${dataAbsolute}/dataset/" "${targetDisplay}/dataset/"
    scp "${dataAbsolute}/manifest.json" "${targetDisplay}/"
}
Write-Host "      OK" -ForegroundColor Green

# DGX-Skripte kopieren
Write-Host "[4/4] Kopiere Trainings-Skripte (dgx/)..." -ForegroundColor Yellow
$dgxDir = Join-Path $PSScriptRoot "dgx"
if (Test-Path $dgxDir) {
    scp -r "${dgxDir}/" "${targetDisplay}/scripts/"
    Write-Host "      dgx/ → ${targetDisplay}/scripts/" -ForegroundColor Gray
} else {
    Write-Host "      WARN: dgx/ nicht gefunden" -ForegroundColor Yellow
}
Write-Host "      OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== Deploy abgeschlossen ===" -ForegroundColor Green
Write-Host ""
Write-Host "Auf dem DGX Spark:" -ForegroundColor Cyan
Write-Host "  cd ${RemoteDir}"
Write-Host "  chmod +x scripts/start_training.sh"
Write-Host "  ./scripts/start_training.sh"
