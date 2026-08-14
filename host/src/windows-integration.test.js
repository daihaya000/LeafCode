import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowFirewallPort,
  firewallRuleExists,
  launchWindowsVoiceInput,
} from './windows-integration.js';

test('launchWindowsVoiceInput throws off Windows', () => {
  assert.throws(
    () => launchWindowsVoiceInput({ isWindows: false }),
    /only available on Windows/,
  );
});

test('launchWindowsVoiceInput runs the keybd_event script on Windows', () => {
  const calls = [];
  launchWindowsVoiceInput({
    isWindows: true,
    execFileSync: (file, args, options) => {
      calls.push({ file, args, options });
      return '';
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'powershell.exe');
  assert.ok(calls[0].args.some((a) => a.includes('keybd_event')));
  assert.equal(calls[0].options.windowsHide, true);
});

test('firewallRuleExists is true when netsh reports the rule', () => {
  assert.equal(
    firewallRuleExists({
      execFileSync: () => '',
    }),
    true,
  );
});

test('firewallRuleExists is false when netsh fails', () => {
  assert.equal(
    firewallRuleExists({
      execFileSync: () => {
        throw new Error('rule not found');
      },
    }),
    false,
  );
});

test('allowFirewallPort returns early when the rule already exists', async () => {
  const result = await allowFirewallPort(3000, {
    isWindows: true,
    firewallRuleExists: () => true,
  });
  assert.deepEqual(result, { alreadyExists: true, port: 3000 });
});

test('allowFirewallPort adds the rule via an elevated powershell', async () => {
  const calls = [];
  const result = await allowFirewallPort(3000, {
    isWindows: true,
    firewallRuleExists: () => false,
    execFileAsync: (file, args, options) => {
      calls.push({ file, args, options });
      return Promise.resolve({});
    },
  });
  assert.deepEqual(result, { alreadyExists: false, port: 3000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'powershell.exe');
  assert.ok(calls[0].args.some((a) => a.includes('localport=3000')));
});

test('allowFirewallPort throws a user-facing error when the elevated command fails', async () => {
  await assert.rejects(
    allowFirewallPort(3000, {
      isWindows: true,
      firewallRuleExists: () => false,
      execFileAsync: () => Promise.reject(new Error('UAC cancelled')),
    }),
    /ファイアウォールルールの追加に失敗しました/,
  );
});

test('allowFirewallPort throws off Windows', async () => {
  await assert.rejects(
    allowFirewallPort(3000, { isWindows: false }),
    /Windows でのみ対応/,
  );
});
