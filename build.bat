@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM). cmd.exe misparses
rem batch files that contain multi-byte characters, even inside rem comments.
rem See docs\specs\bat-encoding-safety.md
setlocal
cd /d "%~dp0"

echo [OpenCode WebUI] Building production bundle...

rem Do not replace web\.next while the tray host's next start is serving it.
rem A running production WebUI owns web\.next; building on top of it corrupts
rem the live build (ChunkLoadError). The guard refuses to build while the
rem WebUI is running - stop it from the tray first, then re-run build.bat.
node scripts\production-webui-build-guard.mjs
if errorlevel 1 (
  echo [OpenCode WebUI] Build cancelled. Stop the running production WebUI, then try again.
  pause
  exit /b 1
)

rem The production build output lives outside the (OneDrive-synced) repo:
rem by default the "opencode-webui\web-build" directory under AppData roaming.
rem Override with OPENCODE_WEBUI_DIST_DIR. scripts\web-dist-dir.mjs is the
rem single source of truth, shared with host\src\index.js.
for /f "usebackq delims=" %%D in (`node scripts\web-dist-dir.mjs`) do set "NEXT_DIST_DIR=%%D"
if not defined NEXT_DIST_DIR (
  echo [OpenCode WebUI] Could not resolve the build output directory.
  pause
  exit /b 1
)
echo [OpenCode WebUI] Build output: %NEXT_DIST_DIR%

if not exist "web\node_modules\" (
  echo [OpenCode WebUI] Installing web dependencies...
  pushd web
  call npm install
  if errorlevel 1 (
    echo [OpenCode WebUI] npm install failed in web\
    popd
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
  pause
  exit /b 1
)
popd

if not exist "%NEXT_DIST_DIR%\BUILD_ID" (
  echo [OpenCode WebUI] Build finished but BUILD_ID is missing
  pause
  exit /b 1
)

echo [OpenCode WebUI] Build OK ^(BUILD_ID exists^)
echo [OpenCode WebUI] Start the WebUI from the tray or OpenCodeWebUI.exe to serve the new build.

endlocal
exit /b 0
