@echo off
:: Allow OpenCode WebUI via Caddy HTTPS (port 8443) through Windows Firewall.
netsh advfirewall firewall delete rule name="OpenCode WebUI Caddy HTTPS" >nul 2>&1
netsh advfirewall firewall add rule name="OpenCode WebUI Caddy HTTPS" dir=in action=allow protocol=TCP localport=8443 profile=any enable=yes
if errorlevel 1 (
  echo [FAIL] Could not add firewall rule. Run this as Administrator.
  pause
  exit /b 1
)
echo [OK] Firewall rule added: TCP 8443 inbound allow
echo Phone URL example:
echo   https://192.168.0.102:8443
pause
