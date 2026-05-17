@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-schreibdienst-injector.ps1" %*
endlocal
