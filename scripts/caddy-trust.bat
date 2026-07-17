@echo off
:: Install Caddy's local root CA into the Windows trust store (one-time).
:: Run as Administrator so browsers stop warning about the local HTTPS cert.
::
:: NOTE: Caddy must be RUNNING first. `caddy trust` fetches the CA from the
:: admin API (localhost:2019); if Caddy is stopped it fails with a connection
:: error. Start the WebUI (start-webui.bat with OPENCODE_WEBUI_CADDY=1) or run
:: `caddy run --config deploy/Caddyfile --adapter caddyfile` before this script.
setlocal
where caddy >nul 2>&1 || (echo [FAIL] caddy not found on PATH. & pause & exit /b 1)

netstat -ano | findstr ":2019" | findstr LISTENING >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Caddy admin API ^(localhost:2019^) is not reachable.
  echo        Start Caddy first, then re-run this script as Administrator.
  pause
  exit /b 1
)

caddy trust
if errorlevel 1 (
  echo [FAIL] Could not install trust. Run this as Administrator.
  pause
  exit /b 1
)
echo.
echo [OK] Caddy local root CA is now trusted on this PC.
echo.
echo For a phone/tablet, copy this root cert to the device and install it:
echo   %%APPDATA%%\Caddy\pki\authorities\local\root.crt
pause
