@echo off
:: Install Caddy's local root CA into the Windows trust store (one-time).
:: Run as Administrator so browsers stop warning about the local HTTPS cert.
setlocal
where caddy >nul 2>&1 || (echo [FAIL] caddy not found on PATH. & pause & exit /b 1)

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
