@echo off
setlocal
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Cortisol.x\node\node.exe" set "PATH=%LOCALAPPDATA%\Cortisol.x\node;%PATH%"
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install Node.js LTS from the official site, then run this file again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
rem Browser mode does not download or launch the Electron executable.
set "ELECTRON_SKIP_BINARY_DOWNLOAD=1"
if not exist "node_modules\.bin\next.cmd" (
  call npm ci
  if errorlevel 1 goto fail
)
call npm run build
if errorlevel 1 goto fail
call npm run browser
if errorlevel 1 goto fail
exit /b 0
:fail
echo Cortisol.x could not start. The error is shown above.
echo If Windows blocked a file, leave Smart App Control enabled.
pause
exit /b 1
