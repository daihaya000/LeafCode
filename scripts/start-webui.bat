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
call :install_web
if errorlevel 1 goto :failure
call :install_host
if errorlevel 1 goto :failure
call :install_browser_bridge
if errorlevel 1 goto :failure
call :restore_code_page
goto :start_host

:start_host
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
if not exist "web\.next\BUILD_ID" goto :install_web_build_run
rem Production rebuild (missing or stale BUILD_ID vs sources) is handled by
rem host/src/index.js on start and on tray/WebUI restart, so a build that
rem already exists is left alone here.
echo [OpenCode WebUI] Existing build found; host will rebuild if sources are newer.
exit /b 0

:install_web_build_run
rem Do not replace web\.next while a production WebUI is serving it: ask the
rem tray host to stop first (exit 10 = it was stopped, harmless to continue).
call node scripts\production-webui-build-guard.mjs --stop
set "WEB_GUARD_EXIT=%ERRORLEVEL%"
if "%WEB_GUARD_EXIT%"=="0" goto :web_build_guard_passed
if "%WEB_GUARD_EXIT%"=="10" goto :web_build_guard_stopped
call :fail 6 "web build was cancelled to protect a running WebUI. Stop the WebUI and run OpenCodeWebUI.exe again." error-6-guard
exit /b 6

:web_build_guard_stopped
echo [OpenCode WebUI] The running WebUI was stopped for this build.
call :say guard-stopped
goto :web_build_guard_passed

:web_build_guard_passed
echo [OpenCode WebUI] Building web ^(first run^)...
pushd web
if errorlevel 1 goto :web_build_failed_without_pushd
call npm run build
if errorlevel 1 goto :web_build_failed
if not exist ".next\BUILD_ID" goto :web_build_id_missing
popd
exit /b 0

:web_ci_failed_without_pushd
call :fail 5 "web dependencies could not be installed." error-5
exit /b 5

:web_ci_failed
popd
call :fail 5 "web dependencies could not be installed." error-5
exit /b 5

:web_build_failed_without_pushd
call :fail 6 "the web build failed." error-6
exit /b 6

:web_build_failed
popd
call :fail 6 "the web build failed." error-6
exit /b 6

:web_build_id_missing
popd
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
