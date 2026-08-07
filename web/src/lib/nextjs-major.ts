/**
 * Major-version lock for the Settings "Next.js を更新" flow.
 *
 * The production WebUI builds into a distDir outside the (OneDrive-synced)
 * repository — see scripts/web-dist-dir.mjs and web/src/lib/dist-dir.ts.
 * Next 16's Turbopack rejects a distDir that navigates out of the project
 * ("Invalid distDirRoot"), so `npm install next@latest` silently breaks every
 * production build. Until that migration is done deliberately, both the update
 * check and the install stay inside the currently installed major.
 */

/** Major number of a version string ("15.5.20" → 15); undefined when unparsable. */
export function majorOf(version: string | undefined): number | undefined {
  if (!version) return undefined;
  const match = version.replace(/^[^\d]*/, "").match(/^(\d+)/);
  if (!match) return undefined;
  const major = Number(match[1]);
  return Number.isFinite(major) ? major : undefined;
}

/** `next@15` — npm resolves it to the newest 15.x, never crossing the major. */
export function installSpecForMajor(major: number): string {
  return `next@${major}`;
}

/** Highest stable version within `major` from a registry version list. */
export function latestInMajor(versions: string[], major: number): string | undefined {
  let best: string | undefined;
  let bestParts: number[] = [];
  for (const version of versions) {
    // Skip pre-releases (canary / rc / preview): the button installs stable only.
    if (/[-+]/.test(version)) continue;
    if (majorOf(version) !== major) continue;
    const parts = version.split(".").map((part) => Number(part) || 0);
    if (!best || compareParts(parts, bestParts) > 0) {
      best = version;
      bestParts = parts;
    }
  }
  return best;
}

function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}
