@echo off
setlocal
cd /d "%~dp0"

set "PY="
rem 1) explicit override:  set DSH_PETS_PYTHON=C:\path\to\python.exe
if defined DSH_PETS_PYTHON if exist "%DSH_PETS_PYTHON%" set "PY=%DSH_PETS_PYTHON%"
rem 2) the Python launcher (py -3), 3) python on PATH
if not defined PY where py >nul 2>&1
if not defined PY if not errorlevel 1 set "PY=py -3"
if not defined PY where python >nul 2>&1
if not defined PY if not errorlevel 1 set "PY=python"

if not defined PY (
  echo [ERROR] Python 3 not found.
  echo Install Python 3 and make sure "python" or "py -3" works,
  echo or set DSH_PETS_PYTHON to the full path of python.exe, then retry.
  pause
  exit /b 1
)

rem Port busy? This ends this tool's own old serve.py on that port and reuses
rem it. Foreign programs are never killed: it falls back to the next free port.
rem   --strict-port  fail instead of hopping
rem   --no-restart   never end the old instance
%PY% "%~dp0serve.py" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Server exited. See messages above.
  pause
)
endlocal
