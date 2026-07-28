import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getLogEntries, pushLogEntry, resetLogBuffer } from './log-buffer.js';

describe('log-buffer', () => {
  beforeEach(() => {
    resetLogBuffer();
  });

  test('pushLogEntry assigns increasing seq and keeps fields', () => {
    const a = pushLogEntry('host', 'log', 'hello');
    const b = pushLogEntry('opencode', 'error', 'boom');
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
    assert.equal(a.source, 'host');
    assert.equal(a.level, 'log');
    assert.equal(a.text, 'hello');
    assert.equal(b.source, 'opencode');
    assert.equal(b.level, 'error');
    assert.ok(typeof a.ts === 'number' && a.ts > 0);
  });

  test('getLogEntries with no since returns tail and current nextSeq', () => {
    for (let i = 0; i < 5; i += 1) pushLogEntry('host', 'log', `line ${i}`);
    const { entries, nextSeq } = getLogEntries();
    assert.equal(entries.length, 5);
    assert.equal(nextSeq, 5);
    assert.equal(entries[0].text, 'line 0');
    assert.equal(entries[4].text, 'line 4');
  });

  test('getLogEntries with since returns only newer entries', () => {
    for (let i = 0; i < 5; i += 1) pushLogEntry('host', 'log', `line ${i}`);
    const { entries, nextSeq } = getLogEntries(3);
    assert.deepEqual(
      entries.map((e) => e.text),
      ['line 3', 'line 4'],
    );
    assert.equal(nextSeq, 5);
  });

  test('getLogEntries with since beyond nextSeq returns empty', () => {
    pushLogEntry('host', 'log', 'only');
    const { entries } = getLogEntries(999);
    assert.equal(entries.length, 0);
  });

  test('entry text is truncated beyond 4000 chars', () => {
    const huge = 'x'.repeat(5000);
    const entry = pushLogEntry('caddy', 'log', huge);
    assert.ok(entry.text.length < 5000);
    assert.match(entry.text, /…\(truncated\)$/);
  });

  test('buffer caps at 500 entries, dropping the oldest first', () => {
    for (let i = 0; i < 550; i += 1) pushLogEntry('host', 'log', `line ${i}`);
    const { entries, nextSeq } = getLogEntries(0);
    assert.equal(nextSeq, 550);
    assert.equal(entries.length, 500);
    // Oldest surviving entry should be line 50 (0..49 evicted).
    assert.equal(entries[0].text, 'line 50');
    assert.equal(entries[entries.length - 1].text, 'line 549');
  });

  test('buffer caps at 256KB total, dropping oldest first', () => {
    const big = 'y'.repeat(4000); // near MAX_ENTRY_CHARS, well under it
    // 256KB / 4000 chars ≈ 65 entries fit; push more to force eviction by size.
    for (let i = 0; i < 100; i += 1) pushLogEntry('webui', 'log', big);
    const { entries } = getLogEntries(0);
    assert.ok(entries.length < 100, 'expected size-based eviction to occur');
    const totalChars = entries.reduce((sum, e) => sum + e.text.length, 0);
    assert.ok(totalChars <= 256 * 1024);
  });

  test('resetLogBuffer clears entries and seq counter', () => {
    pushLogEntry('host', 'log', 'a');
    pushLogEntry('host', 'log', 'b');
    resetLogBuffer();
    const { entries, nextSeq } = getLogEntries();
    assert.equal(entries.length, 0);
    assert.equal(nextSeq, 0);
    const next = pushLogEntry('host', 'log', 'c');
    assert.equal(next.seq, 1);
  });
});
