@echo off
setlocal

:: Schreibdienst Injector – Uninstall (Headless)
:: Einfach aufrufbar ueber GPO, SCCM etc.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Administrator-Rechte erforderlich.
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b %errorlevel%
)

echo Deinstalliere Schreibdienst Injector ...
taskkill /f /im schreibdienst-injector.exe >nul 2>&1

set "REG_KEY=HKLM\Software\Microsoft\Windows\CurrentVersion\Run"
set "REG_VALUE=SchreibdienstInjector"
set "INSTALL_DIR=%ProgramFiles%\Schreibdienst Injector"

reg delete "%REG_KEY%" /v "%REG_VALUE%" /f >nul 2>&1
netsh advfirewall firewall delete rule name="Schreibdienst Injector" >nul 2>&1

if exist "%INSTALL_DIR%" rd /s /q "%INSTALL_DIR%" >nul 2>&1

echo Deinstallation abgeschlossen.
exit /b 0
