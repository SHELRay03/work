@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
set "ROOT=%CD%"
set "REPORT=%ROOT%\doctor_report.txt"

echo Writing %REPORT% ...

> "%REPORT%" echo ===== Subtitle Toolkit Doctor Report =====
>>"%REPORT%" echo Time: %DATE% %TIME%
>>"%REPORT%" echo Folder: %ROOT%
>>"%REPORT%" echo.

>>"%REPORT%" echo --- .venv ---
if exist "%ROOT%\.venv\Scripts\python.exe" (
  >>"%REPORT%" echo [OK] .venv exists
  >>"%REPORT%" "%ROOT%\.venv\Scripts\python.exe" --version
) else (
  >>"%REPORT%" echo [FAIL] .venv missing - run setup.bat
)
>>"%REPORT%" echo.

>>"%REPORT%" echo --- find_python.bat ---
call "%ROOT%\find_python.bat" >>"%REPORT%" 2>&1
>>"%REPORT%" echo find_python exit: %ERRORLEVEL%
if defined PYTHON_EXE >>"%REPORT%" echo PYTHON_EXE=%PYTHON_EXE%
>>"%REPORT%" echo.

>>"%REPORT%" echo --- py launcher ---
where py >>"%REPORT%" 2>&1
py -3 --version >>"%REPORT%" 2>&1
>>"%REPORT%" echo.

>>"%REPORT%" echo --- where python ---
where python >>"%REPORT%" 2>&1
python --version >>"%REPORT%" 2>&1
>>"%REPORT%" echo.

>>"%REPORT%" echo --- PyManager ---
if exist "%ProgramFiles%\PyManager\python.exe" (
  >>"%REPORT%" echo Found: %ProgramFiles%\PyManager\python.exe
  >>"%REPORT%" "%ProgramFiles%\PyManager\python.exe" --version
) else (
  >>"%REPORT%" echo Not found: %ProgramFiles%\PyManager\python.exe
)
>>"%REPORT%" echo.

>>"%REPORT%" echo --- python_path.txt ---
if exist "%ROOT%\python_path.txt" (
  type "%ROOT%\python_path.txt" >>"%REPORT%"
) else (
  >>"%REPORT%" echo [not set]
)
>>"%REPORT%" echo.

>>"%REPORT%" echo --- Port 8000 ---
netstat -ano | findstr ":8000" >>"%REPORT%" 2>&1
>>"%REPORT%" echo.

>>"%REPORT%" echo --- import backend ---
if exist "%ROOT%\.venv\Scripts\python.exe" (
  >>"%REPORT%" "%ROOT%\.venv\Scripts\python.exe" -c "from backend.main import app; print('import ok', app.title)"
)
>>"%REPORT%" echo.
>>"%REPORT%" echo ===== End =====

type "%REPORT%"
echo.
echo Saved: %REPORT%
pause
