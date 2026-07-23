import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_CATALOG = [
  { id: "codex", name: "Codex" },
  { id: "claude", name: "Claude" },
  { id: "opencode-go", name: "OpenCode" },
  { id: "ollama", name: "Ollama" },
  { id: "cursor", name: "Cursor" },
  { id: "qwen-cloud", name: "Qwen Cloud" },
  { id: "synthetic", name: "Synthetic" },
] as const;

type ProviderId = (typeof PROVIDER_CATALOG)[number]["id"];
type CatalogProvider = (typeof PROVIDER_CATALOG)[number] & {
  enabled: boolean;
  configurable: boolean;
};

type ConfigFile = Record<string, unknown>;

const providerIds = new Set<string>(PROVIDER_CATALOG.map((provider) => provider.id));
const defaultEnabledProviders: ProviderId[] = ["codex", "claude", "cursor"];
const LOCK_RETRY_COUNT = 25;
const LOCK_RETRY_DELAY_MS = 20;

class ConfigError extends Error {}

function configPath(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "CodexBar", "config.json");
}

function configLockPath(): string {
  return `${configPath()}.providers.lock`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Serialize writers from all WebUI processes. The lock lives beside the fixed
 * config file, is created exclusively, and is always released by the owner.
 */
async function acquireConfigLock(): Promise<() => Promise<void>> {
  const lockFile = configLockPath();
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
    try {
      const handle = await fs.open(lockFile, "wx", 0o600);
      return async () => {
        await handle.close().catch(() => undefined);
        await fs.unlink(lockFile).catch(() => undefined);
      };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== "EEXIST" || attempt === LOCK_RETRY_COUNT - 1) {
        throw new ConfigError("CodexBar の設定更新をロックできません");
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  throw new ConfigError("CodexBar の設定更新をロックできません");
}

function versionOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isConfigFile(value: unknown): value is ConfigFile {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function enabledFromConfig(config: ConfigFile): ProviderId[] {
  const raw = config.enabledProviders;
  if (raw === undefined) return [...defaultEnabledProviders];
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !providerIds.has(id))) {
    throw new ConfigError("CodexBar のプロバイダー設定が不正です");
  }
  return [...new Set(raw)] as ProviderId[];
}

async function readConfig(): Promise<{ text: string; config: ConfigFile; enabled: ProviderId[] }> {
  const file = configPath();
  let text: string;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ConfigError("CodexBar の設定ファイルを安全に読み込めません");
    }
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("CodexBar の設定ファイルを読み込めません");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigError("CodexBar の設定ファイルが不正です");
  }
  if (!isConfigFile(value)) {
    throw new ConfigError("CodexBar の設定ファイルが不正です");
  }

  return { text, config: value, enabled: enabledFromConfig(value) };
}

function catalog(enabled: readonly ProviderId[]): CatalogProvider[] {
  const active = new Set(enabled);
  return PROVIDER_CATALOG.map((provider) => ({
    ...provider,
    enabled: active.has(provider.id),
    configurable: true,
  }));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function safeError(error: unknown, status = 503): Response {
  const message = error instanceof ConfigError ? error.message : "CodexBar の設定を更新できません";
  return json({ error: message }, status);
}

function isUpdateRequest(value: unknown): value is {
  providerId: ProviderId;
  enabled: boolean;
  version: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  return keys.length === 3
    && keys.every((key) => key === "providerId" || key === "enabled" || key === "version")
    && typeof body.providerId === "string"
    && providerIds.has(body.providerId)
    && typeof body.enabled === "boolean"
    && typeof body.version === "string";
}

async function writeConfig(config: ConfigFile): Promise<void> {
  const file = configPath();
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

/** Safe catalog only: no credentials or other config values leave this process. */
export async function GET() {
  try {
    const current = await readConfig();
    return json({
      providers: catalog(current.enabled),
      version: versionOf(current.text),
    });
  } catch (error) {
    return safeError(error);
  }
}

/**
 * Update only enabledProviders. Reads and verifies the fixed AppData config
 * immediately before an atomic replacement, preserving every other setting.
 */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON 本文が不正です" }, 400);
  }
  if (!isUpdateRequest(body)) {
    return json({ error: "providerId、enabled、version を指定してください" }, 400);
  }

  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireConfigLock();
    // Re-read only after acquiring the cross-process lock. A request can be
    // stale while waiting behind a writer in another WebUI process.
    const current = await readConfig();
    if (versionOf(current.text) !== body.version) {
      return json({ error: "設定が他で変更されました。再読み込みしてください" }, 409);
    }

    const next = new Set(current.enabled);
    if (body.enabled) next.add(body.providerId);
    else next.delete(body.providerId);
    if (next.size === 0) {
      return json({ error: "少なくとも 1 つのプロバイダーを有効にしてください" }, 400);
    }

    const enabled = PROVIDER_CATALOG
      .map((provider) => provider.id)
      .filter((id) => next.has(id));
    const updated = { ...current.config, enabledProviders: enabled };
    await writeConfig(updated);
    const text = `${JSON.stringify(updated, null, 2)}\n`;
    return json({ providers: catalog(enabled), version: versionOf(text) });
  } catch (error) {
    return safeError(error);
  } finally {
    await releaseLock?.();
  }
}
