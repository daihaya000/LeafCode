# Creates a Desktop shortcut for OpenCode WebUI so it can be identified and
# pinned to the taskbar with a proper name and icon instead of a generic
# "cmd.exe" / "Command Prompt" entry.
#
# Targets scripts\launcher\OpenCodeWebUI.exe (built by scripts\build-launcher.bat)
# when present, since Explorer only reliably offers "Pin to taskbar" for a
# shortcut whose target is a real .exe (support for a shortcut targeting a
# .bat/.cmd script directly is inconsistent across Windows builds). Falls
# back to start-webui.bat when the compiled launcher has not been built yet.
#
# Windows removed the scriptable "pin to taskbar" verb (Windows 10 1809+), so
# pinning itself stays a manual, one-time step: right-click the shortcut this
# script creates and choose "Pin to taskbar".
#
# Parameters exist so tests can point icon/shortcut output at a temp
# directory instead of touching the real Desktop / %APPDATA%.
param(
    [string]$DesktopDir = [Environment]::GetFolderPath("Desktop"),
    [string]$IconOutputDir = (Join-Path $env:APPDATA "opencode-webui")
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path -LiteralPath $IconOutputDir)) {
    New-Item -ItemType Directory -Path $IconOutputDir -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $DesktopDir)) {
    New-Item -ItemType Directory -Path $DesktopDir -Force | Out-Null
}

$iconJsonPath = Join-Path $repoRoot "host\src\icon.json"
if (-not (Test-Path -LiteralPath $iconJsonPath)) {
    throw "Icon source not found: $iconJsonPath (run 'node scripts/gen-icons.mjs' first)"
}

$iconPath = Join-Path $IconOutputDir "app.ico"
$iconJson = Get-Content -LiteralPath $iconJsonPath -Raw | ConvertFrom-Json
$iconBytes = [Convert]::FromBase64String($iconJson.base64)
[System.IO.File]::WriteAllBytes($iconPath, $iconBytes)

$exePath = Join-Path $repoRoot "scripts\launcher\OpenCodeWebUI.exe"
$batPath = Join-Path $repoRoot "start-webui.bat"

if (Test-Path -LiteralPath $exePath) {
    $targetPath = $exePath
    # The exe already carries the icon as an embedded Win32 resource (see
    # scripts\build-launcher.bat's /win32icon), so point the shortcut at it
    # directly rather than the standalone .ico copy above.
    $shortcutIconLocation = "$exePath,0"
} elseif (Test-Path -LiteralPath $batPath) {
    $targetPath = $batPath
    $shortcutIconLocation = $iconPath
} else {
    throw "Launcher not found: neither $exePath nor $batPath exists"
}

$shortcutPath = Join-Path $DesktopDir "OpenCode WebUI.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = $shortcutIconLocation
$shortcut.WindowStyle = 1
$shortcut.Description = "OpenCode WebUI"
$shortcut.Save()

Write-Output "SHORTCUT_PATH=$shortcutPath"
Write-Output "TARGET_PATH=$targetPath"
Write-Output "ICON_PATH=$iconPath"
