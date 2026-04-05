@echo off
setlocal EnableExtensions
title One Click Run

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\launch-dental.ps1" -Mode Run
if errorlevel 1 (
  echo.
  echo One Click Run failed. See run-logs for details.
  pause
  exit /b 1
)

echo.
echo One Click Run completed successfully.
pause
