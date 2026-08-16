import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectDescendantPids,
  compileJobHolder,
  createJobSupervisor,
  findCsc,
  JOB_HOLDER_SOURCE,
  jobHolderCachePath,
  parseJobHolderReply,
} from './windows-job.js';
import { isProcessAlive } from './process-stop.js';

test('parseJobHolderReply accepts READY and OK', () => {
  assert.deepEqual(parseJobHolderReply('READY\r'), { ok: true, text: 'READY' });
  assert.deepEqual(parseJobHolderReply('OK'), { ok: true, text: 'OK' });
});

test('parseJobHolderReply surfaces ERR text', () => {
  assert.deepEqual(parseJobHolderReply('ERR OpenProcess failed 5'), {
    ok: false,
    error: 'OpenProcess failed 5',
  });
});

test('parseJobHolderReply rejects blank and unknown lines', () => {
  assert.equal(parseJobHolderReply('').ok, false);
  assert.equal(parseJobHolderReply('WAT').ok, false);
});

test('jobHolderCachePath is stable for the same source', () => {
  const a = jobHolderCachePath('C:\\data', 'class JobHolder {}');
  const b = jobHolderCachePath('C:\\data', 'class JobHolder {}');
  assert.equal(a, b);
  assert.match(a, /job-holder-[0-9a-f]{16}\.exe$/);
  const c = jobHolderCachePath('C:\\data', 'class JobHolder { }');
  assert.notEqual(a, c);
});

test('collectDescendantPids walks a tree and caps cycles', () => {
  const children = {
    1: [2, 3],
    2: [4],
    3: [1],
    4: [],
  };
  assert.deepEqual(
    collectDescendantPids(1, { listChildren: (pid) => children[pid] ?? [] }).sort(
      (a, b) => a - b,
    ),
    [1, 2, 3, 4],
  );
  assert.deepEqual(collectDescendantPids(0), []);
  assert.deepEqual(collectDescendantPids('nope'), []);
});

test('createJobSupervisor adopt/drop talk the holder protocol', () => {
  const sent = [];
  const jobs = createJobSupervisor({
    dataDir: 'C:\\unused',
    log: () => {},
    error: () => {},
    send: (line) => {
      sent.push(line);
      return { ok: true, text: 'OK' };
    },
    listChildren: (pid) => (pid === 10 ? [11] : []),
  });
  assert.equal(jobs.start(), true);
  assert.equal(jobs.adopt('opencode', 10), true);
  jobs.drop('opencode');
  jobs.disposeSync();
  assert.deepEqual(sent, [
    'CREATE opencode',
    'ASSIGN opencode 10',
    'ASSIGN opencode 11',
    'TERMINATE opencode',
    'CLOSE opencode',
  ]);
});

test('createJobSupervisor skips invalid pids and stays quiet when disabled', () => {
  const sent = [];
  const jobs = createJobSupervisor({
    dataDir: 'C:\\unused',
    send: (line) => {
      sent.push(line);
      return { ok: true, text: 'OK' };
    },
  });
  assert.equal(jobs.adopt('opencode', 10), false, 'not started yet');
  jobs.start();
  assert.equal(jobs.adopt('opencode', 0), false);
  assert.deepEqual(sent, []);
});

const isWindows = process.platform === 'win32';
const csc = isWindows ? findCsc() : null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilDead(pid, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await delay(50);
  }
  return !isProcessAlive(pid);
}

async function withJobHolder(fn) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'leafcode-job-'));
  const errors = [];
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 100000)'], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  });
  child.unref();
  let jobs;
  let holderPid;
  try {
    assert.ok(child.pid);
    jobs = createJobSupervisor({
      dataDir: cacheDir,
      cacheDir,
      sourcePath: JOB_HOLDER_SOURCE,
      log: () => {},
      error: (msg) => errors.push(msg),
    });
    assert.equal(jobs.start(), true, errors.join('; '));
    let readyTimer;
    try {
      await Promise.race([
        jobs.ready,
        new Promise((_, reject) => {
          readyTimer = setTimeout(() => {
            reject(
              new Error(`job-holder READY timeout; errors: ${errors.join('; ') || '(none)'}`),
            );
          }, 8000);
        }),
      ]);
    } finally {
      clearTimeout(readyTimer);
    }
    holderPid = jobs.holderPid;
    assert.ok(
      holderPid && isProcessAlive(holderPid),
      `job-holder must stay alive after READY; errors: ${errors.join('; ') || '(none)'}`,
    );
    await fn({ jobs, child, errors });
  } finally {
    try {
      jobs?.disposeSync();
    } catch {
      // best effort
    }
    for (const pid of [child.pid, holderPid]) {
      try {
        if (pid) spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      } catch {
        // already dead
      }
    }
    await delay(50);
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

test('createJobSupervisor ready resolves immediately when injected', async () => {
  const jobs = createJobSupervisor({
    dataDir: 'C:\\unused',
    send: () => ({ ok: true, text: 'OK' }),
  });
  assert.equal(jobs.start(), true);
  assert.equal(await jobs.ready, true);
  jobs.disposeSync();
});

test('disposeSync ends stdin and does not TerminateProcess the holder', () => {
  let ended = false;
  let killed = false;
  const jobs = createJobSupervisor({
    dataDir: 'C:\\unused',
    send: () => ({ ok: true, text: 'OK' }),
    listChildren: () => [],
    startHolder: () => ({
      pid: 1,
      stdin: {
        end() {
          ended = true;
        },
      },
      kill() {
        killed = true;
      },
    }),
  });
  jobs.start();
  jobs.adopt('opencode', 10);
  jobs.disposeSync();
  assert.equal(ended, true);
  assert.equal(killed, false);
});

test(
  'job-holder.exe compiles and kills a force-killed tree via TERMINATE',
  { skip: !isWindows || !csc },
  async () => {
    await withJobHolder(async ({ jobs, child, errors }) => {
      assert.equal(jobs.adopt('t', child.pid), true, errors.join('; '));
      jobs.drop('t');
      assert.equal(
        await waitUntilDead(child.pid),
        true,
        `TERMINATE must kill job members; holder errors: ${errors.join('; ') || '(none)'}`,
      );
    });
  },
);

test(
  'closing the job-holder pipe kills members (host TerminateProcess analogue)',
  { skip: !isWindows || !csc },
  async () => {
    await withJobHolder(async ({ jobs, child, errors }) => {
      assert.equal(jobs.adopt('t', child.pid), true, errors.join('; '));
      const holderPid = jobs.holderPid;
      assert.ok(holderPid);
      jobs.closeStdin();
      assert.equal(
        await waitUntilDead(child.pid),
        true,
        `EOF DropAll must reap members when the host pipe closes; holder errors: ${errors.join('; ') || '(none)'}`,
      );
    });
  },
);

test('compileJobHolder reports a missing compiler', () => {
  const result = compileJobHolder(JOB_HOLDER_SOURCE, join(tmpdir(), 'nope.exe'), {
    existsSync: () => false,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /csc\.exe not found/);
});
