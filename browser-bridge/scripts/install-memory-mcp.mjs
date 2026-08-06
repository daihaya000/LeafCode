#!/usr/bin/env node
/**
 * Installs (or removes) the memory-mcp server entry in an OpenCode JSONC
 * config file, preserving comments and formatting (jsonc-parser, same as
 * browser-bridge/scripts/install-mcp.mjs).
 *
 * The memory server opens the WebUI SQLite directly. It resolves its data dir
 * from `OPENCODE_WEBUI_DATA_DIR` when set, otherwise it mirrors the WebUI's
 * platform default, so the config here only needs to pin the workspace id.
 *
 * Usage:
 *   node browser-bridge/scripts/install-memory-mcp.mjs [options]
 *
 * Options:
 *   --workspace=<id>       Workspace id to bind the memory server to (required)
 *   --scope=global|project Which config to edit (default: global)
 *   --path=<file>          Explicit config file path (overrides --scope)
 *   --force                Overwrite an existing memory entry that differs
 *   --uninstall            Remove the memory entry instead of installing it
 *   --dry-run              Print what would change without writing the file
 *
 * Exit codes:
 *   0  success
 *   1  fatal error
 *   2  an existing memory entry differs and --force was not given
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyEdits, modify, parse } from 'jsonc-parser';

const SKELETON = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
const FORMATTING_OPTIONS = { insertSpaces: true, tabSize: 2, eol: '\n' };
const ENV_WORKSPACE = '{env:OPENCODE_WEBUI_MEMORY_WORKSPACE}';

export function parseArgs(argv) {
  const options = { scope: 'global', path: null, force: false, uninstall: false, dryRun: false, workspace: null };
  for (const arg of argv) {
    if (arg === '--force') options.force = true;
    else if (arg === '--uninstall') options.uninstall = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--workspace=')) options.workspace = arg.slice('--workspace='.length);
    else if (arg.startsWith('--scope=')) options.scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--path=')) options.path = arg.slice('--path='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['global', 'project'].includes(options.scope)) throw new Error(`Invalid --scope: ${options.scope}`);
  if (!options.uninstall && (typeof options.workspace !== 'string' || options.workspace.trim() === '')) {
    throw new Error('--workspace=<id> is required (use --uninstall to remove)');
  }
  return options;
}

export function resolveServerPath(scriptUrl) {
  return path.resolve(fileURLToPath(scriptUrl), '..', '..', 'mcp', 'memory-server.mjs');
}

export function resolveConfigPath({ scope, path: explicitPath, cwd = process.cwd(), home = homedir() }) {
  if (explicitPath) return path.resolve(explicitPath);
  const roots = scope === 'project' ? [cwd] : [path.join(home, '.config', 'opencode')];
  const candidateNames = scope === 'project'
    ? ['opencode.jsonc', 'opencode.json', path.join('.opencode', 'opencode.json')]
    : ['opencode.jsonc', 'opencode.json'];
  for (const root of roots) {
    for (const name of candidateNames) {
      const candidate = path.join(root, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return path.join(roots[0], candidateNames[0]);
}

export function buildDesiredEntry(serverPath, workspace) {
  return {
    type: 'local',
    command: ['node', serverPath],
    enabled: true,
    arguments: ['--workspace', workspace],
    environment: { OPENCODE_WEBUI_MEMORY_WORKSPACE: ENV_WORKSPACE },
  };
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

function parseStrict(text) {
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  return { value, errors };
}

function applyModification(text, jsonPath, value) {
  const edits = modify(text, jsonPath, value, { formattingOptions: FORMATTING_OPTIONS });
  return applyEdits(text, edits);
}

async function atomicWrite(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, text, 'utf8');
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function run({ argv, scriptUrl, cwd = process.cwd(), home = homedir(), log = console.log, errorLog = console.error }) {
  const options = parseArgs(argv);
  const serverPath = resolveServerPath(scriptUrl);
  const configPath = resolveConfigPath({ scope: options.scope, path: options.path, cwd, home });

  let originalText;
  const fileExisted = existsSync(configPath);
  originalText = fileExisted ? await readFile(configPath, 'utf8') : SKELETON;

  const { errors: originalErrors } = parseStrict(originalText);
  if (originalErrors.length > 0) {
    errorLog(`FAIL Config at ${configPath} is not valid JSONC. Fix it manually first.`);
    return 1;
  }

  const existingEntry = parseStrict(originalText).value?.mcp?.['memory'];

  if (options.uninstall) {
    if (existingEntry === undefined) {
      log(`OK   memory is not registered in ${configPath}; nothing to remove.`);
      return 0;
    }
    const nextText = applyModification(originalText, ['mcp', 'memory'], undefined);
    if (parseStrict(nextText).errors.length > 0) {
      errorLog('FAIL Generated config failed validation after removal; aborting.');
      return 1;
    }
    if (options.dryRun) { log(`DRY  Would remove mcp.memory from ${configPath}.`); return 0; }
    await atomicWrite(configPath, nextText);
    log(`OK   Removed mcp.memory from ${configPath}.`);
    log('     Restart OpenCode for the change to take effect.');
    return 0;
  }

  const desiredEntry = buildDesiredEntry(serverPath, options.workspace);

  if (existingEntry !== undefined && deepEqual(existingEntry, desiredEntry)) {
    log(`OK   memory is already installed and up to date in ${configPath}.`);
    return 0;
  }
  if (existingEntry !== undefined && !options.force) {
    errorLog('SKIP An mcp.memory entry already exists in ' + configPath + ' and differs from the expected configuration.');
    errorLog('     Re-run with --force to overwrite it, or edit the file manually.');
    return 2;
  }

  const nextText = applyModification(originalText, ['mcp', 'memory'], desiredEntry);
  const { value: nextValue, errors: nextErrors } = parseStrict(nextText);
  if (nextErrors.length > 0 || !deepEqual(nextValue?.mcp?.['memory'], desiredEntry)) {
    errorLog('FAIL Generated config failed validation; aborting without writing.');
    return 1;
  }

  if (options.dryRun) {
    log(`DRY  Would ${existingEntry === undefined ? 'add' : 'update'} mcp.memory in ${configPath}:`);
    log(JSON.stringify(desiredEntry, null, 2).split('\n').map((line) => `     ${line}`).join('\n'));
    return 0;
  }

  await atomicWrite(configPath, nextText);
  log(`OK   ${existingEntry === undefined ? 'Installed' : 'Updated'} mcp.memory in ${configPath}.`);
  log(`     command: node ${serverPath} --workspace ${options.workspace}`);
  log('     Restart OpenCode for the change to take effect.');
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const exitCode = await run({ argv: process.argv.slice(2), scriptUrl: import.meta.url });
    process.exitCode = exitCode;
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}