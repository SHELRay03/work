@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "VPY=%~dp0.venv\Scripts\python.exe"
if not exist "%VPY%" (
  echo [ERROR] Run setup.bat first.
  pause
  exit /b 1
)

echo ========================================
echo  Subtitle Toolkit - local server
echo  Keep this window OPEN
echo  Open: http://127.0.0.1:8000
echo ========================================
echo.

"%VPY%" run.py
if errorlevel 1 (
  echo [ERROR] Server stopped. Run scripts\doctor.bat
  pause
  exit /b 1
)
pause
