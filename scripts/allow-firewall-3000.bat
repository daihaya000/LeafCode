@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM).
rem See docs\specs\bat-encoding-safety.md
:: Allow OpenCode WebUI (port 3000) through Windows Firewall for phone/LAN access.
netsh advfirewall firewall delete rule name="OpenCode WebUI" >nul 2>&1
netsh advfirewall firewall add rule name="OpenCode WebUI" dir=in action=allow protocol=TCP localport=3000 profile=any enable=yes
if errorlevel 1 (
  echo [FAIL] Could not add firewall rule. Run this as Administrator.
  pause
  exit /b 1
)
echo [OK] Firewall rule added: TCP 3000 inbound allow
echo Phone URL example (replace with your PC's LAN IP from `ipconfig`):
echo   http://192.168.1.100:3000
pause
