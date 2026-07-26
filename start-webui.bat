@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM). cmd.exe misparses
rem batch files that contain multi-byte characters, even inside rem comments.
rem See docs\specs\bat-encoding-safety.md
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

rem Production rebuild (missing or stale BUILD_ID vs sources) is handled by
rem host/src/index.js on start and on tray/WebUI restart. Optional first-run
rem build here only when .next is completely absent, so the tray can come up
rem with a usable bundle sooner.
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
) else (
  echo [OpenCode WebUI] Existing build found; host will rebuild if sources are newer.
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
rem start-webui.bat is the normal VPN/LAN entry point, so manage Caddy by default.
rem Set OPENCODE_WEBUI_CADDY=0 before launch to use the raw WebUI URL only.
if not defined OPENCODE_WEBUI_CADDY set OPENCODE_WEBUI_CADDY=1
rem For VPN / phone access the WebUI listens on every interface. OpenCode itself
rem stays on 127.0.0.1. To keep the WebUI local only, set the variable yourself:
rem   set OPENCODE_WEBUI_HOST=127.0.0.1
if not defined OPENCODE_WEBUI_HOST set OPENCODE_WEBUI_HOST=0.0.0.0
cd host
rem The tray icon lives in a PowerShell/WinForms launcher. The Node host runs
rem headless so it never opens the browser on its own; double-click the tray
rem icon to open the Caddy URL.
powershell -NoProfile -ExecutionPolicy Bypass -File "src\tray.ps1"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo [OpenCode WebUI] Tray exited with code %ERR%
  pause
  exit /b %ERR%
)
endlocal
