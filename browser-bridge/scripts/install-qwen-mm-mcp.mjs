#!/usr/bin/env node
/**
 * Installs (or removes) the Qwen-MM-Plugins core MCP server entry in an
 * OpenCode JSONC config file, preserving every existing comment and
 * formatting detail (jsonc-parser, same mechanism as
 * browser-bridge/scripts/install-mcp.mjs).
 *
 * The entry registers `qwen-mm-plugins-core` via `uvx` so image-input-
 * incapable models can still read images / videos / documents / 3D models
 * and run OCR / grounding / segmentation / ASR / vision chat through MCP
 * tools. Native reading needs no API key; vision_chat / ocr / grounding /
 * ASR / generation require DASHSCOPE_API_KEY (passed through from the env).
 *
 * Usage:
 *   node scripts/install-qwen-mm-mcp.mjs [options]
 *
 * Options:
 *   --scope=global|project   Which config to edit (default: global)
 *   --path=<file>            Explicit config file path (overrides --scope)
 *   --force                  Overwrite an existing entry that differs
 *   --uninstall              Remove the entry instead of installing it
 *   --dry-run                Print what would change without writing the file
 *
 * Exit codes:
 *   0  success (installed / updated / already up to date / already absent)
 *   1  fatal error (invalid existing config, write failure, bad arguments)
 *   2  an existing entry differs and --force was not given
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyEdits, modify, parse } from 'jsonc-parser';

const SKELETON = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
const FORMATTING_OPTIONS = { insertSpaces: true, tabSize: 2, eol: '\n' };
const ENTRY_KEY = 'qwen-mm-plugins-core';
const UVX_FROM = 'qwen-mm-plugins[core] @ git+https://github.com/QwenLM/Qwen-MM-Plugins.git@main';
const MCP_TIMEOUT_MS = 300000;
const ENV_DASHSCOPE = '{env:DASHSCOPE_API_KEY}';
const ENV_SERPER = '{env:SERPER_API_KEY}';

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

export function buildDesiredEntry() {
  return {
    type: 'local',
    command: ['uvx', '--from', UVX_FROM, ENTRY_KEY],
    enabled: true,
    timeout: MCP_TIMEOUT_MS,
    environment: {
      DASHSCOPE_API_KEY: ENV_DASHSCOPE,
      SERPER_API_KEY: ENV_SERPER,
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

export async function run({ argv, cwd = process.cwd(), home = homedir(), log = console.log, errorLog = console.error }) {
  const options = parseArgs(argv);
  const configPath = resolveConfigPath({ scope: options.scope, path: options.path, cwd, home });

  let originalText;
  const fileExisted = existsSync(configPath);
  originalText = fileExisted ? await readFile(configPath, 'utf8') : SKELETON;

  const { errors: originalErrors } = parseStrict(originalText);
  if (originalErrors.length > 0) {
    errorLog(`FAIL Config at ${configPath} is not valid JSONC (${originalErrors.length} parse error(s)). Fix it manually before running this installer.`);
    return 1;
  }

  const existingEntry = parseStrict(originalText).value?.mcp?.[ENTRY_KEY];

  if (options.uninstall) {
    if (existingEntry === undefined) {
      log(`OK   ${ENTRY_KEY} is not registered in ${configPath}; nothing to remove.`);
      return 0;
    }
    const nextText = applyModification(originalText, ['mcp', ENTRY_KEY], undefined);
    const { errors: nextErrors } = parseStrict(nextText);
    if (nextErrors.length > 0) {
      errorLog('FAIL Generated config failed validation after removal; aborting without writing.');
      return 1;
    }
    if (options.dryRun) {
      log(`DRY  Would remove mcp.${ENTRY_KEY} from ${configPath}.`);
      return 0;
    }
    await atomicWrite(configPath, nextText);
    log(`OK   Removed mcp.${ENTRY_KEY} from ${configPath}.`);
    log('     Restart OpenCode for the change to take effect.');
    return 0;
  }

  const desiredEntry = buildDesiredEntry();

  if (existingEntry !== undefined && deepEqual(existingEntry, desiredEntry)) {
    log(`OK   ${ENTRY_KEY} is already installed and up to date in ${configPath}.`);
    return 0;
  }

  if (existingEntry !== undefined && !options.force) {
    errorLog(`SKIP An mcp.${ENTRY_KEY} entry already exists in ${configPath} and differs from the expected configuration.`);
    errorLog('     Re-run with --force to overwrite it, or edit the file manually.');
    return 2;
  }

  const nextText = applyModification(originalText, ['mcp', ENTRY_KEY], desiredEntry);
  const { value: nextValue, errors: nextErrors } = parseStrict(nextText);
  if (nextErrors.length > 0 || !deepEqual(nextValue?.mcp?.[ENTRY_KEY], desiredEntry)) {
    errorLog('FAIL Generated config failed validation; aborting without writing.');
    return 1;
  }

  if (options.dryRun) {
    log(`DRY  Would ${existingEntry === undefined ? 'add' : 'update'} mcp.${ENTRY_KEY} in ${configPath}:`);
    log(JSON.stringify(desiredEntry, null, 2).split('\n').map((line) => `     ${line}`).join('\n'));
    return 0;
  }

  await atomicWrite(configPath, nextText);
  log(`OK   ${existingEntry === undefined ? 'Installed' : 'Updated'} mcp.${ENTRY_KEY} in ${configPath}.`);
  log(`     command: uvx --from ${UVX_FROM} ${ENTRY_KEY}`);
  log('     Native image/video/document reading needs no API key.');
  log('     vision_chat / ocr / grounding / ASR / generation require DASHSCOPE_API_KEY.');
  log('     web_search / web_extractor / image_search require SERPER_API_KEY.');
  log('     Restart OpenCode for the change to take effect.');
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const exitCode = await run({ argv: process.argv.slice(2) });
    process.exitCode = exitCode;
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
