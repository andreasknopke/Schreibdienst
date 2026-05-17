param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Schreibdienst\Injector')
)

$ErrorActionPreference = 'Stop'

$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.schreibdienst.injector'
if (Test-Path -LiteralPath $registryPath) {
  Remove-Item -LiteralPath $registryPath -Force
  Write-Host "Registry entfernt: $registryPath"
}

if (Test-Path -LiteralPath $InstallRoot) {
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force
  Write-Host "Installationsordner entfernt: $InstallRoot"
}

Write-Host 'Schreibdienst Injector wurde fuer den aktuellen Benutzer entfernt.' -ForegroundColor Green