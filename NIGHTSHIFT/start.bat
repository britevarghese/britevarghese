@echo off
setlocal
title NIGHTSHIFT SERVER
cd /d "%~dp0"

rem ---- Find Node.js: bundled runtime first, then PATH ----
set "NODE_EXE="
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if defined NODE_EXE goto :havenode
where node >nul 2>nul
if errorlevel 1 goto :nonode
set "NODE_EXE=node"

:havenode
echo Using Node.js: %NODE_EXE%
"%NODE_EXE%" --version

if exist "%~dp0server.js" goto :run
echo ERROR: server.js not found next to start.bat. Re-install or re-extract NIGHTSHIFT.
pause
exit /b 1

:run
rem The server has zero npm dependencies - no "npm install" is needed.
"%NODE_EXE%" "%~dp0server.js" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
echo Server stopped (exit code %EXITCODE%).
pause
exit /b %EXITCODE%

:nonode
echo ========================================
echo  NIGHTSHIFT SERVER
echo ========================================
echo  ERROR: Node.js was not found.
echo.
echo  Fix it in ONE of these ways:
echo   1. Install Node.js LTS from https://nodejs.org and run this file again
echo   2. Use NIGHTSHIFT_SERVER_SETUP.exe, which includes Node.js
echo   3. Put a portable node.exe into the "runtime" folder next to this file
echo.
pause
exit /b 1
