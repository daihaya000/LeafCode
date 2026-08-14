# Creates a Desktop shortcut for LeafCode so it can be identified and
# pinned to the taskbar with a proper name and icon instead of a generic
# "cmd.exe" / "Command Prompt" entry.
#
# Targets LeafCode.exe at the repository root: the single entry point,
# committed to git and rebuilt by scripts\build-launcher.bat when its inputs
# are newer. Explorer only reliably offers "Pin to taskbar" for a shortcut
# whose target is a real .exe (support for a shortcut targeting a .bat/.cmd
# script directly is inconsistent across Windows builds). If the exe is
# missing for some reason, it is rebuilt before giving up.
#
# Windows removed the scriptable "pin to taskbar" verb (Windows 10 1809+), so
# pinning itself stays a manual, one-time step: right-click the shortcut this
# script creates and choose "Pin to taskbar".
#
# Parameters exist so tests can point icon/shortcut output at a temp
# directory instead of touching the real Desktop / %APPDATA%.
param(
    [string]$DesktopDir = [Environment]::GetFolderPath("Desktop"),
    [string]$IconOutputDir = (Join-Path $env:APPDATA "leafcode")
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

$exePath = Join-Path $repoRoot "LeafCode.exe"

if (-not (Test-Path -LiteralPath $exePath)) {
    # The exe is committed to git, so a missing copy means it was deleted
    # locally: rebuild it (quietly) before failing the shortcut creation.
    & cmd.exe /d /c "call `"$repoRoot\scripts\build-launcher.bat`" /quiet" | Out-Null
}
if (-not (Test-Path -LiteralPath $exePath)) {
    throw "Launcher not found: $exePath (run scripts\build-launcher.bat to build it)"
}

$targetPath = $exePath
# The exe already carries the icon as an embedded Win32 resource (see
# scripts\build-launcher.bat's /win32icon), so point the shortcut at it
# directly rather than the standalone .ico copy above.
$shortcutIconLocation = "$exePath,0"

$shortcutPath = Join-Path $DesktopDir "LeafCode.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = $shortcutIconLocation
$shortcut.WindowStyle = 1
$shortcut.Description = "LeafCode"
$shortcut.Save()

Write-Output "SHORTCUT_PATH=$shortcutPath"
Write-Output "TARGET_PATH=$targetPath"
Write-Output "ICON_PATH=$iconPath"
