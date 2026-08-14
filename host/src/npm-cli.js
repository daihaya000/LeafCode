/**
 * npm CLI resolution and spawning for the host process
 * (REFACTORING_PLAN P6-a / IMPROVEMENT 4-1: Web build/start group).
 */
import { execFileSync, spawn } from 'child_process';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

let cachedNpmCli = null;

/** Test hook: forget the resolved npm CLI path so the next call re-resolves. */
export function __resetNpmCliCacheForTest() {
  cachedNpmCli = null;
}

/**
 * Run npm through its JavaScript CLI instead of a .cmd shell shim. This keeps
 * every argument separate and avoids Node's shell:true quoting vulnerability.
 */
export function spawnNpm(args, options, deps = {}) {
  const execFileSyncImpl = deps.execFileSync ?? execFileSync;
  const existsImpl = deps.existsSync ?? existsSync;
  const spawnImpl = deps.spawn ?? spawn;
  if (!cachedNpmCli) {
    const candidates = [
      process.env.npm_execpath,
      join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].filter(Boolean);

    try {
      const npmCommands = execFileSyncImpl('where.exe', ['npm.cmd'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const npmCommand of npmCommands) {
        candidates.push(
          join(dirname(npmCommand), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        );
      }
    } catch {
      // The normal Node-adjacent candidate above still covers standard installs.
    }

    cachedNpmCli = candidates.find((candidate) => existsImpl(candidate)) || null;
    if (!cachedNpmCli) {
      throw new Error('npm-cli.js was not found. Reinstall Node.js with npm included.');
    }
  }

  return spawnImpl(process.execPath, [cachedNpmCli, ...args], {
    ...options,
    shell: false,
  });
}
