/**
 * Parse `netstat -ano` output for PIDs listening on a TCP port.
 * @param {string} output
 * @param {number} port
 * @returns {number[]}
 */
export function parseListeningPids(output, port) {
  const pids = new Set();
  const portSuffix = `:${port}`;
  for (const line of String(output).split(/\r?\n/)) {
    if (!/\bLISTENING\b/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[1] ?? '';
    const pid = Number(parts[parts.length - 1]);
    // Match 127.0.0.1:4096 / 0.0.0.0:4096 / [::1]:4096 — not :40960.
    if (
      Number.isFinite(pid) &&
      pid > 0 &&
      (local.endsWith(portSuffix) || local.endsWith(`]${portSuffix}`))
    ) {
      pids.add(pid);
    }
  }
  return [...pids];
}
