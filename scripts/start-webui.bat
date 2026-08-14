@echo off
rem ---------------------------------------------------------------------------
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM).
rem cmd.exe misparses batch files that contain multi-byte characters: it loses
rem track of the read position and starts executing fragments of later lines.
rem Japanese text lives in scripts\setup-messages\*.txt (UTF-8) and is printed
rem with `type`, which is not parsed by cmd.exe.
rem See docs\specs\bat-encoding-safety.md and docs\specs\setup-start-webui-merge.md
rem
rem Internal setup/start script. The single user-facing entry point is the
rem native launcher LeafCode.exe at the repository root, which runs this
rem file via cmd.exe in the same console (see scripts\launcher\Launcher.cs).
rem Running this file directly also works (e.g. for debugging); it simply
rem skips the launcher's app identity (icon / Alt-Tab / taskbar pinning).
rem ---------------------------------------------------------------------------
goto :main

:main
setlocal EnableExtensions DisableDelayedExpansion
rem :pf_status caches its snapshot in PREFLIGHT_STATUS. setlocal does not hide
rem variables inherited from the parent environment, so a stale value (leaked
rem from a shell that ran preflight by hand, or from a wrapper process) would
rem be treated as this run's snapshot and skip the check entirely. Reset it.
set "PREFLIGHT_STATUS="
rem Legacy env vars (OPENCODE_WEBUI_*) keep working: copy each onto its
rem LEAFCODE_* name when the new name is not set. New names win. See
rem scripts\lib\env-compat.mjs for the same mapping in Node entry points.
if not defined LEAFCODE_PORT if defined OPENCODE_WEBUI_PORT set "LEAFCODE_PORT=%OPENCODE_WEBUI_PORT%"
if not defined LEAFCODE_HOST if defined OPENCODE_WEBUI_HOST set "LEAFCODE_HOST=%OPENCODE_WEBUI_HOST%"
if not defined LEAFCODE_MODE if defined OPENCODE_WEBUI_MODE set "LEAFCODE_MODE=%OPENCODE_WEBUI_MODE%"
if not defined LEAFCODE_CADDY if defined OPENCODE_WEBUI_CADDY set "LEAFCODE_CADDY=%OPENCODE_WEBUI_CADDY%"
if not defined LEAFCODE_CADDYFILE if defined OPENCODE_WEBUI_CADDYFILE set "LEAFCODE_CADDYFILE=%OPENCODE_WEBUI_CADDYFILE%"
if not defined LEAFCODE_HOST_CONTROL_URL if defined OPENCODE_WEBUI_HOST_CONTROL_URL set "LEAFCODE_HOST_CONTROL_URL=%OPENCODE_WEBUI_HOST_CONTROL_URL%"
if not defined LEAFCODE_HOST_CONTROL_PORT if defined OPENCODE_WEBUI_HOST_CONTROL_PORT set "LEAFCODE_HOST_CONTROL_PORT=%OPENCODE_WEBUI_HOST_CONTROL_PORT%"
if not defined LEAFCODE_BROWSER_BROKER_PORT if defined OPENCODE_WEBUI_BROWSER_BROKER_PORT set "LEAFCODE_BROWSER_BROKER_PORT=%OPENCODE_WEBUI_BROWSER_BROKER_PORT%"
if not defined LEAFCODE_BUILD_DIR if defined OPENCODE_WEBUI_BUILD_DIR set "LEAFCODE_BUILD_DIR=%OPENCODE_WEBUI_BUILD_DIR%"
if not defined LEAFCODE_DATA_DIR if defined OPENCODE_WEBUI_DATA_DIR set "LEAFCODE_DATA_DIR=%OPENCODE_WEBUI_DATA_DIR%"
if not defined LEAFCODE_SETUP_COMPLETE if defined OPENCODE_WEBUI_SETUP_COMPLETE set "LEAFCODE_SETUP_COMPLETE=%OPENCODE_WEBUI_SETUP_COMPLETE%"
if not defined LEAFCODE_NONINTERACTIVE if defined OPENCODE_WEBUI_NONINTERACTIVE set "LEAFCODE_NONINTERACTIVE=%OPENCODE_WEBUI_NONINTERACTIVE%"
if not defined LEAFCODE_NO_BROWSER if defined OPENCODE_WEBUI_NO_BROWSER set "LEAFCODE_NO_BROWSER=%OPENCODE_WEBUI_NO_BROWSER%"
if not defined LEAFCODE_HEADLESS if defined OPENCODE_WEBUI_HEADLESS set "LEAFCODE_HEADLESS=%OPENCODE_WEBUI_HEADLESS%"
if not defined LEAFCODE_WORKFLOW_MODE if defined OPENCODE_WEBUI_WORKFLOW_MODE set "LEAFCODE_WORKFLOW_MODE=%OPENCODE_WEBUI_WORKFLOW_MODE%"
if not defined LEAFCODE_WORKFLOW_GRAPH if defined OPENCODE_WEBUI_WORKFLOW_GRAPH set "LEAFCODE_WORKFLOW_GRAPH=%OPENCODE_WEBUI_WORKFLOW_GRAPH%"
if not defined LEAFCODE_WORKFLOW_GRAPH_EDIT if defined OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT set "LEAFCODE_WORKFLOW_GRAPH_EDIT=%OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT%"
rem Workflow Graph rollout defaults for the packaged EXE. Explicit false/0 overrides remain supported.
if not defined LEAFCODE_WORKFLOW_MODE set "LEAFCODE_WORKFLOW_MODE=true"
if not defined LEAFCODE_WORKFLOW_GRAPH set "LEAFCODE_WORKFLOW_GRAPH=true"
if not defined LEAFCODE_WORKFLOW_GRAPH_EDIT set "LEAFCODE_WORKFLOW_GRAPH_EDIT=true"
cd /d "%~dp0.."
set "MESSAGE_DIR=%~dp0setup-messages"

rem Give the console window a stable, app-like title so Alt-Tab and a taskbar
rem pin (see scripts\create-shortcut.bat) show "LeafCode" instead of the
rem generic "Command Prompt" title. Node does not touch this on Windows.
title LeafCode

rem Keep the committed root launcher in sync with its build inputs. Best
rem effort only: if csc.exe / node are unavailable (e.g. a fresh machine
rem before setup installs Node.js) the existing exe simply stays as is.
call :refresh_launcher

if "%LEAFCODE_SETUP_COMPLETE%"=="1" goto :start_host
call :remember_code_page
chcp 65001 >nul 2>&1
echo [LeafCode] Starting...

rem This file used to be split into a one-time setup.bat (winget / Node.js /
rem OpenCode / dependency installs) and the old root start-webui.bat (assumed
rem already installed). They are merged here: every check below is a no-op
rem once its condition is already satisfied, so repeat runs stay as fast as
rem before the merge, while a brand new machine gets the same install steps
rem setup.bat used to run.
call :check_node
if errorlevel 1 goto :failure
call :check_opencode
if errorlevel 1 goto :failure
call :check_caddy
call :install_web
if errorlevel 1 goto :failure
call :install_host
if errorlevel 1 goto :failure
call :install_browser_bridge
if errorlevel 1 goto :failure
call :restore_code_page
goto :start_host

:start_host
rem npm (via its internal progress/gauge display while running `npm ci`,
rem `npm ls`, or `npm run build` above) can overwrite this console's title
rem with its own transient status text (e.g. "npm ls") and never restore it,
rem so the window is left showing that stale text through the build
rem and the host's own "Starting..."/"Production" log lines. Reassert the
rem app title here, right before the host tail, regardless of which path
rem (fresh install vs. LEAFCODE_SETUP_COMPLETE fast path) got here.
title LeafCode
set LEAFCODE_MODE=prod
rem The launcher is the normal VPN/LAN entry point, so manage Caddy by default.
rem Set LEAFCODE_CADDY=0 before launch to use the raw WebUI URL only.
if not defined LEAFCODE_CADDY set LEAFCODE_CADDY=1
rem The WebUI listens on 127.0.0.1 (loopback) by default so it is not exposed
rem to the LAN/VPN without an explicit opt-in. OpenCode itself also stays on
rem 127.0.0.1. For phone/LAN access use the Caddy reverse proxy (default on),
rem or to bind every interface set the variable yourself:
rem   set LEAFCODE_HOST=0.0.0.0
if not defined LEAFCODE_HOST set LEAFCODE_HOST=127.0.0.1
cd host
call node src\index.js
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo [LeafCode] Host exited with code %ERR%
  call :pause_if_interactive
  exit /b %ERR%
)
rem Keep the window briefly so "already running" style messages are readable.
rem ping is used instead of timeout because timeout errors when stdin is redirected.
%SystemRoot%\System32\ping.exe -n 4 127.0.0.1 >nul
exit /b 0

:failure
set "FAIL_EXIT=%ERRORLEVEL%"
echo [LeafCode] FAILED with exit code %FAIL_EXIT%.
call :say failure
call :restore_code_page
call :pause_if_interactive
exit /b %FAIL_EXIT%

:pf_status
rem Preflight status snapshot: one Node boot answers the launcher / opencode
rem / caddy checks that used to spawn PowerShell or the tools themselves
rem (~250-950 ms each). See scripts\preflight.mjs. Cached so later callers
rem (:check_opencode / :check_caddy) reuse the snapshot taken here, since
rem :refresh_launcher always runs first.
if defined PREFLIGHT_STATUS exit /b 0
for /f "usebackq delims=" %%R in (`node scripts\preflight.mjs`) do set "PREFLIGHT_STATUS=%%R"
exit /b 0

:pf_has
rem Argument: preflight status item name (opencode / caddy / launcher).
rem Errorlevel mirrors the item's value: 0 = available, 1 = missing,
rem 2 = shim-only (caller verifies it once with --version before deciding).
rem findstr /C is required: cmd's %VAR:old=new% substitution misparses the
rem "=" inside a "name=value" pair, so string comparison is not an option.
echo %PREFLIGHT_STATUS% | findstr /C:"%~1=0" >nul 2>&1
if not errorlevel 1 exit /b 0
echo %PREFLIGHT_STATUS% | findstr /C:"%~1=2" >nul 2>&1
if not errorlevel 1 exit /b 2
exit /b 1

:refresh_launcher
rem Exit 0 = the root exe is current, 1 = missing or older than an input.
call :pf_status
call :pf_has launcher
if not errorlevel 1 exit /b 0
echo [LeafCode] Refreshing native launcher...
call scripts\build-launcher.bat /quiet
exit /b 0

:check_winget
call where winget >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 1 "winget was not found." error-1
exit /b 1

:check_node
set "NODE_MAJOR=0"
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
call :node_major_is_supported
if not errorlevel 1 exit /b 0
call :check_winget
if errorlevel 1 exit /b 1
echo [LeafCode] Installing Node.js LTS...
call winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :node_install_failed
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
call where node >nul 2>&1
if errorlevel 1 goto :node_path_not_refreshed
set "NODE_MAJOR=0"
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
call :node_major_is_supported
if not errorlevel 1 exit /b 0
goto :node_path_not_refreshed

:node_major_is_supported
if %NODE_MAJOR% GEQ 20 exit /b 0
exit /b 1

:node_install_failed
call :fail 2 "Node.js could not be installed." error-2
exit /b 2

:node_path_not_refreshed
call :fail 3 "Node.js is not available in this command prompt." error-3
exit /b 3

:check_opencode
call :pf_status
call :pf_has opencode
if not errorlevel 1 exit /b 0
if errorlevel 2 (
  rem Only an npm shim is reachable without a verified binary; run it once.
  call opencode --version >nul 2>&1
  if not errorlevel 1 exit /b 0
)
rem A broken npm bin stub (postinstall not run) can shadow a working WinGet
rem install on PATH. Accept the Links shim directly, same as :check_caddy.
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\opencode.exe" (
  "%LOCALAPPDATA%\Microsoft\WinGet\Links\opencode.exe" --version >nul 2>&1
  if not errorlevel 1 exit /b 0
)
rem Heal npm global install when only the postinstall placeholder remains.
if exist "%APPDATA%\npm\node_modules\opencode-ai\postinstall.mjs" (
  echo [LeafCode] Repairing OpenCode npm install...
  call node "%APPDATA%\npm\node_modules\opencode-ai\postinstall.mjs"
  call opencode --version >nul 2>&1
  if not errorlevel 1 exit /b 0
)
call where winget >nul 2>&1
if errorlevel 1 goto :install_opencode_with_npm
echo [LeafCode] Installing OpenCode with winget...
call winget install --id SST.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :install_opencode_with_npm
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\opencode.exe" (
  "%LOCALAPPDATA%\Microsoft\WinGet\Links\opencode.exe" --version >nul 2>&1
  if not errorlevel 1 exit /b 0
)
call :fail 4 "OpenCode is not available in this command prompt." error-4-path
exit /b 4

:install_opencode_with_npm
echo [LeafCode] winget install failed. Falling back to npm...
call npm install -g opencode-ai
if errorlevel 1 goto :opencode_install_failed
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%APPDATA%\npm\node_modules\opencode-ai\postinstall.mjs" (
  echo [LeafCode] Repairing OpenCode npm install...
  call node "%APPDATA%\npm\node_modules\opencode-ai\postinstall.mjs"
  call opencode --version >nul 2>&1
  if not errorlevel 1 exit /b 0
)
call :fail 4 "OpenCode is not available in this command prompt." error-4-path
exit /b 4

:opencode_install_failed
call :fail 4 "OpenCode could not be installed." error-4-install
exit /b 4

rem Caddy (reverse proxy / local HTTPS) is optional: the tray host manages it
rem only when LEAFCODE_CADDY is enabled (default "1", see :start_host
rem below) and simply skips it at runtime when the binary is missing
rem (host/src/index.js findCaddy()/spawnCaddy()), so a failure here never
rem blocks WebUI startup on 127.0.0.1. Unlike Node.js/OpenCode this step
rem therefore never returns a non-zero exit code.
:check_caddy
if "%LEAFCODE_CADDY%"=="0" exit /b 0
call :pf_status
call :pf_has caddy
if not errorlevel 1 exit /b 0
if errorlevel 2 (
  rem Only a shim is reachable; verify it once before falling back to install.
  call caddy version >nul 2>&1
  if not errorlevel 1 exit /b 0
)
rem WinGet often installs Caddy as a Links shim under LOCALAPPDATA that this
rem console's inherited PATH does not see yet; host/src/index.js's findCaddy()
rem already checks this path directly, so treat it as installed without
rem needing to refresh PATH here.
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\caddy.exe" exit /b 0
call where winget >nul 2>&1
if errorlevel 1 goto :caddy_skip_no_winget
echo [LeafCode] Installing Caddy ^(optional reverse proxy / HTTPS^)...
call winget install --id CaddyServer.Caddy --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :caddy_install_failed
exit /b 0

:caddy_skip_no_winget
echo [LeafCode] winget not found; skipping automatic Caddy install ^(optional reverse proxy^). See README for manual setup.
exit /b 0

:caddy_install_failed
echo [LeafCode] Caddy installation failed; continuing without the optional reverse proxy. See README for manual setup.
exit /b 0

rem Ollama (local image analysis backend) is no longer installed at startup.
rem Use Settings -> Image analysis -> "Ollama setup" in the WebUI, which
rem installs Ollama, pulls the model, and registers it as an OpenCode provider.

:install_web
call node scripts\check-deps.mjs "web"
if not errorlevel 1 goto :install_web_build
echo [LeafCode] Web dependencies changed; refreshing...

:install_web_run
echo [LeafCode] Installing web dependencies...
pushd web
if errorlevel 1 goto :web_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :web_ci_failed
popd
call node scripts\check-deps.mjs --update "web" >nul 2>&1

:install_web_build
call :resolve_dist_dir
if errorlevel 1 exit /b 10
if not exist "%NEXT_DIST_DIR%\BUILD_ID" goto :install_web_build_run
rem Production rebuild (missing or stale BUILD_ID vs sources) is handled by
rem host/src/index.js on start and on tray/WebUI restart, so a build that
rem already exists is left alone here.
echo [LeafCode] Existing build found; host will rebuild if sources are newer.
exit /b 0

:install_web_build_run
rem Never build on top of a running production WebUI: replacing the served
rem build directory mid-flight mixes chunk generations (ChunkLoadError).
rem When the guard sees a listener (any non-zero exit), skip the first-run
rem build and continue to the host tail - the tray host reuses a healthy
rem WebUI as is, or takes over a stale one of its own and rebuilds
rem (decideWebReuseOnStale in host/src/index.js).
call node scripts\production-webui-build-guard.mjs
if errorlevel 1 goto :web_build_skipped

:web_build_guard_passed
rem scripts\build-web.mjs syncs the hard-link mirror and builds there; the
rem guard above already ran, so it is not repeated.
echo [LeafCode] Building web ^(first run^)...
call node scripts\build-web.mjs --skip-guard
if errorlevel 1 goto :web_build_failed
if not exist "%NEXT_DIST_DIR%\BUILD_ID" goto :web_build_id_missing
exit /b 0

:web_build_skipped
echo [LeafCode] A WebUI is already running; skipping the first-run build.
echo [LeafCode] The host will reuse it, or take it over and rebuild.
exit /b 0

:web_ci_failed_without_pushd
call :fail 5 "web dependencies could not be installed." error-5
exit /b 5

:web_ci_failed
popd
call :fail 5 "web dependencies could not be installed." error-5
exit /b 5

rem The build runs through scripts\build-web.mjs from the repo root, so these
rem paths must not popd: nothing was pushed.
:web_build_failed
call :fail 6 "the web build failed." error-6
exit /b 6

:web_build_id_missing
call :fail 7 "BUILD_ID is missing after the build." error-7
exit /b 7

:install_host
call node scripts\check-deps.mjs "host"
if not errorlevel 1 exit /b 0
echo [LeafCode] Host dependencies changed; refreshing...

:install_host_run
echo [LeafCode] Installing host dependencies...
pushd host
if errorlevel 1 goto :host_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :host_ci_failed
popd
call node scripts\check-deps.mjs --update "host" >nul 2>&1
exit /b 0

:host_ci_failed_without_pushd
call :fail 8 "host dependencies could not be installed." error-8
exit /b 8

:host_ci_failed
popd
call :fail 8 "host dependencies could not be installed." error-8
exit /b 8

:install_browser_bridge
call node scripts\check-deps.mjs "browser-bridge"
if not errorlevel 1 exit /b 0
echo [LeafCode] Browser Bridge dependencies changed; refreshing...

:install_browser_bridge_run
echo [LeafCode] Installing Browser Bridge dependencies...
pushd browser-bridge
if errorlevel 1 goto :browser_bridge_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :browser_bridge_ci_failed
popd
call node scripts\check-deps.mjs --update "browser-bridge" >nul 2>&1
exit /b 0

:browser_bridge_ci_failed_without_pushd
call :fail 9 "Browser Bridge dependencies could not be installed." error-9
exit /b 9

:browser_bridge_ci_failed
popd
call :fail 9 "Browser Bridge dependencies could not be installed." error-9
exit /b 9

:resolve_dist_dir
rem Production builds run in the hard-link mirror outside the synced tree
rem (override LEAFCODE_BUILD_DIR). See scripts\web-build-mirror.mjs.
set "NEXT_DIST_DIR="
for /f "usebackq delims=" %%D in (`node scripts\web-build-mirror.mjs --dist-dir`) do set "NEXT_DIST_DIR=%%D"
if not defined NEXT_DIST_DIR goto :resolve_dist_dir_failed
exit /b 0

:resolve_dist_dir_failed
call :fail 10 "the build output directory could not be resolved." error-10
exit /b 10

:fail
set "FAIL_CODE=%~1"
echo [LeafCode] ERROR %~1: %~2
call :say %~3
exit /b %FAIL_CODE%

:say
if "%~1"=="" exit /b 0
if not exist "%MESSAGE_DIR%\%~1.txt" exit /b 0
type "%MESSAGE_DIR%\%~1.txt"
exit /b 0

:remember_code_page
set "CP_ORIGINAL="
for /f "tokens=2 delims=:" %%C in ('chcp 2^>nul') do for /f "tokens=1" %%D in ("%%C") do set "CP_ORIGINAL=%%D"
exit /b 0

:restore_code_page
if not defined CP_ORIGINAL exit /b 0
chcp %CP_ORIGINAL% >nul 2>&1
exit /b 0

:pause_if_interactive
if "%LEAFCODE_NONINTERACTIVE%"=="1" exit /b 0
rem next build overwrites the console title; restore it so a failed launch
rem does not look like a stray "next-build" window waiting on pause.
title LeafCode
pause
exit /b 0
