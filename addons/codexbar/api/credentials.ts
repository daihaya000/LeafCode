import { acquireConfigLock, readConfig, versionOf, writeConfig, type ConfigFile } from "./providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREDENTIALS = [
  { id: "commandcode", name: "Command Code", configKey: "commandCodeApiKey" },
  { id: "qwen-cloud", name: "Qwen Cloud", configKey: "qwenCloudApiKey" },
  { id: "synthetic", name: "Synthetic", configKey: "syntheticApiKey" },
] as const;

type Credential = (typeof CREDENTIALS)[number];

class CredentialError extends Error {}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function safeError(error: unknown, status = 503): Response {
  return json({ error: error instanceof CredentialError ? error.message : "認証情報を更新できません" }, status);
}

function catalog(config: ConfigFile) {
  return CREDENTIALS.map(({ id, name, configKey }) => ({
    id,
    name,
    configured: typeof config[configKey] === "string" && config[configKey].trim().length > 0,
  }));
}

function credential(id: string): Credential | undefined {
  return CREDENTIALS.find((item) => item.id === id);
}

export async function GET() {
  try {
    const current = await readConfig();
    return json({ credentials: catalog(current.config), version: versionOf(current.text) });
  } catch (error) {
    return safeError(error);
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON 本文が不正です" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "認証情報が不正です" }, 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["providerId", "apiKey", "version"].includes(key))) {
    return json({ error: "providerId、apiKey、version を指定してください" }, 400);
  }
  const provider = typeof input.providerId === "string" ? credential(input.providerId) : undefined;
  if (!provider || typeof input.apiKey !== "string" || typeof input.version !== "string") {
    return json({ error: "providerId、apiKey、version を指定してください" }, 400);
  }
  const apiKey = input.apiKey.trim();
  if (apiKey.length > 4096 || /[\r\n]/.test(apiKey)) return json({ error: "API キーの形式が不正です" }, 400);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireConfigLock();
    const current = await readConfig();
    if (versionOf(current.text) !== input.version) return json({ error: "設定が他で変更されました。再読み込みしてください" }, 409);
    const updated = { ...current.config };
    if (apiKey) updated[provider.configKey] = apiKey;
    else delete updated[provider.configKey];
    await writeConfig(updated);
    const text = `${JSON.stringify(updated, null, 2)}\n`;
    return json({ credentials: catalog(updated), version: versionOf(text) });
  } catch (error) {
    return safeError(error);
  } finally {
    await release?.();
  }
}
