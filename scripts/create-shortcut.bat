@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM). cmd.exe misparses
rem batch files that contain multi-byte characters, even inside rem comments.
rem See docs\specs\bat-encoding-safety.md
setlocal
cd /d "%~dp0.."

echo [OpenCode WebUI] Creating a Desktop shortcut with a proper icon...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"
if errorlevel 1 (
  echo [OpenCode WebUI] Shortcut creation failed. See the error above.
  pause
  exit /b 1
)

type "%~dp0shortcut-messages\success.txt"
pause
endlocal
