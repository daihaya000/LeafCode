import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { parse } from 'jsonc-parser';
import {
  buildDesiredEntry,
  deepEqual,
  parseArgs,
  resolveServerPath,
  run,
} from '../scripts/install-memory-mcp.mjs';

const scriptUrl = pathToFileURL(path.join(process.cwd(), 'scripts', 'install-memory-mcp.mjs'));
const expectedServerPath = path.join(process.cwd(), 'mcp', 'memory-server.mjs');

async function makeIsolatedEnv() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'browser-bridge-install-memory-'));
  const home = path.join(tmp, 'home');
  await mkdir(home, { recursive: true });
  return { home };
}

function silence() {
  return { log: () => {}, errorLog: () => {} };
}

test('parseArgs requires --workspace unless uninstalling', () => {
  assert.deepEqual(parseArgs(['--workspace=ws-1']), { scope: 'global', path: null, force: false, uninstall: false, dryRun: false, workspace: 'ws-1' });
  assert.doesNotThrow(() => parseArgs(['--uninstall']));
  assert.throws(() => parseArgs([]), /--workspace=<id> is required/);
  assert.throws(() => parseArgs(['--scope=bogus', '--workspace=w']), /Invalid --scope/);
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
});

test('resolveServerPath points at browser-bridge/mcp/memory-server.mjs', () => {
  assert.equal(resolveServerPath(scriptUrl), expectedServerPath);
});

test('buildDesiredEntry pins workspace via args and env', () => {
  const entry = buildDesiredEntry(expectedServerPath, 'ws-9');
  assert.deepEqual(entry.command, ['node', expectedServerPath]);
  assert.deepEqual(entry.arguments, ['--workspace', 'ws-9']);
  assert.equal(entry.environment.LEAFCODE_MEMORY_WORKSPACE, '{env:LEAFCODE_MEMORY_WORKSPACE}');
});

test('deepEqual compares structurally', () => {
  assert.equal(deepEqual({ a: 1 }, { a: 1 }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
});

test('install adds memory entry while preserving a sibling mcp entry', async () => {
  const { home } = await makeIsolatedEnv();
  const configPath = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, '{\n  "mcp": {\n    "browser-bridge": { "type": "local", "command": ["base"], "enabled": true }\n  }\n}\n', 'utf8');

  let code = await run({ argv: [`--workspace=w1`, `--path=${configPath}`], scriptUrl, ...silence() });
  assert.equal(code, 0);
  const parsed = parse(await readFile(configPath, 'utf8'), [], { disallowComments: true });
  assert.deepEqual(parsed.mcp.memory.arguments, ['--workspace', 'w1']);
  assert.ok(parsed.mcp['browser-bridge'], 'sibling preserved');

  code = await run({ argv: [`--workspace=w1`, `--path=${configPath}`], scriptUrl, ...silence() });
  assert.equal(code, 0);
});

test('install without --force refuses to overwrite a differing memory entry', async () => {
  const { home } = await makeIsolatedEnv();
  const configPath = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, '{\n  "mcp": { "memory": { "type": "local", "command": ["node", "old"], "enabled": true } }\n}\n', 'utf8');

  const code = await run({ argv: [`--workspace=ws2`, `--path=${configPath}`], scriptUrl, ...silence() });
  assert.equal(code, 2);
  const text = await readFile(configPath, 'utf8');
  assert.ok(text.includes('"old"'), 'file untouched');
});

test('uninstall removes only the memory entry', async () => {
  const { home } = await makeIsolatedEnv();
  const configPath = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, '{\n  "mcp": { "memory": { "type": "local", "command": ["node","y"], "enabled": true }, "browser-bridge": { "type": "local" } }\n}\n', 'utf8');

  const code = await run({ argv: ['--uninstall', `--path=${configPath}`], scriptUrl, ...silence() });
  assert.equal(code, 0);
  const parsed = parse(await readFile(configPath, 'utf8'), [], { disallowComments: true });
  assert.equal(parsed.mcp.memory, undefined);
  assert.ok(parsed.mcp['browser-bridge']);
});