<#
.SYNOPSIS
    Schreibdienst Injector Uninstall – Headless (PowerShell)
#>
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "FEHLER: Administrator-Rechte erforderlich."
    exit 1
}
taskkill /f /im schreibdienst-injector.exe 2>$null | Out-Null
Remove-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SchreibdienstInjector" -ErrorAction SilentlyContinue
netsh advfirewall firewall delete rule name="Schreibdienst Injector" 2>$null | Out-Null
$dir = "${env:ProgramFiles}\Schreibdienst Injector"
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
Write-Host "Deinstallation abgeschlossen."
