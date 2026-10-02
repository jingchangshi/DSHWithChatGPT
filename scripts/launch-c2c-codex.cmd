@echo off
setlocal
echo Deprecated entry: use launch-development-chatgpt.cmd.
call "%~dp0launch-development-chatgpt.cmd" %*
exit /b %ERRORLEVEL%
