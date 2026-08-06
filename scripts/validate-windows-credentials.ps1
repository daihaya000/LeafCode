# Validate a Windows account's username/password.
#
# Credentials arrive on stdin as exactly two UTF-8 lines (username, password)
# so the password never appears in the process command line, where any local
# user could read it via `wmic process get commandline` or Task Manager.
#
# Writes exactly one line to stdout:
#   VALID          credentials are correct and the account may log on
#   INVALID        credentials are wrong, or the account is disabled/locked/expired
#   ERROR:<text>   validation could not be performed
#
# Uses the Win32 LogonUser API rather than
# System.DirectoryServices.AccountManagement.ValidateCredentials: the latter
# takes ~14s to reject an unknown local account on a non-domain machine, while
# LogonUser answers in ~15ms and reports precisely why a logon was refused.
#
# ASCII only: this file is read by Windows PowerShell under whatever code page
# the caller happens to have, so non-ASCII bytes here would be mis-decoded.

$ErrorActionPreference = 'Stop'

# Force UTF-8 on stdout so non-ASCII error text survives the pipe.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

try {
    # Decode stdin as UTF-8 explicitly. Relying on the console code page would
    # corrupt non-ASCII usernames and passwords.
    $stdin = New-Object System.IO.StreamReader(
        [Console]::OpenStandardInput(),
        (New-Object System.Text.UTF8Encoding($false))
    )
    $userName = $stdin.ReadLine()
    $password = $stdin.ReadLine()
} catch {
    Write-Output ('ERROR:stdin read failed: ' + $_.Exception.Message)
    exit 0
}

if ([string]::IsNullOrWhiteSpace($userName) -or [string]::IsNullOrEmpty($password)) {
    # A blank password must never authenticate, even where Windows would allow
    # it for a local interactive logon.
    Write-Output 'INVALID'
    exit 0
}

$machine = $env:COMPUTERNAME
$domain = $machine
$name = $userName

if ($userName.Contains('\')) {
    $parts = $userName.Split([char]'\', 2)
    $domain = $parts[0]
    $name = $parts[1]
    if ($domain -eq '.' -or $domain -eq 'localhost') { $domain = $machine }
} elseif ($userName.Contains('@')) {
    # A UPN must be passed whole, with a null domain.
    $name = $userName
    $domain = $null
}

if ([string]::IsNullOrWhiteSpace($name)) {
    Write-Output 'INVALID'
    exit 0
}

try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OcwLogon {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool LogonUser(
        string lpszUsername, string lpszDomain, string lpszPassword,
        int dwLogonType, int dwLogonProvider, out IntPtr phToken);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
'@
} catch {
    Write-Output ('ERROR:LogonUser binding failed: ' + $_.Exception.Message)
    exit 0
}

$LOGON32_LOGON_INTERACTIVE = 2
$LOGON32_LOGON_NETWORK = 3
$LOGON32_PROVIDER_DEFAULT = 0

# Credential errors: the answer is a definite "no", not a malfunction.
#   1326 ERROR_LOGON_FAILURE       1327 ERROR_ACCOUNT_RESTRICTION
#   1330 ERROR_PASSWORD_EXPIRED    1331 ERROR_ACCOUNT_DISABLED
#   1793 ERROR_ACCOUNT_EXPIRED     1907 ERROR_PASSWORD_MUST_CHANGE
#   1909 ERROR_ACCOUNT_LOCKED_OUT
$denied = @(1326, 1327, 1330, 1331, 1793, 1907, 1909)

function Invoke-Logon {
    param([string] $User, [string] $Domain, [string] $Password, [int] $LogonType)
    $token = [IntPtr]::Zero
    $ok = [OcwLogon]::LogonUser($User, $Domain, $Password, $LogonType, $LOGON32_PROVIDER_DEFAULT, [ref] $token)
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($token -ne [IntPtr]::Zero) { [void][OcwLogon]::CloseHandle($token) }
    return [pscustomobject]@{ Ok = $ok; Code = $code }
}

try {
    # Network logon is the cheapest check and never touches the user profile.
    $result = Invoke-Logon -User $name -Domain $domain -Password $password -LogonType $LOGON32_LOGON_NETWORK

    # 1385 ERROR_LOGON_TYPE_NOT_GRANTED: the account is denied "Access this
    # computer from the network" but may still be a valid interactive user.
    if (-not $result.Ok -and $result.Code -eq 1385) {
        $result = Invoke-Logon -User $name -Domain $domain -Password $password -LogonType $LOGON32_LOGON_INTERACTIVE
    }

    if ($result.Ok) {
        Write-Output 'VALID'
    } elseif ($denied -contains $result.Code) {
        Write-Output 'INVALID'
    } else {
        $message = (New-Object System.ComponentModel.Win32Exception($result.Code)).Message
        Write-Output ('ERROR:LogonUser failed with ' + $result.Code + ': ' + $message)
    }
} catch {
    Write-Output ('ERROR:' + $_.Exception.Message)
}
