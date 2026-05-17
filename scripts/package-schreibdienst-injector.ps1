param(
  [string]$PackageDir = (Join-Path $PSScriptRoot '..\dist\schreibdienst-injector'),
  [switch]$Zip
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

  throw 'CMake wurde nicht gefunden. Bitte auf dem Paketierungsrechner Visual Studio mit CMake verwenden.'
}

$repoRoot = Resolve-FullPath (Join-Path $PSScriptRoot '..')
$nativeHostDir = Join-Path $repoRoot 'native-host'
$extensionDir = Join-Path $repoRoot 'extension'
$buildDir = Join-Path $nativeHostDir 'build'
$hostExe = Join-Path $buildDir 'Release\schreibdienst-injector.exe'
$packageRoot = Resolve-FullPath $PackageDir

$cmake = Find-CMake
& $cmake -S $nativeHostDir -B $buildDir -A x64
if ($LASTEXITCODE -ne 0) { throw 'CMake-Konfiguration fehlgeschlagen.' }

& $cmake --build $buildDir --config Release
if ($LASTEXITCODE -ne 0) { throw 'C++ Native Host Build fehlgeschlagen.' }

if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot 'host'), (Join-Path $packageRoot 'extension'), (Join-Path $packageRoot 'scripts') | Out-Null
Copy-Item -LiteralPath $hostExe -Destination (Join-Path $packageRoot 'host\schreibdienst-injector.exe') -Force
Copy-Item -Path (Join-Path $extensionDir '*') -Destination (Join-Path $packageRoot 'extension') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-schreibdienst-injector.ps1') -Destination (Join-Path $packageRoot 'scripts') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-schreibdienst-injector.cmd') -Destination (Join-Path $packageRoot 'scripts') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall-schreibdienst-injector.ps1') -Destination (Join-Path $packageRoot 'scripts') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall-schreibdienst-injector.cmd') -Destination (Join-Path $packageRoot 'scripts') -Force

Write-Host "Rollout-Paket erstellt: $packageRoot" -ForegroundColor Green
Write-Host "Client-Installation aus Paket: scripts\install-schreibdienst-injector.cmd"

if ($Zip) {
  $zipPath = "$packageRoot.zip"
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -LiteralPath (Join-Path $packageRoot '*') -DestinationPath $zipPath
  Write-Host "ZIP erstellt: $zipPath" -ForegroundColor Green
}