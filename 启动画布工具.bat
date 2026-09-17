@echo off
chcp 65001 >nul
setlocal
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" (
  echo [ERROR] PowerShell 7 was not found.
  echo [ERROR] Expected at: C:\Program Files\PowerShell\7\pwsh.exe
  echo [ERROR] To install it, run:
  echo [ERROR]     winget install --id Microsoft.PowerShell
  pause
  exit /b 1
)
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
endlocal & exit /b %EXIT_CODE%
