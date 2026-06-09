@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ─── Schreibdienst Injector – Build-All-Script ──────────────────
:: Baut den Injektor (MSVC), den Inno-GUI-Installer und den CLI-Installer.
:: Voraussetzung: Visual Studio 2022, CMake, Inno Setup 6+ (ISCC.exe)
::
:: Nutzung: build-injector.cmd

:: ─── Version from package.json ─────────────────────────────────
for /f "tokens=2 delims=:," %%V in ('type "%~dp0..\package.json" ^| findstr /C:"\"version\""') do (
  set VERSION=%%V
  goto :gotver
)
:gotver
set VERSION=%VERSION:"=%
set VERSION=%VERSION: =%
echo === Schreibdienst Injector Build v%VERSION% ===

:: ─── MSVC-Umgebung ─────────────────────────────────────────────
set VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community
if not exist "%VS_PATH%" set VS_PATH=C:\Program Files\Microsoft Visual Studio\18\Community
if not exist "%VS_PATH%" (
  echo Fehler: Visual Studio nicht gefunden
  exit /b 1
)

call "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo vcvars64 fehlgeschlagen
  exit /b 1
)

set "PATH=%VS_PATH%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;%PATH%"

:: ─── 1. Injektor bauen ─────────────────────────────────────────
pushd "%~dp0\.."
echo.
echo [1/3] Kompiliere Injektor ...
cmake -S native-host -B native-host\build -A x64
if errorlevel 1 popd & exit /b 1

cmake --build native-host\build --config Release
if errorlevel 1 popd & exit /b 1

echo [OK] Injektor gebaut: native-host\build\Release\schreibdienst-injector.exe

:: ─── 2. Inno Setup GUI-Installer ───────────────────────────────
echo.
echo [2/3] Baue GUI-Installer (Inno Setup) ...
set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist %ISCC% (
  echo Inno Setup nicht gefunden unter %ISCC%. Installationsprogramm wird uebersprungen.
  echo Du kannst ISCC.exe manuell ausfuehren: ISCC.exe native-host\installer\schreibdienst-injector-setup.iss
) else (
  pushd "%~dp0..\native-host\installer"
  %ISCC% schreibdienst-injector-setup.iss 2>&1
  if errorlevel 1 (
    echo [FEHLER] Inno Setup fehlgeschlagen.
  ) else (
    echo [OK] GUI-Installer erstellt: native-host\installer\schreibdienst-injector-setup-%VERSION%.exe
  )
  popd
)

:: ─── 3. CLI-Installer (ZIP + Deploy-Skripte) ───────────────────
echo.
echo [3/3] Baue CLI-Installer (ZIP) ...
set CLI_DIR=native-host\installer\cli-deploy
if exist "!CLI_DIR!" rmdir /s /q "!CLI_DIR!"
mkdir "!CLI_DIR!"

:: Injektor kopieren
copy native-host\build\Release\schreibdienst-injector.exe "!CLI_DIR!\"

:: Install-Skripte kopieren
copy native-host\installer\install-cli.bat "!CLI_DIR!\"
copy native-host\installer\install-cli.ps1 "!CLI_DIR!\"
copy native-host\installer\uninstall-cli.bat "!CLI_DIR!\"
copy native-host\installer\uninstall-cli.ps1 "!CLI_DIR!\"

:: README kopieren
copy native-host\installer\CLI_DEPLOY_README.md "!CLI_DIR!\"

:: ZIP packen (mit PowerShell)
echo Packe ZIP ...
powershell -Command "Compress-Archive -Path '!CLI_DIR!\*' -DestinationPath 'native-host\installer\schreibdienst-injector-cli-%VERSION%.zip' -Force"
if errorlevel 1 (
  echo [FEHLER] ZIP-Erstellung fehlgeschlagen.
) else (
  echo [OK] CLI-Installer: native-host\installer\schreibdienst-injector-cli-%VERSION%.zip
)

popd

echo.
echo === Fertig! ===
echo   Injektor:   native-host\build\Release\schreibdienst-injector.exe
echo   GUI-Inst:   native-host\installer\schreibdienst-injector-setup-%VERSION%.exe  (falls ISCC vorhanden)
echo   CLI-Inst:   native-host\installer\schreibdienst-injector-cli-%VERSION%.zip
echo.
