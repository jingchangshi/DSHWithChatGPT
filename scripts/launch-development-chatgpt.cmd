@echo off
setlocal
pwsh.exe -NoProfile -File "%~dp0launch-development-chatgpt.ps1" %*
exit /b %ERRORLEVEL%
