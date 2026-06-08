@echo off
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo vcvars64 fehlgeschlagen
  exit /b 1
)
set "PATH=C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;%PATH%"
pushd "%~dp0\.."
cmake -S native-host -B native-host\build -A x64
if errorlevel 1 (
  popd
  exit /b 1
)
cmake --build native-host\build --config Release
set "RC=%errorlevel%"
popd
exit /b %RC%
