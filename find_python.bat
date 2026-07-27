@echo off
setlocal
set "PYTHON_EXE="
set "TOOLKIT_ROOT=%~dp0"
if "%TOOLKIT_ROOT:~-1%"=="\" set "TOOLKIT_ROOT=%TOOLKIT_ROOT:~0,-1%"

REM 1) python_path.txt - try each non-empty, non-# line until one exists
if exist "%TOOLKIT_ROOT%\python_path.txt" (
  for /f "usebackq eol=# tokens=* delims=" %%A in ("%TOOLKIT_ROOT%\python_path.txt") do (
    if not "%%~A"=="" if exist "%%~A" (
      set "PYTHON_EXE=%%~A"
      goto :found
    )
  )
  echo [WARN] python_path.txt has no valid python.exe path
)

REM 2) Python Launcher (skip WindowsApps stub)
where py >nul 2>&1
if not errorlevel 1 (
  for /f "usebackq delims=" %%P in (`py -3 -c "import sys; print(sys.executable)" 2^>nul`) do (
    echo %%P | findstr /I "WindowsApps" >nul
    if errorlevel 1 if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
  )
  if defined PYTHON_EXE if exist "%PYTHON_EXE%" goto :found
  set "PYTHON_EXE="
)

REM 3) PyManager (common on managed company PCs)
if exist "%ProgramFiles%\PyManager\python.exe" (
  set "PYTHON_EXE=%ProgramFiles%\PyManager\python.exe"
  goto :found
)

REM 4) Standard install folders
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
  if exist "%%D\python.exe" (
    set "PYTHON_EXE=%%D\python.exe"
    goto :found
  )
)
for /d %%D in ("%ProgramFiles%\Python3*") do (
  if exist "%%D\python.exe" (
    set "PYTHON_EXE=%%D\python.exe"
    goto :found
  )
)

REM 5) PATH - skip WindowsApps store stub
where python >nul 2>&1
if not errorlevel 1 (
  for /f "usebackq delims=" %%P in (`where python 2^>nul`) do (
    echo %%P | findstr /I "WindowsApps" >nul
    if errorlevel 1 if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
  )
  if defined PYTHON_EXE if exist "%PYTHON_EXE%" goto :found
  set "PYTHON_EXE="
)

echo [ERROR] Could not find Python on this PC.
echo.
echo Try:
echo   1. Install Python 3.10+ or use py -3 --version
echo   2. Edit python_path.txt - ONE line only, e.g.:
echo      C:\Program Files\PyManager\python.exe
echo   3. Run scripts\doctor.bat and send doctor_report.txt
endlocal
exit /b 1

:found
echo [OK] Using Python: %PYTHON_EXE%
endlocal & set "PYTHON_EXE=%PYTHON_EXE%"
exit /b 0
