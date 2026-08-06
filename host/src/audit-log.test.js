import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAuditLog, formatAuditLine } from './audit-log.js';

function withTempFile(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ocw-audit-'));
  try {
    return fn(join(dir, 'audit.log'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Read the log back as parsed records. */
function readRecords(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test('formatAuditLine emits one JSON object with an ISO timestamp', () => {
  const line = formatAuditLine({ action: 'login.success', actor: 'alice', ts: 0 });
  const parsed = JSON.parse(line);
  assert.equal(parsed.action, 'login.success');
  assert.equal(parsed.actor, 'alice');
  assert.equal(parsed.ts, '1970-01-01T00:00:00.000Z');
});

test('formatAuditLine defaults result to allow and honours deny', () => {
  assert.equal(JSON.parse(formatAuditLine({ action: 'logout' })).result, 'allow');
  assert.equal(
    JSON.parse(formatAuditLine({ action: 'login.failure', result: 'deny' })).result,
    'deny',
  );
});

test('formatAuditLine omits absent optional fields rather than writing null', () => {
  const parsed = JSON.parse(formatAuditLine({ action: 'logout' }));
  assert.equal('actor' in parsed, false);
  assert.equal('ip' in parsed, false);
  assert.equal('target' in parsed, false);
  assert.equal('reason' in parsed, false);
});

test('formatAuditLine keeps one event on one line despite newlines in a field', () => {
  // A username is attacker-controlled at the login endpoint; an embedded
  // newline must not be able to forge a second audit record.
  const line = formatAuditLine({ action: 'login.failure', actor: 'a\nb\tc\r\nd' });
  assert.equal(line.includes('\n'), false);
  assert.equal(JSON.parse(line).actor, 'a b c d');
});

test('formatAuditLine truncates an oversized field', () => {
  const parsed = JSON.parse(formatAuditLine({ action: 'login.failure', actor: 'x'.repeat(5000) }));
  assert.ok(parsed.actor.length <= 200);
});

test('createAuditLog appends one line per event', () => {
  withTempFile((file) => {
    const log = createAuditLog({ file, onSecure: () => {} });
    log.record({ action: 'login.success', actor: 'alice' });
    log.record({ action: 'logout', actor: 'alice' });

    const records = readRecords(file);
    assert.equal(records.length, 2);
    assert.equal(records[0].action, 'login.success');
    assert.equal(records[1].action, 'logout');
  });
});

test('createAuditLog creates missing parent directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocw-audit-'));
  try {
    const file = join(dir, 'nested', 'deep', 'audit.log');
    createAuditLog({ file, onSecure: () => {} }).record({ action: 'logout' });
    assert.equal(readRecords(file).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createAuditLog locks down the file when it is first created', () => {
  withTempFile((file) => {
    const secured = [];
    const log = createAuditLog({ file, onSecure: (f) => secured.push(f) });
    log.record({ action: 'logout' });
    log.record({ action: 'logout' });
    // Only on creation, not on every append.
    assert.deepEqual(secured, [file]);
  });
});

test('createAuditLog rotates once the file exceeds maxBytes', () => {
  withTempFile((file) => {
    const log = createAuditLog({ file, maxBytes: 200, maxFiles: 3, onSecure: () => {} });
    for (let i = 0; i < 12; i += 1) {
      log.record({ action: 'login.failure', actor: `user-${i}` });
    }
    assert.ok(existsSync(`${file}.1`), 'expected a rotated generation');
    // The active log restarted, so it holds fewer records than were written.
    assert.ok(readRecords(file).length < 12);
  });
});

test('createAuditLog keeps at most maxFiles generations', () => {
  withTempFile((file) => {
    const log = createAuditLog({ file, maxBytes: 120, maxFiles: 2, onSecure: () => {} });
    for (let i = 0; i < 40; i += 1) {
      log.record({ action: 'login.failure', actor: `user-${i}` });
    }
    assert.equal(existsSync(`${file}.1`), true);
    assert.equal(existsSync(`${file}.2`), true);
    assert.equal(existsSync(`${file}.3`), false);
  });
});

test('createAuditLog never throws when the filesystem fails', () => {
  const log = createAuditLog({
    file: 'C:\\nope\\audit.log',
    onSecure: () => {},
    fs: {
      mkdirSync: () => {
        throw new Error('EACCES');
      },
    },
  });
  // Auditing must not be able to break a login response.
  assert.doesNotThrow(() => log.record({ action: 'login.success', actor: 'alice' }));
});

test('createAuditLog records no secret material', () => {
  withTempFile((file) => {
    const log = createAuditLog({ file, onSecure: () => {} });
    log.record({
      action: 'login.success',
      actor: 'alice',
      ip: '192.168.0.5',
      reason: 'local',
    });
    const raw = readFileSync(file, 'utf8');
    // The caller never passes these, but assert the shape stays closed anyway:
    // only the known fields are serialised.
    const parsed = JSON.parse(raw.trim());
    assert.deepEqual(Object.keys(parsed).sort(), [
      'action',
      'actor',
      'ip',
      'reason',
      'result',
      'ts',
    ]);
  });
});

test('createAuditLog ignores unknown fields so a caller cannot leak a token', () => {
  withTempFile((file) => {
    const log = createAuditLog({ file, onSecure: () => {} });
    log.record({
      action: 'login.success',
      actor: 'alice',
      // Simulate a careless caller passing sensitive data.
      password: 'hunter2',
      token: 'abc.def',
      jti: 'xyz',
    });
    const raw = readFileSync(file, 'utf8');
    assert.equal(raw.includes('hunter2'), false);
    assert.equal(raw.includes('abc.def'), false);
    assert.equal(raw.includes('xyz'), false);
  });
});
