@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM). cmd.exe misparses
rem batch files that contain multi-byte characters, even inside rem comments.
rem See docs\specs\bat-encoding-safety.md
setlocal
cd /d "%~dp0.."

rem /quiet is passed by start-webui.bat for an unattended first-run build:
rem it must not block on `pause` since nothing is watching the console then.
set QUIET=
if /i "%~1"=="/quiet" set QUIET=1

set LAUNCHER_DIR=%CD%\scripts\launcher
set CSC=

rem Prefer the .NET Framework compiler that ships with Windows (no extra
rem install needed). Avoid `where` here: piping into this script (as the
rem automated test does) can make a nested `for /f ('where ...')` fight the
rem outer redirection, so a direct path/PATH probe is used instead.
if exist "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not defined CSC if exist "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
rem A PATH-only fallback (e.g. a .NET SDK-provided csc.exe with no Framework
rem install) was tried via `for %%X in (csc.exe) do ... %%~$PATH:X` but an
rem empty PATH-search result made cmd choke on the expanded line, so this
rem intentionally stays limited to the two well-known Framework paths above.

if not defined CSC (
  echo [OpenCode WebUI] C# compiler ^(csc.exe^) not found.
  echo [OpenCode WebUI] Install .NET Framework 4.x ^(Windows Features^) or the .NET SDK, then retry.
  if not defined QUIET pause
  exit /b 1
)

echo [OpenCode WebUI] Using compiler: %CSC%

echo [OpenCode WebUI] Extracting app icon from host\src\icon.json...
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('host/src/icon.json','utf8'));fs.writeFileSync('scripts/launcher/app.ico', Buffer.from(j.base64,'base64'));"
if errorlevel 1 (
  echo [OpenCode WebUI] Icon extraction failed. Run 'node scripts\gen-icons.mjs' first.
  if not defined QUIET pause
  exit /b 1
)

echo [OpenCode WebUI] Compiling scripts\launcher\OpenCodeWebUI.exe...
"%CSC%" /nologo /target:exe /platform:anycpu /out:"%LAUNCHER_DIR%\OpenCodeWebUI.exe" /win32icon:"%LAUNCHER_DIR%\app.ico" "%LAUNCHER_DIR%\Launcher.cs"
if errorlevel 1 (
  echo [OpenCode WebUI] Compile failed. See the errors above.
  if not defined QUIET pause
  exit /b 1
)

echo [OpenCode WebUI] Built: %LAUNCHER_DIR%\OpenCodeWebUI.exe
echo [OpenCode WebUI] Next: run scripts\create-shortcut.bat to (re)create the Desktop shortcut.
if not defined QUIET pause
endlocal
