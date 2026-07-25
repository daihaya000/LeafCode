@echo off
rem ---------------------------------------------------------------------------
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM).
rem cmd.exe misparses batch files that contain multi-byte characters: it loses
rem track of the read position and starts executing fragments of later lines,
rem which breaks setup on every code page (932 / 437 / 850 / 1252 / 65001).
rem Japanese text lives in scripts\setup-messages\*.txt (UTF-8) and is printed
rem with `type`, which is not parsed by cmd.exe.
rem See docs\specs\bat-encoding-safety.md
rem ---------------------------------------------------------------------------
goto :main

:main
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "SETUP_MESSAGE_DIR=%~dp0scripts\setup-messages"
call :remember_code_page
chcp 65001 >nul 2>&1
echo [Setup] Starting OpenCode WebUI setup.
call :check_winget
if errorlevel 1 goto :failure
call :check_node
if errorlevel 1 goto :failure
call :check_opencode
if errorlevel 1 goto :failure
call :install_web
if errorlevel 1 goto :failure
call :install_host
if errorlevel 1 goto :failure
call :start_host
goto :success

:success
echo [Setup] Setup completed.
echo [Setup] WebUI: http://127.0.0.1:3000
call :say success
call :restore_code_page
endlocal & exit /b 0

:failure
set "SETUP_EXIT=%ERRORLEVEL%"
echo [Setup] FAILED with exit code %SETUP_EXIT%.
call :say failure
call :restore_code_page
call :pause_if_interactive
endlocal & exit /b %SETUP_EXIT%

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
echo [Setup] Installing Node.js LTS...
call winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :node_install_failed
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
echo [Setup] Installing OpenCode with winget...
call winget install --id SST.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :install_opencode_with_npm
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCode is not available in this command prompt." error-4-path
exit /b 4

:install_opencode_with_npm
echo [Setup] winget install failed. Falling back to npm...
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
call node scripts\production-webui-build-guard.mjs --stop
set "WEB_GUARD_EXIT=%ERRORLEVEL%"
if "%WEB_GUARD_EXIT%"=="0" goto :web_build_guard_passed
if "%WEB_GUARD_EXIT%"=="10" goto :web_build_guard_stopped
call :fail 6 "web build was cancelled to protect a running WebUI. Stop the WebUI and run setup again." error-6-guard
exit /b 6

:web_build_guard_stopped
echo [Setup] The running WebUI was stopped for this build.
call :say guard-stopped
goto :web_build_guard_passed

:web_build_guard_passed
pushd web
if errorlevel 1 goto :web_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :web_ci_failed
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

:web_build_failed
popd
call :fail 6 "the web build failed." error-6
exit /b 6

:web_build_id_missing
popd
call :fail 7 "BUILD_ID is missing after the build." error-7
exit /b 7

:install_host
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

:start_host
start "OpenCode WebUI" "%ComSpec%" /d /c call "%~dp0start-webui.bat"
exit /b 0

:fail
set "SETUP_FAIL_CODE=%~1"
echo [Setup] ERROR %~1: %~2
call :say %~3
exit /b %SETUP_FAIL_CODE%

:say
if "%~1"=="" exit /b 0
if not exist "%SETUP_MESSAGE_DIR%\%~1.txt" exit /b 0
type "%SETUP_MESSAGE_DIR%\%~1.txt"
exit /b 0

:remember_code_page
set "SETUP_CP_ORIGINAL="
for /f "tokens=2 delims=:" %%C in ('chcp 2^>nul') do for /f "tokens=1" %%D in ("%%C") do set "SETUP_CP_ORIGINAL=%%D"
exit /b 0

:restore_code_page
if not defined SETUP_CP_ORIGINAL exit /b 0
chcp %SETUP_CP_ORIGINAL% >nul 2>&1
exit /b 0

:pause_if_interactive
if "%SETUP_NONINTERACTIVE%"=="1" exit /b 0
pause
exit /b 0
