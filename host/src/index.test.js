import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as host from './index.js';
import {
  isHeadless,
  pickBrowserUrl,
  resetOpencodeRestartBudget,
  resetCaddyRestartBudget,
  shouldRestartOpencode,
  shouldRestartCaddy,
} from './index.js';

test('isHeadless returns true for OPENCODE_HEADLESS=1', () => {
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.LEAFCODE_HEADLESS;
  process.env.OPENCODE_HEADLESS = '1';
  delete process.env.LEAFCODE_HEADLESS;
  try {
    assert.equal(isHeadless(), true);
  } finally {
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.LEAFCODE_HEADLESS;
    else process.env.LEAFCODE_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns true when --headless flag is present', () => {
  const previousArgv = process.argv;
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.LEAFCODE_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  delete process.env.LEAFCODE_HEADLESS;
  process.argv = ['node', 'src/index.js', '--headless'];
  try {
    assert.equal(isHeadless(), true);
  } finally {
    process.argv = previousArgv;
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.LEAFCODE_HEADLESS;
    else process.env.LEAFCODE_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns false by default', () => {
  const previousArgv = process.argv;
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.LEAFCODE_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  delete process.env.LEAFCODE_HEADLESS;
  process.argv = ['node', 'src/index.js'];
  try {
    assert.equal(isHeadless(), false);
  } finally {
    process.argv = previousArgv;
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.LEAFCODE_HEADLESS;
    else process.env.LEAFCODE_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns true for LEAFCODE_HEADLESS=1', () => {
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.LEAFCODE_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  process.env.LEAFCODE_HEADLESS = '1';
  try {
    assert.equal(isHeadless(), true);
  } finally {
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.LEAFCODE_HEADLESS;
    else process.env.LEAFCODE_HEADLESS = previousWebuiHeadless;
  }
});

test('shouldRestartOpencode returns false when restart budget exhausted', () => {
  resetOpencodeRestartBudget();
  assert.equal(shouldRestartOpencode(0), true);
  assert.equal(shouldRestartOpencode(1), true);
  assert.equal(shouldRestartOpencode(2), true);
  assert.equal(shouldRestartOpencode(3), false);
});

test('shouldRestartOpencode resets after 5 minutes', () => {
  resetOpencodeRestartBudget();
  assert.equal(shouldRestartOpencode(0), true);
  assert.equal(shouldRestartOpencode(1), true);
  assert.equal(shouldRestartOpencode(2), true);
  assert.equal(shouldRestartOpencode(3), false);
  assert.equal(shouldRestartOpencode(5 * 60 * 1000), true);
});

test('shouldRestartCaddy returns false when restart budget exhausted', () => {
  resetCaddyRestartBudget();
  assert.equal(shouldRestartCaddy(0), true);
  assert.equal(shouldRestartCaddy(1), true);
  assert.equal(shouldRestartCaddy(2), true);
  assert.equal(shouldRestartCaddy(3), false);
});

test('shouldRestartCaddy resets after 5 minutes', () => {
  resetCaddyRestartBudget();
  assert.equal(shouldRestartCaddy(0), true);
  assert.equal(shouldRestartCaddy(1), true);
  assert.equal(shouldRestartCaddy(2), true);
  assert.equal(shouldRestartCaddy(3), false);
  assert.equal(shouldRestartCaddy(5 * 60 * 1000), true);
});

test('stronglyLooksLikeHostCommandLine rejects unrelated node processes', () => {
  // Basic host cmdline matches looksLikeHostCommandLine
  assert.equal(
    host.stronglyLooksLikeHostCommandLine(
      '"C:\\Program Files\\nodejs\\node.exe" "C:/src/index.js"',
    ),
    false, // no host/ or opencode-webui in path
  );
  // Host directory reference makes it strongly match
  assert.equal(
    host.stronglyLooksLikeHostCommandLine(
      '"C:\\Program Files\\nodejs\\node.exe" "C:/host/src/index.js"',
    ),
    true,
  );
  // Product name reference also matches
  assert.equal(
    host.stronglyLooksLikeHostCommandLine(
      'node.exe "C:/projects/leafcode/src/index.js"',
    ),
    true,
  );
  // Non-host node process does not match
  assert.equal(
    host.stronglyLooksLikeHostCommandLine(
      'node.exe "C:/other-app/src/index.js"',
    ),
    false,
  );
});

test('isOurCaddyCommandLine matches only our Caddyfile', () => {
  const ours = 'C:\\LeafCode\\deploy\\Caddyfile';
  assert.equal(
    host.isOurCaddyCommandLine(
      `caddy.exe run --config ${ours} --adapter caddyfile`,
      ours,
    ),
    true,
  );
  assert.equal(
    host.isOurCaddyCommandLine(
      'caddy.exe run --config C:\\other\\Caddyfile --adapter caddyfile',
      ours,
    ),
    false,
  );
  assert.equal(host.isOurCaddyCommandLine(null, ours), false);
});

function getOpencodeExitDecision(options) {
  assert.equal(
    typeof host.getOpencodeExitDecision,
    'function',
    'getOpencodeExitDecision should be exported from production code for pure exit-decision testing',
  );
  return host.getOpencodeExitDecision(options);
}

test('getOpencodeExitDecision does not auto-restart after a planned OpenCode stop', () => {
  assert.deepEqual(
    getOpencodeExitDecision({
      quitting: false,
      exitedPid: 1234,
      currentPid: 1234,
      isPlannedExit: true,
      restartBudgetAvailable: true,
    }),
    {
      shouldReapPortHolders: false,
      shouldAutoRestart: false,
      logMessages: [],
    },
  );
});

test('getOpencodeExitDecision does not auto-restart when an old OpenCode process exits', () => {
  assert.deepEqual(
    getOpencodeExitDecision({
      quitting: false,
      exitedPid: 1234,
      currentPid: 5678,
      isPlannedExit: false,
      restartBudgetAvailable: true,
    }),
    {
      shouldReapPortHolders: false,
      shouldAutoRestart: false,
      logMessages: [],
    },
  );
});

test('getOpencodeExitDecision logs only manual host restart required when restart budget is exhausted', () => {
  assert.deepEqual(
    getOpencodeExitDecision({
      quitting: false,
      exitedPid: 1234,
      currentPid: 1234,
      isPlannedExit: false,
      restartBudgetAvailable: false,
    }),
    {
      shouldReapPortHolders: true,
      shouldAutoRestart: false,
      logMessages: [
        {
          level: 'error',
          message:
            'OpenCode restart budget exhausted (3/5min) — manual host restart required',
        },
      ],
    },
  );
});

test('parseCaddyPublicUrl prefers a routable HTTPS site address', () => {
  const caddyfile = `{
	admin localhost:2019
	skip_install_trust
}

https://localhost:8443, https://127.0.0.1:8443, https://192.168.0.102:8443 {
	tls internal
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
}
`;
  assert.equal(host.parseCaddyPublicUrl(caddyfile), 'https://192.168.0.102:8443');
});

test('parseCaddyPublicUrl skips the example-hostname placeholder', () => {
  const caddyfile = `https://localhost:8443, https://127.0.0.1:8443, https://example-hostname:8443, https://192.168.0.102:8443 {
	tls internal
	reverse_proxy 127.0.0.1:3000
}
`;
  assert.equal(host.parseCaddyPublicUrl(caddyfile), 'https://192.168.0.102:8443');
});

test('parseCaddyLoopbackUrl prefers 127.0.0.1 over localhost', () => {
  const caddyfile = `https://localhost:8443, https://127.0.0.1:8443, https://192.168.0.102:8443 {
	tls internal
	reverse_proxy 127.0.0.1:3000
}
`;
  assert.equal(host.parseCaddyLoopbackUrl(caddyfile), 'https://127.0.0.1:8443');
});

test('parseCaddyPublicUrl falls back to localhost when only loopback is present', () => {
  const caddyfile = `https://localhost:8443 {
	tls internal
	reverse_proxy 127.0.0.1:3000
}
`;
  assert.equal(host.parseCaddyPublicUrl(caddyfile), 'https://localhost:8443');
});

test('parseCaddyPublicUrl ignores commented site addresses and http-only blocks', () => {
  const caddyfile = `# https://commented.example.com {
:8080 {
	reverse_proxy 127.0.0.1:3000
}
`;
  assert.equal(host.parseCaddyPublicUrl(caddyfile), null);
});

test('parseCaddyPublicUrl treats a bare domain as auto-HTTPS', () => {
  // A bare domain (webui.example.com {) implies Caddy auto-HTTPS.
  const caddyfile = `webui.example.com {
	reverse_proxy 127.0.0.1:3000
}
`;
  assert.equal(host.parseCaddyPublicUrl(caddyfile), 'https://webui.example.com');
});

test('pickBrowserUrl prefers loopback Caddy over LAN Caddy', () => {
  assert.equal(
    pickBrowserUrl({
      caddyLocalUrl: 'https://127.0.0.1:8443',
      caddyUrl: 'https://192.168.0.102:8443',
      webuiUrl: 'http://127.0.0.1:3000',
      caddyUp: true,
    }),
    'https://127.0.0.1:8443',
  );
});

test('pickBrowserUrl falls back to public Caddy when no loopback site', () => {
  assert.equal(
    pickBrowserUrl({
      caddyLocalUrl: null,
      caddyUrl: 'https://192.168.0.102:8443',
      webuiUrl: 'http://127.0.0.1:3000',
      caddyUp: true,
    }),
    'https://192.168.0.102:8443',
  );
});

test('pickBrowserUrl falls back to WebUI URL when Caddy is down', () => {
  assert.equal(
    pickBrowserUrl({
      caddyLocalUrl: 'https://127.0.0.1:8443',
      caddyUrl: 'https://192.168.0.102:8443',
      webuiUrl: 'http://127.0.0.1:3000',
      caddyUp: false,
    }),
    'http://127.0.0.1:3000',
  );
});

test('pickBrowserUrl falls back to WebUI URL when Caddy is disabled (null)', () => {
  assert.equal(
    pickBrowserUrl({
      caddyLocalUrl: null,
      caddyUrl: null,
      webuiUrl: 'http://127.0.0.1:3000',
      caddyUp: false,
    }),
    'http://127.0.0.1:3000',
  );
});

test('parseCommandLineJson maps a JSON array of processes', () => {
  const map = host.parseCommandLineJson(
    '[{"ProcessId":111,"CommandLine":"node next start"},{"ProcessId":222,"CommandLine":"other"}]',
  );
  assert.deepEqual(map, new Map([[111, 'node next start'], [222, 'other']]));
});

test('parseCommandLineJson accepts a single (non-array) object', () => {
  const map = host.parseCommandLineJson('{"ProcessId":333,"CommandLine":"next start"}');
  assert.deepEqual(map, new Map([[333, 'next start']]));
});

test('parseCommandLineJson returns an empty map for unusable output', () => {
  // Empty/whitespace, JSON null (empty CIM result), invalid JSON, and non-string
  // inputs all yield an empty map so callers identify nothing (safe side).
  assert.deepEqual(host.parseCommandLineJson(''), new Map());
  assert.deepEqual(host.parseCommandLineJson('   '), new Map());
  assert.deepEqual(host.parseCommandLineJson('null'), new Map());
  assert.deepEqual(host.parseCommandLineJson('not json'), new Map());
  assert.deepEqual(host.parseCommandLineJson(null), new Map());
  assert.deepEqual(host.parseCommandLineJson(undefined), new Map());
});

test('parseCommandLineJson skips rows with invalid PID or missing command line', () => {
  const map = host.parseCommandLineJson(
    '[{"ProcessId":0,"CommandLine":"x"},{"ProcessId":-1,"CommandLine":"x"},' +
      '{"ProcessId":"abc","CommandLine":"x"},{"ProcessId":444,"CommandLine":null},' +
      '{"ProcessId":555},{"ProcessId":666,"CommandLine":"next start"},null]',
  );
  assert.deepEqual(map, new Map([[666, 'next start']]));
});


test('repairNpmOpencodeStub does nothing for a real PE binary', () => {
  assert.equal(
    host.repairNpmOpencodeStub('C:\\bin\\opencode.exe', { isPe: () => true }),
    null,
  );
});

test('repairNpmOpencodeStub does nothing when the shim has no npm sibling', () => {
  const io = { existsSync: () => false, isPe: () => false };
  assert.equal(host.repairNpmOpencodeStub('C:\\tools\\opencode.cmd', io), null);
});

test('repairNpmOpencodeStub runs postinstall when the sibling exe is a stub', () => {
  let ran = false;
  let stub = true;
  const io = {
    existsSync: (p) => p.endsWith('postinstall.mjs'),
    isPe: () => !stub,
    runPostinstall: () => { ran = true; stub = false; },
  };
  const repaired = host.repairNpmOpencodeStub('C:\\npm\\opencode.cmd', io);
  assert.equal(ran, true);
  assert.match(repaired, /opencode-ai\\bin\\opencode\.exe$/);
});

test('repairNpmOpencodeStub returns null when postinstall leaves a stub', () => {
  const io = { existsSync: () => true, isPe: () => false, runPostinstall: () => {} };
  assert.equal(host.repairNpmOpencodeStub('C:\\npm\\opencode.cmd', io), null);
});

test('repairNpmOpencodeStub returns null when postinstall throws', () => {
  const io = {
    existsSync: () => true,
    isPe: () => false,
    runPostinstall: () => { throw new Error('boom'); },
  };
  assert.equal(host.repairNpmOpencodeStub('C:\\npm\\opencode.cmd', io), null);
});

test('index.js imports process-stop helpers that cold start still calls', () => {
  const src = readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8');
  const block = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/process-stop\.js['"]/);
  assert.ok(block, 'index.js must import from process-stop.js');
  const imported = new Set(
    block[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const name of ['isProcessAlive', 'stopOpencodeProcessTree', 'reapOpencodePortHolders']) {
    assert.equal(
      imported.has(name),
      true,
      `${name} must be imported from process-stop.js (missing import crashes EXE startup)`,
    );
  }
});

test('index.js constructs factories that cold start calls as instances', () => {
  const src = readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8');
  for (const [factory, instance] of [
    ['createHttpWaiter', 'httpWaiter'],
    ['createOpencodeUpgrader', 'opencodeUpgrader'],
    ['createBrowserBridgeManager', 'browserBridgeManager'],
  ]) {
    assert.match(
      src,
      new RegExp(`${instance}\\s*=\\s*${factory}\\(`),
      `${instance} must be created with ${factory}(...) or EXE startup throws ReferenceError`,
    );
    assert.match(src, new RegExp(`\\b${instance}\\.\\w+`), `${instance} is still called`);
  }
});

test('resolveOccupiedPort waits out ghost sockets before falling back', () => {
  const src = readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8');
  const ghostGrace = src.match(/const GHOST_SOCKET_GRACE_MS = (\d+);/);
  assert.ok(ghostGrace, 'GHOST_SOCKET_GRACE_MS must exist (prevents port drift on transient ghosts)');
  assert.equal(Number(ghostGrace[1]) > 0, true, 'GHOST_SOCKET_GRACE_MS must be positive');
  assert.match(
    src,
    /is held by a ghost socket/,
    'resolveOccupiedPort must log when it detects a ghost socket',
  );
  assert.match(
    src,
    /waiting up to \$\{GHOST_SOCKET_GRACE_MS \/ 1000\}s/,
    'resolveOccupiedPort must log a bounded grace wait before falling back',
  );
  assert.match(
    src,
    /if \(!isPortInUse\(port\)\) return \{ port, reuse: false \};\s*if \(await httpWaiter\.isHttpUp\(healthUrl\)\) return \{ port, reuse: true \};/,
    'the grace loop must re-probe health so a concurrently starting OpenCode is reused',
  );
});

test('auto-restart resolves the port instead of blind respawning onto a stuck socket', () => {
  const src = readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8');
  assert.match(
    src,
    /setTimeout\(autoRestartOpencodeAfterCrash, 1000\)/,
    'auto-restart must schedule the resolution helper',
  );
  assert.match(
    src,
    /async function autoRestartOpencodeAfterCrash/,
    'autoRestartOpencodeAfterCrash must be defined',
  );
  const restartBlock = src.slice(src.indexOf('async function autoRestartOpencodeAfterCrash'));
  assert.match(
    restartBlock,
    /await httpWaiter\.waitForPortFree\(OPENCODE_PORT, 60\)/,
    'auto-restart must wait for the port to free before respawning',
  );
  assert.match(
    restartBlock,
    /await resolveOccupiedPort\(/,
    'auto-restart must resolve a stuck port like a cold start instead of respawning blindly',
  );
});
