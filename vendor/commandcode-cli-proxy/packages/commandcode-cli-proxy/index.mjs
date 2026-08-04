import http from "node:http";
import { spawn } from "node:child_process";

let serverPromise;

function executable() {
  if (process.env.COMMANDCODE_CLI?.trim()) return process.env.COMMANDCODE_CLI.trim();
  return process.platform === "win32" ? "command-code.cmd" : "command-code";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function runCliOnce(prompt, model) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--skip-onboarding", "--no-auto-update", "--max-turns", "1"];
    if (model) args.push("--model", model);
    const child = spawn(executable(), args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const lines = Buffer.concat(stdout).toString("utf8").split(/\r?\n/).filter(Boolean);
      const result = [...lines].reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((item) => item?.type === "result");
      if (code !== 0 || result?.subtype === "error") {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || result?.error || `CommandCode CLI exited with ${code}`));
        return;
      }
      resolve(result?.finalText ?? "");
    });
    child.stdin.end(prompt);
  });
}

async function runCli(prompt, model) {
  const normalizedModel = typeof model === "string" && model.startsWith("commandcode/")
    ? model.slice("commandcode/".length)
    : model;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await runCliOnce(prompt, normalizedModel);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1 || !/API server encountered|try again|network|timeout/i.test(message)) throw error;
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

async function handler(req, res) {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ object: "list", data: Object.entries(models).map(([id, value]) => ({ id, ...value })) }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404); res.end(); return;
  }
  try {
    const body = JSON.parse(await readBody(req));
    const text = await runCli(promptFromMessages(body.messages ?? []), body.model);
    const id = `chatcmpl-commandcode-${Date.now()}`;
    res.setHeader("content-type", body.stream ? "text/event-stream" : "application/json");
    res.setHeader("cache-control", "no-cache");
    if (body.stream) {
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.end(JSON.stringify({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model ?? "commandcode", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
    }
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "server_error", message: error instanceof Error ? error.message : String(error) } }));
  }
}

async function start() {
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
