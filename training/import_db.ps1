# ============================================================
# import_db.ps1
# Startet einen temporären MariaDB-Docker-Container und
# importiert den SQL-Dump aus database/ hinein.
#
# Usage:
#   .\training\import_db.ps1                      # interaktiv
#   .\training\import_db.ps1 -DumpPath ..\database\schreibdienst-db-2026-07-11.sql
#   .\training\import_db.ps1 -CleanUp             # Container + Volume löschen
# ============================================================

param(
    [string]$DumpPath = "..\database\schreibdienst-db-2026-07-11.sql",
    [switch]$CleanUp,
    [string]$ContainerName = "schreibdienst-mariadb",
    [int]$Port = 3307,
    [string]$Password = "schreibdienst",
    [string]$Database = "schreibdienst"
)

$ErrorActionPreference = "Stop"

# ── Clean-Up ──
if ($CleanUp) {
    Write-Host "Räume Container $ContainerName auf..." -ForegroundColor Yellow
    docker stop $ContainerName 2>$null
    docker rm $ContainerName 2>$null
    docker volume rm "${ContainerName}-data" 2>$null
    Write-Host "OK" -ForegroundColor Green
    return
}

# ── Prüfe Docker ──
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "FEHLER: Docker nicht gefunden. Bitte installieren: https://www.docker.com/" -ForegroundColor Red
    exit 1
}

# ── Prüfe Dump-Datei ──
$ScriptRoot = Split-Path -Parent $PSScriptRoot
$DumpAbsolute = Resolve-Path (Join-Path $ScriptRoot $DumpPath) -ErrorAction Stop
if (-not (Test-Path $DumpAbsolute)) {
    Write-Host "FEHLER: Dump-Datei nicht gefunden: $DumpAbsolute" -ForegroundColor Red
    exit 1
}
$DumpDir = Split-Path -Parent $DumpAbsolute
$DumpFile = Split-Path -Leaf $DumpAbsolute

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  MariaDB Docker – Import SQL-Dump" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Dump:    $DumpAbsolute"
Write-Host "Port:    $Port"
Write-Host "DB:      $Database"
Write-Host "Pass:    $Password"
Write-Host ""

# ── Container laufen bereits? ──
$existing = docker ps --filter "name=$ContainerName" --format "{{.Names}}" 2>$null
if ($existing) {
    Write-Host "Container '$ContainerName' läuft bereits." -ForegroundColor Yellow
    Write-Host "Zum Neustart: .\import_db.ps1 -CleanUp; .\import_db.ps1" -ForegroundColor Gray
    exit 0
}

# ── MariaDB starten ──
Write-Host "[1/3] Starte MariaDB-Container..." -ForegroundColor Yellow
docker run -d `
    --name $ContainerName `
    -e MYSQL_ROOT_PASSWORD=$Password `
    -e MYSQL_DATABASE=$Database `
    -p "${Port}:3306" `
    -v "${ContainerName}-data:/var/lib/mysql" `
    mariadb:10.11 `
    --character-set-server=utf8mb4 `
    --collation-server=utf8mb4_unicode_ci

if ($LASTEXITCODE -ne 0) {
    Write-Host "FEHLER: Container-Start fehlgeschlagen" -ForegroundColor Red
    exit 1
}

Write-Host "      Warte auf MariaDB (30s)..." -ForegroundColor Gray
Start-Sleep -Seconds 30

# ── Dump importieren ──
Write-Host "[2/3] Importiere SQL-Dump (große Datei – dauert einige Minuten)..." -ForegroundColor Yellow

$DumpSizeBytes = (Get-Item $DumpAbsolute).Length
$DumpSizeGB = $DumpSizeBytes / 1GB
Write-Host "      Dateigröße: $([math]::Round($DumpSizeGB, 2)) GB" -ForegroundColor Gray

# pv (pipe view) für Fortschritt – wenn verfügbar
$pv = Get-Command pv -ErrorAction SilentlyContinue

if ($pv) {
    # Mit Fortschrittsanzeige via pv
    $importCmd = "pv ""$DumpAbsolute"" | docker exec -i $ContainerName mysql -u root -p$Password $Database"
    Write-Host "      $importCmd" -ForegroundColor Gray
    cmd /c $importCmd
} else {
    # Einfacher Import
    Write-Host "      (Installiere 'pv' für Fortschrittsanzeige: 'winget install pv' oder 'choco install pv')" -ForegroundColor Gray
    Get-Content $DumpAbsolute | docker exec -i $ContainerName mysql -u root -p$Password $Database
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "WARN: Import möglicherweise unvollständig (Exit: $LASTEXITCODE)" -ForegroundColor Yellow
} else {
    Write-Host "      Import erfolgreich!" -ForegroundColor Green
}

# ── Verifikation ──
Write-Host "[3/3] Verifiziere Import..." -ForegroundColor Yellow
$tableCount = docker exec $ContainerName mysql -u root -p$Password $Database -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$Database'" 2>$null
Write-Host "      Tabellen: $tableCount" -ForegroundColor Gray

# Diktat-Anzahl
$dictCount = docker exec $ContainerName mysql -u root -p$Password $Database -N -e "SELECT COUNT(*) FROM offline_dictations WHERE archived = TRUE" 2>$null
$manualCount = docker exec $ContainerName mysql -u root -p$Password $Database -N -e "SELECT COUNT(*) FROM correction_log cl JOIN offline_dictations d ON d.id = cl.dictation_id WHERE d.archived = TRUE AND cl.correction_type = 'manual'" 2>$null
$audioCount = docker exec $ContainerName mysql -u root -p$Password $Database -N -e "SELECT COUNT(DISTINCT a.dictation_id) FROM dictation_audio a JOIN offline_dictations d ON d.id = a.dictation_id WHERE d.archived = TRUE" 2>$null

Write-Host "      Archivierte Diktate:     $dictCount" -ForegroundColor Gray
Write-Host "      Davon mit man. Korrektur: $manualCount" -ForegroundColor Gray
Write-Host "      Mit Audio:               $audioCount" -ForegroundColor Gray

Write-Host ""
Write-Host "=== Fertig ===" -ForegroundColor Green
Write-Host ""
Write-Host "Verbinden:   mysql -u root -p$Password -h 127.0.0.1 -P $Port $Database"
Write-Host "Export:      cd training; ..\.venv-export\Scripts\Activate.ps1; python export_training_data.py"
Write-Host "Cleanup:     .\import_db.ps1 -CleanUp"
