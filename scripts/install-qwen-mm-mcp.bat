@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM). cmd.exe misparses
rem batch files that contain multi-byte characters, even inside rem comments.
rem See docs\specs\bat-encoding-safety.md
setlocal
cd /d "%~dp0.."

echo [OpenCode WebUI] Installing the Qwen-MM-Plugins core MCP server into your OpenCode config...
node "%CD%\browser-bridge\scripts\install-qwen-mm-mcp.mjs" %*
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% EQU 2 (
  echo [OpenCode WebUI] An existing qwen-mm-plugins-core MCP entry differs from the expected one.
  echo [OpenCode WebUI] Re-run this script with --force to overwrite it, e.g.:
  echo   scripts\install-qwen-mm-mcp.bat --force
  pause
  exit /b 2
)
if %EXITCODE% NEQ 0 (
  echo [OpenCode WebUI] Install failed. See the error above.
  pause
  exit /b %EXITCODE%
)

pause
endlocal
