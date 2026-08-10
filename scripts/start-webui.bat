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
rem native launcher OpenCodeWebUI.exe at the repository root, which runs this
rem file via cmd.exe in the same console (see scripts\launcher\Launcher.cs).
rem Running this file directly also works (e.g. for debugging); it simply
rem skips the launcher's app identity (icon / Alt-Tab / taskbar pinning).
rem ---------------------------------------------------------------------------
goto :main

:main
setlocal EnableExtensions DisableDelayedExpansion
rem Workflow Graph rollout defaults for the packaged EXE. Explicit false/0 overrides remain supported.
if not defined OPENCODE_WEBUI_WORKFLOW_MODE set "OPENCODE_WEBUI_WORKFLOW_MODE=true"
if not defined OPENCODE_WEBUI_WORKFLOW_GRAPH set "OPENCODE_WEBUI_WORKFLOW_GRAPH=true"
if not defined OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT set "OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT=true"
cd /d "%~dp0.."
set "MESSAGE_DIR=%~dp0setup-messages"

rem Give the console window a stable, app-like title so Alt-Tab and a taskbar
rem pin (see scripts\create-shortcut.bat) show "OpenCode WebUI" instead of the
rem generic "Command Prompt" title. Node does not touch this on Windows.
title OpenCode WebUI

rem Keep the committed root launcher in sync with its build inputs. Best
rem effort only: if csc.exe / node are unavailable (e.g. a fresh machine
rem before setup installs Node.js) the existing exe simply stays as is.
call :refresh_launcher

if "%OPENCODE_WEBUI_SETUP_COMPLETE%"=="1" goto :start_host
call :remember_code_page
chcp 65001 >nul 2>&1
echo [OpenCode WebUI] Starting...

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
call :check_ollama
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
rem (fresh install vs. OPENCODE_WEBUI_SETUP_COMPLETE fast path) got here.
title OpenCode WebUI
set OPENCODE_WEBUI_MODE=prod
rem The launcher is the normal VPN/LAN entry point, so manage Caddy by default.
rem Set OPENCODE_WEBUI_CADDY=0 before launch to use the raw WebUI URL only.
if not defined OPENCODE_WEBUI_CADDY set OPENCODE_WEBUI_CADDY=1
rem The WebUI listens on 127.0.0.1 (loopback) by default so it is not exposed
rem to the LAN/VPN without an explicit opt-in. OpenCode itself also stays on
rem 127.0.0.1. For phone/LAN access use the Caddy reverse proxy (default on),
rem or to bind every interface set the variable yourself:
rem   set OPENCODE_WEBUI_HOST=0.0.0.0
if not defined OPENCODE_WEBUI_HOST set OPENCODE_WEBUI_HOST=127.0.0.1
cd host
call node src\index.js
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo [OpenCode WebUI] Host exited with code %ERR%
  call :pause_if_interactive
  exit /b %ERR%
)
rem Keep the window briefly so "already running" style messages are readable.
rem ping is used instead of timeout because timeout errors when stdin is redirected.
%SystemRoot%\System32\ping.exe -n 4 127.0.0.1 >nul
exit /b 0

:failure
set "FAIL_EXIT=%ERRORLEVEL%"
echo [OpenCode WebUI] FAILED with exit code %FAIL_EXIT%.
call :say failure
call :restore_code_page
call :pause_if_interactive
exit /b %FAIL_EXIT%

:refresh_launcher
rem Exit 0 = the root exe is current, 1 = missing or older than an input.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "if(-not (Test-Path -LiteralPath 'OpenCodeWebUI.exe')){exit 1}; $e=(Get-Item -LiteralPath 'OpenCodeWebUI.exe').LastWriteTimeUtc; foreach($i in 'scripts\launcher\Launcher.cs','scripts\build-launcher.bat','host\src\icon.json'){ if((Test-Path -LiteralPath $i) -and (Get-Item -LiteralPath $i).LastWriteTimeUtc -gt $e){exit 1} }" >nul 2>&1
if not errorlevel 1 exit /b 0
echo [OpenCode WebUI] Refreshing native launcher...
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
echo [OpenCode WebUI] Installing Node.js LTS...
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
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call where winget >nul 2>&1
if errorlevel 1 goto :install_opencode_with_npm
echo [OpenCode WebUI] Installing OpenCode with winget...
call winget install --id SST.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :install_opencode_with_npm
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCode is not available in this command prompt." error-4-path
exit /b 4

:install_opencode_with_npm
echo [OpenCode WebUI] winget install failed. Falling back to npm...
call npm install -g opencode-ai
if errorlevel 1 goto :opencode_install_failed
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCode is not available in this command prompt." error-4-path
exit /b 4

:opencode_install_failed
call :fail 4 "OpenCode could not be installed." error-4-install
exit /b 4

rem Caddy (reverse proxy / local HTTPS) is optional: the tray host manages it
rem only when OPENCODE_WEBUI_CADDY is enabled (default "1", see :start_host
rem below) and simply skips it at runtime when the binary is missing
rem (host/src/index.js findCaddy()/spawnCaddy()), so a failure here never
rem blocks WebUI startup on 127.0.0.1. Unlike Node.js/OpenCode this step
rem therefore never returns a non-zero exit code.
:check_caddy
if "%OPENCODE_WEBUI_CADDY%"=="0" exit /b 0
call caddy version >nul 2>&1
if not errorlevel 1 exit /b 0
rem WinGet often installs Caddy as a Links shim under LOCALAPPDATA that this
rem console's inherited PATH does not see yet; host/src/index.js's findCaddy()
rem already checks this path directly, so treat it as installed without
rem needing to refresh PATH here.
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\caddy.exe" exit /b 0
call where winget >nul 2>&1
if errorlevel 1 goto :caddy_skip_no_winget
echo [OpenCode WebUI] Installing Caddy ^(optional reverse proxy / HTTPS^)...
call winget install --id CaddyServer.Caddy --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :caddy_install_failed
exit /b 0

:caddy_skip_no_winget
echo [OpenCode WebUI] winget not found; skipping automatic Caddy install ^(optional reverse proxy^). See README for manual setup.
exit /b 0

:caddy_install_failed
echo [OpenCode WebUI] Caddy installation failed; continuing without the optional reverse proxy. See README for manual setup.
exit /b 0

rem Ollama (local image analysis backend) is optional: the Vision settings tab
rem manages install/pull on demand, so a failure here never blocks startup.
rem OPENCODE_WEBUI_OLLAMA=0 skips the automatic install and model pull entirely.
:check_ollama
if "%OPENCODE_WEBUI_OLLAMA%"=="0" exit /b 0
if "%OPENCODE_WEBUI_QWEN_NATIVE%"=="1" goto :check_ollama_proceed
if not exist "%APPDATA%\opencode-webui\qwen-native-settings.json" exit /b 0
:check_ollama_proceed
call where ollama >nul 2>&1
if not errorlevel 1 goto :ollama_pull
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ollama.exe" goto :ollama_pull
call where winget >nul 2>&1
if errorlevel 1 goto :ollama_skip_no_winget
echo [OpenCode WebUI] Installing Ollama ^(optional local image analysis^)...
call winget install --id Ollama.Ollama --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :ollama_install_failed

:ollama_pull
if "%OPENCODE_WEBUI_OLLAMA_MODEL%"=="" set "OPENCODE_WEBUI_OLLAMA_MODEL=qwen2.5vl:7b"
call where ollama >nul 2>&1
if errorlevel 1 goto :ollama_skip_no_binary
if not exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ollama.exe" if not exist "%ProgramFiles%\Ollama\ollama.exe" goto :ollama_skip_no_binary
echo [OpenCode WebUI] Pulling Ollama model %OPENCODE_WEBUI_OLLAMA_MODEL% ^(optional, may take a while^)...
call ollama pull %OPENCODE_WEBUI_OLLAMA_MODEL% >nul 2>&1
if errorlevel 1 goto :ollama_pull_failed
exit /b 0

:ollama_skip_no_winget
echo [OpenCode WebUI] winget not found; skipping automatic Ollama install. See README for manual setup.
exit /b 0

:ollama_install_failed
echo [OpenCode WebUI] Ollama installation failed; continuing without local image analysis. See README for manual setup.
exit /b 0

:ollama_skip_no_binary
echo [OpenCode WebUI] Ollama binary not on PATH yet; skipping model pull. Restart after PATH refresh.
exit /b 0

:ollama_pull_failed
echo [OpenCode WebUI] Ollama model pull failed; continuing. You can pull it later from the Vision settings tab.
exit /b 0

:install_web
if not exist "web\node_modules\" goto :install_web_run
call npm --prefix web ls --depth=0 >nul 2>&1
if not errorlevel 1 goto :install_web_build
echo [OpenCode WebUI] Web dependencies changed; refreshing...

:install_web_run
echo [OpenCode WebUI] Installing web dependencies...
pushd web
if errorlevel 1 goto :web_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :web_ci_failed
popd

:install_web_build
call :resolve_dist_dir
if errorlevel 1 exit /b 10
if not exist "%NEXT_DIST_DIR%\BUILD_ID" goto :install_web_build_run
rem Production rebuild (missing or stale BUILD_ID vs sources) is handled by
rem host/src/index.js on start and on tray/WebUI restart, so a build that
rem already exists is left alone here.
echo [OpenCode WebUI] Existing build found; host will rebuild if sources are newer.
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
echo [OpenCode WebUI] Building web ^(first run^)...
call node scripts\build-web.mjs --skip-guard
if errorlevel 1 goto :web_build_failed
if not exist "%NEXT_DIST_DIR%\BUILD_ID" goto :web_build_id_missing
exit /b 0

:web_build_skipped
echo [OpenCode WebUI] A WebUI is already running; skipping the first-run build.
echo [OpenCode WebUI] The host will reuse it, or take it over and rebuild.
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
if not exist "host\node_modules\" goto :install_host_run
call npm --prefix host ls --depth=0 >nul 2>&1
if not errorlevel 1 exit /b 0
echo [OpenCode WebUI] Host dependencies changed; refreshing...

:install_host_run
echo [OpenCode WebUI] Installing host dependencies...
pushd host
if errorlevel 1 goto :host_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :host_ci_failed
popd
exit /b 0

:host_ci_failed_without_pushd
call :fail 8 "host dependencies could not be installed." error-8
exit /b 8

:host_ci_failed
popd
call :fail 8 "host dependencies could not be installed." error-8
exit /b 8

:install_browser_bridge
if not exist "browser-bridge\node_modules\" goto :install_browser_bridge_run
call npm --prefix browser-bridge ls --depth=0 >nul 2>&1
if not errorlevel 1 exit /b 0
echo [OpenCode WebUI] Browser Bridge dependencies changed; refreshing...

:install_browser_bridge_run
echo [OpenCode WebUI] Installing Browser Bridge dependencies...
pushd browser-bridge
if errorlevel 1 goto :browser_bridge_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :browser_bridge_ci_failed
popd
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
rem (override OPENCODE_WEBUI_BUILD_DIR). See scripts\web-build-mirror.mjs.
set "NEXT_DIST_DIR="
for /f "usebackq delims=" %%D in (`node scripts\web-build-mirror.mjs --dist-dir`) do set "NEXT_DIST_DIR=%%D"
if not defined NEXT_DIST_DIR goto :resolve_dist_dir_failed
exit /b 0

:resolve_dist_dir_failed
call :fail 10 "the build output directory could not be resolved." error-10
exit /b 10

:fail
set "FAIL_CODE=%~1"
echo [OpenCode WebUI] ERROR %~1: %~2
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
if "%OPENCODE_WEBUI_NONINTERACTIVE%"=="1" exit /b 0
pause
exit /b 0
