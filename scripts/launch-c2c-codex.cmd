@echo off
setlocal
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-c2c-codex.ps1" %*
exit /b %ERRORLEVEL%
