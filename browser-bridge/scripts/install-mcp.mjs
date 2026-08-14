#!/usr/bin/env node
/**
 * Installs (or removes) the Browser Bridge MCP server entry in an OpenCode
 * JSONC config file, preserving every existing comment and formatting detail
 * in the rest of the file (via jsonc-parser's modify/applyEdits, the same
 * mechanism VS Code uses to edit settings.json).
 *
 * Usage:
 *   node browser-bridge/scripts/install-mcp.mjs [options]
 *
 * Options:
 *   --scope=global|project   Which config to edit (default: global)
 *   --path=<file>            Explicit config file path (overrides --scope)
 *   --force                  Overwrite an existing browser-bridge entry that differs
 *   --uninstall              Remove the browser-bridge entry instead of installing it
 *   --dry-run                Print what would change without writing the file
 *
 * Exit codes:
 *   0  success (installed / updated / already up to date / already absent)
 *   1  fatal error (invalid existing config, write failure, bad arguments)
 *   2  an existing browser-bridge entry differs and --force was not given
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyEdits, modify, parse } from 'jsonc-parser';

const SKELETON = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
const FORMATTING_OPTIONS = { insertSpaces: true, tabSize: 2, eol: '\n' };
const ENV_BROKER_URL = '{env:LEAFCODE_BROWSER_BROKER}';
const ENV_BROKER_TOKEN = '{env:LEAFCODE_BROWSER_BROKER_TOKEN}';

export function parseArgs(argv) {
  const options = { scope: 'global', path: null, force: false, uninstall: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--force') options.force = true;
    else if (arg === '--uninstall') options.uninstall = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--scope=')) options.scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--path=')) options.path = arg.slice('--path='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['global', 'project'].includes(options.scope)) throw new Error(`Invalid --scope: ${options.scope}`);
  return options;
}

export function resolveServerPath(scriptUrl) {
  return path.resolve(fileURLToPath(scriptUrl), '..', '..', 'mcp', 'server.mjs');
}

export function resolveConfigPath({ scope, path: explicitPath, cwd = process.cwd(), home = homedir() }) {
  if (explicitPath) return path.resolve(explicitPath);
  const roots = scope === 'project'
    ? [cwd]
    : [path.join(home, '.config', 'opencode')];
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

export function buildDesiredEntry(serverPath) {
  return {
    type: 'local',
    command: ['node', serverPath],
    enabled: true,
    environment: {
      LEAFCODE_BROWSER_BROKER: ENV_BROKER_URL,
      LEAFCODE_BROWSER_BROKER_TOKEN: ENV_BROKER_TOKEN,
    },
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
  let fileExisted = existsSync(configPath);
  if (fileExisted) {
    originalText = await readFile(configPath, 'utf8');
  } else {
    originalText = SKELETON;
  }

  const { errors: originalErrors } = parseStrict(originalText);
  if (originalErrors.length > 0) {
    errorLog(`FAIL Config at ${configPath} is not valid JSONC (${originalErrors.length} parse error(s)). Fix it manually before running this installer.`);
    return 1;
  }

  const existingEntry = parseStrict(originalText).value?.mcp?.['browser-bridge'];

  if (options.uninstall) {
    if (existingEntry === undefined) {
      log(`OK   browser-bridge is not registered in ${configPath}; nothing to remove.`);
      return 0;
    }
    const nextText = applyModification(originalText, ['mcp', 'browser-bridge'], undefined);
    const { errors: nextErrors } = parseStrict(nextText);
    if (nextErrors.length > 0) {
      errorLog('FAIL Generated config failed validation after removal; aborting without writing.');
      return 1;
    }
    if (options.dryRun) {
      log(`DRY  Would remove mcp.browser-bridge from ${configPath}.`);
      return 0;
    }
    await atomicWrite(configPath, nextText);
    log(`OK   Removed mcp.browser-bridge from ${configPath}.`);
    log('     Restart OpenCode for the change to take effect.');
    return 0;
  }

  const desiredEntry = buildDesiredEntry(serverPath);

  if (existingEntry !== undefined && deepEqual(existingEntry, desiredEntry)) {
    log(`OK   browser-bridge is already installed and up to date in ${configPath}.`);
    return 0;
  }

  if (existingEntry !== undefined && !options.force) {
    errorLog(`SKIP An mcp.browser-bridge entry already exists in ${configPath} and differs from the expected configuration.`);
    errorLog('     Re-run with --force to overwrite it, or edit the file manually.');
    return 2;
  }

  const nextText = applyModification(originalText, ['mcp', 'browser-bridge'], desiredEntry);
  const { value: nextValue, errors: nextErrors } = parseStrict(nextText);
  if (nextErrors.length > 0 || !deepEqual(nextValue?.mcp?.['browser-bridge'], desiredEntry)) {
    errorLog('FAIL Generated config failed validation; aborting without writing.');
    return 1;
  }

  if (options.dryRun) {
    log(`DRY  Would ${existingEntry === undefined ? 'add' : 'update'} mcp.browser-bridge in ${configPath}:`);
    log(JSON.stringify(desiredEntry, null, 2).split('\n').map((line) => `     ${line}`).join('\n'));
    return 0;
  }

  await atomicWrite(configPath, nextText);
  log(`OK   ${existingEntry === undefined ? 'Installed' : 'Updated'} mcp.browser-bridge in ${configPath}.`);
  log(`     command: node ${serverPath}`);
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
