import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import {
  getWebLaunchPlan,
  getPostBuildLaunchPlan,
  isWebBuildStale,
  decideWebReuseOnStale,
  webRestartDelay,
  webRestartSchedule,
  webHealthDecision,
  pullLatestGitSource,
} from './web-runtime.js';

test('prod mode rebuilds when BUILD_ID is absent', () => {
  assert.deepEqual(getWebLaunchPlan('prod', false), {
    needsBuild: true,
    useProd: true,
  });
  assert.deepEqual(getWebLaunchPlan('prod', true), {
    needsBuild: false,
    useProd: true,
  });
});

test('prod mode rebuilds when BUILD_ID exists but sources are newer', () => {
  assert.deepEqual(getWebLaunchPlan('prod', true, true), {
    needsBuild: true,
    useProd: true,
  });
  assert.deepEqual(getWebLaunchPlan('prod', true, false), {
    needsBuild: false,
    useProd: true,
  });
});

test('auto mode with existing build rebuilds when sources are newer', () => {
  assert.deepEqual(getWebLaunchPlan(undefined, true, true), {
    needsBuild: true,
    useProd: true,
  });
});

test('dev mode never rebuilds for start, even when sources are newer', () => {
  assert.deepEqual(getWebLaunchPlan('dev', true, true), {
    needsBuild: false,
    useProd: false,
  });
  assert.deepEqual(getWebLaunchPlan('dev', false, true), {
    needsBuild: false,
    useProd: false,
  });
});

test('dev and auto modes preserve their existing launch behavior', () => {
  assert.deepEqual(getWebLaunchPlan('dev', true), {
    needsBuild: false,
    useProd: false,
  });
  assert.deepEqual(getWebLaunchPlan(undefined, false), {
    needsBuild: false,
    useProd: false,
  });
  assert.deepEqual(getWebLaunchPlan(undefined, true), {
    needsBuild: false,
    useProd: true,
  });
});

test('getPostBuildLaunchPlan never re-requests a build after a fresh build, even if stale', () => {
  assert.deepEqual(getPostBuildLaunchPlan('prod', true, true), {
    needsBuild: false,
    useProd: true,
    staleAfterBuild: true,
  });
});

test('getPostBuildLaunchPlan still needs a build when BUILD_ID is missing', () => {
  assert.deepEqual(getPostBuildLaunchPlan('prod', false), {
    needsBuild: true,
    useProd: true,
    staleAfterBuild: false,
  });
});

test('getPostBuildLaunchPlan in auto mode reports staleAfterBuild without forcing a rebuild', () => {
  assert.deepEqual(getPostBuildLaunchPlan(undefined, true, true), {
    needsBuild: false,
    useProd: true,
    staleAfterBuild: true,
  });
});

test('getPostBuildLaunchPlan in dev mode never needs a build', () => {
  assert.deepEqual(getPostBuildLaunchPlan('dev', true, true), {
    needsBuild: false,
    useProd: false,
    staleAfterBuild: true,
  });
});

test('restart backoff is bounded', () => {
  assert.equal(webRestartDelay(1), 1000);
  assert.equal(webRestartDelay(3), 3000);
  assert.equal(webRestartDelay(99), 5000);
});

test('webRestartSchedule uses fast backoff within the burst limit', () => {
  assert.deepEqual(webRestartSchedule(1), { delayMs: 1000, coolingDown: false });
  assert.deepEqual(webRestartSchedule(2), { delayMs: 2000, coolingDown: false });
  assert.deepEqual(webRestartSchedule(5), { delayMs: 5000, coolingDown: false });
});

test('webRestartSchedule switches to a 60s cool-down just past the burst limit', () => {
  const result = webRestartSchedule(6);
  assert.equal(result.delayMs, 60_000);
  assert.equal(result.coolingDown, true);
});

test('webRestartSchedule keeps the same 60s cool-down far past the burst limit (never gives up)', () => {
  const result = webRestartSchedule(1000);
  assert.equal(result.delayMs, 60_000);
  assert.equal(result.coolingDown, true);
});

test('webRestartSchedule respects a custom maxBurst', () => {
  assert.deepEqual(webRestartSchedule(3, 3), { delayMs: 3000, coolingDown: false });
  assert.deepEqual(webRestartSchedule(4, 3), { delayMs: 60_000, coolingDown: true });
});

test('webRestartSchedule clamps invalid attempt to 1', () => {
  assert.deepEqual(webRestartSchedule(0), { delayMs: 1000, coolingDown: false });
  assert.deepEqual(webRestartSchedule(-5), { delayMs: 1000, coolingDown: false });
  assert.deepEqual(webRestartSchedule(NaN), { delayMs: 1000, coolingDown: false });
});

test('webHealthDecision tolerates startup failures and restarts after repeated failures', () => {
  assert.deepEqual(webHealthDecision({ httpUp: false, consecutiveFailures: 2, startedAt: 9_500, now: 10_000, startupGraceMs: 1_000 }), { consecutiveFailures: 0, shouldRestart: false });
  assert.deepEqual(webHealthDecision({ httpUp: false, consecutiveFailures: 2, startedAt: 0, now: 2_000, startupGraceMs: 1_000, failureLimit: 3 }), { consecutiveFailures: 3, shouldRestart: true });
  assert.deepEqual(webHealthDecision({ httpUp: true, consecutiveFailures: 99, startedAt: 0 }), { consecutiveFailures: 0, shouldRestart: false });
});

test('isWebBuildStale is false when BUILD_ID is missing', () => {
  const distDir = join('C:', 'appdata', 'opencode-webui', 'web-build');
  assert.equal(
    isWebBuildStale('/web', distDir, {
      existsSync: () => false,
    }),
    false,
  );
});

test('isWebBuildStale is true when a watched source is newer than BUILD_ID', () => {
  const webDir = join('C:', 'web');
  const distDir = join('C:', 'appdata', 'opencode-webui', 'web-build');
  const buildMs = Date.parse('2026-07-19T06:00:00.000Z');
  const sourceMs = Date.parse('2026-07-19T14:00:00.000Z');
  const files = new Map([
    [join(distDir, 'BUILD_ID'), { mtimeMs: buildMs }],
    [join(webDir, 'package.json'), { mtimeMs: buildMs }],
    [join(webDir, 'src', 'components', 'shell', 'Sidebar.tsx'), { mtimeMs: sourceMs }],
  ]);
  const dirs = new Map([
    [join(webDir, 'src'), ['components']],
    [join(webDir, 'src', 'components'), ['shell']],
    [join(webDir, 'src', 'components', 'shell'), ['Sidebar.tsx']],
  ]);

  assert.equal(
    isWebBuildStale(webDir, distDir, {
      existsSync: (p) => files.has(p) || dirs.has(p),
      statSync: (p) => {
        if (dirs.has(p)) return { isDirectory: () => true, isFile: () => false, mtimeMs: 0 };
        const entry = files.get(p);
        if (!entry) throw new Error(`missing ${p}`);
        return { isDirectory: () => false, isFile: () => true, mtimeMs: entry.mtimeMs };
      },
      readdirSync: (p) => dirs.get(p) ?? [],
    }),
    true,
  );
});

test('isWebBuildStale is false when sources are older than BUILD_ID', () => {
  const webDir = join('C:', 'web');
  const distDir = join('C:', 'appdata', 'opencode-webui', 'web-build');
  const buildMs = Date.parse('2026-07-19T14:00:00.000Z');
  const sourceMs = Date.parse('2026-07-19T06:00:00.000Z');
  const files = new Map([
    [join(distDir, 'BUILD_ID'), { mtimeMs: buildMs }],
    [join(webDir, 'package.json'), { mtimeMs: sourceMs }],
    [join(webDir, 'src', 'app', 'page.tsx'), { mtimeMs: sourceMs }],
  ]);
  const dirs = new Map([
    [join(webDir, 'src'), ['app']],
    [join(webDir, 'src', 'app'), ['page.tsx']],
  ]);

  assert.equal(
    isWebBuildStale(webDir, distDir, {
      existsSync: (p) => files.has(p) || dirs.has(p),
      statSync: (p) => {
        if (dirs.has(p)) return { isDirectory: () => true, isFile: () => false, mtimeMs: 0 };
        const entry = files.get(p);
        if (!entry) throw new Error(`missing ${p}`);
        return { isDirectory: () => false, isFile: () => true, mtimeMs: entry.mtimeMs };
      },
      readdirSync: (p) => dirs.get(p) ?? [],
    }),
    false,
  );
});


test('decideWebReuseOnStale: no reuse means start fresh (spawnWeb rebuilds)', () => {
  assert.deepEqual(
    decideWebReuseOnStale({ reuse: false, mode: 'prod', hasBuild: true, buildStale: true, ownedListenerPids: [123] }),
    { reuse: false },
  );
});

test('decideWebReuseOnStale: reuse a current (non-stale) prod build as-is', () => {
  assert.deepEqual(
    decideWebReuseOnStale({ reuse: true, mode: 'prod', hasBuild: true, buildStale: false, ownedListenerPids: [123] }),
    { reuse: true },
  );
});

test('decideWebReuseOnStale: take over a stale build only when the listener is ours', () => {
  assert.deepEqual(
    decideWebReuseOnStale({ reuse: true, mode: 'prod', hasBuild: true, buildStale: true, ownedListenerPids: [42612] }),
    { reuse: false, takeover: [42612] },
  );
});

test('decideWebReuseOnStale: never take over an unknown listener, even when stale', () => {
  assert.deepEqual(
    decideWebReuseOnStale({ reuse: true, mode: 'prod', hasBuild: true, buildStale: true, ownedListenerPids: [] }),
    { reuse: true, reason: 'unknown-listener' },
  );
});

test('decideWebReuseOnStale: rebuild a missing build by taking over our listener', () => {
  assert.deepEqual(
    decideWebReuseOnStale({ reuse: true, mode: 'prod', hasBuild: false, buildStale: false, ownedListenerPids: [99] }),
    { reuse: false, takeover: [99] },
  );
});

test('decideWebReuseOnStale: dev mode never takes over (no build needed)', () => {
  assert.deepEqual(
    decideWebReuseOnStale({ reuse: true, mode: 'dev', hasBuild: true, buildStale: true, ownedListenerPids: [1] }),
    { reuse: true },
  );
});

test('pullLatestGitSource: no .git is a silent no-op', async () => {
  const result = await pullLatestGitSource('/nope', {
    existsSync: () => false,
    execFileAsync: async () => { throw new Error('should not be called'); },
  });
  assert.deepEqual(result, { attempted: false });
});

test('pullLatestGitSource: success returns ok with stdout', async () => {
  const calls = [];
  const result = await pullLatestGitSource('/repo', {
    existsSync: (p) => p === join('/repo', '.git'),
    execFileAsync: async (file, args, opts) => {
      calls.push({ file, args, cwd: opts?.cwd });
      return { stdout: 'Updating abc..def\nFast-forward\n', stderr: '' };
    },
  });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, true);
  assert.equal(result.stdout, 'Updating abc..def\nFast-forward\n');
  assert.deepEqual(calls, [{ file: 'git', args: ['pull', '--ff-only'], cwd: '/repo' }]);
});

test('pullLatestGitSource: Already up to date is ok', async () => {
  const result = await pullLatestGitSource('/repo', {
    existsSync: () => true,
    execFileAsync: async () => ({ stdout: 'Already up to date.\n', stderr: '' }),
  });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, true);
  assert.equal(result.stdout, 'Already up to date.\n');
});

test('pullLatestGitSource: rejected exec returns ok=false without throwing', async () => {
  const result = await pullLatestGitSource('/repo', {
    existsSync: () => true,
    execFileAsync: async () => { throw new Error('fatal: not a git repository'); },
  });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'fatal: not a git repository');
});

test('pullLatestGitSource: missing execFileAsync returns ok=false', async () => {
  const result = await pullLatestGitSource('/repo', { existsSync: () => true });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'execFileAsync not provided');
});

test('pullLatestGitSource: passes GIT_TERMINAL_PROMPT=0 and windowsHide', async () => {
  let observed;
  await pullLatestGitSource('/repo', {
    existsSync: () => true,
    execFileAsync: async (_f, _a, opts) => {
      observed = opts;
      return { stdout: '', stderr: '' };
    },
  });
  assert.equal(observed.windowsHide, true);
  assert.equal(observed.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(Number.isFinite(observed.timeout), true);
});
