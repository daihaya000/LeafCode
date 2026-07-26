# OpenCode WebUI - system tray resident launcher (Windows).
#
# Starts `node host/src/index.js --headless` as a hidden child process and shows
# a tray icon. Double-click opens the Caddy URL (or the local WebUI URL as a
# fallback). No external dependencies: uses WinForms NotifyIcon shipped with the
# .NET Framework.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File host/src/tray.ps1
# or double-click start-webui.bat which invokes this script.
#
# IMPORTANT: This source file must remain pure ASCII. All Japanese UI strings
# are built at runtime from Unicode code points using New-JpString, so they
# display correctly without encoding problems while keeping the file ASCII-only.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Win32 Job Object: bind the child process so that if this tray process dies
# for ANY reason, the OS terminates the node child too. Prevents orphaned server
# processes holding ports.
Add-Type -Namespace Win32 -Name JobApi -MemberDefinition @'
[DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
[DllImport("user32.dll", SetLastError=true)]
public static extern bool DestroyIcon(IntPtr hIcon);
'@

$script:hJob = [Win32.JobApi]::CreateJobObject([IntPtr]::Zero, $null)
if ($script:hJob -ne [IntPtr]::Zero) {
    $infoSize = 144
    $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($infoSize)
    try {
        for ($o = 0; $o -lt $infoSize; $o++) { [System.Runtime.InteropServices.Marshal]::WriteByte($ptr, $o, 0) }
        [System.Runtime.InteropServices.Marshal]::WriteInt32($ptr, 16, 0x2000)
        [void][Win32.JobApi]::SetInformationJobObject($script:hJob, 9, $ptr, $infoSize)
    } finally {
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
    }
}

function Add-ToJob([System.Diagnostics.Process]$process) {
    if ($script:hJob -ne [IntPtr]::Zero -and $process -and -not $process.HasExited) {
        $assigned = [Win32.JobApi]::AssignProcessToJobObject($script:hJob, $process.Handle)
        if (-not $assigned -and $env:OW_TRAY_DEBUG) {
            $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            [Console]::Error.WriteLine("AssignProcessToJobObject failed: $err")
        }
    }
}

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Split-Path -Parent (Split-Path -Parent $scriptDir)
$hostDir    = Join-Path $repoRoot 'host'
$serverPath = Join-Path $hostDir 'src/index.js'

$bindHost   = if ($env:OPENCODE_WEBUI_HOST) { $env:OPENCODE_WEBUI_HOST } else { '127.0.0.1' }
$port       = if ($env:OPENCODE_WEBUI_PORT) { $env:OPENCODE_WEBUI_PORT } else { '3000' }
$caddyEnabled = $env:OPENCODE_WEBUI_CADDY -eq '1'
$controlPort = if ($env:OPENCODE_WEBUI_HOST_CONTROL_PORT) { $env:OPENCODE_WEBUI_HOST_CONTROL_PORT } else { '18765' }
$controlUrl = "http://127.0.0.1:${controlPort}"

function Resolve-Url {
    # Prefer the Caddy loopback HTTPS origin, then any Caddy public origin,
    # then the raw WebUI URL. This mirrors host/src/index.js resolveBrowserUrl.
    $caddyfile = if ($env:OPENCODE_WEBUI_CADDYFILE) { $env:OPENCODE_WEBUI_CADDYFILE } else { Join-Path $repoRoot 'deploy' 'Caddyfile' }
    $localUrl = $null
    $publicUrl = $null
    if ($caddyEnabled -and (Test-Path $caddyfile)) {
        $text = Get-Content $caddyfile -Raw -ErrorAction SilentlyContinue
        if ($text) {
            # parseCaddySiteUrls equivalent: top-level site blocks only.
            $urls = @()
            $depth = 0
            foreach ($rawLine in $text -split "`r?`n") {
                $line = ($rawLine -replace '#.*$', '').Trim()
                if (-not $line) { continue }
                if ($depth -eq 0 -and $line.EndsWith('{')) {
                    $head = $line.Substring(0, $line.Length - 1).Trim()
                    if ($head) {
                        foreach ($token in $head -split ',') {
                            $addr = $token.Trim()
                            if (-not $addr) { continue }
                            if ($addr -match '^https://([^\s{]+)') {
                                $urls += "https://$($matches[1])"
                            }
                        }
                    }
                }
                foreach ($ch in $line.ToCharArray()) {
                    if ($ch -eq '{') { $depth++ }
                    elseif ($ch -eq '}') { $depth = [Math]::Max(0, $depth - 1) }
                }
            }
            $localUrl = $urls | Where-Object { $_ -match '//127\.0\.0\.1(:|$)' } | Select-Object -First 1
            $publicUrl = $urls | Where-Object { $_ -notmatch '//(localhost|127\.0\.0\.1|\[::1\])(:|$)' } | Select-Object -First 1
            if (-not $publicUrl -and $urls.Length -gt 0) { $publicUrl = $urls[0] }
        }
    }

    # Probe whichever Caddy URL we have with a short timeout.
    function Test-HttpUp($url) {
        try {
            $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2
            return $r.StatusCode -eq 200
        } catch { return $false }
    }

    $probe = if ($localUrl) { $localUrl } else { $publicUrl }
    if ($probe -and (Test-HttpUp $probe)) {
        if ($localUrl) { return $localUrl }
        return $publicUrl
    }
    return "http://${bindHost}:${port}"
}

function Test-ServerUp {
    try {
        $r = Invoke-WebRequest "$controlUrl/health" -UseBasicParsing -TimeoutSec 1
        return $r.StatusCode -eq 200
    } catch { return $false }
}

$script:proc = $null

function Start-Host {
    if ($script:proc -and -not $script:proc.HasExited) { return }
    if (Test-ServerUp) {
        # Already running under another tray; just attach.
        return
    }
    if (-not (Test-Path $serverPath)) {
        [System.Windows.Forms.MessageBox]::Show("Host entry not found: $serverPath", 'OpenCode WebUI') | Out-Null
        exit 1
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName        = 'node'
    $psi.Arguments       = "`"$serverPath`" --headless"
    $psi.WorkingDirectory = $hostDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow  = $true
    $psi.WindowStyle     = 'Hidden'
    $psi.EnvironmentVariables['OPENCODE_WEBUI_NO_BROWSER'] = '1'
    $psi.EnvironmentVariables['AM_PARENT_PID'] = [System.Diagnostics.Process]::GetCurrentProcess().Id.ToString()
    $script:proc = [System.Diagnostics.Process]::Start($psi)
    Add-ToJob $script:proc
}

function Stop-Host {
    if ($script:proc -and -not $script:proc.HasExited) {
        try { $script:proc.Kill($true) } catch { try { $script:proc.Kill() } catch {} }
    }
    $script:proc = $null
}

function New-WebuiIcon {
    $size = 32
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $background = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 113, 227))
    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font ('Segoe UI', 10, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $hIcon = [IntPtr]::Zero
    $icon = $null
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
        $graphics.FillRectangle($background, $rect)
        $graphics.DrawString('>', $font, $textBrush, ([System.Drawing.RectangleF]$rect), $format)
        $hIcon = $bitmap.GetHicon()
        $icon = [System.Drawing.Icon]::FromHandle($hIcon)
        return $icon.Clone()
    } finally {
        if ($icon) { $icon.Dispose() }
        if ($hIcon -ne [IntPtr]::Zero) { [void][Win32.JobApi]::DestroyIcon($hIcon) }
        $format.Dispose()
        $font.Dispose()
        $textBrush.Dispose()
        $background.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function New-JpString {
    param([int[]]$CodePoints)
    return -join ($CodePoints | ForEach-Object { [char]$_ })
}

$jp = @{
    OpenCode       = New-JpString @(79,112,101,110,67,111,100,101,32,87,101,98,85,73)
    OpenMenu       = New-JpString @(31649,29702,30011,38754,12434,38283,12367)
    RestartMenu    = New-JpString @(12469,12540,12499,12473,12434,20877,36215,21205)
    QuitMenu       = New-JpString @(32066,20102)
    StatusRunning  = New-JpString @(12469,12540,12499,12473,58,32,31292,20685,20013)
    StatusStopped  = New-JpString @(12469,12540,12499,12458,58,32,20572,27490)
    Restarting     = New-JpString @(12469,12540,12499,12473,12434,20877,36215,21205,12375,12390,12356,12414,12377)
    Started        = New-JpString @(12469,12540,12499,12473,12434,36215,21205,12375,12414,12375,12383)
}

function Update-MenuState {
    param([System.Windows.Forms.ContextMenuStrip]$Menu)
    if (-not $Menu) { return }
    $statusItem = $Menu.Items | Where-Object { $_.Name -eq 'Status' }
    $restartItem = $Menu.Items | Where-Object { $_.Name -eq 'Restart' }
    if ($statusItem) {
        $statusItem.Text = if (Test-ServerUp) { $jp.StatusRunning } else { $jp.StatusStopped }
    }
    if ($restartItem) { $restartItem.Enabled = Test-ServerUp }
}

Start-Host

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Text = "$($jp.OpenCode)`n$controlUrl"
$script:trayIcon = New-WebuiIcon
$notify.Icon = $script:trayIcon
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$statusItem = $menu.Items.Add($jp.StatusRunning)
$statusItem.Name = 'Status'
$statusItem.Enabled = $false

$openItem = $menu.Items.Add($jp.OpenMenu)
$openItem.add_Click({ Start-Process (Resolve-Url) })

$restartItem = $menu.Items.Add($jp.RestartMenu)
$restartItem.Name = 'Restart'
$restartItem.add_Click({
    $notify.ShowBalloonTip(1500, $jp.OpenCode, $jp.Restarting, [System.Windows.Forms.ToolTipIcon]::Info)
    Stop-Host
    Start-Sleep -Milliseconds 400
    Start-Host
    Update-MenuState $menu
    $notify.ShowBalloonTip(1500, $jp.OpenCode, $jp.Started, [System.Windows.Forms.ToolTipIcon]::Info)
})

$menu.Items.Add('-') | Out-Null

Update-MenuState $menu

$quitItem = $menu.Items.Add($jp.QuitMenu)
$quitItem.add_Click({
    Stop-Host
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
# Left double-click opens the WebUI via the Caddy-aware URL.
$notify.add_MouseDoubleClick({ Start-Process (Resolve-Url) })

$notify.ShowBalloonTip(1500, $jp.OpenCode, $jp.Started, [System.Windows.Forms.ToolTipIcon]::Info)

$onExit = { Stop-Host }
[System.Windows.Forms.Application]::add_ApplicationExit($onExit)

# Poll service status so the menu reflects reality.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({ Update-MenuState $menu })
$timer.Start()

try {
    [System.Windows.Forms.Application]::Run()
}
finally {
    $timer.Stop()
    $timer.Dispose()
    Stop-Host
    if ($notify) { $notify.Visible = $false; $notify.Dispose() }
    if ($script:trayIcon) { $script:trayIcon.Dispose() }
}
