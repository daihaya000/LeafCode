import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PluginDto } from "../extensions";
import {
  atomicWriteFile,
  getPluginArray,
  insertPluginEntryInContent,
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
  try {
    const raw = fs.readFileSync(extensionsStatePath(), "utf8");
    const parsed = JSON.parse(raw) as { disabledPlugins?: unknown };
    const list = Array.isArray(parsed.disabledPlugins)
      ? parsed.disabledPlugins.filter(isValidStateEntry)
      : [];
    return { disabledPlugins: list };
  } catch {
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

export async function listPlugins(): Promise<PluginDto[]> {
  const content = readConfigContent(opencodeConfigFilePath());
  const configured = getPluginArray(content) ?? [];
  let state = readStateFile();

  // The config file is the source of truth: if a "disabled" entry's value is
  // present in the config again (manually re-added), drop the stale record.
  const configHashes = new Set(configured.map((v) => valueHash(v)));
  const pruned = state.disabledPlugins.filter(
    (e) => !configHashes.has(valueHash(e.value)),
  );
  if (pruned.length !== state.disabledPlugins.length) {
    state = { disabledPlugins: pruned };
    await writeStateFile(state);
  }

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
