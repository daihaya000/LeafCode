import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'jsonc-parser';
import { buildDesiredEntry, deepEqual, parseArgs, resolveConfigPath, run } from '../scripts/install-qwen-mm-mcp.mjs';

async function makeIsolatedEnv() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'opencode-webui-install-qwen-mm-mcp-'));
  const home = path.join(tmp, 'home');
  const cwd = path.join(tmp, 'project');
  await mkdir(home, { recursive: true });
  await mkdir(cwd, { recursive: true });
  return { home, cwd };
}

function silence() {
  return { log: () => {}, errorLog: () => {} };
}

test('parseArgs accepts known flags and rejects unknown ones', () => {
  assert.deepEqual(parseArgs([]), { scope: 'global', path: null, force: false, uninstall: false, dryRun: false });
  assert.deepEqual(parseArgs(['--scope=project', '--force', '--dry-run', '--uninstall']), { scope: 'project', path: null, force: true, uninstall: true, dryRun: true });
  assert.deepEqual(parseArgs(['--path=C:/x/opencode.jsonc']), { scope: 'global', path: 'C:/x/opencode.jsonc', force: false, uninstall: false, dryRun: false });
  assert.throws(() => parseArgs(['--scope=bogus']), /Invalid --scope/);
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
});

test('deepEqual compares structurally regardless of key insertion order', () => {
  assert.equal(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual([1, { x: 1 }], [1, { x: 1 }]), true);
  assert.equal(deepEqual([1, 2], [2, 1]), false);
  assert.equal(deepEqual(null, {}), false);
});

test('buildDesiredEntry uses uvx command with the core profile and env placeholders', () => {
  const entry = buildDesiredEntry();
  assert.equal(entry.type, 'local');
  assert.equal(entry.enabled, true);
  assert.ok(entry.command[0] === 'uvx');
  assert.ok(entry.command[1] === '--from');
  assert.ok(entry.command[2].includes('qwen-mm-plugins[core]'));
  assert.ok(entry.command[3] === 'qwen-mm-plugins-core');
  assert.equal(entry.environment.DASHSCOPE_API_KEY, '{env:DASHSCOPE_API_KEY}');
  assert.equal(entry.environment.SERPER_API_KEY, '{env:SERPER_API_KEY}');
});

test('resolveConfigPath prefers an existing opencode.json over the default .jsonc candidate', async () => {
  const { home } = await makeIsolatedEnv();
  const dir = path.join(home, '.config', 'opencode');
  await mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, 'opencode.json');
  await writeFile(jsonPath, '{}', 'utf8');
  assert.equal(resolveConfigPath({ scope: 'global', path: null, home }), jsonPath);
});

test('resolveConfigPath defaults to opencode.jsonc under project cwd when nothing exists', async () => {
  const { cwd } = await makeIsolatedEnv();
  assert.equal(resolveConfigPath({ scope: 'project', path: null, cwd }), path.join(cwd, 'opencode.jsonc'));
});

test('install creates a new global config with the qwen-mm-plugins-core entry when none exists', async () => {
  const { home } = await makeIsolatedEnv();
  const configPath = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  const code = await run({ argv: [], home, ...silence() });
  assert.equal(code, 0);
  const text = await readFile(configPath, 'utf8');
  const value = parse(text);
  assert.deepEqual(value.mcp['qwen-mm-plugins-core'], buildDesiredEntry());
  assert.equal(value.$schema, 'https://opencode.ai/config.json');
});

test('a second install run is idempotent and reports success without changing the file', async () => {
  const { home } = await makeIsolatedEnv();
  const configPath = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  await run({ argv: [], home, ...silence() });
  const before = await readFile(configPath, 'utf8');
  const code = await run({ argv: [], home, ...silence() });
  assert.equal(code, 0);
  const after = await readFile(configPath, 'utf8');
  assert.equal(after, before);
});

test('install without --force refuses to overwrite a differing existing entry and leaves the file untouched', async () => {
  const { home } = await makeIsolatedEnv();
  const dir = path.join(home, '.config', 'opencode');
  await mkdir(dir, { recursive: true });
  const configPath = path.join(dir, 'opencode.jsonc');
  const fixture = '{\n  // keep me\n  "mcp": { "qwen-mm-plugins-core": { "type": "local", "command": ["uvx", "old"] } }\n}\n';
  await writeFile(configPath, fixture, 'utf8');
  const code = await run({ argv: [], home, ...silence() });
  assert.equal(code, 2);
  assert.equal(await readFile(configPath, 'utf8'), fixture);
});

test('install --force updates a differing entry while preserving comments and sibling mcp entries', async () => {
  const { home } = await makeIsolatedEnv();
  const dir = path.join(home, '.config', 'opencode');
  await mkdir(dir, { recursive: true });
  const configPath = path.join(dir, 'opencode.jsonc');
  const fixture = [
    '{',
    '  // top comment',
    '  "mcp": {',
    '    // keep this sibling entry and its comment',
    '    "browser-bridge": { "type": "local", "command": ["node", "C:/bb/server.mjs"] },',
    '    "qwen-mm-plugins-core": { "type": "local", "command": ["uvx", "old"] }',
    '  },',
    '  "other": true // trailing comment',
    '}',
    '',
  ].join('\n');
  await writeFile(configPath, fixture, 'utf8');
  const code = await run({ argv: ['--force'], home, ...silence() });
  assert.equal(code, 0);
  const text = await readFile(configPath, 'utf8');
  assert.ok(text.includes('// top comment'));
  assert.ok(text.includes('// keep this sibling entry and its comment'));
  assert.ok(text.includes('"browser-bridge"'));
  assert.ok(text.includes('// trailing comment'));
  const value = parse(text);
  assert.deepEqual(value.mcp['qwen-mm-plugins-core'], buildDesiredEntry());
});

test('--dry-run never writes the file for install or uninstall', async () => {
  const { home } = await makeIsolatedEnv();
  const dir = path.join(home, '.config', 'opencode');
  await mkdir(dir, { recursive: true });
  const configPath = path.join(dir, 'opencode.jsonc');
  const fixture = '{\n  "mcp": {}\n}\n';
  await writeFile(configPath, fixture, 'utf8');
  let code = await run({ argv: ['--dry-run'], home, ...silence() });
  assert.equal(code, 0);
  assert.equal(await readFile(configPath, 'utf8'), fixture);
  code = await run({ argv: ['--uninstall', '--dry-run'], home, ...silence() });
  assert.equal(code, 0);
  assert.equal(await readFile(configPath, 'utf8'), fixture);
});

test('--uninstall removes only the qwen-mm-plugins-core entry and is a no-op when absent', async () => {
  const { home } = await makeIsolatedEnv();
  await run({ argv: [], home, ...silence() });
  const configPath = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  let code = await run({ argv: ['--uninstall'], home, ...silence() });
  assert.equal(code, 0);
  let value = parse(await readFile(configPath, 'utf8'));
  assert.equal(value.mcp['qwen-mm-plugins-core'], undefined);

  const before = await readFile(configPath, 'utf8');
  code = await run({ argv: ['--uninstall'], home, ...silence() });
  assert.equal(code, 0);
  assert.equal(await readFile(configPath, 'utf8'), before);
});

test('refuses to touch a config file with real JSONC syntax errors', async () => {
  const { home } = await makeIsolatedEnv();
  const dir = path.join(home, '.config', 'opencode');
  await mkdir(dir, { recursive: true });
  const configPath = path.join(dir, 'opencode.jsonc');
  const broken = '{ "mcp": { "qwen-mm-plugins-core": ';
  await writeFile(configPath, broken, 'utf8');
  const code = await run({ argv: [], home, ...silence() });
  assert.equal(code, 1);
  assert.equal(await readFile(configPath, 'utf8'), broken);
});

test('--scope=project targets the project cwd instead of the global config', async () => {
  const { home, cwd } = await makeIsolatedEnv();
  const code = await run({ argv: ['--scope=project'], home, cwd, ...silence() });
  assert.equal(code, 0);
  const projectConfigPath = path.join(cwd, 'opencode.jsonc');
  assert.ok(existsSync(projectConfigPath));
  assert.ok(!existsSync(path.join(home, '.config', 'opencode', 'opencode.jsonc')));
});

test('--path overrides scope resolution entirely', async () => {
  const { home, cwd } = await makeIsolatedEnv();
  const explicitPath = path.join(cwd, 'nested', 'custom.jsonc');
  const code = await run({ argv: [`--path=${explicitPath}`], home, cwd, ...silence() });
  assert.equal(code, 0);
  assert.ok(existsSync(explicitPath));
  const info = await stat(explicitPath);
  assert.ok(info.isFile());
});