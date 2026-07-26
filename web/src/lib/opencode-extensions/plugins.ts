import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PluginDto } from "../extensions";
import {
  applyEdits,
  atomicWriteFile,
  detectFormatting,
  getPluginArray,
  insertPluginEntryInContent,
  modify,
  readConfigContent,
  removePluginEntryInContent,
  withConfigLock,
} from "./jsonc-edit";
import {
  extensionsStatePath,
  opencodeConfigFilePath,
  pluginDir,
  pluginDisabledDir,
} from "./paths";
import {
  ExtensionsError,
  assertValidEntryName,
  moveEntrySafe,
  resolveContainedPath,
} from "./safe-move";

const CONFIG_ID_PREFIX = "config:";
const LOCAL_ID_PREFIX = "local:";
const LOCAL_FILE_RE = /\.(js|ts)$/;
const HASH_RE = /^[0-9a-f]{16}$/;

/**
 * One disabled configured plugin, persisted in WebUI-local state.
 * `value` is the original plugin entry (string or tuple) and `index` its
 * original position, so re-enabling restores it in place.
 */
type StateEntry = { id: string; value: unknown; index: number; disabledAt: string };
type StateFile = { disabledPlugins: StateEntry[] };

function valueHash(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value) ?? "")
    .digest("hex")
    .slice(0, 16);
}

function configPluginId(value: unknown, index: number): string {
  return `${CONFIG_ID_PREFIX}${valueHash(value)}.${index}`;
}

function parseConfigPluginId(
  id: string,
): { hash: string; index: number } | null {
  if (!id.startsWith(CONFIG_ID_PREFIX)) return null;
  const body = id.slice(CONFIG_ID_PREFIX.length);
  const dot = body.lastIndexOf(".");
  if (dot < 0) return null;
  const hash = body.slice(0, dot);
  const index = Number(body.slice(dot + 1));
  if (!HASH_RE.test(hash) || !Number.isInteger(index) || index < 0) return null;
  return { hash, index };
}

/**
 * Display info for a plugin entry. Tuple options are never forwarded to the
 * client (they may hold credentials); only the tuple's name is shown.
 */
function describePluginValue(value: unknown): {
  name: string;
  hasOptions?: boolean;
} {
  if (typeof value === "string") {
    return { name: value.length > 120 ? `${value.slice(0, 120)}…` : value };
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return { name: value[0], hasOptions: value.length > 1 };
  }
  // Schema-invalid shape; do not serialize it (could embed secrets).
  return { name: "(unsupported plugin entry)" };
}

function isValidStateEntry(entry: unknown): entry is StateEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.index === "number" &&
    Number.isInteger(e.index) &&
    "value" in e
  );
}

function readStateFile(): StateFile {
  let raw: string;
  try {
    raw = fs.readFileSync(extensionsStatePath(), "utf8");
  } catch (err) {
    // Absence is normal (first run); anything else is worth diagnosing.
    // Either way the caller falls back to "nothing disabled" — the config
    // file remains the source of truth, so this never blocks the listing.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[extensions] 拡張機能の状態ファイルを読み込めません", err);
    }
    return { disabledPlugins: [] };
  }
  try {
    const parsed = JSON.parse(raw) as { disabledPlugins?: unknown };
    const list = Array.isArray(parsed.disabledPlugins)
      ? parsed.disabledPlugins.filter(isValidStateEntry)
      : [];
    return { disabledPlugins: list };
  } catch (err) {
    console.warn("[extensions] 拡張機能の状態ファイルが壊れているため無視します", err);
    return { disabledPlugins: [] };
  }
}

async function writeStateFile(state: StateFile): Promise<void> {
  await atomicWriteFile(
    extensionsStatePath(),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

async function scanLocalPlugins(
  dir: string,
  enabled: boolean,
): Promise<PluginDto[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && LOCAL_FILE_RE.test(e.name))
    .map((e) => ({
      id: `${LOCAL_ID_PREFIX}${e.name}`,
      name: e.name,
      kind: "local" as const,
      enabled,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toConfiguredDto(
  value: unknown,
  id: string,
  enabled: boolean,
  managedByWebui: boolean,
): PluginDto {
  const info = describePluginValue(value);
  const dto: PluginDto = { id, name: info.name, kind: "config", enabled };
  if (info.hasOptions) dto.hasOptions = true;
  if (managedByWebui) dto.managedByWebui = true;
  return dto;
}

/**
 * Read config and state under the process lock and prune stale disabled
 * records. The config file is the source of truth: if a "disabled" entry's
 * value is present in the config again (manually re-added), drop the record.
 *
 * The read-modify-write of the state file must run inside the same lock as
 * the toggles: a disable transiently writes the state record *before* the
 * config removal, so a listing that read the config before the lock could
 * see "record + value still in config", misread it as a manual re-add, and
 * overwrite the fresh record (lost update). Under the lock the prune only
 * ever observes a config/state pair consistent at some lock boundary.
 */
async function loadConfiguredSnapshot(): Promise<{
  configured: unknown[];
  state: StateFile;
}> {
  return withConfigLock(async () => {
    const content = readConfigContent(opencodeConfigFilePath());
    const configured = getPluginArray(content) ?? [];
    const state = readStateFile();
    const configHashes = new Set(configured.map((v) => valueHash(v)));
    const pruned = state.disabledPlugins.filter(
      (e) => !configHashes.has(valueHash(e.value)),
    );
    if (pruned.length === state.disabledPlugins.length) {
      return { configured, state };
    }
    const next: StateFile = { disabledPlugins: pruned };
    await writeStateFile(next);
    return { configured, state: next };
  });
}

export async function listPlugins(): Promise<PluginDto[]> {
  const { configured, state } = await loadConfiguredSnapshot();

  const result: PluginDto[] = [];
  configured.forEach((value, index) => {
    result.push(toConfiguredDto(value, configPluginId(value, index), true, false));
  });
  for (const entry of state.disabledPlugins) {
    result.push(toConfiguredDto(entry.value, entry.id, false, true));
  }
  result.push(...(await scanLocalPlugins(pluginDir(), true)));
  result.push(...(await scanLocalPlugins(pluginDisabledDir(), false)));
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validatePluginName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ExtensionsError("invalid-name", "プラグイン名を入力してください");
  return trimmed;
}

function validatePluginOptions(options: unknown): Record<string, unknown> | undefined {
  if (options === undefined) return undefined;
  if (!isRecord(options)) {
    throw new ExtensionsError("invalid-name", "オプションはJSONオブジェクトで入力してください");
  }
  return options;
}

function ensureConfigFileExists(filePath: string): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(
      filePath,
      '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
      { encoding: "utf8", flag: "wx" },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

/**
 * Append a new entry to `plugin` in `opencode.jsonc`: a plain npm spec (or
 * local path) string, or a `[name, options]` tuple when options are given.
 */
export async function addConfiguredPlugin(input: {
  name: string;
  options?: unknown;
}): Promise<void> {
  const name = validatePluginName(input.name);
  const options = validatePluginOptions(input.options);
  const value = options !== undefined ? [name, options] : name;
  const filePath = opencodeConfigFilePath();
  ensureConfigFileExists(filePath);
  await withConfigLock(async () => {
    const content = readConfigContent(filePath);
    const configured = getPluginArray(content) ?? [];
    const next = insertPluginEntryInContent(content, configured.length, value);
    await atomicWriteFile(filePath, next);
  });
}

/**
 * Replace a configured plugin's name/options in place (same array index).
 * When `options` is omitted, the entry's existing options (if any) are kept
 * unchanged — the client never receives them (they may hold credentials),
 * so "leave the options field blank" means "don't touch them".
 */
export async function updateConfiguredPlugin(
  id: string,
  input: { name: string; options?: unknown },
): Promise<void> {
  const name = validatePluginName(input.name);
  const options = validatePluginOptions(input.options);
  const parsed = parseConfigPluginId(id);
  if (!parsed) {
    throw new ExtensionsError("invalid-name", "プラグインIDが不正です");
  }
  await withConfigLock(async () => {
    const filePath = opencodeConfigFilePath();
    const content = readConfigContent(filePath);
    const configured = getPluginArray(content) ?? [];
    const index =
      parsed.index < configured.length &&
      valueHash(configured[parsed.index]) === parsed.hash
        ? parsed.index
        : configured.findIndex((v) => valueHash(v) === parsed.hash);
    if (index < 0) {
      throw new ExtensionsError("not-found", "指定のプラグインが見つかりません");
    }
    const current = configured[index];
    const keptOptions =
      options ?? (Array.isArray(current) && isRecord(current[1]) ? current[1] : undefined);
    const value = keptOptions !== undefined ? [name, keptOptions] : name;
    const edits = modify(content, ["plugin", index], value, {
      formattingOptions: detectFormatting(content),
    });
    await atomicWriteFile(filePath, applyEdits(content, edits));
  });
}

async function setLocalPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const filename = id.slice(LOCAL_ID_PREFIX.length);
  assertValidEntryName(filename);
  if (!LOCAL_FILE_RE.test(filename)) {
    throw new ExtensionsError("invalid-name", "プラグイン名が不正です");
  }
  const fromRoot = enabled ? pluginDisabledDir() : pluginDir();
  const toRoot = enabled ? pluginDir() : pluginDisabledDir();
  const from = resolveContainedPath(fromRoot, filename);
  const to = resolveContainedPath(toRoot, filename);
  await moveEntrySafe(from, to, "file");
}

async function setConfiguredPluginEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const parsed = parseConfigPluginId(id);
  if (!parsed) {
    throw new ExtensionsError("invalid-name", "プラグインIDが不正です");
  }
  await withConfigLock(async () => {
    const filePath = opencodeConfigFilePath();
    const state = readStateFile();
    const content = readConfigContent(filePath);
    const configured = getPluginArray(content) ?? [];

    if (enabled) {
      const entry = state.disabledPlugins.find((e) => e.id === id);
      if (!entry) {
        throw new ExtensionsError("not-found", "指定のプラグインが見つかりません");
      }
      // Config first: if the state cleanup then fails, the next listing
      // reconciles (value present in config → stale record pruned).
      const next = insertPluginEntryInContent(content, entry.index, entry.value);
      await atomicWriteFile(filePath, next);
      await writeStateFile({
        disabledPlugins: state.disabledPlugins.filter((e) => e.id !== id),
      });
      return;
    }

    // Disable: locate by hash, preferring the index encoded in the id.
    const index =
      parsed.index < configured.length &&
      valueHash(configured[parsed.index]) === parsed.hash
        ? parsed.index
        : configured.findIndex((v) => valueHash(v) === parsed.hash);
    if (index < 0) {
      throw new ExtensionsError("not-found", "指定のプラグインが見つかりません");
    }
    const { content: next, removed } = removePluginEntryInContent(content, index);
    // State first: if the config write then fails, the next listing prunes
    // the record (value still in config) — nothing can be lost.
    const record: StateEntry = {
      id: configPluginId(removed, index),
      value: removed,
      index,
      disabledAt: new Date().toISOString(),
    };
    await writeStateFile({
      disabledPlugins: [
        ...state.disabledPlugins.filter(
          (e) => valueHash(e.value) !== valueHash(removed),
        ),
        record,
      ],
    });
    await atomicWriteFile(filePath, next);
  });
}

export async function setPluginEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  if (typeof id !== "string") {
    throw new ExtensionsError("invalid-name", "プラグインIDが不正です");
  }
  if (id.startsWith(LOCAL_ID_PREFIX)) {
    await setLocalPluginEnabled(id, enabled);
    return;
  }
  await setConfiguredPluginEnabled(id, enabled);
}
