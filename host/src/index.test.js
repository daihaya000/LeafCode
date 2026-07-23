import test from 'node:test';
import assert from 'node:assert/strict';

import * as host from './index.js';
import {
  isHeadless,
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
