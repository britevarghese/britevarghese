@echo off
rem Build NIGHTSHIFT_SERVER_SETUP.exe on Windows.
rem Requirements: NSIS 3 (https://nsis.sourceforge.io) - makensis.exe on PATH or in the default install folder.
rem Usage (from the project root):  tools\build-installer.bat [node-version, e.g. v22.23.3]
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"
set "DIST=%ROOT%\dist"
set "CACHE=%DIST%\cache"
set "STAGE=%DIST%\stage"
set "NODE_VERSION=%~1"
if "%NODE_VERSION%"=="" set "NODE_VERSION=v22.23.3"
set "NODE_ZIP=node-%NODE_VERSION%-win-x64.zip"

set "MAKENSIS=makensis"
where makensis >nul 2>nul || set "MAKENSIS=%ProgramFiles(x86)%\NSIS\makensis.exe"
if not "%MAKENSIS%"=="makensis" if not exist "%MAKENSIS%" (
  echo ERROR: makensis not found. Install NSIS 3 from https://nsis.sourceforge.io
  exit /b 1
)

if not exist "%CACHE%" mkdir "%CACHE%"
if not exist "%CACHE%\%NODE_ZIP%" (
  echo Downloading Node.js %NODE_VERSION% ...
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://nodejs.org/dist/%NODE_VERSION%/%NODE_ZIP%' -OutFile '%CACHE%\%NODE_ZIP%'" || exit /b 1
)
if exist "%CACHE%\node-x" rmdir /s /q "%CACHE%\node-x"
powershell -NoProfile -Command "Expand-Archive -Force '%CACHE%\%NODE_ZIP%' '%CACHE%\node-x'" || exit /b 1

echo Staging files ...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%\runtime"
for %%f in (server.js config.json package.json start.bat start.sh README.md) do if exist "%%f" copy /y "%%f" "%STAGE%\" >nul
for %%d in (server public src docs) do if exist "%%d" robocopy "%%d" "%STAGE%\%%d" /E /XD node_modules .git /XF *.log /NFL /NDL /NJH /NJS >nul
copy /y "%CACHE%\node-x\node-%NODE_VERSION%-win-x64\node.exe" "%STAGE%\runtime\node.exe" >nul || exit /b 1

echo Building installer ...
"%MAKENSIS%" -V2 -DSTAGE="%STAGE%" -DOUTFILE="%DIST%\NIGHTSHIFT_SERVER_SETUP.exe" -DVERSION=1.0.0 "%ROOT%\installer\nightshift.nsi" || exit /b 1

echo Creating portable zip ...
powershell -NoProfile -Command "Compress-Archive -Force -Path '%STAGE%\*' -DestinationPath '%DIST%\NIGHTSHIFT_SERVER_portable.zip'"

echo.
echo Done: %DIST%\NIGHTSHIFT_SERVER_SETUP.exe
