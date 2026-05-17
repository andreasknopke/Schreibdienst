param(
  [string]$ExtensionId,
  [switch]$Build,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Schreibdienst\Injector'),
  [string]$HostExePath,
  [string]$ExtensionSource = (Join-Path $PSScriptRoot '..\extension')
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string]$Path) {
  $executionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Find-CMake {
  $command = Get-Command cmake -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $vsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vsWhere) {
    $vsPath = & $vsWhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
    if ($vsPath) {
      $candidate = Join-Path $vsPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }

  throw 'CMake wurde nicht gefunden. Bitte aus der Developer PowerShell for Visual Studio starten oder Visual-Studio-CMake installieren.'
}

function Build-NativeHost {
  $cmake = Find-CMake
  $nativeHostDir = Resolve-FullPath (Join-Path $PSScriptRoot '..\native-host')
  & $cmake -S $nativeHostDir -B (Join-Path $nativeHostDir 'build') -A x64
  if ($LASTEXITCODE -ne 0) { throw 'CMake-Konfiguration fehlgeschlagen.' }

  & $cmake --build (Join-Path $nativeHostDir 'build') --config Release
  if ($LASTEXITCODE -ne 0) { throw 'C++ Native Host Build fehlgeschlagen.' }
}

function Find-HostExe {
  param([string]$ExplicitPath)

  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    $candidates += $ExplicitPath
  }

  $candidates += @(
    (Join-Path $PSScriptRoot 'schreibdienst-injector.exe'),
    (Join-Path $PSScriptRoot 'host\schreibdienst-injector.exe'),
    (Join-Path $PSScriptRoot '..\host\schreibdienst-injector.exe'),
    (Join-Path $PSScriptRoot '..\native-host\build\Release\schreibdienst-injector.exe')
  )

  foreach ($candidate in $candidates) {
    $fullPath = Resolve-FullPath $candidate
    if (Test-Path -LiteralPath $fullPath) {
      return $fullPath
    }
  }

  throw "Native Host EXE nicht gefunden. Fuer Client-Rollout muss schreibdienst-injector.exe im Paket liegen. Auf Entwicklerrechnern optional mit -Build erstellen."
}

if ($Build) {
  Build-NativeHost
}

$hostSourcePath = Find-HostExe $HostExePath
$extensionSourcePath = Resolve-FullPath $ExtensionSource

if (-not (Test-Path -LiteralPath (Join-Path $extensionSourcePath 'manifest.json'))) {
  throw "Chrome-Extension-Manifest nicht gefunden: $extensionSourcePath"
}

$installRootPath = Resolve-FullPath $InstallRoot
$hostInstallDir = Join-Path $installRootPath 'host'
$extensionInstallDir = Join-Path $installRootPath 'extension'
$manifestDir = Join-Path $installRootPath 'NativeMessagingHosts'
$hostInstallPath = Join-Path $hostInstallDir 'schreibdienst-injector.exe'
$manifestPath = Join-Path $manifestDir 'com.schreibdienst.injector.json'

New-Item -ItemType Directory -Force -Path $hostInstallDir, $extensionInstallDir, $manifestDir | Out-Null
Copy-Item -LiteralPath $hostSourcePath -Destination $hostInstallPath -Force
Remove-Item -LiteralPath (Join-Path $extensionInstallDir '*') -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $extensionSourcePath '*') -Destination $extensionInstallDir -Recurse -Force

Write-Host 'Schreibdienst Injector wurde kopiert:'
Write-Host "  Host:      $hostInstallPath"
Write-Host "  Extension: $extensionInstallDir"

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
  Write-Host ''
  Write-Host 'Noch nicht registriert: Es fehlt die Chrome-Extension-ID.' -ForegroundColor Yellow
  Write-Host 'Naechster Schritt:'
  Write-Host '  1. Chrome oeffnen: chrome://extensions'
  Write-Host '  2. Entwicklermodus aktivieren'
  Write-Host "  3. 'Entpackte Erweiterung laden' -> $extensionInstallDir"
  Write-Host '  4. Extension-ID kopieren'
  Write-Host "  5. Dieses Script erneut starten mit: -ExtensionId <ID>"
  exit 0
}

$manifest = @{
  name = 'com.schreibdienst.injector'
  description = 'Schreibdienst Windows text injector'
  path = $hostInstallPath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.schreibdienst.injector'
New-Item -Force -Path $registryPath | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host ''
Write-Host 'Schreibdienst Injector wurde fuer Chrome registriert.' -ForegroundColor Green
Write-Host "  Extension-ID: $ExtensionId"
Write-Host "  Manifest:     $manifestPath"
Write-Host "  Registry:     $registryPath"
