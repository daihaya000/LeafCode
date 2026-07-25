@echo off
:: Allow OpenCode WebUI via Caddy (port 8080) through Windows Firewall for phone/LAN access.
netsh advfirewall firewall delete rule name="OpenCode WebUI Caddy" >nul 2>&1
netsh advfirewall firewall add rule name="OpenCode WebUI Caddy" dir=in action=allow protocol=TCP localport=8080 profile=any enable=yes
if errorlevel 1 (
  echo [FAIL] Could not add firewall rule. Run this as Administrator.
  pause
  exit /b 1
)
echo [OK] Firewall rule added: TCP 8080 inbound allow
echo Port 8080 serves Caddy's root CA so other devices can trust the local
echo HTTPS cert. Open this on the phone/PC (use your LAN IP from `ipconfig`):
echo   http://192.168.1.100:8080/caddy-root.crt
pause
