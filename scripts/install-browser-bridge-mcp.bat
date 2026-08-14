@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM). cmd.exe misparses
rem batch files that contain multi-byte characters, even inside rem comments.
rem See docs\specs\bat-encoding-safety.md
setlocal
cd /d "%~dp0.."

echo [LeafCode] Installing the Browser Bridge MCP server into your OpenCode config...
node "%CD%\browser-bridge\scripts\install-mcp.mjs" %*
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% EQU 2 (
  echo [LeafCode] An existing browser-bridge MCP entry differs from the expected one.
  echo [LeafCode] Re-run this script with --force to overwrite it, e.g.:
  echo   scripts\install-browser-bridge-mcp.bat --force
  pause
  exit /b 2
)
if %EXITCODE% NEQ 0 (
  echo [LeafCode] Install failed. See the error above.
  pause
  exit /b %EXITCODE%
)

pause
endlocal
