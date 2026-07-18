/**
 * Prefer the host-owned child PID; otherwise fall back to listeners on the port
 * (reuse case where an earlier host left a healthy process running).
 * @param {{ ownedPid?: number | null, listeningPids?: number[] }} input
 * @returns {number[]}
 */
export function resolveKillPids(input) {
  const owned = Number(input.ownedPid);
  if (Number.isFinite(owned) && owned > 0) return [owned];
  const listening = Array.isArray(input.listeningPids) ? input.listeningPids : [];
  return [
    ...new Set(
      listening.filter((pid) => Number.isFinite(pid) && pid > 0),
    ),
  ];
}
