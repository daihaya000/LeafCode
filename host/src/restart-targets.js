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

/**
 * Stop targets for the WebUI: the union of the host-owned child PID and any
 * port listeners we can safely attribute to this host.
 *
 * The owned PID (the npm child we spawned) is always included — `taskkill /T`
 * on it covers listeners still inside its tree. But a `next start` that
 * survives a host crash can be reparented and keep holding the port *outside*
 * that tree, so we also add listening PIDs — yet only when
 * `isOwnedListener(pid)` confirms the process is ours (its command line matches
 * our web dir + `next start`). That guard keeps the union safe: an unrelated
 * app that happens to occupy the port is never killed.
 *
 * With no owned PID (reuse / leftover-listener case) there is no child tree to
 * attribute listeners to, so we fall back to the deduped listeners — matching
 * resolveKillPids — because the caller has already decided to reclaim the port.
 *
 * @param {{
 *   ownedPid?: number | null,
 *   listeningPids?: number[],
 *   isOwnedListener?: (pid: number) => boolean,
 * }} input
 * @returns {number[]}
 */
export function resolveWebKillPids(input) {
  const owned = Number(input.ownedPid);
  const hasOwned = Number.isFinite(owned) && owned > 0;
  const listening = Array.isArray(input.listeningPids) ? input.listeningPids : [];
  const isOwnedListener =
    typeof input.isOwnedListener === 'function' ? input.isOwnedListener : null;

  const targets = new Set();
  // The owned child is added first and unconditionally: even if the identifier
  // below throws, the caller still gets (and kills) the process it owns.
  if (hasOwned) targets.add(owned);
  for (const pid of listening) {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (targets.has(n)) continue;
    if (hasOwned) {
      // Only add listeners attributable to this host so an unrelated app on the
      // port is never killed. A throwing / missing identifier is treated as
      // "not owned" (safe) and must never abort the whole resolution.
      let ownedListener = false;
      try {
        ownedListener = isOwnedListener ? isOwnedListener(n) === true : false;
      } catch {
        ownedListener = false;
      }
      if (!ownedListener) continue;
    }
    // Without an owner we keep the existing fallback behaviour (all listeners).
    targets.add(n);
  }
  return [...targets];
}
