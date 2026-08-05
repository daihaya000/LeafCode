@echo off
rem KEEP THIS FILE ASCII-ONLY (bytes 0x00-0x7F, CRLF, no BOM).
rem See docs\specs\bat-encoding-safety.md
:: Allow OpenCode WebUI via Caddy HTTPS (port 8443) through Windows Firewall.
:: TCP only, on purpose. deploy\Caddyfile pins `protocols h1 h2`, so Caddy does
:: not open a QUIC/UDP listener and does not advertise Alt-Svc h3. Opening UDP
:: here would let phones cache an h3 endpoint that VPNs often drop, which
:: blackholes them with a blank page while this PC keeps working over TCP.
netsh advfirewall firewall delete rule name="OpenCode WebUI Caddy HTTPS" >nul 2>&1
netsh advfirewall firewall add rule name="OpenCode WebUI Caddy HTTPS" dir=in action=allow protocol=TCP localport=8443 profile=any enable=yes
if errorlevel 1 (
  echo [FAIL] Could not add firewall rule. Run this as Administrator.
  pause
  exit /b 1
)
echo [OK] Firewall rule added: TCP 8443 inbound allow
echo Phone URL example (replace with your PC's LAN IP from `ipconfig`):
echo   https://192.168.1.100:8443
pause
