import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type OllamaStatus = {
  installed: boolean;
  running: boolean;
  version: string | null;
  models: string[];
  modelPresent: (model: string) => boolean;
};

export type PullProgress = {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
};

const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;

function winGetLinksOllama(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const candidate = path.join(
    localAppData,
    "Microsoft",
    "WinGet",
    "Links",
    "ollama.exe",
  );
  return existsSync(candidate) ? candidate : null;
}

function findOllamaBinary(): string | null {
  const pathSegments = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const segment of pathSegments) {
    const exe = path.join(segment, "ollama.exe");
    if (existsSync(exe)) return exe;
  }
  return winGetLinksOllama();
}

function execFile(
  file: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const { timeoutMs = 15_000 } = options;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      timeout: timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", () =>
      resolve({ stdout, stderr, code: -1 }),
    );
    child.on("close", (code) =>
      resolve({ stdout, stderr, code }),
    );
  });
}

export function isOllamaInstalled(): boolean {
  return findOllamaBinary() !== null;
}

export async function getOllamaVersion(): Promise<string | null> {
  const binary = findOllamaBinary();
  if (!binary) return null;
  const { stdout, code } = await execFile(binary, ["--version"]);
  if (code !== 0) return null;
  const match = stdout.trim().match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : stdout.trim() || null;
}

export async function listOllamaModels(): Promise<string[]> {
  const binary = findOllamaBinary();
  if (!binary) return [];
  const { stdout, code } = await execFile(binary, ["list"]);
  if (code !== 0) return [];
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  // The first line is a header (NAME / ID / SIZE / MODIFIED).
  return lines.slice(1).map((line) => line.split(/\s+/)[0] ?? "").filter(Boolean);
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const installed = isOllamaInstalled();
  if (!installed) {
    return {
      installed: false,
      running: false,
      version: null,
      models: [],
      modelPresent: () => false,
    };
  }
  const [version, models] = await Promise.all([
    getOllamaVersion(),
    listOllamaModels(),
  ]);
  return {
    installed: true,
    running: await isOllamaRunning(),
    version,
    models,
    modelPresent: (model) =>
      models.some((entry) => entry === model || entry.startsWith(`${model}:`)),
  };
}

export type OllamaModelCapabilities = {
  vision: boolean;
  tools: boolean;
};

/**
 * Ollama 自身が申告するモデル能力（`POST /api/show` の `capabilities`）。
 * 画像対応をモデル名から推測するより確実なので、登録時はこちらを優先する。
 * デーモン停止・旧バージョン・未知の応答形状では `null` を返し、
 * 呼び出し側の名前ヒューリスティックへフォールバックさせる。
 */
export async function fetchOllamaModelCapabilities(
  model: string,
): Promise<OllamaModelCapabilities | null> {
  const name = model.trim();
  if (!name) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as
      | { capabilities?: unknown }
      | null;
    const capabilities = payload?.capabilities;
    if (!Array.isArray(capabilities)) return null;
    const values = capabilities.map((entry) => String(entry).toLowerCase());
    return {
      vision: values.includes("vision"),
      tools: values.includes("tools"),
    };
  } catch {
    return null;
  }
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function pullOllamaModel(
  model: string,
  onProgress?: (progress: PullProgress) => void,
): Promise<void> {
  const binary = findOllamaBinary();
  if (!binary) throw new Error("Ollama is not installed");
  const trimmed = model.trim();
  if (!trimmed) throw new Error("model name is required");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["pull", trimmed], {
      windowsHide: true,
    });
    let lastError = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk ?? "");
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Partial<PullProgress>;
          onProgress?.({
            status: String(parsed.status ?? ""),
            digest: parsed.digest,
            total: parsed.total,
            completed: parsed.completed,
          });
        } catch {
          // Non-JSON output (e.g. progress text) is ignored.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      lastError += String(chunk ?? "");
    });
    child.on("error", (err) =>
      reject(new Error(`Ollama pull failed: ${err.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Ollama pull failed${lastError.trim() ? `: ${lastError.trim()}` : ""}`,
          ),
        );
    });
  });
}

export async function installOllama(): Promise<{ installed: boolean; message: string }> {
  if (process.platform !== "win32") {
    return {
      installed: false,
      message: "Automatic Ollama install is supported on Windows only",
    };
  }
  if (isOllamaInstalled()) {
    return { installed: true, message: "Ollama is already installed" };
  }
  const wingetResult = await execFile("winget", [
    "install",
    "--id",
    "Ollama.Ollama",
    "--exact",
    "--source",
    "winget",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity",
  ], { timeoutMs: 180_000 });
  if (wingetResult.code !== 0) {
    return {
      installed: false,
      message: `winget install failed${wingetResult.stderr.trim() ? `: ${wingetResult.stderr.trim()}` : ""}`,
    };
  }
  return { installed: true, message: "Ollama installed successfully" };
}