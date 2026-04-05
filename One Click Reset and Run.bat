@echo off
setlocal EnableExtensions
title One Click Reset and Run

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\launch-dental.ps1" -Mode Reset
if errorlevel 1 (
  echo.
  echo One Click Reset and Run failed. See run-logs for details.
  pause
  exit /b 1
)

echo.
echo One Click Reset and Run completed successfully.
pause
