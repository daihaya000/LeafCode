import http from "node:http";
import { spawn } from "node:child_process";

let serverPromise;

function executable() {
  if (process.env.COMMANDCODE_CLI?.trim()) return process.env.COMMANDCODE_CLI.trim();
  return process.platform === "win32" ? "command-code.cmd" : "command-code";
}

// Default CLI timeout. Without this, a hung `command-code` process (waiting
// on a permission prompt, a dead network call, etc.) leaves the request
// pending forever: OpenCode sees the connection as "not responding" rather
// than a clean error. Override with COMMANDCODE_CLI_TIMEOUT_MS for slower
// models/machines.
const DEFAULT_TIMEOUT_MS = 120_000;

export function computeTimeoutMs(env = process.env) {
  const raw = env.COMMANDCODE_CLI_TIMEOUT_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

// A timeout/abort is not a transient server-side error: retrying just makes
// the caller wait 2x as long for the same hang. Only retry errors that look
// like a one-off blip from the CLI's own upstream call.
export function isRetryableError(message) {
  return /API server encountered|try again|network/i.test(String(message ?? ""));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// On Windows, spawn(..., { shell: true }) makes cmd.exe the direct child;
// child.kill() only terminates cmd.exe and leaves the real command-code
// process (and anything it spawned) running. taskkill /t kills the whole
// tree. Best-effort: if taskkill itself fails, fall back to a plain kill.
function killTree(child) {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      return;
    } catch {
      // fall through to plain kill
    }
  }
  try {
    child.kill();
  } catch {
    // process may already be gone
  }
}

class CommandCodeCliError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

function runCliOnce(prompt, model, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CommandCodeCliError("aborted"));
      return;
    }
    const args = ["-p", "--output-format", "json", "--skip-onboarding", "--no-auto-update", "--max-turns", "1"];
    if (model) args.push("--model", model);
    const child = spawn(executable(), args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const stdout = [];
    const stderr = [];
    let settled = false;

    const timeoutMs = computeTimeoutMs();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child);
      reject(new CommandCodeCliError(`CommandCode CLI timed out after ${timeoutMs}ms`, { retryable: false }));
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child);
      reject(new CommandCodeCliError("aborted", { retryable: false }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const lines = Buffer.concat(stdout).toString("utf8").split(/\r?\n/).filter(Boolean);
      const result = [...lines].reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((item) => item?.type === "result");
      if (code !== 0 || result?.subtype === "error") {
        const message = Buffer.concat(stderr).toString("utf8").trim() || result?.error || `CommandCode CLI exited with ${code}`;
        reject(new CommandCodeCliError(message, { retryable: isRetryableError(message) }));
        return;
      }
      resolve(result?.finalText ?? "");
    });
    try {
      child.stdin.end(prompt);
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    }
  });
}

async function runCli(prompt, model, signal) {
  const normalizedModel = typeof model === "string" && model.startsWith("commandcode/")
    ? model.slice("commandcode/".length)
    : model;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await runCliOnce(prompt, normalizedModel, signal);
    } catch (error) {
      lastError = error;
      if (signal?.aborted || attempt === 1 || error?.retryable !== true) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

function promptFromMessages(messages) {
  return messages.map((message) => {
    const content = Array.isArray(message.content)
      ? message.content.map((part) => typeof part === "string" ? part : part?.text ?? "").join("\n")
      : String(message.content ?? "");
    return `[${message.role}]\n${content}`;
  }).join("\n\n");
}

const models = Object.fromEntries([
  ["deepseek/deepseek-v4-pro", "DeepSeek V4 Pro"],
  ["deepseek/deepseek-v4-flash", "DeepSeek V4 Flash"],
  ["zai-org/GLM-5.2", "GLM-5.2"],
  ["moonshotai/Kimi-K2.5", "Kimi K2.5"],
].map(([id, name]) => [id, { name, object: "model", created: 0, owned_by: "commandcode" }]));

// OpenAI-compatible streaming requires a terminal chunk carrying a non-null
// finish_reason before `[DONE]`; without it, well-behaved clients (including
// the AI SDK) never observe a "stop" and can leave the turn looking
// unfinished (spinner stuck, usage/finish callbacks never fire).
export function chatCompletionChunks(id, text) {
  return [
    { id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
}

async function handler(req, res) {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ object: "list", data: Object.entries(models).map(([id, value]) => ({ id, ...value })) }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404); res.end(); return;
  }
  const controller = new AbortController();
  // If the client disconnects mid-request, stop wasting a CLI process on a
  // response nobody will read. Note: `req`'s own "close" fires as soon as
  // the request body finishes being read (i.e. on every normal request,
  // well before we've sent a response) -- it does NOT mean the client went
  // away. `res`'s "close" is the one that actually means "the response
  // will never be delivered", so guard on writableEnded to skip the normal
  // post-completion close.
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", onClose);
  try {
    const body = JSON.parse(await readBody(req));
    const text = await runCli(promptFromMessages(body.messages ?? []), body.model, controller.signal);
    const id = `chatcmpl-commandcode-${Date.now()}`;
    if (res.writableEnded) return;
    res.setHeader("content-type", body.stream ? "text/event-stream" : "application/json");
    res.setHeader("cache-control", "no-cache");
    if (body.stream) {
      for (const chunk of chatCompletionChunks(id, text)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    } else {
      res.end(JSON.stringify({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model ?? "commandcode", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
    }
  } catch (error) {
    if (res.writableEnded) return;
    try {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "server_error", message: error instanceof Error ? error.message : String(error) } }));
    } catch {
      // response may already be unusable if the client disconnected
    }
  } finally {
    res.off("close", onClose);
  }
}

// Exported for tests only, so they can grab the underlying net.Server and
// call server.close() afterwards -- otherwise each test that re-imports this
// module (to get a fresh serverPromise) leaves a listening HTTP server
// behind, and a listening server keeps Node's event loop alive, so
// `node --test` never exits.
export async function start() {
  if (!serverPromise) serverPromise = new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
  return serverPromise;
}

export default async function commandcodeCliPlugin() {
  const server = await start();
  const port = server.address().port;
  const baseURL = `http://127.0.0.1:${port}/v1`;
  const provider = { npm: "@ai-sdk/openai-compatible", name: "CommandCode", options: { apiKey: "commandcode-cli", baseURL }, models };
  return {
    provider: { commandcode: provider },
    auth: { provider: "commandcode", loader: async () => ({ apiKey: "commandcode-cli", baseURL }), methods: [] },
    config: async (config) => {
      config.provider ??= {};
      config.provider.commandcode = provider;
    },
  };
}
