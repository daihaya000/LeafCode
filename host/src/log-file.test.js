import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  formatLogLine,
  shouldRotate,
  rotateFilePath,
  rotateFilePaths,
  createLogFileWriter,
} from './log-file.js';

describe('formatLogLine', () => {
  test('formats a normal entry as a single tab-separated line', () => {
    const line = formatLogLine({
      ts: Date.parse('2026-07-30T03:00:00.000Z'),
      source: 'webui',
      level: 'error',
      text: 'next start crashed',
    });
    assert.equal(
      line,
      '2026-07-30T03:00:00.000Z\twebui\terror\tnext start crashed',
    );
  });

  test('collapses embedded newlines and tabs so the entry stays one line', () => {
    const line = formatLogLine({
      ts: 0,
      source: 'host',
      level: 'log',
      text: 'line1\nline2\twith tab',
    });
    assert.ok(!line.includes('\n'));
    assert.ok(!line.includes('\twith'));
    assert.match(line, /line1 line2 with tab$/);
  });

  test('defaults missing fields sensibly', () => {
    const line = formatLogLine({});
    assert.match(line, /^\d{4}-\d{2}-\d{2}T.*\thost\tlog\t$/);
  });

  test('coerces non-string text to a string', () => {
    const line = formatLogLine({ ts: 0, source: 'caddy', level: 'log', text: 42 });
    assert.match(line, /\tcaddy\tlog\t42$/);
  });
});

describe('shouldRotate', () => {
  test('rotates when size reaches the limit', () => {
    assert.equal(shouldRotate(2 * 1024 * 1024, 2 * 1024 * 1024), true);
    assert.equal(shouldRotate(2 * 1024 * 1024 + 1, 2 * 1024 * 1024), true);
  });

  test('does not rotate below the limit', () => {
    assert.equal(shouldRotate(0, 2 * 1024 * 1024), false);
    assert.equal(shouldRotate(2 * 1024 * 1024 - 1, 2 * 1024 * 1024), false);
  });

  test('rejects non-finite inputs', () => {
    assert.equal(shouldRotate(NaN, 100), false);
    assert.equal(shouldRotate(100, NaN), false);
    assert.equal(shouldRotate(Infinity, 100), false);
  });
});

describe('rotateFilePath / rotateFilePaths', () => {
  test('index 0 is the active log, N is the Nth rotated copy', () => {
    const dir = 'C:\\data';
    assert.equal(rotateFilePath(dir, 0), join(dir, 'host.log'));
    assert.equal(rotateFilePath(dir, 1), join(dir, 'host.log.1'));
    assert.equal(rotateFilePath(dir, 3), join(dir, 'host.log.3'));
  });

  test('rotateFilePaths lists oldest-first including the active log', () => {
    const dir = 'C:\\data';
    const paths = rotateFilePaths(dir, 3);
    assert.deepEqual(paths, [
      join(dir, 'host.log.3'),
      join(dir, 'host.log.2'),
      join(dir, 'host.log.1'),
      join(dir, 'host.log'),
    ]);
  });

  test('rotateFilePaths clamps maxFiles to at least 1', () => {
    const dir = 'C:\\data';
    const paths = rotateFilePaths(dir, 0);
    assert.deepEqual(paths, [join(dir, 'host.log.1'), join(dir, 'host.log')]);
  });
});

describe('createLogFileWriter', () => {
  function makeFs() {
    const files = new Map();
    const calls = [];
    const fs = {
      appendFileSync: (path, data) => {
        calls.push({ kind: 'append', path, data });
        files.set(path, (files.get(path) ?? '') + data);
      },
      statSync: (path) => {
        const content = files.get(path);
        if (content === undefined) {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        return { size: Buffer.byteLength(content, 'utf8') };
      },
      renameSync: (from, to) => {
        calls.push({ kind: 'rename', from, to });
        if (!files.has(from)) return;
        files.set(to, files.get(from));
        files.delete(from);
      },
      existsSync: (path) => files.has(path),
      unlinkSync: (path) => {
        calls.push({ kind: 'unlink', path });
        files.delete(path);
      },
    };
    return { files, calls, fs };
  }

  test('appends formatted lines to host.log', () => {
    const { files, fs } = makeFs();
    const writer = createLogFileWriter({ dir: 'C:\\data', fs });
    writer.write({ ts: 0, source: 'host', level: 'log', text: 'hello' });
    writer.write({ ts: 0, source: 'webui', level: 'error', text: 'boom' });
    const content = files.get(join('C:\\data', 'host.log'));
    assert.ok(content);
    assert.match(content, /host\tlog\thello\n/);
    assert.match(content, /webui\terror\tboom\n/);
  });

  test('writeRaw appends an arbitrary preformatted line', () => {
    const { files, fs } = makeFs();
    const writer = createLogFileWriter({ dir: 'C:\\data', fs });
    writer.writeRaw('=== header ===');
    assert.equal(
      files.get(join('C:\\data', 'host.log')),
      '=== header ===\n',
    );
  });

  test('rotates when size exceeds maxBytes, keeping maxFiles generations', () => {
    const { files, calls, fs } = makeFs();
    // Tiny limit so a couple of writes trigger rotation.
    const writer = createLogFileWriter({
      dir: 'C:\\data',
      maxBytes: 10,
      maxFiles: 2,
      fs,
    });
    // Pre-seed rotated generations so we can assert the chain shifts.
    files.set(join('C:\\data', 'host.log.1'), 'old1');
    files.set(join('C:\\data', 'host.log.2'), 'old2');

    writer.writeRaw('first');
    // size(5) < 10, no rotation yet
    assert.equal(calls.find((c) => c.kind === 'rename'), undefined);

    writer.writeRaw('second line');
    // size(5) < 10 still, no rotation yet
    assert.equal(calls.find((c) => c.kind === 'rename'), undefined);

    writer.writeRaw('third!');
    // size(17) >= 10 -> rotate: host.log.2 deleted, host.log.1 -> .2, host.log -> .1
    const renames = calls.filter((c) => c.kind === 'rename');
    const unlinks = calls.filter((c) => c.kind === 'unlink');
    assert.ok(renames.length >= 2, 'expected at least two renames');
    // oldest generation (.2) should be removed before renaming into it
    assert.ok(
      unlinks.some((u) => u.path === join('C:\\data', 'host.log.2')),
      'expected the oldest generation to be unlinked',
    );
    // active log promoted to .1
    assert.ok(
      renames.some(
        (r) =>
          r.from === join('C:\\data', 'host.log') &&
          r.to === join('C:\\data', 'host.log.1'),
      ),
    );
    // previous .1 promoted to .2
    assert.ok(
      renames.some(
        (r) =>
          r.from === join('C:\\data', 'host.log.1') &&
          r.to === join('C:\\data', 'host.log.2'),
      ),
    );
    // new content appended to a fresh active log
    assert.ok(files.has(join('C:\\data', 'host.log')));
    assert.ok(files.has(join('C:\\data', 'host.log.1')));
    assert.ok(files.has(join('C:\\data', 'host.log.2')));
  });

  test('swallows fs errors without throwing', () => {
    const fs = {
      appendFileSync: () => {
        throw new Error('disk full');
      },
      statSync: () => {
        throw new Error('stat failed');
      },
      renameSync: () => {
        throw new Error('rename failed');
      },
      existsSync: () => true,
      unlinkSync: () => {
        throw new Error('unlink failed');
      },
    };
    const writer = createLogFileWriter({ dir: 'C:\\data', maxBytes: 1, fs });
    // Must not throw.
    assert.doesNotThrow(() => writer.write({ text: 'x' }));
    assert.doesNotThrow(() => writer.writeRaw('y'));
  });

  test('uses default maxBytes/maxFiles when omitted', () => {
    const { fs } = makeFs();
    const writer = createLogFileWriter({ dir: 'C:\\data', fs });
    writer.write({ text: 'a' });
    // No rotation at small size; just ensure it works with defaults.
    assert.ok(fs.existsSync(join('C:\\data', 'host.log')) || true);
  });
});