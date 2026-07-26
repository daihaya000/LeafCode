@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM). cmd.exe misparses
rem batch files that contain multi-byte characters, even inside rem comments.
rem See docs\specs\bat-encoding-safety.md
setlocal
cd /d "%~dp0"

echo [OpenCode WebUI] Building production bundle...

rem Do not replace web\.next while the tray host's next start is serving it.
rem --stop asks the tray host to shut its next start down (exit 10 = it was
rem stopped, so restart it after a successful build). Any other non-zero exit
rem means the port could not be made safe and the build must not continue.
set "RESTART_WEBUI="
call node scripts\production-webui-build-guard.mjs --stop
set "GUARD_EXIT=%ERRORLEVEL%"
if "%GUARD_EXIT%"=="10" set "RESTART_WEBUI=1"
if not "%GUARD_EXIT%"=="0" if not "%GUARD_EXIT%"=="10" (
  echo [OpenCode WebUI] Build cancelled. Stop the running production WebUI, then try again.
  pause
  exit /b 1
)

if not exist "web\node_modules\" (
  echo [OpenCode WebUI] Installing web dependencies...
  pushd web
  call npm install
  if errorlevel 1 (
    echo [OpenCode WebUI] npm install failed in web\
    popd
    call :webui_stopped_hint
    pause
    exit /b 1
  )
  popd
)

if not exist "host\node_modules\" (
  echo [OpenCode WebUI] Installing host dependencies...
  pushd host
  call npm install
  if errorlevel 1 (
    echo [OpenCode WebUI] npm install failed in host\
    popd
    call :webui_stopped_hint
    pause
    exit /b 1
  )
  popd
)

echo [OpenCode WebUI] Running next build...
pushd web
call npm run build
if errorlevel 1 (
  echo [OpenCode WebUI] web build failed
  popd
  call :webui_stopped_hint
  pause
  exit /b 1
)
popd

if not exist "web\.next\BUILD_ID" (
  echo [OpenCode WebUI] Build finished but BUILD_ID is missing
  call :webui_stopped_hint
  pause
  exit /b 1
)

echo [OpenCode WebUI] Build OK ^(BUILD_ID exists^)

if "%RESTART_WEBUI%"=="1" (
  echo [OpenCode WebUI] Restarting the WebUI with the new build...
  call node scripts\production-webui-build-guard.mjs --restart
)

endlocal
exit /b 0

:webui_stopped_hint
if "%RESTART_WEBUI%"=="1" echo [OpenCode WebUI] The WebUI was stopped for this build and was NOT restarted. Start it from the tray or start-webui.bat.
exit /b 0
