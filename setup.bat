@echo off
chcp 65001 >nul
goto :main

:main
setlocal EnableExtensions DisableDelayedExpansion
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
echo [Setup] セットアップが完了しました。
echo [Setup] WebUI: http://127.0.0.1:3000
echo [Setup] トレイアイコンが表示されない場合は start-webui.bat を手動で実行してください。
endlocal & exit /b 0

:failure
set "SETUP_EXIT=%ERRORLEVEL%"
echo [Setup] セットアップに失敗しました（終了コード: %SETUP_EXIT%）。
call :pause_if_interactive
endlocal & exit /b %SETUP_EXIT%

:check_winget
call where winget >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 1 "wingetが見つかりません。" "Microsoft Storeから「アプリインストーラー」を導入してください。"
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
call :fail 2 "Node.jsの導入に失敗しました。" "nodejs.orgからNode.jsを手動導入して再実行してください。"
exit /b 2

:node_path_not_refreshed
call :fail 3 "Node.jsがこのコマンドプロンプトで利用できません。" "再ログインまたはPCを再起動してから再実行してください。"
exit /b 3

:check_opencode
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
echo [Setup] Installing OpenCode with winget...
call winget install --id SST.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :install_opencode_with_npm
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCodeがこのコマンドプロンプトで利用できません。" "OpenCode Docsを確認し、必要なら再ログインしてから再実行してください。"
exit /b 4

:install_opencode_with_npm
echo [Setup] wingetでの導入に失敗しました。npmで導入します...
call npm install -g opencode-ai
if errorlevel 1 goto :opencode_install_failed
call opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCodeがこのコマンドプロンプトで利用できません。" "OpenCode Docsを確認し、必要なら再ログインしてから再実行してください。"
exit /b 4

:opencode_install_failed
call :fail 4 "OpenCodeの導入に失敗しました。" "OpenCode Docsを確認し、必要なら再ログインしてから再実行してください。"
exit /b 4

:install_web
call node scripts\production-webui-build-guard.mjs
if not errorlevel 1 goto :web_build_guard_passed
call :fail 6 "web build was cancelled to protect a running WebUI." "Stop the WebUI and run setup again."
exit /b 6

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
call :fail 5 "webの依存関係の導入に失敗しました。" "ネットワークとweb/package-lock.jsonを確認して再実行してください。"
exit /b 5

:web_ci_failed
popd
call :fail 5 "webの依存関係の導入に失敗しました。" "ネットワークとweb/package-lock.jsonを確認して再実行してください。"
exit /b 5

:web_build_failed
popd
call :fail 6 "webのビルドに失敗しました。" "表示されたビルドエラーとNode.jsのバージョンを確認してください。"
exit /b 6

:web_build_id_missing
popd
call :fail 7 "ビルド後にBUILD_IDが見つかりません。" "ビルドログを確認してから再実行してください。"
exit /b 7

:install_host
pushd host
if errorlevel 1 goto :host_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :host_ci_failed
popd
exit /b 0

:host_ci_failed_without_pushd
call :fail 8 "hostの依存関係の導入に失敗しました。" "ネットワークとhost/package-lock.jsonを確認して再実行してください。"
exit /b 8

:host_ci_failed
popd
call :fail 8 "hostの依存関係の導入に失敗しました。" "ネットワークとhost/package-lock.jsonを確認して再実行してください。"
exit /b 8

:start_host
start "OpenCode WebUI" "%ComSpec%" /d /c call "%~dp0start-webui.bat"
exit /b 0

:fail
set "SETUP_FAIL_CODE=%~1"
echo [Setup] エラーコード: %~1
echo [Setup] %~2
echo [Setup] 復旧案内: %~3
exit /b %SETUP_FAIL_CODE%

:pause_if_interactive
if "%SETUP_NONINTERACTIVE%"=="1" exit /b 0
pause
exit /b 0
