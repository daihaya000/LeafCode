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

rem The production build runs in a hard-link mirror of this installation,
rem outside the (OneDrive-synced) repo: the sync client must never touch a
rem build that is being written or served, and Turbopack refuses a distDir
rem that leaves the project. Override the location with
rem LEAFCODE_BUILD_DIR. scripts\web-build-mirror.mjs is the single
rem source of truth, shared with host\src\index.js.
for /f "usebackq delims=" %%D in (`node scripts\web-build-mirror.mjs --dist-dir`) do set "NEXT_DIST_DIR=%%D"
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

rem Syncs the hard-link mirror outside the synced tree and builds there.
rem The guard already ran above, so it is not repeated.
echo [OpenCode WebUI] Running next build...
call node scripts\build-web.mjs --skip-guard
if errorlevel 1 (
  echo [OpenCode WebUI] web build failed
  pause
  exit /b 1
)

if not exist "%NEXT_DIST_DIR%\BUILD_ID" (
  echo [OpenCode WebUI] Build finished but BUILD_ID is missing
  pause
  exit /b 1
)

echo [OpenCode WebUI] Build OK ^(BUILD_ID exists^)
echo [OpenCode WebUI] Start the WebUI from the tray or OpenCodeWebUI.exe to serve the new build.

endlocal
exit /b 0
