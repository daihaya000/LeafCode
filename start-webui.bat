@echo off
setlocal
cd /d "%~dp0"

echo [OpenCode WebUI] Starting...

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

if not exist "web\.next\BUILD_ID" (
  echo [OpenCode WebUI] Building web ^(first run^)...
  pushd web
  call npm run build
  if errorlevel 1 (
    echo [OpenCode WebUI] web build failed
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

set OPENCODE_WEBUI_MODE=prod
rem VPN/スマホ向け: WebUI を全インターフェースで待ち受け (OpenCode は 127.0.0.1 のまま)
rem ローカルのみにする場合: set OPENCODE_WEBUI_HOST=127.0.0.1
if not defined OPENCODE_WEBUI_HOST set OPENCODE_WEBUI_HOST=0.0.0.0
cd host
node src\index.js
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo [OpenCode WebUI] Host exited with code %ERR%
  pause
  exit /b %ERR%
)
rem Keep the window briefly so "already running" style messages are readable.
rem ping is used instead of timeout because timeout errors when stdin is redirected.
%SystemRoot%\System32\ping.exe -n 4 127.0.0.1 >nul
endlocal
