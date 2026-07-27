@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  Subtitle Toolkit - setup
echo ========================================
echo.

if exist ".venv" (
  if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Removing incomplete .venv ...
    rmdir /s /q ".venv"
  ) else if exist ".venv\pyvenv.cfg" (
    findstr /I /C:"F:\subtitle-toolkit" ".venv\pyvenv.cfg" >nul 2>&1 && (
      echo [INFO] Recreating venv after drive move ...
      rmdir /s /q ".venv"
    )
  )
)

call "%~dp0find_python.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Creating virtual environment ...
"%PYTHON_EXE%" -m venv .venv
if errorlevel 1 (
  echo [ERROR] Failed to create .venv
  pause
  exit /b 1
)

set "VPY=%~dp0.venv\Scripts\python.exe"
if not exist "%VPY%" (
  echo [ERROR] Missing .venv\Scripts\python.exe
  pause
  exit /b 1
)

echo.
echo Installing packages (needs network) ...
"%VPY%" -m pip install --upgrade pip
if errorlevel 1 (
  echo [ERROR] pip upgrade failed
  pause
  exit /b 1
)
"%VPY%" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [INFO] Retrying pip with Tsinghua mirror ...
  "%VPY%" -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  if errorlevel 1 (
    echo [ERROR] pip install failed - see 公司电脑使用说明.txt section 7
    pause
    exit /b 1
  )
)

echo.
echo Creating samples ...
"%VPY%" scripts\create_samples.py

echo.
echo ========================================
echo  Done. Double-click start.bat
echo  Browser: http://127.0.0.1:8000
echo ========================================
pause
