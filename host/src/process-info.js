/**
 * Windows process identity helpers for the host process
 * (REFACTORING_PLAN P6-a / IMPROVEMENT 4-1: process info group).
 */
import { runPowerShell } from './port-scanner.js';

export function getProcessCommandLine(pid) {
  try {
    const output = runPowerShell(
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`,
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}

/** Process creation time (Windows FILETIME as string), or null. */
export function getProcessCreationTime(pid) {
  try {
    const output = runPowerShell(
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CreationDate.ToFileTime()`,
    ).trim();
    return /^\d+$/.test(output) ? output : null;
  } catch {
    return null;
  }
}

/**
 * Whether the PID has a live systray helper child (tray_windows*.exe).
 * `null` means the CIM query failed; that is not proof that the tray is absent.
 */
export function hasTrayChild(pid) {
  try {
    const output = runPowerShell(
      `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${Number(pid)}' | Where-Object { $_.Name -like 'tray_windows*' }).Count`,
    ).trim();
    return Number.parseInt(output, 10) > 0;
  } catch {
    return null;
  }
}

export function looksLikeHostCommandLine(commandLine) {
  return (
    /node(\.exe)?"?\s/i.test(commandLine) &&
    /src[\\/]index\.js/i.test(commandLine)
  );
}

/**
 * Stricter identity check used when CreationDate is unavailable. Requires the
 * command line to reference the host directory or product name, not just any
 * node process running src/index.js (which could match unrelated apps).
 */
export function stronglyLooksLikeHostCommandLine(commandLine) {
  return (
    looksLikeHostCommandLine(commandLine) &&
    (/host[\\/]/i.test(commandLine) || /opencode-webui/i.test(commandLine))
  );
}
