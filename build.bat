@echo off
setlocal
cd /d "%~dp0"

echo [OpenCode WebUI] Building production bundle...

rem Do not replace web\.next while the tray host's next start is serving it.
node scripts\production-webui-build-guard.mjs
if errorlevel 1 (
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

if not exist "web\.next\BUILD_ID" (
  echo [OpenCode WebUI] Build finished but BUILD_ID is missing
  pause
  exit /b 1
)

echo [OpenCode WebUI] Build OK ^(BUILD_ID exists^)
endlocal
exit /b 0
