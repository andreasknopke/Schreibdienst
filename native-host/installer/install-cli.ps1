<# 
.SYNOPSIS
    Schreibdienst Injector – Headless CLI Installer (PowerShell)
.DESCRIPTION
    Installiert den Schreibdienst Injector ohne GUI fuer Kliniknetze,
    GPO-Deployment und SCCM/Intune.
.PARAMETER Silent
    Keine Ausgaben, nur Exit-Code.
.PARAMETER Uninstall
    Deinstallation durchfuehren.
.PARAMETER InstallPath
    Zielverzeichnis (Default: ${env:ProgramFiles}\Schreibdienst Injector).
.PARAMETER NoAutostart
    Keinen Autostart-Eintrag erstellen.
.EXAMPLE
    .\install.ps1
    Interaktive Installation.
.EXAMPLE
    .\install.ps1 -Silent -InstallPath "C:\Tools\Schreibdienst"
    Stille Installation in benutzerdefiniertes Verzeichnis.
.EXAMPLE
    .\install.ps1 -Uninstall
    Vollstaendige Deinstallation.
#>

param(
    [switch]$Silent,
    [switch]$Uninstall,
    [string]$InstallPath = "${env:ProgramFiles}\Schreibdienst Injector",
    [switch]$NoAutostart
)

$InjectorExe = Join-Path $PSScriptRoot "schreibdienst-injector.exe"
$RegPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
$RegValue = "SchreibdienstInjector"

function Write-Status {
    param([string]$Message, [string]$Level = "INFO")
    if (-not $Silent) {
        $color = @{ INFO = "White"; OK = "Green"; WARN = "Yellow"; ERROR = "Red" }
        Write-Host "[$Level] $Message" -ForegroundColor $color[$Level]
    }
}

# Admin-Rechte
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Status "Administrator-Rechte erforderlich" "ERROR"
    exit 1
}

# Uninstall-Modus
if ($Uninstall) {
    Write-Status "Deinstallation gestartet ..." "INFO"
    
    taskkill /f /im schreibdienst-injector.exe 2>$null | Out-Null
    
    Remove-ItemProperty -Path $RegPath -Name $RegValue -ErrorAction SilentlyContinue
    netsh advfirewall firewall delete rule name="Schreibdienst Injector" 2>$null | Out-Null
    
    if (Test-Path $InstallPath) {
        Remove-Item -Recurse -Force $InstallPath -ErrorAction SilentlyContinue
    }
    
    Write-Status "Deinstallation abgeschlossen" "OK"
    exit 0
}

# Installations-Modus
Write-Status "Installation gestartet ..." "INFO"
Write-Status "Zielverzeichnis: $InstallPath" "INFO"

if (-not (Test-Path $InjectorExe)) {
    Write-Status "$InjectorExe nicht gefunden. EXE muss neben diesem Skript liegen." "ERROR"
    exit 1
}

# Prozess beenden
taskkill /f /im schreibdienst-injector.exe 2>$null | Out-Null

# Verzeichnis erstellen
New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null

# EXE kopieren
Copy-Item -Force $InjectorExe -Destination "$InstallPath\schreibdienst-injector.exe"

# Autostart
if (-not $NoAutostart) {
    $exePath = """$InstallPath\schreibdienst-injector.exe"""
    Set-ItemProperty -Path $RegPath -Name $RegValue -Value $exePath -ErrorAction SilentlyContinue
    Write-Status "Autostart registriert" "OK"
}

# Firewall
netsh advfirewall firewall add rule name="Schreibdienst Injector" dir=in action=allow program="$InstallPath\schreibdienst-injector.exe" enable=yes 2>$null | Out-Null

# Starten
Start-Process "$InstallPath\schreibdienst-injector.exe" -WindowStyle Hidden

Write-Status "Installation erfolgreich abgeschlossen" "OK"
exit 0
