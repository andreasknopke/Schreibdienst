@echo off
setlocal enabledelayedexpansion
:: ─────────────────────────────────────────────────────────
:: Schreibdienst Injector – Headless CLI Installer
:: Fuer Kliniknetzwerke, GPO-Deployment und unbeaufsichtigte
:: Installationen ohne GUI-Installer.
::
:: Verwendung:
::   install.bat                    Interaktive Installation
::   install.bat /S                 Stille Installation
::   install.bat /U                 Deinstallation
::   install.bat /D=C:\Pfad         Zielverzeichnis (Default: %ProgramFiles%\Schreibdienst Injector)
:: ─────────────────────────────────────────────────────────

set "INJECTOR_EXE=%~dp0schreibdienst-injector.exe"
set "INSTALL_DIR=%ProgramFiles%\Schreibdienst Injector"
set "REG_KEY=HKLM\Software\Microsoft\Windows\CurrentVersion\Run"
set "REG_VALUE=SchreibdienstInjector"
set "AUTOSTART=1"
set "SILENT=0"
set "MODE=install"

:parse_args
if "%~1"=="" goto :start
if /i "%~1"=="/S" (
    set "SILENT=1"
    shift
    goto :parse_args
)
if /i "%~1"=="/U" (
    set "MODE=uninstall"
    shift
    goto :parse_args
)
if /i "%~1"=="/Q" (
    set "SILENT=1"
    shift
    goto :parse_args
)
if /i "%~1"=="/D" (
    set "INSTALL_DIR=%~2"
    shift
    shift
    goto :parse_args
)
if /i "%~1"=="/NOAUTOSTART" (
    set "AUTOSTART=0"
    shift
    goto :parse_args
)
echo Unbekannte Option: %~1
echo Verwendung: %~nx0 [/S] [/U] [/D=Zielpfad] [/NOAUTOSTART]
exit /b 1

:start
:: ── Admin-Rechte prüfen ──────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    if "%SILENT%"=="1" (
        echo FEHLER: Administrator-Rechte erforderlich. Bitte als Administrator ausfuehren.
        exit /b 1
    )
    echo Administrator-Rechte erforderlich – starte neu als Admin ...
    powershell -Command "Start-Process '%~f0' -Verb RunAs -ArgumentList '%*'"
    exit /b %errorlevel%
)

if /i "%MODE%"=="uninstall" goto :uninstall

:: ── Installation ─────────────────────────────────────────
if not "%SILENT%"=="1" (
    echo ============================================
    echo  Schreibdienst Injector – Installation
    echo ============================================
    echo.
    echo Zielverzeichnis : %INSTALL_DIR%
    echo Autostart        : %AUTOSTART%
    echo.
)

:: Prüfen ob die Injector-EXE vorhanden ist
if not exist "%INJECTOR_EXE%" (
    echo FEHLER: %INJECTOR_EXE% nicht gefunden.
    echo Bitte legen Sie diese Datei neben die install.bat.
    exit /b 1
)

:: Vorherige Instanz beenden
taskkill /f /im schreibdienst-injector.exe >nul 2>&1

:: Zielverzeichnis erstellen
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%" >nul 2>&1
    if errorlevel 1 (
        echo FEHLER: Konnte %INSTALL_DIR% nicht erstellen.
        exit /b 1
    )
)

:: EXE kopieren
copy /y "%INJECTOR_EXE%" "%INSTALL_DIR%\schreibdienst-injector.exe" >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Konnte die EXE nicht nach %INSTALL_DIR% kopieren.
    exit /b 1
)

:: Autostart registrieren
if "%AUTOSTART%"=="1" (
    reg add "%REG_KEY%" /v "%REG_VALUE%" /t REG_SZ /d "\"%INSTALL_DIR%\schreibdienst-injector.exe\"" /f >nul 2>&1
    if errorlevel 1 (
        echo WARNUNG: Autostart-Registrierung konnte nicht gesetzt werden.
    )
)

:: Firewall-Regel hinzufuegen (Port 58765)
netsh advfirewall firewall add rule name="Schreibdienst Injector" dir=in action=allow program="%INSTALL_DIR%\schreibdienst-injector.exe" enable=yes >nul 2>&1

:: Anwendung starten
start "" "%INSTALL_DIR%\schreibdienst-injector.exe"

if not "%SILENT%"=="1" (
    echo.
    echo Installation erfolgreich abgeschlossen.
    echo Der Injector laeuft jetzt im Hintergrund (Tray-Icon).
)
exit /b 0

:uninstall
:: ── Deinstallation ───────────────────────────────────────
if not "%SILENT%"=="1" (
    echo ============================================
    echo  Schreibdienst Injector – Deinstallation
    echo ============================================
)

:: Prozess beenden
taskkill /f /im schreibdienst-injector.exe >nul 2>&1

:: Autostart entfernen
reg delete "%REG_KEY%" /v "%REG_VALUE%" /f >nul 2>&1

:: Firewall-Regel entfernen
netsh advfirewall firewall delete rule name="Schreibdienst Injector" >nul 2>&1

:: Dateien entfernen
if exist "%INSTALL_DIR%\schreibdienst-injector.exe" (
    del /f /q "%INSTALL_DIR%\schreibdienst-injector.exe" >nul 2>&1
)
if exist "%INSTALL_DIR%" (
    rd /q "%INSTALL_DIR%" >nul 2>&1
)

if not "%SILENT%"=="1" (
    echo Deinstallation abgeschlossen.
)
exit /b 0
