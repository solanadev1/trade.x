@echo off
setlocal
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Cortisol.x\node\node.exe" set "PATH=%LOCALAPPDATA%\Cortisol.x\node;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 LTS or newer from https://nodejs.org then launch again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto fail
)
call npm run build
if errorlevel 1 goto fail
call npm run desktop
if errorlevel 1 goto fail
exit /b 0
:fail
echo Cortisol.x could not start. Review the error above.
pause
exit /b 1
