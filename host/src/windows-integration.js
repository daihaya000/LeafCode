/**
 * Windows integration helpers for the host process
 * (REFACTORING_PLAN P6-a / IMPROVEMENT 4-1: Windows integration group).
 * Voice input hotkey and the Firewall inbound rule for the WebUI port.
 */
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function launchWindowsVoiceInput() {
  if (process.platform !== 'win32') {
    throw new Error('Windows voice input is only available on Windows');
  }
  const script = `
$signature = '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
Add-Type -MemberDefinition $signature -Name Keyboard -Namespace Win32
[Win32.Keyboard]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event(0x48, 0, 2, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)
`;
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

/** Windows Firewall inbound rule name shared with scripts/allow-firewall-3000.bat. */
const FIREWALL_RULE_NAME = 'OpenCode WebUI';

/** True when a Windows Firewall inbound rule with FIREWALL_RULE_NAME exists.
 *  Read-only; does not require elevation. */
export function firewallRuleExists() {
  try {
    execFileSync(
      'netsh',
      ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE_NAME}`],
      { stdio: 'ignore', windowsHide: true },
    );
    return true;
  } catch {
    return false;
  }
}

/** Adds an inbound TCP allow rule for the WebUI port via an elevated (UAC)
 *  subprocess, so LAN/phone clients can reach it without a manual .bat run.
 *  Returns immediately (no UAC prompt) when the rule already exists. Throws
 *  if the user cancels the UAC prompt or the elevated command fails.
 *  Windows only — the WebUI itself never runs netsh directly. */
export async function allowFirewallPort(webuiPort) {
  if (process.platform !== 'win32') {
    throw new Error('ファイアウォール設定は Windows でのみ対応しています');
  }
  if (firewallRuleExists()) {
    return { alreadyExists: true, port: webuiPort };
  }
  const script = `
$fwArgs = @('advfirewall','firewall','add','rule','name=${FIREWALL_RULE_NAME}','dir=in','action=allow','protocol=TCP','localport=${webuiPort}','profile=any','enable=yes')
$p = Start-Process -FilePath netsh -ArgumentList $fwArgs -Verb RunAs -Wait -PassThru
exit $p.ExitCode
`;
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 60000 },
    );
  } catch (err) {
    throw new Error(
      `ファイアウォールルールの追加に失敗しました（UAC の確認をキャンセルした可能性があります）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { alreadyExists: false, port: webuiPort };
}