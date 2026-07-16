@echo off
:: Fix LAN access for OpenCode WebUI (port 3000)
:: Run as Administrator

echo [1] Set network profiles to Private...
powershell -NoProfile -Command "Get-NetConnectionProfile | ForEach-Object { try { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction Stop; Write-Host ('  OK Private: ' + $_.InterfaceAlias) } catch { Write-Host ('  SKIP ' + $_.InterfaceAlias + ': ' + $_.Exception.Message) } }"

echo [2] Allow TCP 3000 inbound...
netsh advfirewall firewall delete rule name="OpenCode WebUI" >nul 2>&1
netsh advfirewall firewall add rule name="OpenCode WebUI" dir=in action=allow protocol=TCP localport=3000 profile=any enable=yes
if errorlevel 1 (
  echo [FAIL] firewall port rule
) else (
  echo   OK port 3000
)

echo [3] Allow node.exe inbound...
netsh advfirewall firewall delete rule name="OpenCode WebUI Node" >nul 2>&1
netsh advfirewall firewall add rule name="OpenCode WebUI Node" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes profile=any
if errorlevel 1 (
  echo [FAIL] node.exe rule
) else (
  echo   OK node.exe
)

echo.
echo Current IPs / profiles:
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } | ForEach-Object { $p = Get-NetConnectionProfile -InterfaceAlias $_.InterfaceAlias -ErrorAction SilentlyContinue; Write-Host ('  ' + $_.IPAddress + '  ' + $_.InterfaceAlias + '  ' + $(if($p){$p.NetworkCategory}else{'?'})) }"

echo.
echo Use the IP that matches how the OTHER PC connects:
echo   Other PC on Wi-Fi  -^> http://192.168.0.192:3000
echo   Other PC on cable  -^> http://192.168.0.102:3000
echo.
echo If Surfshark is installed: Settings -^> Allow LAN / Disable Kill Switch while testing.
echo.
pause
