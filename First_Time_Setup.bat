@echo off
setlocal
cd /d "%~dp0"
set "CORTISOL_INSTALL_DIR=%~dp0"
if exist "%LOCALAPPDATA%\Cortisol.x\node\node.exe" set "PATH=%LOCALAPPDATA%\Cortisol.x\node;%PATH%"
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Install-Node.ps1"
  if errorlevel 1 goto fail
  set "PATH=%LOCALAPPDATA%\Cortisol.x\node;%PATH%"
)
call npm install
if errorlevel 1 goto fail
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Create-Shortcut.ps1"
if errorlevel 1 goto fail
call "%~dp0Launch_Cortisol.bat"
exit /b %errorlevel%
:fail
echo Setup failed. Review the error above and run First_Time_Setup.bat again.
pause
exit /b 1
