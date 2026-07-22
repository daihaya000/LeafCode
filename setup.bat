@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
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
call :pause_if_interactive
endlocal & exit /b 0

:failure
set "SETUP_EXIT=%ERRORLEVEL%"
call :pause_if_interactive
endlocal & exit /b %SETUP_EXIT%

:check_winget
where winget >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 1 "winget was not found."
exit /b 1

:check_node
set "NODE_MAJOR=0"
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
call :node_major_is_supported
if not errorlevel 1 exit /b 0
echo [Setup] Installing Node.js LTS...
winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :node_install_failed
where node >nul 2>&1
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
call :fail 2 "Node.js installation failed."
exit /b 2

:node_path_not_refreshed
call :fail 3 "Node.js is not available in this command prompt."
exit /b 3

:check_opencode
opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
echo [Setup] Installing OpenCode with winget...
winget install --id SST.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :install_opencode_with_npm
opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCode is not available in this command prompt."
exit /b 4

:install_opencode_with_npm
echo [Setup] winget installation failed. Installing with npm...
call npm install -g opencode-ai
if errorlevel 1 goto :opencode_install_failed
opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCode is not available in this command prompt."
exit /b 4

:opencode_install_failed
call :fail 4 "OpenCode installation failed."
exit /b 4

:install_web
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
call :fail 5 "web dependency installation failed."
exit /b 5

:web_ci_failed
popd
call :fail 5 "web dependency installation failed."
exit /b 5

:web_build_failed
popd
call :fail 6 "web build failed."
exit /b 6

:web_build_id_missing
popd
call :fail 7 "BUILD_ID was not found."
exit /b 7

:install_host
pushd host
if errorlevel 1 goto :host_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :host_ci_failed
popd
exit /b 0

:host_ci_failed_without_pushd
call :fail 8 "host dependency installation failed."
exit /b 8

:host_ci_failed
popd
call :fail 8 "host dependency installation failed."
exit /b 8

:start_host
call "%~dp0start-webui.bat"
exit /b %ERRORLEVEL%

:fail
set "SETUP_FAIL_CODE=%~1"
echo [Setup] %~2
exit /b %SETUP_FAIL_CODE%

:pause_if_interactive
if "%SETUP_NONINTERACTIVE%"=="1" exit /b 0
pause
exit /b 0
