@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM).
rem See docs\specs\bat-encoding-safety.md
:: Install Caddy's local root CA into the Windows trust store (one-time).
:: Run as Administrator so browsers stop warning about the local HTTPS cert.
::
:: NOTE: Caddy must be RUNNING first. `caddy trust` fetches the CA from the
:: admin API (localhost:2019); if Caddy is stopped it fails with a connection
:: error. Start the WebUI (LeafCode.exe with LEAFCODE_CADDY=1) or run
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
echo Other devices (phone / tablet / another PC) still warn until they trust
echo the same CA. Open this URL on the device and install the certificate:
echo   http://^<this-PC-LAN-IP^>:8080/caddy-root.crt
echo   ^(run scripts\allow-firewall-8080.bat once to open the port^)
echo Local copy of the same file:
echo   %%APPDATA%%\Caddy\pki\authorities\local\root.crt
echo See the README HTTPS section for per-OS install steps.
pause
