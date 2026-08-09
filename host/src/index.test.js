import test from 'node:test';
import assert from 'node:assert/strict';

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
  const previousWebuiHeadless = process.env.OPENCODE_WEBUI_HEADLESS;
  process.env.OPENCODE_HEADLESS = '1';
  delete process.env.OPENCODE_WEBUI_HEADLESS;
  try {
    assert.equal(isHeadless(), true);
  } finally {
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.OPENCODE_WEBUI_HEADLESS;
    else process.env.OPENCODE_WEBUI_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns true when --headless flag is present', () => {
  const previousArgv = process.argv;
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.OPENCODE_WEBUI_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  delete process.env.OPENCODE_WEBUI_HEADLESS;
  process.argv = ['node', 'src/index.js', '--headless'];
  try {
    assert.equal(isHeadless(), true);
  } finally {
    process.argv = previousArgv;
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.OPENCODE_WEBUI_HEADLESS;
    else process.env.OPENCODE_WEBUI_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns false by default', () => {
  const previousArgv = process.argv;
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.OPENCODE_WEBUI_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  delete process.env.OPENCODE_WEBUI_HEADLESS;
  process.argv = ['node', 'src/index.js'];
  try {
    assert.equal(isHeadless(), false);
  } finally {
    process.argv = previousArgv;
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.OPENCODE_WEBUI_HEADLESS;
    else process.env.OPENCODE_WEBUI_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns true for OPENCODE_WEBUI_HEADLESS=1', () => {
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.OPENCODE_WEBUI_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  process.env.OPENCODE_WEBUI_HEADLESS = '1';
  try {
    assert.equal(isHeadless(), true);
  } finally {
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.OPENCODE_WEBUI_HEADLESS;
    else process.env.OPENCODE_WEBUI_HEADLESS = previousWebuiHeadless;
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
      'node.exe "C:/projects/opencode-webui/src/index.js"',
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
  const ours = 'C:\\OpenCodeWebUI\\deploy\\Caddyfile';
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
