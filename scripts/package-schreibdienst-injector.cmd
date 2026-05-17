@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-schreibdienst-injector.ps1" %*
endlocal