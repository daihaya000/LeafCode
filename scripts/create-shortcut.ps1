# Creates a Desktop shortcut for OpenCode WebUI so it can be identified and
# pinned to the taskbar with a proper name and icon instead of a generic
# "cmd.exe" / "Command Prompt" entry.
#
# Windows removed the scriptable "pin to taskbar" verb (Windows 10 1809+), so
# pinning itself stays a manual, one-time step: right-click the shortcut this
# script creates and choose "Pin to taskbar" (or "Pin to Start" if that verb
# is not offered for a script-based target on your Windows build).
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

$shortcutPath = Join-Path $DesktopDir "OpenCode WebUI.lnk"
$targetPath = Join-Path $repoRoot "start-webui.bat"
if (-not (Test-Path -LiteralPath $targetPath)) {
    throw "Launcher not found: $targetPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = $iconPath
$shortcut.WindowStyle = 1
$shortcut.Description = "OpenCode WebUI"
$shortcut.Save()

Write-Output "SHORTCUT_PATH=$shortcutPath"
Write-Output "ICON_PATH=$iconPath"
