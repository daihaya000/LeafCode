/** Resolve how the tray host should launch the WebUI. */
export function getWebLaunchPlan(mode, hasBuild) {
  const explicitProd = mode === 'prod';
  const explicitDev = mode === 'dev';
  return {
    needsBuild: explicitProd && !hasBuild,
    useProd: explicitProd || (!explicitDev && hasBuild),
  };
}

export function webRestartDelay(attempt) {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1;
  return Math.min(1000 * n, 5000);
}
