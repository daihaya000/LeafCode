import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/plugin-toggle.ts
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
function matchesPlugin(entry) {
  if (entry === CURSOR_PROVIDER_ID)
    return true;
  if (entry === NPM_PACKAGE_NAME)
    return true;
  if (entry.startsWith(`${NPM_PACKAGE_NAME}@`))
    return true;
  return false;
}
function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inStr = false;
  let quote = "";
  let escaped = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[\]}])/g, "$1");
}
function parseOpenCodeConfigText(raw) {
  try {
    return JSON.parse(stripJsonc(raw));
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
var DEFAULT_SUBAGENT_NAMES = ["general", "explore", "scout"];
function resolveOpenCodeConfigPath(env = process.env) {
  if (env.OPENCODE_CONFIG && env.OPENCODE_CONFIG.length > 0) {
    return resolve(env.OPENCODE_CONFIG);
  }
  const configHome = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(homedir(), ".config");
  const dir = join(configHome, "opencode");
  const jsoncPath = join(dir, "opencode.jsonc");
  const jsonPath = join(dir, "opencode.json");
  if (existsSync(jsoncPath)) return jsoncPath;
  return jsonPath;
}
function isCursorPluginEnabledInConfig(config) {
  if (!config || typeof config !== "object") {
    return true;
  }
  const configObject = config;
  if (configObject.provider && typeof configObject.provider === "object") {
    if (CURSOR_PROVIDER_ID in configObject.provider) {
      return true;
    }
  }
  if (Array.isArray(configObject.plugin)) {
    return configObject.plugin.some((entry) => matchesPlugin(entry));
  }
  return true;
}
function shouldEnableCursorPlugin(env = process.env) {
  const configPath = resolveOpenCodeConfigPath(env);
  if (!existsSync(configPath)) {
    return {
      enabled: true,
      configPath,
      reason: "config_missing"
    };
  }
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = parseOpenCodeConfigText(raw);
    const enabled = isCursorPluginEnabledInConfig(parsed);
    return {
      enabled,
      configPath,
      reason: enabled ? "enabled" : "disabled_in_plugin_array"
    };
  } catch {
    return {
      enabled: true,
      configPath,
      reason: "config_unreadable_or_invalid"
    };
  }
}
var CURSOR_PROVIDER_ID = "cursor", NPM_PACKAGE_NAME = "@rama_nigg/open-cursor";
var init_plugin_toggle = () => {};

// src/utils/logger.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
function getConfiguredLevel() {
  const env = process.env.CURSOR_ACP_LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_PRIORITY) {
    return env;
  }
  return "info";
}
function isSilent() {
  return process.env.CURSOR_ACP_LOG_SILENT === "1" || process.env.CURSOR_ACP_LOG_SILENT === "true";
}
function shouldLog(level) {
  if (isSilent())
    return false;
  const configured = getConfiguredLevel();
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[configured];
}
function formatMessage(level, component, message, data) {
  const prefix = `[cursor-acp:${component}]`;
  const levelTag = level.toUpperCase().padEnd(5);
  let formatted = `${prefix} ${levelTag} ${message}`;
  if (data !== undefined) {
    if (typeof data === "object") {
      formatted += ` ${JSON.stringify(data)}`;
    } else {
      formatted += ` ${data}`;
    }
  }
  return formatted;
}
function isConsoleEnabled() {
  const consoleEnv = process.env.CURSOR_ACP_LOG_CONSOLE;
  return consoleEnv === "1" || consoleEnv === "true";
}
function getLogDir() {
  const override = process.env.CURSOR_ACP_LOG_DIR?.trim();
  return override || path.join(os.homedir(), ".opencode-cursor");
}
function getLogFile() {
  return path.join(getLogDir(), "plugin.log");
}
function ensureLogDir() {
  if (logDirEnsured)
    return;
  try {
    const logDir = getLogDir();
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    logDirEnsured = true;
  } catch {
    logFileError = true;
  }
}
function openLogStream() {
  if (logStream || logFileError)
    return;
  ensureLogDir();
  if (logFileError)
    return;
  try {
    try {
      logBytesWritten = fs.statSync(getLogFile()).size;
    } catch {
      logBytesWritten = 0;
    }
    logStream = fs.createWriteStream(getLogFile(), { flags: "a" });
    logStream.on("error", () => {
      if (!logFileError) {
        logFileError = true;
        console.error(`[cursor-acp] Failed to write logs. Using: ${getLogFile()}`);
      }
      logStream = null;
    });
  } catch {
    logFileError = true;
  }
}
function rotateIfNeeded() {
  if (logBytesWritten < MAX_LOG_SIZE)
    return;
  try {
    if (logStream) {
      logStream.end();
      logStream = null;
    }
    const logFile = getLogFile();
    fs.renameSync(logFile, logFile + ".1");
    logBytesWritten = 0;
    openLogStream();
  } catch {
    if (!logFileError && !logStream) {
      openLogStream();
    }
  }
}
function writeToFile(message) {
  if (logFileError)
    return;
  if (!logStream)
    openLogStream();
  if (logFileError || !logStream)
    return;
  rotateIfNeeded();
  if (logFileError || !logStream)
    return;
  const timestamp = new Date().toISOString();
  const line = `${timestamp} ${message}
`;
  logStream.write(line);
  logBytesWritten += Buffer.byteLength(line);
}
function createLogger(component) {
  return {
    isDebugEnabled: () => shouldLog("debug"),
    debug: (message, data) => {
      if (!shouldLog("debug"))
        return;
      const formatted = formatMessage("debug", component, message, data);
      writeToFile(formatted);
      if (isConsoleEnabled())
        console.error(formatted);
    },
    info: (message, data) => {
      if (!shouldLog("info"))
        return;
      const formatted = formatMessage("info", component, message, data);
      writeToFile(formatted);
      if (isConsoleEnabled())
        console.error(formatted);
    },
    warn: (message, data) => {
      if (!shouldLog("warn"))
        return;
      const formatted = formatMessage("warn", component, message, data);
      writeToFile(formatted);
      if (isConsoleEnabled())
        console.error(formatted);
    },
    error: (message, data) => {
      if (!shouldLog("error"))
        return;
      const formatted = formatMessage("error", component, message, data);
      writeToFile(formatted);
      if (isConsoleEnabled())
        console.error(formatted);
    }
  };
}
var MAX_LOG_SIZE, LEVEL_PRIORITY, logDirEnsured = false, logFileError = false, logStream = null, logBytesWritten = 0;
var init_logger = __esm(() => {
  MAX_LOG_SIZE = 5 * 1024 * 1024;
  LEVEL_PRIORITY = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
});

// src/acp/tools.ts
class ToolMapper {
  async mapCursorEventToAcp(event, sessionId) {
    if (event.type !== "tool_call") {
      return [];
    }
    const updates = [];
    const toolCallId = event.call_id || event.tool_call_id || "unknown";
    const subtype = event.subtype || "started";
    if (subtype === "completed" || subtype === "failed") {
      const result = this.extractResult(event.tool_call || {});
      const locations = result.locations?.length ? result.locations : this.extractLocations(event.tool_call || {});
      updates.push({
        sessionId,
        toolCallId,
        title: this.buildToolTitle(event.tool_call || {}),
        kind: this.inferToolType(event.tool_call || {}),
        status: result.error ? "failed" : "completed",
        content: result.content,
        locations,
        rawOutput: result.rawOutput,
        endTime: Date.now()
      });
    } else {
      updates.push({
        sessionId,
        toolCallId,
        title: this.buildToolTitle(event.tool_call || {}),
        kind: this.inferToolType(event.tool_call || {}),
        status: "pending",
        locations: this.extractLocations(event.tool_call || {}),
        startTime: Date.now()
      });
      updates.push({
        sessionId,
        toolCallId,
        status: "in_progress"
      });
    }
    return updates;
  }
  inferToolType(toolCall) {
    const keys = Object.keys(toolCall);
    for (const key of keys) {
      if (key.includes("read"))
        return "read";
      if (key.includes("write"))
        return "edit";
      if (key.includes("grep") || key.includes("glob"))
        return "search";
      if (key.includes("bash") || key.includes("shell"))
        return "execute";
    }
    return "other";
  }
  buildToolTitle(toolCall) {
    const keys = Object.keys(toolCall);
    for (const key of keys) {
      const tool = toolCall[key];
      const args = tool?.args || {};
      if (key.includes("read") && args.path)
        return `Read ${args.path}`;
      if (key.includes("write") && args.path)
        return `Write ${args.path}`;
      if (key.includes("grep")) {
        const pattern = args.pattern || "pattern";
        const path2 = args.path;
        return path2 ? `Search ${path2} for ${pattern}` : `Search for ${pattern}`;
      }
      if (key.includes("glob") && args.pattern)
        return `Glob ${args.pattern}`;
      if ((key.includes("bash") || key.includes("shell")) && (args.command || args.cmd)) {
        return `\`${args.command || args.cmd}\``;
      }
      if ((key.includes("bash") || key.includes("shell")) && args.commands && Array.isArray(args.commands)) {
        return `\`${args.commands.join(" && ")}\``;
      }
    }
    return "other";
  }
  extractLocations(toolCall) {
    const keys = Object.keys(toolCall);
    for (const key of keys) {
      const tool = toolCall[key];
      const args = tool?.args || {};
      if (args.path) {
        if (typeof args.path === "string") {
          return [{ path: args.path, line: args.line }];
        }
        if (Array.isArray(args.path)) {
          return args.path.map((p) => typeof p === "string" ? { path: p } : { path: p.path, line: p.line });
        }
      }
      if (args.paths && Array.isArray(args.paths)) {
        return args.paths.map((p) => typeof p === "string" ? { path: p } : { path: p.path, line: p.line });
      }
    }
    return;
  }
  extractResult(toolCall) {
    const keys = Object.keys(toolCall);
    for (const key of keys) {
      const tool = toolCall[key];
      const result = tool?.result || {};
      if (result.error) {
        return { error: result.error };
      }
      const locations = [];
      if (result.matches && Array.isArray(result.matches)) {
        locations.push(...result.matches.map((m) => ({
          path: m.path,
          line: m.line
        })));
      }
      if (result.files && Array.isArray(result.files)) {
        locations.push(...result.files.map((f) => ({ path: f })));
      }
      if (result.path) {
        locations.push({ path: result.path, line: result.line });
      }
      const content = [];
      if (key.includes("write")) {
        const oldText = result.oldText ?? null;
        const newText = result.newText;
        const path2 = tool?.args?.path || result.path;
        if (newText !== undefined || oldText !== undefined) {
          content.push({
            type: "diff",
            path: path2,
            oldText,
            newText
          });
        }
      }
      if (result.content) {
        content.push({
          type: "content",
          content: { text: result.content }
        });
      }
      if (result.output !== undefined || result.exitCode !== undefined) {
        content.push({
          type: "content",
          content: {
            text: `Exit code: ${result.exitCode ?? 0}
${result.output || "(no output)"}`
          }
        });
      }
      return {
        content: content.length > 0 ? content : undefined,
        locations: locations.length > 0 ? locations : undefined,
        rawOutput: JSON.stringify(result)
      };
    }
    return {};
  }
}

// src/streaming/line-buffer.ts
class LineBuffer {
  buffer = "";
  decoder = new TextDecoder;
  push(chunk) {
    const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk);
    if (!text) {
      return [];
    }
    this.buffer += text;
    const lines = this.buffer.split(`
`);
    this.buffer = lines.pop() ?? "";
    const completed = [];
    for (const line of lines) {
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (!normalized.trim()) {
        continue;
      }
      completed.push(normalized);
    }
    return completed;
  }
  flush() {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const normalized = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
    this.buffer = "";
    if (!normalized.trim()) {
      return [];
    }
    return [normalized];
  }
}

// src/streaming/delta-tracker.ts
class DeltaTracker {
  lastText = "";
  lastThinking = "";
  nextText(value) {
    const delta = this.diff(this.lastText, value);
    this.lastText = value;
    return delta;
  }
  nextThinking(value) {
    const delta = this.diff(this.lastThinking, value);
    this.lastThinking = value;
    return delta;
  }
  reset() {
    this.lastText = "";
    this.lastThinking = "";
  }
  diff(previous, current) {
    if (!previous) {
      return current;
    }
    if (current.startsWith(previous)) {
      return current.slice(previous.length);
    }
    if (previous.startsWith(current)) {
      return "";
    }
    let i = 0;
    const minLen = Math.min(previous.length, current.length);
    while (i < minLen && previous[i] === current[i]) {
      i++;
    }
    return current.slice(i);
  }
}

class MixedDeltaTracker {
  emittedText = "";
  emittedThinking = "";
  nextText(value) {
    const delta = this.diff(this.emittedText, value);
    if (delta) {
      this.emittedText += delta;
    }
    return delta;
  }
  nextThinking(value) {
    const delta = this.diff(this.emittedThinking, value);
    if (delta) {
      this.emittedThinking += delta;
    }
    return delta;
  }
  reset() {
    this.emittedText = "";
    this.emittedThinking = "";
  }
  diff(emitted, current) {
    if (!emitted) {
      return current;
    }
    if (current.startsWith(emitted)) {
      return current.slice(emitted.length);
    }
    if (emitted.startsWith(current)) {
      return "";
    }
    return current;
  }
}

// src/streaming/types.ts
var hasTextContent = (event) => event.message.content.some((content) => content.type === "text"), hasThinkingContent = (event) => event.message.content.some((content) => content.type === "thinking"), isAssistantText = (event) => event.type === "assistant" && hasTextContent(event), isThinking = (event) => {
  if (event.type === "thinking") {
    return true;
  }
  return event.type === "assistant" && hasThinkingContent(event);
}, isToolCall = (event) => event.type === "tool_call", isResult = (event) => event.type === "result", extractText = (event) => event.message.content.filter((content) => content.type === "text").map((content) => content.text).join(""), extractThinking = (event) => {
  if (event.type === "thinking") {
    return event.text ?? "";
  }
  return event.message.content.filter((content) => content.type === "thinking").map((content) => content.thinking).join("");
}, inferToolName = (event) => {
  const [key] = Object.keys(event.tool_call ?? {});
  if (!key) {
    return "";
  }
  if (key.endsWith("ToolCall")) {
    const base = key.slice(0, -"ToolCall".length);
    return base.charAt(0).toLowerCase() + base.slice(1);
  }
  return key;
};

// src/streaming/openai-sse.ts
class StreamToSseConverter {
  id;
  created;
  model;
  tracker = new MixedDeltaTracker;
  constructor(model, options) {
    this.model = model;
    this.id = options?.id ?? `cursor-acp-${Date.now()}`;
    this.created = options?.created ?? Math.floor(Date.now() / 1000);
  }
  handleEvent(event) {
    if (isAssistantText(event)) {
      const text = extractText(event);
      if (!text)
        return [];
      const delta = this.tracker.nextText(text);
      return delta ? [this.chunkWith({ content: delta })] : [];
    }
    if (isThinking(event)) {
      const text = extractThinking(event);
      if (!text)
        return [];
      const delta = this.tracker.nextThinking(text);
      return delta ? [this.chunkWith({ reasoning_content: delta })] : [];
    }
    if (isToolCall(event)) {
      return [this.chunkWith(this.toolCallDelta(event))];
    }
    return [];
  }
  chunkWith(delta) {
    return formatSseChunk(createChunk(this.id, this.created, this.model, delta));
  }
  toolCallDelta(event) {
    const id = event.call_id ?? "unknown";
    const toolName = inferToolName(event) || "tool";
    const toolKey = Object.keys(event.tool_call ?? {})[0];
    const args = toolKey ? event.tool_call[toolKey]?.args : undefined;
    const argumentsText = args ? JSON.stringify(args) : "";
    return {
      tool_calls: [
        {
          index: 0,
          id,
          type: "function",
          function: {
            name: toolName,
            arguments: argumentsText
          }
        }
      ]
    };
  }
}
var createChunk = (id, created, model, delta) => ({
  id,
  object: "chat.completion.chunk",
  created,
  model,
  choices: [
    {
      index: 0,
      delta,
      finish_reason: null
    }
  ]
}), formatSseChunk = (payload) => `data: ${JSON.stringify(payload)}

`, formatSseDone = () => `data: [DONE]

`;
var init_openai_sse = () => {};

// src/streaming/parser.ts
var log, parseStreamJsonLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    log.debug("Failed to parse NDJSON line", { line: trimmed.substring(0, 100) });
    return null;
  }
};
var init_parser = __esm(() => {
  init_logger();
  log = createLogger("streaming:parser");
});

// src/usage.ts
function readTokenCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}
function readOptionalCost(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return;
  }
  return value;
}
function normalizeCursorUsage(value) {
  if (!value || typeof value !== "object") {
    return;
  }
  const usage = value;
  const metrics = {
    inputTokens: readTokenCount(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: readTokenCount(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens),
    reasoningTokens: readTokenCount(usage.reasoningTokens ?? usage.reasoning_tokens),
    cacheReadTokens: readTokenCount(usage.cacheReadTokens ?? usage.cache_read_tokens),
    cacheWriteTokens: readTokenCount(usage.cacheWriteTokens ?? usage.cache_write_tokens)
  };
  const cost = readOptionalCost(usage.cost ?? usage.totalCost ?? usage.total_cost);
  if (cost !== undefined) {
    metrics.cost = cost;
  }
  const hasUsage = metrics.inputTokens > 0 || metrics.outputTokens > 0 || metrics.reasoningTokens > 0 || metrics.cacheReadTokens > 0 || metrics.cacheWriteTokens > 0 || cost !== undefined;
  return hasUsage ? metrics : undefined;
}
function createOpenAiUsage(metrics) {
  const promptTokens = metrics.inputTokens + metrics.cacheReadTokens + metrics.cacheWriteTokens;
  const totalTokens = promptTokens + metrics.outputTokens + metrics.reasoningTokens;
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: metrics.outputTokens,
    total_tokens: totalTokens,
    prompt_tokens_details: {
      cached_tokens: metrics.cacheReadTokens,
      cache_write_tokens: metrics.cacheWriteTokens
    },
    completion_tokens_details: {
      reasoning_tokens: metrics.reasoningTokens
    }
  };
  if (metrics.cost !== undefined) {
    usage.cost = metrics.cost;
  }
  return usage;
}
function extractOpenAiUsageFromResult(event) {
  const metrics = normalizeCursorUsage(event.usage);
  return metrics ? createOpenAiUsage(metrics) : undefined;
}
function createChatCompletionUsageChunk(id, created, model, usage) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [],
    usage
  };
}

// src/utils/perf.ts
function isTimingLogEnabled() {
  const value = process.env.CURSOR_ACP_TIMING?.toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

class RequestPerf {
  markers = [];
  requestId;
  constructor(requestId) {
    this.requestId = requestId;
    this.mark("request:start");
  }
  mark(name) {
    this.markers.push({ name, ts: Date.now() });
  }
  summarize() {
    if (this.markers.length < 2)
      return;
    const start = this.markers[0].ts;
    const phaseTotals = {};
    const timeline = [];
    for (let i = 1;i < this.markers.length; i++) {
      const marker = this.markers[i];
      const deltaMs = marker.ts - this.markers[i - 1].ts;
      phaseTotals[marker.name] = (phaseTotals[marker.name] ?? 0) + deltaMs;
      timeline.push({
        name: marker.name,
        deltaMs,
        atMs: marker.ts - start
      });
    }
    const total = this.markers[this.markers.length - 1].ts - start;
    const summary = { requestId: this.requestId, total, phaseTotals, timeline };
    if (isTimingLogEnabled()) {
      log2.info("Request timing", summary);
    } else {
      log2.debug("Request timing", summary);
    }
    return summary;
  }
  elapsed() {
    return this.markers.length > 0 ? Date.now() - this.markers[0].ts : 0;
  }
  getMarkers() {
    return this.markers;
  }
}
var log2;
var init_perf = __esm(() => {
  init_logger();
  log2 = createLogger("perf");
});

// src/utils/errors.ts
function stripAnsi(str) {
  if (typeof str !== "string")
    return String(str ?? "");
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
function parseAgentError(stderr) {
  const input = typeof stderr === "string" ? stderr : String(stderr ?? "");
  const clean = stripAnsi(input).trim();
  if (clean.includes("usage limit") || clean.includes("hit your usage limit")) {
    const savingsMatch = clean.match(/saved \$(\d+(?:\.\d+)?)/i);
    const resetMatch = clean.match(/reset[^0-9]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const modelMatch = clean.match(/continue with (\w+)/i);
    const details = {};
    if (savingsMatch)
      details.savings = `$${savingsMatch[1]}`;
    if (resetMatch)
      details.resetDate = resetMatch[1];
    if (modelMatch)
      details.affectedModel = modelMatch[1];
    return {
      type: "quota",
      recoverable: false,
      message: clean,
      userMessage: "You've hit your Cursor usage limit",
      details,
      suggestion: "Switch to a different model or set a Spend Limit in Cursor settings"
    };
  }
  if (clean.includes("not logged in") || clean.includes("auth") || clean.includes("unauthorized")) {
    return {
      type: "auth",
      recoverable: false,
      message: clean,
      userMessage: "Not authenticated with Cursor",
      details: {},
      suggestion: "Run: opencode auth login 竊・Other 竊・cursor-acp, or: cursor-agent login"
    };
  }
  if (clean.includes("ECONNREFUSED") || clean.includes("network") || clean.includes("fetch failed")) {
    return {
      type: "network",
      recoverable: true,
      message: clean,
      userMessage: "Connection to Cursor failed",
      details: {},
      suggestion: "Check your internet connection and try again"
    };
  }
  if (clean.includes("model not found") || clean.includes("invalid model") || clean.includes("Cannot use this model")) {
    const modelMatch = clean.match(/Cannot use this model: ([^.]+)/);
    const availableMatch = clean.match(/Available models: (.+)/);
    const details = {};
    if (modelMatch)
      details.requested = modelMatch[1];
    if (availableMatch)
      details.available = availableMatch[1].split(", ").slice(0, 5).join(", ") + "...";
    return {
      type: "model",
      recoverable: false,
      message: clean,
      userMessage: modelMatch ? `Model '${modelMatch[1]}' not available` : "Requested model not available",
      details,
      suggestion: "Use cursor-acp/auto or check available models with: cursor-agent models"
    };
  }
  const recoverable = clean.includes("timeout") || clean.includes("ETIMEDOUT");
  return {
    type: "unknown",
    recoverable,
    message: clean,
    userMessage: clean.substring(0, 200) || "An error occurred",
    details: {}
  };
}
function isTransientContinuation(tail) {
  const trimmed = tail.trim();
  if (!trimmed)
    return false;
  const stripped = trimmed.replace(/^[\s:;,.]+/, "");
  const causalMatch = stripped.match(/^(?:because of|due to)\s+(.+)/i);
  if (causalMatch) {
    const cause = causalMatch[1];
    if (SESSION_SPECIFIC_CAUSE_WORDS.test(cause)) {
      return false;
    }
    if (TRANSIENT_CAUSE_WORDS.test(cause)) {
      return true;
    }
  }
  const firstSegment = stripped.split(/[,;]/)[0]?.trim() ?? "";
  if (firstSegment) {
    if (SESSION_SPECIFIC_CAUSE_WORDS.test(firstSegment)) {
      return false;
    }
    if (TRANSIENT_CAUSE_WORDS.test(firstSegment)) {
      return true;
    }
  }
  if (SESSION_SPECIFIC_CAUSE_WORDS.test(stripped)) {
    return false;
  }
  if (TRANSIENT_CAUSE_WORDS.test(stripped)) {
    return true;
  }
  return TRANSIENT_CONTINUATION_PATTERN.test(tail);
}
function isResumeSpecificFailure(stderr) {
  const text = typeof stderr === "string" ? stderr : String(stderr ?? "");
  const clean = stripAnsi(text);
  for (const pattern of RESUME_FAILURE_PATTERNS) {
    const match = clean.match(pattern);
    if (!match)
      continue;
    const tail = clean.slice(match.index + match[0].length);
    if (!isTransientContinuation(tail)) {
      return true;
    }
  }
  return false;
}
function formatErrorForUser(error) {
  let output = `cursor-acp error: ${error.userMessage || error.message || "Unknown error"}`;
  const details = error.details || {};
  if (Object.keys(details).length > 0) {
    const detailParts = Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(" | ");
    output += `
  ${detailParts}`;
  }
  if (error.suggestion) {
    output += `
  Suggestion: ${error.suggestion}`;
  }
  return output;
}
var BinaryNotFoundError, RESUME_FAILURE_PATTERNS, TRANSIENT_CONTINUATION_PATTERN, TRANSIENT_CAUSE_WORDS, SESSION_SPECIFIC_CAUSE_WORDS;
var init_errors = __esm(() => {
  BinaryNotFoundError = class BinaryNotFoundError extends Error {
    attemptedPath;
    constructor(attemptedPath) {
      super(`cursor-agent binary not found on Windows. Expected at: ${attemptedPath}. ` + `Install Cursor or set CURSOR_AGENT_EXECUTABLE env var.`);
      this.name = "BinaryNotFoundError";
      this.attemptedPath = attemptedPath;
    }
  };
  RESUME_FAILURE_PATTERNS = [
    /\bsession\s+(?:has\s+(?:been\s+)?|is\s+|was\s+)?(?:not\s+found|expired|deleted|missing|no\s+longer\s+exists)/i,
    /\bchat\s+(?:has\s+(?:been\s+)?|is\s+|was\s+)?(?:not\s+found|expired|deleted|missing|no\s+longer\s+exists)/i,
    /\bconversation\s+(?:has\s+(?:been\s+)?|is\s+|was\s+)?(?:not\s+found|expired|deleted|missing|no\s+longer\s+exists)/i,
    /\bthread\s+(?:has\s+(?:been\s+)?|is\s+|was\s+)?(?:not\s+found|expired|deleted|missing|no\s+longer\s+exists)/i,
    /\bresume\s+(?:failed|error|invalid|aborted)(?:\s+(?:session|chat|conversation|thread))?/i,
    /\bfailed\s+to\s+resume(?:\s+(?:session|chat|conversation|thread))?/i,
    /\bcould\s+not\s+resume(?:\s+(?:session|chat|conversation|thread))?/i,
    /\bno\s+active\s+session/i,
    /\bno\s+such\s+session/i,
    /\bno\s+such\s+chat/i,
    /\binvalid\s+(?:session|chat|conversation|thread)(?:\s+id)?/i,
    /\b(?:session|chat|conversation|thread)\s+invalid(?:\s+id)?/i,
    /\b(?:session|chat|conversation|thread)\s+id\s+(?:is\s+)?(?:invalid|not\s+found|expired|missing)/i,
    /\b(?:session|chat|conversation|thread)\s+(?:isn['窶兢t|wasn['窶兢t)\s+found/i,
    /\b(?:session|chat|conversation|thread)\s+(?:can(?:not|\s+not)|could\s+not)\s+(?:be\s+)?resumed/i,
    /\bunable\s+to\s+resume\b/i,
    /\bcan(?:not|\s+not)\s+resume\b/i
  ];
  TRANSIENT_CONTINUATION_PATTERN = /^\s*[:;]?\s*(?:token|credential|credentials|auth|secret|password|format|network|quota|usage|limit|api|key|request(?:_|-|\s+)?id?|due\s+to\s+(?:network|auth|quota)|because\s+of\s+(?:network|auth|quota)|caused\s+by\s+(?:network|auth|quota))/i;
  TRANSIENT_CAUSE_WORDS = /\b(?:auth(?:enticat(?:e|ion|ed))?|re-auth(?:enticate)?|token(?:\s+rotation)?|credential|password|secret|network|connection|internet|offline|quota|usage(?:\s+limit)?|api[\s-]?key|fetch\s+failed|econnrefused|timeout|timed\s+out)\b/i;
  SESSION_SPECIFIC_CAUSE_WORDS = /\b(?:inactiv(?:ity|e)|idle|policy|retention|archiv(?:e|ed)|purged|deleted|removed|expired)\b/i;
});

// src/provider/tool-schema-compat.ts
function buildToolSchemaMap(tools) {
  const schemas = new Map;
  for (const rawTool of tools) {
    const tool = isRecord(rawTool) ? rawTool : null;
    if (!tool) {
      continue;
    }
    const fn = isRecord(tool.function) ? tool.function : tool;
    const name = typeof fn.name === "string" ? fn.name.trim() : "";
    if (!name) {
      continue;
    }
    if (fn.parameters !== undefined) {
      schemas.set(name, fn.parameters);
    }
  }
  return schemas;
}
function applyToolSchemaCompat(toolCall, toolSchemaMap) {
  const parsedArgs = parseArguments(toolCall.function.arguments);
  const originalArgKeys = Object.keys(parsedArgs);
  const schema = toolSchemaMap.get(toolCall.function.name);
  const { normalizedArgs, collisionKeys } = normalizeArgumentKeys(parsedArgs, schema);
  const toolSpecificArgs = normalizeToolSpecificArgs(toolCall.function.name, normalizedArgs, schema);
  const sanitization = sanitizeArgumentsForSchema(toolSpecificArgs, schema);
  const validation = validateToolArguments(toolCall.function.name, sanitization.args, schema, sanitization.unexpected, {
    originalArgs: parsedArgs,
    writeSchema: selectWriteSchemaForTool(toolCall.function.name, toolSchemaMap)
  });
  const normalizedToolCall = {
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: JSON.stringify(sanitization.args)
    }
  };
  return {
    toolCall: normalizedToolCall,
    normalizedArgs: sanitization.args,
    originalArgs: parsedArgs,
    originalArgKeys,
    normalizedArgKeys: Object.keys(sanitization.args),
    collisionKeys,
    validation
  };
}
function isFullFileShapedEditValidationFailure(toolName, args, validation, originalArgs, writeSchema) {
  if (!isToolName(toolName, "edit") || validation.ok) {
    return false;
  }
  return buildEditFullFileHint(args, validation.missing, validation.typeErrors, {
    originalArgs,
    writeSchema
  }) !== null;
}
function buildWriteArguments(filePath, content, writeSchema, writeToolName = "write") {
  if (!isRecord(writeSchema)) {
    return isToolName(writeToolName, "write") && writeToolName.toLowerCase().startsWith("oc_") ? { path: filePath, content } : { filePath, content };
  }
  const required = Array.isArray(writeSchema.required) ? writeSchema.required.filter((value) => typeof value === "string") : [];
  if (required.includes("filePath")) {
    return { filePath, content };
  }
  return { path: filePath, content };
}
function tryRerouteEditToWrite(toolCall, compat, allowedToolNames, toolSchemaMap) {
  if (!isToolName(toolCall.function.name, "edit")) {
    return null;
  }
  const writeToolName = resolveAllowedWriteToolName(allowedToolNames);
  if (!writeToolName) {
    return null;
  }
  const writeSchema = toolSchemaMap.get(writeToolName) ?? selectWriteSchemaForTool(toolCall.function.name, toolSchemaMap);
  if (!isFullFileShapedEditValidationFailure(toolCall.function.name, compat.normalizedArgs, compat.validation, compat.originalArgs, writeSchema) && !isFullFileShapedEditPayload(compat.normalizedArgs, compat.originalArgs)) {
    return null;
  }
  const filePath = typeof compat.normalizedArgs.path === "string" && compat.normalizedArgs.path.length > 0 ? compat.normalizedArgs.path : typeof compat.normalizedArgs.filePath === "string" && compat.normalizedArgs.filePath.length > 0 ? compat.normalizedArgs.filePath : null;
  if (!filePath) {
    return null;
  }
  const content = typeof compat.normalizedArgs.new_string === "string" ? compat.normalizedArgs.new_string : typeof compat.normalizedArgs.newString === "string" ? compat.normalizedArgs.newString : typeof compat.normalizedArgs.content === "string" ? compat.normalizedArgs.content : typeof compat.normalizedArgs.streamContent === "string" ? compat.normalizedArgs.streamContent : null;
  if (content === null) {
    return null;
  }
  return {
    ...toolCall,
    function: {
      name: writeToolName,
      arguments: JSON.stringify(buildWriteArguments(filePath, content, writeSchema, writeToolName))
    }
  };
}
function resolveAllowedWriteToolName(allowedToolNames) {
  if (allowedToolNames.has("write")) {
    return "write";
  }
  if (allowedToolNames.has("oc_write")) {
    return "oc_write";
  }
  return null;
}
function isFullFileShapedEditPayload(args, originalArgs) {
  if (hadOldStringPropertyInPayload(originalArgs)) {
    return false;
  }
  return hasEditFilePath(args) && hasEditBody(args);
}
function parseArguments(rawArguments) {
  try {
    const parsed = JSON.parse(rawArguments);
    if (isRecord(parsed)) {
      return parsed;
    }
    return { value: parsed };
  } catch {
    return { value: rawArguments };
  }
}
function normalizeArgumentKeys(args, schema) {
  const normalizedArgs = { ...args };
  const collisionKeys = [];
  const schemaProperties = getSchemaPropertyNames(schema);
  for (const [rawKey, rawValue] of Object.entries(args)) {
    const canonicalKey = resolveCanonicalArgKey(rawKey);
    if (!canonicalKey || canonicalKey === rawKey) {
      continue;
    }
    if (schemaProperties.has(rawKey)) {
      continue;
    }
    const canonicalInOriginal = hasOwn(args, canonicalKey);
    const canonicalInNormalized = hasOwn(normalizedArgs, canonicalKey);
    if (canonicalInOriginal || canonicalInNormalized) {
      collisionKeys.push(rawKey);
      delete normalizedArgs[rawKey];
      continue;
    }
    normalizedArgs[canonicalKey] = rawValue;
    delete normalizedArgs[rawKey];
  }
  return { normalizedArgs, collisionKeys };
}
function getSchemaPropertyNames(schema) {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return new Set;
  }
  return new Set(Object.keys(schema.properties));
}
function resolveCanonicalArgKey(rawKey) {
  const token = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ARG_KEY_ALIASES.get(token) ?? null;
}
function normalizeToolSpecificArgs(toolName, args, schema) {
  const normalizedToolName = toolName.toLowerCase();
  if (normalizedToolName === "question" && QUESTION_COMPAT_REPAIR_ENABLED) {
    return normalizeQuestionArgs(args);
  }
  if (normalizedToolName === "bash") {
    const normalized = { ...args };
    const normalizedCommand = normalizeBashCommand(normalized.command);
    if (typeof normalizedCommand === "string" && normalizedCommand.trim().length > 0) {
      normalized.command = normalizedCommand;
    }
    if (normalized.cwd === undefined && typeof normalized.path === "string" && normalized.path.trim().length > 0) {
      normalized.cwd = normalized.path;
    }
    return normalized;
  }
  if (normalizedToolName === "rm") {
    const normalized = { ...args };
    if (typeof normalized.force === "string") {
      const lowered = normalized.force.trim().toLowerCase();
      if (lowered === "true" || lowered === "1" || lowered === "yes") {
        normalized.force = true;
      } else if (lowered === "false" || lowered === "0" || lowered === "no") {
        normalized.force = false;
      }
    }
    return normalized;
  }
  if (normalizedToolName === "todowrite") {
    if (!Array.isArray(args.todos)) {
      return args;
    }
    const todos = args.todos.map((entry) => {
      if (!isRecord(entry)) {
        return entry;
      }
      const todo = { ...entry };
      if (typeof todo.status === "string") {
        todo.status = normalizeTodoStatus(todo.status);
      }
      if (todo.priority === undefined || todo.priority === null || typeof todo.priority === "string" && todo.priority.trim().length === 0) {
        todo.priority = "medium";
      }
      return todo;
    });
    return {
      ...args,
      todos
    };
  }
  if (isToolName(toolName, "write")) {
    const normalized = { ...args };
    const schemaProperties2 = getSchemaPropertyNames(schema);
    if (schemaProperties2.has("filePath") && normalized.filePath === undefined && typeof normalized.path === "string") {
      normalized.filePath = normalized.path;
      delete normalized.path;
    }
    if (normalized.content === undefined && normalized.new_string !== undefined) {
      const coerced = coerceToString(normalized.new_string);
      if (coerced !== null) {
        normalized.content = coerced;
      }
      delete normalized.new_string;
    }
    if (normalized.content !== undefined && typeof normalized.content !== "string") {
      const coerced = coerceToString(normalized.content);
      if (coerced !== null) {
        normalized.content = coerced;
      }
    }
    return normalized;
  }
  if (!isToolName(toolName, "edit") || !EDIT_COMPAT_REPAIR_ENABLED) {
    return args;
  }
  const repaired = { ...args };
  const schemaProperties = getSchemaPropertyNames(schema);
  if (schemaProperties.size === 0) {
    return normalizeSchemaAbsentEditArgs(repaired);
  }
  const newKey = schemaProperties.has("newString") ? "newString" : "new_string";
  const oldKey = schemaProperties.has("oldString") ? "oldString" : "old_string";
  if (schemaProperties.has("filePath") && repaired.filePath === undefined && typeof repaired.path === "string") {
    repaired.filePath = repaired.path;
    delete repaired.path;
  }
  if (oldKey === "oldString" && repaired.oldString === undefined && typeof repaired.old_string === "string") {
    repaired.oldString = repaired.old_string;
    delete repaired.old_string;
  }
  if (newKey === "newString" && repaired.newString === undefined && typeof repaired.new_string === "string") {
    repaired.newString = repaired.new_string;
    delete repaired.new_string;
  }
  const hasStringNew = typeof repaired[newKey] === "string";
  const hasStringOld = typeof repaired[oldKey] === "string";
  if (repaired.content !== undefined && typeof repaired.content !== "string") {
    const coerced = coerceToString(repaired.content);
    if (coerced !== null) {
      repaired.content = coerced;
    }
  }
  const content = repaired.content;
  if (!hasStringNew && typeof content === "string") {
    repaired[newKey] = content;
  }
  if (hasStringOld && repaired[oldKey] === "") {
    delete repaired[oldKey];
  }
  return repaired;
}
function normalizeSchemaAbsentEditArgs(args) {
  const repaired = { ...args };
  if (repaired.filePath === undefined && typeof repaired.path === "string") {
    repaired.filePath = repaired.path;
    delete repaired.path;
  }
  if (repaired.oldString === undefined && typeof repaired.old_string === "string") {
    repaired.oldString = repaired.old_string;
    delete repaired.old_string;
  }
  if (repaired.newString === undefined && typeof repaired.new_string === "string") {
    repaired.newString = repaired.new_string;
    delete repaired.new_string;
  }
  if (repaired.content !== undefined && typeof repaired.content !== "string") {
    const coerced = coerceToString(repaired.content);
    if (coerced !== null) {
      repaired.content = coerced;
    }
  }
  if (repaired.newString === undefined && typeof repaired.content === "string") {
    repaired.newString = repaired.content;
  }
  delete repaired.content;
  return repaired;
}
function normalizeQuestionArgs(args) {
  if (!Array.isArray(args.questions)) {
    return args;
  }
  const topTitle = typeof args.title === "string" ? args.title : undefined;
  const questions = args.questions.map((rawQuestion) => {
    if (!isRecord(rawQuestion)) {
      return rawQuestion;
    }
    const question = { ...rawQuestion };
    if (typeof question.question !== "string") {
      if (typeof question.prompt === "string") {
        question.question = question.prompt;
      } else if (typeof question.text === "string") {
        question.question = question.text;
      }
    }
    delete question.prompt;
    delete question.text;
    const headerSource = typeof question.header === "string" && question.header.trim().length > 0 ? question.header : topTitle ?? (typeof question.question === "string" ? question.question : "");
    question.header = truncate(headerSource, QUESTION_LABEL_MAX);
    if (question.multiple === undefined && typeof question.allow_multiple === "boolean") {
      question.multiple = question.allow_multiple;
    }
    delete question.allow_multiple;
    if (Array.isArray(question.options)) {
      question.options = question.options.map((rawOption) => {
        if (typeof rawOption === "string") {
          return { label: truncate(rawOption, QUESTION_LABEL_MAX), description: rawOption };
        }
        if (!isRecord(rawOption)) {
          return rawOption;
        }
        const option = { ...rawOption };
        const fullLabel = typeof option.label === "string" ? option.label : typeof option.title === "string" ? option.title : typeof option.text === "string" ? option.text : "";
        if (typeof option.description !== "string" || option.description.trim().length === 0) {
          option.description = fullLabel;
        }
        const labelSource = fullLabel.length > 0 ? fullLabel : String(option.description ?? "");
        option.label = truncate(labelSource, QUESTION_LABEL_MAX);
        delete option.id;
        delete option.title;
        delete option.text;
        return option;
      });
    }
    delete question.id;
    return question;
  });
  return { questions };
}
function truncate(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}
function normalizeBashCommand(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value.map((entry) => typeof entry === "string" ? entry : coerceToString(entry)).filter((entry) => typeof entry === "string" && entry.length > 0);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  if (isRecord(value)) {
    const command = typeof value.command === "string" ? value.command : null;
    const args = Array.isArray(value.args) ? value.args.map((entry) => typeof entry === "string" ? entry : coerceToString(entry)).filter((entry) => typeof entry === "string" && entry.length > 0) : [];
    if (command && args.length > 0) {
      return [command, ...args].join(" ");
    }
    if (command) {
      return command;
    }
  }
  return null;
}
function normalizeTodoStatus(status) {
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "todo_status_pending") {
    return "pending";
  }
  if (normalized === "todo_status_inprogress" || normalized === "todo_status_in_progress") {
    return "in_progress";
  }
  if (normalized === "todo_status_done" || normalized === "todo_status_complete" || normalized === "todo_status_completed") {
    return "completed";
  }
  if (normalized === "todo" || normalized === "pending") {
    return "pending";
  }
  if (normalized === "inprogress" || normalized === "in_progress") {
    return "in_progress";
  }
  if (normalized === "done" || normalized === "complete" || normalized === "completed") {
    return "completed";
  }
  return status;
}
function sanitizeArgumentsForSchema(args, schema) {
  if (!isRecord(schema)) {
    return { args, unexpected: [] };
  }
  if (schema.additionalProperties !== false) {
    return { args, unexpected: [] };
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const propertyNames = new Set(Object.keys(properties));
  const sanitized = {};
  const unexpected = [];
  for (const [key, value] of Object.entries(args)) {
    if (propertyNames.has(key)) {
      sanitized[key] = value;
      continue;
    }
    unexpected.push(key);
  }
  return { args: sanitized, unexpected };
}
function validateToolArguments(toolName, args, schema, unexpected, context = {}) {
  if (!isRecord(schema)) {
    return {
      hasSchema: false,
      ok: true,
      missing: [],
      unexpected: [],
      typeErrors: []
    };
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((value) => typeof value === "string") : [];
  const missing = required.filter((key) => !hasOwn(args, key));
  const typeErrors = [];
  for (const [key, value] of Object.entries(args)) {
    const propertySchema = properties[key];
    if (!isRecord(propertySchema)) {
      continue;
    }
    if (!matchesType(value, propertySchema.type)) {
      if (propertySchema.type !== undefined) {
        typeErrors.push(`${key}: expected ${String(propertySchema.type)}`);
      }
      continue;
    }
    if (Array.isArray(propertySchema.enum) && !propertySchema.enum.some((candidate) => Object.is(candidate, value))) {
      typeErrors.push(`${key}: expected enum ${JSON.stringify(propertySchema.enum)}`);
    }
  }
  const ok = missing.length === 0 && typeErrors.length === 0;
  return {
    hasSchema: true,
    ok,
    missing,
    unexpected,
    typeErrors,
    repairHint: ok ? undefined : buildRepairHint(toolName, args, missing, unexpected, typeErrors, context)
  };
}
function hadOldStringPropertyInPayload(args) {
  for (const key of Object.keys(args)) {
    const token = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (token === "oldstring") {
      return true;
    }
  }
  return false;
}
function hasEditFilePath(args) {
  const pathValue = args.path ?? args.filePath;
  return typeof pathValue === "string" && pathValue.trim().length > 0;
}
function hasEditBody(args) {
  const body = args.new_string ?? args.newString ?? args.content ?? args.streamContent;
  return typeof body === "string" && body.length > 0;
}
function writeToolExample(writeSchema) {
  if (!isRecord(writeSchema)) {
    return "write with path and content";
  }
  const required = Array.isArray(writeSchema.required) ? writeSchema.required.filter((value) => typeof value === "string") : [];
  if (required.includes("filePath")) {
    return "write with filePath and content";
  }
  return "write with path and content";
}
function buildEditFullFileHint(args, missing, typeErrors, context) {
  if (typeErrors.length > 0) {
    return null;
  }
  const missingOldStringOnly = (missing.includes("old_string") || missing.includes("oldString")) && missing.every((key) => key === "old_string" || key === "oldString");
  if (!missingOldStringOnly) {
    return null;
  }
  const originalArgs = context.originalArgs ?? {};
  if (hadOldStringPropertyInPayload(originalArgs)) {
    return null;
  }
  if (!hasEditFilePath(args) || !hasEditBody(args)) {
    return null;
  }
  const example = writeToolExample(context.writeSchema);
  return `For a full file body, use ${example} instead of edit without old_string`;
}
function buildRepairHint(toolName, args, missing, unexpected, typeErrors, context = {}) {
  const fullFileHint = isToolName(toolName, "edit") ? buildEditFullFileHint(args, missing, typeErrors, context) : null;
  if (fullFileHint) {
    return fullFileHint;
  }
  const hints = [];
  if (missing.length > 0) {
    hints.push(`missing required: ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    hints.push(`remove unsupported fields: ${unexpected.join(", ")}`);
  }
  if (typeErrors.length > 0) {
    hints.push(`fix type errors: ${typeErrors.join("; ")}`);
  }
  if (isToolName(toolName, "edit") && (missing.includes("old_string") || missing.includes("oldString") || missing.includes("new_string") || missing.includes("newString"))) {
    hints.push("edit requires path, old_string, and new_string");
  }
  return hints.join(" | ");
}
function selectWriteSchemaForTool(toolName, toolSchemaMap) {
  if (toolName.toLowerCase().startsWith("oc_")) {
    return toolSchemaMap.get("oc_write") ?? toolSchemaMap.get("write");
  }
  return toolSchemaMap.get("write") ?? toolSchemaMap.get("oc_write");
}
function isToolName(toolName, canonical) {
  const token = toolName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return token === canonical || token === `oc${canonical}`;
}
function matchesType(value, schemaType) {
  if (schemaType === undefined) {
    return true;
  }
  if (Array.isArray(schemaType)) {
    return schemaType.some((entry) => matchesType(value, entry));
  }
  if (typeof schemaType !== "string") {
    return true;
  }
  switch (schemaType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
function coerceToString(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (isRecord(item)) {
        const text = typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : typeof item.value === "string" ? item.value : null;
        if (text !== null) {
          parts.push(text);
        } else {
          parts.push(JSON.stringify(item));
        }
      } else {
        parts.push(String(item));
      }
    }
    return parts.length > 0 ? parts.join("") : null;
  }
  if (isRecord(value)) {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.content === "string") {
      return value.content;
    }
    if (typeof value.value === "string") {
      return value.value;
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}
function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var EDIT_COMPAT_REPAIR_ENABLED, QUESTION_COMPAT_REPAIR_ENABLED, QUESTION_LABEL_MAX = 30, ARG_KEY_ALIASES;
var init_tool_schema_compat = __esm(() => {
  EDIT_COMPAT_REPAIR_ENABLED = process.env.CURSOR_ACP_EDIT_COMPAT_REPAIR !== "false";
  QUESTION_COMPAT_REPAIR_ENABLED = process.env.CURSOR_ACP_QUESTION_COMPAT_REPAIR !== "false";
  ARG_KEY_ALIASES = new Map([
    ["filepath", "path"],
    ["filename", "path"],
    ["file", "path"],
    ["targetpath", "path"],
    ["directorypath", "path"],
    ["dir", "path"],
    ["folder", "path"],
    ["directory", "path"],
    ["targetdirectory", "path"],
    ["targetfile", "path"],
    ["globpattern", "pattern"],
    ["filepattern", "pattern"],
    ["searchpattern", "pattern"],
    ["includepattern", "include"],
    ["workingdirectory", "cwd"],
    ["workdir", "cwd"],
    ["currentdirectory", "cwd"],
    ["cmd", "command"],
    ["script", "command"],
    ["shellcommand", "command"],
    ["terminalcommand", "command"],
    ["contents", "content"],
    ["text", "content"],
    ["body", "content"],
    ["data", "content"],
    ["payload", "content"],
    ["streamcontent", "content"],
    ["recursive", "force"],
    ["oldstring", "old_string"],
    ["newstring", "new_string"]
  ]);
});

// src/proxy/prompt-builder.ts
import { createHash } from "node:crypto";
function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
function buildToolFingerprint(tools) {
  if (tools.length === 0)
    return "";
  const parts = tools.map((t) => {
    const fn = t.function || t;
    const name = fn.name || "?";
    const desc = fn.description || "";
    const paramProps = fn.parameters?.properties || {};
    const paramKeys = Object.keys(paramProps).sort().join(",");
    const required = [...fn.parameters?.required || []].sort().join(",");
    return `${name}:${shortHash(desc)}:${paramKeys}:${required}`;
  });
  parts.sort();
  return `${parts.length}:${parts.join("|")}`;
}
function buildToolSchemaBlock(tools) {
  const fingerprint = buildToolFingerprint(tools);
  if (fingerprint && fingerprint === _cachedToolFingerprint) {
    return _cachedToolBlock;
  }
  const toolDescs = tools.map((t) => {
    const fn = t.function || t;
    const name = fn.name || "unknown";
    const desc = fn.description || "";
    const params = fn.parameters;
    const paramStr = params ? JSON.stringify(params) : "{}";
    return `- ${name}: ${desc}
  Parameters: ${paramStr}`;
  }).join(`
`);
  const block = `SYSTEM: You have access to the following tools. When you need to use one, respond with a tool_call in the standard OpenAI format.
` + `Tool guidance: prefer write/edit for file changes; use bash mainly to run commands/tests.

Available tools:
${toolDescs}`;
  if (fingerprint) {
    _cachedToolFingerprint = fingerprint;
    _cachedToolBlock = block;
  }
  return block;
}
function formatToolResult(callId, name, body) {
  return name ? `TOOL_RESULT (name: ${name}, call_id: ${callId}): ${body}` : `TOOL_RESULT (call_id: ${callId}): ${body}`;
}
function formatAssistantToolCall(tc, allowedToolNames, toolSchemaMap) {
  const fn = tc.function || {};
  let name = fn.name || "?";
  let args = fn.arguments || "{}";
  if (typeof fn.name === "string" && typeof fn.arguments === "string") {
    const toolCall = {
      id: tc.id || "call_unknown",
      type: "function",
      function: {
        name: fn.name,
        arguments: fn.arguments
      }
    };
    const compat = applyToolSchemaCompat(toolCall, toolSchemaMap);
    const rerouted = tryRerouteEditToWrite(compat.toolCall, compat, allowedToolNames, toolSchemaMap);
    if (rerouted) {
      name = rerouted.function.name;
      args = rerouted.function.arguments;
    }
  }
  return {
    text: `tool_call(id: ${tc.id || "?"}, name: ${name}, args: ${args})`,
    name
  };
}
import { formatContentPartsForPrompt } from "./image-attachments.mjs";
import { createProxyHealthGate } from "./proxy-health-gate.mjs";
function buildPromptFromMessages(messages, tools, subagentNames = [], workspaceDirectory = "") {
  if (log3.isDebugEnabled()) {
    const messageSummary = messages.map((m, i) => {
      const role = m?.role ?? "?";
      const hasToolCalls = Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0;
      const tcNames = hasToolCalls > 0 ? m.tool_calls.map((tc) => tc?.function?.name).join(",") : "";
      const contentType = typeof m?.content;
      const contentLen = typeof m?.content === "string" ? m.content.length : Array.isArray(m?.content) ? `arr:${m.content.length}` : "null";
      const toolCallId = m?.tool_call_id ?? null;
      return { i, role, hasToolCalls, tcNames, contentType, contentLen, toolCallId };
    });
    const assistantWithToolCalls = messages.filter((m) => m?.role === "assistant" && Array.isArray(m?.tool_calls) && m.tool_calls.length > 0);
    const assistantEmpty = messages.filter((m) => m?.role === "assistant" && (!m?.tool_calls || m.tool_calls.length === 0) && (!m?.content || m.content === "" || m.content === null));
    const toolResults = messages.filter((m) => m?.role === "tool");
    log3.debug("buildPromptFromMessages", {
      totalMessages: messages.length,
      totalTools: tools.length,
      messageSummary,
      stats: {
        assistantWithToolCalls: assistantWithToolCalls.length,
        assistantEmpty: assistantEmpty.length,
        toolResults: toolResults.length
      },
      assistantDetails: assistantWithToolCalls.length > 0 ? assistantWithToolCalls.map((m, i) => ({
        index: i,
        toolCallCount: Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0,
        toolCallIds: Array.isArray(m?.tool_calls) ? m.tool_calls.map((tc) => tc?.id).join(",") : "",
        toolCallNames: Array.isArray(m?.tool_calls) ? m.tool_calls.map((tc) => tc?.function?.name).join(",") : "",
        contentType: typeof m?.content,
        contentPreview: typeof m?.content === "string" ? m.content.slice(0, 50) : typeof m?.content
      })) : [],
      emptyAssistantDetails: assistantEmpty.length > 0 ? assistantEmpty.map((m, i) => ({
        index: i,
        contentType: typeof m?.content,
        contentPreview: typeof m?.content === "string" ? m.content.slice(0, 50) : typeof m?.content
      })) : [],
      toolResultDetails: toolResults.length > 0 ? toolResults.map((m, i) => ({
        index: i,
        toolCallId: m?.tool_call_id,
        name: m?.name,
        contentPreview: typeof m?.content === "string" ? m.content.slice(0, 100) : typeof m?.content
      })) : []
    });
  }
  const lines = [];
  const toolCallNames = new Map;
  const allowedToolNames = new Set(tools.map((t) => t?.function?.name ?? t?.name).filter((name) => typeof name === "string" && name.length > 0));
  const toolSchemaMap = buildToolSchemaMap(tools);
  if (tools.length > 0) {
    lines.push(buildToolSchemaBlock(tools));
    const hasTaskTool = tools.some((t) => {
      const name = (t?.function?.name ?? t?.name ?? "").toLowerCase();
      return name === "task";
    });
    if (hasTaskTool && subagentNames.length > 0) {
      lines.push(`When calling the task tool, set subagent_type to one of: ${subagentNames.join(", ")}. Do not omit this parameter.`);
    }
  }
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "user";
    if (role === "tool") {
      const callId = message.tool_call_id || "unknown";
      const name = typeof message.name === "string" && message.name ? message.name : toolCallNames.get(callId);
      let body;
      if (typeof message.content === "string") {
        body = message.content;
      } else if (Array.isArray(message.content)) {
        body = formatContentPartsForPrompt(message.content, workspaceDirectory).join(`
`) || JSON.stringify(message.content);
      } else {
        body = JSON.stringify(message.content ?? "");
      }
      lines.push(formatToolResult(callId, name, body));
      continue;
    }
    if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const tcTexts = message.tool_calls.map((tc) => {
        const formatted = formatAssistantToolCall(tc, allowedToolNames, toolSchemaMap);
        if (tc.id && formatted.name && formatted.name !== "?") {
          toolCallNames.set(tc.id, formatted.name);
        }
        return formatted.text;
      });
      const text = typeof message.content === "string" ? message.content : "";
      lines.push(`ASSISTANT: ${text ? text + `
` : ""}${tcTexts.join(`
`)}`);
      continue;
    }
    const content = message.content;
    if (typeof content === "string") {
      lines.push(`${role.toUpperCase()}: ${content}`);
    } else if (Array.isArray(content)) {
      const parts = formatContentPartsForPrompt(content, workspaceDirectory);
      if (parts.length) {
        lines.push(`${role.toUpperCase()}: ${parts.join(`
`)}`);
      }
    }
  }
  const hasToolResults = messages.some((m) => m?.role === "tool");
  if (hasToolResults) {
    lines.push("The above tool calls have been executed. Continue your response based on these results.");
  }
  const finalPrompt = lines.join(`

`);
  log3.debug("buildPromptFromMessages: final prompt", {
    lineCount: lines.length,
    promptLength: finalPrompt.length,
    promptPreview: finalPrompt.slice(0, 500),
    hasToolResultFormat: finalPrompt.includes("TOOL_RESULT"),
    hasAssistantToolCallFormat: finalPrompt.includes("tool_call(id:"),
    hasCompletionSignal: finalPrompt.includes("The above tool calls have been executed")
  });
  return finalPrompt;
}
var log3, _cachedToolFingerprint = "", _cachedToolBlock = "";
var init_prompt_builder = __esm(() => {
  init_tool_schema_compat();
  init_logger();
  log3 = createLogger("proxy:prompt-builder");
});

// src/proxy/bridge-json.ts
import { createHash as createHash2 } from "node:crypto";
function isBridgeJsonEnabled(env = process.env) {
  const raw = env[BRIDGE_JSON_ENV];
  if (raw === undefined) {
    return true;
  }
  return !["0", "false", "off", "no", "disabled"].includes(raw.trim().toLowerCase());
}
function applyBridgeJsonPrompt(prompt, options) {
  if (!isBridgeJsonEnabled(options.env) || !resolveAllowedWriteToolName2(options.allowedToolNames)) {
    return prompt;
  }
  if (prompt.includes("opencode bridge mode is active")) {
    return prompt;
  }
  return prompt ? `${BRIDGE_JSON_CONTEXT}

${prompt}` : BRIDGE_JSON_CONTEXT;
}
function extractBridgeToolCallFromText(text, allowedToolNames, writeSchema) {
  const writeToolName = resolveAllowedWriteToolName2(allowedToolNames);
  if (!writeToolName) {
    return null;
  }
  const jsonText = extractStrictJsonText(text);
  if (!jsonText) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!isRecord2(parsed) || parsed.name !== "write" || !isRecord2(parsed.arguments)) {
    return null;
  }
  const { path: path2 } = parsed.arguments;
  const content = typeof parsed.arguments.content === "string" ? parsed.arguments.content : parsed.arguments.contents;
  if (typeof path2 !== "string" || path2.trim().length === 0 || typeof content !== "string") {
    return null;
  }
  return {
    id: `call_bridge_${shortHash2(jsonText)}`,
    type: "function",
    function: {
      name: writeToolName,
      arguments: JSON.stringify(buildWriteArguments2(path2, content, writeSchema))
    }
  };
}
function extractBridgeToolCallFromStreamOutput(output, allowedToolNames, writeSchema) {
  if (!output || !resolveAllowedWriteToolName2(allowedToolNames)) {
    return null;
  }
  for (const line of output.split(`
`)) {
    const event = parseStreamJsonLine(line);
    if (!event || !isAssistantText(event)) {
      continue;
    }
    const text = extractText(event);
    const toolCall = extractBridgeToolCallFromText(text, allowedToolNames, writeSchema) ?? extractBridgeToolCallFromTrailingLine(text, allowedToolNames, writeSchema);
    if (toolCall) {
      return toolCall;
    }
  }
  return null;
}
function extractBridgeToolCallFromTrailingLine(text, allowedToolNames, writeSchema) {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine || !lastLine.startsWith("{") || !lastLine.endsWith("}")) {
    return null;
  }
  return extractBridgeToolCallFromText(lastLine, allowedToolNames, writeSchema);
}
function buildWriteArguments2(path2, content, writeSchema) {
  if (isRecord2(writeSchema) && isRecord2(writeSchema.properties)) {
    const properties = writeSchema.properties;
    const required = Array.isArray(writeSchema.required) ? writeSchema.required.filter((value) => typeof value === "string") : [];
    if (required.includes("filePath") || "filePath" in properties && !("path" in properties)) {
      return { filePath: path2, content };
    }
  }
  return { path: path2, content };
}
function resolveAllowedWriteToolName2(allowedToolNames) {
  if (allowedToolNames.has("write")) {
    return "write";
  }
  if (allowedToolNames.has("oc_write")) {
    return "oc_write";
  }
  return null;
}
function extractStrictJsonText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return fenced ? fenced[1].trim() : null;
}
function shortHash2(value) {
  return createHash2("sha256").update(value).digest("hex").slice(0, 12);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var BRIDGE_JSON_ENV = "CURSOR_ACP_BRIDGE_JSON", BRIDGE_JSON_CONTEXT = `SYSTEM: opencode bridge mode is active.
For file changes through opencode-cursor, read any needed files first, then respond with exactly one JSON object and no prose:
{"name":"write","arguments":{"path":"relative/path","content":"complete file contents"}}
Use this only for a single complete-file write. Otherwise answer normally or use the available tool format.`;
var init_bridge_json = __esm(() => {
  init_parser();
});

// src/proxy/incremental-prompt.ts
function extractTextContent(content) {
  if (typeof content === "string")
    return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.type === "text" && typeof part.text === "string" ? part.text : "").filter(Boolean).join(`
`);
  }
  return "";
}
function formatAssistantToolCalls(message) {
  if (message?.role !== "assistant" || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
    return null;
  }
  const calls = message.tool_calls.map((tc) => {
    const fn = tc.function || {};
    return `tool_call(id: ${tc.id || "?"}, name: ${fn.name || "?"}, args: ${fn.arguments || "{}"})`;
  });
  return `ASSISTANT: ${calls.join(`
`)}`;
}
function buildToolCallNameMap(message) {
  const names = new Map;
  if (!message || !Array.isArray(message.tool_calls))
    return names;
  for (const tc of message.tool_calls) {
    const id = tc.id;
    const name = tc.function?.name;
    if (id && name)
      names.set(id, name);
  }
  return names;
}
function formatToolResult2(message, toolNames) {
  const callId = message.tool_call_id || "unknown";
  const body = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
  const name = typeof message.name === "string" && message.name ? message.name : toolNames.get(callId);
  return name ? `TOOL_RESULT (name: ${name}, call_id: ${callId}): ${body}` : `TOOL_RESULT (call_id: ${callId}): ${body}`;
}
function buildIncrementalPrompt(messages) {
  if (messages.length === 0)
    return null;
  const last = messages[messages.length - 1];
  if (last?.role === "tool") {
    let firstToolIndex = messages.length - 1;
    while (firstToolIndex > 0 && messages[firstToolIndex - 1]?.role === "tool") {
      firstToolIndex--;
    }
    const assistant = messages[firstToolIndex - 1];
    const toolNames = buildToolCallNameMap(assistant);
    const lines = [];
    const assistantToolCalls = formatAssistantToolCalls(assistant);
    if (assistantToolCalls) {
      lines.push(assistantToolCalls);
    }
    for (let i = firstToolIndex;i < messages.length; i++) {
      const m = messages[i];
      if (m?.role !== "tool")
        break;
      lines.push(formatToolResult2(m, toolNames));
    }
    if (lines.length === 0)
      return null;
    lines.push("The above tool calls have been executed. Continue your response based on these results.");
    return lines.join(`

`);
  }
  if (last?.role === "user") {
    const text = extractTextContent(last.content);
    if (!text.trim())
      return null;
    if (Array.isArray(last.content) && last.content.some((part) => part?.type && part.type !== "text")) {
      return null;
    }
    return text.trim();
  }
  return null;
}

// src/proxy/session-resume.ts
import { createHash as createHash3 } from "node:crypto";
function simpleHash(input) {
  return createHash3("sha256").update(input).digest("hex").slice(0, 32);
}
function isMetaUserMessage(content) {
  const lower = content.toLowerCase();
  return lower.includes("title generator") || lower.includes("thread title") || lower.includes("generate a brief title");
}
function deriveConversationAnchor(messages) {
  for (const message of messages) {
    if (message?.role !== "user")
      continue;
    const text = extractTextContent(message.content).trim();
    if (!text || isMetaUserMessage(text))
      continue;
    const canonical = canonicalizeContentForAnchor(message.content);
    return { anchor: simpleHash(canonical), contentPrefix: text.slice(0, 500) };
  }
  return;
}
function deriveConversationResumePrefixes(messages) {
  const users = [];
  for (let index = 0;index < messages.length; index++) {
    const message = messages[index];
    if (message?.role !== "user")
      continue;
    const text = extractTextContent(message.content).trim();
    if (!text || isMetaUserMessage(text))
      continue;
    users.push({
      canonical: canonicalizeContentForAnchor(message.content),
      prefix: text.slice(0, 500),
      index
    });
  }
  if (users.length === 0)
    return;
  const lastUserIsLatestMessage = users[users.length - 1]?.index === messages.length - 1;
  const lookupUsers = lastUserIsLatestMessage && users.length > 1 ? users.slice(0, -1) : users;
  return {
    lookupContentPrefix: buildUserSequencePrefix(lookupUsers),
    recordContentPrefix: buildUserSequencePrefix(users)
  };
}
function buildUserSequencePrefix(users) {
  if (users.length === 1)
    return users[0].prefix;
  return `users:${users.length}:${simpleHash(users.map((user) => user.canonical).join(`
\x00
`))}`;
}
function canonicalizeContentForAnchor(content) {
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    return "";
  const hasNonText = content.some((part) => part?.type !== "text" || typeof part.text !== "string");
  if (!hasNonText) {
    return content.map((part) => part.text).join(`
`);
  }
  return content.map((part) => {
    if (part?.type === "text" && typeof part.text === "string") {
      return `text:${part.text}`;
    }
    if (part?.type === "image_url") {
      return `image_url:${typeof part.image_url?.url === "string" ? part.image_url.url : ""}`;
    }
    return `part:${part?.type ?? ""}`;
  }).join(`
`);
}
function buildSessionKey(workspace, model, anchor) {
  return `${workspace}\x00${model}\x00${anchor}`;
}
function isSessionResumeEnabled() {
  const value = process.env.CURSOR_ACP_SESSION_RESUME?.toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}
function getResumeChatId(sessionKey, expectedPrefix, toolFingerprint, subagentFingerprint) {
  const entry = cache.get(sessionKey);
  if (!entry)
    return;
  if (Date.now() - entry.updatedAt > DEFAULT_TTL_MS) {
    evictEntry(sessionKey, "ttlExpired", {
      ageMs: Date.now() - entry.updatedAt,
      ttlMs: DEFAULT_TTL_MS
    });
    return;
  }
  if (expectedPrefix != null && entry.contentPrefix !== expectedPrefix) {
    log4.warn("Skipping session resume entry due to content prefix mismatch", {
      sessionKeyHash: sanitizeSessionKey(sessionKey),
      storedPrefixLength: entry.contentPrefix.length,
      expectedPrefixLength: expectedPrefix.length
    });
    return;
  }
  if ((toolFingerprint || entry.toolFingerprint) && entry.toolFingerprint !== toolFingerprint) {
    evictEntry(sessionKey, "toolFingerprintMismatch", {}, "warn");
    return;
  }
  if ((subagentFingerprint || entry.subagentFingerprint) && entry.subagentFingerprint !== subagentFingerprint) {
    evictEntry(sessionKey, "subagentFingerprintMismatch", {}, "warn");
    return;
  }
  cache.delete(sessionKey);
  cache.set(sessionKey, entry);
  return entry.chatId;
}
function hasResumeChatId(sessionKey, expectedPrefix, toolFingerprint, subagentFingerprint) {
  const entry = cache.get(sessionKey);
  if (!entry)
    return false;
  if (Date.now() - entry.updatedAt > DEFAULT_TTL_MS)
    return false;
  if (expectedPrefix != null && entry.contentPrefix !== expectedPrefix)
    return false;
  if ((toolFingerprint || entry.toolFingerprint) && entry.toolFingerprint !== toolFingerprint) {
    return false;
  }
  if ((subagentFingerprint || entry.subagentFingerprint) && entry.subagentFingerprint !== subagentFingerprint) {
    return false;
  }
  return !!entry.chatId;
}
function recordResumeChatId(sessionKey, chatId, contentPrefix, toolFingerprint, subagentFingerprint) {
  if (!chatId)
    return;
  const trimmed = chatId.trim();
  if (!RESUME_CHAT_ID_SAFE_RE.test(trimmed)) {
    log4.warn("Refusing to cache unsafe resume chat ID", {
      sessionKeyHash: sanitizeSessionKey(sessionKey),
      chatIdHash: hashForLog(trimmed)
    });
    return;
  }
  cache.delete(sessionKey);
  cache.set(sessionKey, {
    chatId: trimmed,
    contentPrefix,
    toolFingerprint,
    subagentFingerprint,
    updatedAt: Date.now()
  });
  while (cache.size > DEFAULT_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined)
      break;
    evictEntry(oldest, "maxEntries", { maxEntries: DEFAULT_MAX_ENTRIES });
  }
}
function sanitizeSessionKey(sessionKey) {
  return createHash3("sha256").update(sessionKey).digest("hex").slice(0, 32);
}
function hashForLog(input) {
  return sanitizeSessionKey(typeof input === "string" ? input : String(input ?? ""));
}
function evictEntry(sessionKey, reason, extra = {}, logLevel = "info") {
  const payload = {
    sessionKeyHash: sanitizeSessionKey(sessionKey),
    reason,
    ...extra
  };
  if (logLevel === "warn") {
    log4.warn("Evicting session resume entry", payload);
  } else {
    log4.info("Evicting session resume entry", payload);
  }
  cache.delete(sessionKey);
}
function clearResumeChatId(sessionKey) {
  cache.delete(sessionKey);
}
var log4, RESUME_CHAT_ID_SAFE_RE, DEFAULT_TTL_MS, DEFAULT_MAX_ENTRIES = 64, cache;
var init_session_resume = __esm(() => {
  init_logger();
  log4 = createLogger("session-resume");
  RESUME_CHAT_ID_SAFE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  DEFAULT_TTL_MS = 60 * 60 * 1000;
  cache = new Map;
});

// src/proxy/tool-loop.ts
function extractAllowedToolNames(tools) {
  const names = new Set;
  for (const tool of tools) {
    const fn = tool?.function ?? tool;
    if (fn && typeof fn.name === "string" && fn.name.length > 0) {
      names.add(fn.name);
    }
  }
  return names;
}
function extractOpenAiToolCall(event, allowedToolNames) {
  if (allowedToolNames.size === 0) {
    return { action: "skip", skipReason: "no_allowed_tools" };
  }
  const { name, args, skipped } = extractToolNameAndArgs(event);
  if (skipped) {
    return { action: "skip", skipReason: "event_skipped" };
  }
  if (!name) {
    return { action: "skip", skipReason: "no_name" };
  }
  if (name.toLowerCase() === "mcp") {
    log5.warn("Model attempted to call 'mcp' directly (not a valid tool name)", {
      args,
      hint: "MCP tools must be called by their full name (e.g. mcp__engram__mem_save), not 'mcp'"
    });
    return {
      action: "passthrough",
      passthroughName: name
    };
  }
  const resolvedName = resolveAllowedToolName(name, allowedToolNames);
  if (resolvedName) {
    if (args === undefined && event.subtype === "started") {
      log5.debug("Tool call args extraction returned undefined", {
        toolName: name,
        subtype: event.subtype ?? "none",
        payloadKeys: Object.entries(event.tool_call || {}).map(([k, v]) => `${k}:[${isRecord3(v) ? Object.keys(v).join(",") : typeof v}]`),
        hasCallId: Boolean(event.call_id)
      });
    }
    const callId = event.call_id || event.tool_call_id || "call_unknown";
    return {
      action: "intercept",
      toolCall: {
        id: callId,
        type: "function",
        function: {
          name: resolvedName,
          arguments: toOpenAiArguments(args)
        }
      }
    };
  }
  log5.debug("Tool call not in allowlist; passing through to cursor-agent", {
    name,
    normalized: normalizeAliasKey(name),
    allowedToolCount: allowedToolNames.size
  });
  return {
    action: "passthrough",
    passthroughName: name
  };
}
function createToolCallCompletionResponse(meta, toolCall) {
  return {
    id: meta.id,
    object: "chat.completion",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [toolCall]
        },
        finish_reason: "tool_calls"
      }
    ]
  };
}
function createToolCallStreamChunks(meta, toolCall) {
  const toolDelta = {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              ...toolCall
            }
          ]
        },
        finish_reason: null
      }
    ]
  };
  const finishChunk = {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "tool_calls"
      }
    ]
  };
  return [toolDelta, finishChunk];
}
function extractToolNameAndArgs(event) {
  let name = typeof event.name === "string" ? event.name : null;
  let args = undefined;
  const entries = Object.entries(event.tool_call || {});
  if (entries.length > 0) {
    const [rawName, payload] = entries[0];
    if (!name) {
      name = normalizeToolName(rawName);
    }
    const payloadRecord = isRecord3(payload) ? payload : null;
    args = payloadRecord?.args;
    if (args === undefined && payloadRecord && isRecord3(payloadRecord.input)) {
      args = payloadRecord.input;
    }
    if (args === undefined && payloadRecord) {
      const { result: _result, ...rest } = payloadRecord;
      const restKeys = Object.keys(rest);
      if (restKeys.length === 0) {
        if (name) {
          name = normalizeToolName(name);
        }
        return { name, args: undefined, skipped: true };
      }
      args = rest;
    }
  }
  if (name) {
    name = normalizeToolName(name);
  }
  return { name, args, skipped: false };
}
function normalizeToolName(raw) {
  if (raw.endsWith("ToolCall")) {
    const base = raw.slice(0, -"ToolCall".length);
    return base.charAt(0).toLowerCase() + base.slice(1);
  }
  return raw;
}
function resolveAllowedToolName(name, allowedToolNames) {
  if (allowedToolNames.has(name)) {
    return name;
  }
  const normalizedName = normalizeAliasKey(name);
  for (const allowedName of allowedToolNames) {
    if (normalizeAliasKey(allowedName) === normalizedName) {
      return allowedName;
    }
  }
  const aliasedCanonical = TOOL_NAME_ALIASES.get(normalizedName);
  if (!aliasedCanonical) {
    return null;
  }
  const canonicalNormalized = normalizeAliasKey(aliasedCanonical);
  for (const allowedName of allowedToolNames) {
    if (normalizeAliasKey(allowedName) === canonicalNormalized) {
      return allowedName;
    }
  }
  return null;
}
function normalizeAliasKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function toOpenAiArguments(args) {
  if (args === undefined) {
    return "{}";
  }
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object") {
        return JSON.stringify(parsed);
      }
      return JSON.stringify({ value: parsed });
    } catch {
      return JSON.stringify({ value: args });
    }
  }
  if (typeof args === "object" && args !== null) {
    return JSON.stringify(args);
  }
  return JSON.stringify({ value: args });
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var log5, TOOL_NAME_ALIASES;
var init_tool_loop = __esm(() => {
  init_logger();
  log5 = createLogger("proxy:tool-loop");
  TOOL_NAME_ALIASES = new Map([
    ["runcommand", "bash"],
    ["executecommand", "bash"],
    ["runterminalcommand", "bash"],
    ["terminalcommand", "bash"],
    ["shellcommand", "bash"],
    ["shell", "bash"],
    ["terminal", "bash"],
    ["bashcommand", "bash"],
    ["runbash", "bash"],
    ["executebash", "bash"],
    ["edit", "oc_edit"],
    ["write", "oc_write"],
    ["read", "oc_read"],
    ["ocedit", "edit"],
    ["strreplace", "edit"],
    ["ocwrite", "write"],
    ["writefile", "write"],
    ["ocread", "read"],
    ["ocgrep", "grep"],
    ["findfiles", "glob"],
    ["searchfiles", "glob"],
    ["globfiles", "glob"],
    ["fileglob", "glob"],
    ["matchfiles", "glob"],
    ["createdirectory", "mkdir"],
    ["makedirectory", "mkdir"],
    ["mkdirp", "mkdir"],
    ["createdir", "mkdir"],
    ["makefolder", "mkdir"],
    ["delete", "rm"],
    ["deletefile", "rm"],
    ["deletepath", "rm"],
    ["deletedirectory", "rm"],
    ["remove", "rm"],
    ["removefile", "rm"],
    ["removepath", "rm"],
    ["unlink", "rm"],
    ["rmdir", "rm"],
    ["getfileinfo", "stat"],
    ["fileinfo", "stat"],
    ["filestat", "stat"],
    ["pathinfo", "stat"],
    ["listdirectory", "ls"],
    ["listfiles", "ls"],
    ["listdir", "ls"],
    ["readdir", "ls"],
    ["updatetodos", "todowrite"],
    ["updatetodostoolcall", "todowrite"],
    ["todowrite", "todowrite"],
    ["todowritetoolcall", "todowrite"],
    ["writetodos", "todowrite"],
    ["todowritefn", "todowrite"],
    ["readtodos", "todoread"],
    ["readtodostoolcall", "todoread"],
    ["todoread", "todoread"],
    ["todoreadtoolcall", "todoread"],
    ["callomoagent", "call_omo_agent"],
    ["callagent", "call_omo_agent"],
    ["invokeagent", "call_omo_agent"],
    ["delegatetask", "task"],
    ["delegate", "task"],
    ["runtask", "task"],
    ["subagent", "task"],
    ["useskill", "skill"],
    ["invokeskill", "skill"],
    ["runskill", "skill"],
    ["skillmcp", "skill_mcp"],
    ["mcp_skill", "skill_mcp"],
    ["runmcpskill", "skill_mcp"],
    ["invokeskillmcp", "skill_mcp"],
    ["askquestion", "question"],
    ["askuser", "question"],
    ["askuserquestion", "question"],
    ["askquestions", "question"],
    ["promptuser", "question"]
  ]);
});

// node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? undefined : "g");
}

// node_modules/strip-ansi/index.js
function stripAnsi2(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex, "");
}
var regex;
var init_strip_ansi = __esm(() => {
  regex = ansiRegex();
});

// src/tools/discovery.ts
class OpenCodeToolDiscovery {
  client;
  cache = new Map;
  cacheExpiry = 0;
  ttl;
  executorPref;
  constructor(client, opts = {}) {
    this.client = client;
    this.ttl = opts.ttlMs ?? Number(process.env.CURSOR_ACP_TOOL_CACHE_TTL_MS || 60000);
    const envPref = process.env.CURSOR_ACP_TOOL_EXECUTOR;
    this.executorPref = opts.executor ?? (envPref === "sdk" || envPref === "cli" ? envPref : "auto");
  }
  async listTools() {
    const now = Date.now();
    if (this.cache.size > 0 && now < this.cacheExpiry) {
      return Array.from(this.cache.values());
    }
    let tools = [];
    if (this.executorPref !== "cli" && this.client?.tool?.list) {
      try {
        const resp = await this.client.tool.list({});
        const rawTools = Array.isArray(resp?.data) ? resp.data : resp?.data?.tools || [];
        tools = rawTools.map((t) => this.normalize(t, "sdk"));
        const mcpTools = await this.tryListMcpTools();
        tools = tools.concat(mcpTools);
      } catch (err) {
        log6.debug("SDK tool.list failed, will try CLI", { error: String(err) });
      }
    }
    if (tools.length === 0 && this.executorPref !== "sdk") {
      try {
        const { spawnSync } = await import("node:child_process");
        const cliCmd = process.env.OPENCODE_TOOL_LIST_SHIM ? process.env.OPENCODE_TOOL_LIST_SHIM.split(" ") : ["opencode", "tool", "list", "--json"];
        const res = spawnSync(cliCmd[0], cliCmd.slice(1), { encoding: "utf-8" });
        const parsed = this.parseCliJson(res.stdout || "");
        if (parsed?.data?.tools?.length) {
          tools = parsed.data.tools.map((t) => this.normalize(t, "cli"));
        } else {
          log6.debug("CLI tool list failed", { status: res.status, stderr: res.stderr });
        }
      } catch (err) {
        log6.debug("CLI tool list error", { error: String(err) });
      }
    }
    const map = new Map;
    for (const t of tools) {
      map.set(t.name, t);
    }
    this.cache = map;
    this.cacheExpiry = now + this.ttl;
    return Array.from(this.cache.values());
  }
  getToolByName(name) {
    return this.cache.get(name);
  }
  normalize(t, source) {
    const id = String(t.id || t.name || "unknown");
    const name = this.namespace(id);
    return {
      id,
      name,
      description: String(t.description || "OpenCode tool"),
      parameters: t.parameters || { type: "object", properties: {} },
      source
    };
  }
  namespace(id) {
    const sanitized = id.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 59);
    return `oc_${sanitized}`;
  }
  async tryListMcpTools() {
    try {
      const mcpList = this.client?.mcp?.tool?.list ? await this.client.mcp.tool.list() : null;
      if (!mcpList?.data?.tools)
        return [];
      return mcpList.data.tools.map((t) => this.normalize(t, "mcp"));
    } catch (err) {
      log6.debug("MCP tool discovery skipped", { error: String(err) });
      return [];
    }
  }
  parseCliJson(stdout) {
    const clean = stripAnsi2(stdout || "").trim();
    if (!clean)
      return null;
    try {
      return JSON.parse(clean);
    } catch {}
    const lastBrace = clean.lastIndexOf("{");
    if (lastBrace >= 0) {
      const substr = clean.slice(lastBrace);
      try {
        return JSON.parse(substr);
      } catch {}
    }
    return null;
  }
}
var log6;
var init_discovery = __esm(() => {
  init_logger();
  init_strip_ansi();
  log6 = createLogger("tools:discovery");
});

// src/tools/schema.ts
function toOpenAiParameters(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  const clone = (obj) => {
    if (Array.isArray(obj))
      return obj.map(clone);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const k of Object.keys(obj)) {
        out[k] = clone(obj[k]);
      }
      return out;
    }
    return obj;
  };
  const cleaned = clone(schema);
  const stripKeys = ["additionalProperties", "$schema", "$id", "unevaluatedProperties", "definitions", "$defs"];
  const walk = (node) => {
    if (!node || typeof node !== "object")
      return;
    for (const key of stripKeys) {
      if (key in node)
        delete node[key];
    }
    if (node.properties) {
      for (const k of Object.keys(node.properties)) {
        walk(node.properties[k]);
      }
    }
    if (node.items)
      walk(node.items);
    if (Array.isArray(node.anyOf))
      node.anyOf.forEach(walk);
    if (Array.isArray(node.oneOf))
      node.oneOf.forEach(walk);
    if (Array.isArray(node.allOf))
      node.allOf.forEach(walk);
  };
  walk(cleaned);
  if (cleaned.type !== "object") {
    cleaned.type = "object";
    if (!cleaned.properties)
      cleaned.properties = {};
  }
  if (!Array.isArray(cleaned.required))
    cleaned.required = [];
  return cleaned;
}
function describeTool(t) {
  const base = t.description || "OpenCode tool";
  return base.length > 400 ? base.slice(0, 400) : base;
}
var log7;
var init_schema = __esm(() => {
  init_logger();
  log7 = createLogger("tools:schema");
});

// src/tools/router.ts
class ToolRouter {
  ctx;
  constructor(ctx) {
    this.ctx = ctx;
  }
  isOpenCodeTool(name) {
    return !!name && name.startsWith("oc_");
  }
  async handleToolCall(event, meta) {
    const callId = event.call_id || event.tool_call_id || "unknown";
    let name = event.name || this.inferName(event);
    if (!this.isOpenCodeTool(name))
      return null;
    if (this.ctx.resolveName) {
      const resolved = this.ctx.resolveName(name);
      if (resolved) {
        name = resolved;
      }
    }
    const tool = this.ctx.toolsByName.get(name);
    if (!tool) {
      log8.warn("Unknown tool call", { name });
      return this.buildResult(meta, callId, name, { status: "error", error: `Unknown tool ${name}` });
    }
    const args = this.extractArgs(event);
    log8.debug("Executing tool", { name, toolId: tool.id });
    const t0 = Date.now();
    const result = await this.ctx.execute(tool.id, args);
    const elapsed = Date.now() - t0;
    if (result.status === "error") {
      log8.warn("Tool execution returned error", { name, error: result.error, elapsed });
    } else {
      log8.debug("Tool execution completed", { name, toolId: tool.id, elapsed });
    }
    return this.buildResult(meta, callId, name, result);
  }
  extractArgs(event) {
    if (event.tool_call) {
      const [key] = Object.keys(event.tool_call);
      return event.tool_call[key]?.args || {};
    }
    return event.arguments || {};
  }
  inferName(event) {
    if (event.tool_call) {
      const [key] = Object.keys(event.tool_call);
      return key;
    }
    return;
  }
  buildResult(meta, callId, name, result) {
    const delta = {
      role: "assistant",
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: {
            name,
            arguments: "{}"
          }
        }
      ]
    };
    const content = result.status === "success" ? result.output ?? "" : result.error || "unknown error";
    delta.tool_calls[0].function.arguments = JSON.stringify({ result: content }).slice(0, 8000);
    return {
      id: meta.id,
      object: "chat.completion.chunk",
      created: meta.created,
      model: meta.model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: null
        }
      ]
    };
  }
}
var log8;
var init_router = __esm(() => {
  init_logger();
  log8 = createLogger("tools:router");
});

// src/tools/skills/loader.ts
function deriveCategory(name) {
  if (!name)
    return;
  const segments = name.split(/[\/:]/).filter(Boolean);
  if (segments.length === 0)
    return;
  return segments[segments.length - 1].toLowerCase();
}
function deriveTriggers(name, description) {
  const words = new Set;
  const addWord = (w) => {
    const word = w.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (word.length >= 4)
      words.add(word);
  };
  name.split(/[\s\/:_-]+/).forEach(addWord);
  (description || "").split(/[\s,.;:()]+/).filter((w) => w.length >= 4).slice(0, 12).forEach(addWord);
  return Array.from(words).slice(0, 6);
}

class SkillLoader {
  load(tools) {
    return tools.map((t) => {
      const baseId = t.id.replace(/[^a-zA-Z0-9_\-]/g, "_");
      const aliases = [
        t.name,
        baseId,
        `oc_${baseId}`,
        `oc_skill_${baseId}`,
        `oc_superskill_${baseId}`,
        `oc_superpowers_${baseId}`
      ];
      if (t.name === "todowrite") {
        aliases.push("updateTodos", "updateTodosToolCall", "todoWrite", "todoWriteToolCall");
      }
      if (t.name === "todoread") {
        aliases.push("readTodos", "readTodosToolCall", "todoRead", "todoReadToolCall");
      }
      const category = deriveCategory(t.name);
      const triggers = deriveTriggers(t.name, t.description);
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        source: t.source,
        aliases,
        category,
        triggers
      };
    });
  }
}

// src/tools/skills/resolver.ts
class SkillResolver {
  aliasToName = new Map;
  constructor(skills) {
    for (const s of skills) {
      const aliases = new Set([(s.name || "").toLowerCase(), (s.id || "").toLowerCase()]);
      (s.aliases || []).forEach((a) => aliases.add(a.toLowerCase()));
      (s.triggers || []).forEach((t) => aliases.add(t.toLowerCase()));
      for (const a of aliases) {
        this.aliasToName.set(a, s.name);
      }
    }
  }
  resolve(name) {
    if (!name)
      return;
    return this.aliasToName.get(name.toLowerCase());
  }
}

// src/client/sdk-child.ts
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolve2 } from "node:path";
import { existsSync as existsSync3 } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomBytes } from "node:crypto";
function extractEventJson(line) {
  const idx = line.indexOf(EVENT_KEY);
  if (idx < 0)
    return line;
  const start = idx + EVENT_KEY.length;
  const end = line.lastIndexOf("}");
  if (end <= start)
    return line;
  return line.substring(start, end);
}
function resolveNodeBinary() {
  return process.env.CURSOR_ACP_NODE_BIN || "node";
}
function resolveRunnerPath(currentFile = fileURLToPath(import.meta.url), checkExists = existsSync3, env = process.env) {
  const override = env.CURSOR_ACP_SDK_RUNNER_PATH?.trim();
  if (override) {
    if (checkExists(override)) {
      return override;
    }
    throw new Error(`CURSOR_ACP_SDK_RUNNER_PATH does not exist: ${override}`);
  }
  const currentDir = dirname(currentFile);
  const candidates = [
    resolve2(currentDir, "../../scripts/sdk-runner.mjs"),
    resolve2(currentDir, "../scripts/sdk-runner.mjs")
  ];
  for (const candidate of candidates) {
    if (checkExists(candidate)) {
      return candidate;
    }
  }
  log9.error("Could not resolve sdk-runner.mjs", {
    currentFile,
    candidates
  });
  throw new Error(`sdk-runner.mjs not found. Tried: ${candidates.join(", ")}`);
}
function generateRequestId() {
  return randomBytes(8).toString("hex");
}

class SdkRunnerSingleton {
  runnerProcess = null;
  lastApiKey = null;
  pendingRequests = new Map;
  lineBuffer = "";
  starting = null;
  async ensureRunning(apiKey) {
    if (this.lastApiKey && this.lastApiKey !== apiKey) {
      log9.info("API key changed, restarting runner");
      this.kill();
      this.starting = null;
    }
    if (this.runnerProcess) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.doSpawn(apiKey);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }
  async doSpawn(apiKey) {
    const nodeBin = resolveNodeBinary();
    const runnerPath = resolveRunnerPath();
    log9.info("spawning persistent sdk runner", {
      runnerPath,
      nodeBin
    });
    this.lastApiKey = apiKey;
    this.runnerProcess = spawn(nodeBin, [runnerPath], {
      env: { ...process.env, CURSOR_API_KEY: apiKey },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.runnerProcess.stdout?.on("data", (chunk) => {
      this.handleStdoutChunk(chunk);
    });
    this.runnerProcess.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8").trimEnd();
      for (const line of text.split(`
`)) {
        if (line) {
          log9.debug(`[runner stderr] ${line}`);
        }
      }
    });
    this.runnerProcess.on("close", (code) => {
      log9.error(`sdk runner exited with code ${code}`);
      this.runnerProcess = null;
      for (const [id, pending] of this.pendingRequests.entries()) {
        pending.promiseRejector(new Error(`Runner exited with code ${code}`));
        pending.controller.error(new Error(`Runner exited with code ${code}`));
      }
      this.pendingRequests.clear();
    });
    this.runnerProcess.on("error", (err) => {
      log9.error("sdk runner spawn error", { error: err.message });
      this.runnerProcess = null;
      for (const [id, pending] of this.pendingRequests.entries()) {
        pending.promiseRejector(err);
        pending.controller.error(err);
      }
      this.pendingRequests.clear();
    });
  }
  sendRequest(requestId, model, cwd, prompt) {
    if (!this.runnerProcess || !this.runnerProcess.stdin) {
      throw new Error("Runner process not ready");
    }
    const request = { id: requestId, model, cwd, prompt };
    this.runnerProcess.stdin.write(JSON.stringify(request) + `
`);
  }
  sendRawRequest(request) {
    if (!this.runnerProcess || !this.runnerProcess.stdin) {
      throw new Error("Runner process not ready");
    }
    this.runnerProcess.stdin.write(JSON.stringify(request) + `
`);
  }
  handleStdoutChunk(chunk) {
    this.lineBuffer += chunk.toString("utf8");
    const lines = this.lineBuffer.split(`
`);
    this.lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim())
        continue;
      try {
        const wrapped = JSON.parse(line);
        const requestId = wrapped.id;
        if (!requestId) {
          log9.warn("Wrapped response missing id", { wrapped });
          continue;
        }
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
          log9.warn(`Received response for unknown request ${requestId}`, { wrapped });
          continue;
        }
        if (wrapped.done) {
          log9.info(`Request ${requestId} complete with exitCode ${wrapped.exitCode}`);
          pending.controller.close();
          pending.promiseResolver(wrapped.exitCode ?? 0);
          this.pendingRequests.delete(requestId);
        } else if (wrapped.event) {
          const eventJson = extractEventJson(line);
          pending.controller.enqueue(textEncoder.encode(eventJson + `
`));
        }
      } catch (err) {
        log9.error("Failed to parse wrapped response line", {
          line,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
  registerPending(controller, promiseResolver, promiseRejector) {
    const id = generateRequestId();
    this.pendingRequests.set(id, { controller, promiseResolver, promiseRejector });
    return id;
  }
  kill() {
    if (this.runnerProcess) {
      try {
        this.runnerProcess.kill("SIGKILL");
      } catch {}
      this.runnerProcess = null;
    }
  }
}
function createSdkBunChild(options) {
  log9.info("creating sdk bun child", {
    model: options.model,
    cwd: options.cwd
  });
  let requestId;
  let resolveExited;
  let rejectExited;
  const exited = new Promise((resolve3, reject) => {
    resolveExited = resolve3;
    rejectExited = reject;
  });
  const stdout = new ReadableStream({
    start: async (controller) => {
      try {
        await singleton.ensureRunning(options.apiKey);
        requestId = singleton.registerPending(controller, resolveExited, rejectExited);
        log9.info(`request ${requestId} registered (bun)`);
        singleton.sendRequest(requestId, options.model, options.cwd, options.prompt);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log9.error("Failed to start request (bun)", { error: error.message });
        controller.error(error);
        rejectExited(error);
      }
    },
    cancel() {
      log9.debug(`request ${requestId} cancelled (bun)`);
    }
  });
  const stderr = new ReadableStream({
    start(controller) {
      controller.close();
    }
  });
  return {
    stdout,
    stderr,
    exited,
    kill() {
      log9.debug(`kill() called on bun child ${requestId}`);
    }
  };
}
function createSdkNodeChild(options) {
  const child = new SdkNodeChild;
  child.spawn(options).catch((err) => {
    log9.error("Spawn error", { error: err instanceof Error ? err.message : String(err) });
  });
  return child;
}
async function listModelsViaRunner(apiKey) {
  try {
    await singleton.ensureRunning(apiKey);
    return new Promise(async (resolve3, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout")), 15000);
      const events = [];
      let gotModels = false;
      const decoder = new TextDecoder;
      const controller = {
        enqueue: (data) => {
          try {
            const event = JSON.parse(decoder.decode(data).trim());
            events.push(event);
            if (event.type === "models")
              gotModels = true;
          } catch (err) {
            log9.warn("listModels: failed to parse event", { error: String(err) });
          }
        },
        close: () => {},
        error: (e) => reject(e)
      };
      const id = singleton.registerPending(controller, (code) => {
        clearTimeout(timeout);
        if (!gotModels)
          return reject(new Error("No models"));
        if (code !== 0)
          return reject(new Error(`Code ${code}`));
        const m = events.find((e) => e.type === "models");
        resolve3(m?.models ?? []);
      }, (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      singleton.sendRawRequest({ id, op: "listModels" });
    });
  } catch (err) {
    throw new Error(`listModelsViaRunner failed: ${String(err)}`);
  }
}
var log9, textEncoder, EVENT_KEY = '"event":', singleton, SdkNodeChild;
var init_sdk_child = __esm(() => {
  init_logger();
  log9 = createLogger("sdk-child");
  textEncoder = new TextEncoder;
  singleton = new SdkRunnerSingleton;
  SdkNodeChild = class SdkNodeChild extends EventEmitter {
    stdout = new PassThrough;
    stderr = new PassThrough;
    requestId = null;
    async spawn(options) {
      try {
        log9.info("spawning (via singleton) sdk node child", {
          model: options.model,
          cwd: options.cwd
        });
        await singleton.ensureRunning(options.apiKey);
        let requestId;
        let resolveExited;
        let rejectExited;
        const exited = new Promise((resolve3, reject) => {
          resolveExited = resolve3;
          rejectExited = reject;
        });
        const dummyController = {
          enqueue: (data) => {
            this.stdout.write(data);
          },
          close: () => {
            this.stdout.end();
          },
          error: (err) => {
            this.stdout.destroy(err);
          }
        };
        requestId = singleton.registerPending(dummyController, (code) => {
          this.stderr.end();
          this.emit("close", code);
          resolveExited(code);
        }, (err) => {
          this.stderr.end();
          this.emit("error", err);
          rejectExited(err);
        });
        this.requestId = requestId;
        log9.info(`request ${requestId} registered (node)`);
        singleton.sendRequest(requestId, options.model, options.cwd, options.prompt);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log9.error("Failed to spawn sdk node child", { error: error.message });
        this.emit("error", error);
      }
    }
    kill() {
      if (this.requestId) {
        log9.debug(`kill() called on node child ${this.requestId}`);
      }
    }
  };
});

// src/auth.ts
import { existsSync as existsSync4 } from "fs";
import { homedir as homedir3, platform } from "os";
import { join as join3 } from "path";
function getHomeDir() {
  const override = process.env.CURSOR_ACP_HOME_DIR;
  if (override && override.length > 0) {
    return override;
  }
  return homedir3();
}
function verifyCursorAuth() {
  const apiKey = process.env.CURSOR_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    log10.debug("CURSOR_API_KEY found, auth verified");
    return true;
  }
  const possiblePaths = getPossibleAuthPaths();
  for (const authPath of possiblePaths) {
    if (existsSync4(authPath)) {
      log10.debug("Auth file found", { path: authPath });
      return true;
    }
  }
  log10.debug("No auth found (no CURSOR_API_KEY, no auth file)", { checkedPaths: possiblePaths });
  return false;
}
function isUsableSdkApiKey(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  return !PLACEHOLDER_API_KEYS.has(trimmed.toLowerCase());
}
function normalizeAuthorizationHeader(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }
  const bearerMatch = /^bearer\s+(.+)$/i.exec(trimmed);
  return bearerMatch?.[1]?.trim() ?? trimmed;
}
function resolveSdkApiKey(input) {
  const candidates = [
    input.env?.CURSOR_API_KEY,
    input.storedApiKey,
    normalizeAuthorizationHeader(input.authorizationHeader)
  ];
  return candidates.find(isUsableSdkApiKey)?.trim();
}
function getPossibleAuthPaths() {
  const home = getHomeDir();
  const paths = [];
  const isDarwin = platform() === "darwin";
  const authFiles = ["cli-config.json", "auth.json"];
  if (isDarwin) {
    for (const file of authFiles) {
      paths.push(join3(home, ".cursor", file));
    }
    for (const file of authFiles) {
      paths.push(join3(home, ".config", "cursor", file));
    }
  } else {
    for (const file of authFiles) {
      paths.push(join3(home, ".config", "cursor", file));
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig && xdgConfig !== join3(home, ".config")) {
      for (const file of authFiles) {
        paths.push(join3(xdgConfig, "cursor", file));
      }
    }
    for (const file of authFiles) {
      paths.push(join3(home, ".cursor", file));
    }
  }
  return paths;
}
function getAuthFilePath() {
  const possiblePaths = getPossibleAuthPaths();
  for (const authPath of possiblePaths) {
    if (existsSync4(authPath)) {
      return authPath;
    }
  }
  return possiblePaths[0];
}
var log10, AUTH_POLL_TIMEOUT, PLACEHOLDER_API_KEYS;
var init_auth = __esm(() => {
  init_logger();
  log10 = createLogger("auth");
  AUTH_POLL_TIMEOUT = 5 * 60 * 1000;
  PLACEHOLDER_API_KEYS = new Set(["cursor-agent"]);
});

// src/models/pricing.ts
function getCursorModelCost(modelId) {
  if (modelId === "auto")
    return AUTO_COST;
  if (modelId === "composer-2-fast")
    return COMPOSER_2_FAST_COST;
  if (modelId === "composer-2")
    return COMPOSER_2_COST;
  if (modelId === "composer-1.5")
    return COMPOSER_1_5_COST;
  if (modelId.startsWith("claude-opus-4-7"))
    return CLAUDE_OPUS_COST;
  if (modelId.startsWith("claude-4.6-opus")) {
    return modelId.endsWith("-fast") ? CLAUDE_OPUS_FAST_COST : CLAUDE_OPUS_COST;
  }
  if (modelId.startsWith("claude-4.5-opus"))
    return CLAUDE_OPUS_COST;
  if (modelId.startsWith("claude-4.6-sonnet"))
    return CLAUDE_SONNET_WITH_LONG_CONTEXT_COST;
  if (modelId.startsWith("claude-4.5-sonnet"))
    return CLAUDE_SONNET_WITH_LONG_CONTEXT_COST;
  if (modelId.startsWith("claude-4-sonnet"))
    return CLAUDE_SONNET_COST;
  if (modelId === "gemini-3.1-pro")
    return GEMINI_3_PRO_COST;
  if (modelId === "gemini-3-flash")
    return GEMINI_3_FLASH_COST;
  if (modelId.startsWith("gpt-5.5"))
    return GPT_5_5_COST;
  if (modelId.startsWith("gpt-5.4-mini"))
    return GPT_5_4_MINI_COST;
  if (modelId.startsWith("gpt-5.4-nano"))
    return GPT_5_4_NANO_COST;
  if (modelId.startsWith("gpt-5.4")) {
    return modelId.endsWith("-fast") ? GPT_5_4_FAST_COST : GPT_5_4_COST;
  }
  if (modelId.startsWith("gpt-5.3-codex"))
    return GPT_5_3_CODEX_COST;
  if (modelId.startsWith("gpt-5.2-codex"))
    return GPT_5_2_COST;
  if (modelId.startsWith("gpt-5.2"))
    return GPT_5_2_COST;
  if (modelId.startsWith("gpt-5.1-codex-mini"))
    return GPT_5_MINI_COST;
  if (modelId.startsWith("gpt-5.1-codex-max"))
    return GPT_5_1_COST;
  if (modelId.startsWith("gpt-5.1"))
    return GPT_5_1_COST;
  if (modelId === "gpt-5-mini")
    return GPT_5_MINI_COST;
  if (modelId.startsWith("grok-4-20"))
    return GROK_4_20_COST;
  if (modelId === "kimi-k2.5")
    return KIMI_K2_5_COST;
  return;
}
function cost(input, output, cacheRead, cacheWrite) {
  return {
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite
  };
}
function withLongContext(base, longContext) {
  return {
    ...base,
    context_over_200k: longContext
  };
}
var AUTO_COST, COMPOSER_2_COST, COMPOSER_2_FAST_COST, COMPOSER_1_5_COST, CLAUDE_SONNET_COST, CLAUDE_SONNET_LONG_CONTEXT_COST, CLAUDE_SONNET_WITH_LONG_CONTEXT_COST, CLAUDE_OPUS_COST, CLAUDE_OPUS_FAST_COST, GEMINI_3_PRO_COST, GEMINI_3_FLASH_COST, GPT_5_1_COST, GPT_5_2_COST, GPT_5_3_CODEX_COST, GPT_5_4_COST, GPT_5_4_FAST_COST, GPT_5_4_MINI_COST, GPT_5_4_NANO_COST, GPT_5_5_COST, GPT_5_MINI_COST, GROK_4_20_COST, KIMI_K2_5_COST;
var init_pricing = __esm(() => {
  AUTO_COST = cost(1.25, 6, 0.25, 1.25);
  COMPOSER_2_COST = cost(0.5, 2.5, 0.2, 0.5);
  COMPOSER_2_FAST_COST = cost(1.5, 7.5, 0.35, 1.5);
  COMPOSER_1_5_COST = cost(3.5, 17.5, 0.35, 3.5);
  CLAUDE_SONNET_COST = cost(3, 15, 0.3, 3.75);
  CLAUDE_SONNET_LONG_CONTEXT_COST = cost(6, 22.5, 0.6, 7.5);
  CLAUDE_SONNET_WITH_LONG_CONTEXT_COST = withLongContext(CLAUDE_SONNET_COST, CLAUDE_SONNET_LONG_CONTEXT_COST);
  CLAUDE_OPUS_COST = cost(5, 25, 0.5, 6.25);
  CLAUDE_OPUS_FAST_COST = cost(30, 150, 3, 37.5);
  GEMINI_3_PRO_COST = withLongContext(cost(2, 12, 0.2, 2), cost(4, 18, 0.4, 4));
  GEMINI_3_FLASH_COST = cost(0.5, 3, 0.05, 0.5);
  GPT_5_1_COST = cost(1.25, 10, 0.125, 1.25);
  GPT_5_2_COST = cost(1.75, 14, 0.175, 1.75);
  GPT_5_3_CODEX_COST = cost(1.75, 14, 0.175, 1.75);
  GPT_5_4_COST = withLongContext(cost(2.5, 15, 0.25, 2.5), cost(5, 22.5, 0.5, 5));
  GPT_5_4_FAST_COST = cost(5, 30, 0.5, 5);
  GPT_5_4_MINI_COST = cost(0.75, 4.5, 0.075, 0.75);
  GPT_5_4_NANO_COST = cost(0.2, 1.25, 0.02, 0.2);
  GPT_5_5_COST = withLongContext(cost(5, 30, 0.5, 5), cost(10, 45, 1, 10));
  GPT_5_MINI_COST = cost(0.25, 2, 0.025, 0.25);
  GROK_4_20_COST = withLongContext(cost(2, 6, 0.2, 2), cost(4, 12, 0.4, 4));
  KIMI_K2_5_COST = cost(0.6, 3, 0.1, 0.6);
});

// src/models/variants.ts
function isSafeBaseId(baseId) {
  const parts = baseId.split("-").filter(Boolean);
  if (parts.length < 2)
    return false;
  if (baseId === "gpt-5")
    return false;
  return true;
}
function generateBaseCandidates(modelId) {
  const tokens = modelId.split("-");
  const candidates = [];
  for (let i = tokens.length - 1;i >= 1; i--) {
    const prefix = tokens.slice(0, i).join("-");
    if (isSafeBaseId(prefix))
      candidates.push(prefix);
  }
  return candidates;
}
function computeStats(candidate, modelIds) {
  const prefix = `${candidate}-`;
  const firstTokens = new Set;
  let count = 0;
  for (const otherId of modelIds) {
    if (!otherId.startsWith(prefix))
      continue;
    count++;
    const firstToken = otherId.slice(prefix.length).split("-", 1)[0];
    if (firstToken)
      firstTokens.add(firstToken);
  }
  return { count, diversity: firstTokens.size };
}
function chooseBase(modelId, knownModelIds, modelIds) {
  const candidates = generateBaseCandidates(modelId);
  if (candidates.length === 0)
    return null;
  const stats = new Map;
  for (const candidate of candidates) {
    stats.set(candidate, computeStats(candidate, modelIds));
  }
  let stepA = null;
  for (const candidate of candidates) {
    if (!knownModelIds.has(candidate))
      continue;
    const stat = stats.get(candidate);
    if (!stat || stat.count < 2 || stat.diversity < 2)
      continue;
    if (stepA === null || candidate.length < stepA.length)
      stepA = candidate;
  }
  if (stepA !== null)
    return stepA;
  let stepB = null;
  for (const candidate of candidates) {
    const stat = stats.get(candidate);
    if (!stat || stat.count < 2)
      continue;
    if (stepB === null || stat.diversity > stepB.diversity || stat.diversity === stepB.diversity && candidate.length > stepB.base.length) {
      stepB = { base: candidate, diversity: stat.diversity };
    }
  }
  if (stepB !== null)
    return stepB.base;
  let stepC = null;
  for (const candidate of candidates) {
    if (!knownModelIds.has(candidate))
      continue;
    if (stepC === null || candidate.length < stepC.length)
      stepC = candidate;
  }
  return stepC;
}
function getDefaultMember(members) {
  for (const variant of DEFAULT_VARIANT_ORDER) {
    const member = members.find((candidate) => candidate.variant === variant);
    if (member)
      return member;
  }
  return members[0];
}
function formatModelName(modelId) {
  return modelId.split("-").map((part) => {
    if (part === "gpt")
      return "GPT";
    if (part === "xhigh")
      return "XHigh";
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(" ");
}
function compareVariants(a, b) {
  if (a.variant === null)
    return -1;
  if (b.variant === null)
    return 1;
  const aIndex = VARIANT_DISPLAY_ORDER.indexOf(a.variant);
  const bIndex = VARIANT_DISPLAY_ORDER.indexOf(b.variant);
  if (aIndex !== -1 && bIndex !== -1)
    return aIndex - bIndex;
  if (aIndex !== -1)
    return -1;
  if (bIndex !== -1)
    return 1;
  return a.variant.localeCompare(b.variant);
}
function createGroup(baseId, members) {
  const defaultMember = getDefaultMember(members);
  const variants = {};
  for (const member of [...members].sort(compareVariants)) {
    if (member.variant) {
      variants[member.variant] = member.cursorModelId;
    }
  }
  return {
    baseId,
    name: defaultMember.variant === null ? defaultMember.name : formatModelName(baseId),
    defaultCursorModelId: defaultMember.cursorModelId,
    variants,
    members
  };
}
function groupCursorModels(models) {
  const knownModelIds = new Set(models.map((model) => model.id));
  const modelIds = models.map((model) => model.id);
  const preferredBase = new Map;
  for (const model of models) {
    const base = chooseBase(model.id, knownModelIds, modelIds);
    if (base)
      preferredBase.set(model.id, base);
  }
  const baseSet = new Set(preferredBase.values());
  const groupMembers = new Map;
  const groupOrder = [];
  const recordMember = (baseId, member) => {
    const existing = groupMembers.get(baseId);
    if (existing) {
      existing.push(member);
      return;
    }
    groupMembers.set(baseId, [member]);
    groupOrder.push(baseId);
  };
  for (const model of models) {
    if (baseSet.has(model.id) && knownModelIds.has(model.id)) {
      recordMember(model.id, {
        baseId: model.id,
        variant: null,
        cursorModelId: model.id,
        name: model.name
      });
      continue;
    }
    const base = preferredBase.get(model.id);
    if (!base)
      continue;
    recordMember(base, {
      baseId: base,
      variant: model.id.slice(base.length + 1),
      cursorModelId: model.id,
      name: model.name
    });
  }
  const groupedIds = new Set;
  const groups = [];
  for (const baseId of groupOrder) {
    const members = groupMembers.get(baseId);
    if (!members || members.length < 2)
      continue;
    groups.push(createGroup(baseId, members));
    for (const member of members)
      groupedIds.add(member.cursorModelId);
  }
  const direct = [];
  for (const model of models) {
    if (groupedIds.has(model.id))
      continue;
    direct.push(model);
  }
  return { groups, direct };
}
function createVariantModelEntries(models) {
  const { groups, direct } = groupCursorModels(models);
  const entries = {};
  const groupedModelIds = new Set;
  for (const group of groups) {
    const variants = {};
    for (const [variant, cursorModel] of Object.entries(group.variants)) {
      const variantEntry = { cursorModel };
      const variantCost = getCursorModelCost(cursorModel);
      if (variantCost)
        variantEntry.cost = variantCost;
      variants[variant] = variantEntry;
    }
    const groupEntry = {
      name: group.name,
      options: {
        cursorModel: group.defaultCursorModelId
      },
      variants
    };
    const defaultCost = getCursorModelCost(group.defaultCursorModelId);
    if (defaultCost)
      groupEntry.cost = defaultCost;
    entries[group.baseId] = groupEntry;
    for (const member of group.members) {
      groupedModelIds.add(member.cursorModelId);
    }
  }
  for (const model of direct) {
    const entry = { name: model.name };
    const directCost = getCursorModelCost(model.id);
    if (directCost)
      entry.cost = directCost;
    entries[model.id] = entry;
  }
  return { entries, groupedModelIds };
}
function mergeCursorModelEntries(existingModels, discoveredModels, options) {
  if (!options.variants) {
    return mergeDirectModelEntries(existingModels, discoveredModels);
  }
  const { entries, groupedModelIds } = createVariantModelEntries(discoveredModels);
  const models = { ...existingModels };
  let removedCount = 0;
  if (options.compact) {
    for (const modelId of groupedModelIds) {
      if (!Object.prototype.hasOwnProperty.call(models, modelId))
        continue;
      if (Object.prototype.hasOwnProperty.call(entries, modelId))
        continue;
      delete models[modelId];
      removedCount++;
    }
  }
  for (const [modelId, entry] of Object.entries(entries)) {
    models[modelId] = mergeEntryPreservingUserFields(models[modelId], entry);
  }
  return {
    models,
    syncedCount: Object.keys(entries).length,
    groupedCount: groupedModelIds.size,
    removedCount
  };
}
function mergeDirectModelEntries(existingModels, discoveredModels) {
  const models = { ...existingModels };
  for (const model of discoveredModels) {
    const generated = { name: model.name };
    const directCost = getCursorModelCost(model.id);
    if (directCost)
      generated.cost = directCost;
    models[model.id] = mergeEntryPreservingUserFields(models[model.id], generated);
  }
  return {
    models,
    syncedCount: discoveredModels.length,
    groupedCount: 0,
    removedCount: 0
  };
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mergeEntryPreservingUserFields(existing, generated) {
  if (!isPlainObject(existing))
    return generated;
  const merged = { ...existing, ...generated };
  if (existing.cost !== undefined) {
    merged.cost = existing.cost;
  }
  // Keep image-input flags across sync-models so OpenCode does not fall back
  // to text-only and emit "does not support image input" for attachments.
  if (existing.attachment !== undefined) {
    merged.attachment = existing.attachment;
  }
  if (existing.modalities !== undefined) {
    merged.modalities = existing.modalities;
  }
  if (isPlainObject(existing.variants) && isPlainObject(generated.variants)) {
    const mergedVariants = { ...generated.variants };
    for (const [variantKey, existingVariant] of Object.entries(existing.variants)) {
      const generatedVariant = generated.variants[variantKey];
      if (!isPlainObject(existingVariant))
        continue;
      if (!isPlainObject(generatedVariant)) {
        mergedVariants[variantKey] = existingVariant;
        continue;
      }
      const variantMerged = { ...generatedVariant };
      if (existingVariant.cost !== undefined) {
        variantMerged.cost = existingVariant.cost;
      }
      mergedVariants[variantKey] = variantMerged;
    }
    merged.variants = mergedVariants;
  }
  return merged;
}
var DEFAULT_VARIANT_ORDER, VARIANT_DISPLAY_ORDER;
var init_variants = __esm(() => {
  init_pricing();
  DEFAULT_VARIANT_ORDER = [
    null,
    "medium",
    "high",
    "low",
    "none",
    "xhigh",
    "max"
  ];
  VARIANT_DISPLAY_ORDER = [
    "none",
    "low",
    "low-fast",
    "fast",
    "medium",
    "medium-fast",
    "medium-thinking",
    "high",
    "high-fast",
    "high-thinking",
    "high-thinking-fast",
    "xhigh",
    "xhigh-fast",
    "max",
    "max-thinking",
    "max-thinking-fast",
    "thinking",
    "thinking-low",
    "thinking-medium",
    "thinking-high",
    "thinking-high-fast",
    "thinking-xhigh",
    "thinking-max",
    "extra-high",
    "spark-preview",
    "spark-preview-low",
    "spark-preview-medium",
    "spark-preview-high",
    "spark-preview-xhigh"
  ];
});

// src/models/sync.ts
import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  writeFileSync as nodeWriteFileSync
} from "node:fs";
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseConfig(raw) {
  const parsed = typeof raw === "string" ? parseOpenCodeConfigText(raw) : parseOpenCodeConfigText(JSON.stringify(raw));
  return isRecord4(parsed) ? parsed : null;
}
function getProviderConfig(config) {
  if (!isRecord4(config.provider)) {
    return null;
  }
  const provider = config.provider[PROVIDER_ID];
  return isRecord4(provider) ? provider : null;
}
function getExistingModels(provider) {
  return isRecord4(provider.models) ? { ...provider.models } : {};
}
function readCursorModel(value) {
  if (!isRecord4(value))
    return;
  const cursorModel = value.cursorModel;
  return typeof cursorModel === "string" && cursorModel.trim().length > 0 ? cursorModel.trim() : undefined;
}
function collectRepresentedModelIds(models) {
  const represented = new Set(Object.keys(models));
  for (const entry of Object.values(models)) {
    if (!isRecord4(entry))
      continue;
    const optionModel = readCursorModel(entry.options);
    if (optionModel)
      represented.add(optionModel);
    if (!isRecord4(entry.variants))
      continue;
    for (const variantEntry of Object.values(entry.variants)) {
      const variantModel = readCursorModel(variantEntry);
      if (variantModel)
        represented.add(variantModel);
    }
  }
  return represented;
}
function yieldForFireAndForget() {
  return Promise.resolve();
}
function getAutoRefreshMode(env) {
  const raw = env.CURSOR_ACP_MODEL_AUTO_REFRESH?.trim().toLowerCase();
  if (raw === "false")
    return "disabled";
  if (raw === "compact")
    return "compact";
  return "direct";
}
async function autoRefreshModels(deps = {}) {
  const resolvedDeps = {
    ...defaultDeps,
    defer: yieldForFireAndForget,
    ...deps
  };
  await resolvedDeps.defer();
  try {
    const refreshMode = getAutoRefreshMode(resolvedDeps.env);
    if (refreshMode === "disabled") {
      resolvedDeps.log.debug("Model auto-refresh disabled by CURSOR_ACP_MODEL_AUTO_REFRESH");
      return;
    }
    const configPath = resolveOpenCodeConfigPath(resolvedDeps.env);
    if (!resolvedDeps.existsSync(configPath)) {
      resolvedDeps.log.debug("Config file not found, skipping model auto-refresh", { configPath });
      return;
    }
    const raw = resolvedDeps.readFileSync(configPath, "utf8");
    const config = parseConfig(raw);
    if (!config) {
      resolvedDeps.log.debug("Config file is not valid JSON, skipping model auto-refresh");
      return;
    }
    const provider = getProviderConfig(config);
    if (!provider) {
      resolvedDeps.log.debug("Provider section not found in config, skipping model auto-refresh");
      return;
    }
    const existingModels = getExistingModels(provider);
    let discovered;
    try {
      discovered = await resolvedDeps.discoverModels();
    } catch (err) {
      resolvedDeps.log.debug("Model discovery failed, skipping auto-refresh", {
        error: String(err)
      });
      return;
    }
    if (refreshMode === "compact") {
      const representedModelIds = collectRepresentedModelIds(existingModels);
      const missingModels = discovered.filter((model) => !representedModelIds.has(model.id));
      const result = mergeCursorModelEntries(existingModels, discovered, {
        variants: true,
        compact: true
      });
      if (missingModels.length === 0 && result.removedCount === 0 && modelsEqual(existingModels, result.models)) {
        resolvedDeps.log.debug("Model auto-refresh: no new models found", {
          existing: Object.keys(existingModels).length,
          discovered: discovered.length
        });
        return;
      }
      provider.models = result.models;
      resolvedDeps.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}
`, "utf8");
      resolvedDeps.log.info("Model auto-refresh: synced models", {
        mode: refreshMode,
        synced: result.syncedCount,
        grouped: result.groupedCount,
        removed: result.removedCount,
        total: Object.keys(result.models).length
      });
      return;
    }
    let addedCount = 0;
    for (const model of discovered) {
      if (Object.prototype.hasOwnProperty.call(existingModels, model.id))
        continue;
      existingModels[model.id] = { name: model.name };
      addedCount++;
    }
    if (addedCount === 0) {
      resolvedDeps.log.debug("Model auto-refresh: no new models found", {
        existing: Object.keys(existingModels).length,
        discovered: discovered.length
      });
      return;
    }
    provider.models = existingModels;
    resolvedDeps.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}
`, "utf8");
    resolvedDeps.log.info("Model auto-refresh: added new models", {
      added: addedCount,
      total: Object.keys(existingModels).length
    });
  } catch (err) {
    resolvedDeps.log.debug("Model auto-refresh failed", { error: String(err) });
  }
}
function modelsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
var log11, PROVIDER_ID = "cursor", defaultDeps;
var init_sync = __esm(() => {
  init_sdk_child();
  init_auth();
  init_plugin_toggle();
  init_logger();
  init_variants();
  log11 = createLogger("model-sync");
  defaultDeps = {
    defer: () => Promise.resolve(),
    discoverModels: async () => {
      const apiKey = resolveSdkApiKey({ env: process.env });
      if (!apiKey) {
        throw new Error("CURSOR_API_KEY not set");
      }
      const models = await listModelsViaRunner(apiKey);
      return models.map((m) => ({ id: m.id, name: m.name }));
    },
    env: process.env,
    existsSync: nodeExistsSync,
    log: log11,
    readFileSync: nodeReadFileSync,
    writeFileSync: nodeWriteFileSync
  };
});

// src/mcp/config.ts
import {
  existsSync as nodeExistsSync2,
  readFileSync as nodeReadFileSync2,
  readdirSync as nodeReaddirSync2
} from "node:fs";
function readMcpConfigs(deps = {}) {
  let raw;
  if (deps.configJson != null) {
    raw = deps.configJson;
  } else {
    const exists = deps.existsSync ?? nodeExistsSync2;
    const readFile = deps.readFileSync ?? nodeReadFileSync2;
    const configPath = resolveOpenCodeConfigPath(deps.env ?? process.env);
    if (!exists(configPath))
      return [];
    try {
      raw = readFile(configPath, "utf8");
    } catch {
      return [];
    }
  }
  const parsed = typeof raw === "string" ? parseOpenCodeConfigText(raw) : parseOpenCodeConfigText(JSON.stringify(raw));
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  const mcpSection = parsed.mcp;
  if (!mcpSection || typeof mcpSection !== "object" || Array.isArray(mcpSection)) {
    return [];
  }
  const configs = [];
  for (const [name, entry] of Object.entries(mcpSection)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      continue;
    const e = entry;
    if (e.enabled === false)
      continue;
    if (e.type === "local" && Array.isArray(e.command) && e.command.length > 0) {
      configs.push({
        name,
        type: "local",
        command: e.command,
        environment: isStringRecord(e.environment) ? e.environment : undefined,
        timeout: typeof e.timeout === "number" ? e.timeout : undefined
      });
    } else if (e.type === "remote" && typeof e.url === "string") {
      configs.push({
        name,
        type: "remote",
        url: e.url,
        headers: isStringRecord(e.headers) ? e.headers : undefined,
        timeout: typeof e.timeout === "number" ? e.timeout : undefined
      });
    } else {
      log12.debug("Skipping unrecognised MCP config entry", { name, type: e.type });
    }
  }
  return configs;
}
function readSubagentNames(deps = {}) {
  const useCache = deps.configJson == null;
  if (useCache && _subagentCache && Date.now() < _subagentCache.expiry) {
    return _subagentCache.names;
  }
  const result = readSubagentNamesUncached(deps);
  if (useCache) {
    _subagentCache = { names: result, expiry: Date.now() + SUBAGENT_CACHE_TTL_MS };
  }
  return result;
}
function readMarkdownSubagentNames(deps = {}) {
  const exists = deps.existsSync ?? nodeExistsSync2;
  const readdir = deps.readdirSync ?? nodeReaddirSync2;
  const readFile = deps.readFileSync ?? nodeReadFileSync2;
  const env = deps.env ?? process.env;
  const configHome = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(homedir(), ".config");
  const dirs = [
    join(configHome, "opencode", "agents"),
    join(configHome, "opencode", ".opencode", "agents")
  ];
  const names = /* @__PURE__ */ new Set();
  for (const dir of dirs) {
    if (!exists(dir)) continue;
    let entries;
    try {
      entries = readdir(dir);
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.toLowerCase().endsWith(".md")) continue;
      const name = ent.replace(/\.md$/i, "");
      try {
        const content = readFile(join(dir, ent), "utf8");
        const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fm) continue;
        const mode = fm[1].match(/^mode:\s*(\S+)/m);
        if (mode && mode[1] === "subagent") names.add(name);
      } catch {
      }
    }
  }
  return [...names];
}
function readSubagentNamesUncached(deps) {
  let raw;
  if (deps.configJson != null) {
    raw = deps.configJson;
  } else {
    const exists = deps.existsSync ?? nodeExistsSync2;
    const readFile = deps.readFileSync ?? nodeReadFileSync2;
    const configPath = resolveOpenCodeConfigPath(deps.env ?? process.env);
    if (!exists(configPath)) {
      const markdownNames = readMarkdownSubagentNames(deps);
      return markdownNames.length > 0 ? markdownNames : DEFAULT_SUBAGENT_NAMES;
    }
    try {
      raw = readFile(configPath, "utf8");
    } catch {
      const markdownNames = readMarkdownSubagentNames(deps);
      return markdownNames.length > 0 ? markdownNames : DEFAULT_SUBAGENT_NAMES;
    }
  }
  const parsed = typeof raw === "string" ? parseOpenCodeConfigText(raw) : parseOpenCodeConfigText(JSON.stringify(raw));
  if (!parsed || typeof parsed !== "object") {
    const markdownNames = readMarkdownSubagentNames(deps);
    return markdownNames.length > 0 ? markdownNames : DEFAULT_SUBAGENT_NAMES;
  }
  const names = /* @__PURE__ */ new Set();
  const agentSection = parsed.agent;
  if (agentSection && typeof agentSection === "object" && !Array.isArray(agentSection)) {
    for (const [name, entry] of Object.entries(agentSection)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      if (!entry.mode || entry.mode === "subagent" || entry.mode === "all") names.add(name);
    }
  }
  for (const name of readMarkdownSubagentNames(deps)) names.add(name);
  if (names.size === 0) return DEFAULT_SUBAGENT_NAMES;
  return [...names].sort((a, b) => a.localeCompare(b));
}
function isStringRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
var log12, _subagentCache = null, SUBAGENT_CACHE_TTL_MS = 60000;
var init_config = __esm(() => {
  init_plugin_toggle();
  init_logger();
  log12 = createLogger("mcp:config");
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
import * as z3rt from "zod/v3";
import * as z4mini from "zod/v4-mini";
function isZ4Schema(s) {
  const schema = s;
  return !!schema._zod;
}
function safeParse2(schema, data) {
  if (isZ4Schema(schema)) {
    const result2 = z4mini.safeParse(schema, data);
    return result2;
  }
  const v3Schema = schema;
  const result = v3Schema.safeParse(data);
  return result;
}
function getObjectShape(schema) {
  if (!schema)
    return;
  let rawShape;
  if (isZ4Schema(schema)) {
    const v4Schema = schema;
    rawShape = v4Schema._zod?.def?.shape;
  } else {
    const v3Schema = schema;
    rawShape = v3Schema.shape;
  }
  if (!rawShape)
    return;
  if (typeof rawShape === "function") {
    try {
      return rawShape();
    } catch {
      return;
    }
  }
  return rawShape;
}
function getLiteralValue(schema) {
  if (isZ4Schema(schema)) {
    const v4Schema = schema;
    const def2 = v4Schema._zod?.def;
    if (def2) {
      if (def2.value !== undefined)
        return def2.value;
      if (Array.isArray(def2.values) && def2.values.length > 0) {
        return def2.values[0];
      }
    }
  }
  const v3Schema = schema;
  const def = v3Schema._def;
  if (def) {
    if (def.value !== undefined)
      return def.value;
    if (Array.isArray(def.values) && def.values.length > 0) {
      return def.values[0];
    }
  }
  const directValue = schema.value;
  if (directValue !== undefined)
    return directValue;
  return;
}
var init_zod_compat = () => {};

// node_modules/@modelcontextprotocol/sdk/dist/esm/types.js
import * as z from "zod/v4";
var LATEST_PROTOCOL_VERSION = "2025-11-25", SUPPORTED_PROTOCOL_VERSIONS, RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task", JSONRPC_VERSION = "2.0", AssertObjectSchema, ProgressTokenSchema, CursorSchema, TaskCreationParamsSchema, TaskMetadataSchema, RelatedTaskMetadataSchema, RequestMetaSchema, BaseRequestParamsSchema, TaskAugmentedRequestParamsSchema, isTaskAugmentedRequestParams = (value) => TaskAugmentedRequestParamsSchema.safeParse(value).success, RequestSchema, NotificationsParamsSchema, NotificationSchema, ResultSchema, RequestIdSchema, JSONRPCRequestSchema, isJSONRPCRequest = (value) => JSONRPCRequestSchema.safeParse(value).success, JSONRPCNotificationSchema, isJSONRPCNotification = (value) => JSONRPCNotificationSchema.safeParse(value).success, JSONRPCResultResponseSchema, isJSONRPCResultResponse = (value) => JSONRPCResultResponseSchema.safeParse(value).success, ErrorCode, JSONRPCErrorResponseSchema, isJSONRPCErrorResponse = (value) => JSONRPCErrorResponseSchema.safeParse(value).success, JSONRPCMessageSchema, JSONRPCResponseSchema, EmptyResultSchema, CancelledNotificationParamsSchema, CancelledNotificationSchema, IconSchema, IconsSchema, BaseMetadataSchema, ImplementationSchema, FormElicitationCapabilitySchema, ElicitationCapabilitySchema, ClientTasksCapabilitySchema, ServerTasksCapabilitySchema, ClientCapabilitiesSchema, InitializeRequestParamsSchema, InitializeRequestSchema, ServerCapabilitiesSchema, InitializeResultSchema, InitializedNotificationSchema, PingRequestSchema, ProgressSchema, ProgressNotificationParamsSchema, ProgressNotificationSchema, PaginatedRequestParamsSchema, PaginatedRequestSchema, PaginatedResultSchema, TaskStatusSchema, TaskSchema, CreateTaskResultSchema, TaskStatusNotificationParamsSchema, TaskStatusNotificationSchema, GetTaskRequestSchema, GetTaskResultSchema, GetTaskPayloadRequestSchema, GetTaskPayloadResultSchema, ListTasksRequestSchema, ListTasksResultSchema, CancelTaskRequestSchema, CancelTaskResultSchema, ResourceContentsSchema, TextResourceContentsSchema, Base64Schema, BlobResourceContentsSchema, RoleSchema, AnnotationsSchema, ResourceSchema, ResourceTemplateSchema, ListResourcesRequestSchema, ListResourcesResultSchema, ListResourceTemplatesRequestSchema, ListResourceTemplatesResultSchema, ResourceRequestParamsSchema, ReadResourceRequestParamsSchema, ReadResourceRequestSchema, ReadResourceResultSchema, ResourceListChangedNotificationSchema, SubscribeRequestParamsSchema, SubscribeRequestSchema, UnsubscribeRequestParamsSchema, UnsubscribeRequestSchema, ResourceUpdatedNotificationParamsSchema, ResourceUpdatedNotificationSchema, PromptArgumentSchema, PromptSchema, ListPromptsRequestSchema, ListPromptsResultSchema, GetPromptRequestParamsSchema, GetPromptRequestSchema, TextContentSchema, ImageContentSchema, AudioContentSchema, ToolUseContentSchema, EmbeddedResourceSchema, ResourceLinkSchema, ContentBlockSchema, PromptMessageSchema, GetPromptResultSchema, PromptListChangedNotificationSchema, ToolAnnotationsSchema, ToolExecutionSchema, ToolSchema, ListToolsRequestSchema, ListToolsResultSchema, CallToolResultSchema, CompatibilityCallToolResultSchema, CallToolRequestParamsSchema, CallToolRequestSchema, ToolListChangedNotificationSchema, ListChangedOptionsBaseSchema, LoggingLevelSchema, SetLevelRequestParamsSchema, SetLevelRequestSchema, LoggingMessageNotificationParamsSchema, LoggingMessageNotificationSchema, ModelHintSchema, ModelPreferencesSchema, ToolChoiceSchema, ToolResultContentSchema, SamplingContentSchema, SamplingMessageContentBlockSchema, SamplingMessageSchema, CreateMessageRequestParamsSchema, CreateMessageRequestSchema, CreateMessageResultSchema, CreateMessageResultWithToolsSchema, BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema, UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema, LegacyTitledEnumSchemaSchema, SingleSelectEnumSchemaSchema, UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema, MultiSelectEnumSchemaSchema, EnumSchemaSchema, PrimitiveSchemaDefinitionSchema, ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema, ElicitRequestParamsSchema, ElicitRequestSchema, ElicitationCompleteNotificationParamsSchema, ElicitationCompleteNotificationSchema, ElicitResultSchema, ResourceTemplateReferenceSchema, PromptReferenceSchema, CompleteRequestParamsSchema, CompleteRequestSchema, CompleteResultSchema, RootSchema, ListRootsRequestSchema, ListRootsResultSchema, RootsListChangedNotificationSchema, ClientRequestSchema, ClientNotificationSchema, ClientResultSchema, ServerRequestSchema, ServerNotificationSchema, ServerResultSchema, McpError, UrlElicitationRequiredError;
var init_types = __esm(() => {
  SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
  AssertObjectSchema = z.custom((v) => v !== null && (typeof v === "object" || typeof v === "function"));
  ProgressTokenSchema = z.union([z.string(), z.number().int()]);
  CursorSchema = z.string();
  TaskCreationParamsSchema = z.looseObject({
    ttl: z.union([z.number(), z.null()]).optional(),
    pollInterval: z.number().optional()
  });
  TaskMetadataSchema = z.object({
    ttl: z.number().optional()
  });
  RelatedTaskMetadataSchema = z.object({
    taskId: z.string()
  });
  RequestMetaSchema = z.looseObject({
    progressToken: ProgressTokenSchema.optional(),
    [RELATED_TASK_META_KEY]: RelatedTaskMetadataSchema.optional()
  });
  BaseRequestParamsSchema = z.object({
    _meta: RequestMetaSchema.optional()
  });
  TaskAugmentedRequestParamsSchema = BaseRequestParamsSchema.extend({
    task: TaskMetadataSchema.optional()
  });
  RequestSchema = z.object({
    method: z.string(),
    params: BaseRequestParamsSchema.loose().optional()
  });
  NotificationsParamsSchema = z.object({
    _meta: RequestMetaSchema.optional()
  });
  NotificationSchema = z.object({
    method: z.string(),
    params: NotificationsParamsSchema.loose().optional()
  });
  ResultSchema = z.looseObject({
    _meta: RequestMetaSchema.optional()
  });
  RequestIdSchema = z.union([z.string(), z.number().int()]);
  JSONRPCRequestSchema = z.object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    id: RequestIdSchema,
    ...RequestSchema.shape
  }).strict();
  JSONRPCNotificationSchema = z.object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    ...NotificationSchema.shape
  }).strict();
  JSONRPCResultResponseSchema = z.object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    id: RequestIdSchema,
    result: ResultSchema
  }).strict();
  (function(ErrorCode2) {
    ErrorCode2[ErrorCode2["ConnectionClosed"] = -32000] = "ConnectionClosed";
    ErrorCode2[ErrorCode2["RequestTimeout"] = -32001] = "RequestTimeout";
    ErrorCode2[ErrorCode2["ParseError"] = -32700] = "ParseError";
    ErrorCode2[ErrorCode2["InvalidRequest"] = -32600] = "InvalidRequest";
    ErrorCode2[ErrorCode2["MethodNotFound"] = -32601] = "MethodNotFound";
    ErrorCode2[ErrorCode2["InvalidParams"] = -32602] = "InvalidParams";
    ErrorCode2[ErrorCode2["InternalError"] = -32603] = "InternalError";
    ErrorCode2[ErrorCode2["UrlElicitationRequired"] = -32042] = "UrlElicitationRequired";
  })(ErrorCode || (ErrorCode = {}));
  JSONRPCErrorResponseSchema = z.object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    id: RequestIdSchema.optional(),
    error: z.object({
      code: z.number().int(),
      message: z.string(),
      data: z.unknown().optional()
    })
  }).strict();
  JSONRPCMessageSchema = z.union([
    JSONRPCRequestSchema,
    JSONRPCNotificationSchema,
    JSONRPCResultResponseSchema,
    JSONRPCErrorResponseSchema
  ]);
  JSONRPCResponseSchema = z.union([JSONRPCResultResponseSchema, JSONRPCErrorResponseSchema]);
  EmptyResultSchema = ResultSchema.strict();
  CancelledNotificationParamsSchema = NotificationsParamsSchema.extend({
    requestId: RequestIdSchema.optional(),
    reason: z.string().optional()
  });
  CancelledNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/cancelled"),
    params: CancelledNotificationParamsSchema
  });
  IconSchema = z.object({
    src: z.string(),
    mimeType: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    theme: z.enum(["light", "dark"]).optional()
  });
  IconsSchema = z.object({
    icons: z.array(IconSchema).optional()
  });
  BaseMetadataSchema = z.object({
    name: z.string(),
    title: z.string().optional()
  });
  ImplementationSchema = BaseMetadataSchema.extend({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    version: z.string(),
    websiteUrl: z.string().optional(),
    description: z.string().optional()
  });
  FormElicitationCapabilitySchema = z.intersection(z.object({
    applyDefaults: z.boolean().optional()
  }), z.record(z.string(), z.unknown()));
  ElicitationCapabilitySchema = z.preprocess((value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (Object.keys(value).length === 0) {
        return { form: {} };
      }
    }
    return value;
  }, z.intersection(z.object({
    form: FormElicitationCapabilitySchema.optional(),
    url: AssertObjectSchema.optional()
  }), z.record(z.string(), z.unknown()).optional()));
  ClientTasksCapabilitySchema = z.looseObject({
    list: AssertObjectSchema.optional(),
    cancel: AssertObjectSchema.optional(),
    requests: z.looseObject({
      sampling: z.looseObject({
        createMessage: AssertObjectSchema.optional()
      }).optional(),
      elicitation: z.looseObject({
        create: AssertObjectSchema.optional()
      }).optional()
    }).optional()
  });
  ServerTasksCapabilitySchema = z.looseObject({
    list: AssertObjectSchema.optional(),
    cancel: AssertObjectSchema.optional(),
    requests: z.looseObject({
      tools: z.looseObject({
        call: AssertObjectSchema.optional()
      }).optional()
    }).optional()
  });
  ClientCapabilitiesSchema = z.object({
    experimental: z.record(z.string(), AssertObjectSchema).optional(),
    sampling: z.object({
      context: AssertObjectSchema.optional(),
      tools: AssertObjectSchema.optional()
    }).optional(),
    elicitation: ElicitationCapabilitySchema.optional(),
    roots: z.object({
      listChanged: z.boolean().optional()
    }).optional(),
    tasks: ClientTasksCapabilitySchema.optional()
  });
  InitializeRequestParamsSchema = BaseRequestParamsSchema.extend({
    protocolVersion: z.string(),
    capabilities: ClientCapabilitiesSchema,
    clientInfo: ImplementationSchema
  });
  InitializeRequestSchema = RequestSchema.extend({
    method: z.literal("initialize"),
    params: InitializeRequestParamsSchema
  });
  ServerCapabilitiesSchema = z.object({
    experimental: z.record(z.string(), AssertObjectSchema).optional(),
    logging: AssertObjectSchema.optional(),
    completions: AssertObjectSchema.optional(),
    prompts: z.object({
      listChanged: z.boolean().optional()
    }).optional(),
    resources: z.object({
      subscribe: z.boolean().optional(),
      listChanged: z.boolean().optional()
    }).optional(),
    tools: z.object({
      listChanged: z.boolean().optional()
    }).optional(),
    tasks: ServerTasksCapabilitySchema.optional()
  });
  InitializeResultSchema = ResultSchema.extend({
    protocolVersion: z.string(),
    capabilities: ServerCapabilitiesSchema,
    serverInfo: ImplementationSchema,
    instructions: z.string().optional()
  });
  InitializedNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/initialized"),
    params: NotificationsParamsSchema.optional()
  });
  PingRequestSchema = RequestSchema.extend({
    method: z.literal("ping"),
    params: BaseRequestParamsSchema.optional()
  });
  ProgressSchema = z.object({
    progress: z.number(),
    total: z.optional(z.number()),
    message: z.optional(z.string())
  });
  ProgressNotificationParamsSchema = z.object({
    ...NotificationsParamsSchema.shape,
    ...ProgressSchema.shape,
    progressToken: ProgressTokenSchema
  });
  ProgressNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/progress"),
    params: ProgressNotificationParamsSchema
  });
  PaginatedRequestParamsSchema = BaseRequestParamsSchema.extend({
    cursor: CursorSchema.optional()
  });
  PaginatedRequestSchema = RequestSchema.extend({
    params: PaginatedRequestParamsSchema.optional()
  });
  PaginatedResultSchema = ResultSchema.extend({
    nextCursor: CursorSchema.optional()
  });
  TaskStatusSchema = z.enum(["working", "input_required", "completed", "failed", "cancelled"]);
  TaskSchema = z.object({
    taskId: z.string(),
    status: TaskStatusSchema,
    ttl: z.union([z.number(), z.null()]),
    createdAt: z.string(),
    lastUpdatedAt: z.string(),
    pollInterval: z.optional(z.number()),
    statusMessage: z.optional(z.string())
  });
  CreateTaskResultSchema = ResultSchema.extend({
    task: TaskSchema
  });
  TaskStatusNotificationParamsSchema = NotificationsParamsSchema.merge(TaskSchema);
  TaskStatusNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/tasks/status"),
    params: TaskStatusNotificationParamsSchema
  });
  GetTaskRequestSchema = RequestSchema.extend({
    method: z.literal("tasks/get"),
    params: BaseRequestParamsSchema.extend({
      taskId: z.string()
    })
  });
  GetTaskResultSchema = ResultSchema.merge(TaskSchema);
  GetTaskPayloadRequestSchema = RequestSchema.extend({
    method: z.literal("tasks/result"),
    params: BaseRequestParamsSchema.extend({
      taskId: z.string()
    })
  });
  GetTaskPayloadResultSchema = ResultSchema.loose();
  ListTasksRequestSchema = PaginatedRequestSchema.extend({
    method: z.literal("tasks/list")
  });
  ListTasksResultSchema = PaginatedResultSchema.extend({
    tasks: z.array(TaskSchema)
  });
  CancelTaskRequestSchema = RequestSchema.extend({
    method: z.literal("tasks/cancel"),
    params: BaseRequestParamsSchema.extend({
      taskId: z.string()
    })
  });
  CancelTaskResultSchema = ResultSchema.merge(TaskSchema);
  ResourceContentsSchema = z.object({
    uri: z.string(),
    mimeType: z.optional(z.string()),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  TextResourceContentsSchema = ResourceContentsSchema.extend({
    text: z.string()
  });
  Base64Schema = z.string().refine((val) => {
    try {
      atob(val);
      return true;
    } catch {
      return false;
    }
  }, { message: "Invalid Base64 string" });
  BlobResourceContentsSchema = ResourceContentsSchema.extend({
    blob: Base64Schema
  });
  RoleSchema = z.enum(["user", "assistant"]);
  AnnotationsSchema = z.object({
    audience: z.array(RoleSchema).optional(),
    priority: z.number().min(0).max(1).optional(),
    lastModified: z.iso.datetime({ offset: true }).optional()
  });
  ResourceSchema = z.object({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    uri: z.string(),
    description: z.optional(z.string()),
    mimeType: z.optional(z.string()),
    annotations: AnnotationsSchema.optional(),
    _meta: z.optional(z.looseObject({}))
  });
  ResourceTemplateSchema = z.object({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    uriTemplate: z.string(),
    description: z.optional(z.string()),
    mimeType: z.optional(z.string()),
    annotations: AnnotationsSchema.optional(),
    _meta: z.optional(z.looseObject({}))
  });
  ListResourcesRequestSchema = PaginatedRequestSchema.extend({
    method: z.literal("resources/list")
  });
  ListResourcesResultSchema = PaginatedResultSchema.extend({
    resources: z.array(ResourceSchema)
  });
  ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({
    method: z.literal("resources/templates/list")
  });
  ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({
    resourceTemplates: z.array(ResourceTemplateSchema)
  });
  ResourceRequestParamsSchema = BaseRequestParamsSchema.extend({
    uri: z.string()
  });
  ReadResourceRequestParamsSchema = ResourceRequestParamsSchema;
  ReadResourceRequestSchema = RequestSchema.extend({
    method: z.literal("resources/read"),
    params: ReadResourceRequestParamsSchema
  });
  ReadResourceResultSchema = ResultSchema.extend({
    contents: z.array(z.union([TextResourceContentsSchema, BlobResourceContentsSchema]))
  });
  ResourceListChangedNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/resources/list_changed"),
    params: NotificationsParamsSchema.optional()
  });
  SubscribeRequestParamsSchema = ResourceRequestParamsSchema;
  SubscribeRequestSchema = RequestSchema.extend({
    method: z.literal("resources/subscribe"),
    params: SubscribeRequestParamsSchema
  });
  UnsubscribeRequestParamsSchema = ResourceRequestParamsSchema;
  UnsubscribeRequestSchema = RequestSchema.extend({
    method: z.literal("resources/unsubscribe"),
    params: UnsubscribeRequestParamsSchema
  });
  ResourceUpdatedNotificationParamsSchema = NotificationsParamsSchema.extend({
    uri: z.string()
  });
  ResourceUpdatedNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/resources/updated"),
    params: ResourceUpdatedNotificationParamsSchema
  });
  PromptArgumentSchema = z.object({
    name: z.string(),
    description: z.optional(z.string()),
    required: z.optional(z.boolean())
  });
  PromptSchema = z.object({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    description: z.optional(z.string()),
    arguments: z.optional(z.array(PromptArgumentSchema)),
    _meta: z.optional(z.looseObject({}))
  });
  ListPromptsRequestSchema = PaginatedRequestSchema.extend({
    method: z.literal("prompts/list")
  });
  ListPromptsResultSchema = PaginatedResultSchema.extend({
    prompts: z.array(PromptSchema)
  });
  GetPromptRequestParamsSchema = BaseRequestParamsSchema.extend({
    name: z.string(),
    arguments: z.record(z.string(), z.string()).optional()
  });
  GetPromptRequestSchema = RequestSchema.extend({
    method: z.literal("prompts/get"),
    params: GetPromptRequestParamsSchema
  });
  TextContentSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
    annotations: AnnotationsSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  ImageContentSchema = z.object({
    type: z.literal("image"),
    data: Base64Schema,
    mimeType: z.string(),
    annotations: AnnotationsSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  AudioContentSchema = z.object({
    type: z.literal("audio"),
    data: Base64Schema,
    mimeType: z.string(),
    annotations: AnnotationsSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  ToolUseContentSchema = z.object({
    type: z.literal("tool_use"),
    name: z.string(),
    id: z.string(),
    input: z.record(z.string(), z.unknown()),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  EmbeddedResourceSchema = z.object({
    type: z.literal("resource"),
    resource: z.union([TextResourceContentsSchema, BlobResourceContentsSchema]),
    annotations: AnnotationsSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  ResourceLinkSchema = ResourceSchema.extend({
    type: z.literal("resource_link")
  });
  ContentBlockSchema = z.union([
    TextContentSchema,
    ImageContentSchema,
    AudioContentSchema,
    ResourceLinkSchema,
    EmbeddedResourceSchema
  ]);
  PromptMessageSchema = z.object({
    role: RoleSchema,
    content: ContentBlockSchema
  });
  GetPromptResultSchema = ResultSchema.extend({
    description: z.string().optional(),
    messages: z.array(PromptMessageSchema)
  });
  PromptListChangedNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/prompts/list_changed"),
    params: NotificationsParamsSchema.optional()
  });
  ToolAnnotationsSchema = z.object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional()
  });
  ToolExecutionSchema = z.object({
    taskSupport: z.enum(["required", "optional", "forbidden"]).optional()
  });
  ToolSchema = z.object({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    description: z.string().optional(),
    inputSchema: z.object({
      type: z.literal("object"),
      properties: z.record(z.string(), AssertObjectSchema).optional(),
      required: z.array(z.string()).optional()
    }).catchall(z.unknown()),
    outputSchema: z.object({
      type: z.literal("object"),
      properties: z.record(z.string(), AssertObjectSchema).optional(),
      required: z.array(z.string()).optional()
    }).catchall(z.unknown()).optional(),
    annotations: ToolAnnotationsSchema.optional(),
    execution: ToolExecutionSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  ListToolsRequestSchema = PaginatedRequestSchema.extend({
    method: z.literal("tools/list")
  });
  ListToolsResultSchema = PaginatedResultSchema.extend({
    tools: z.array(ToolSchema)
  });
  CallToolResultSchema = ResultSchema.extend({
    content: z.array(ContentBlockSchema).default([]),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    isError: z.boolean().optional()
  });
  CompatibilityCallToolResultSchema = CallToolResultSchema.or(ResultSchema.extend({
    toolResult: z.unknown()
  }));
  CallToolRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional()
  });
  CallToolRequestSchema = RequestSchema.extend({
    method: z.literal("tools/call"),
    params: CallToolRequestParamsSchema
  });
  ToolListChangedNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/tools/list_changed"),
    params: NotificationsParamsSchema.optional()
  });
  ListChangedOptionsBaseSchema = z.object({
    autoRefresh: z.boolean().default(true),
    debounceMs: z.number().int().nonnegative().default(300)
  });
  LoggingLevelSchema = z.enum(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]);
  SetLevelRequestParamsSchema = BaseRequestParamsSchema.extend({
    level: LoggingLevelSchema
  });
  SetLevelRequestSchema = RequestSchema.extend({
    method: z.literal("logging/setLevel"),
    params: SetLevelRequestParamsSchema
  });
  LoggingMessageNotificationParamsSchema = NotificationsParamsSchema.extend({
    level: LoggingLevelSchema,
    logger: z.string().optional(),
    data: z.unknown()
  });
  LoggingMessageNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/message"),
    params: LoggingMessageNotificationParamsSchema
  });
  ModelHintSchema = z.object({
    name: z.string().optional()
  });
  ModelPreferencesSchema = z.object({
    hints: z.array(ModelHintSchema).optional(),
    costPriority: z.number().min(0).max(1).optional(),
    speedPriority: z.number().min(0).max(1).optional(),
    intelligencePriority: z.number().min(0).max(1).optional()
  });
  ToolChoiceSchema = z.object({
    mode: z.enum(["auto", "required", "none"]).optional()
  });
  ToolResultContentSchema = z.object({
    type: z.literal("tool_result"),
    toolUseId: z.string().describe("The unique identifier for the corresponding tool call."),
    content: z.array(ContentBlockSchema).default([]),
    structuredContent: z.object({}).loose().optional(),
    isError: z.boolean().optional(),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  SamplingContentSchema = z.discriminatedUnion("type", [TextContentSchema, ImageContentSchema, AudioContentSchema]);
  SamplingMessageContentBlockSchema = z.discriminatedUnion("type", [
    TextContentSchema,
    ImageContentSchema,
    AudioContentSchema,
    ToolUseContentSchema,
    ToolResultContentSchema
  ]);
  SamplingMessageSchema = z.object({
    role: RoleSchema,
    content: z.union([SamplingMessageContentBlockSchema, z.array(SamplingMessageContentBlockSchema)]),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  CreateMessageRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
    messages: z.array(SamplingMessageSchema),
    modelPreferences: ModelPreferencesSchema.optional(),
    systemPrompt: z.string().optional(),
    includeContext: z.enum(["none", "thisServer", "allServers"]).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int(),
    stopSequences: z.array(z.string()).optional(),
    metadata: AssertObjectSchema.optional(),
    tools: z.array(ToolSchema).optional(),
    toolChoice: ToolChoiceSchema.optional()
  });
  CreateMessageRequestSchema = RequestSchema.extend({
    method: z.literal("sampling/createMessage"),
    params: CreateMessageRequestParamsSchema
  });
  CreateMessageResultSchema = ResultSchema.extend({
    model: z.string(),
    stopReason: z.optional(z.enum(["endTurn", "stopSequence", "maxTokens"]).or(z.string())),
    role: RoleSchema,
    content: SamplingContentSchema
  });
  CreateMessageResultWithToolsSchema = ResultSchema.extend({
    model: z.string(),
    stopReason: z.optional(z.enum(["endTurn", "stopSequence", "maxTokens", "toolUse"]).or(z.string())),
    role: RoleSchema,
    content: z.union([SamplingMessageContentBlockSchema, z.array(SamplingMessageContentBlockSchema)])
  });
  BooleanSchemaSchema = z.object({
    type: z.literal("boolean"),
    title: z.string().optional(),
    description: z.string().optional(),
    default: z.boolean().optional()
  });
  StringSchemaSchema = z.object({
    type: z.literal("string"),
    title: z.string().optional(),
    description: z.string().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    format: z.enum(["email", "uri", "date", "date-time"]).optional(),
    default: z.string().optional()
  });
  NumberSchemaSchema = z.object({
    type: z.enum(["number", "integer"]),
    title: z.string().optional(),
    description: z.string().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    default: z.number().optional()
  });
  UntitledSingleSelectEnumSchemaSchema = z.object({
    type: z.literal("string"),
    title: z.string().optional(),
    description: z.string().optional(),
    enum: z.array(z.string()),
    default: z.string().optional()
  });
  TitledSingleSelectEnumSchemaSchema = z.object({
    type: z.literal("string"),
    title: z.string().optional(),
    description: z.string().optional(),
    oneOf: z.array(z.object({
      const: z.string(),
      title: z.string()
    })),
    default: z.string().optional()
  });
  LegacyTitledEnumSchemaSchema = z.object({
    type: z.literal("string"),
    title: z.string().optional(),
    description: z.string().optional(),
    enum: z.array(z.string()),
    enumNames: z.array(z.string()).optional(),
    default: z.string().optional()
  });
  SingleSelectEnumSchemaSchema = z.union([UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema]);
  UntitledMultiSelectEnumSchemaSchema = z.object({
    type: z.literal("array"),
    title: z.string().optional(),
    description: z.string().optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    items: z.object({
      type: z.literal("string"),
      enum: z.array(z.string())
    }),
    default: z.array(z.string()).optional()
  });
  TitledMultiSelectEnumSchemaSchema = z.object({
    type: z.literal("array"),
    title: z.string().optional(),
    description: z.string().optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    items: z.object({
      anyOf: z.array(z.object({
        const: z.string(),
        title: z.string()
      }))
    }),
    default: z.array(z.string()).optional()
  });
  MultiSelectEnumSchemaSchema = z.union([UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema]);
  EnumSchemaSchema = z.union([LegacyTitledEnumSchemaSchema, SingleSelectEnumSchemaSchema, MultiSelectEnumSchemaSchema]);
  PrimitiveSchemaDefinitionSchema = z.union([EnumSchemaSchema, BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema]);
  ElicitRequestFormParamsSchema = TaskAugmentedRequestParamsSchema.extend({
    mode: z.literal("form").optional(),
    message: z.string(),
    requestedSchema: z.object({
      type: z.literal("object"),
      properties: z.record(z.string(), PrimitiveSchemaDefinitionSchema),
      required: z.array(z.string()).optional()
    })
  });
  ElicitRequestURLParamsSchema = TaskAugmentedRequestParamsSchema.extend({
    mode: z.literal("url"),
    message: z.string(),
    elicitationId: z.string(),
    url: z.string().url()
  });
  ElicitRequestParamsSchema = z.union([ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema]);
  ElicitRequestSchema = RequestSchema.extend({
    method: z.literal("elicitation/create"),
    params: ElicitRequestParamsSchema
  });
  ElicitationCompleteNotificationParamsSchema = NotificationsParamsSchema.extend({
    elicitationId: z.string()
  });
  ElicitationCompleteNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/elicitation/complete"),
    params: ElicitationCompleteNotificationParamsSchema
  });
  ElicitResultSchema = ResultSchema.extend({
    action: z.enum(["accept", "decline", "cancel"]),
    content: z.preprocess((val) => val === null ? undefined : val, z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional())
  });
  ResourceTemplateReferenceSchema = z.object({
    type: z.literal("ref/resource"),
    uri: z.string()
  });
  PromptReferenceSchema = z.object({
    type: z.literal("ref/prompt"),
    name: z.string()
  });
  CompleteRequestParamsSchema = BaseRequestParamsSchema.extend({
    ref: z.union([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
    argument: z.object({
      name: z.string(),
      value: z.string()
    }),
    context: z.object({
      arguments: z.record(z.string(), z.string()).optional()
    }).optional()
  });
  CompleteRequestSchema = RequestSchema.extend({
    method: z.literal("completion/complete"),
    params: CompleteRequestParamsSchema
  });
  CompleteResultSchema = ResultSchema.extend({
    completion: z.looseObject({
      values: z.array(z.string()).max(100),
      total: z.optional(z.number().int()),
      hasMore: z.optional(z.boolean())
    })
  });
  RootSchema = z.object({
    uri: z.string().startsWith("file://"),
    name: z.string().optional(),
    _meta: z.record(z.string(), z.unknown()).optional()
  });
  ListRootsRequestSchema = RequestSchema.extend({
    method: z.literal("roots/list"),
    params: BaseRequestParamsSchema.optional()
  });
  ListRootsResultSchema = ResultSchema.extend({
    roots: z.array(RootSchema)
  });
  RootsListChangedNotificationSchema = NotificationSchema.extend({
    method: z.literal("notifications/roots/list_changed"),
    params: NotificationsParamsSchema.optional()
  });
  ClientRequestSchema = z.union([
    PingRequestSchema,
    InitializeRequestSchema,
    CompleteRequestSchema,
    SetLevelRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ReadResourceRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
    CallToolRequestSchema,
    ListToolsRequestSchema,
    GetTaskRequestSchema,
    GetTaskPayloadRequestSchema,
    ListTasksRequestSchema,
    CancelTaskRequestSchema
  ]);
  ClientNotificationSchema = z.union([
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    InitializedNotificationSchema,
    RootsListChangedNotificationSchema,
    TaskStatusNotificationSchema
  ]);
  ClientResultSchema = z.union([
    EmptyResultSchema,
    CreateMessageResultSchema,
    CreateMessageResultWithToolsSchema,
    ElicitResultSchema,
    ListRootsResultSchema,
    GetTaskResultSchema,
    ListTasksResultSchema,
    CreateTaskResultSchema
  ]);
  ServerRequestSchema = z.union([
    PingRequestSchema,
    CreateMessageRequestSchema,
    ElicitRequestSchema,
    ListRootsRequestSchema,
    GetTaskRequestSchema,
    GetTaskPayloadRequestSchema,
    ListTasksRequestSchema,
    CancelTaskRequestSchema
  ]);
  ServerNotificationSchema = z.union([
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    LoggingMessageNotificationSchema,
    ResourceUpdatedNotificationSchema,
    ResourceListChangedNotificationSchema,
    ToolListChangedNotificationSchema,
    PromptListChangedNotificationSchema,
    TaskStatusNotificationSchema,
    ElicitationCompleteNotificationSchema
  ]);
  ServerResultSchema = z.union([
    EmptyResultSchema,
    InitializeResultSchema,
    CompleteResultSchema,
    GetPromptResultSchema,
    ListPromptsResultSchema,
    ListResourcesResultSchema,
    ListResourceTemplatesResultSchema,
    ReadResourceResultSchema,
    CallToolResultSchema,
    ListToolsResultSchema,
    GetTaskResultSchema,
    ListTasksResultSchema,
    CreateTaskResultSchema
  ]);
  McpError = class McpError extends Error {
    constructor(code, message, data) {
      super(`MCP error ${code}: ${message}`);
      this.code = code;
      this.data = data;
      this.name = "McpError";
    }
    static fromError(code, message, data) {
      if (code === ErrorCode.UrlElicitationRequired && data) {
        const errorData = data;
        if (errorData.elicitations) {
          return new UrlElicitationRequiredError(errorData.elicitations, message);
        }
      }
      return new McpError(code, message, data);
    }
  };
  UrlElicitationRequiredError = class UrlElicitationRequiredError extends McpError {
    constructor(elicitations, message = `URL elicitation${elicitations.length > 1 ? "s" : ""} required`) {
      super(ErrorCode.UrlElicitationRequired, message, {
        elicitations
      });
    }
    get elicitations() {
      return this.data?.elicitations ?? [];
    }
  };
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/interfaces.js
function isTerminal(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// node_modules/zod-to-json-schema/dist/esm/Options.js
var ignoreOverride;
var init_Options = __esm(() => {
  ignoreOverride = Symbol("Let zodToJsonSchema decide on which parser to use");
});

// node_modules/zod-to-json-schema/dist/esm/Refs.js
var init_Refs = __esm(() => {
  init_Options();
});
// node_modules/zod-to-json-schema/dist/esm/parsers/any.js
var init_any = () => {};

// node_modules/zod-to-json-schema/dist/esm/parsers/array.js
import { ZodFirstPartyTypeKind } from "zod/v3";
var init_array = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js
var init_bigint = () => {};
// node_modules/zod-to-json-schema/dist/esm/parsers/branded.js
var init_branded = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/catch.js
var init_catch = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/date.js
var init_date = () => {};

// node_modules/zod-to-json-schema/dist/esm/parsers/default.js
var init_default = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/effects.js
var init_effects = __esm(() => {
  init_parseDef();
  init_any();
});
// node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js
var init_intersection = __esm(() => {
  init_parseDef();
});
// node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var ALPHA_NUMERIC;
var init_string = __esm(() => {
  ALPHA_NUMERIC = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
});

// node_modules/zod-to-json-schema/dist/esm/parsers/record.js
import { ZodFirstPartyTypeKind as ZodFirstPartyTypeKind2 } from "zod/v3";
var init_record = __esm(() => {
  init_parseDef();
  init_string();
  init_branded();
  init_any();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/map.js
var init_map = __esm(() => {
  init_parseDef();
  init_record();
  init_any();
});
// node_modules/zod-to-json-schema/dist/esm/parsers/never.js
var init_never = __esm(() => {
  init_any();
});
// node_modules/zod-to-json-schema/dist/esm/parsers/union.js
var init_union = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js
var init_nullable = __esm(() => {
  init_parseDef();
  init_union();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/number.js
var init_number = () => {};

// node_modules/zod-to-json-schema/dist/esm/parsers/object.js
var init_object = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/optional.js
var init_optional = __esm(() => {
  init_parseDef();
  init_any();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/pipeline.js
var init_pipeline = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/promise.js
var init_promise = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/set.js
var init_set = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js
var init_tuple = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js
var init_undefined = __esm(() => {
  init_any();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js
var init_unknown = __esm(() => {
  init_any();
});

// node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js
var init_readonly = __esm(() => {
  init_parseDef();
});

// node_modules/zod-to-json-schema/dist/esm/selectParser.js
import { ZodFirstPartyTypeKind as ZodFirstPartyTypeKind3 } from "zod/v3";
var init_selectParser = __esm(() => {
  init_any();
  init_array();
  init_bigint();
  init_branded();
  init_catch();
  init_date();
  init_default();
  init_effects();
  init_intersection();
  init_map();
  init_never();
  init_nullable();
  init_number();
  init_object();
  init_optional();
  init_pipeline();
  init_promise();
  init_record();
  init_set();
  init_string();
  init_tuple();
  init_undefined();
  init_union();
  init_unknown();
  init_readonly();
});

// node_modules/zod-to-json-schema/dist/esm/parseDef.js
var init_parseDef = __esm(() => {
  init_Options();
  init_selectParser();
  init_any();
});

// node_modules/zod-to-json-schema/dist/esm/parseTypes.js
var init_parseTypes = () => {};

// node_modules/zod-to-json-schema/dist/esm/zodToJsonSchema.js
var init_zodToJsonSchema = __esm(() => {
  init_parseDef();
  init_Refs();
  init_any();
});

// node_modules/zod-to-json-schema/dist/esm/index.js
var init_esm = __esm(() => {
  init_zodToJsonSchema();
  init_Options();
  init_Refs();
  init_parseDef();
  init_parseTypes();
  init_any();
  init_array();
  init_bigint();
  init_branded();
  init_catch();
  init_date();
  init_default();
  init_effects();
  init_intersection();
  init_map();
  init_never();
  init_nullable();
  init_number();
  init_object();
  init_optional();
  init_pipeline();
  init_promise();
  init_readonly();
  init_record();
  init_set();
  init_string();
  init_tuple();
  init_undefined();
  init_union();
  init_unknown();
  init_selectParser();
  init_zodToJsonSchema();
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js
import * as z4mini2 from "zod/v4-mini";
function getMethodLiteral(schema) {
  const shape = getObjectShape(schema);
  const methodSchema = shape?.method;
  if (!methodSchema) {
    throw new Error("Schema is missing a method literal");
  }
  const value = getLiteralValue(methodSchema);
  if (typeof value !== "string") {
    throw new Error("Schema method literal must be a string");
  }
  return value;
}
function parseWithCompat(schema, data) {
  const result = safeParse2(schema, data);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}
var init_zod_json_schema_compat = __esm(() => {
  init_zod_compat();
  init_esm();
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js
class Protocol {
  constructor(_options) {
    this._options = _options;
    this._requestMessageId = 0;
    this._requestHandlers = new Map;
    this._requestHandlerAbortControllers = new Map;
    this._notificationHandlers = new Map;
    this._responseHandlers = new Map;
    this._progressHandlers = new Map;
    this._timeoutInfo = new Map;
    this._pendingDebouncedNotifications = new Set;
    this._taskProgressTokens = new Map;
    this._requestResolvers = new Map;
    this.setNotificationHandler(CancelledNotificationSchema, (notification) => {
      this._oncancel(notification);
    });
    this.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      this._onprogress(notification);
    });
    this.setRequestHandler(PingRequestSchema, (_request) => ({}));
    this._taskStore = _options?.taskStore;
    this._taskMessageQueue = _options?.taskMessageQueue;
    if (this._taskStore) {
      this.setRequestHandler(GetTaskRequestSchema, async (request, extra) => {
        const task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
        }
        return {
          ...task
        };
      });
      this.setRequestHandler(GetTaskPayloadRequestSchema, async (request, extra) => {
        const handleTaskResult = async () => {
          const taskId = request.params.taskId;
          if (this._taskMessageQueue) {
            let queuedMessage;
            while (queuedMessage = await this._taskMessageQueue.dequeue(taskId, extra.sessionId)) {
              if (queuedMessage.type === "response" || queuedMessage.type === "error") {
                const message = queuedMessage.message;
                const requestId = message.id;
                const resolver = this._requestResolvers.get(requestId);
                if (resolver) {
                  this._requestResolvers.delete(requestId);
                  if (queuedMessage.type === "response") {
                    resolver(message);
                  } else {
                    const errorMessage = message;
                    const error = new McpError(errorMessage.error.code, errorMessage.error.message, errorMessage.error.data);
                    resolver(error);
                  }
                } else {
                  const messageType = queuedMessage.type === "response" ? "Response" : "Error";
                  this._onerror(new Error(`${messageType} handler missing for request ${requestId}`));
                }
                continue;
              }
              await this._transport?.send(queuedMessage.message, { relatedRequestId: extra.requestId });
            }
          }
          const task = await this._taskStore.getTask(taskId, extra.sessionId);
          if (!task) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
          }
          if (!isTerminal(task.status)) {
            await this._waitForTaskUpdate(taskId, extra.signal);
            return await handleTaskResult();
          }
          if (isTerminal(task.status)) {
            const result = await this._taskStore.getTaskResult(taskId, extra.sessionId);
            this._clearTaskQueue(taskId);
            return {
              ...result,
              _meta: {
                ...result._meta,
                [RELATED_TASK_META_KEY]: {
                  taskId
                }
              }
            };
          }
          return await handleTaskResult();
        };
        return await handleTaskResult();
      });
      this.setRequestHandler(ListTasksRequestSchema, async (request, extra) => {
        try {
          const { tasks, nextCursor } = await this._taskStore.listTasks(request.params?.cursor, extra.sessionId);
          return {
            tasks,
            nextCursor,
            _meta: {}
          };
        } catch (error) {
          throw new McpError(ErrorCode.InvalidParams, `Failed to list tasks: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      this.setRequestHandler(CancelTaskRequestSchema, async (request, extra) => {
        try {
          const task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
          if (!task) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${request.params.taskId}`);
          }
          if (isTerminal(task.status)) {
            throw new McpError(ErrorCode.InvalidParams, `Cannot cancel task in terminal status: ${task.status}`);
          }
          await this._taskStore.updateTaskStatus(request.params.taskId, "cancelled", "Client cancelled task execution.", extra.sessionId);
          this._clearTaskQueue(request.params.taskId);
          const cancelledTask = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
          if (!cancelledTask) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found after cancellation: ${request.params.taskId}`);
          }
          return {
            _meta: {},
            ...cancelledTask
          };
        } catch (error) {
          if (error instanceof McpError) {
            throw error;
          }
          throw new McpError(ErrorCode.InvalidRequest, `Failed to cancel task: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }
  }
  async _oncancel(notification) {
    if (!notification.params.requestId) {
      return;
    }
    const controller = this._requestHandlerAbortControllers.get(notification.params.requestId);
    controller?.abort(notification.params.reason);
  }
  _setupTimeout(messageId, timeout, maxTotalTimeout, onTimeout, resetTimeoutOnProgress = false) {
    this._timeoutInfo.set(messageId, {
      timeoutId: setTimeout(onTimeout, timeout),
      startTime: Date.now(),
      timeout,
      maxTotalTimeout,
      resetTimeoutOnProgress,
      onTimeout
    });
  }
  _resetTimeout(messageId) {
    const info = this._timeoutInfo.get(messageId);
    if (!info)
      return false;
    const totalElapsed = Date.now() - info.startTime;
    if (info.maxTotalTimeout && totalElapsed >= info.maxTotalTimeout) {
      this._timeoutInfo.delete(messageId);
      throw McpError.fromError(ErrorCode.RequestTimeout, "Maximum total timeout exceeded", {
        maxTotalTimeout: info.maxTotalTimeout,
        totalElapsed
      });
    }
    clearTimeout(info.timeoutId);
    info.timeoutId = setTimeout(info.onTimeout, info.timeout);
    return true;
  }
  _cleanupTimeout(messageId) {
    const info = this._timeoutInfo.get(messageId);
    if (info) {
      clearTimeout(info.timeoutId);
      this._timeoutInfo.delete(messageId);
    }
  }
  async connect(transport) {
    if (this._transport) {
      throw new Error("Already connected to a transport. Call close() before connecting to a new transport, or use a separate Protocol instance per connection.");
    }
    this._transport = transport;
    const _onclose = this.transport?.onclose;
    this._transport.onclose = () => {
      _onclose?.();
      this._onclose();
    };
    const _onerror = this.transport?.onerror;
    this._transport.onerror = (error) => {
      _onerror?.(error);
      this._onerror(error);
    };
    const _onmessage = this._transport?.onmessage;
    this._transport.onmessage = (message, extra) => {
      _onmessage?.(message, extra);
      if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
        this._onresponse(message);
      } else if (isJSONRPCRequest(message)) {
        this._onrequest(message, extra);
      } else if (isJSONRPCNotification(message)) {
        this._onnotification(message);
      } else {
        this._onerror(new Error(`Unknown message type: ${JSON.stringify(message)}`));
      }
    };
    await this._transport.start();
  }
  _onclose() {
    const responseHandlers = this._responseHandlers;
    this._responseHandlers = new Map;
    this._progressHandlers.clear();
    this._taskProgressTokens.clear();
    this._pendingDebouncedNotifications.clear();
    for (const controller of this._requestHandlerAbortControllers.values()) {
      controller.abort();
    }
    this._requestHandlerAbortControllers.clear();
    const error = McpError.fromError(ErrorCode.ConnectionClosed, "Connection closed");
    this._transport = undefined;
    this.onclose?.();
    for (const handler of responseHandlers.values()) {
      handler(error);
    }
  }
  _onerror(error) {
    this.onerror?.(error);
  }
  _onnotification(notification) {
    const handler = this._notificationHandlers.get(notification.method) ?? this.fallbackNotificationHandler;
    if (handler === undefined) {
      return;
    }
    Promise.resolve().then(() => handler(notification)).catch((error) => this._onerror(new Error(`Uncaught error in notification handler: ${error}`)));
  }
  _onrequest(request, extra) {
    const handler = this._requestHandlers.get(request.method) ?? this.fallbackRequestHandler;
    const capturedTransport = this._transport;
    const relatedTaskId = request.params?._meta?.[RELATED_TASK_META_KEY]?.taskId;
    if (handler === undefined) {
      const errorResponse = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: ErrorCode.MethodNotFound,
          message: "Method not found"
        }
      };
      if (relatedTaskId && this._taskMessageQueue) {
        this._enqueueTaskMessage(relatedTaskId, {
          type: "error",
          message: errorResponse,
          timestamp: Date.now()
        }, capturedTransport?.sessionId).catch((error) => this._onerror(new Error(`Failed to enqueue error response: ${error}`)));
      } else {
        capturedTransport?.send(errorResponse).catch((error) => this._onerror(new Error(`Failed to send an error response: ${error}`)));
      }
      return;
    }
    const abortController = new AbortController;
    this._requestHandlerAbortControllers.set(request.id, abortController);
    const taskCreationParams = isTaskAugmentedRequestParams(request.params) ? request.params.task : undefined;
    const taskStore = this._taskStore ? this.requestTaskStore(request, capturedTransport?.sessionId) : undefined;
    const fullExtra = {
      signal: abortController.signal,
      sessionId: capturedTransport?.sessionId,
      _meta: request.params?._meta,
      sendNotification: async (notification) => {
        if (abortController.signal.aborted)
          return;
        const notificationOptions = { relatedRequestId: request.id };
        if (relatedTaskId) {
          notificationOptions.relatedTask = { taskId: relatedTaskId };
        }
        await this.notification(notification, notificationOptions);
      },
      sendRequest: async (r, resultSchema, options) => {
        if (abortController.signal.aborted) {
          throw new McpError(ErrorCode.ConnectionClosed, "Request was cancelled");
        }
        const requestOptions = { ...options, relatedRequestId: request.id };
        if (relatedTaskId && !requestOptions.relatedTask) {
          requestOptions.relatedTask = { taskId: relatedTaskId };
        }
        const effectiveTaskId = requestOptions.relatedTask?.taskId ?? relatedTaskId;
        if (effectiveTaskId && taskStore) {
          await taskStore.updateTaskStatus(effectiveTaskId, "input_required");
        }
        return await this.request(r, resultSchema, requestOptions);
      },
      authInfo: extra?.authInfo,
      requestId: request.id,
      requestInfo: extra?.requestInfo,
      taskId: relatedTaskId,
      taskStore,
      taskRequestedTtl: taskCreationParams?.ttl,
      closeSSEStream: extra?.closeSSEStream,
      closeStandaloneSSEStream: extra?.closeStandaloneSSEStream
    };
    Promise.resolve().then(() => {
      if (taskCreationParams) {
        this.assertTaskHandlerCapability(request.method);
      }
    }).then(() => handler(request, fullExtra)).then(async (result) => {
      if (abortController.signal.aborted) {
        return;
      }
      const response = {
        result,
        jsonrpc: "2.0",
        id: request.id
      };
      if (relatedTaskId && this._taskMessageQueue) {
        await this._enqueueTaskMessage(relatedTaskId, {
          type: "response",
          message: response,
          timestamp: Date.now()
        }, capturedTransport?.sessionId);
      } else {
        await capturedTransport?.send(response);
      }
    }, async (error) => {
      if (abortController.signal.aborted) {
        return;
      }
      const errorResponse = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: Number.isSafeInteger(error["code"]) ? error["code"] : ErrorCode.InternalError,
          message: error.message ?? "Internal error",
          ...error["data"] !== undefined && { data: error["data"] }
        }
      };
      if (relatedTaskId && this._taskMessageQueue) {
        await this._enqueueTaskMessage(relatedTaskId, {
          type: "error",
          message: errorResponse,
          timestamp: Date.now()
        }, capturedTransport?.sessionId);
      } else {
        await capturedTransport?.send(errorResponse);
      }
    }).catch((error) => this._onerror(new Error(`Failed to send response: ${error}`))).finally(() => {
      this._requestHandlerAbortControllers.delete(request.id);
    });
  }
  _onprogress(notification) {
    const { progressToken, ...params } = notification.params;
    const messageId = Number(progressToken);
    const handler = this._progressHandlers.get(messageId);
    if (!handler) {
      this._onerror(new Error(`Received a progress notification for an unknown token: ${JSON.stringify(notification)}`));
      return;
    }
    const responseHandler = this._responseHandlers.get(messageId);
    const timeoutInfo = this._timeoutInfo.get(messageId);
    if (timeoutInfo && responseHandler && timeoutInfo.resetTimeoutOnProgress) {
      try {
        this._resetTimeout(messageId);
      } catch (error) {
        this._responseHandlers.delete(messageId);
        this._progressHandlers.delete(messageId);
        this._cleanupTimeout(messageId);
        responseHandler(error);
        return;
      }
    }
    handler(params);
  }
  _onresponse(response) {
    const messageId = Number(response.id);
    const resolver = this._requestResolvers.get(messageId);
    if (resolver) {
      this._requestResolvers.delete(messageId);
      if (isJSONRPCResultResponse(response)) {
        resolver(response);
      } else {
        const error = new McpError(response.error.code, response.error.message, response.error.data);
        resolver(error);
      }
      return;
    }
    const handler = this._responseHandlers.get(messageId);
    if (handler === undefined) {
      this._onerror(new Error(`Received a response for an unknown message ID: ${JSON.stringify(response)}`));
      return;
    }
    this._responseHandlers.delete(messageId);
    this._cleanupTimeout(messageId);
    let isTaskResponse = false;
    if (isJSONRPCResultResponse(response) && response.result && typeof response.result === "object") {
      const result = response.result;
      if (result.task && typeof result.task === "object") {
        const task = result.task;
        if (typeof task.taskId === "string") {
          isTaskResponse = true;
          this._taskProgressTokens.set(task.taskId, messageId);
        }
      }
    }
    if (!isTaskResponse) {
      this._progressHandlers.delete(messageId);
    }
    if (isJSONRPCResultResponse(response)) {
      handler(response);
    } else {
      const error = McpError.fromError(response.error.code, response.error.message, response.error.data);
      handler(error);
    }
  }
  get transport() {
    return this._transport;
  }
  async close() {
    await this._transport?.close();
  }
  async* requestStream(request, resultSchema, options) {
    const { task } = options ?? {};
    if (!task) {
      try {
        const result = await this.request(request, resultSchema, options);
        yield { type: "result", result };
      } catch (error) {
        yield {
          type: "error",
          error: error instanceof McpError ? error : new McpError(ErrorCode.InternalError, String(error))
        };
      }
      return;
    }
    let taskId;
    try {
      const createResult = await this.request(request, CreateTaskResultSchema, options);
      if (createResult.task) {
        taskId = createResult.task.taskId;
        yield { type: "taskCreated", task: createResult.task };
      } else {
        throw new McpError(ErrorCode.InternalError, "Task creation did not return a task");
      }
      while (true) {
        const task2 = await this.getTask({ taskId }, options);
        yield { type: "taskStatus", task: task2 };
        if (isTerminal(task2.status)) {
          if (task2.status === "completed") {
            const result = await this.getTaskResult({ taskId }, resultSchema, options);
            yield { type: "result", result };
          } else if (task2.status === "failed") {
            yield {
              type: "error",
              error: new McpError(ErrorCode.InternalError, `Task ${taskId} failed`)
            };
          } else if (task2.status === "cancelled") {
            yield {
              type: "error",
              error: new McpError(ErrorCode.InternalError, `Task ${taskId} was cancelled`)
            };
          }
          return;
        }
        if (task2.status === "input_required") {
          const result = await this.getTaskResult({ taskId }, resultSchema, options);
          yield { type: "result", result };
          return;
        }
        const pollInterval = task2.pollInterval ?? this._options?.defaultTaskPollInterval ?? 1000;
        await new Promise((resolve3) => setTimeout(resolve3, pollInterval));
        options?.signal?.throwIfAborted();
      }
    } catch (error) {
      yield {
        type: "error",
        error: error instanceof McpError ? error : new McpError(ErrorCode.InternalError, String(error))
      };
    }
  }
  request(request, resultSchema, options) {
    const { relatedRequestId, resumptionToken, onresumptiontoken, task, relatedTask } = options ?? {};
    return new Promise((resolve3, reject) => {
      const earlyReject = (error) => {
        reject(error);
      };
      if (!this._transport) {
        earlyReject(new Error("Not connected"));
        return;
      }
      if (this._options?.enforceStrictCapabilities === true) {
        try {
          this.assertCapabilityForMethod(request.method);
          if (task) {
            this.assertTaskCapability(request.method);
          }
        } catch (e) {
          earlyReject(e);
          return;
        }
      }
      options?.signal?.throwIfAborted();
      const messageId = this._requestMessageId++;
      const jsonrpcRequest = {
        ...request,
        jsonrpc: "2.0",
        id: messageId
      };
      if (options?.onprogress) {
        this._progressHandlers.set(messageId, options.onprogress);
        jsonrpcRequest.params = {
          ...request.params,
          _meta: {
            ...request.params?._meta || {},
            progressToken: messageId
          }
        };
      }
      if (task) {
        jsonrpcRequest.params = {
          ...jsonrpcRequest.params,
          task
        };
      }
      if (relatedTask) {
        jsonrpcRequest.params = {
          ...jsonrpcRequest.params,
          _meta: {
            ...jsonrpcRequest.params?._meta || {},
            [RELATED_TASK_META_KEY]: relatedTask
          }
        };
      }
      const cancel = (reason) => {
        this._responseHandlers.delete(messageId);
        this._progressHandlers.delete(messageId);
        this._cleanupTimeout(messageId);
        this._transport?.send({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: {
            requestId: messageId,
            reason: String(reason)
          }
        }, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error2) => this._onerror(new Error(`Failed to send cancellation: ${error2}`)));
        const error = reason instanceof McpError ? reason : new McpError(ErrorCode.RequestTimeout, String(reason));
        reject(error);
      };
      this._responseHandlers.set(messageId, (response) => {
        if (options?.signal?.aborted) {
          return;
        }
        if (response instanceof Error) {
          return reject(response);
        }
        try {
          const parseResult = safeParse2(resultSchema, response.result);
          if (!parseResult.success) {
            reject(parseResult.error);
          } else {
            resolve3(parseResult.data);
          }
        } catch (error) {
          reject(error);
        }
      });
      options?.signal?.addEventListener("abort", () => {
        cancel(options?.signal?.reason);
      });
      const timeout = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
      const timeoutHandler = () => cancel(McpError.fromError(ErrorCode.RequestTimeout, "Request timed out", { timeout }));
      this._setupTimeout(messageId, timeout, options?.maxTotalTimeout, timeoutHandler, options?.resetTimeoutOnProgress ?? false);
      const relatedTaskId = relatedTask?.taskId;
      if (relatedTaskId) {
        const responseResolver = (response) => {
          const handler = this._responseHandlers.get(messageId);
          if (handler) {
            handler(response);
          } else {
            this._onerror(new Error(`Response handler missing for side-channeled request ${messageId}`));
          }
        };
        this._requestResolvers.set(messageId, responseResolver);
        this._enqueueTaskMessage(relatedTaskId, {
          type: "request",
          message: jsonrpcRequest,
          timestamp: Date.now()
        }).catch((error) => {
          this._cleanupTimeout(messageId);
          reject(error);
        });
      } else {
        this._transport.send(jsonrpcRequest, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error) => {
          this._cleanupTimeout(messageId);
          reject(error);
        });
      }
    });
  }
  async getTask(params, options) {
    return this.request({ method: "tasks/get", params }, GetTaskResultSchema, options);
  }
  async getTaskResult(params, resultSchema, options) {
    return this.request({ method: "tasks/result", params }, resultSchema, options);
  }
  async listTasks(params, options) {
    return this.request({ method: "tasks/list", params }, ListTasksResultSchema, options);
  }
  async cancelTask(params, options) {
    return this.request({ method: "tasks/cancel", params }, CancelTaskResultSchema, options);
  }
  async notification(notification, options) {
    if (!this._transport) {
      throw new Error("Not connected");
    }
    this.assertNotificationCapability(notification.method);
    const relatedTaskId = options?.relatedTask?.taskId;
    if (relatedTaskId) {
      const jsonrpcNotification2 = {
        ...notification,
        jsonrpc: "2.0",
        params: {
          ...notification.params,
          _meta: {
            ...notification.params?._meta || {},
            [RELATED_TASK_META_KEY]: options.relatedTask
          }
        }
      };
      await this._enqueueTaskMessage(relatedTaskId, {
        type: "notification",
        message: jsonrpcNotification2,
        timestamp: Date.now()
      });
      return;
    }
    const debouncedMethods = this._options?.debouncedNotificationMethods ?? [];
    const canDebounce = debouncedMethods.includes(notification.method) && !notification.params && !options?.relatedRequestId && !options?.relatedTask;
    if (canDebounce) {
      if (this._pendingDebouncedNotifications.has(notification.method)) {
        return;
      }
      this._pendingDebouncedNotifications.add(notification.method);
      Promise.resolve().then(() => {
        this._pendingDebouncedNotifications.delete(notification.method);
        if (!this._transport) {
          return;
        }
        let jsonrpcNotification2 = {
          ...notification,
          jsonrpc: "2.0"
        };
        if (options?.relatedTask) {
          jsonrpcNotification2 = {
            ...jsonrpcNotification2,
            params: {
              ...jsonrpcNotification2.params,
              _meta: {
                ...jsonrpcNotification2.params?._meta || {},
                [RELATED_TASK_META_KEY]: options.relatedTask
              }
            }
          };
        }
        this._transport?.send(jsonrpcNotification2, options).catch((error) => this._onerror(error));
      });
      return;
    }
    let jsonrpcNotification = {
      ...notification,
      jsonrpc: "2.0"
    };
    if (options?.relatedTask) {
      jsonrpcNotification = {
        ...jsonrpcNotification,
        params: {
          ...jsonrpcNotification.params,
          _meta: {
            ...jsonrpcNotification.params?._meta || {},
            [RELATED_TASK_META_KEY]: options.relatedTask
          }
        }
      };
    }
    await this._transport.send(jsonrpcNotification, options);
  }
  setRequestHandler(requestSchema, handler) {
    const method = getMethodLiteral(requestSchema);
    this.assertRequestHandlerCapability(method);
    this._requestHandlers.set(method, (request, extra) => {
      const parsed = parseWithCompat(requestSchema, request);
      return Promise.resolve(handler(parsed, extra));
    });
  }
  removeRequestHandler(method) {
    this._requestHandlers.delete(method);
  }
  assertCanSetRequestHandler(method) {
    if (this._requestHandlers.has(method)) {
      throw new Error(`A request handler for ${method} already exists, which would be overridden`);
    }
  }
  setNotificationHandler(notificationSchema, handler) {
    const method = getMethodLiteral(notificationSchema);
    this._notificationHandlers.set(method, (notification) => {
      const parsed = parseWithCompat(notificationSchema, notification);
      return Promise.resolve(handler(parsed));
    });
  }
  removeNotificationHandler(method) {
    this._notificationHandlers.delete(method);
  }
  _cleanupTaskProgressHandler(taskId) {
    const progressToken = this._taskProgressTokens.get(taskId);
    if (progressToken !== undefined) {
      this._progressHandlers.delete(progressToken);
      this._taskProgressTokens.delete(taskId);
    }
  }
  async _enqueueTaskMessage(taskId, message, sessionId) {
    if (!this._taskStore || !this._taskMessageQueue) {
      throw new Error("Cannot enqueue task message: taskStore and taskMessageQueue are not configured");
    }
    const maxQueueSize = this._options?.maxTaskQueueSize;
    await this._taskMessageQueue.enqueue(taskId, message, sessionId, maxQueueSize);
  }
  async _clearTaskQueue(taskId, sessionId) {
    if (this._taskMessageQueue) {
      const messages = await this._taskMessageQueue.dequeueAll(taskId, sessionId);
      for (const message of messages) {
        if (message.type === "request" && isJSONRPCRequest(message.message)) {
          const requestId = message.message.id;
          const resolver = this._requestResolvers.get(requestId);
          if (resolver) {
            resolver(new McpError(ErrorCode.InternalError, "Task cancelled or completed"));
            this._requestResolvers.delete(requestId);
          } else {
            this._onerror(new Error(`Resolver missing for request ${requestId} during task ${taskId} cleanup`));
          }
        }
      }
    }
  }
  async _waitForTaskUpdate(taskId, signal) {
    let interval = this._options?.defaultTaskPollInterval ?? 1000;
    try {
      const task = await this._taskStore?.getTask(taskId);
      if (task?.pollInterval) {
        interval = task.pollInterval;
      }
    } catch {}
    return new Promise((resolve3, reject) => {
      if (signal.aborted) {
        reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
        return;
      }
      const timeoutId = setTimeout(resolve3, interval);
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
      }, { once: true });
    });
  }
  requestTaskStore(request, sessionId) {
    const taskStore = this._taskStore;
    if (!taskStore) {
      throw new Error("No task store configured");
    }
    return {
      createTask: async (taskParams) => {
        if (!request) {
          throw new Error("No request provided");
        }
        return await taskStore.createTask(taskParams, request.id, {
          method: request.method,
          params: request.params
        }, sessionId);
      },
      getTask: async (taskId) => {
        const task = await taskStore.getTask(taskId, sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
        }
        return task;
      },
      storeTaskResult: async (taskId, status, result) => {
        await taskStore.storeTaskResult(taskId, status, result, sessionId);
        const task = await taskStore.getTask(taskId, sessionId);
        if (task) {
          const notification = TaskStatusNotificationSchema.parse({
            method: "notifications/tasks/status",
            params: task
          });
          await this.notification(notification);
          if (isTerminal(task.status)) {
            this._cleanupTaskProgressHandler(taskId);
          }
        }
      },
      getTaskResult: (taskId) => {
        return taskStore.getTaskResult(taskId, sessionId);
      },
      updateTaskStatus: async (taskId, status, statusMessage) => {
        const task = await taskStore.getTask(taskId, sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, `Task "${taskId}" not found - it may have been cleaned up`);
        }
        if (isTerminal(task.status)) {
          throw new McpError(ErrorCode.InvalidParams, `Cannot update task "${taskId}" from terminal status "${task.status}" to "${status}". Terminal states (completed, failed, cancelled) cannot transition to other states.`);
        }
        await taskStore.updateTaskStatus(taskId, status, statusMessage, sessionId);
        const updatedTask = await taskStore.getTask(taskId, sessionId);
        if (updatedTask) {
          const notification = TaskStatusNotificationSchema.parse({
            method: "notifications/tasks/status",
            params: updatedTask
          });
          await this.notification(notification);
          if (isTerminal(updatedTask.status)) {
            this._cleanupTaskProgressHandler(taskId);
          }
        }
      },
      listTasks: (cursor) => {
        return taskStore.listTasks(cursor, sessionId);
      }
    };
  }
}
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeCapabilities(base, additional) {
  const result = { ...base };
  for (const key in additional) {
    const k = key;
    const addValue = additional[k];
    if (addValue === undefined)
      continue;
    const baseValue = result[k];
    if (isPlainObject2(baseValue) && isPlainObject2(addValue)) {
      result[k] = { ...baseValue, ...addValue };
    } else {
      result[k] = addValue;
    }
  }
  return result;
}
var DEFAULT_REQUEST_TIMEOUT_MSEC = 60000;
var init_protocol = __esm(() => {
  init_zod_compat();
  init_types();
  init_zod_json_schema_compat();
});

// node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = undefined;

  class _CodeOrName {
  }
  exports._CodeOrName = _CodeOrName;
  exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;

  class Name extends _CodeOrName {
    constructor(s) {
      super();
      if (!exports.IDENTIFIER.test(s))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = s;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      return false;
    }
    get names() {
      return { [this.str]: 1 };
    }
  }
  exports.Name = Name;

  class _Code extends _CodeOrName {
    constructor(code) {
      super();
      this._items = typeof code === "string" ? [code] : code;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return false;
      const item = this._items[0];
      return item === "" || item === '""';
    }
    get str() {
      var _a;
      return (_a = this._str) !== null && _a !== undefined ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
    }
    get names() {
      var _a;
      return (_a = this._names) !== null && _a !== undefined ? _a : this._names = this._items.reduce((names, c) => {
        if (c instanceof Name)
          names[c.str] = (names[c.str] || 0) + 1;
        return names;
      }, {});
    }
  }
  exports._Code = _Code;
  exports.nil = new _Code("");
  function _(strs, ...args) {
    const code = [strs[0]];
    let i = 0;
    while (i < args.length) {
      addCodeArg(code, args[i]);
      code.push(strs[++i]);
    }
    return new _Code(code);
  }
  exports._ = _;
  var plus = new _Code("+");
  function str(strs, ...args) {
    const expr = [safeStringify(strs[0])];
    let i = 0;
    while (i < args.length) {
      expr.push(plus);
      addCodeArg(expr, args[i]);
      expr.push(plus, safeStringify(strs[++i]));
    }
    optimize(expr);
    return new _Code(expr);
  }
  exports.str = str;
  function addCodeArg(code, arg) {
    if (arg instanceof _Code)
      code.push(...arg._items);
    else if (arg instanceof Name)
      code.push(arg);
    else
      code.push(interpolate(arg));
  }
  exports.addCodeArg = addCodeArg;
  function optimize(expr) {
    let i = 1;
    while (i < expr.length - 1) {
      if (expr[i] === plus) {
        const res = mergeExprItems(expr[i - 1], expr[i + 1]);
        if (res !== undefined) {
          expr.splice(i - 1, 3, res);
          continue;
        }
        expr[i++] = "+";
      }
      i++;
    }
  }
  function mergeExprItems(a, b) {
    if (b === '""')
      return a;
    if (a === '""')
      return b;
    if (typeof a == "string") {
      if (b instanceof Name || a[a.length - 1] !== '"')
        return;
      if (typeof b != "string")
        return `${a.slice(0, -1)}${b}"`;
      if (b[0] === '"')
        return a.slice(0, -1) + b.slice(1);
      return;
    }
    if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
      return `"${a}${b.slice(1)}`;
    return;
  }
  function strConcat(c1, c2) {
    return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
  }
  exports.strConcat = strConcat;
  function interpolate(x) {
    return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
  }
  function stringify(x) {
    return new _Code(safeStringify(x));
  }
  exports.stringify = stringify;
  function safeStringify(x) {
    return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  exports.safeStringify = safeStringify;
  function getProperty(key) {
    return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
  }
  exports.getProperty = getProperty;
  function getEsmExportName(key) {
    if (typeof key == "string" && exports.IDENTIFIER.test(key)) {
      return new _Code(`${key}`);
    }
    throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
  }
  exports.getEsmExportName = getEsmExportName;
  function regexpCode(rx) {
    return new _Code(rx.toString());
  }
  exports.regexpCode = regexpCode;
});

// node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = undefined;
  var code_1 = require_code();

  class ValueError extends Error {
    constructor(name) {
      super(`CodeGen: "code" for ${name} not defined`);
      this.value = name.value;
    }
  }
  var UsedValueState;
  (function(UsedValueState2) {
    UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
    UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
  })(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
  exports.varKinds = {
    const: new code_1.Name("const"),
    let: new code_1.Name("let"),
    var: new code_1.Name("var")
  };

  class Scope {
    constructor({ prefixes, parent } = {}) {
      this._names = {};
      this._prefixes = prefixes;
      this._parent = parent;
    }
    toName(nameOrPrefix) {
      return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
    }
    name(prefix) {
      return new code_1.Name(this._newName(prefix));
    }
    _newName(prefix) {
      const ng = this._names[prefix] || this._nameGroup(prefix);
      return `${prefix}${ng.index++}`;
    }
    _nameGroup(prefix) {
      var _a, _b;
      if (((_b = (_a = this._parent) === null || _a === undefined ? undefined : _a._prefixes) === null || _b === undefined ? undefined : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
        throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
      }
      return this._names[prefix] = { prefix, index: 0 };
    }
  }
  exports.Scope = Scope;

  class ValueScopeName extends code_1.Name {
    constructor(prefix, nameStr) {
      super(nameStr);
      this.prefix = prefix;
    }
    setValue(value, { property, itemIndex }) {
      this.value = value;
      this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
    }
  }
  exports.ValueScopeName = ValueScopeName;
  var line = (0, code_1._)`\n`;

  class ValueScope extends Scope {
    constructor(opts) {
      super(opts);
      this._values = {};
      this._scope = opts.scope;
      this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
    }
    get() {
      return this._scope;
    }
    name(prefix) {
      return new ValueScopeName(prefix, this._newName(prefix));
    }
    value(nameOrPrefix, value) {
      var _a;
      if (value.ref === undefined)
        throw new Error("CodeGen: ref must be passed in value");
      const name = this.toName(nameOrPrefix);
      const { prefix } = name;
      const valueKey = (_a = value.key) !== null && _a !== undefined ? _a : value.ref;
      let vs = this._values[prefix];
      if (vs) {
        const _name = vs.get(valueKey);
        if (_name)
          return _name;
      } else {
        vs = this._values[prefix] = new Map;
      }
      vs.set(valueKey, name);
      const s = this._scope[prefix] || (this._scope[prefix] = []);
      const itemIndex = s.length;
      s[itemIndex] = value.ref;
      name.setValue(value, { property: prefix, itemIndex });
      return name;
    }
    getValue(prefix, keyOrRef) {
      const vs = this._values[prefix];
      if (!vs)
        return;
      return vs.get(keyOrRef);
    }
    scopeRefs(scopeName, values = this._values) {
      return this._reduceValues(values, (name) => {
        if (name.scopePath === undefined)
          throw new Error(`CodeGen: name "${name}" has no value`);
        return (0, code_1._)`${scopeName}${name.scopePath}`;
      });
    }
    scopeCode(values = this._values, usedValues, getCode) {
      return this._reduceValues(values, (name) => {
        if (name.value === undefined)
          throw new Error(`CodeGen: name "${name}" has no value`);
        return name.value.code;
      }, usedValues, getCode);
    }
    _reduceValues(values, valueCode, usedValues = {}, getCode) {
      let code = code_1.nil;
      for (const prefix in values) {
        const vs = values[prefix];
        if (!vs)
          continue;
        const nameSet = usedValues[prefix] = usedValues[prefix] || new Map;
        vs.forEach((name) => {
          if (nameSet.has(name))
            return;
          nameSet.set(name, UsedValueState.Started);
          let c = valueCode(name);
          if (c) {
            const def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
            code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
          } else if (c = getCode === null || getCode === undefined ? undefined : getCode(name)) {
            code = (0, code_1._)`${code}${c}${this.opts._n}`;
          } else {
            throw new ValueError(name);
          }
          nameSet.set(name, UsedValueState.Completed);
        });
      }
      return code;
    }
  }
  exports.ValueScope = ValueScope;
});

// node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = undefined;
  var code_1 = require_code();
  var scope_1 = require_scope();
  var code_2 = require_code();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return code_2._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return code_2.str;
  } });
  Object.defineProperty(exports, "strConcat", { enumerable: true, get: function() {
    return code_2.strConcat;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return code_2.nil;
  } });
  Object.defineProperty(exports, "getProperty", { enumerable: true, get: function() {
    return code_2.getProperty;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return code_2.stringify;
  } });
  Object.defineProperty(exports, "regexpCode", { enumerable: true, get: function() {
    return code_2.regexpCode;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return code_2.Name;
  } });
  var scope_2 = require_scope();
  Object.defineProperty(exports, "Scope", { enumerable: true, get: function() {
    return scope_2.Scope;
  } });
  Object.defineProperty(exports, "ValueScope", { enumerable: true, get: function() {
    return scope_2.ValueScope;
  } });
  Object.defineProperty(exports, "ValueScopeName", { enumerable: true, get: function() {
    return scope_2.ValueScopeName;
  } });
  Object.defineProperty(exports, "varKinds", { enumerable: true, get: function() {
    return scope_2.varKinds;
  } });
  exports.operators = {
    GT: new code_1._Code(">"),
    GTE: new code_1._Code(">="),
    LT: new code_1._Code("<"),
    LTE: new code_1._Code("<="),
    EQ: new code_1._Code("==="),
    NEQ: new code_1._Code("!=="),
    NOT: new code_1._Code("!"),
    OR: new code_1._Code("||"),
    AND: new code_1._Code("&&"),
    ADD: new code_1._Code("+")
  };

  class Node {
    optimizeNodes() {
      return this;
    }
    optimizeNames(_names, _constants) {
      return this;
    }
  }

  class Def extends Node {
    constructor(varKind, name, rhs) {
      super();
      this.varKind = varKind;
      this.name = name;
      this.rhs = rhs;
    }
    render({ es5, _n }) {
      const varKind = es5 ? scope_1.varKinds.var : this.varKind;
      const rhs = this.rhs === undefined ? "" : ` = ${this.rhs}`;
      return `${varKind} ${this.name}${rhs};` + _n;
    }
    optimizeNames(names, constants) {
      if (!names[this.name.str])
        return;
      if (this.rhs)
        this.rhs = optimizeExpr(this.rhs, names, constants);
      return this;
    }
    get names() {
      return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
    }
  }

  class Assign extends Node {
    constructor(lhs, rhs, sideEffects) {
      super();
      this.lhs = lhs;
      this.rhs = rhs;
      this.sideEffects = sideEffects;
    }
    render({ _n }) {
      return `${this.lhs} = ${this.rhs};` + _n;
    }
    optimizeNames(names, constants) {
      if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
        return;
      this.rhs = optimizeExpr(this.rhs, names, constants);
      return this;
    }
    get names() {
      const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
      return addExprNames(names, this.rhs);
    }
  }

  class AssignOp extends Assign {
    constructor(lhs, op, rhs, sideEffects) {
      super(lhs, rhs, sideEffects);
      this.op = op;
    }
    render({ _n }) {
      return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
    }
  }

  class Label extends Node {
    constructor(label) {
      super();
      this.label = label;
      this.names = {};
    }
    render({ _n }) {
      return `${this.label}:` + _n;
    }
  }

  class Break extends Node {
    constructor(label) {
      super();
      this.label = label;
      this.names = {};
    }
    render({ _n }) {
      const label = this.label ? ` ${this.label}` : "";
      return `break${label};` + _n;
    }
  }

  class Throw extends Node {
    constructor(error) {
      super();
      this.error = error;
    }
    render({ _n }) {
      return `throw ${this.error};` + _n;
    }
    get names() {
      return this.error.names;
    }
  }

  class AnyCode extends Node {
    constructor(code) {
      super();
      this.code = code;
    }
    render({ _n }) {
      return `${this.code};` + _n;
    }
    optimizeNodes() {
      return `${this.code}` ? this : undefined;
    }
    optimizeNames(names, constants) {
      this.code = optimizeExpr(this.code, names, constants);
      return this;
    }
    get names() {
      return this.code instanceof code_1._CodeOrName ? this.code.names : {};
    }
  }

  class ParentNode extends Node {
    constructor(nodes = []) {
      super();
      this.nodes = nodes;
    }
    render(opts) {
      return this.nodes.reduce((code, n) => code + n.render(opts), "");
    }
    optimizeNodes() {
      const { nodes } = this;
      let i = nodes.length;
      while (i--) {
        const n = nodes[i].optimizeNodes();
        if (Array.isArray(n))
          nodes.splice(i, 1, ...n);
        else if (n)
          nodes[i] = n;
        else
          nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : undefined;
    }
    optimizeNames(names, constants) {
      const { nodes } = this;
      let i = nodes.length;
      while (i--) {
        const n = nodes[i];
        if (n.optimizeNames(names, constants))
          continue;
        subtractNames(names, n.names);
        nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : undefined;
    }
    get names() {
      return this.nodes.reduce((names, n) => addNames(names, n.names), {});
    }
  }

  class BlockNode extends ParentNode {
    render(opts) {
      return "{" + opts._n + super.render(opts) + "}" + opts._n;
    }
  }

  class Root extends ParentNode {
  }

  class Else extends BlockNode {
  }
  Else.kind = "else";

  class If extends BlockNode {
    constructor(condition, nodes) {
      super(nodes);
      this.condition = condition;
    }
    render(opts) {
      let code = `if(${this.condition})` + super.render(opts);
      if (this.else)
        code += "else " + this.else.render(opts);
      return code;
    }
    optimizeNodes() {
      super.optimizeNodes();
      const cond = this.condition;
      if (cond === true)
        return this.nodes;
      let e = this.else;
      if (e) {
        const ns = e.optimizeNodes();
        e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
      }
      if (e) {
        if (cond === false)
          return e instanceof If ? e : e.nodes;
        if (this.nodes.length)
          return this;
        return new If(not(cond), e instanceof If ? [e] : e.nodes);
      }
      if (cond === false || !this.nodes.length)
        return;
      return this;
    }
    optimizeNames(names, constants) {
      var _a;
      this.else = (_a = this.else) === null || _a === undefined ? undefined : _a.optimizeNames(names, constants);
      if (!(super.optimizeNames(names, constants) || this.else))
        return;
      this.condition = optimizeExpr(this.condition, names, constants);
      return this;
    }
    get names() {
      const names = super.names;
      addExprNames(names, this.condition);
      if (this.else)
        addNames(names, this.else.names);
      return names;
    }
  }
  If.kind = "if";

  class For extends BlockNode {
  }
  For.kind = "for";

  class ForLoop extends For {
    constructor(iteration) {
      super();
      this.iteration = iteration;
    }
    render(opts) {
      return `for(${this.iteration})` + super.render(opts);
    }
    optimizeNames(names, constants) {
      if (!super.optimizeNames(names, constants))
        return;
      this.iteration = optimizeExpr(this.iteration, names, constants);
      return this;
    }
    get names() {
      return addNames(super.names, this.iteration.names);
    }
  }

  class ForRange extends For {
    constructor(varKind, name, from, to) {
      super();
      this.varKind = varKind;
      this.name = name;
      this.from = from;
      this.to = to;
    }
    render(opts) {
      const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
      const { name, from, to } = this;
      return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
    }
    get names() {
      const names = addExprNames(super.names, this.from);
      return addExprNames(names, this.to);
    }
  }

  class ForIter extends For {
    constructor(loop, varKind, name, iterable) {
      super();
      this.loop = loop;
      this.varKind = varKind;
      this.name = name;
      this.iterable = iterable;
    }
    render(opts) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
    }
    optimizeNames(names, constants) {
      if (!super.optimizeNames(names, constants))
        return;
      this.iterable = optimizeExpr(this.iterable, names, constants);
      return this;
    }
    get names() {
      return addNames(super.names, this.iterable.names);
    }
  }

  class Func extends BlockNode {
    constructor(name, args, async) {
      super();
      this.name = name;
      this.args = args;
      this.async = async;
    }
    render(opts) {
      const _async = this.async ? "async " : "";
      return `${_async}function ${this.name}(${this.args})` + super.render(opts);
    }
  }
  Func.kind = "func";

  class Return extends ParentNode {
    render(opts) {
      return "return " + super.render(opts);
    }
  }
  Return.kind = "return";

  class Try extends BlockNode {
    render(opts) {
      let code = "try" + super.render(opts);
      if (this.catch)
        code += this.catch.render(opts);
      if (this.finally)
        code += this.finally.render(opts);
      return code;
    }
    optimizeNodes() {
      var _a, _b;
      super.optimizeNodes();
      (_a = this.catch) === null || _a === undefined || _a.optimizeNodes();
      (_b = this.finally) === null || _b === undefined || _b.optimizeNodes();
      return this;
    }
    optimizeNames(names, constants) {
      var _a, _b;
      super.optimizeNames(names, constants);
      (_a = this.catch) === null || _a === undefined || _a.optimizeNames(names, constants);
      (_b = this.finally) === null || _b === undefined || _b.optimizeNames(names, constants);
      return this;
    }
    get names() {
      const names = super.names;
      if (this.catch)
        addNames(names, this.catch.names);
      if (this.finally)
        addNames(names, this.finally.names);
      return names;
    }
  }

  class Catch extends BlockNode {
    constructor(error) {
      super();
      this.error = error;
    }
    render(opts) {
      return `catch(${this.error})` + super.render(opts);
    }
  }
  Catch.kind = "catch";

  class Finally extends BlockNode {
    render(opts) {
      return "finally" + super.render(opts);
    }
  }
  Finally.kind = "finally";

  class CodeGen {
    constructor(extScope, opts = {}) {
      this._values = {};
      this._blockStarts = [];
      this._constants = {};
      this.opts = { ...opts, _n: opts.lines ? `
` : "" };
      this._extScope = extScope;
      this._scope = new scope_1.Scope({ parent: extScope });
      this._nodes = [new Root];
    }
    toString() {
      return this._root.render(this.opts);
    }
    name(prefix) {
      return this._scope.name(prefix);
    }
    scopeName(prefix) {
      return this._extScope.name(prefix);
    }
    scopeValue(prefixOrName, value) {
      const name = this._extScope.value(prefixOrName, value);
      const vs = this._values[name.prefix] || (this._values[name.prefix] = new Set);
      vs.add(name);
      return name;
    }
    getScopeValue(prefix, keyOrRef) {
      return this._extScope.getValue(prefix, keyOrRef);
    }
    scopeRefs(scopeName) {
      return this._extScope.scopeRefs(scopeName, this._values);
    }
    scopeCode() {
      return this._extScope.scopeCode(this._values);
    }
    _def(varKind, nameOrPrefix, rhs, constant) {
      const name = this._scope.toName(nameOrPrefix);
      if (rhs !== undefined && constant)
        this._constants[name.str] = rhs;
      this._leafNode(new Def(varKind, name, rhs));
      return name;
    }
    const(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
    }
    let(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
    }
    var(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
    }
    assign(lhs, rhs, sideEffects) {
      return this._leafNode(new Assign(lhs, rhs, sideEffects));
    }
    add(lhs, rhs) {
      return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
    }
    code(c) {
      if (typeof c == "function")
        c();
      else if (c !== code_1.nil)
        this._leafNode(new AnyCode(c));
      return this;
    }
    object(...keyValues) {
      const code = ["{"];
      for (const [key, value] of keyValues) {
        if (code.length > 1)
          code.push(",");
        code.push(key);
        if (key !== value || this.opts.es5) {
          code.push(":");
          (0, code_1.addCodeArg)(code, value);
        }
      }
      code.push("}");
      return new code_1._Code(code);
    }
    if(condition, thenBody, elseBody) {
      this._blockNode(new If(condition));
      if (thenBody && elseBody) {
        this.code(thenBody).else().code(elseBody).endIf();
      } else if (thenBody) {
        this.code(thenBody).endIf();
      } else if (elseBody) {
        throw new Error('CodeGen: "else" body without "then" body');
      }
      return this;
    }
    elseIf(condition) {
      return this._elseNode(new If(condition));
    }
    else() {
      return this._elseNode(new Else);
    }
    endIf() {
      return this._endBlockNode(If, Else);
    }
    _for(node, forBody) {
      this._blockNode(node);
      if (forBody)
        this.code(forBody).endFor();
      return this;
    }
    for(iteration, forBody) {
      return this._for(new ForLoop(iteration), forBody);
    }
    forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
      const name = this._scope.toName(nameOrPrefix);
      return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
    }
    forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
      const name = this._scope.toName(nameOrPrefix);
      if (this.opts.es5) {
        const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
        return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
          this.var(name, (0, code_1._)`${arr}[${i}]`);
          forBody(name);
        });
      }
      return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
    }
    forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
      if (this.opts.ownProperties) {
        return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
      }
      const name = this._scope.toName(nameOrPrefix);
      return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
    }
    endFor() {
      return this._endBlockNode(For);
    }
    label(label) {
      return this._leafNode(new Label(label));
    }
    break(label) {
      return this._leafNode(new Break(label));
    }
    return(value) {
      const node = new Return;
      this._blockNode(node);
      this.code(value);
      if (node.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(Return);
    }
    try(tryBody, catchCode, finallyCode) {
      if (!catchCode && !finallyCode)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const node = new Try;
      this._blockNode(node);
      this.code(tryBody);
      if (catchCode) {
        const error = this.name("e");
        this._currNode = node.catch = new Catch(error);
        catchCode(error);
      }
      if (finallyCode) {
        this._currNode = node.finally = new Finally;
        this.code(finallyCode);
      }
      return this._endBlockNode(Catch, Finally);
    }
    throw(error) {
      return this._leafNode(new Throw(error));
    }
    block(body, nodeCount) {
      this._blockStarts.push(this._nodes.length);
      if (body)
        this.code(body).endBlock(nodeCount);
      return this;
    }
    endBlock(nodeCount) {
      const len = this._blockStarts.pop();
      if (len === undefined)
        throw new Error("CodeGen: not in self-balancing block");
      const toClose = this._nodes.length - len;
      if (toClose < 0 || nodeCount !== undefined && toClose !== nodeCount) {
        throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
      }
      this._nodes.length = len;
      return this;
    }
    func(name, args = code_1.nil, async, funcBody) {
      this._blockNode(new Func(name, args, async));
      if (funcBody)
        this.code(funcBody).endFunc();
      return this;
    }
    endFunc() {
      return this._endBlockNode(Func);
    }
    optimize(n = 1) {
      while (n-- > 0) {
        this._root.optimizeNodes();
        this._root.optimizeNames(this._root.names, this._constants);
      }
    }
    _leafNode(node) {
      this._currNode.nodes.push(node);
      return this;
    }
    _blockNode(node) {
      this._currNode.nodes.push(node);
      this._nodes.push(node);
    }
    _endBlockNode(N1, N2) {
      const n = this._currNode;
      if (n instanceof N1 || N2 && n instanceof N2) {
        this._nodes.pop();
        return this;
      }
      throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
    }
    _elseNode(node) {
      const n = this._currNode;
      if (!(n instanceof If)) {
        throw new Error('CodeGen: "else" without "if"');
      }
      this._currNode = n.else = node;
      return this;
    }
    get _root() {
      return this._nodes[0];
    }
    get _currNode() {
      const ns = this._nodes;
      return ns[ns.length - 1];
    }
    set _currNode(node) {
      const ns = this._nodes;
      ns[ns.length - 1] = node;
    }
  }
  exports.CodeGen = CodeGen;
  function addNames(names, from) {
    for (const n in from)
      names[n] = (names[n] || 0) + (from[n] || 0);
    return names;
  }
  function addExprNames(names, from) {
    return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
  }
  function optimizeExpr(expr, names, constants) {
    if (expr instanceof code_1.Name)
      return replaceName(expr);
    if (!canOptimize(expr))
      return expr;
    return new code_1._Code(expr._items.reduce((items, c) => {
      if (c instanceof code_1.Name)
        c = replaceName(c);
      if (c instanceof code_1._Code)
        items.push(...c._items);
      else
        items.push(c);
      return items;
    }, []));
    function replaceName(n) {
      const c = constants[n.str];
      if (c === undefined || names[n.str] !== 1)
        return n;
      delete names[n.str];
      return c;
    }
    function canOptimize(e) {
      return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== undefined);
    }
  }
  function subtractNames(names, from) {
    for (const n in from)
      names[n] = (names[n] || 0) - (from[n] || 0);
  }
  function not(x) {
    return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
  }
  exports.not = not;
  var andCode = mappend(exports.operators.AND);
  function and(...args) {
    return args.reduce(andCode);
  }
  exports.and = and;
  var orCode = mappend(exports.operators.OR);
  function or(...args) {
    return args.reduce(orCode);
  }
  exports.or = or;
  function mappend(op) {
    return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
  }
  function par(x) {
    return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
  }
});

// node_modules/ajv/dist/compile/util.js
var require_util = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = undefined;
  var codegen_1 = require_codegen();
  var code_1 = require_code();
  function toHash(arr) {
    const hash = {};
    for (const item of arr)
      hash[item] = true;
    return hash;
  }
  exports.toHash = toHash;
  function alwaysValidSchema(it, schema) {
    if (typeof schema == "boolean")
      return schema;
    if (Object.keys(schema).length === 0)
      return true;
    checkUnknownRules(it, schema);
    return !schemaHasRules(schema, it.self.RULES.all);
  }
  exports.alwaysValidSchema = alwaysValidSchema;
  function checkUnknownRules(it, schema = it.schema) {
    const { opts, self } = it;
    if (!opts.strictSchema)
      return;
    if (typeof schema === "boolean")
      return;
    const rules = self.RULES.keywords;
    for (const key in schema) {
      if (!rules[key])
        checkStrictMode(it, `unknown keyword: "${key}"`);
    }
  }
  exports.checkUnknownRules = checkUnknownRules;
  function schemaHasRules(schema, rules) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (rules[key])
        return true;
    return false;
  }
  exports.schemaHasRules = schemaHasRules;
  function schemaHasRulesButRef(schema, RULES) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (key !== "$ref" && RULES.all[key])
        return true;
    return false;
  }
  exports.schemaHasRulesButRef = schemaHasRulesButRef;
  function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
    if (!$data) {
      if (typeof schema == "number" || typeof schema == "boolean")
        return schema;
      if (typeof schema == "string")
        return (0, codegen_1._)`${schema}`;
    }
    return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
  }
  exports.schemaRefOrVal = schemaRefOrVal;
  function unescapeFragment(str) {
    return unescapeJsonPointer(decodeURIComponent(str));
  }
  exports.unescapeFragment = unescapeFragment;
  function escapeFragment(str) {
    return encodeURIComponent(escapeJsonPointer(str));
  }
  exports.escapeFragment = escapeFragment;
  function escapeJsonPointer(str) {
    if (typeof str == "number")
      return `${str}`;
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
  }
  exports.escapeJsonPointer = escapeJsonPointer;
  function unescapeJsonPointer(str) {
    return str.replace(/~1/g, "/").replace(/~0/g, "~");
  }
  exports.unescapeJsonPointer = unescapeJsonPointer;
  function eachItem(xs, f) {
    if (Array.isArray(xs)) {
      for (const x of xs)
        f(x);
    } else {
      f(xs);
    }
  }
  exports.eachItem = eachItem;
  function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
    return (gen, from, to, toName) => {
      const res = to === undefined ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
      return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
    };
  }
  exports.mergeEvaluated = {
    props: makeMergeEvaluated({
      mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
        gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
      }),
      mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
        if (from === true) {
          gen.assign(to, true);
        } else {
          gen.assign(to, (0, codegen_1._)`${to} || {}`);
          setEvaluated(gen, to, from);
        }
      }),
      mergeValues: (from, to) => from === true ? true : { ...from, ...to },
      resultToName: evaluatedPropsToName
    }),
    items: makeMergeEvaluated({
      mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
      mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
      mergeValues: (from, to) => from === true ? true : Math.max(from, to),
      resultToName: (gen, items) => gen.var("items", items)
    })
  };
  function evaluatedPropsToName(gen, ps) {
    if (ps === true)
      return gen.var("props", true);
    const props = gen.var("props", (0, codegen_1._)`{}`);
    if (ps !== undefined)
      setEvaluated(gen, props, ps);
    return props;
  }
  exports.evaluatedPropsToName = evaluatedPropsToName;
  function setEvaluated(gen, props, ps) {
    Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
  }
  exports.setEvaluated = setEvaluated;
  var snippets = {};
  function useFunc(gen, f) {
    return gen.scopeValue("func", {
      ref: f,
      code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
    });
  }
  exports.useFunc = useFunc;
  var Type;
  (function(Type2) {
    Type2[Type2["Num"] = 0] = "Num";
    Type2[Type2["Str"] = 1] = "Str";
  })(Type || (exports.Type = Type = {}));
  function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
    if (dataProp instanceof codegen_1.Name) {
      const isNumber = dataPropType === Type.Num;
      return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
    }
    return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
  }
  exports.getErrorPath = getErrorPath;
  function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
    if (!mode)
      return;
    msg = `strict mode: ${msg}`;
    if (mode === true)
      throw new Error(msg);
    it.self.logger.warn(msg);
  }
  exports.checkStrictMode = checkStrictMode;
});

// node_modules/ajv/dist/compile/names.js
var require_names = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var names = {
    data: new codegen_1.Name("data"),
    valCxt: new codegen_1.Name("valCxt"),
    instancePath: new codegen_1.Name("instancePath"),
    parentData: new codegen_1.Name("parentData"),
    parentDataProperty: new codegen_1.Name("parentDataProperty"),
    rootData: new codegen_1.Name("rootData"),
    dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
    vErrors: new codegen_1.Name("vErrors"),
    errors: new codegen_1.Name("errors"),
    this: new codegen_1.Name("this"),
    self: new codegen_1.Name("self"),
    scope: new codegen_1.Name("scope"),
    json: new codegen_1.Name("json"),
    jsonPos: new codegen_1.Name("jsonPos"),
    jsonLen: new codegen_1.Name("jsonLen"),
    jsonPart: new codegen_1.Name("jsonPart")
  };
  exports.default = names;
});

// node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var names_1 = require_names();
  exports.keywordError = {
    message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
  };
  exports.keyword$DataError = {
    message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
  };
  function reportError(cxt, error = exports.keywordError, errorPaths, overrideAllErrors) {
    const { it } = cxt;
    const { gen, compositeRule, allErrors } = it;
    const errObj = errorObjectCode(cxt, error, errorPaths);
    if (overrideAllErrors !== null && overrideAllErrors !== undefined ? overrideAllErrors : compositeRule || allErrors) {
      addError(gen, errObj);
    } else {
      returnErrors(it, (0, codegen_1._)`[${errObj}]`);
    }
  }
  exports.reportError = reportError;
  function reportExtraError(cxt, error = exports.keywordError, errorPaths) {
    const { it } = cxt;
    const { gen, compositeRule, allErrors } = it;
    const errObj = errorObjectCode(cxt, error, errorPaths);
    addError(gen, errObj);
    if (!(compositeRule || allErrors)) {
      returnErrors(it, names_1.default.vErrors);
    }
  }
  exports.reportExtraError = reportExtraError;
  function resetErrorsCount(gen, errsCount) {
    gen.assign(names_1.default.errors, errsCount);
    gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
  }
  exports.resetErrorsCount = resetErrorsCount;
  function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
    if (errsCount === undefined)
      throw new Error("ajv implementation error");
    const err = gen.name("err");
    gen.forRange("i", errsCount, names_1.default.errors, (i) => {
      gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
      gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
      gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
      if (it.opts.verbose) {
        gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
        gen.assign((0, codegen_1._)`${err}.data`, data);
      }
    });
  }
  exports.extendErrors = extendErrors;
  function addError(gen, errObj) {
    const err = gen.const("err", errObj);
    gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
    gen.code((0, codegen_1._)`${names_1.default.errors}++`);
  }
  function returnErrors(it, errs) {
    const { gen, validateName, schemaEnv } = it;
    if (schemaEnv.$async) {
      gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
      gen.return(false);
    }
  }
  var E = {
    keyword: new codegen_1.Name("keyword"),
    schemaPath: new codegen_1.Name("schemaPath"),
    params: new codegen_1.Name("params"),
    propertyName: new codegen_1.Name("propertyName"),
    message: new codegen_1.Name("message"),
    schema: new codegen_1.Name("schema"),
    parentSchema: new codegen_1.Name("parentSchema")
  };
  function errorObjectCode(cxt, error, errorPaths) {
    const { createErrors } = cxt.it;
    if (createErrors === false)
      return (0, codegen_1._)`{}`;
    return errorObject(cxt, error, errorPaths);
  }
  function errorObject(cxt, error, errorPaths = {}) {
    const { gen, it } = cxt;
    const keyValues = [
      errorInstancePath(it, errorPaths),
      errorSchemaPath(cxt, errorPaths)
    ];
    extraErrorProps(cxt, error, keyValues);
    return gen.object(...keyValues);
  }
  function errorInstancePath({ errorPath }, { instancePath }) {
    const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
    return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
  }
  function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
    let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
    if (schemaPath) {
      schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
    }
    return [E.schemaPath, schPath];
  }
  function extraErrorProps(cxt, { params, message }, keyValues) {
    const { keyword, data, schemaValue, it } = cxt;
    const { opts, propertyName, topSchemaRef, schemaPath } = it;
    keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
    if (opts.messages) {
      keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
    }
    if (opts.verbose) {
      keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
    }
    if (propertyName)
      keyValues.push([E.propertyName, propertyName]);
  }
});

// node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = undefined;
  var errors_1 = require_errors();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var boolError = {
    message: "boolean schema is false"
  };
  function topBoolOrEmptySchema(it) {
    const { gen, schema, validateName } = it;
    if (schema === false) {
      falseSchemaError(it, false);
    } else if (typeof schema == "object" && schema.$async === true) {
      gen.return(names_1.default.data);
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, null);
      gen.return(true);
    }
  }
  exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
  function boolOrEmptySchema(it, valid) {
    const { gen, schema } = it;
    if (schema === false) {
      gen.var(valid, false);
      falseSchemaError(it);
    } else {
      gen.var(valid, true);
    }
  }
  exports.boolOrEmptySchema = boolOrEmptySchema;
  function falseSchemaError(it, overrideAllErrors) {
    const { gen, data } = it;
    const cxt = {
      gen,
      keyword: "false schema",
      data,
      schema: false,
      schemaCode: false,
      schemaValue: false,
      params: {},
      it
    };
    (0, errors_1.reportError)(cxt, boolError, undefined, overrideAllErrors);
  }
});

// node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getRules = exports.isJSONType = undefined;
  var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
  var jsonTypes = new Set(_jsonTypes);
  function isJSONType(x) {
    return typeof x == "string" && jsonTypes.has(x);
  }
  exports.isJSONType = isJSONType;
  function getRules() {
    const groups = {
      number: { type: "number", rules: [] },
      string: { type: "string", rules: [] },
      array: { type: "array", rules: [] },
      object: { type: "object", rules: [] }
    };
    return {
      types: { ...groups, integer: true, boolean: true, null: true },
      rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
      post: { rules: [] },
      all: {},
      keywords: {}
    };
  }
  exports.getRules = getRules;
});

// node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = undefined;
  function schemaHasRulesForType({ schema, self }, type) {
    const group = self.RULES.types[type];
    return group && group !== true && shouldUseGroup(schema, group);
  }
  exports.schemaHasRulesForType = schemaHasRulesForType;
  function shouldUseGroup(schema, group) {
    return group.rules.some((rule) => shouldUseRule(schema, rule));
  }
  exports.shouldUseGroup = shouldUseGroup;
  function shouldUseRule(schema, rule) {
    var _a;
    return schema[rule.keyword] !== undefined || ((_a = rule.definition.implements) === null || _a === undefined ? undefined : _a.some((kwd) => schema[kwd] !== undefined));
  }
  exports.shouldUseRule = shouldUseRule;
});

// node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = undefined;
  var rules_1 = require_rules();
  var applicability_1 = require_applicability();
  var errors_1 = require_errors();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var DataType;
  (function(DataType2) {
    DataType2[DataType2["Correct"] = 0] = "Correct";
    DataType2[DataType2["Wrong"] = 1] = "Wrong";
  })(DataType || (exports.DataType = DataType = {}));
  function getSchemaTypes(schema) {
    const types = getJSONTypes(schema.type);
    const hasNull = types.includes("null");
    if (hasNull) {
      if (schema.nullable === false)
        throw new Error("type: null contradicts nullable: false");
    } else {
      if (!types.length && schema.nullable !== undefined) {
        throw new Error('"nullable" cannot be used without "type"');
      }
      if (schema.nullable === true)
        types.push("null");
    }
    return types;
  }
  exports.getSchemaTypes = getSchemaTypes;
  function getJSONTypes(ts) {
    const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
    if (types.every(rules_1.isJSONType))
      return types;
    throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
  }
  exports.getJSONTypes = getJSONTypes;
  function coerceAndCheckDataType(it, types) {
    const { gen, data, opts } = it;
    const coerceTo = coerceToTypes(types, opts.coerceTypes);
    const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
    if (checkTypes) {
      const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
      gen.if(wrongType, () => {
        if (coerceTo.length)
          coerceData(it, types, coerceTo);
        else
          reportTypeError(it);
      });
    }
    return checkTypes;
  }
  exports.coerceAndCheckDataType = coerceAndCheckDataType;
  var COERCIBLE = new Set(["string", "number", "integer", "boolean", "null"]);
  function coerceToTypes(types, coerceTypes) {
    return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
  }
  function coerceData(it, types, coerceTo) {
    const { gen, data, opts } = it;
    const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
    const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
    if (opts.coerceTypes === "array") {
      gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
    }
    gen.if((0, codegen_1._)`${coerced} !== undefined`);
    for (const t of coerceTo) {
      if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
        coerceSpecificType(t);
      }
    }
    gen.else();
    reportTypeError(it);
    gen.endIf();
    gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
      gen.assign(data, coerced);
      assignParentData(it, coerced);
    });
    function coerceSpecificType(t) {
      switch (t) {
        case "string":
          gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
          return;
        case "number":
          gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
          return;
        case "integer":
          gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
          return;
        case "boolean":
          gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
          return;
        case "null":
          gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
          gen.assign(coerced, null);
          return;
        case "array":
          gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
      }
    }
  }
  function assignParentData({ gen, parentData, parentDataProperty }, expr) {
    gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
  }
  function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
    const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
    let cond;
    switch (dataType) {
      case "null":
        return (0, codegen_1._)`${data} ${EQ} null`;
      case "array":
        cond = (0, codegen_1._)`Array.isArray(${data})`;
        break;
      case "object":
        cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
        break;
      case "integer":
        cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
        break;
      case "number":
        cond = numCond();
        break;
      default:
        return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
    }
    return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
    function numCond(_cond = codegen_1.nil) {
      return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
    }
  }
  exports.checkDataType = checkDataType;
  function checkDataTypes(dataTypes, data, strictNums, correct) {
    if (dataTypes.length === 1) {
      return checkDataType(dataTypes[0], data, strictNums, correct);
    }
    let cond;
    const types = (0, util_1.toHash)(dataTypes);
    if (types.array && types.object) {
      const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
      cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
      delete types.null;
      delete types.array;
      delete types.object;
    } else {
      cond = codegen_1.nil;
    }
    if (types.number)
      delete types.integer;
    for (const t in types)
      cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
    return cond;
  }
  exports.checkDataTypes = checkDataTypes;
  var typeError = {
    message: ({ schema }) => `must be ${schema}`,
    params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
  };
  function reportTypeError(it) {
    const cxt = getTypeErrorContext(it);
    (0, errors_1.reportError)(cxt, typeError);
  }
  exports.reportTypeError = reportTypeError;
  function getTypeErrorContext(it) {
    const { gen, data, schema } = it;
    const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
    return {
      gen,
      keyword: "type",
      data,
      schema: schema.type,
      schemaCode,
      schemaValue: schemaCode,
      parentSchema: schema,
      params: {},
      it
    };
  }
});

// node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.assignDefaults = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  function assignDefaults(it, ty) {
    const { properties, items } = it.schema;
    if (ty === "object" && properties) {
      for (const key in properties) {
        assignDefault(it, key, properties[key].default);
      }
    } else if (ty === "array" && Array.isArray(items)) {
      items.forEach((sch, i) => assignDefault(it, i, sch.default));
    }
  }
  exports.assignDefaults = assignDefaults;
  function assignDefault(it, prop, defaultValue) {
    const { gen, compositeRule, data, opts } = it;
    if (defaultValue === undefined)
      return;
    const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
    if (compositeRule) {
      (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
      return;
    }
    let condition = (0, codegen_1._)`${childData} === undefined`;
    if (opts.useDefaults === "empty") {
      condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
    }
    gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
  }
});

// node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var names_1 = require_names();
  var util_2 = require_util();
  function checkReportMissingProp(cxt, prop) {
    const { gen, data, it } = cxt;
    gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
      cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
      cxt.error();
    });
  }
  exports.checkReportMissingProp = checkReportMissingProp;
  function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
    return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
  }
  exports.checkMissingProp = checkMissingProp;
  function reportMissingProp(cxt, missing) {
    cxt.setParams({ missingProperty: missing }, true);
    cxt.error();
  }
  exports.reportMissingProp = reportMissingProp;
  function hasPropFunc(gen) {
    return gen.scopeValue("func", {
      ref: Object.prototype.hasOwnProperty,
      code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
    });
  }
  exports.hasPropFunc = hasPropFunc;
  function isOwnProperty(gen, data, property) {
    return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
  }
  exports.isOwnProperty = isOwnProperty;
  function propertyInData(gen, data, property, ownProperties) {
    const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
    return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
  }
  exports.propertyInData = propertyInData;
  function noPropertyInData(gen, data, property, ownProperties) {
    const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
    return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
  }
  exports.noPropertyInData = noPropertyInData;
  function allSchemaProperties(schemaMap) {
    return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
  }
  exports.allSchemaProperties = allSchemaProperties;
  function schemaProperties(it, schemaMap) {
    return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
  }
  exports.schemaProperties = schemaProperties;
  function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
    const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
    const valCxt = [
      [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
      [names_1.default.parentData, it.parentData],
      [names_1.default.parentDataProperty, it.parentDataProperty],
      [names_1.default.rootData, names_1.default.rootData]
    ];
    if (it.opts.dynamicRef)
      valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
    const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
    return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
  }
  exports.callValidateCode = callValidateCode;
  var newRegExp = (0, codegen_1._)`new RegExp`;
  function usePattern({ gen, it: { opts } }, pattern) {
    const u = opts.unicodeRegExp ? "u" : "";
    const { regExp } = opts.code;
    const rx = regExp(pattern, u);
    return gen.scopeValue("pattern", {
      key: rx.toString(),
      ref: rx,
      code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
    });
  }
  exports.usePattern = usePattern;
  function validateArray(cxt) {
    const { gen, data, keyword, it } = cxt;
    const valid = gen.name("valid");
    if (it.allErrors) {
      const validArr = gen.let("valid", true);
      validateItems(() => gen.assign(validArr, false));
      return validArr;
    }
    gen.var(valid, true);
    validateItems(() => gen.break());
    return valid;
    function validateItems(notValid) {
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      gen.forRange("i", 0, len, (i) => {
        cxt.subschema({
          keyword,
          dataProp: i,
          dataPropType: util_1.Type.Num
        }, valid);
        gen.if((0, codegen_1.not)(valid), notValid);
      });
    }
  }
  exports.validateArray = validateArray;
  function validateUnion(cxt) {
    const { gen, schema, keyword, it } = cxt;
    if (!Array.isArray(schema))
      throw new Error("ajv implementation error");
    const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
    if (alwaysValid && !it.opts.unevaluated)
      return;
    const valid = gen.let("valid", false);
    const schValid = gen.name("_valid");
    gen.block(() => schema.forEach((_sch, i) => {
      const schCxt = cxt.subschema({
        keyword,
        schemaProp: i,
        compositeRule: true
      }, schValid);
      gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
      const merged = cxt.mergeValidEvaluated(schCxt, schValid);
      if (!merged)
        gen.if((0, codegen_1.not)(valid));
    }));
    cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
  }
  exports.validateUnion = validateUnion;
});

// node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = undefined;
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var code_1 = require_code2();
  var errors_1 = require_errors();
  function macroKeywordCode(cxt, def) {
    const { gen, keyword, schema, parentSchema, it } = cxt;
    const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
    const schemaRef = useKeyword(gen, keyword, macroSchema);
    if (it.opts.validateSchema !== false)
      it.self.validateSchema(macroSchema, true);
    const valid = gen.name("valid");
    cxt.subschema({
      schema: macroSchema,
      schemaPath: codegen_1.nil,
      errSchemaPath: `${it.errSchemaPath}/${keyword}`,
      topSchemaRef: schemaRef,
      compositeRule: true
    }, valid);
    cxt.pass(valid, () => cxt.error(true));
  }
  exports.macroKeywordCode = macroKeywordCode;
  function funcKeywordCode(cxt, def) {
    var _a;
    const { gen, keyword, schema, parentSchema, $data, it } = cxt;
    checkAsyncKeyword(it, def);
    const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
    const validateRef = useKeyword(gen, keyword, validate);
    const valid = gen.let("valid");
    cxt.block$data(valid, validateKeyword);
    cxt.ok((_a = def.valid) !== null && _a !== undefined ? _a : valid);
    function validateKeyword() {
      if (def.errors === false) {
        assignValid();
        if (def.modifying)
          modifyData(cxt);
        reportErrs(() => cxt.error());
      } else {
        const ruleErrs = def.async ? validateAsync() : validateSync();
        if (def.modifying)
          modifyData(cxt);
        reportErrs(() => addErrs(cxt, ruleErrs));
      }
    }
    function validateAsync() {
      const ruleErrs = gen.let("ruleErrs", null);
      gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
      return ruleErrs;
    }
    function validateSync() {
      const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
      gen.assign(validateErrs, null);
      assignValid(codegen_1.nil);
      return validateErrs;
    }
    function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
      const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
      const passSchema = !(("compile" in def) && !$data || def.schema === false);
      gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
    }
    function reportErrs(errors) {
      var _a2;
      gen.if((0, codegen_1.not)((_a2 = def.valid) !== null && _a2 !== undefined ? _a2 : valid), errors);
    }
  }
  exports.funcKeywordCode = funcKeywordCode;
  function modifyData(cxt) {
    const { gen, data, it } = cxt;
    gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
  }
  function addErrs(cxt, errs) {
    const { gen } = cxt;
    gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
      gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      (0, errors_1.extendErrors)(cxt);
    }, () => cxt.error());
  }
  function checkAsyncKeyword({ schemaEnv }, def) {
    if (def.async && !schemaEnv.$async)
      throw new Error("async keyword in sync schema");
  }
  function useKeyword(gen, keyword, result) {
    if (result === undefined)
      throw new Error(`keyword "${keyword}" failed to compile`);
    return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
  }
  function validSchemaType(schema, schemaType, allowUndefined = false) {
    return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
  }
  exports.validSchemaType = validSchemaType;
  function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
    if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
      throw new Error("ajv implementation error");
    }
    const deps = def.dependencies;
    if (deps === null || deps === undefined ? undefined : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
      throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
    }
    if (def.validateSchema) {
      const valid = def.validateSchema(schema[keyword]);
      if (!valid) {
        const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
        if (opts.validateSchema === "log")
          self.logger.error(msg);
        else
          throw new Error(msg);
      }
    }
  }
  exports.validateKeywordUsage = validateKeywordUsage;
});

// node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
    if (keyword !== undefined && schema !== undefined) {
      throw new Error('both "keyword" and "schema" passed, only one allowed');
    }
    if (keyword !== undefined) {
      const sch = it.schema[keyword];
      return schemaProp === undefined ? {
        schema: sch,
        schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`
      } : {
        schema: sch[schemaProp],
        schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
        errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
      };
    }
    if (schema !== undefined) {
      if (schemaPath === undefined || errSchemaPath === undefined || topSchemaRef === undefined) {
        throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
      }
      return {
        schema,
        schemaPath,
        topSchemaRef,
        errSchemaPath
      };
    }
    throw new Error('either "keyword" or "schema" must be passed');
  }
  exports.getSubschema = getSubschema;
  function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
    if (data !== undefined && dataProp !== undefined) {
      throw new Error('both "data" and "dataProp" passed, only one allowed');
    }
    const { gen } = it;
    if (dataProp !== undefined) {
      const { errorPath, dataPathArr, opts } = it;
      const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
      dataContextProps(nextData);
      subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
      subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
      subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
    }
    if (data !== undefined) {
      const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
      dataContextProps(nextData);
      if (propertyName !== undefined)
        subschema.propertyName = propertyName;
    }
    if (dataTypes)
      subschema.dataTypes = dataTypes;
    function dataContextProps(_nextData) {
      subschema.data = _nextData;
      subschema.dataLevel = it.dataLevel + 1;
      subschema.dataTypes = [];
      it.definedProperties = new Set;
      subschema.parentData = it.data;
      subschema.dataNames = [...it.dataNames, _nextData];
    }
  }
  exports.extendSubschemaData = extendSubschemaData;
  function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
    if (compositeRule !== undefined)
      subschema.compositeRule = compositeRule;
    if (createErrors !== undefined)
      subschema.createErrors = createErrors;
    if (allErrors !== undefined)
      subschema.allErrors = allErrors;
    subschema.jtdDiscriminator = jtdDiscriminator;
    subschema.jtdMetadata = jtdMetadata;
  }
  exports.extendSubschemaMode = extendSubschemaMode;
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS((exports, module) => {
  module.exports = function equal(a, b) {
    if (a === b)
      return true;
    if (a && b && typeof a == "object" && typeof b == "object") {
      if (a.constructor !== b.constructor)
        return false;
      var length, i, keys;
      if (Array.isArray(a)) {
        length = a.length;
        if (length != b.length)
          return false;
        for (i = length;i-- !== 0; )
          if (!equal(a[i], b[i]))
            return false;
        return true;
      }
      if (a.constructor === RegExp)
        return a.source === b.source && a.flags === b.flags;
      if (a.valueOf !== Object.prototype.valueOf)
        return a.valueOf() === b.valueOf();
      if (a.toString !== Object.prototype.toString)
        return a.toString() === b.toString();
      keys = Object.keys(a);
      length = keys.length;
      if (length !== Object.keys(b).length)
        return false;
      for (i = length;i-- !== 0; )
        if (!Object.prototype.hasOwnProperty.call(b, keys[i]))
          return false;
      for (i = length;i-- !== 0; ) {
        var key = keys[i];
        if (!equal(a[key], b[key]))
          return false;
      }
      return true;
    }
    return a !== a && b !== b;
  };
});

// node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS((exports, module) => {
  var traverse = module.exports = function(schema, opts, cb) {
    if (typeof opts == "function") {
      cb = opts;
      opts = {};
    }
    cb = opts.cb || cb;
    var pre = typeof cb == "function" ? cb : cb.pre || function() {};
    var post = cb.post || function() {};
    _traverse(opts, pre, post, schema, "", schema);
  };
  traverse.keywords = {
    additionalItems: true,
    items: true,
    contains: true,
    additionalProperties: true,
    propertyNames: true,
    not: true,
    if: true,
    then: true,
    else: true
  };
  traverse.arrayKeywords = {
    items: true,
    allOf: true,
    anyOf: true,
    oneOf: true
  };
  traverse.propsKeywords = {
    $defs: true,
    definitions: true,
    properties: true,
    patternProperties: true,
    dependencies: true
  };
  traverse.skipKeywords = {
    default: true,
    enum: true,
    const: true,
    required: true,
    maximum: true,
    minimum: true,
    exclusiveMaximum: true,
    exclusiveMinimum: true,
    multipleOf: true,
    maxLength: true,
    minLength: true,
    pattern: true,
    format: true,
    maxItems: true,
    minItems: true,
    uniqueItems: true,
    maxProperties: true,
    minProperties: true
  };
  function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
    if (schema && typeof schema == "object" && !Array.isArray(schema)) {
      pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      for (var key in schema) {
        var sch = schema[key];
        if (Array.isArray(sch)) {
          if (key in traverse.arrayKeywords) {
            for (var i = 0;i < sch.length; i++)
              _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
          }
        } else if (key in traverse.propsKeywords) {
          if (sch && typeof sch == "object") {
            for (var prop in sch)
              _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
          }
        } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
          _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
        }
      }
      post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
    }
  }
  function escapeJsonPtr(str) {
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
  }
});

// node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = undefined;
  var util_1 = require_util();
  var equal = require_fast_deep_equal();
  var traverse = require_json_schema_traverse();
  var SIMPLE_INLINED = new Set([
    "type",
    "format",
    "pattern",
    "maxLength",
    "minLength",
    "maxProperties",
    "minProperties",
    "maxItems",
    "minItems",
    "maximum",
    "minimum",
    "uniqueItems",
    "multipleOf",
    "required",
    "enum",
    "const"
  ]);
  function inlineRef(schema, limit = true) {
    if (typeof schema == "boolean")
      return true;
    if (limit === true)
      return !hasRef(schema);
    if (!limit)
      return false;
    return countKeys(schema) <= limit;
  }
  exports.inlineRef = inlineRef;
  var REF_KEYWORDS = new Set([
    "$ref",
    "$recursiveRef",
    "$recursiveAnchor",
    "$dynamicRef",
    "$dynamicAnchor"
  ]);
  function hasRef(schema) {
    for (const key in schema) {
      if (REF_KEYWORDS.has(key))
        return true;
      const sch = schema[key];
      if (Array.isArray(sch) && sch.some(hasRef))
        return true;
      if (typeof sch == "object" && hasRef(sch))
        return true;
    }
    return false;
  }
  function countKeys(schema) {
    let count = 0;
    for (const key in schema) {
      if (key === "$ref")
        return Infinity;
      count++;
      if (SIMPLE_INLINED.has(key))
        continue;
      if (typeof schema[key] == "object") {
        (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
      }
      if (count === Infinity)
        return Infinity;
    }
    return count;
  }
  function getFullPath(resolver, id = "", normalize) {
    if (normalize !== false)
      id = normalizeId(id);
    const p = resolver.parse(id);
    return _getFullPath(resolver, p);
  }
  exports.getFullPath = getFullPath;
  function _getFullPath(resolver, p) {
    const serialized = resolver.serialize(p);
    return serialized.split("#")[0] + "#";
  }
  exports._getFullPath = _getFullPath;
  var TRAILING_SLASH_HASH = /#\/?$/;
  function normalizeId(id) {
    return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
  }
  exports.normalizeId = normalizeId;
  function resolveUrl(resolver, baseId, id) {
    id = normalizeId(id);
    return resolver.resolve(baseId, id);
  }
  exports.resolveUrl = resolveUrl;
  var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
  function getSchemaRefs(schema, baseId) {
    if (typeof schema == "boolean")
      return {};
    const { schemaId, uriResolver } = this.opts;
    const schId = normalizeId(schema[schemaId] || baseId);
    const baseIds = { "": schId };
    const pathPrefix = getFullPath(uriResolver, schId, false);
    const localRefs = {};
    const schemaRefs = new Set;
    traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
      if (parentJsonPtr === undefined)
        return;
      const fullPath = pathPrefix + jsonPtr;
      let innerBaseId = baseIds[parentJsonPtr];
      if (typeof sch[schemaId] == "string")
        innerBaseId = addRef.call(this, sch[schemaId]);
      addAnchor.call(this, sch.$anchor);
      addAnchor.call(this, sch.$dynamicAnchor);
      baseIds[jsonPtr] = innerBaseId;
      function addRef(ref) {
        const _resolve = this.opts.uriResolver.resolve;
        ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
        if (schemaRefs.has(ref))
          throw ambiguos(ref);
        schemaRefs.add(ref);
        let schOrRef = this.refs[ref];
        if (typeof schOrRef == "string")
          schOrRef = this.refs[schOrRef];
        if (typeof schOrRef == "object") {
          checkAmbiguosRef(sch, schOrRef.schema, ref);
        } else if (ref !== normalizeId(fullPath)) {
          if (ref[0] === "#") {
            checkAmbiguosRef(sch, localRefs[ref], ref);
            localRefs[ref] = sch;
          } else {
            this.refs[ref] = fullPath;
          }
        }
        return ref;
      }
      function addAnchor(anchor) {
        if (typeof anchor == "string") {
          if (!ANCHOR.test(anchor))
            throw new Error(`invalid anchor "${anchor}"`);
          addRef.call(this, `#${anchor}`);
        }
      }
    });
    return localRefs;
    function checkAmbiguosRef(sch1, sch2, ref) {
      if (sch2 !== undefined && !equal(sch1, sch2))
        throw ambiguos(ref);
    }
    function ambiguos(ref) {
      return new Error(`reference "${ref}" resolves to more than one schema`);
    }
  }
  exports.getSchemaRefs = getSchemaRefs;
});

// node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getData = exports.KeywordCxt = exports.validateFunctionCode = undefined;
  var boolSchema_1 = require_boolSchema();
  var dataType_1 = require_dataType();
  var applicability_1 = require_applicability();
  var dataType_2 = require_dataType();
  var defaults_1 = require_defaults();
  var keyword_1 = require_keyword();
  var subschema_1 = require_subschema();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var resolve_1 = require_resolve();
  var util_1 = require_util();
  var errors_1 = require_errors();
  function validateFunctionCode(it) {
    if (isSchemaObj(it)) {
      checkKeywords(it);
      if (schemaCxtHasRules(it)) {
        topSchemaObjCode(it);
        return;
      }
    }
    validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
  }
  exports.validateFunctionCode = validateFunctionCode;
  function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
    if (opts.code.es5) {
      gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
        gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
        destructureValCxtES5(gen, opts);
        gen.code(body);
      });
    } else {
      gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
    }
  }
  function destructureValCxt(opts) {
    return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
  }
  function destructureValCxtES5(gen, opts) {
    gen.if(names_1.default.valCxt, () => {
      gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
      gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
      gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
      gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
      if (opts.dynamicRef)
        gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
    }, () => {
      gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
      gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
      gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
      gen.var(names_1.default.rootData, names_1.default.data);
      if (opts.dynamicRef)
        gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
    });
  }
  function topSchemaObjCode(it) {
    const { schema, opts, gen } = it;
    validateFunction(it, () => {
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      checkNoDefault(it);
      gen.let(names_1.default.vErrors, null);
      gen.let(names_1.default.errors, 0);
      if (opts.unevaluated)
        resetEvaluated(it);
      typeAndKeywords(it);
      returnResults(it);
    });
    return;
  }
  function resetEvaluated(it) {
    const { gen, validateName } = it;
    it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
    gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
    gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
  }
  function funcSourceUrl(schema, opts) {
    const schId = typeof schema == "object" && schema[opts.schemaId];
    return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
  }
  function subschemaCode(it, valid) {
    if (isSchemaObj(it)) {
      checkKeywords(it);
      if (schemaCxtHasRules(it)) {
        subSchemaObjCode(it, valid);
        return;
      }
    }
    (0, boolSchema_1.boolOrEmptySchema)(it, valid);
  }
  function schemaCxtHasRules({ schema, self }) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (self.RULES.all[key])
        return true;
    return false;
  }
  function isSchemaObj(it) {
    return typeof it.schema != "boolean";
  }
  function subSchemaObjCode(it, valid) {
    const { schema, gen, opts } = it;
    if (opts.$comment && schema.$comment)
      commentKeyword(it);
    updateContext(it);
    checkAsyncSchema(it);
    const errsCount = gen.const("_errs", names_1.default.errors);
    typeAndKeywords(it, errsCount);
    gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
  }
  function checkKeywords(it) {
    (0, util_1.checkUnknownRules)(it);
    checkRefsAndKeywords(it);
  }
  function typeAndKeywords(it, errsCount) {
    if (it.opts.jtd)
      return schemaKeywords(it, [], false, errsCount);
    const types = (0, dataType_1.getSchemaTypes)(it.schema);
    const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
    schemaKeywords(it, types, !checkedTypes, errsCount);
  }
  function checkRefsAndKeywords(it) {
    const { schema, errSchemaPath, opts, self } = it;
    if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
      self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
    }
  }
  function checkNoDefault(it) {
    const { schema, opts } = it;
    if (schema.default !== undefined && opts.useDefaults && opts.strictSchema) {
      (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
    }
  }
  function updateContext(it) {
    const schId = it.schema[it.opts.schemaId];
    if (schId)
      it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
  }
  function checkAsyncSchema(it) {
    if (it.schema.$async && !it.schemaEnv.$async)
      throw new Error("async schema in sync schema");
  }
  function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
    const msg = schema.$comment;
    if (opts.$comment === true) {
      gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
    } else if (typeof opts.$comment == "function") {
      const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
      const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
      gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
    }
  }
  function returnResults(it) {
    const { gen, schemaEnv, validateName, ValidationError, opts } = it;
    if (schemaEnv.$async) {
      gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
      if (opts.unevaluated)
        assignEvaluated(it);
      gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
    }
  }
  function assignEvaluated({ gen, evaluated, props, items }) {
    if (props instanceof codegen_1.Name)
      gen.assign((0, codegen_1._)`${evaluated}.props`, props);
    if (items instanceof codegen_1.Name)
      gen.assign((0, codegen_1._)`${evaluated}.items`, items);
  }
  function schemaKeywords(it, types, typeErrors, errsCount) {
    const { gen, schema, data, allErrors, opts, self } = it;
    const { RULES } = self;
    if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
      gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
      return;
    }
    if (!opts.jtd)
      checkStrictTypes(it, types);
    gen.block(() => {
      for (const group of RULES.rules)
        groupKeywords(group);
      groupKeywords(RULES.post);
    });
    function groupKeywords(group) {
      if (!(0, applicability_1.shouldUseGroup)(schema, group))
        return;
      if (group.type) {
        gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
        iterateKeywords(it, group);
        if (types.length === 1 && types[0] === group.type && typeErrors) {
          gen.else();
          (0, dataType_2.reportTypeError)(it);
        }
        gen.endIf();
      } else {
        iterateKeywords(it, group);
      }
      if (!allErrors)
        gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
    }
  }
  function iterateKeywords(it, group) {
    const { gen, schema, opts: { useDefaults } } = it;
    if (useDefaults)
      (0, defaults_1.assignDefaults)(it, group.type);
    gen.block(() => {
      for (const rule of group.rules) {
        if ((0, applicability_1.shouldUseRule)(schema, rule)) {
          keywordCode(it, rule.keyword, rule.definition, group.type);
        }
      }
    });
  }
  function checkStrictTypes(it, types) {
    if (it.schemaEnv.meta || !it.opts.strictTypes)
      return;
    checkContextTypes(it, types);
    if (!it.opts.allowUnionTypes)
      checkMultipleTypes(it, types);
    checkKeywordTypes(it, it.dataTypes);
  }
  function checkContextTypes(it, types) {
    if (!types.length)
      return;
    if (!it.dataTypes.length) {
      it.dataTypes = types;
      return;
    }
    types.forEach((t) => {
      if (!includesType(it.dataTypes, t)) {
        strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
      }
    });
    narrowSchemaTypes(it, types);
  }
  function checkMultipleTypes(it, ts) {
    if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
      strictTypesError(it, "use allowUnionTypes to allow union type keyword");
    }
  }
  function checkKeywordTypes(it, ts) {
    const rules = it.self.RULES.all;
    for (const keyword in rules) {
      const rule = rules[keyword];
      if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
        const { type } = rule.definition;
        if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
          strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
        }
      }
    }
  }
  function hasApplicableType(schTs, kwdT) {
    return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
  }
  function includesType(ts, t) {
    return ts.includes(t) || t === "integer" && ts.includes("number");
  }
  function narrowSchemaTypes(it, withTypes) {
    const ts = [];
    for (const t of it.dataTypes) {
      if (includesType(withTypes, t))
        ts.push(t);
      else if (withTypes.includes("integer") && t === "number")
        ts.push("integer");
    }
    it.dataTypes = ts;
  }
  function strictTypesError(it, msg) {
    const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
    msg += ` at "${schemaPath}" (strictTypes)`;
    (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
  }

  class KeywordCxt {
    constructor(it, def, keyword) {
      (0, keyword_1.validateKeywordUsage)(it, def, keyword);
      this.gen = it.gen;
      this.allErrors = it.allErrors;
      this.keyword = keyword;
      this.data = it.data;
      this.schema = it.schema[keyword];
      this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
      this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
      this.schemaType = def.schemaType;
      this.parentSchema = it.schema;
      this.params = {};
      this.it = it;
      this.def = def;
      if (this.$data) {
        this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
      } else {
        this.schemaCode = this.schemaValue;
        if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
          throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
        }
      }
      if ("code" in def ? def.trackErrors : def.errors !== false) {
        this.errsCount = it.gen.const("_errs", names_1.default.errors);
      }
    }
    result(condition, successAction, failAction) {
      this.failResult((0, codegen_1.not)(condition), successAction, failAction);
    }
    failResult(condition, successAction, failAction) {
      this.gen.if(condition);
      if (failAction)
        failAction();
      else
        this.error();
      if (successAction) {
        this.gen.else();
        successAction();
        if (this.allErrors)
          this.gen.endIf();
      } else {
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
    }
    pass(condition, failAction) {
      this.failResult((0, codegen_1.not)(condition), undefined, failAction);
    }
    fail(condition) {
      if (condition === undefined) {
        this.error();
        if (!this.allErrors)
          this.gen.if(false);
        return;
      }
      this.gen.if(condition);
      this.error();
      if (this.allErrors)
        this.gen.endIf();
      else
        this.gen.else();
    }
    fail$data(condition) {
      if (!this.$data)
        return this.fail(condition);
      const { schemaCode } = this;
      this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
    }
    error(append, errorParams, errorPaths) {
      if (errorParams) {
        this.setParams(errorParams);
        this._error(append, errorPaths);
        this.setParams({});
        return;
      }
      this._error(append, errorPaths);
    }
    _error(append, errorPaths) {
      (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
    }
    $dataError() {
      (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
    }
    reset() {
      if (this.errsCount === undefined)
        throw new Error('add "trackErrors" to keyword definition');
      (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
    }
    ok(cond) {
      if (!this.allErrors)
        this.gen.if(cond);
    }
    setParams(obj, assign) {
      if (assign)
        Object.assign(this.params, obj);
      else
        this.params = obj;
    }
    block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
      this.gen.block(() => {
        this.check$data(valid, $dataValid);
        codeBlock();
      });
    }
    check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
      if (!this.$data)
        return;
      const { gen, schemaCode, schemaType, def } = this;
      gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
      if (valid !== codegen_1.nil)
        gen.assign(valid, true);
      if (schemaType.length || def.validateSchema) {
        gen.elseIf(this.invalid$data());
        this.$dataError();
        if (valid !== codegen_1.nil)
          gen.assign(valid, false);
      }
      gen.else();
    }
    invalid$data() {
      const { gen, schemaCode, schemaType, def, it } = this;
      return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
      function wrong$DataType() {
        if (schemaType.length) {
          if (!(schemaCode instanceof codegen_1.Name))
            throw new Error("ajv implementation error");
          const st = Array.isArray(schemaType) ? schemaType : [schemaType];
          return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
        }
        return codegen_1.nil;
      }
      function invalid$DataSchema() {
        if (def.validateSchema) {
          const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
          return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
        }
        return codegen_1.nil;
      }
    }
    subschema(appl, valid) {
      const subschema = (0, subschema_1.getSubschema)(this.it, appl);
      (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
      (0, subschema_1.extendSubschemaMode)(subschema, appl);
      const nextContext = { ...this.it, ...subschema, items: undefined, props: undefined };
      subschemaCode(nextContext, valid);
      return nextContext;
    }
    mergeEvaluated(schemaCxt, toName) {
      const { it, gen } = this;
      if (!it.opts.unevaluated)
        return;
      if (it.props !== true && schemaCxt.props !== undefined) {
        it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
      }
      if (it.items !== true && schemaCxt.items !== undefined) {
        it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
      }
    }
    mergeValidEvaluated(schemaCxt, valid) {
      const { it, gen } = this;
      if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
        gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
        return true;
      }
    }
  }
  exports.KeywordCxt = KeywordCxt;
  function keywordCode(it, keyword, def, ruleType) {
    const cxt = new KeywordCxt(it, def, keyword);
    if ("code" in def) {
      def.code(cxt, ruleType);
    } else if (cxt.$data && def.validate) {
      (0, keyword_1.funcKeywordCode)(cxt, def);
    } else if ("macro" in def) {
      (0, keyword_1.macroKeywordCode)(cxt, def);
    } else if (def.compile || def.validate) {
      (0, keyword_1.funcKeywordCode)(cxt, def);
    }
  }
  var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
  var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
  function getData($data, { dataLevel, dataNames, dataPathArr }) {
    let jsonPointer;
    let data;
    if ($data === "")
      return names_1.default.rootData;
    if ($data[0] === "/") {
      if (!JSON_POINTER.test($data))
        throw new Error(`Invalid JSON-pointer: ${$data}`);
      jsonPointer = $data;
      data = names_1.default.rootData;
    } else {
      const matches = RELATIVE_JSON_POINTER.exec($data);
      if (!matches)
        throw new Error(`Invalid JSON-pointer: ${$data}`);
      const up = +matches[1];
      jsonPointer = matches[2];
      if (jsonPointer === "#") {
        if (up >= dataLevel)
          throw new Error(errorMsg("property/index", up));
        return dataPathArr[dataLevel - up];
      }
      if (up > dataLevel)
        throw new Error(errorMsg("data", up));
      data = dataNames[dataLevel - up];
      if (!jsonPointer)
        return data;
    }
    let expr = data;
    const segments = jsonPointer.split("/");
    for (const segment of segments) {
      if (segment) {
        data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
        expr = (0, codegen_1._)`${expr} && ${data}`;
      }
    }
    return expr;
    function errorMsg(pointerType, up) {
      return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
    }
  }
  exports.getData = getData;
});

// node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });

  class ValidationError extends Error {
    constructor(errors) {
      super("validation failed");
      this.errors = errors;
      this.ajv = this.validation = true;
    }
  }
  exports.default = ValidationError;
});

// node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var resolve_1 = require_resolve();

  class MissingRefError extends Error {
    constructor(resolver, baseId, ref, msg) {
      super(msg || `can't resolve reference ${ref} from id ${baseId}`);
      this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
      this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
    }
  }
  exports.default = MissingRefError;
});

// node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = undefined;
  var codegen_1 = require_codegen();
  var validation_error_1 = require_validation_error();
  var names_1 = require_names();
  var resolve_1 = require_resolve();
  var util_1 = require_util();
  var validate_1 = require_validate();

  class SchemaEnv {
    constructor(env) {
      var _a;
      this.refs = {};
      this.dynamicAnchors = {};
      let schema;
      if (typeof env.schema == "object")
        schema = env.schema;
      this.schema = env.schema;
      this.schemaId = env.schemaId;
      this.root = env.root || this;
      this.baseId = (_a = env.baseId) !== null && _a !== undefined ? _a : (0, resolve_1.normalizeId)(schema === null || schema === undefined ? undefined : schema[env.schemaId || "$id"]);
      this.schemaPath = env.schemaPath;
      this.localRefs = env.localRefs;
      this.meta = env.meta;
      this.$async = schema === null || schema === undefined ? undefined : schema.$async;
      this.refs = {};
    }
  }
  exports.SchemaEnv = SchemaEnv;
  function compileSchema(sch) {
    const _sch = getCompilingSchema.call(this, sch);
    if (_sch)
      return _sch;
    const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
    const { es5, lines } = this.opts.code;
    const { ownProperties } = this.opts;
    const gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties });
    let _ValidationError;
    if (sch.$async) {
      _ValidationError = gen.scopeValue("Error", {
        ref: validation_error_1.default,
        code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
      });
    }
    const validateName = gen.scopeName("validate");
    sch.validateName = validateName;
    const schemaCxt = {
      gen,
      allErrors: this.opts.allErrors,
      data: names_1.default.data,
      parentData: names_1.default.parentData,
      parentDataProperty: names_1.default.parentDataProperty,
      dataNames: [names_1.default.data],
      dataPathArr: [codegen_1.nil],
      dataLevel: 0,
      dataTypes: [],
      definedProperties: new Set,
      topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
      validateName,
      ValidationError: _ValidationError,
      schema: sch.schema,
      schemaEnv: sch,
      rootId,
      baseId: sch.baseId || rootId,
      schemaPath: codegen_1.nil,
      errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
      errorPath: (0, codegen_1._)`""`,
      opts: this.opts,
      self: this
    };
    let sourceCode;
    try {
      this._compilations.add(sch);
      (0, validate_1.validateFunctionCode)(schemaCxt);
      gen.optimize(this.opts.code.optimize);
      const validateCode = gen.toString();
      sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
      if (this.opts.code.process)
        sourceCode = this.opts.code.process(sourceCode, sch);
      const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
      const validate = makeValidate(this, this.scope.get());
      this.scope.value(validateName, { ref: validate });
      validate.errors = null;
      validate.schema = sch.schema;
      validate.schemaEnv = sch;
      if (sch.$async)
        validate.$async = true;
      if (this.opts.code.source === true) {
        validate.source = { validateName, validateCode, scopeValues: gen._values };
      }
      if (this.opts.unevaluated) {
        const { props, items } = schemaCxt;
        validate.evaluated = {
          props: props instanceof codegen_1.Name ? undefined : props,
          items: items instanceof codegen_1.Name ? undefined : items,
          dynamicProps: props instanceof codegen_1.Name,
          dynamicItems: items instanceof codegen_1.Name
        };
        if (validate.source)
          validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
      }
      sch.validate = validate;
      return sch;
    } catch (e) {
      delete sch.validate;
      delete sch.validateName;
      if (sourceCode)
        this.logger.error("Error compiling schema, function code:", sourceCode);
      throw e;
    } finally {
      this._compilations.delete(sch);
    }
  }
  exports.compileSchema = compileSchema;
  function resolveRef(root, baseId, ref) {
    var _a;
    ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
    const schOrFunc = root.refs[ref];
    if (schOrFunc)
      return schOrFunc;
    let _sch = resolve3.call(this, root, ref);
    if (_sch === undefined) {
      const schema = (_a = root.localRefs) === null || _a === undefined ? undefined : _a[ref];
      const { schemaId } = this.opts;
      if (schema)
        _sch = new SchemaEnv({ schema, schemaId, root, baseId });
    }
    if (_sch === undefined)
      return;
    return root.refs[ref] = inlineOrCompile.call(this, _sch);
  }
  exports.resolveRef = resolveRef;
  function inlineOrCompile(sch) {
    if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
      return sch.schema;
    return sch.validate ? sch : compileSchema.call(this, sch);
  }
  function getCompilingSchema(schEnv) {
    for (const sch of this._compilations) {
      if (sameSchemaEnv(sch, schEnv))
        return sch;
    }
  }
  exports.getCompilingSchema = getCompilingSchema;
  function sameSchemaEnv(s1, s2) {
    return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
  }
  function resolve3(root, ref) {
    let sch;
    while (typeof (sch = this.refs[ref]) == "string")
      ref = sch;
    return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
  }
  function resolveSchema(root, ref) {
    const p = this.opts.uriResolver.parse(ref);
    const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
    let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, undefined);
    if (Object.keys(root.schema).length > 0 && refPath === baseId) {
      return getJsonPointer.call(this, p, root);
    }
    const id = (0, resolve_1.normalizeId)(refPath);
    const schOrRef = this.refs[id] || this.schemas[id];
    if (typeof schOrRef == "string") {
      const sch = resolveSchema.call(this, root, schOrRef);
      if (typeof (sch === null || sch === undefined ? undefined : sch.schema) !== "object")
        return;
      return getJsonPointer.call(this, p, sch);
    }
    if (typeof (schOrRef === null || schOrRef === undefined ? undefined : schOrRef.schema) !== "object")
      return;
    if (!schOrRef.validate)
      compileSchema.call(this, schOrRef);
    if (id === (0, resolve_1.normalizeId)(ref)) {
      const { schema } = schOrRef;
      const { schemaId } = this.opts;
      const schId = schema[schemaId];
      if (schId)
        baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
      return new SchemaEnv({ schema, schemaId, root, baseId });
    }
    return getJsonPointer.call(this, p, schOrRef);
  }
  exports.resolveSchema = resolveSchema;
  var PREVENT_SCOPE_CHANGE = new Set([
    "properties",
    "patternProperties",
    "enum",
    "dependencies",
    "definitions"
  ]);
  function getJsonPointer(parsedRef, { baseId, schema, root }) {
    var _a;
    if (((_a = parsedRef.fragment) === null || _a === undefined ? undefined : _a[0]) !== "/")
      return;
    for (const part of parsedRef.fragment.slice(1).split("/")) {
      if (typeof schema === "boolean")
        return;
      const partSchema = schema[(0, util_1.unescapeFragment)(part)];
      if (partSchema === undefined)
        return;
      schema = partSchema;
      const schId = typeof schema === "object" && schema[this.opts.schemaId];
      if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
        baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
      }
    }
    let env;
    if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
      const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
      env = resolveSchema.call(this, root, $ref);
    }
    const { schemaId } = this.opts;
    env = env || new SchemaEnv({ schema, schemaId, root, baseId });
    if (env.schema !== env.root.schema)
      return env;
    return;
  }
});

// node_modules/ajv/dist/refs/data.json
var require_data = __commonJS((exports, module) => {
  module.exports = {
    $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
    description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
    type: "object",
    required: ["$data"],
    properties: {
      $data: {
        type: "string",
        anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
      }
    },
    additionalProperties: false
  };
});

// node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS((exports, module) => {
  var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
  var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
  function stringArrayToHexStripped(input) {
    let acc = "";
    let code = 0;
    let i = 0;
    for (i = 0;i < input.length; i++) {
      code = input[i].charCodeAt(0);
      if (code === 48) {
        continue;
      }
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
        return "";
      }
      acc += input[i];
      break;
    }
    for (i += 1;i < input.length; i++) {
      code = input[i].charCodeAt(0);
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
        return "";
      }
      acc += input[i];
    }
    return acc;
  }
  var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
  function consumeIsZone(buffer) {
    buffer.length = 0;
    return true;
  }
  function consumeHextets(buffer, address, output) {
    if (buffer.length) {
      const hex = stringArrayToHexStripped(buffer);
      if (hex !== "") {
        address.push(hex);
      } else {
        output.error = true;
        return false;
      }
      buffer.length = 0;
    }
    return true;
  }
  function getIPV6(input) {
    let tokenCount = 0;
    const output = { error: false, address: "", zone: "" };
    const address = [];
    const buffer = [];
    let endipv6Encountered = false;
    let endIpv6 = false;
    let consume = consumeHextets;
    for (let i = 0;i < input.length; i++) {
      const cursor = input[i];
      if (cursor === "[" || cursor === "]") {
        continue;
      }
      if (cursor === ":") {
        if (endipv6Encountered === true) {
          endIpv6 = true;
        }
        if (!consume(buffer, address, output)) {
          break;
        }
        if (++tokenCount > 7) {
          output.error = true;
          break;
        }
        if (i > 0 && input[i - 1] === ":") {
          endipv6Encountered = true;
        }
        address.push(":");
        continue;
      } else if (cursor === "%") {
        if (!consume(buffer, address, output)) {
          break;
        }
        consume = consumeIsZone;
      } else {
        buffer.push(cursor);
        continue;
      }
    }
    if (buffer.length) {
      if (consume === consumeIsZone) {
        output.zone = buffer.join("");
      } else if (endIpv6) {
        address.push(buffer.join(""));
      } else {
        address.push(stringArrayToHexStripped(buffer));
      }
    }
    output.address = address.join("");
    return output;
  }
  function normalizeIPv6(host) {
    if (findToken(host, ":") < 2) {
      return { host, isIPV6: false };
    }
    const ipv6 = getIPV6(host);
    if (!ipv6.error) {
      let newHost = ipv6.address;
      let escapedHost = ipv6.address;
      if (ipv6.zone) {
        newHost += "%" + ipv6.zone;
        escapedHost += "%25" + ipv6.zone;
      }
      return { host: newHost, isIPV6: true, escapedHost };
    } else {
      return { host, isIPV6: false };
    }
  }
  function findToken(str, token) {
    let ind = 0;
    for (let i = 0;i < str.length; i++) {
      if (str[i] === token)
        ind++;
    }
    return ind;
  }
  function removeDotSegments(path2) {
    let input = path2;
    const output = [];
    let nextSlash = -1;
    let len = 0;
    while (len = input.length) {
      if (len === 1) {
        if (input === ".") {
          break;
        } else if (input === "/") {
          output.push("/");
          break;
        } else {
          output.push(input);
          break;
        }
      } else if (len === 2) {
        if (input[0] === ".") {
          if (input[1] === ".") {
            break;
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === "." || input[1] === "/") {
            output.push("/");
            break;
          }
        }
      } else if (len === 3) {
        if (input === "/..") {
          if (output.length !== 0) {
            output.pop();
          }
          output.push("/");
          break;
        }
      }
      if (input[0] === ".") {
        if (input[1] === ".") {
          if (input[2] === "/") {
            input = input.slice(3);
            continue;
          }
        } else if (input[1] === "/") {
          input = input.slice(2);
          continue;
        }
      } else if (input[0] === "/") {
        if (input[1] === ".") {
          if (input[2] === "/") {
            input = input.slice(2);
            continue;
          } else if (input[2] === ".") {
            if (input[3] === "/") {
              input = input.slice(3);
              if (output.length !== 0) {
                output.pop();
              }
              continue;
            }
          }
        }
      }
      if ((nextSlash = input.indexOf("/", 1)) === -1) {
        output.push(input);
        break;
      } else {
        output.push(input.slice(0, nextSlash));
        input = input.slice(nextSlash);
      }
    }
    return output.join("");
  }
  function normalizeComponentEncoding(component, esc) {
    const func = esc !== true ? escape : unescape;
    if (component.scheme !== undefined) {
      component.scheme = func(component.scheme);
    }
    if (component.userinfo !== undefined) {
      component.userinfo = func(component.userinfo);
    }
    if (component.host !== undefined) {
      component.host = func(component.host);
    }
    if (component.path !== undefined) {
      component.path = func(component.path);
    }
    if (component.query !== undefined) {
      component.query = func(component.query);
    }
    if (component.fragment !== undefined) {
      component.fragment = func(component.fragment);
    }
    return component;
  }
  function recomposeAuthority(component) {
    const uriTokens = [];
    if (component.userinfo !== undefined) {
      uriTokens.push(component.userinfo);
      uriTokens.push("@");
    }
    if (component.host !== undefined) {
      let host = unescape(component.host);
      if (!isIPv4(host)) {
        const ipV6res = normalizeIPv6(host);
        if (ipV6res.isIPV6 === true) {
          host = `[${ipV6res.escapedHost}]`;
        } else {
          host = component.host;
        }
      }
      uriTokens.push(host);
    }
    if (typeof component.port === "number" || typeof component.port === "string") {
      uriTokens.push(":");
      uriTokens.push(String(component.port));
    }
    return uriTokens.length ? uriTokens.join("") : undefined;
  }
  module.exports = {
    nonSimpleDomain,
    recomposeAuthority,
    normalizeComponentEncoding,
    removeDotSegments,
    isIPv4,
    isUUID,
    normalizeIPv6,
    stringArrayToHexStripped
  };
});

// node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS((exports, module) => {
  var { isUUID } = require_utils();
  var URN_REG = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
  var supportedSchemeNames = [
    "http",
    "https",
    "ws",
    "wss",
    "urn",
    "urn:uuid"
  ];
  function isValidSchemeName(name) {
    return supportedSchemeNames.indexOf(name) !== -1;
  }
  function wsIsSecure(wsComponent) {
    if (wsComponent.secure === true) {
      return true;
    } else if (wsComponent.secure === false) {
      return false;
    } else if (wsComponent.scheme) {
      return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
    } else {
      return false;
    }
  }
  function httpParse(component) {
    if (!component.host) {
      component.error = component.error || "HTTP URIs must have a host.";
    }
    return component;
  }
  function httpSerialize(component) {
    const secure = String(component.scheme).toLowerCase() === "https";
    if (component.port === (secure ? 443 : 80) || component.port === "") {
      component.port = undefined;
    }
    if (!component.path) {
      component.path = "/";
    }
    return component;
  }
  function wsParse(wsComponent) {
    wsComponent.secure = wsIsSecure(wsComponent);
    wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
    wsComponent.path = undefined;
    wsComponent.query = undefined;
    return wsComponent;
  }
  function wsSerialize(wsComponent) {
    if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
      wsComponent.port = undefined;
    }
    if (typeof wsComponent.secure === "boolean") {
      wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
      wsComponent.secure = undefined;
    }
    if (wsComponent.resourceName) {
      const [path2, query] = wsComponent.resourceName.split("?");
      wsComponent.path = path2 && path2 !== "/" ? path2 : undefined;
      wsComponent.query = query;
      wsComponent.resourceName = undefined;
    }
    wsComponent.fragment = undefined;
    return wsComponent;
  }
  function urnParse(urnComponent, options) {
    if (!urnComponent.path) {
      urnComponent.error = "URN can not be parsed";
      return urnComponent;
    }
    const matches = urnComponent.path.match(URN_REG);
    if (matches) {
      const scheme = options.scheme || urnComponent.scheme || "urn";
      urnComponent.nid = matches[1].toLowerCase();
      urnComponent.nss = matches[2];
      const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      urnComponent.path = undefined;
      if (schemeHandler) {
        urnComponent = schemeHandler.parse(urnComponent, options);
      }
    } else {
      urnComponent.error = urnComponent.error || "URN can not be parsed.";
    }
    return urnComponent;
  }
  function urnSerialize(urnComponent, options) {
    if (urnComponent.nid === undefined) {
      throw new Error("URN without nid cannot be serialized");
    }
    const scheme = options.scheme || urnComponent.scheme || "urn";
    const nid = urnComponent.nid.toLowerCase();
    const urnScheme = `${scheme}:${options.nid || nid}`;
    const schemeHandler = getSchemeHandler(urnScheme);
    if (schemeHandler) {
      urnComponent = schemeHandler.serialize(urnComponent, options);
    }
    const uriComponent = urnComponent;
    const nss = urnComponent.nss;
    uriComponent.path = `${nid || options.nid}:${nss}`;
    options.skipEscape = true;
    return uriComponent;
  }
  function urnuuidParse(urnComponent, options) {
    const uuidComponent = urnComponent;
    uuidComponent.uuid = uuidComponent.nss;
    uuidComponent.nss = undefined;
    if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
      uuidComponent.error = uuidComponent.error || "UUID is not valid.";
    }
    return uuidComponent;
  }
  function urnuuidSerialize(uuidComponent) {
    const urnComponent = uuidComponent;
    urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
    return urnComponent;
  }
  var http = {
    scheme: "http",
    domainHost: true,
    parse: httpParse,
    serialize: httpSerialize
  };
  var https = {
    scheme: "https",
    domainHost: http.domainHost,
    parse: httpParse,
    serialize: httpSerialize
  };
  var ws = {
    scheme: "ws",
    domainHost: true,
    parse: wsParse,
    serialize: wsSerialize
  };
  var wss = {
    scheme: "wss",
    domainHost: ws.domainHost,
    parse: ws.parse,
    serialize: ws.serialize
  };
  var urn = {
    scheme: "urn",
    parse: urnParse,
    serialize: urnSerialize,
    skipNormalize: true
  };
  var urnuuid = {
    scheme: "urn:uuid",
    parse: urnuuidParse,
    serialize: urnuuidSerialize,
    skipNormalize: true
  };
  var SCHEMES = {
    http,
    https,
    ws,
    wss,
    urn,
    "urn:uuid": urnuuid
  };
  Object.setPrototypeOf(SCHEMES, null);
  function getSchemeHandler(scheme) {
    return scheme && (SCHEMES[scheme] || SCHEMES[scheme.toLowerCase()]) || undefined;
  }
  module.exports = {
    wsIsSecure,
    SCHEMES,
    isValidSchemeName,
    getSchemeHandler
  };
});

// node_modules/fast-uri/index.js
var require_fast_uri = __commonJS((exports, module) => {
  var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizeComponentEncoding, isIPv4, nonSimpleDomain } = require_utils();
  var { SCHEMES, getSchemeHandler } = require_schemes();
  function normalize(uri, options) {
    if (typeof uri === "string") {
      uri = serialize(parse(uri, options), options);
    } else if (typeof uri === "object") {
      uri = parse(serialize(uri, options), options);
    }
    return uri;
  }
  function resolve3(baseURI, relativeURI, options) {
    const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
    const resolved = resolveComponent(parse(baseURI, schemelessOptions), parse(relativeURI, schemelessOptions), schemelessOptions, true);
    schemelessOptions.skipEscape = true;
    return serialize(resolved, schemelessOptions);
  }
  function resolveComponent(base, relative, options, skipNormalization) {
    const target = {};
    if (!skipNormalization) {
      base = parse(serialize(base, options), options);
      relative = parse(serialize(relative, options), options);
    }
    options = options || {};
    if (!options.tolerant && relative.scheme) {
      target.scheme = relative.scheme;
      target.userinfo = relative.userinfo;
      target.host = relative.host;
      target.port = relative.port;
      target.path = removeDotSegments(relative.path || "");
      target.query = relative.query;
    } else {
      if (relative.userinfo !== undefined || relative.host !== undefined || relative.port !== undefined) {
        target.userinfo = relative.userinfo;
        target.host = relative.host;
        target.port = relative.port;
        target.path = removeDotSegments(relative.path || "");
        target.query = relative.query;
      } else {
        if (!relative.path) {
          target.path = base.path;
          if (relative.query !== undefined) {
            target.query = relative.query;
          } else {
            target.query = base.query;
          }
        } else {
          if (relative.path[0] === "/") {
            target.path = removeDotSegments(relative.path);
          } else {
            if ((base.userinfo !== undefined || base.host !== undefined || base.port !== undefined) && !base.path) {
              target.path = "/" + relative.path;
            } else if (!base.path) {
              target.path = relative.path;
            } else {
              target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
            }
            target.path = removeDotSegments(target.path);
          }
          target.query = relative.query;
        }
        target.userinfo = base.userinfo;
        target.host = base.host;
        target.port = base.port;
      }
      target.scheme = base.scheme;
    }
    target.fragment = relative.fragment;
    return target;
  }
  function equal(uriA, uriB, options) {
    if (typeof uriA === "string") {
      uriA = unescape(uriA);
      uriA = serialize(normalizeComponentEncoding(parse(uriA, options), true), { ...options, skipEscape: true });
    } else if (typeof uriA === "object") {
      uriA = serialize(normalizeComponentEncoding(uriA, true), { ...options, skipEscape: true });
    }
    if (typeof uriB === "string") {
      uriB = unescape(uriB);
      uriB = serialize(normalizeComponentEncoding(parse(uriB, options), true), { ...options, skipEscape: true });
    } else if (typeof uriB === "object") {
      uriB = serialize(normalizeComponentEncoding(uriB, true), { ...options, skipEscape: true });
    }
    return uriA.toLowerCase() === uriB.toLowerCase();
  }
  function serialize(cmpts, opts) {
    const component = {
      host: cmpts.host,
      scheme: cmpts.scheme,
      userinfo: cmpts.userinfo,
      port: cmpts.port,
      path: cmpts.path,
      query: cmpts.query,
      nid: cmpts.nid,
      nss: cmpts.nss,
      uuid: cmpts.uuid,
      fragment: cmpts.fragment,
      reference: cmpts.reference,
      resourceName: cmpts.resourceName,
      secure: cmpts.secure,
      error: ""
    };
    const options = Object.assign({}, opts);
    const uriTokens = [];
    const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
    if (schemeHandler && schemeHandler.serialize)
      schemeHandler.serialize(component, options);
    if (component.path !== undefined) {
      if (!options.skipEscape) {
        component.path = escape(component.path);
        if (component.scheme !== undefined) {
          component.path = component.path.split("%3A").join(":");
        }
      } else {
        component.path = unescape(component.path);
      }
    }
    if (options.reference !== "suffix" && component.scheme) {
      uriTokens.push(component.scheme, ":");
    }
    const authority = recomposeAuthority(component);
    if (authority !== undefined) {
      if (options.reference !== "suffix") {
        uriTokens.push("//");
      }
      uriTokens.push(authority);
      if (component.path && component.path[0] !== "/") {
        uriTokens.push("/");
      }
    }
    if (component.path !== undefined) {
      let s = component.path;
      if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
        s = removeDotSegments(s);
      }
      if (authority === undefined && s[0] === "/" && s[1] === "/") {
        s = "/%2F" + s.slice(2);
      }
      uriTokens.push(s);
    }
    if (component.query !== undefined) {
      uriTokens.push("?", component.query);
    }
    if (component.fragment !== undefined) {
      uriTokens.push("#", component.fragment);
    }
    return uriTokens.join("");
  }
  var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
  function parse(uri, opts) {
    const options = Object.assign({}, opts);
    const parsed = {
      scheme: undefined,
      userinfo: undefined,
      host: "",
      port: undefined,
      path: "",
      query: undefined,
      fragment: undefined
    };
    let isIP = false;
    if (options.reference === "suffix") {
      if (options.scheme) {
        uri = options.scheme + ":" + uri;
      } else {
        uri = "//" + uri;
      }
    }
    const matches = uri.match(URI_PARSE);
    if (matches) {
      parsed.scheme = matches[1];
      parsed.userinfo = matches[3];
      parsed.host = matches[4];
      parsed.port = parseInt(matches[5], 10);
      parsed.path = matches[6] || "";
      parsed.query = matches[7];
      parsed.fragment = matches[8];
      if (isNaN(parsed.port)) {
        parsed.port = matches[5];
      }
      if (parsed.host) {
        const ipv4result = isIPv4(parsed.host);
        if (ipv4result === false) {
          const ipv6result = normalizeIPv6(parsed.host);
          parsed.host = ipv6result.host.toLowerCase();
          isIP = ipv6result.isIPV6;
        } else {
          isIP = true;
        }
      }
      if (parsed.scheme === undefined && parsed.userinfo === undefined && parsed.host === undefined && parsed.port === undefined && parsed.query === undefined && !parsed.path) {
        parsed.reference = "same-document";
      } else if (parsed.scheme === undefined) {
        parsed.reference = "relative";
      } else if (parsed.fragment === undefined) {
        parsed.reference = "absolute";
      } else {
        parsed.reference = "uri";
      }
      if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
        parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
      }
      const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
      if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
        if (parsed.host && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
          try {
            parsed.host = URL.domainToASCII(parsed.host.toLowerCase());
          } catch (e) {
            parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
          }
        }
      }
      if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
        if (uri.indexOf("%") !== -1) {
          if (parsed.scheme !== undefined) {
            parsed.scheme = unescape(parsed.scheme);
          }
          if (parsed.host !== undefined) {
            parsed.host = unescape(parsed.host);
          }
        }
        if (parsed.path) {
          parsed.path = escape(unescape(parsed.path));
        }
        if (parsed.fragment) {
          parsed.fragment = encodeURI(decodeURIComponent(parsed.fragment));
        }
      }
      if (schemeHandler && schemeHandler.parse) {
        schemeHandler.parse(parsed, options);
      }
    } else {
      parsed.error = parsed.error || "URI can not be parsed.";
    }
    return parsed;
  }
  var fastUri = {
    SCHEMES,
    normalize,
    resolve: resolve3,
    resolveComponent,
    equal,
    serialize,
    parse
  };
  module.exports = fastUri;
  module.exports.default = fastUri;
  module.exports.fastUri = fastUri;
});

// node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var uri = require_fast_uri();
  uri.code = 'require("ajv/dist/runtime/uri").default';
  exports.default = uri;
});

// node_modules/ajv/dist/core.js
var require_core = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = undefined;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  var ref_error_1 = require_ref_error();
  var rules_1 = require_rules();
  var compile_1 = require_compile();
  var codegen_2 = require_codegen();
  var resolve_1 = require_resolve();
  var dataType_1 = require_dataType();
  var util_1 = require_util();
  var $dataRefSchema = require_data();
  var uri_1 = require_uri();
  var defaultRegExp = (str, flags) => new RegExp(str, flags);
  defaultRegExp.code = "new RegExp";
  var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
  var EXT_SCOPE_NAMES = new Set([
    "validate",
    "serialize",
    "parse",
    "wrapper",
    "root",
    "schema",
    "keyword",
    "pattern",
    "formats",
    "validate$data",
    "func",
    "obj",
    "Error"
  ]);
  var removedOptions = {
    errorDataPath: "",
    format: "`validateFormats: false` can be used instead.",
    nullable: '"nullable" keyword is supported by default.',
    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
    sourceCode: "Use option `code: {source: true}`",
    strictDefaults: "It is default now, see option `strict`.",
    strictKeywords: "It is default now, see option `strict`.",
    uniqueItems: '"uniqueItems" keyword is always validated.',
    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
    cache: "Map is used as cache, schema object as key.",
    serialize: "Map is used as cache, schema object as key.",
    ajvErrors: "It is default now."
  };
  var deprecatedOptions = {
    ignoreKeywordsWithRef: "",
    jsPropertySyntax: "",
    unicode: '"minLength"/"maxLength" account for unicode characters by default.'
  };
  var MAX_EXPRESSION = 200;
  function requiredOptions(o) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
    const s = o.strict;
    const _optz = (_a = o.code) === null || _a === undefined ? undefined : _a.optimize;
    const optimize = _optz === true || _optz === undefined ? 1 : _optz || 0;
    const regExp = (_c = (_b = o.code) === null || _b === undefined ? undefined : _b.regExp) !== null && _c !== undefined ? _c : defaultRegExp;
    const uriResolver = (_d = o.uriResolver) !== null && _d !== undefined ? _d : uri_1.default;
    return {
      strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== undefined ? _e : s) !== null && _f !== undefined ? _f : true,
      strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== undefined ? _g : s) !== null && _h !== undefined ? _h : true,
      strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== undefined ? _j : s) !== null && _k !== undefined ? _k : "log",
      strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== undefined ? _l : s) !== null && _m !== undefined ? _m : "log",
      strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== undefined ? _o : s) !== null && _p !== undefined ? _p : false,
      code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
      loopRequired: (_q = o.loopRequired) !== null && _q !== undefined ? _q : MAX_EXPRESSION,
      loopEnum: (_r = o.loopEnum) !== null && _r !== undefined ? _r : MAX_EXPRESSION,
      meta: (_s = o.meta) !== null && _s !== undefined ? _s : true,
      messages: (_t = o.messages) !== null && _t !== undefined ? _t : true,
      inlineRefs: (_u = o.inlineRefs) !== null && _u !== undefined ? _u : true,
      schemaId: (_v = o.schemaId) !== null && _v !== undefined ? _v : "$id",
      addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== undefined ? _w : true,
      validateSchema: (_x = o.validateSchema) !== null && _x !== undefined ? _x : true,
      validateFormats: (_y = o.validateFormats) !== null && _y !== undefined ? _y : true,
      unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== undefined ? _z : true,
      int32range: (_0 = o.int32range) !== null && _0 !== undefined ? _0 : true,
      uriResolver
    };
  }

  class Ajv {
    constructor(opts = {}) {
      this.schemas = {};
      this.refs = {};
      this.formats = {};
      this._compilations = new Set;
      this._loading = {};
      this._cache = new Map;
      opts = this.opts = { ...opts, ...requiredOptions(opts) };
      const { es5, lines } = this.opts.code;
      this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
      this.logger = getLogger(opts.logger);
      const formatOpt = opts.validateFormats;
      opts.validateFormats = false;
      this.RULES = (0, rules_1.getRules)();
      checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
      checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
      this._metaOpts = getMetaSchemaOptions.call(this);
      if (opts.formats)
        addInitialFormats.call(this);
      this._addVocabularies();
      this._addDefaultMetaSchema();
      if (opts.keywords)
        addInitialKeywords.call(this, opts.keywords);
      if (typeof opts.meta == "object")
        this.addMetaSchema(opts.meta);
      addInitialSchemas.call(this);
      opts.validateFormats = formatOpt;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data, meta, schemaId } = this.opts;
      let _dataRefSchema = $dataRefSchema;
      if (schemaId === "id") {
        _dataRefSchema = { ...$dataRefSchema };
        _dataRefSchema.id = _dataRefSchema.$id;
        delete _dataRefSchema.$id;
      }
      if (meta && $data)
        this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
    }
    defaultMeta() {
      const { meta, schemaId } = this.opts;
      return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : undefined;
    }
    validate(schemaKeyRef, data) {
      let v;
      if (typeof schemaKeyRef == "string") {
        v = this.getSchema(schemaKeyRef);
        if (!v)
          throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
      } else {
        v = this.compile(schemaKeyRef);
      }
      const valid = v(data);
      if (!("$async" in v))
        this.errors = v.errors;
      return valid;
    }
    compile(schema, _meta) {
      const sch = this._addSchema(schema, _meta);
      return sch.validate || this._compileSchemaEnv(sch);
    }
    compileAsync(schema, meta) {
      if (typeof this.opts.loadSchema != "function") {
        throw new Error("options.loadSchema should be a function");
      }
      const { loadSchema } = this.opts;
      return runCompileAsync.call(this, schema, meta);
      async function runCompileAsync(_schema, _meta) {
        await loadMetaSchema.call(this, _schema.$schema);
        const sch = this._addSchema(_schema, _meta);
        return sch.validate || _compileAsync.call(this, sch);
      }
      async function loadMetaSchema($ref) {
        if ($ref && !this.getSchema($ref)) {
          await runCompileAsync.call(this, { $ref }, true);
        }
      }
      async function _compileAsync(sch) {
        try {
          return this._compileSchemaEnv(sch);
        } catch (e) {
          if (!(e instanceof ref_error_1.default))
            throw e;
          checkLoaded.call(this, e);
          await loadMissingSchema.call(this, e.missingSchema);
          return _compileAsync.call(this, sch);
        }
      }
      function checkLoaded({ missingSchema: ref, missingRef }) {
        if (this.refs[ref]) {
          throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
        }
      }
      async function loadMissingSchema(ref) {
        const _schema = await _loadSchema.call(this, ref);
        if (!this.refs[ref])
          await loadMetaSchema.call(this, _schema.$schema);
        if (!this.refs[ref])
          this.addSchema(_schema, ref, meta);
      }
      async function _loadSchema(ref) {
        const p = this._loading[ref];
        if (p)
          return p;
        try {
          return await (this._loading[ref] = loadSchema(ref));
        } finally {
          delete this._loading[ref];
        }
      }
    }
    addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
      if (Array.isArray(schema)) {
        for (const sch of schema)
          this.addSchema(sch, undefined, _meta, _validateSchema);
        return this;
      }
      let id;
      if (typeof schema === "object") {
        const { schemaId } = this.opts;
        id = schema[schemaId];
        if (id !== undefined && typeof id != "string") {
          throw new Error(`schema ${schemaId} must be string`);
        }
      }
      key = (0, resolve_1.normalizeId)(key || id);
      this._checkUnique(key);
      this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
      return this;
    }
    addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
      this.addSchema(schema, key, true, _validateSchema);
      return this;
    }
    validateSchema(schema, throwOrLogError) {
      if (typeof schema == "boolean")
        return true;
      let $schema;
      $schema = schema.$schema;
      if ($schema !== undefined && typeof $schema != "string") {
        throw new Error("$schema must be a string");
      }
      $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
      if (!$schema) {
        this.logger.warn("meta-schema not available");
        this.errors = null;
        return true;
      }
      const valid = this.validate($schema, schema);
      if (!valid && throwOrLogError) {
        const message = "schema is invalid: " + this.errorsText();
        if (this.opts.validateSchema === "log")
          this.logger.error(message);
        else
          throw new Error(message);
      }
      return valid;
    }
    getSchema(keyRef) {
      let sch;
      while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
        keyRef = sch;
      if (sch === undefined) {
        const { schemaId } = this.opts;
        const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
        sch = compile_1.resolveSchema.call(this, root, keyRef);
        if (!sch)
          return;
        this.refs[keyRef] = sch;
      }
      return sch.validate || this._compileSchemaEnv(sch);
    }
    removeSchema(schemaKeyRef) {
      if (schemaKeyRef instanceof RegExp) {
        this._removeAllSchemas(this.schemas, schemaKeyRef);
        this._removeAllSchemas(this.refs, schemaKeyRef);
        return this;
      }
      switch (typeof schemaKeyRef) {
        case "undefined":
          this._removeAllSchemas(this.schemas);
          this._removeAllSchemas(this.refs);
          this._cache.clear();
          return this;
        case "string": {
          const sch = getSchEnv.call(this, schemaKeyRef);
          if (typeof sch == "object")
            this._cache.delete(sch.schema);
          delete this.schemas[schemaKeyRef];
          delete this.refs[schemaKeyRef];
          return this;
        }
        case "object": {
          const cacheKey = schemaKeyRef;
          this._cache.delete(cacheKey);
          let id = schemaKeyRef[this.opts.schemaId];
          if (id) {
            id = (0, resolve_1.normalizeId)(id);
            delete this.schemas[id];
            delete this.refs[id];
          }
          return this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    addVocabulary(definitions) {
      for (const def of definitions)
        this.addKeyword(def);
      return this;
    }
    addKeyword(kwdOrDef, def) {
      let keyword;
      if (typeof kwdOrDef == "string") {
        keyword = kwdOrDef;
        if (typeof def == "object") {
          this.logger.warn("these parameters are deprecated, see docs for addKeyword");
          def.keyword = keyword;
        }
      } else if (typeof kwdOrDef == "object" && def === undefined) {
        def = kwdOrDef;
        keyword = def.keyword;
        if (Array.isArray(keyword) && !keyword.length) {
          throw new Error("addKeywords: keyword must be string or non-empty array");
        }
      } else {
        throw new Error("invalid addKeywords parameters");
      }
      checkKeyword.call(this, keyword, def);
      if (!def) {
        (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
        return this;
      }
      keywordMetaschema.call(this, def);
      const definition = {
        ...def,
        type: (0, dataType_1.getJSONTypes)(def.type),
        schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
      };
      (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
      return this;
    }
    getKeyword(keyword) {
      const rule = this.RULES.all[keyword];
      return typeof rule == "object" ? rule.definition : !!rule;
    }
    removeKeyword(keyword) {
      const { RULES } = this;
      delete RULES.keywords[keyword];
      delete RULES.all[keyword];
      for (const group of RULES.rules) {
        const i = group.rules.findIndex((rule) => rule.keyword === keyword);
        if (i >= 0)
          group.rules.splice(i, 1);
      }
      return this;
    }
    addFormat(name, format) {
      if (typeof format == "string")
        format = new RegExp(format);
      this.formats[name] = format;
      return this;
    }
    errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
      if (!errors || errors.length === 0)
        return "No errors";
      return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
    }
    $dataMetaSchema(metaSchema, keywordsJsonPointers) {
      const rules = this.RULES.all;
      metaSchema = JSON.parse(JSON.stringify(metaSchema));
      for (const jsonPointer of keywordsJsonPointers) {
        const segments = jsonPointer.split("/").slice(1);
        let keywords = metaSchema;
        for (const seg of segments)
          keywords = keywords[seg];
        for (const key in rules) {
          const rule = rules[key];
          if (typeof rule != "object")
            continue;
          const { $data } = rule.definition;
          const schema = keywords[key];
          if ($data && schema)
            keywords[key] = schemaOrData(schema);
        }
      }
      return metaSchema;
    }
    _removeAllSchemas(schemas, regex2) {
      for (const keyRef in schemas) {
        const sch = schemas[keyRef];
        if (!regex2 || regex2.test(keyRef)) {
          if (typeof sch == "string") {
            delete schemas[keyRef];
          } else if (sch && !sch.meta) {
            this._cache.delete(sch.schema);
            delete schemas[keyRef];
          }
        }
      }
    }
    _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
      let id;
      const { schemaId } = this.opts;
      if (typeof schema == "object") {
        id = schema[schemaId];
      } else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        else if (typeof schema != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let sch = this._cache.get(schema);
      if (sch !== undefined)
        return sch;
      baseId = (0, resolve_1.normalizeId)(id || baseId);
      const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
      sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
      this._cache.set(sch.schema, sch);
      if (addSchema && !baseId.startsWith("#")) {
        if (baseId)
          this._checkUnique(baseId);
        this.refs[baseId] = sch;
      }
      if (validateSchema)
        this.validateSchema(schema, true);
      return sch;
    }
    _checkUnique(id) {
      if (this.schemas[id] || this.refs[id]) {
        throw new Error(`schema with key or id "${id}" already exists`);
      }
    }
    _compileSchemaEnv(sch) {
      if (sch.meta)
        this._compileMetaSchema(sch);
      else
        compile_1.compileSchema.call(this, sch);
      if (!sch.validate)
        throw new Error("ajv implementation error");
      return sch.validate;
    }
    _compileMetaSchema(sch) {
      const currentOpts = this.opts;
      this.opts = this._metaOpts;
      try {
        compile_1.compileSchema.call(this, sch);
      } finally {
        this.opts = currentOpts;
      }
    }
  }
  Ajv.ValidationError = validation_error_1.default;
  Ajv.MissingRefError = ref_error_1.default;
  exports.default = Ajv;
  function checkOptions(checkOpts, options, msg, log13 = "error") {
    for (const key in checkOpts) {
      const opt = key;
      if (opt in options)
        this.logger[log13](`${msg}: option ${key}. ${checkOpts[opt]}`);
    }
  }
  function getSchEnv(keyRef) {
    keyRef = (0, resolve_1.normalizeId)(keyRef);
    return this.schemas[keyRef] || this.refs[keyRef];
  }
  function addInitialSchemas() {
    const optsSchemas = this.opts.schemas;
    if (!optsSchemas)
      return;
    if (Array.isArray(optsSchemas))
      this.addSchema(optsSchemas);
    else
      for (const key in optsSchemas)
        this.addSchema(optsSchemas[key], key);
  }
  function addInitialFormats() {
    for (const name in this.opts.formats) {
      const format = this.opts.formats[name];
      if (format)
        this.addFormat(name, format);
    }
  }
  function addInitialKeywords(defs) {
    if (Array.isArray(defs)) {
      this.addVocabulary(defs);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const keyword in defs) {
      const def = defs[keyword];
      if (!def.keyword)
        def.keyword = keyword;
      this.addKeyword(def);
    }
  }
  function getMetaSchemaOptions() {
    const metaOpts = { ...this.opts };
    for (const opt of META_IGNORE_OPTIONS)
      delete metaOpts[opt];
    return metaOpts;
  }
  var noLogs = { log() {}, warn() {}, error() {} };
  function getLogger(logger) {
    if (logger === false)
      return noLogs;
    if (logger === undefined)
      return console;
    if (logger.log && logger.warn && logger.error)
      return logger;
    throw new Error("logger must implement log, warn and error methods");
  }
  var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
  function checkKeyword(keyword, def) {
    const { RULES } = this;
    (0, util_1.eachItem)(keyword, (kwd) => {
      if (RULES.keywords[kwd])
        throw new Error(`Keyword ${kwd} is already defined`);
      if (!KEYWORD_NAME.test(kwd))
        throw new Error(`Keyword ${kwd} has invalid name`);
    });
    if (!def)
      return;
    if (def.$data && !(("code" in def) || ("validate" in def))) {
      throw new Error('$data keyword must have "code" or "validate" function');
    }
  }
  function addRule(keyword, definition, dataType) {
    var _a;
    const post = definition === null || definition === undefined ? undefined : definition.post;
    if (dataType && post)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES } = this;
    let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
    if (!ruleGroup) {
      ruleGroup = { type: dataType, rules: [] };
      RULES.rules.push(ruleGroup);
    }
    RULES.keywords[keyword] = true;
    if (!definition)
      return;
    const rule = {
      keyword,
      definition: {
        ...definition,
        type: (0, dataType_1.getJSONTypes)(definition.type),
        schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
      }
    };
    if (definition.before)
      addBeforeRule.call(this, ruleGroup, rule, definition.before);
    else
      ruleGroup.rules.push(rule);
    RULES.all[keyword] = rule;
    (_a = definition.implements) === null || _a === undefined || _a.forEach((kwd) => this.addKeyword(kwd));
  }
  function addBeforeRule(ruleGroup, rule, before) {
    const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
    if (i >= 0) {
      ruleGroup.rules.splice(i, 0, rule);
    } else {
      ruleGroup.rules.push(rule);
      this.logger.warn(`rule ${before} is not defined`);
    }
  }
  function keywordMetaschema(def) {
    let { metaSchema } = def;
    if (metaSchema === undefined)
      return;
    if (def.$data && this.opts.$data)
      metaSchema = schemaOrData(metaSchema);
    def.validateSchema = this.compile(metaSchema, true);
  }
  var $dataRef = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function schemaOrData(schema) {
    return { anyOf: [schema, $dataRef] };
  }
});

// node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var def = {
    keyword: "id",
    code() {
      throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.callRef = exports.getValidate = undefined;
  var ref_error_1 = require_ref_error();
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var compile_1 = require_compile();
  var util_1 = require_util();
  var def = {
    keyword: "$ref",
    schemaType: "string",
    code(cxt) {
      const { gen, schema: $ref, it } = cxt;
      const { baseId, schemaEnv: env, validateName, opts, self } = it;
      const { root } = env;
      if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
        return callRootRef();
      const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
      if (schOrEnv === undefined)
        throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
      if (schOrEnv instanceof compile_1.SchemaEnv)
        return callValidate(schOrEnv);
      return inlineRefSchema(schOrEnv);
      function callRootRef() {
        if (env === root)
          return callRef(cxt, validateName, env, env.$async);
        const rootName = gen.scopeValue("root", { ref: root });
        return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
      }
      function callValidate(sch) {
        const v = getValidate(cxt, sch);
        callRef(cxt, v, sch, sch.$async);
      }
      function inlineRefSchema(sch) {
        const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
        const valid = gen.name("valid");
        const schCxt = cxt.subschema({
          schema: sch,
          dataTypes: [],
          schemaPath: codegen_1.nil,
          topSchemaRef: schName,
          errSchemaPath: $ref
        }, valid);
        cxt.mergeEvaluated(schCxt);
        cxt.ok(valid);
      }
    }
  };
  function getValidate(cxt, sch) {
    const { gen } = cxt;
    return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
  }
  exports.getValidate = getValidate;
  function callRef(cxt, v, sch, $async) {
    const { gen, it } = cxt;
    const { allErrors, schemaEnv: env, opts } = it;
    const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
    if ($async)
      callAsyncRef();
    else
      callSyncRef();
    function callAsyncRef() {
      if (!env.$async)
        throw new Error("async schema referenced by sync schema");
      const valid = gen.let("valid");
      gen.try(() => {
        gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
        addEvaluatedFrom(v);
        if (!allErrors)
          gen.assign(valid, true);
      }, (e) => {
        gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
        addErrorsFrom(e);
        if (!allErrors)
          gen.assign(valid, false);
      });
      cxt.ok(valid);
    }
    function callSyncRef() {
      cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
    }
    function addErrorsFrom(source) {
      const errs = (0, codegen_1._)`${source}.errors`;
      gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
      gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
    }
    function addEvaluatedFrom(source) {
      var _a;
      if (!it.opts.unevaluated)
        return;
      const schEvaluated = (_a = sch === null || sch === undefined ? undefined : sch.validate) === null || _a === undefined ? undefined : _a.evaluated;
      if (it.props !== true) {
        if (schEvaluated && !schEvaluated.dynamicProps) {
          if (schEvaluated.props !== undefined) {
            it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
          }
        } else {
          const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
          it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
        }
      }
      if (it.items !== true) {
        if (schEvaluated && !schEvaluated.dynamicItems) {
          if (schEvaluated.items !== undefined) {
            it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
          }
        } else {
          const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
          it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
        }
      }
    }
  }
  exports.callRef = callRef;
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var id_1 = require_id();
  var ref_1 = require_ref();
  var core = [
    "$schema",
    "$id",
    "$defs",
    "$vocabulary",
    { keyword: "$comment" },
    "definitions",
    id_1.default,
    ref_1.default
  ];
  exports.default = core;
});

// node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var ops = codegen_1.operators;
  var KWDs = {
    maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
  };
  var error = {
    message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
  };
  var def = {
    keyword: Object.keys(KWDs),
    type: "number",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
    params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
  };
  var def = {
    keyword: "multipleOf",
    type: "number",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, schemaCode, it } = cxt;
      const prec = it.opts.multipleOfPrecision;
      const res = gen.let("res");
      const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
      cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  function ucs2length(str) {
    const len = str.length;
    let length = 0;
    let pos = 0;
    let value;
    while (pos < len) {
      length++;
      value = str.charCodeAt(pos++);
      if (value >= 55296 && value <= 56319 && pos < len) {
        value = str.charCodeAt(pos);
        if ((value & 64512) === 56320)
          pos++;
      }
    }
    return length;
  }
  exports.default = ucs2length;
  ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
});

// node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var ucs2length_1 = require_ucs2length();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxLength" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxLength", "minLength"],
    type: "string",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode, it } = cxt;
      const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
      const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
      cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var util_1 = require_util();
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
    params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
  };
  var def = {
    keyword: "pattern",
    type: "string",
    schemaType: "string",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      const u = it.opts.unicodeRegExp ? "u" : "";
      if ($data) {
        const { regExp } = it.opts.code;
        const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
        const valid = gen.let("valid");
        gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
        cxt.fail$data((0, codegen_1._)`!${valid}`);
      } else {
        const regExp = (0, code_1.usePattern)(cxt, schema);
        cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxProperties" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxProperties", "minProperties"],
    type: "object",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
      cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
    params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
  };
  var def = {
    keyword: "required",
    type: "object",
    schemaType: "array",
    $data: true,
    error,
    code(cxt) {
      const { gen, schema, schemaCode, data, $data, it } = cxt;
      const { opts } = it;
      if (!$data && schema.length === 0)
        return;
      const useLoop = schema.length >= opts.loopRequired;
      if (it.allErrors)
        allErrorsMode();
      else
        exitOnErrorMode();
      if (opts.strictRequired) {
        const props = cxt.parentSchema.properties;
        const { definedProperties } = cxt.it;
        for (const requiredKey of schema) {
          if ((props === null || props === undefined ? undefined : props[requiredKey]) === undefined && !definedProperties.has(requiredKey)) {
            const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
            const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
            (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
          }
        }
      }
      function allErrorsMode() {
        if (useLoop || $data) {
          cxt.block$data(codegen_1.nil, loopAllRequired);
        } else {
          for (const prop of schema) {
            (0, code_1.checkReportMissingProp)(cxt, prop);
          }
        }
      }
      function exitOnErrorMode() {
        const missing = gen.let("missing");
        if (useLoop || $data) {
          const valid = gen.let("valid", true);
          cxt.block$data(valid, () => loopUntilMissing(missing, valid));
          cxt.ok(valid);
        } else {
          gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
      function loopAllRequired() {
        gen.forOf("prop", schemaCode, (prop) => {
          cxt.setParams({ missingProperty: prop });
          gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
        });
      }
      function loopUntilMissing(missing, valid) {
        cxt.setParams({ missingProperty: missing });
        gen.forOf(missing, schemaCode, () => {
          gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error();
            gen.break();
          });
        }, codegen_1.nil);
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxItems" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxItems", "minItems"],
    type: "array",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
      cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var equal = require_fast_deep_equal();
  equal.code = 'require("ajv/dist/runtime/equal").default';
  exports.default = equal;
});

// node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dataType_1 = require_dataType();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
    params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
  };
  var def = {
    keyword: "uniqueItems",
    type: "array",
    schemaType: "boolean",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
      if (!$data && !schema)
        return;
      const valid = gen.let("valid");
      const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
      cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
      cxt.ok(valid);
      function validateUniqueItems() {
        const i = gen.let("i", (0, codegen_1._)`${data}.length`);
        const j = gen.let("j");
        cxt.setParams({ i, j });
        gen.assign(valid, true);
        gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
      }
      function canOptimize() {
        return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
      }
      function loopN(i, j) {
        const item = gen.name("item");
        const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
        const indices = gen.const("indices", (0, codegen_1._)`{}`);
        gen.for((0, codegen_1._)`;${i}--;`, () => {
          gen.let(item, (0, codegen_1._)`${data}[${i}]`);
          gen.if(wrongType, (0, codegen_1._)`continue`);
          if (itemTypes.length > 1)
            gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
          gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
            gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
            cxt.error();
            gen.assign(valid, false).break();
          }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
        });
      }
      function loopN2(i, j) {
        const eql = (0, util_1.useFunc)(gen, equal_1.default);
        const outer = gen.name("outer");
        gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
          cxt.error();
          gen.assign(valid, false).break(outer);
        })));
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: "must be equal to constant",
    params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
  };
  var def = {
    keyword: "const",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schemaCode, schema } = cxt;
      if ($data || schema && typeof schema == "object") {
        cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
      } else {
        cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: "must be equal to one of the allowed values",
    params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
  };
  var def = {
    keyword: "enum",
    schemaType: "array",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      if (!$data && schema.length === 0)
        throw new Error("enum must have non-empty array");
      const useLoop = schema.length >= it.opts.loopEnum;
      let eql;
      const getEql = () => eql !== null && eql !== undefined ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
      let valid;
      if (useLoop || $data) {
        valid = gen.let("valid");
        cxt.block$data(valid, loopEnum);
      } else {
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const vSchema = gen.const("vSchema", schemaCode);
        valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
      }
      cxt.pass(valid);
      function loopEnum() {
        gen.assign(valid, false);
        gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
      }
      function equalCode(vSchema, i) {
        const sch = schema[i];
        return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var limitNumber_1 = require_limitNumber();
  var multipleOf_1 = require_multipleOf();
  var limitLength_1 = require_limitLength();
  var pattern_1 = require_pattern();
  var limitProperties_1 = require_limitProperties();
  var required_1 = require_required();
  var limitItems_1 = require_limitItems();
  var uniqueItems_1 = require_uniqueItems();
  var const_1 = require_const();
  var enum_1 = require_enum();
  var validation = [
    limitNumber_1.default,
    multipleOf_1.default,
    limitLength_1.default,
    pattern_1.default,
    limitProperties_1.default,
    required_1.default,
    limitItems_1.default,
    uniqueItems_1.default,
    { keyword: "type", schemaType: ["string", "array"] },
    { keyword: "nullable", schemaType: "boolean" },
    const_1.default,
    enum_1.default
  ];
  exports.default = validation;
});

// node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateAdditionalItems = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
  };
  var def = {
    keyword: "additionalItems",
    type: "array",
    schemaType: ["boolean", "object"],
    before: "uniqueItems",
    error,
    code(cxt) {
      const { parentSchema, it } = cxt;
      const { items } = parentSchema;
      if (!Array.isArray(items)) {
        (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
        return;
      }
      validateAdditionalItems(cxt, items);
    }
  };
  function validateAdditionalItems(cxt, items) {
    const { gen, schema, data, keyword, it } = cxt;
    it.items = true;
    const len = gen.const("len", (0, codegen_1._)`${data}.length`);
    if (schema === false) {
      cxt.setParams({ len: items.length });
      cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
    } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
      const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
      gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
      cxt.ok(valid);
    }
    function validateItems(valid) {
      gen.forRange("i", items.length, len, (i) => {
        cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
        if (!it.allErrors)
          gen.if((0, codegen_1.not)(valid), () => gen.break());
      });
    }
  }
  exports.validateAdditionalItems = validateAdditionalItems;
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateTuple = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  var def = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "array", "boolean"],
    before: "uniqueItems",
    code(cxt) {
      const { schema, it } = cxt;
      if (Array.isArray(schema))
        return validateTuple(cxt, "additionalItems", schema);
      it.items = true;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      cxt.ok((0, code_1.validateArray)(cxt));
    }
  };
  function validateTuple(cxt, extraItems, schArr = cxt.schema) {
    const { gen, parentSchema, data, keyword, it } = cxt;
    checkStrictTuple(parentSchema);
    if (it.opts.unevaluated && schArr.length && it.items !== true) {
      it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
    }
    const valid = gen.name("valid");
    const len = gen.const("len", (0, codegen_1._)`${data}.length`);
    schArr.forEach((sch, i) => {
      if ((0, util_1.alwaysValidSchema)(it, sch))
        return;
      gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
        keyword,
        schemaProp: i,
        dataProp: i
      }, valid));
      cxt.ok(valid);
    });
    function checkStrictTuple(sch) {
      const { opts, errSchemaPath } = it;
      const l = schArr.length;
      const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
      if (opts.strictTuples && !fullTuple) {
        const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
        (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
      }
    }
  }
  exports.validateTuple = validateTuple;
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var items_1 = require_items();
  var def = {
    keyword: "prefixItems",
    type: "array",
    schemaType: ["array"],
    before: "uniqueItems",
    code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  var additionalItems_1 = require_additionalItems();
  var error = {
    message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
  };
  var def = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    error,
    code(cxt) {
      const { schema, parentSchema, it } = cxt;
      const { prefixItems } = parentSchema;
      it.items = true;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      if (prefixItems)
        (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
      else
        cxt.ok((0, code_1.validateArray)(cxt));
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { min, max } }) => max === undefined ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
    params: ({ params: { min, max } }) => max === undefined ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
  };
  var def = {
    keyword: "contains",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, data, it } = cxt;
      let min;
      let max;
      const { minContains, maxContains } = parentSchema;
      if (it.opts.next) {
        min = minContains === undefined ? 1 : minContains;
        max = maxContains;
      } else {
        min = 1;
      }
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      cxt.setParams({ min, max });
      if (max === undefined && min === 0) {
        (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
        return;
      }
      if (max !== undefined && min > max) {
        (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
        cxt.fail();
        return;
      }
      if ((0, util_1.alwaysValidSchema)(it, schema)) {
        let cond = (0, codegen_1._)`${len} >= ${min}`;
        if (max !== undefined)
          cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
        cxt.pass(cond);
        return;
      }
      it.items = true;
      const valid = gen.name("valid");
      if (max === undefined && min === 1) {
        validateItems(valid, () => gen.if(valid, () => gen.break()));
      } else if (min === 0) {
        gen.let(valid, true);
        if (max !== undefined)
          gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
      } else {
        gen.let(valid, false);
        validateItemsWithCount();
      }
      cxt.result(valid, () => cxt.reset());
      function validateItemsWithCount() {
        const schValid = gen.name("_valid");
        const count = gen.let("count", 0);
        validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
      }
      function validateItems(_valid, block) {
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword: "contains",
            dataProp: i,
            dataPropType: util_1.Type.Num,
            compositeRule: true
          }, _valid);
          block();
        });
      }
      function checkLimits(count) {
        gen.code((0, codegen_1._)`${count}++`);
        if (max === undefined) {
          gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
        } else {
          gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
          if (min === 1)
            gen.assign(valid, true);
          else
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
        }
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  exports.error = {
    message: ({ params: { property, depsCount, deps } }) => {
      const property_ies = depsCount === 1 ? "property" : "properties";
      return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
    },
    params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
  };
  var def = {
    keyword: "dependencies",
    type: "object",
    schemaType: "object",
    error: exports.error,
    code(cxt) {
      const [propDeps, schDeps] = splitDependencies(cxt);
      validatePropertyDeps(cxt, propDeps);
      validateSchemaDeps(cxt, schDeps);
    }
  };
  function splitDependencies({ schema }) {
    const propertyDeps = {};
    const schemaDeps = {};
    for (const key in schema) {
      if (key === "__proto__")
        continue;
      const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
      deps[key] = schema[key];
    }
    return [propertyDeps, schemaDeps];
  }
  function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
    const { gen, data, it } = cxt;
    if (Object.keys(propertyDeps).length === 0)
      return;
    const missing = gen.let("missing");
    for (const prop in propertyDeps) {
      const deps = propertyDeps[prop];
      if (deps.length === 0)
        continue;
      const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
      cxt.setParams({
        property: prop,
        depsCount: deps.length,
        deps: deps.join(", ")
      });
      if (it.allErrors) {
        gen.if(hasProperty, () => {
          for (const depProp of deps) {
            (0, code_1.checkReportMissingProp)(cxt, depProp);
          }
        });
      } else {
        gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
        (0, code_1.reportMissingProp)(cxt, missing);
        gen.else();
      }
    }
  }
  exports.validatePropertyDeps = validatePropertyDeps;
  function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
    const { gen, data, keyword, it } = cxt;
    const valid = gen.name("valid");
    for (const prop in schemaDeps) {
      if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
        continue;
      gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties), () => {
        const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
        cxt.mergeValidEvaluated(schCxt, valid);
      }, () => gen.var(valid, true));
      cxt.ok(valid);
    }
  }
  exports.validateSchemaDeps = validateSchemaDeps;
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: "property name must be valid",
    params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
  };
  var def = {
    keyword: "propertyNames",
    type: "object",
    schemaType: ["object", "boolean"],
    error,
    code(cxt) {
      const { gen, schema, data, it } = cxt;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      const valid = gen.name("valid");
      gen.forIn("key", data, (key) => {
        cxt.setParams({ propertyName: key });
        cxt.subschema({
          keyword: "propertyNames",
          data: key,
          dataTypes: ["string"],
          propertyName: key,
          compositeRule: true
        }, valid);
        gen.if((0, codegen_1.not)(valid), () => {
          cxt.error(true);
          if (!it.allErrors)
            gen.break();
        });
      });
      cxt.ok(valid);
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var util_1 = require_util();
  var error = {
    message: "must NOT have additional properties",
    params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
  };
  var def = {
    keyword: "additionalProperties",
    type: ["object"],
    schemaType: ["boolean", "object"],
    allowUndefined: true,
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, data, errsCount, it } = cxt;
      if (!errsCount)
        throw new Error("ajv implementation error");
      const { allErrors, opts } = it;
      it.props = true;
      if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
        return;
      const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
      const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
      checkAdditionalProperties();
      cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
      function checkAdditionalProperties() {
        gen.forIn("key", data, (key) => {
          if (!props.length && !patProps.length)
            additionalPropertyCode(key);
          else
            gen.if(isAdditional(key), () => additionalPropertyCode(key));
        });
      }
      function isAdditional(key) {
        let definedProp;
        if (props.length > 8) {
          const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
          definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
        } else if (props.length) {
          definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
        } else {
          definedProp = codegen_1.nil;
        }
        if (patProps.length) {
          definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
        }
        return (0, codegen_1.not)(definedProp);
      }
      function deleteAdditional(key) {
        gen.code((0, codegen_1._)`delete ${data}[${key}]`);
      }
      function additionalPropertyCode(key) {
        if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
          deleteAdditional(key);
          return;
        }
        if (schema === false) {
          cxt.setParams({ additionalProperty: key });
          cxt.error();
          if (!allErrors)
            gen.break();
          return;
        }
        if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
          const valid = gen.name("valid");
          if (opts.removeAdditional === "failing") {
            applyAdditionalSchema(key, valid, false);
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.reset();
              deleteAdditional(key);
            });
          } else {
            applyAdditionalSchema(key, valid);
            if (!allErrors)
              gen.if((0, codegen_1.not)(valid), () => gen.break());
          }
        }
      }
      function applyAdditionalSchema(key, valid, errors) {
        const subschema = {
          keyword: "additionalProperties",
          dataProp: key,
          dataPropType: util_1.Type.Str
        };
        if (errors === false) {
          Object.assign(subschema, {
            compositeRule: true,
            createErrors: false,
            allErrors: false
          });
        }
        cxt.subschema(subschema, valid);
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var validate_1 = require_validate();
  var code_1 = require_code2();
  var util_1 = require_util();
  var additionalProperties_1 = require_additionalProperties();
  var def = {
    keyword: "properties",
    type: "object",
    schemaType: "object",
    code(cxt) {
      const { gen, schema, parentSchema, data, it } = cxt;
      if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === undefined) {
        additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
      }
      const allProps = (0, code_1.allSchemaProperties)(schema);
      for (const prop of allProps) {
        it.definedProperties.add(prop);
      }
      if (it.opts.unevaluated && allProps.length && it.props !== true) {
        it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
      }
      const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
      if (properties.length === 0)
        return;
      const valid = gen.name("valid");
      for (const prop of properties) {
        if (hasDefault(prop)) {
          applyPropertySchema(prop);
        } else {
          gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
          applyPropertySchema(prop);
          if (!it.allErrors)
            gen.else().var(valid, true);
          gen.endIf();
        }
        cxt.it.definedProperties.add(prop);
        cxt.ok(valid);
      }
      function hasDefault(prop) {
        return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== undefined;
      }
      function applyPropertySchema(prop) {
        cxt.subschema({
          keyword: "properties",
          schemaProp: prop,
          dataProp: prop
        }, valid);
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var util_2 = require_util();
  var def = {
    keyword: "patternProperties",
    type: "object",
    schemaType: "object",
    code(cxt) {
      const { gen, schema, data, parentSchema, it } = cxt;
      const { opts } = it;
      const patterns = (0, code_1.allSchemaProperties)(schema);
      const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
      if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
        return;
      }
      const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
      const valid = gen.name("valid");
      if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
        it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
      }
      const { props } = it;
      validatePatternProperties();
      function validatePatternProperties() {
        for (const pat of patterns) {
          if (checkProperties)
            checkMatchingProperties(pat);
          if (it.allErrors) {
            validateProperties(pat);
          } else {
            gen.var(valid, true);
            validateProperties(pat);
            gen.if(valid);
          }
        }
      }
      function checkMatchingProperties(pat) {
        for (const prop in checkProperties) {
          if (new RegExp(pat).test(prop)) {
            (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
          }
        }
      }
      function validateProperties(pat) {
        gen.forIn("key", data, (key) => {
          gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
            const alwaysValid = alwaysValidPatterns.includes(pat);
            if (!alwaysValid) {
              cxt.subschema({
                keyword: "patternProperties",
                schemaProp: pat,
                dataProp: key,
                dataPropType: util_2.Type.Str
              }, valid);
            }
            if (it.opts.unevaluated && props !== true) {
              gen.assign((0, codegen_1._)`${props}[${key}]`, true);
            } else if (!alwaysValid && !it.allErrors) {
              gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          });
        });
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: "not",
    schemaType: ["object", "boolean"],
    trackErrors: true,
    code(cxt) {
      const { gen, schema, it } = cxt;
      if ((0, util_1.alwaysValidSchema)(it, schema)) {
        cxt.fail();
        return;
      }
      const valid = gen.name("valid");
      cxt.subschema({
        keyword: "not",
        compositeRule: true,
        createErrors: false,
        allErrors: false
      }, valid);
      cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
    },
    error: { message: "must NOT be valid" }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var def = {
    keyword: "anyOf",
    schemaType: "array",
    trackErrors: true,
    code: code_1.validateUnion,
    error: { message: "must match a schema in anyOf" }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: "must match exactly one schema in oneOf",
    params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
  };
  var def = {
    keyword: "oneOf",
    schemaType: "array",
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      if (it.opts.discriminator && parentSchema.discriminator)
        return;
      const schArr = schema;
      const valid = gen.let("valid", false);
      const passing = gen.let("passing", null);
      const schValid = gen.name("_valid");
      cxt.setParams({ passing });
      gen.block(validateOneOf);
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
      function validateOneOf() {
        schArr.forEach((sch, i) => {
          let schCxt;
          if ((0, util_1.alwaysValidSchema)(it, sch)) {
            gen.var(schValid, true);
          } else {
            schCxt = cxt.subschema({
              keyword: "oneOf",
              schemaProp: i,
              compositeRule: true
            }, schValid);
          }
          if (i > 0) {
            gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
          }
          gen.if(schValid, () => {
            gen.assign(valid, true);
            gen.assign(passing, i);
            if (schCxt)
              cxt.mergeEvaluated(schCxt, codegen_1.Name);
          });
        });
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: "allOf",
    schemaType: "array",
    code(cxt) {
      const { gen, schema, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const valid = gen.name("valid");
      schema.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
        cxt.ok(valid);
        cxt.mergeEvaluated(schCxt);
      });
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
    params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
  };
  var def = {
    keyword: "if",
    schemaType: ["object", "boolean"],
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, parentSchema, it } = cxt;
      if (parentSchema.then === undefined && parentSchema.else === undefined) {
        (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
      }
      const hasThen = hasSchema(it, "then");
      const hasElse = hasSchema(it, "else");
      if (!hasThen && !hasElse)
        return;
      const valid = gen.let("valid", true);
      const schValid = gen.name("_valid");
      validateIf();
      cxt.reset();
      if (hasThen && hasElse) {
        const ifClause = gen.let("ifClause");
        cxt.setParams({ ifClause });
        gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
      } else if (hasThen) {
        gen.if(schValid, validateClause("then"));
      } else {
        gen.if((0, codegen_1.not)(schValid), validateClause("else"));
      }
      cxt.pass(valid, () => cxt.error(true));
      function validateIf() {
        const schCxt = cxt.subschema({
          keyword: "if",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, schValid);
        cxt.mergeEvaluated(schCxt);
      }
      function validateClause(keyword, ifClause) {
        return () => {
          const schCxt = cxt.subschema({ keyword }, schValid);
          gen.assign(valid, schValid);
          cxt.mergeValidEvaluated(schCxt, valid);
          if (ifClause)
            gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
          else
            cxt.setParams({ ifClause: keyword });
        };
      }
    }
  };
  function hasSchema(it, keyword) {
    const schema = it.schema[keyword];
    return schema !== undefined && !(0, util_1.alwaysValidSchema)(it, schema);
  }
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: ["then", "else"],
    schemaType: ["object", "boolean"],
    code({ keyword, parentSchema, it }) {
      if (parentSchema.if === undefined)
        (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var additionalItems_1 = require_additionalItems();
  var prefixItems_1 = require_prefixItems();
  var items_1 = require_items();
  var items2020_1 = require_items2020();
  var contains_1 = require_contains();
  var dependencies_1 = require_dependencies();
  var propertyNames_1 = require_propertyNames();
  var additionalProperties_1 = require_additionalProperties();
  var properties_1 = require_properties();
  var patternProperties_1 = require_patternProperties();
  var not_1 = require_not();
  var anyOf_1 = require_anyOf();
  var oneOf_1 = require_oneOf();
  var allOf_1 = require_allOf();
  var if_1 = require_if();
  var thenElse_1 = require_thenElse();
  function getApplicator(draft2020 = false) {
    const applicator = [
      not_1.default,
      anyOf_1.default,
      oneOf_1.default,
      allOf_1.default,
      if_1.default,
      thenElse_1.default,
      propertyNames_1.default,
      additionalProperties_1.default,
      dependencies_1.default,
      properties_1.default,
      patternProperties_1.default
    ];
    if (draft2020)
      applicator.push(prefixItems_1.default, items2020_1.default);
    else
      applicator.push(additionalItems_1.default, items_1.default);
    applicator.push(contains_1.default);
    return applicator;
  }
  exports.default = getApplicator;
});

// node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
    params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
  };
  var def = {
    keyword: "format",
    type: ["number", "string"],
    schemaType: "string",
    $data: true,
    error,
    code(cxt, ruleType) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      const { opts, errSchemaPath, schemaEnv, self } = it;
      if (!opts.validateFormats)
        return;
      if ($data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        const fmts = gen.scopeValue("formats", {
          ref: self.formats,
          code: opts.code.formats
        });
        const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
        const fType = gen.let("fType");
        const format = gen.let("format");
        gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
        cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
        function unknownFmt() {
          if (opts.strictSchema === false)
            return codegen_1.nil;
          return (0, codegen_1._)`${schemaCode} && !${format}`;
        }
        function invalidFmt() {
          const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
          const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
          return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
        }
      }
      function validateFormat() {
        const formatDef = self.formats[schema];
        if (!formatDef) {
          unknownFormat();
          return;
        }
        if (formatDef === true)
          return;
        const [fmtType, format, fmtRef] = getFormat(formatDef);
        if (fmtType === ruleType)
          cxt.pass(validCondition());
        function unknownFormat() {
          if (opts.strictSchema === false) {
            self.logger.warn(unknownMsg());
            return;
          }
          throw new Error(unknownMsg());
          function unknownMsg() {
            return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
          }
        }
        function getFormat(fmtDef) {
          const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : undefined;
          const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
          if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
            return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
          }
          return ["string", fmtDef, fmt];
        }
        function validCondition() {
          if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
            if (!schemaEnv.$async)
              throw new Error("async format in sync schema");
            return (0, codegen_1._)`await ${fmtRef}(${data})`;
          }
          return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
        }
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var format_1 = require_format();
  var format = [format_1.default];
  exports.default = format;
});

// node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.contentVocabulary = exports.metadataVocabulary = undefined;
  exports.metadataVocabulary = [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples"
  ];
  exports.contentVocabulary = [
    "contentMediaType",
    "contentEncoding",
    "contentSchema"
  ];
});

// node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var core_1 = require_core2();
  var validation_1 = require_validation();
  var applicator_1 = require_applicator();
  var format_1 = require_format2();
  var metadata_1 = require_metadata();
  var draft7Vocabularies = [
    core_1.default,
    validation_1.default,
    (0, applicator_1.default)(),
    format_1.default,
    metadata_1.metadataVocabulary,
    metadata_1.contentVocabulary
  ];
  exports.default = draft7Vocabularies;
});

// node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DiscrError = undefined;
  var DiscrError;
  (function(DiscrError2) {
    DiscrError2["Tag"] = "tag";
    DiscrError2["Mapping"] = "mapping";
  })(DiscrError || (exports.DiscrError = DiscrError = {}));
});

// node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var types_1 = require_types();
  var compile_1 = require_compile();
  var ref_error_1 = require_ref_error();
  var util_1 = require_util();
  var error = {
    message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
    params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
  };
  var def = {
    keyword: "discriminator",
    type: "object",
    schemaType: "object",
    error,
    code(cxt) {
      const { gen, data, schema, parentSchema, it } = cxt;
      const { oneOf } = parentSchema;
      if (!it.opts.discriminator) {
        throw new Error("discriminator: requires discriminator option");
      }
      const tagName = schema.propertyName;
      if (typeof tagName != "string")
        throw new Error("discriminator: requires propertyName");
      if (schema.mapping)
        throw new Error("discriminator: mapping is not supported");
      if (!oneOf)
        throw new Error("discriminator: requires oneOf keyword");
      const valid = gen.let("valid", false);
      const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
      gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
      cxt.ok(valid);
      function validateMapping() {
        const mapping = getMapping();
        gen.if(false);
        for (const tagValue in mapping) {
          gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
          gen.assign(valid, applyTagSchema(mapping[tagValue]));
        }
        gen.else();
        cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
        gen.endIf();
      }
      function applyTagSchema(schemaProp) {
        const _valid = gen.name("valid");
        const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
        cxt.mergeEvaluated(schCxt, codegen_1.Name);
        return _valid;
      }
      function getMapping() {
        var _a;
        const oneOfMapping = {};
        const topRequired = hasRequired(parentSchema);
        let tagRequired = true;
        for (let i = 0;i < oneOf.length; i++) {
          let sch = oneOf[i];
          if ((sch === null || sch === undefined ? undefined : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
            const ref = sch.$ref;
            sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
            if (sch instanceof compile_1.SchemaEnv)
              sch = sch.schema;
            if (sch === undefined)
              throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
          }
          const propSch = (_a = sch === null || sch === undefined ? undefined : sch.properties) === null || _a === undefined ? undefined : _a[tagName];
          if (typeof propSch != "object") {
            throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
          }
          tagRequired = tagRequired && (topRequired || hasRequired(sch));
          addMappings(propSch, i);
        }
        if (!tagRequired)
          throw new Error(`discriminator: "${tagName}" must be required`);
        return oneOfMapping;
        function hasRequired({ required }) {
          return Array.isArray(required) && required.includes(tagName);
        }
        function addMappings(sch, i) {
          if (sch.const) {
            addMapping(sch.const, i);
          } else if (sch.enum) {
            for (const tagValue of sch.enum) {
              addMapping(tagValue, i);
            }
          } else {
            throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
          }
        }
        function addMapping(tagValue, i) {
          if (typeof tagValue != "string" || tagValue in oneOfMapping) {
            throw new Error(`discriminator: "${tagName}" values must be unique strings`);
          }
          oneOfMapping[tagValue] = i;
        }
      }
    }
  };
  exports.default = def;
});

// node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS((exports, module) => {
  module.exports = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "http://json-schema.org/draft-07/schema#",
    title: "Core schema meta-schema",
    definitions: {
      schemaArray: {
        type: "array",
        minItems: 1,
        items: { $ref: "#" }
      },
      nonNegativeInteger: {
        type: "integer",
        minimum: 0
      },
      nonNegativeIntegerDefault0: {
        allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
      },
      simpleTypes: {
        enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
      },
      stringArray: {
        type: "array",
        items: { type: "string" },
        uniqueItems: true,
        default: []
      }
    },
    type: ["object", "boolean"],
    properties: {
      $id: {
        type: "string",
        format: "uri-reference"
      },
      $schema: {
        type: "string",
        format: "uri"
      },
      $ref: {
        type: "string",
        format: "uri-reference"
      },
      $comment: {
        type: "string"
      },
      title: {
        type: "string"
      },
      description: {
        type: "string"
      },
      default: true,
      readOnly: {
        type: "boolean",
        default: false
      },
      examples: {
        type: "array",
        items: true
      },
      multipleOf: {
        type: "number",
        exclusiveMinimum: 0
      },
      maximum: {
        type: "number"
      },
      exclusiveMaximum: {
        type: "number"
      },
      minimum: {
        type: "number"
      },
      exclusiveMinimum: {
        type: "number"
      },
      maxLength: { $ref: "#/definitions/nonNegativeInteger" },
      minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      pattern: {
        type: "string",
        format: "regex"
      },
      additionalItems: { $ref: "#" },
      items: {
        anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
        default: true
      },
      maxItems: { $ref: "#/definitions/nonNegativeInteger" },
      minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      uniqueItems: {
        type: "boolean",
        default: false
      },
      contains: { $ref: "#" },
      maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
      minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      required: { $ref: "#/definitions/stringArray" },
      additionalProperties: { $ref: "#" },
      definitions: {
        type: "object",
        additionalProperties: { $ref: "#" },
        default: {}
      },
      properties: {
        type: "object",
        additionalProperties: { $ref: "#" },
        default: {}
      },
      patternProperties: {
        type: "object",
        additionalProperties: { $ref: "#" },
        propertyNames: { format: "regex" },
        default: {}
      },
      dependencies: {
        type: "object",
        additionalProperties: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
        }
      },
      propertyNames: { $ref: "#" },
      const: true,
      enum: {
        type: "array",
        items: true,
        minItems: 1,
        uniqueItems: true
      },
      type: {
        anyOf: [
          { $ref: "#/definitions/simpleTypes" },
          {
            type: "array",
            items: { $ref: "#/definitions/simpleTypes" },
            minItems: 1,
            uniqueItems: true
          }
        ]
      },
      format: { type: "string" },
      contentMediaType: { type: "string" },
      contentEncoding: { type: "string" },
      if: { $ref: "#" },
      then: { $ref: "#" },
      else: { $ref: "#" },
      allOf: { $ref: "#/definitions/schemaArray" },
      anyOf: { $ref: "#/definitions/schemaArray" },
      oneOf: { $ref: "#/definitions/schemaArray" },
      not: { $ref: "#" }
    },
    default: true
  };
});

// node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = undefined;
  var core_1 = require_core();
  var draft7_1 = require_draft7();
  var discriminator_1 = require_discriminator();
  var draft7MetaSchema = require_json_schema_draft_07();
  var META_SUPPORT_DATA = ["/properties"];
  var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";

  class Ajv extends core_1.default {
    _addVocabularies() {
      super._addVocabularies();
      draft7_1.default.forEach((v) => this.addVocabulary(v));
      if (this.opts.discriminator)
        this.addKeyword(discriminator_1.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      if (!this.opts.meta)
        return;
      const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
      this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
      this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : undefined);
    }
  }
  exports.Ajv = Ajv;
  module.exports = exports = Ajv;
  module.exports.Ajv = Ajv;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = Ajv;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
    return validation_error_1.default;
  } });
  var ref_error_1 = require_ref_error();
  Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
    return ref_error_1.default;
  } });
});

// node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.formatNames = exports.fastFormats = exports.fullFormats = undefined;
  function fmtDef(validate, compare) {
    return { validate, compare };
  }
  exports.fullFormats = {
    date: fmtDef(date2, compareDate),
    time: fmtDef(getTime(true), compareTime),
    "date-time": fmtDef(getDateTime(true), compareDateTime),
    "iso-time": fmtDef(getTime(), compareIsoTime),
    "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
    duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
    uri,
    "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
    "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
    email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
    regex: regex2,
    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
    "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
    "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
    byte,
    int32: { type: "number", validate: validateInt32 },
    int64: { type: "number", validate: validateInt64 },
    float: { type: "number", validate: validateNumber },
    double: { type: "number", validate: validateNumber },
    password: true,
    binary: true
  };
  exports.fastFormats = {
    ...exports.fullFormats,
    date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
    time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
    "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
    "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
    "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  };
  exports.formatNames = Object.keys(exports.fullFormats);
  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
  var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function date2(str) {
    const matches = DATE.exec(str);
    if (!matches)
      return false;
    const year = +matches[1];
    const month = +matches[2];
    const day = +matches[3];
    return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
  }
  function compareDate(d1, d2) {
    if (!(d1 && d2))
      return;
    if (d1 > d2)
      return 1;
    if (d1 < d2)
      return -1;
    return 0;
  }
  var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function getTime(strictTimeZone) {
    return function time(str) {
      const matches = TIME.exec(str);
      if (!matches)
        return false;
      const hr = +matches[1];
      const min = +matches[2];
      const sec = +matches[3];
      const tz = matches[4];
      const tzSign = matches[5] === "-" ? -1 : 1;
      const tzH = +(matches[6] || 0);
      const tzM = +(matches[7] || 0);
      if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
        return false;
      if (hr <= 23 && min <= 59 && sec < 60)
        return true;
      const utcMin = min - tzM * tzSign;
      const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
      return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
    };
  }
  function compareTime(s1, s2) {
    if (!(s1 && s2))
      return;
    const t1 = new Date("2020-01-01T" + s1).valueOf();
    const t2 = new Date("2020-01-01T" + s2).valueOf();
    if (!(t1 && t2))
      return;
    return t1 - t2;
  }
  function compareIsoTime(t1, t2) {
    if (!(t1 && t2))
      return;
    const a1 = TIME.exec(t1);
    const a2 = TIME.exec(t2);
    if (!(a1 && a2))
      return;
    t1 = a1[1] + a1[2] + a1[3];
    t2 = a2[1] + a2[2] + a2[3];
    if (t1 > t2)
      return 1;
    if (t1 < t2)
      return -1;
    return 0;
  }
  var DATE_TIME_SEPARATOR = /t|\s/i;
  function getDateTime(strictTimeZone) {
    const time = getTime(strictTimeZone);
    return function date_time(str) {
      const dateTime = str.split(DATE_TIME_SEPARATOR);
      return dateTime.length === 2 && date2(dateTime[0]) && time(dateTime[1]);
    };
  }
  function compareDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return;
    const d1 = new Date(dt1).valueOf();
    const d2 = new Date(dt2).valueOf();
    if (!(d1 && d2))
      return;
    return d1 - d2;
  }
  function compareIsoDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return;
    const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
    const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
    const res = compareDate(d1, d2);
    if (res === undefined)
      return;
    return res || compareTime(t1, t2);
  }
  var NOT_URI_FRAGMENT = /\/|:/;
  var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function uri(str) {
    return NOT_URI_FRAGMENT.test(str) && URI.test(str);
  }
  var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function byte(str) {
    BYTE.lastIndex = 0;
    return BYTE.test(str);
  }
  var MIN_INT32 = -(2 ** 31);
  var MAX_INT32 = 2 ** 31 - 1;
  function validateInt32(value) {
    return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
  }
  function validateInt64(value) {
    return Number.isInteger(value);
  }
  function validateNumber() {
    return true;
  }
  var Z_ANCHOR = /[^\\]\\Z/;
  function regex2(str) {
    if (Z_ANCHOR.test(str))
      return false;
    try {
      new RegExp(str);
      return true;
    } catch (e) {
      return false;
    }
  }
});

// node_modules/ajv-formats/dist/limit.js
var require_limit = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.formatLimitDefinition = undefined;
  var ajv_1 = require_ajv();
  var codegen_1 = require_codegen();
  var ops = codegen_1.operators;
  var KWDs = {
    formatMaximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    formatMinimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    formatExclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    formatExclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
  };
  var error = {
    message: ({ keyword, schemaCode }) => (0, codegen_1.str)`should be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
  };
  exports.formatLimitDefinition = {
    keyword: Object.keys(KWDs),
    type: "string",
    schemaType: "string",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, schemaCode, keyword, it } = cxt;
      const { opts, self } = it;
      if (!opts.validateFormats)
        return;
      const fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
      if (fCxt.$data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        const fmts = gen.scopeValue("formats", {
          ref: self.formats,
          code: opts.code.formats
        });
        const fmt = gen.const("fmt", (0, codegen_1._)`${fmts}[${fCxt.schemaCode}]`);
        cxt.fail$data((0, codegen_1.or)((0, codegen_1._)`typeof ${fmt} != "object"`, (0, codegen_1._)`${fmt} instanceof RegExp`, (0, codegen_1._)`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
      }
      function validateFormat() {
        const format = fCxt.schema;
        const fmtDef = self.formats[format];
        if (!fmtDef || fmtDef === true)
          return;
        if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function") {
          throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
        }
        const fmt = gen.scopeValue("formats", {
          key: format,
          ref: fmtDef,
          code: opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : undefined
        });
        cxt.fail$data(compareCode(fmt));
      }
      function compareCode(fmt) {
        return (0, codegen_1._)`${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
      }
    },
    dependencies: ["format"]
  };
  var formatLimitPlugin = (ajv) => {
    ajv.addKeyword(exports.formatLimitDefinition);
    return ajv;
  };
  exports.default = formatLimitPlugin;
});

// node_modules/ajv-formats/dist/index.js
var require_dist = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var formats_1 = require_formats();
  var limit_1 = require_limit();
  var codegen_1 = require_codegen();
  var fullName = new codegen_1.Name("fullFormats");
  var fastName = new codegen_1.Name("fastFormats");
  var formatsPlugin = (ajv, opts = { keywords: true }) => {
    if (Array.isArray(opts)) {
      addFormats(ajv, opts, formats_1.fullFormats, fullName);
      return ajv;
    }
    const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
    const list = opts.formats || formats_1.formatNames;
    addFormats(ajv, list, formats, exportName);
    if (opts.keywords)
      (0, limit_1.default)(ajv);
    return ajv;
  };
  formatsPlugin.get = (name, mode = "full") => {
    const formats = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
    const f = formats[name];
    if (!f)
      throw new Error(`Unknown format "${name}"`);
    return f;
  };
  function addFormats(ajv, list, fs2, exportName) {
    var _a;
    var _b;
    (_a = (_b = ajv.opts.code).formats) !== null && _a !== undefined || (_b.formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${exportName}`);
    for (const f of list)
      ajv.addFormat(f, fs2[f]);
  }
  module.exports = exports = formatsPlugin;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = formatsPlugin;
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js
function createDefaultAjvInstance() {
  const ajv = new import_ajv.default({
    strict: false,
    validateFormats: true,
    validateSchema: false,
    allErrors: true
  });
  const addFormats = import_ajv_formats.default;
  addFormats(ajv);
  return ajv;
}

class AjvJsonSchemaValidator {
  constructor(ajv) {
    this._ajv = ajv ?? createDefaultAjvInstance();
  }
  getValidator(schema) {
    const ajvValidator = "$id" in schema && typeof schema.$id === "string" ? this._ajv.getSchema(schema.$id) ?? this._ajv.compile(schema) : this._ajv.compile(schema);
    return (input) => {
      const valid = ajvValidator(input);
      if (valid) {
        return {
          valid: true,
          data: input,
          errorMessage: undefined
        };
      } else {
        return {
          valid: false,
          data: undefined,
          errorMessage: this._ajv.errorsText(ajvValidator.errors)
        };
      }
    };
  }
}
var import_ajv, import_ajv_formats;
var init_ajv_provider = __esm(() => {
  import_ajv = __toESM(require_ajv(), 1);
  import_ajv_formats = __toESM(require_dist(), 1);
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/client.js
class ExperimentalClientTasks {
  constructor(_client) {
    this._client = _client;
  }
  async* callToolStream(params, resultSchema = CallToolResultSchema, options) {
    const clientInternal = this._client;
    const optionsWithTask = {
      ...options,
      task: options?.task ?? (clientInternal.isToolTask(params.name) ? {} : undefined)
    };
    const stream = clientInternal.requestStream({ method: "tools/call", params }, resultSchema, optionsWithTask);
    const validator = clientInternal.getToolOutputValidator(params.name);
    for await (const message of stream) {
      if (message.type === "result" && validator) {
        const result = message.result;
        if (!result.structuredContent && !result.isError) {
          yield {
            type: "error",
            error: new McpError(ErrorCode.InvalidRequest, `Tool ${params.name} has an output schema but did not return structured content`)
          };
          return;
        }
        if (result.structuredContent) {
          try {
            const validationResult = validator(result.structuredContent);
            if (!validationResult.valid) {
              yield {
                type: "error",
                error: new McpError(ErrorCode.InvalidParams, `Structured content does not match the tool's output schema: ${validationResult.errorMessage}`)
              };
              return;
            }
          } catch (error) {
            if (error instanceof McpError) {
              yield { type: "error", error };
              return;
            }
            yield {
              type: "error",
              error: new McpError(ErrorCode.InvalidParams, `Failed to validate structured content: ${error instanceof Error ? error.message : String(error)}`)
            };
            return;
          }
        }
      }
      yield message;
    }
  }
  async getTask(taskId, options) {
    return this._client.getTask({ taskId }, options);
  }
  async getTaskResult(taskId, resultSchema, options) {
    return this._client.getTaskResult({ taskId }, resultSchema, options);
  }
  async listTasks(cursor, options) {
    return this._client.listTasks(cursor ? { cursor } : undefined, options);
  }
  async cancelTask(taskId, options) {
    return this._client.cancelTask({ taskId }, options);
  }
  requestStream(request, resultSchema, options) {
    return this._client.requestStream(request, resultSchema, options);
  }
}
var init_client = __esm(() => {
  init_types();
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/helpers.js
function assertToolsCallTaskCapability(requests, method, entityName) {
  if (!requests) {
    throw new Error(`${entityName} does not support task creation (required for ${method})`);
  }
  switch (method) {
    case "tools/call":
      if (!requests.tools?.call) {
        throw new Error(`${entityName} does not support task creation for tools/call (required for ${method})`);
      }
      break;
    default:
      break;
  }
}
function assertClientRequestTaskCapability(requests, method, entityName) {
  if (!requests) {
    throw new Error(`${entityName} does not support task creation (required for ${method})`);
  }
  switch (method) {
    case "sampling/createMessage":
      if (!requests.sampling?.createMessage) {
        throw new Error(`${entityName} does not support task creation for sampling/createMessage (required for ${method})`);
      }
      break;
    case "elicitation/create":
      if (!requests.elicitation?.create) {
        throw new Error(`${entityName} does not support task creation for elicitation/create (required for ${method})`);
      }
      break;
    default:
      break;
  }
}

// node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js
var exports_client = {};
__export(exports_client, {
  getSupportedElicitationModes: () => getSupportedElicitationModes,
  Client: () => Client
});
function applyElicitationDefaults(schema, data) {
  if (!schema || data === null || typeof data !== "object")
    return;
  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    const obj = data;
    const props = schema.properties;
    for (const key of Object.keys(props)) {
      const propSchema = props[key];
      if (obj[key] === undefined && Object.prototype.hasOwnProperty.call(propSchema, "default")) {
        obj[key] = propSchema.default;
      }
      if (obj[key] !== undefined) {
        applyElicitationDefaults(propSchema, obj[key]);
      }
    }
  }
  if (Array.isArray(schema.anyOf)) {
    for (const sub of schema.anyOf) {
      if (typeof sub !== "boolean") {
        applyElicitationDefaults(sub, data);
      }
    }
  }
  if (Array.isArray(schema.oneOf)) {
    for (const sub of schema.oneOf) {
      if (typeof sub !== "boolean") {
        applyElicitationDefaults(sub, data);
      }
    }
  }
}
function getSupportedElicitationModes(capabilities) {
  if (!capabilities) {
    return { supportsFormMode: false, supportsUrlMode: false };
  }
  const hasFormCapability = capabilities.form !== undefined;
  const hasUrlCapability = capabilities.url !== undefined;
  const supportsFormMode = hasFormCapability || !hasFormCapability && !hasUrlCapability;
  const supportsUrlMode = hasUrlCapability;
  return { supportsFormMode, supportsUrlMode };
}
var Client;
var init_client2 = __esm(() => {
  init_protocol();
  init_types();
  init_ajv_provider();
  init_zod_compat();
  init_client();
  Client = class Client extends Protocol {
    constructor(_clientInfo, options) {
      super(options);
      this._clientInfo = _clientInfo;
      this._cachedToolOutputValidators = new Map;
      this._cachedKnownTaskTools = new Set;
      this._cachedRequiredTaskTools = new Set;
      this._listChangedDebounceTimers = new Map;
      this._capabilities = options?.capabilities ?? {};
      this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new AjvJsonSchemaValidator;
      if (options?.listChanged) {
        this._pendingListChangedConfig = options.listChanged;
      }
    }
    _setupListChangedHandlers(config) {
      if (config.tools && this._serverCapabilities?.tools?.listChanged) {
        this._setupListChangedHandler("tools", ToolListChangedNotificationSchema, config.tools, async () => {
          const result = await this.listTools();
          return result.tools;
        });
      }
      if (config.prompts && this._serverCapabilities?.prompts?.listChanged) {
        this._setupListChangedHandler("prompts", PromptListChangedNotificationSchema, config.prompts, async () => {
          const result = await this.listPrompts();
          return result.prompts;
        });
      }
      if (config.resources && this._serverCapabilities?.resources?.listChanged) {
        this._setupListChangedHandler("resources", ResourceListChangedNotificationSchema, config.resources, async () => {
          const result = await this.listResources();
          return result.resources;
        });
      }
    }
    get experimental() {
      if (!this._experimental) {
        this._experimental = {
          tasks: new ExperimentalClientTasks(this)
        };
      }
      return this._experimental;
    }
    registerCapabilities(capabilities) {
      if (this.transport) {
        throw new Error("Cannot register capabilities after connecting to transport");
      }
      this._capabilities = mergeCapabilities(this._capabilities, capabilities);
    }
    setRequestHandler(requestSchema, handler) {
      const shape = getObjectShape(requestSchema);
      const methodSchema = shape?.method;
      if (!methodSchema) {
        throw new Error("Schema is missing a method literal");
      }
      let methodValue;
      if (isZ4Schema(methodSchema)) {
        const v4Schema = methodSchema;
        const v4Def = v4Schema._zod?.def;
        methodValue = v4Def?.value ?? v4Schema.value;
      } else {
        const v3Schema = methodSchema;
        const legacyDef = v3Schema._def;
        methodValue = legacyDef?.value ?? v3Schema.value;
      }
      if (typeof methodValue !== "string") {
        throw new Error("Schema method literal must be a string");
      }
      const method = methodValue;
      if (method === "elicitation/create") {
        const wrappedHandler = async (request, extra) => {
          const validatedRequest = safeParse2(ElicitRequestSchema, request);
          if (!validatedRequest.success) {
            const errorMessage = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid elicitation request: ${errorMessage}`);
          }
          const { params } = validatedRequest.data;
          params.mode = params.mode ?? "form";
          const { supportsFormMode, supportsUrlMode } = getSupportedElicitationModes(this._capabilities.elicitation);
          if (params.mode === "form" && !supportsFormMode) {
            throw new McpError(ErrorCode.InvalidParams, "Client does not support form-mode elicitation requests");
          }
          if (params.mode === "url" && !supportsUrlMode) {
            throw new McpError(ErrorCode.InvalidParams, "Client does not support URL-mode elicitation requests");
          }
          const result = await Promise.resolve(handler(request, extra));
          if (params.task) {
            const taskValidationResult = safeParse2(CreateTaskResultSchema, result);
            if (!taskValidationResult.success) {
              const errorMessage = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
              throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage}`);
            }
            return taskValidationResult.data;
          }
          const validationResult = safeParse2(ElicitResultSchema, result);
          if (!validationResult.success) {
            const errorMessage = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid elicitation result: ${errorMessage}`);
          }
          const validatedResult = validationResult.data;
          const requestedSchema = params.mode === "form" ? params.requestedSchema : undefined;
          if (params.mode === "form" && validatedResult.action === "accept" && validatedResult.content && requestedSchema) {
            if (this._capabilities.elicitation?.form?.applyDefaults) {
              try {
                applyElicitationDefaults(requestedSchema, validatedResult.content);
              } catch {}
            }
          }
          return validatedResult;
        };
        return super.setRequestHandler(requestSchema, wrappedHandler);
      }
      if (method === "sampling/createMessage") {
        const wrappedHandler = async (request, extra) => {
          const validatedRequest = safeParse2(CreateMessageRequestSchema, request);
          if (!validatedRequest.success) {
            const errorMessage = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid sampling request: ${errorMessage}`);
          }
          const { params } = validatedRequest.data;
          const result = await Promise.resolve(handler(request, extra));
          if (params.task) {
            const taskValidationResult = safeParse2(CreateTaskResultSchema, result);
            if (!taskValidationResult.success) {
              const errorMessage = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
              throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage}`);
            }
            return taskValidationResult.data;
          }
          const hasTools = params.tools || params.toolChoice;
          const resultSchema = hasTools ? CreateMessageResultWithToolsSchema : CreateMessageResultSchema;
          const validationResult = safeParse2(resultSchema, result);
          if (!validationResult.success) {
            const errorMessage = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid sampling result: ${errorMessage}`);
          }
          return validationResult.data;
        };
        return super.setRequestHandler(requestSchema, wrappedHandler);
      }
      return super.setRequestHandler(requestSchema, handler);
    }
    assertCapability(capability, method) {
      if (!this._serverCapabilities?.[capability]) {
        throw new Error(`Server does not support ${capability} (required for ${method})`);
      }
    }
    async connect(transport, options) {
      await super.connect(transport);
      if (transport.sessionId !== undefined) {
        return;
      }
      try {
        const result = await this.request({
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: this._capabilities,
            clientInfo: this._clientInfo
          }
        }, InitializeResultSchema, options);
        if (result === undefined) {
          throw new Error(`Server sent invalid initialize result: ${result}`);
        }
        if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
          throw new Error(`Server's protocol version is not supported: ${result.protocolVersion}`);
        }
        this._serverCapabilities = result.capabilities;
        this._serverVersion = result.serverInfo;
        if (transport.setProtocolVersion) {
          transport.setProtocolVersion(result.protocolVersion);
        }
        this._instructions = result.instructions;
        await this.notification({
          method: "notifications/initialized"
        });
        if (this._pendingListChangedConfig) {
          this._setupListChangedHandlers(this._pendingListChangedConfig);
          this._pendingListChangedConfig = undefined;
        }
      } catch (error) {
        this.close();
        throw error;
      }
    }
    getServerCapabilities() {
      return this._serverCapabilities;
    }
    getServerVersion() {
      return this._serverVersion;
    }
    getInstructions() {
      return this._instructions;
    }
    assertCapabilityForMethod(method) {
      switch (method) {
        case "logging/setLevel":
          if (!this._serverCapabilities?.logging) {
            throw new Error(`Server does not support logging (required for ${method})`);
          }
          break;
        case "prompts/get":
        case "prompts/list":
          if (!this._serverCapabilities?.prompts) {
            throw new Error(`Server does not support prompts (required for ${method})`);
          }
          break;
        case "resources/list":
        case "resources/templates/list":
        case "resources/read":
        case "resources/subscribe":
        case "resources/unsubscribe":
          if (!this._serverCapabilities?.resources) {
            throw new Error(`Server does not support resources (required for ${method})`);
          }
          if (method === "resources/subscribe" && !this._serverCapabilities.resources.subscribe) {
            throw new Error(`Server does not support resource subscriptions (required for ${method})`);
          }
          break;
        case "tools/call":
        case "tools/list":
          if (!this._serverCapabilities?.tools) {
            throw new Error(`Server does not support tools (required for ${method})`);
          }
          break;
        case "completion/complete":
          if (!this._serverCapabilities?.completions) {
            throw new Error(`Server does not support completions (required for ${method})`);
          }
          break;
        case "initialize":
          break;
        case "ping":
          break;
      }
    }
    assertNotificationCapability(method) {
      switch (method) {
        case "notifications/roots/list_changed":
          if (!this._capabilities.roots?.listChanged) {
            throw new Error(`Client does not support roots list changed notifications (required for ${method})`);
          }
          break;
        case "notifications/initialized":
          break;
        case "notifications/cancelled":
          break;
        case "notifications/progress":
          break;
      }
    }
    assertRequestHandlerCapability(method) {
      if (!this._capabilities) {
        return;
      }
      switch (method) {
        case "sampling/createMessage":
          if (!this._capabilities.sampling) {
            throw new Error(`Client does not support sampling capability (required for ${method})`);
          }
          break;
        case "elicitation/create":
          if (!this._capabilities.elicitation) {
            throw new Error(`Client does not support elicitation capability (required for ${method})`);
          }
          break;
        case "roots/list":
          if (!this._capabilities.roots) {
            throw new Error(`Client does not support roots capability (required for ${method})`);
          }
          break;
        case "tasks/get":
        case "tasks/list":
        case "tasks/result":
        case "tasks/cancel":
          if (!this._capabilities.tasks) {
            throw new Error(`Client does not support tasks capability (required for ${method})`);
          }
          break;
        case "ping":
          break;
      }
    }
    assertTaskCapability(method) {
      assertToolsCallTaskCapability(this._serverCapabilities?.tasks?.requests, method, "Server");
    }
    assertTaskHandlerCapability(method) {
      if (!this._capabilities) {
        return;
      }
      assertClientRequestTaskCapability(this._capabilities.tasks?.requests, method, "Client");
    }
    async ping(options) {
      return this.request({ method: "ping" }, EmptyResultSchema, options);
    }
    async complete(params, options) {
      return this.request({ method: "completion/complete", params }, CompleteResultSchema, options);
    }
    async setLoggingLevel(level, options) {
      return this.request({ method: "logging/setLevel", params: { level } }, EmptyResultSchema, options);
    }
    async getPrompt(params, options) {
      return this.request({ method: "prompts/get", params }, GetPromptResultSchema, options);
    }
    async listPrompts(params, options) {
      return this.request({ method: "prompts/list", params }, ListPromptsResultSchema, options);
    }
    async listResources(params, options) {
      return this.request({ method: "resources/list", params }, ListResourcesResultSchema, options);
    }
    async listResourceTemplates(params, options) {
      return this.request({ method: "resources/templates/list", params }, ListResourceTemplatesResultSchema, options);
    }
    async readResource(params, options) {
      return this.request({ method: "resources/read", params }, ReadResourceResultSchema, options);
    }
    async subscribeResource(params, options) {
      return this.request({ method: "resources/subscribe", params }, EmptyResultSchema, options);
    }
    async unsubscribeResource(params, options) {
      return this.request({ method: "resources/unsubscribe", params }, EmptyResultSchema, options);
    }
    async callTool(params, resultSchema = CallToolResultSchema, options) {
      if (this.isToolTaskRequired(params.name)) {
        throw new McpError(ErrorCode.InvalidRequest, `Tool "${params.name}" requires task-based execution. Use client.experimental.tasks.callToolStream() instead.`);
      }
      const result = await this.request({ method: "tools/call", params }, resultSchema, options);
      const validator = this.getToolOutputValidator(params.name);
      if (validator) {
        if (!result.structuredContent && !result.isError) {
          throw new McpError(ErrorCode.InvalidRequest, `Tool ${params.name} has an output schema but did not return structured content`);
        }
        if (result.structuredContent) {
          try {
            const validationResult = validator(result.structuredContent);
            if (!validationResult.valid) {
              throw new McpError(ErrorCode.InvalidParams, `Structured content does not match the tool's output schema: ${validationResult.errorMessage}`);
            }
          } catch (error) {
            if (error instanceof McpError) {
              throw error;
            }
            throw new McpError(ErrorCode.InvalidParams, `Failed to validate structured content: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      return result;
    }
    isToolTask(toolName) {
      if (!this._serverCapabilities?.tasks?.requests?.tools?.call) {
        return false;
      }
      return this._cachedKnownTaskTools.has(toolName);
    }
    isToolTaskRequired(toolName) {
      return this._cachedRequiredTaskTools.has(toolName);
    }
    cacheToolMetadata(tools) {
      this._cachedToolOutputValidators.clear();
      this._cachedKnownTaskTools.clear();
      this._cachedRequiredTaskTools.clear();
      for (const tool of tools) {
        if (tool.outputSchema) {
          const toolValidator = this._jsonSchemaValidator.getValidator(tool.outputSchema);
          this._cachedToolOutputValidators.set(tool.name, toolValidator);
        }
        const taskSupport = tool.execution?.taskSupport;
        if (taskSupport === "required" || taskSupport === "optional") {
          this._cachedKnownTaskTools.add(tool.name);
        }
        if (taskSupport === "required") {
          this._cachedRequiredTaskTools.add(tool.name);
        }
      }
    }
    getToolOutputValidator(toolName) {
      return this._cachedToolOutputValidators.get(toolName);
    }
    async listTools(params, options) {
      const result = await this.request({ method: "tools/list", params }, ListToolsResultSchema, options);
      this.cacheToolMetadata(result.tools);
      return result;
    }
    _setupListChangedHandler(listType, notificationSchema, options, fetcher) {
      const parseResult = ListChangedOptionsBaseSchema.safeParse(options);
      if (!parseResult.success) {
        throw new Error(`Invalid ${listType} listChanged options: ${parseResult.error.message}`);
      }
      if (typeof options.onChanged !== "function") {
        throw new Error(`Invalid ${listType} listChanged options: onChanged must be a function`);
      }
      const { autoRefresh, debounceMs } = parseResult.data;
      const { onChanged } = options;
      const refresh = async () => {
        if (!autoRefresh) {
          onChanged(null, null);
          return;
        }
        try {
          const items = await fetcher();
          onChanged(null, items);
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          onChanged(error, null);
        }
      };
      const handler = () => {
        if (debounceMs) {
          const existingTimer = this._listChangedDebounceTimers.get(listType);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          const timer = setTimeout(refresh, debounceMs);
          this._listChangedDebounceTimers.set(listType, timer);
        } else {
          refresh();
        }
      };
      this.setNotificationHandler(notificationSchema, handler);
    }
    async sendRootsListChanged() {
      return this.notification({ method: "notifications/roots/list_changed" });
    }
  };
});

// node_modules/isexe/windows.js
var require_windows = __commonJS((exports, module) => {
  module.exports = isexe;
  isexe.sync = sync;
  var fs2 = __require("fs");
  function checkPathExt(path2, options) {
    var pathext = options.pathExt !== undefined ? options.pathExt : process.env.PATHEXT;
    if (!pathext) {
      return true;
    }
    pathext = pathext.split(";");
    if (pathext.indexOf("") !== -1) {
      return true;
    }
    for (var i = 0;i < pathext.length; i++) {
      var p = pathext[i].toLowerCase();
      if (p && path2.substr(-p.length).toLowerCase() === p) {
        return true;
      }
    }
    return false;
  }
  function checkStat(stat, path2, options) {
    if (!stat.isSymbolicLink() && !stat.isFile()) {
      return false;
    }
    return checkPathExt(path2, options);
  }
  function isexe(path2, options, cb) {
    fs2.stat(path2, function(er, stat) {
      cb(er, er ? false : checkStat(stat, path2, options));
    });
  }
  function sync(path2, options) {
    return checkStat(fs2.statSync(path2), path2, options);
  }
});

// node_modules/isexe/mode.js
var require_mode = __commonJS((exports, module) => {
  module.exports = isexe;
  isexe.sync = sync;
  var fs2 = __require("fs");
  function isexe(path2, options, cb) {
    fs2.stat(path2, function(er, stat) {
      cb(er, er ? false : checkStat(stat, options));
    });
  }
  function sync(path2, options) {
    return checkStat(fs2.statSync(path2), options);
  }
  function checkStat(stat, options) {
    return stat.isFile() && checkMode(stat, options);
  }
  function checkMode(stat, options) {
    var mod = stat.mode;
    var uid = stat.uid;
    var gid = stat.gid;
    var myUid = options.uid !== undefined ? options.uid : process.getuid && process.getuid();
    var myGid = options.gid !== undefined ? options.gid : process.getgid && process.getgid();
    var u = parseInt("100", 8);
    var g = parseInt("010", 8);
    var o = parseInt("001", 8);
    var ug = u | g;
    var ret = mod & o || mod & g && gid === myGid || mod & u && uid === myUid || mod & ug && myUid === 0;
    return ret;
  }
});

// node_modules/isexe/index.js
var require_isexe = __commonJS((exports, module) => {
  var fs2 = __require("fs");
  var core;
  if (process.platform === "win32" || global.TESTING_WINDOWS) {
    core = require_windows();
  } else {
    core = require_mode();
  }
  module.exports = isexe;
  isexe.sync = sync;
  function isexe(path2, options, cb) {
    if (typeof options === "function") {
      cb = options;
      options = {};
    }
    if (!cb) {
      if (typeof Promise !== "function") {
        throw new TypeError("callback not provided");
      }
      return new Promise(function(resolve3, reject) {
        isexe(path2, options || {}, function(er, is) {
          if (er) {
            reject(er);
          } else {
            resolve3(is);
          }
        });
      });
    }
    core(path2, options || {}, function(er, is) {
      if (er) {
        if (er.code === "EACCES" || options && options.ignoreErrors) {
          er = null;
          is = false;
        }
      }
      cb(er, is);
    });
  }
  function sync(path2, options) {
    try {
      return core.sync(path2, options || {});
    } catch (er) {
      if (options && options.ignoreErrors || er.code === "EACCES") {
        return false;
      } else {
        throw er;
      }
    }
  }
});

// node_modules/which/which.js
var require_which = __commonJS((exports, module) => {
  var isWindows = process.platform === "win32" || process.env.OSTYPE === "cygwin" || process.env.OSTYPE === "msys";
  var path2 = __require("path");
  var COLON = isWindows ? ";" : ":";
  var isexe = require_isexe();
  var getNotFoundError = (cmd) => Object.assign(new Error(`not found: ${cmd}`), { code: "ENOENT" });
  var getPathInfo = (cmd, opt) => {
    const colon = opt.colon || COLON;
    const pathEnv = cmd.match(/\//) || isWindows && cmd.match(/\\/) ? [""] : [
      ...isWindows ? [process.cwd()] : [],
      ...(opt.path || process.env.PATH || "").split(colon)
    ];
    const pathExtExe = isWindows ? opt.pathExt || process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM" : "";
    const pathExt = isWindows ? pathExtExe.split(colon) : [""];
    if (isWindows) {
      if (cmd.indexOf(".") !== -1 && pathExt[0] !== "")
        pathExt.unshift("");
    }
    return {
      pathEnv,
      pathExt,
      pathExtExe
    };
  };
  var which = (cmd, opt, cb) => {
    if (typeof opt === "function") {
      cb = opt;
      opt = {};
    }
    if (!opt)
      opt = {};
    const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
    const found = [];
    const step = (i) => new Promise((resolve3, reject) => {
      if (i === pathEnv.length)
        return opt.all && found.length ? resolve3(found) : reject(getNotFoundError(cmd));
      const ppRaw = pathEnv[i];
      const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
      const pCmd = path2.join(pathPart, cmd);
      const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
      resolve3(subStep(p, i, 0));
    });
    const subStep = (p, i, ii) => new Promise((resolve3, reject) => {
      if (ii === pathExt.length)
        return resolve3(step(i + 1));
      const ext = pathExt[ii];
      isexe(p + ext, { pathExt: pathExtExe }, (er, is) => {
        if (!er && is) {
          if (opt.all)
            found.push(p + ext);
          else
            return resolve3(p + ext);
        }
        return resolve3(subStep(p, i, ii + 1));
      });
    });
    return cb ? step(0).then((res) => cb(null, res), cb) : step(0);
  };
  var whichSync = (cmd, opt) => {
    opt = opt || {};
    const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
    const found = [];
    for (let i = 0;i < pathEnv.length; i++) {
      const ppRaw = pathEnv[i];
      const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
      const pCmd = path2.join(pathPart, cmd);
      const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
      for (let j = 0;j < pathExt.length; j++) {
        const cur = p + pathExt[j];
        try {
          const is = isexe.sync(cur, { pathExt: pathExtExe });
          if (is) {
            if (opt.all)
              found.push(cur);
            else
              return cur;
          }
        } catch (ex) {}
      }
    }
    if (opt.all && found.length)
      return found;
    if (opt.nothrow)
      return null;
    throw getNotFoundError(cmd);
  };
  module.exports = which;
  which.sync = whichSync;
});

// node_modules/path-key/index.js
var require_path_key = __commonJS((exports, module) => {
  var pathKey = (options = {}) => {
    const environment = options.env || process.env;
    const platform2 = options.platform || process.platform;
    if (platform2 !== "win32") {
      return "PATH";
    }
    return Object.keys(environment).reverse().find((key) => key.toUpperCase() === "PATH") || "Path";
  };
  module.exports = pathKey;
  module.exports.default = pathKey;
});

// node_modules/cross-spawn/lib/util/resolveCommand.js
var require_resolveCommand = __commonJS((exports, module) => {
  var path2 = __require("path");
  var which = require_which();
  var getPathKey = require_path_key();
  function resolveCommandAttempt(parsed, withoutPathExt) {
    const env = parsed.options.env || process.env;
    const cwd = process.cwd();
    const hasCustomCwd = parsed.options.cwd != null;
    const shouldSwitchCwd = hasCustomCwd && process.chdir !== undefined && !process.chdir.disabled;
    if (shouldSwitchCwd) {
      try {
        process.chdir(parsed.options.cwd);
      } catch (err) {}
    }
    let resolved;
    try {
      resolved = which.sync(parsed.command, {
        path: env[getPathKey({ env })],
        pathExt: withoutPathExt ? path2.delimiter : undefined
      });
    } catch (e) {} finally {
      if (shouldSwitchCwd) {
        process.chdir(cwd);
      }
    }
    if (resolved) {
      resolved = path2.resolve(hasCustomCwd ? parsed.options.cwd : "", resolved);
    }
    return resolved;
  }
  function resolveCommand(parsed) {
    return resolveCommandAttempt(parsed) || resolveCommandAttempt(parsed, true);
  }
  module.exports = resolveCommand;
});

// node_modules/cross-spawn/lib/util/escape.js
var require_escape = __commonJS((exports, module) => {
  var metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;
  function escapeCommand(arg) {
    arg = arg.replace(metaCharsRegExp, "^$1");
    return arg;
  }
  function escapeArgument(arg, doubleEscapeMetaChars) {
    arg = `${arg}`;
    arg = arg.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
    arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
    arg = `"${arg}"`;
    arg = arg.replace(metaCharsRegExp, "^$1");
    if (doubleEscapeMetaChars) {
      arg = arg.replace(metaCharsRegExp, "^$1");
    }
    return arg;
  }
  exports.command = escapeCommand;
  exports.argument = escapeArgument;
});

// node_modules/shebang-regex/index.js
var require_shebang_regex = __commonJS((exports, module) => {
  module.exports = /^#!(.*)/;
});

// node_modules/shebang-command/index.js
var require_shebang_command = __commonJS((exports, module) => {
  var shebangRegex = require_shebang_regex();
  module.exports = (string3 = "") => {
    const match = string3.match(shebangRegex);
    if (!match) {
      return null;
    }
    const [path2, argument] = match[0].replace(/#! ?/, "").split(" ");
    const binary = path2.split("/").pop();
    if (binary === "env") {
      return argument;
    }
    return argument ? `${binary} ${argument}` : binary;
  };
});

// node_modules/cross-spawn/lib/util/readShebang.js
var require_readShebang = __commonJS((exports, module) => {
  var fs2 = __require("fs");
  var shebangCommand = require_shebang_command();
  function readShebang(command) {
    const size = 150;
    const buffer = Buffer.alloc(size);
    let fd;
    try {
      fd = fs2.openSync(command, "r");
      fs2.readSync(fd, buffer, 0, size, 0);
      fs2.closeSync(fd);
    } catch (e) {}
    return shebangCommand(buffer.toString());
  }
  module.exports = readShebang;
});

// node_modules/cross-spawn/lib/parse.js
var require_parse = __commonJS((exports, module) => {
  var path2 = __require("path");
  var resolveCommand = require_resolveCommand();
  var escape2 = require_escape();
  var readShebang = require_readShebang();
  var isWin = process.platform === "win32";
  var isExecutableRegExp = /\.(?:com|exe)$/i;
  var isCmdShimRegExp = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;
  function detectShebang(parsed) {
    parsed.file = resolveCommand(parsed);
    const shebang = parsed.file && readShebang(parsed.file);
    if (shebang) {
      parsed.args.unshift(parsed.file);
      parsed.command = shebang;
      return resolveCommand(parsed);
    }
    return parsed.file;
  }
  function parseNonShell(parsed) {
    if (!isWin) {
      return parsed;
    }
    const commandFile = detectShebang(parsed);
    const needsShell = !isExecutableRegExp.test(commandFile);
    if (parsed.options.forceShell || needsShell) {
      const needsDoubleEscapeMetaChars = isCmdShimRegExp.test(commandFile);
      parsed.command = path2.normalize(parsed.command);
      parsed.command = escape2.command(parsed.command);
      parsed.args = parsed.args.map((arg) => escape2.argument(arg, needsDoubleEscapeMetaChars));
      const shellCommand = [parsed.command].concat(parsed.args).join(" ");
      parsed.args = ["/d", "/s", "/c", `"${shellCommand}"`];
      parsed.command = process.env.comspec || "cmd.exe";
      parsed.options.windowsVerbatimArguments = true;
    }
    return parsed;
  }
  function parse(command, args, options) {
    if (args && !Array.isArray(args)) {
      options = args;
      args = null;
    }
    args = args ? args.slice(0) : [];
    options = Object.assign({}, options);
    const parsed = {
      command,
      args,
      options,
      file: undefined,
      original: {
        command,
        args
      }
    };
    return options.shell ? parsed : parseNonShell(parsed);
  }
  module.exports = parse;
});

// node_modules/cross-spawn/lib/enoent.js
var require_enoent = __commonJS((exports, module) => {
  var isWin = process.platform === "win32";
  function notFoundError(original, syscall) {
    return Object.assign(new Error(`${syscall} ${original.command} ENOENT`), {
      code: "ENOENT",
      errno: "ENOENT",
      syscall: `${syscall} ${original.command}`,
      path: original.command,
      spawnargs: original.args
    });
  }
  function hookChildProcess(cp, parsed) {
    if (!isWin) {
      return;
    }
    const originalEmit = cp.emit;
    cp.emit = function(name, arg1) {
      if (name === "exit") {
        const err = verifyENOENT(arg1, parsed);
        if (err) {
          return originalEmit.call(cp, "error", err);
        }
      }
      return originalEmit.apply(cp, arguments);
    };
  }
  function verifyENOENT(status, parsed) {
    if (isWin && status === 1 && !parsed.file) {
      return notFoundError(parsed.original, "spawn");
    }
    return null;
  }
  function verifyENOENTSync(status, parsed) {
    if (isWin && status === 1 && !parsed.file) {
      return notFoundError(parsed.original, "spawnSync");
    }
    return null;
  }
  module.exports = {
    hookChildProcess,
    verifyENOENT,
    verifyENOENTSync,
    notFoundError
  };
});

// node_modules/cross-spawn/index.js
var require_cross_spawn = __commonJS((exports, module) => {
  var cp = __require("child_process");
  var parse = require_parse();
  var enoent = require_enoent();
  function spawn2(command, args, options) {
    const parsed = parse(command, args, options);
    const spawned = cp.spawn(parsed.command, parsed.args, parsed.options);
    enoent.hookChildProcess(spawned, parsed);
    return spawned;
  }
  function spawnSync(command, args, options) {
    const parsed = parse(command, args, options);
    const result = cp.spawnSync(parsed.command, parsed.args, parsed.options);
    result.error = result.error || enoent.verifyENOENTSync(result.status, parsed);
    return result;
  }
  module.exports = spawn2;
  module.exports.spawn = spawn2;
  module.exports.sync = spawnSync;
  module.exports._parse = parse;
  module.exports._enoent = enoent;
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js
class ReadBuffer {
  append(chunk) {
    this._buffer = this._buffer ? Buffer.concat([this._buffer, chunk]) : chunk;
  }
  readMessage() {
    if (!this._buffer) {
      return null;
    }
    const index = this._buffer.indexOf(`
`);
    if (index === -1) {
      return null;
    }
    const line = this._buffer.toString("utf8", 0, index).replace(/\r$/, "");
    this._buffer = this._buffer.subarray(index + 1);
    return deserializeMessage(line);
  }
  clear() {
    this._buffer = undefined;
  }
}
function deserializeMessage(line) {
  return JSONRPCMessageSchema.parse(JSON.parse(line));
}
function serializeMessage(message) {
  return JSON.stringify(message) + `
`;
}
var init_stdio = __esm(() => {
  init_types();
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js
var exports_stdio = {};
__export(exports_stdio, {
  getDefaultEnvironment: () => getDefaultEnvironment,
  StdioClientTransport: () => StdioClientTransport,
  DEFAULT_INHERITED_ENV_VARS: () => DEFAULT_INHERITED_ENV_VARS
});
import process2 from "node:process";
import { PassThrough as PassThrough2 } from "node:stream";
function getDefaultEnvironment() {
  const env = {};
  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process2.env[key];
    if (value === undefined) {
      continue;
    }
    if (value.startsWith("()")) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

class StdioClientTransport {
  constructor(server) {
    this._readBuffer = new ReadBuffer;
    this._stderrStream = null;
    this._serverParams = server;
    if (server.stderr === "pipe" || server.stderr === "overlapped") {
      this._stderrStream = new PassThrough2;
    }
  }
  async start() {
    if (this._process) {
      throw new Error("StdioClientTransport already started! If using Client class, note that connect() calls start() automatically.");
    }
    return new Promise((resolve3, reject) => {
      this._process = import_cross_spawn.default(this._serverParams.command, this._serverParams.args ?? [], {
        env: {
          ...getDefaultEnvironment(),
          ...this._serverParams.env
        },
        stdio: ["pipe", "pipe", this._serverParams.stderr ?? "inherit"],
        shell: false,
        windowsHide: process2.platform === "win32" && isElectron(),
        cwd: this._serverParams.cwd
      });
      this._process.on("error", (error) => {
        reject(error);
        this.onerror?.(error);
      });
      this._process.on("spawn", () => {
        resolve3();
      });
      this._process.on("close", (_code) => {
        this._process = undefined;
        this.onclose?.();
      });
      this._process.stdin?.on("error", (error) => {
        this.onerror?.(error);
      });
      this._process.stdout?.on("data", (chunk) => {
        this._readBuffer.append(chunk);
        this.processReadBuffer();
      });
      this._process.stdout?.on("error", (error) => {
        this.onerror?.(error);
      });
      if (this._stderrStream && this._process.stderr) {
        this._process.stderr.pipe(this._stderrStream);
      }
    });
  }
  get stderr() {
    if (this._stderrStream) {
      return this._stderrStream;
    }
    return this._process?.stderr ?? null;
  }
  get pid() {
    return this._process?.pid ?? null;
  }
  processReadBuffer() {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }
  async close() {
    if (this._process) {
      const processToClose = this._process;
      this._process = undefined;
      const closePromise = new Promise((resolve3) => {
        processToClose.once("close", () => {
          resolve3();
        });
      });
      try {
        processToClose.stdin?.end();
      } catch {}
      await Promise.race([closePromise, new Promise((resolve3) => setTimeout(resolve3, 2000).unref())]);
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill("SIGTERM");
        } catch {}
        await Promise.race([closePromise, new Promise((resolve3) => setTimeout(resolve3, 2000).unref())]);
      }
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill("SIGKILL");
        } catch {}
      }
    }
    this._readBuffer.clear();
  }
  send(message) {
    return new Promise((resolve3) => {
      if (!this._process?.stdin) {
        throw new Error("Not connected");
      }
      const json = serializeMessage(message);
      if (this._process.stdin.write(json)) {
        resolve3();
      } else {
        this._process.stdin.once("drain", resolve3);
      }
    });
  }
}
function isElectron() {
  return "type" in process2;
}
var import_cross_spawn, DEFAULT_INHERITED_ENV_VARS;
var init_stdio2 = __esm(() => {
  init_stdio();
  import_cross_spawn = __toESM(require_cross_spawn(), 1);
  DEFAULT_INHERITED_ENV_VARS = process2.platform === "win32" ? [
    "APPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "PROCESSOR_ARCHITECTURE",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "USERNAME",
    "USERPROFILE",
    "PROGRAMFILES"
  ] : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];
});

// src/mcp/client-manager.ts
async function loadDefaultDeps() {
  if (defaultDeps2)
    return defaultDeps2;
  const { Client: Client2 } = await Promise.resolve().then(() => (init_client2(), exports_client));
  const { StdioClientTransport: StdioClientTransport2 } = await Promise.resolve().then(() => (init_stdio2(), exports_stdio));
  defaultDeps2 = {
    createClient: () => new Client2({ name: "open-cursor", version: "1.0.0" }, { capabilities: {} }),
    createTransport: (config) => {
      if (config.type === "local") {
        return new StdioClientTransport2({
          command: config.command[0],
          args: config.command.slice(1),
          env: { ...process.env, ...config.environment ?? {} },
          stderr: "pipe"
        });
      }
      throw new Error(`Remote MCP transport not yet implemented for ${config.name}`);
    }
  };
  return defaultDeps2;
}

class McpClientManager {
  connections = new Map;
  deps;
  constructor(deps) {
    this.deps = deps ?? null;
  }
  async connectServer(config) {
    if (this.connections.has(config.name)) {
      log13.debug("Server already connected, skipping", { server: config.name });
      return;
    }
    if (!this.deps) {
      try {
        this.deps = await loadDefaultDeps();
      } catch (err) {
        log13.warn("Failed to load MCP SDK", { error: String(err) });
        return;
      }
    }
    const deps = this.deps;
    let client;
    try {
      client = deps.createClient();
      const transport = deps.createTransport(config);
      await client.connect(transport);
    } catch (err) {
      log13.warn("MCP server connection failed", {
        server: config.name,
        error: String(err)
      });
      return;
    }
    let tools = [];
    try {
      const result = await client.listTools();
      tools = result?.tools ?? [];
      log13.info("MCP server connected", {
        server: config.name,
        tools: tools.length
      });
    } catch (err) {
      log13.warn("MCP tool discovery failed", {
        server: config.name,
        error: String(err)
      });
    }
    this.connections.set(config.name, { client, tools });
  }
  listTools() {
    const all = [];
    for (const [serverName, conn] of this.connections) {
      for (const tool of conn.tools) {
        all.push({ ...tool, serverName });
      }
    }
    return all;
  }
  async callTool(serverName, toolName, args) {
    const conn = this.connections.get(serverName);
    if (!conn) {
      return `Error: MCP server "${serverName}" not connected`;
    }
    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args
      });
      if (Array.isArray(result?.content)) {
        return result.content.map((c) => c.type === "text" ? c.text : JSON.stringify(c)).join(`
`);
      }
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      log13.warn("MCP tool call failed", {
        server: serverName,
        tool: toolName,
        error: String(err?.message || err)
      });
      return `Error: MCP tool "${toolName}" failed: ${err?.message || err}`;
    }
  }
  async disconnectAll() {
    for (const [name, conn] of this.connections) {
      try {
        await conn.client.close();
        log13.debug("MCP server disconnected", { server: name });
      } catch (err) {
        log13.debug("MCP server disconnect failed", { server: name, error: String(err) });
      }
    }
    this.connections.clear();
  }
  get connectedServers() {
    return Array.from(this.connections.keys());
  }
}
var log13, defaultDeps2 = null;
var init_client_manager = __esm(() => {
  init_logger();
  log13 = createLogger("mcp:client-manager");
});

// src/mcp/tool-bridge.ts
import { tool } from "@opencode-ai/plugin/tool";
function buildMcpToolHookEntries(tools, manager) {
  const z2 = tool.schema;
  const entries = {};
  for (const t of tools) {
    const hookName = namespaceMcpTool(t.serverName, t.name);
    if (entries[hookName]) {
      log14.debug("Duplicate MCP tool name, skipping", { hookName });
      continue;
    }
    const zodArgs = mcpSchemaToZod(t.inputSchema, z2);
    const serverName = t.serverName;
    const toolName = t.name;
    entries[hookName] = tool({
      description: t.description || `MCP tool: ${t.name} (server: ${t.serverName})`,
      args: zodArgs,
      async execute(args) {
        log14.debug("Executing MCP tool", { server: serverName, tool: toolName });
        const result = await manager.callTool(serverName, toolName, args ?? {});
        if (result.startsWith("Error:")) {
          throw new Error(result);
        }
        return result;
      }
    });
  }
  log14.debug("Built MCP tool hook entries", { count: Object.keys(entries).length });
  return entries;
}
function buildMcpToolDefinitions(tools) {
  const defs = [];
  for (const t of tools) {
    const name = namespaceMcpTool(t.serverName, t.name);
    defs.push({
      type: "function",
      function: {
        name,
        description: t.description || `MCP tool: ${t.name} (server: ${t.serverName})`,
        parameters: t.inputSchema ?? { type: "object", properties: {} }
      }
    });
  }
  return defs;
}
function namespaceMcpTool(serverName, toolName) {
  const sanitizedServer = serverName.replace(/[^a-zA-Z0-9]/g, "_");
  const sanitizedTool = toolName.replace(/[^a-zA-Z0-9]/g, "_");
  return `${MCP_TOOL_PREFIX}${sanitizedServer}__${sanitizedTool}`;
}
function mcpSchemaToZod(inputSchema, z2) {
  if (!inputSchema || typeof inputSchema !== "object") {
    return {};
  }
  const properties = inputSchema.properties ?? {};
  const required = inputSchema.required ?? [];
  const shape = {};
  for (const [key, prop] of Object.entries(properties)) {
    let zodType;
    switch (prop?.type) {
      case "string":
        zodType = z2.string();
        break;
      case "number":
      case "integer":
        zodType = z2.number();
        break;
      case "boolean":
        zodType = z2.boolean();
        break;
      case "array":
        zodType = z2.array(z2.any());
        break;
      case "object":
        zodType = z2.record(z2.string(), z2.any());
        break;
      default:
        zodType = z2.any();
        break;
    }
    if (prop?.description) {
      zodType = zodType.describe(prop.description);
    }
    if (!required.includes(key)) {
      zodType = zodType.optional();
    }
    shape[key] = zodType;
  }
  return shape;
}
var log14, MCP_TOOL_PREFIX = "mcp__";
var init_tool_bridge = __esm(() => {
  init_logger();
  log14 = createLogger("mcp:tool-bridge");
});

// node_modules/@opencode-ai/sdk/dist/gen/types.gen.js
var init_types_gen = () => {};

// node_modules/@opencode-ai/sdk/dist/gen/core/serverSentEvents.gen.js
var createSseClient = ({ onSseError, onSseEvent, responseTransformer, responseValidator, sseDefaultRetryDelay, sseMaxRetryAttempts, sseMaxRetryDelay, sseSleepFn, url, ...options }) => {
  let lastEventId;
  const sleep = sseSleepFn ?? ((ms) => new Promise((resolve3) => setTimeout(resolve3, ms)));
  const createStream = async function* () {
    let retryDelay = sseDefaultRetryDelay ?? 3000;
    let attempt = 0;
    const signal = options.signal ?? new AbortController().signal;
    while (true) {
      if (signal.aborted)
        break;
      attempt++;
      const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
      if (lastEventId !== undefined) {
        headers.set("Last-Event-ID", lastEventId);
      }
      try {
        const response = await fetch(url, { ...options, headers, signal });
        if (!response.ok)
          throw new Error(`SSE failed: ${response.status} ${response.statusText}`);
        if (!response.body)
          throw new Error("No body in SSE response");
        const reader = response.body.pipeThrough(new TextDecoderStream).getReader();
        let buffer = "";
        const abortHandler = () => {
          try {
            reader.cancel();
          } catch {}
        };
        signal.addEventListener("abort", abortHandler);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            buffer += value;
            const chunks = buffer.split(`

`);
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const lines = chunk.split(`
`);
              const dataLines = [];
              let eventName;
              for (const line of lines) {
                if (line.startsWith("data:")) {
                  dataLines.push(line.replace(/^data:\s*/, ""));
                } else if (line.startsWith("event:")) {
                  eventName = line.replace(/^event:\s*/, "");
                } else if (line.startsWith("id:")) {
                  lastEventId = line.replace(/^id:\s*/, "");
                } else if (line.startsWith("retry:")) {
                  const parsed = Number.parseInt(line.replace(/^retry:\s*/, ""), 10);
                  if (!Number.isNaN(parsed)) {
                    retryDelay = parsed;
                  }
                }
              }
              let data;
              let parsedJson = false;
              if (dataLines.length) {
                const rawData = dataLines.join(`
`);
                try {
                  data = JSON.parse(rawData);
                  parsedJson = true;
                } catch {
                  data = rawData;
                }
              }
              if (parsedJson) {
                if (responseValidator) {
                  await responseValidator(data);
                }
                if (responseTransformer) {
                  data = await responseTransformer(data);
                }
              }
              onSseEvent?.({
                data,
                event: eventName,
                id: lastEventId,
                retry: retryDelay
              });
              if (dataLines.length) {
                yield data;
              }
            }
          }
        } finally {
          signal.removeEventListener("abort", abortHandler);
          reader.releaseLock();
        }
        break;
      } catch (error) {
        onSseError?.(error);
        if (sseMaxRetryAttempts !== undefined && attempt >= sseMaxRetryAttempts) {
          break;
        }
        const backoff = Math.min(retryDelay * 2 ** (attempt - 1), sseMaxRetryDelay ?? 30000);
        await sleep(backoff);
      }
    }
  };
  const stream = createStream();
  return { stream };
};

// node_modules/@opencode-ai/sdk/dist/gen/core/auth.gen.js
var getAuthToken = async (auth, callback) => {
  const token = typeof callback === "function" ? await callback(auth) : callback;
  if (!token) {
    return;
  }
  if (auth.scheme === "bearer") {
    return `Bearer ${token}`;
  }
  if (auth.scheme === "basic") {
    return `Basic ${btoa(token)}`;
  }
  return token;
};

// node_modules/@opencode-ai/sdk/dist/gen/core/bodySerializer.gen.js
var jsonBodySerializer;
var init_bodySerializer_gen = __esm(() => {
  jsonBodySerializer = {
    bodySerializer: (body) => JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value)
  };
});

// node_modules/@opencode-ai/sdk/dist/gen/core/pathSerializer.gen.js
var separatorArrayExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
}, separatorArrayNoExplode = (style) => {
  switch (style) {
    case "form":
      return ",";
    case "pipeDelimited":
      return "|";
    case "spaceDelimited":
      return "%20";
    default:
      return ",";
  }
}, separatorObjectExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
}, serializeArrayParam = ({ allowReserved, explode, name, style, value }) => {
  if (!explode) {
    const joinedValues2 = (allowReserved ? value : value.map((v) => encodeURIComponent(v))).join(separatorArrayNoExplode(style));
    switch (style) {
      case "label":
        return `.${joinedValues2}`;
      case "matrix":
        return `;${name}=${joinedValues2}`;
      case "simple":
        return joinedValues2;
      default:
        return `${name}=${joinedValues2}`;
    }
  }
  const separator = separatorArrayExplode(style);
  const joinedValues = value.map((v) => {
    if (style === "label" || style === "simple") {
      return allowReserved ? v : encodeURIComponent(v);
    }
    return serializePrimitiveParam({
      allowReserved,
      name,
      value: v
    });
  }).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
}, serializePrimitiveParam = ({ allowReserved, name, value }) => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    throw new Error("Deeply-nested arrays/objects aren窶冲 supported. Provide your own `querySerializer()` to handle these.");
  }
  return `${name}=${allowReserved ? value : encodeURIComponent(value)}`;
}, serializeObjectParam = ({ allowReserved, explode, name, style, value, valueOnly }) => {
  if (value instanceof Date) {
    return valueOnly ? value.toISOString() : `${name}=${value.toISOString()}`;
  }
  if (style !== "deepObject" && !explode) {
    let values = [];
    Object.entries(value).forEach(([key, v]) => {
      values = [...values, key, allowReserved ? v : encodeURIComponent(v)];
    });
    const joinedValues2 = values.join(",");
    switch (style) {
      case "form":
        return `${name}=${joinedValues2}`;
      case "label":
        return `.${joinedValues2}`;
      case "matrix":
        return `;${name}=${joinedValues2}`;
      default:
        return joinedValues2;
    }
  }
  const separator = separatorObjectExplode(style);
  const joinedValues = Object.entries(value).map(([key, v]) => serializePrimitiveParam({
    allowReserved,
    name: style === "deepObject" ? `${name}[${key}]` : key,
    value: v
  })).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};

// node_modules/@opencode-ai/sdk/dist/gen/core/utils.gen.js
var PATH_PARAM_RE, defaultPathSerializer = ({ path: path2, url: _url }) => {
  let url = _url;
  const matches = _url.match(PATH_PARAM_RE);
  if (matches) {
    for (const match of matches) {
      let explode = false;
      let name = match.substring(1, match.length - 1);
      let style = "simple";
      if (name.endsWith("*")) {
        explode = true;
        name = name.substring(0, name.length - 1);
      }
      if (name.startsWith(".")) {
        name = name.substring(1);
        style = "label";
      } else if (name.startsWith(";")) {
        name = name.substring(1);
        style = "matrix";
      }
      const value = path2[name];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        url = url.replace(match, serializeArrayParam({ explode, name, style, value }));
        continue;
      }
      if (typeof value === "object") {
        url = url.replace(match, serializeObjectParam({
          explode,
          name,
          style,
          value,
          valueOnly: true
        }));
        continue;
      }
      if (style === "matrix") {
        url = url.replace(match, `;${serializePrimitiveParam({
          name,
          value
        })}`);
        continue;
      }
      const replaceValue = encodeURIComponent(style === "label" ? `.${value}` : value);
      url = url.replace(match, replaceValue);
    }
  }
  return url;
}, getUrl = ({ baseUrl, path: path2, query, querySerializer, url: _url }) => {
  const pathUrl = _url.startsWith("/") ? _url : `/${_url}`;
  let url = (baseUrl ?? "") + pathUrl;
  if (path2) {
    url = defaultPathSerializer({ path: path2, url });
  }
  let search = query ? querySerializer(query) : "";
  if (search.startsWith("?")) {
    search = search.substring(1);
  }
  if (search) {
    url += `?${search}`;
  }
  return url;
};
var init_utils_gen = __esm(() => {
  PATH_PARAM_RE = /\{[^{}]+\}/g;
});

// node_modules/@opencode-ai/sdk/dist/gen/client/utils.gen.js
class Interceptors {
  _fns;
  constructor() {
    this._fns = [];
  }
  clear() {
    this._fns = [];
  }
  getInterceptorIndex(id) {
    if (typeof id === "number") {
      return this._fns[id] ? id : -1;
    } else {
      return this._fns.indexOf(id);
    }
  }
  exists(id) {
    const index = this.getInterceptorIndex(id);
    return !!this._fns[index];
  }
  eject(id) {
    const index = this.getInterceptorIndex(id);
    if (this._fns[index]) {
      this._fns[index] = null;
    }
  }
  update(id, fn) {
    const index = this.getInterceptorIndex(id);
    if (this._fns[index]) {
      this._fns[index] = fn;
      return id;
    } else {
      return false;
    }
  }
  use(fn) {
    this._fns = [...this._fns, fn];
    return this._fns.length - 1;
  }
}
var createQuerySerializer = ({ allowReserved, array: array3, object: object5 } = {}) => {
  const querySerializer = (queryParams) => {
    const search = [];
    if (queryParams && typeof queryParams === "object") {
      for (const name in queryParams) {
        const value = queryParams[name];
        if (value === undefined || value === null) {
          continue;
        }
        if (Array.isArray(value)) {
          const serializedArray = serializeArrayParam({
            allowReserved,
            explode: true,
            name,
            style: "form",
            value,
            ...array3
          });
          if (serializedArray)
            search.push(serializedArray);
        } else if (typeof value === "object") {
          const serializedObject = serializeObjectParam({
            allowReserved,
            explode: true,
            name,
            style: "deepObject",
            value,
            ...object5
          });
          if (serializedObject)
            search.push(serializedObject);
        } else {
          const serializedPrimitive = serializePrimitiveParam({
            allowReserved,
            name,
            value
          });
          if (serializedPrimitive)
            search.push(serializedPrimitive);
        }
      }
    }
    return search.join("&");
  };
  return querySerializer;
}, getParseAs = (contentType) => {
  if (!contentType) {
    return "stream";
  }
  const cleanContent = contentType.split(";")[0]?.trim();
  if (!cleanContent) {
    return;
  }
  if (cleanContent.startsWith("application/json") || cleanContent.endsWith("+json")) {
    return "json";
  }
  if (cleanContent === "multipart/form-data") {
    return "formData";
  }
  if (["application/", "audio/", "image/", "video/"].some((type) => cleanContent.startsWith(type))) {
    return "blob";
  }
  if (cleanContent.startsWith("text/")) {
    return "text";
  }
  return;
}, checkForExistence = (options, name) => {
  if (!name) {
    return false;
  }
  if (options.headers.has(name) || options.query?.[name] || options.headers.get("Cookie")?.includes(`${name}=`)) {
    return true;
  }
  return false;
}, setAuthParams = async ({ security, ...options }) => {
  for (const auth of security) {
    if (checkForExistence(options, auth.name)) {
      continue;
    }
    const token = await getAuthToken(auth, options.auth);
    if (!token) {
      continue;
    }
    const name = auth.name ?? "Authorization";
    switch (auth.in) {
      case "query":
        if (!options.query) {
          options.query = {};
        }
        options.query[name] = token;
        break;
      case "cookie":
        options.headers.append("Cookie", `${name}=${token}`);
        break;
      case "header":
      default:
        options.headers.set(name, token);
        break;
    }
  }
}, buildUrl = (options) => getUrl({
  baseUrl: options.baseUrl,
  path: options.path,
  query: options.query,
  querySerializer: typeof options.querySerializer === "function" ? options.querySerializer : createQuerySerializer(options.querySerializer),
  url: options.url
}), mergeConfigs = (a, b) => {
  const config = { ...a, ...b };
  if (config.baseUrl?.endsWith("/")) {
    config.baseUrl = config.baseUrl.substring(0, config.baseUrl.length - 1);
  }
  config.headers = mergeHeaders(a.headers, b.headers);
  return config;
}, mergeHeaders = (...headers) => {
  const mergedHeaders = new Headers;
  for (const header of headers) {
    if (!header || typeof header !== "object") {
      continue;
    }
    const iterator = header instanceof Headers ? header.entries() : Object.entries(header);
    for (const [key, value] of iterator) {
      if (value === null) {
        mergedHeaders.delete(key);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          mergedHeaders.append(key, v);
        }
      } else if (value !== undefined) {
        mergedHeaders.set(key, typeof value === "object" ? JSON.stringify(value) : value);
      }
    }
  }
  return mergedHeaders;
}, createInterceptors = () => ({
  error: new Interceptors,
  request: new Interceptors,
  response: new Interceptors
}), defaultQuerySerializer, defaultHeaders, createConfig = (override = {}) => ({
  ...jsonBodySerializer,
  headers: defaultHeaders,
  parseAs: "auto",
  querySerializer: defaultQuerySerializer,
  ...override
});
var init_utils_gen2 = __esm(() => {
  init_bodySerializer_gen();
  init_utils_gen();
  defaultQuerySerializer = createQuerySerializer({
    allowReserved: false,
    array: {
      explode: true,
      style: "form"
    },
    object: {
      explode: true,
      style: "deepObject"
    }
  });
  defaultHeaders = {
    "Content-Type": "application/json"
  };
});

// node_modules/@opencode-ai/sdk/dist/gen/client/client.gen.js
var createClient = (config = {}) => {
  let _config = mergeConfigs(createConfig(), config);
  const getConfig = () => ({ ..._config });
  const setConfig = (config2) => {
    _config = mergeConfigs(_config, config2);
    return getConfig();
  };
  const interceptors = createInterceptors();
  const beforeRequest = async (options) => {
    const opts = {
      ..._config,
      ...options,
      fetch: options.fetch ?? _config.fetch ?? globalThis.fetch,
      headers: mergeHeaders(_config.headers, options.headers),
      serializedBody: undefined
    };
    if (opts.security) {
      await setAuthParams({
        ...opts,
        security: opts.security
      });
    }
    if (opts.requestValidator) {
      await opts.requestValidator(opts);
    }
    if (opts.body && opts.bodySerializer) {
      opts.serializedBody = opts.bodySerializer(opts.body);
    }
    if (opts.serializedBody === undefined || opts.serializedBody === "") {
      opts.headers.delete("Content-Type");
    }
    const url = buildUrl(opts);
    return { opts, url };
  };
  const request = async (options) => {
    const { opts, url } = await beforeRequest(options);
    const requestInit = {
      redirect: "follow",
      ...opts,
      body: opts.serializedBody
    };
    let request2 = new Request(url, requestInit);
    for (const fn of interceptors.request._fns) {
      if (fn) {
        request2 = await fn(request2, opts);
      }
    }
    const _fetch = opts.fetch;
    let response = await _fetch(request2);
    for (const fn of interceptors.response._fns) {
      if (fn) {
        response = await fn(response, request2, opts);
      }
    }
    const result = {
      request: request2,
      response
    };
    if (response.ok) {
      if (response.status === 204 || response.headers.get("Content-Length") === "0") {
        return opts.responseStyle === "data" ? {} : {
          data: {},
          ...result
        };
      }
      const parseAs = (opts.parseAs === "auto" ? getParseAs(response.headers.get("Content-Type")) : opts.parseAs) ?? "json";
      let data;
      switch (parseAs) {
        case "arrayBuffer":
        case "blob":
        case "formData":
        case "json":
        case "text":
          data = await response[parseAs]();
          break;
        case "stream":
          return opts.responseStyle === "data" ? response.body : {
            data: response.body,
            ...result
          };
      }
      if (parseAs === "json") {
        if (opts.responseValidator) {
          await opts.responseValidator(data);
        }
        if (opts.responseTransformer) {
          data = await opts.responseTransformer(data);
        }
      }
      return opts.responseStyle === "data" ? data : {
        data,
        ...result
      };
    }
    const textError = await response.text();
    let jsonError;
    try {
      jsonError = JSON.parse(textError);
    } catch {}
    const error = jsonError ?? textError;
    let finalError = error;
    for (const fn of interceptors.error._fns) {
      if (fn) {
        finalError = await fn(error, response, request2, opts);
      }
    }
    finalError = finalError || {};
    if (opts.throwOnError) {
      throw finalError;
    }
    return opts.responseStyle === "data" ? undefined : {
      error: finalError,
      ...result
    };
  };
  const makeMethod = (method) => {
    const fn = (options) => request({ ...options, method });
    fn.sse = async (options) => {
      const { opts, url } = await beforeRequest(options);
      return createSseClient({
        ...opts,
        body: opts.body,
        headers: opts.headers,
        method,
        url
      });
    };
    return fn;
  };
  return {
    buildUrl,
    connect: makeMethod("CONNECT"),
    delete: makeMethod("DELETE"),
    get: makeMethod("GET"),
    getConfig,
    head: makeMethod("HEAD"),
    interceptors,
    options: makeMethod("OPTIONS"),
    patch: makeMethod("PATCH"),
    post: makeMethod("POST"),
    put: makeMethod("PUT"),
    request,
    setConfig,
    trace: makeMethod("TRACE")
  };
};
var init_client_gen = __esm(() => {
  init_utils_gen2();
});

// node_modules/@opencode-ai/sdk/dist/gen/core/params.gen.js
var extraPrefixesMap, extraPrefixes;
var init_params_gen = __esm(() => {
  extraPrefixesMap = {
    $body_: "body",
    $headers_: "headers",
    $path_: "path",
    $query_: "query"
  };
  extraPrefixes = Object.entries(extraPrefixesMap);
});

// node_modules/@opencode-ai/sdk/dist/gen/client/index.js
var init_client3 = __esm(() => {
  init_bodySerializer_gen();
  init_params_gen();
  init_client_gen();
  init_utils_gen2();
});

// node_modules/@opencode-ai/sdk/dist/gen/client.gen.js
var client;
var init_client_gen2 = __esm(() => {
  init_client3();
  client = createClient(createConfig({
    baseUrl: "http://localhost:4096"
  }));
});

// node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.js
class _HeyApiClient {
  _client = client;
  constructor(args) {
    if (args?.client) {
      this._client = args.client;
    }
  }
}
var Global, Project, Pty, Config, Tool, Instance, Path, Vcs, Session, Command, Oauth, Provider, Find, File, App, Auth, Mcp, Lsp, Formatter, Control, Tui, Event, OpencodeClient;
var init_sdk_gen = __esm(() => {
  init_client_gen2();
  Global = class Global extends _HeyApiClient {
    event(options) {
      return (options?.client ?? this._client).get.sse({
        url: "/global/event",
        ...options
      });
    }
  };
  Project = class Project extends _HeyApiClient {
    list(options) {
      return (options?.client ?? this._client).get({
        url: "/project",
        ...options
      });
    }
    current(options) {
      return (options?.client ?? this._client).get({
        url: "/project/current",
        ...options
      });
    }
  };
  Pty = class Pty extends _HeyApiClient {
    list(options) {
      return (options?.client ?? this._client).get({
        url: "/pty",
        ...options
      });
    }
    create(options) {
      return (options?.client ?? this._client).post({
        url: "/pty",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    remove(options) {
      return (options.client ?? this._client).delete({
        url: "/pty/{id}",
        ...options
      });
    }
    get(options) {
      return (options.client ?? this._client).get({
        url: "/pty/{id}",
        ...options
      });
    }
    update(options) {
      return (options.client ?? this._client).put({
        url: "/pty/{id}",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    connect(options) {
      return (options.client ?? this._client).get({
        url: "/pty/{id}/connect",
        ...options
      });
    }
  };
  Config = class Config extends _HeyApiClient {
    get(options) {
      return (options?.client ?? this._client).get({
        url: "/config",
        ...options
      });
    }
    update(options) {
      return (options?.client ?? this._client).patch({
        url: "/config",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    providers(options) {
      return (options?.client ?? this._client).get({
        url: "/config/providers",
        ...options
      });
    }
  };
  Tool = class Tool extends _HeyApiClient {
    ids(options) {
      return (options?.client ?? this._client).get({
        url: "/experimental/tool/ids",
        ...options
      });
    }
    list(options) {
      return (options.client ?? this._client).get({
        url: "/experimental/tool",
        ...options
      });
    }
  };
  Instance = class Instance extends _HeyApiClient {
    dispose(options) {
      return (options?.client ?? this._client).post({
        url: "/instance/dispose",
        ...options
      });
    }
  };
  Path = class Path extends _HeyApiClient {
    get(options) {
      return (options?.client ?? this._client).get({
        url: "/path",
        ...options
      });
    }
  };
  Vcs = class Vcs extends _HeyApiClient {
    get(options) {
      return (options?.client ?? this._client).get({
        url: "/vcs",
        ...options
      });
    }
  };
  Session = class Session extends _HeyApiClient {
    list(options) {
      return (options?.client ?? this._client).get({
        url: "/session",
        ...options
      });
    }
    create(options) {
      return (options?.client ?? this._client).post({
        url: "/session",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    status(options) {
      return (options?.client ?? this._client).get({
        url: "/session/status",
        ...options
      });
    }
    delete(options) {
      return (options.client ?? this._client).delete({
        url: "/session/{id}",
        ...options
      });
    }
    get(options) {
      return (options.client ?? this._client).get({
        url: "/session/{id}",
        ...options
      });
    }
    update(options) {
      return (options.client ?? this._client).patch({
        url: "/session/{id}",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    children(options) {
      return (options.client ?? this._client).get({
        url: "/session/{id}/children",
        ...options
      });
    }
    todo(options) {
      return (options.client ?? this._client).get({
        url: "/session/{id}/todo",
        ...options
      });
    }
    init(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/init",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    fork(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/fork",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    abort(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/abort",
        ...options
      });
    }
    unshare(options) {
      return (options.client ?? this._client).delete({
        url: "/session/{id}/share",
        ...options
      });
    }
    share(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/share",
        ...options
      });
    }
    diff(options) {
      return (options.client ?? this._client).get({
        url: "/session/{id}/diff",
        ...options
      });
    }
    summarize(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/summarize",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    messages(options) {
      return (options.client ?? this._client).get({
        url: "/session/{id}/message",
        ...options
      });
    }
    prompt(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/message",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    message(options) {
      return (options.client ?? this._client).get({
        url: "/session/{id}/message/{messageID}",
        ...options
      });
    }
    promptAsync(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/prompt_async",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    command(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/command",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    shell(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/shell",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    revert(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/revert",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    unrevert(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/unrevert",
        ...options
      });
    }
  };
  Command = class Command extends _HeyApiClient {
    list(options) {
      return (options?.client ?? this._client).get({
        url: "/command",
        ...options
      });
    }
  };
  Oauth = class Oauth extends _HeyApiClient {
    authorize(options) {
      return (options.client ?? this._client).post({
        url: "/provider/{id}/oauth/authorize",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    callback(options) {
      return (options.client ?? this._client).post({
        url: "/provider/{id}/oauth/callback",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
  };
  Provider = class Provider extends _HeyApiClient {
    list(options) {
      return (options?.client ?? this._client).get({
        url: "/provider",
        ...options
      });
    }
    auth(options) {
      return (options?.client ?? this._client).get({
        url: "/provider/auth",
        ...options
      });
    }
    oauth = new Oauth({ client: this._client });
  };
  Find = class Find extends _HeyApiClient {
    text(options) {
      return (options.client ?? this._client).get({
        url: "/find",
        ...options
      });
    }
    files(options) {
      return (options.client ?? this._client).get({
        url: "/find/file",
        ...options
      });
    }
    symbols(options) {
      return (options.client ?? this._client).get({
        url: "/find/symbol",
        ...options
      });
    }
  };
  File = class File extends _HeyApiClient {
    list(options) {
      return (options.client ?? this._client).get({
        url: "/file",
        ...options
      });
    }
    read(options) {
      return (options.client ?? this._client).get({
        url: "/file/content",
        ...options
      });
    }
    status(options) {
      return (options?.client ?? this._client).get({
        url: "/file/status",
        ...options
      });
    }
  };
  App = class App extends _HeyApiClient {
    log(options) {
      return (options?.client ?? this._client).post({
        url: "/log",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    agents(options) {
      return (options?.client ?? this._client).get({
        url: "/agent",
        ...options
      });
    }
  };
  Auth = class Auth extends _HeyApiClient {
    remove(options) {
      return (options.client ?? this._client).delete({
        url: "/mcp/{name}/auth",
        ...options
      });
    }
    start(options) {
      return (options.client ?? this._client).post({
        url: "/mcp/{name}/auth",
        ...options
      });
    }
    callback(options) {
      return (options.client ?? this._client).post({
        url: "/mcp/{name}/auth/callback",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    authenticate(options) {
      return (options.client ?? this._client).post({
        url: "/mcp/{name}/auth/authenticate",
        ...options
      });
    }
    set(options) {
      return (options.client ?? this._client).put({
        url: "/auth/{id}",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
  };
  Mcp = class Mcp extends _HeyApiClient {
    status(options) {
      return (options?.client ?? this._client).get({
        url: "/mcp",
        ...options
      });
    }
    add(options) {
      return (options?.client ?? this._client).post({
        url: "/mcp",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    connect(options) {
      return (options.client ?? this._client).post({
        url: "/mcp/{name}/connect",
        ...options
      });
    }
    disconnect(options) {
      return (options.client ?? this._client).post({
        url: "/mcp/{name}/disconnect",
        ...options
      });
    }
    auth = new Auth({ client: this._client });
  };
  Lsp = class Lsp extends _HeyApiClient {
    status(options) {
      return (options?.client ?? this._client).get({
        url: "/lsp",
        ...options
      });
    }
  };
  Formatter = class Formatter extends _HeyApiClient {
    status(options) {
      return (options?.client ?? this._client).get({
        url: "/formatter",
        ...options
      });
    }
  };
  Control = class Control extends _HeyApiClient {
    next(options) {
      return (options?.client ?? this._client).get({
        url: "/tui/control/next",
        ...options
      });
    }
    response(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/control/response",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
  };
  Tui = class Tui extends _HeyApiClient {
    appendPrompt(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/append-prompt",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    openHelp(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/open-help",
        ...options
      });
    }
    openSessions(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/open-sessions",
        ...options
      });
    }
    openThemes(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/open-themes",
        ...options
      });
    }
    openModels(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/open-models",
        ...options
      });
    }
    submitPrompt(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/submit-prompt",
        ...options
      });
    }
    clearPrompt(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/clear-prompt",
        ...options
      });
    }
    executeCommand(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/execute-command",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    showToast(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/show-toast",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    publish(options) {
      return (options?.client ?? this._client).post({
        url: "/tui/publish",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers
        }
      });
    }
    control = new Control({ client: this._client });
  };
  Event = class Event extends _HeyApiClient {
    subscribe(options) {
      return (options?.client ?? this._client).get.sse({
        url: "/event",
        ...options
      });
    }
  };
  OpencodeClient = class OpencodeClient extends _HeyApiClient {
    postSessionIdPermissionsPermissionId(options) {
      return (options.client ?? this._client).post({
        url: "/session/{id}/permissions/{permissionID}",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    }
    global = new Global({ client: this._client });
    project = new Project({ client: this._client });
    pty = new Pty({ client: this._client });
    config = new Config({ client: this._client });
    tool = new Tool({ client: this._client });
    instance = new Instance({ client: this._client });
    path = new Path({ client: this._client });
    vcs = new Vcs({ client: this._client });
    session = new Session({ client: this._client });
    command = new Command({ client: this._client });
    provider = new Provider({ client: this._client });
    find = new Find({ client: this._client });
    file = new File({ client: this._client });
    app = new App({ client: this._client });
    mcp = new Mcp({ client: this._client });
    lsp = new Lsp({ client: this._client });
    formatter = new Formatter({ client: this._client });
    tui = new Tui({ client: this._client });
    auth = new Auth({ client: this._client });
    event = new Event({ client: this._client });
  };
});

// node_modules/@opencode-ai/sdk/dist/client.js
function createOpencodeClient(config) {
  if (!config?.fetch) {
    const customFetch = (req) => {
      req.timeout = false;
      return fetch(req);
    };
    config = {
      ...config,
      fetch: customFetch
    };
  }
  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": config.directory
    };
  }
  const client2 = createClient(config);
  return new OpencodeClient({ client: client2 });
}
var init_client4 = __esm(() => {
  init_client_gen();
  init_sdk_gen();
  init_types_gen();
});

// node_modules/@opencode-ai/sdk/dist/server.js
var init_server = () => {};

// node_modules/@opencode-ai/sdk/dist/index.js
var init_dist = __esm(() => {
  init_client4();
  init_server();
  init_client4();
  init_server();
});

// src/tools/core/registry.ts
class ToolRegistry {
  tools = new Map;
  register(tool2, handler) {
    this.tools.set(tool2.name, { tool: tool2, handler });
  }
  getHandler(name) {
    return this.tools.get(name)?.handler;
  }
  getTool(name) {
    return this.tools.get(name)?.tool;
  }
  list() {
    return Array.from(this.tools.values()).map((t) => t.tool);
  }
}

// src/tools/executors/local.ts
class LocalExecutor {
  registry;
  constructor(registry) {
    this.registry = registry;
  }
  canExecute(toolId) {
    return Boolean(this.registry.getHandler(toolId));
  }
  async execute(toolId, args) {
    const handler = this.registry.getHandler(toolId);
    if (!handler)
      return { status: "error", error: `Unknown tool ${toolId}` };
    try {
      const out = await handler(args);
      return { status: "success", output: out };
    } catch (err) {
      log15.warn("Local tool execution failed", { toolId, error: String(err?.message || err) });
      return { status: "error", error: String(err?.message || err) };
    }
  }
}
var log15;
var init_local = __esm(() => {
  init_logger();
  log15 = createLogger("tools:executor:local");
});

// src/tools/executors/sdk.ts
class SdkExecutor {
  client;
  timeoutMs;
  toolIds = new Set;
  constructor(client3, timeoutMs) {
    this.client = client3;
    this.timeoutMs = timeoutMs;
  }
  setToolIds(ids) {
    this.toolIds = new Set(ids);
  }
  canExecute(toolId) {
    return this.toolIds.has(toolId) && Boolean(this.client?.tool?.invoke);
  }
  async execute(toolId, args) {
    if (!this.canExecute(toolId))
      return { status: "error", error: "SDK invoke unavailable" };
    try {
      const p = this.client.tool.invoke(toolId, args);
      const res = await this.runWithTimeout(p);
      const out = typeof res === "string" ? res : JSON.stringify(res);
      return { status: "success", output: out };
    } catch (err) {
      log16.warn("SDK tool execution failed", { toolId, error: String(err?.message || err) });
      return { status: "error", error: String(err?.message || err) };
    }
  }
  async runWithTimeout(p) {
    if (!this.timeoutMs)
      return p;
    return await Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error("tool execution timeout")), this.timeoutMs))
    ]);
  }
}
var log16;
var init_sdk = __esm(() => {
  init_logger();
  log16 = createLogger("tools:executor:sdk");
});

// src/tools/executors/mcp.ts
class McpExecutor {
  client;
  timeoutMs;
  toolIds = new Set;
  constructor(client3, timeoutMs) {
    this.client = client3;
    this.timeoutMs = timeoutMs;
  }
  setToolIds(ids) {
    this.toolIds = new Set(ids);
  }
  canExecute(toolId) {
    return Boolean(this.client?.mcp?.tool?.invoke) && this.toolIds.has(toolId);
  }
  async execute(toolId, args) {
    if (!this.canExecute(toolId))
      return { status: "error", error: "MCP invoke unavailable" };
    try {
      const p = this.client.mcp.tool.invoke(toolId, args);
      const res = await this.runWithTimeout(p);
      const out = typeof res === "string" ? res : JSON.stringify(res);
      return { status: "success", output: out };
    } catch (err) {
      log17.warn("MCP tool execution failed", { toolId, error: String(err?.message || err) });
      return { status: "error", error: String(err?.message || err) };
    }
  }
  async runWithTimeout(p) {
    if (!this.timeoutMs)
      return p;
    return await Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error("tool execution timeout")), this.timeoutMs))
    ]);
  }
}
var log17;
var init_mcp = __esm(() => {
  init_logger();
  log17 = createLogger("tools:executor:mcp");
});

// src/tools/core/executor.ts
async function executeWithChain(executors, toolId, args) {
  for (const ex of executors) {
    if (ex.canExecute(toolId)) {
      try {
        return await ex.execute(toolId, args);
      } catch (err) {
        log18.warn("Executor threw unexpected error", { toolId, error: String(err?.message || err) });
        return { status: "error", error: String(err?.message || err) };
      }
    }
  }
  return { status: "error", error: `No executor available for ${toolId}` };
}
var log18;
var init_executor = __esm(() => {
  init_logger();
  log18 = createLogger("tools:executor:chain");
});

// src/tools/defaults.ts
function registerDefaultTools(registry) {
  registry.register({
    id: "bash",
    name: "bash",
    description: "Execute a shell command. Use this to run programs/tests; prefer write/edit for creating or modifying files.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute"
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 30)"
        },
        cwd: {
          type: "string",
          description: "Working directory for the command"
        }
      },
      required: ["command"]
    },
    source: "local"
  }, async (args) => {
    const { spawn: spawn3 } = await import("child_process");
    const command = resolveBashCommand(args);
    if (!command) {
      throw new Error("bash: missing required argument 'command'");
    }
    const timeoutMs = resolveTimeoutMs(args.timeout);
    const cwd = resolveWorkingDirectory(args);
    return new Promise((resolve3, reject) => {
      const proc = spawn3(command, {
        shell: resolveShellOption(),
        cwd
      });
      const stdoutChunks = [];
      const stderrChunks = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, timeoutMs);
      proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
      proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));
      proc.on("close", (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const output = stdout || stderr || "Command executed successfully";
        if (timedOut) {
          resolve3(`Command timed out after ${timeoutMs / 1000}s
${output}`);
        } else if (code !== 0) {
          resolve3(`${output}
[Exit code: ${code}]`);
        } else {
          resolve3(output);
        }
      });
      proc.on("error", reject);
    });
  });
  registry.register({
    id: "read",
    name: "read",
    description: "Read the contents of a file",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to read"
        },
        offset: {
          type: "number",
          description: "Line number to start reading from"
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read"
        }
      },
      required: ["path"]
    },
    source: "local"
  }, async (args) => {
    const fs2 = await import("fs");
    try {
      const path2 = args.path;
      const offset = args.offset;
      const limit = args.limit;
      let content = fs2.readFileSync(path2, "utf-8");
      if (offset !== undefined || limit !== undefined) {
        const lines = content.split(`
`);
        const start = offset || 0;
        const end = limit ? start + limit : lines.length;
        content = lines.slice(start, end).join(`
`);
      }
      return content;
    } catch (error) {
      throw error;
    }
  });
  registry.register({
    id: "write",
    name: "write",
    description: `Write content to a file. ${WRITE_TOOL_TARGETED_EDIT_CONTRACT}`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to write"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        },
        force: {
          type: "boolean",
          description: "Set true only when intentionally replacing an existing file with complete content"
        }
      },
      required: ["path", "content"]
    },
    source: "local"
  }, async (args) => {
    const fs2 = await import("fs");
    const path2 = await import("path");
    try {
      const filePath = args.path;
      const content = args.content;
      const force = args.force === true;
      return writeFullFileWithOverwriteGuard(fs2, path2, filePath, content, force, "write");
    } catch (error) {
      throw error;
    }
  });
  registry.register({
    id: "edit",
    name: "edit",
    description: "Edit a file by replacing old text with new text. Use for targeted replacements; use write to overwrite an entire file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to edit"
        },
        old_string: {
          type: "string",
          description: "The text to replace"
        },
        new_string: {
          type: "string",
          description: "The replacement text"
        },
        content: {
          type: "string",
          description: "Compatibility field for full-file content emitted by cursor-agent"
        },
        streamContent: {
          type: "string",
          description: "Compatibility field for full-file content emitted by cursor-agent"
        }
      },
      required: ["path", "old_string", "new_string"]
    },
    source: "local"
  }, async (args) => {
    const fs2 = await import("fs");
    const path2 = await import("path");
    try {
      const resolvedArgs = resolveEditArguments(args);
      const filePath = resolvedArgs.path;
      const oldString = resolvedArgs.old_string;
      const newString = resolvedArgs.new_string;
      if (!filePath) {
        throw new Error("edit: missing required argument 'path'");
      }
      if (typeof oldString !== "string") {
        const fullFileContent = coerceToString2(args.streamContent ?? args.content);
        if (fullFileContent !== null) {
          return writeFullFileWithOverwriteGuard(fs2, path2, filePath, fullFileContent, args.force === true, "edit", 2);
        }
        throw new Error("edit: missing required argument 'old_string'");
      }
      if (oldString.length === 0) {
        throw new Error("edit: old_string must not be empty; use write to overwrite an entire file");
      }
      if (typeof newString !== "string") {
        throw new Error("edit: missing required argument 'new_string'");
      }
      let content = "";
      try {
        content = fs2.readFileSync(filePath, "utf-8");
      } catch (error) {
        if (error?.code === "ENOENT") {
          const dir = path2.dirname(filePath);
          if (!fs2.existsSync(dir)) {
            fs2.mkdirSync(dir, { recursive: true });
          }
          fs2.writeFileSync(filePath, newString, "utf-8");
          return `File did not exist. Created and wrote content: ${filePath}`;
        }
        throw error;
      }
      if (!content.includes(oldString)) {
        return `Error: Could not find the text to replace in ${filePath}`;
      }
      content = content.replaceAll(oldString, newString);
      fs2.writeFileSync(filePath, content, "utf-8");
      return `File edited successfully: ${filePath}`;
    } catch (error) {
      throw error;
    }
  });
  registry.register({
    id: "grep",
    name: "grep",
    description: "Search for a pattern in files",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The search pattern (regex supported)"
        },
        path: {
          type: "string",
          description: "Directory or file to search in"
        },
        include: {
          type: "string",
          description: "File pattern to include (e.g., '*.ts')"
        }
      },
      required: ["pattern", "path"]
    },
    source: "local"
  }, async (args) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const pattern = args.pattern;
    const path2 = args.path;
    const include = args.include;
    if (process.platform === "win32") {
      return nodeFallbackGrep(pattern, path2, include);
    }
    const grepArgs = ["-r", "-n"];
    if (include) {
      grepArgs.push(`--include=${include}`);
    }
    grepArgs.push("-e", pattern, path2);
    const runGrep = async (extraArgs = []) => {
      return execFileAsync("grep", [...extraArgs, ...grepArgs], { timeout: 30000 });
    };
    try {
      const { stdout } = await runGrep();
      return stdout || "No matches found";
    } catch (error) {
      if (error.code === 1) {
        return "No matches found";
      }
      const stderr = typeof error?.stderr === "string" ? error.stderr : "";
      const isRegexSyntaxError = error.code === 2 && /(invalid regular expression|invalid repetition count|braces not balanced|repetition-operator operand invalid|unmatched(\s*\\?\{)?)/i.test(stderr);
      if (isRegexSyntaxError) {
        try {
          const { stdout } = await runGrep(["-E"]);
          return stdout || "No matches found";
        } catch (extendedError) {
          if (extendedError.code === 1) {
            return "No matches found";
          }
          throw extendedError;
        }
      }
      throw error;
    }
  });
  registry.register({
    id: "ls",
    name: "ls",
    description: "List directory contents",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the directory"
        }
      },
      required: ["path"]
    },
    source: "local"
  }, async (args) => {
    const fs2 = await import("fs");
    const path2 = await import("path");
    try {
      const dirPath = args.path;
      const entries = fs2.readdirSync(dirPath, { withFileTypes: true });
      const result = entries.map((entry) => {
        const type = entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : entry.isFile() ? "f" : "?";
        return `[${type}] ${entry.name}`;
      });
      return result.join(`
`) || "Empty directory";
    } catch (error) {
      throw error;
    }
  });
  registry.register({
    id: "glob",
    name: "glob",
    description: "Find files matching a glob pattern",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g., '**/*.ts')"
        },
        path: {
          type: "string",
          description: "Directory to search in (default: current directory)"
        }
      },
      required: ["pattern"]
    },
    source: "local"
  }, async (args) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const pattern = resolveGlobPattern(args);
    if (!pattern) {
      throw new Error("glob: missing required argument 'pattern'");
    }
    const path2 = resolvePathArg(args, "glob");
    const cwd = path2 || ".";
    const normalizedPattern = pattern.replace(/\\/g, "/");
    if (process.platform === "win32") {
      return nodeFallbackGlob(normalizedPattern, cwd);
    }
    const isPathPattern = normalizedPattern.includes("/");
    const findArgs = [cwd, "-type", "f"];
    if (isPathPattern) {
      if (cwd === "." || cwd === "./") {
        const dotPattern = normalizedPattern.startsWith("./") ? normalizedPattern : `./${normalizedPattern}`;
        findArgs.push("(", "-path", normalizedPattern, "-o", "-path", dotPattern, ")");
      } else {
        findArgs.push("-path", normalizedPattern);
      }
    } else {
      findArgs.push("-name", normalizedPattern);
    }
    try {
      const { stdout } = await execFileAsync("find", findArgs, { timeout: 30000 });
      const lines = (stdout || "").split(`
`).filter(Boolean);
      return lines.slice(0, 50).join(`
`) || "No files found";
    } catch (error) {
      const stdout = typeof error?.stdout === "string" ? error.stdout : "";
      const stderr = typeof error?.stderr === "string" ? error.stderr : "";
      if (error?.code === 1 || stderr.includes("Permission denied")) {
        const lines = stdout.split(`
`).filter(Boolean);
        return lines.slice(0, 50).join(`
`) || "No files found";
      }
      throw error;
    }
  });
  registry.register({
    id: "mkdir",
    name: "mkdir",
    description: "Create a directory, including parent directories if needed",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to create"
        }
      },
      required: ["path"]
    },
    source: "local"
  }, async (args) => {
    const { mkdir } = await import("fs/promises");
    const { resolve: resolve3 } = await import("path");
    const rawPath = resolvePathArg(args, "mkdir");
    if (!rawPath) {
      throw new Error("mkdir: missing required argument 'path'");
    }
    const target = resolve3(rawPath);
    await mkdir(target, { recursive: true });
    return `Created directory: ${target}`;
  });
  registry.register({
    id: "rm",
    name: "rm",
    description: "Delete a file or directory. Use force: true for non-empty directories.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to delete"
        },
        force: {
          type: "boolean",
          description: "If true, recursively delete non-empty directories"
        }
      },
      required: ["path"]
    },
    source: "local"
  }, async (args) => {
    const { rm, stat } = await import("fs/promises");
    const { resolve: resolve3 } = await import("path");
    const rawPath = resolvePathArg(args, "rm");
    if (!rawPath) {
      throw new Error("rm: missing required argument 'path'");
    }
    const target = resolve3(rawPath);
    const force = resolveBoolean(args.force, false);
    const info = await stat(target);
    if (info.isDirectory() && !force) {
      throw new Error("Directory not empty. Use force: true to delete recursively.");
    }
    await rm(target, { recursive: force });
    return `Deleted: ${target}`;
  });
  registry.register({
    id: "stat",
    name: "stat",
    description: "Get file or directory information: size, type, permissions, timestamps",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to inspect"
        }
      },
      required: ["path"]
    },
    source: "local"
  }, async (args) => {
    const { stat } = await import("fs/promises");
    const { resolve: resolve3 } = await import("path");
    const rawPath = resolvePathArg(args, "stat");
    if (!rawPath) {
      throw new Error("stat: missing required argument 'path'");
    }
    const target = resolve3(rawPath);
    const info = await stat(target);
    return JSON.stringify({
      path: target,
      type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      size: info.size,
      mode: info.mode.toString(8),
      modified: info.mtime.toISOString(),
      created: info.birthtime.toISOString()
    }, null, 2);
  });
}
function writeFullFileWithOverwriteGuard(fs2, path2, filePath, content, force, toolName, minimumExistingLines = 5) {
  const dir = path2.dirname(filePath);
  if (!fs2.existsSync(dir)) {
    fs2.mkdirSync(dir, { recursive: true });
  }
  if (!force && fs2.existsSync(filePath)) {
    const existing = fs2.readFileSync(filePath, "utf-8");
    const suspicious = detectSuspiciousPartialOverwrite(existing, content, minimumExistingLines);
    if (suspicious) {
      throw new Error(`${toolName}: refusing suspicious partial overwrite of existing file ${filePath} ` + `(${suspicious.existingLines} lines -> ${suspicious.nextLines} lines). ` + `${WRITE_TOOL_TARGETED_EDIT_CONTRACT} ` + "Do not retry write for this targeted change; call edit with path, old_string, and new_string. " + "Pass force: true only when intentionally replacing the full file.");
    }
  }
  fs2.writeFileSync(filePath, content, "utf-8");
  return `File written successfully: ${filePath}`;
}
function resolveEditArguments(args) {
  const path2 = typeof args.path === "string" ? args.path : "";
  let oldString = typeof args.old_string === "string" ? args.old_string : undefined;
  let newString = typeof args.new_string === "string" ? args.new_string : undefined;
  if (newString === undefined) {
    const fallbackContent = coerceToString2(args.content);
    if (fallbackContent !== null) {
      newString = fallbackContent;
    }
  }
  return {
    path: path2,
    old_string: oldString,
    new_string: newString
  };
}
function detectSuspiciousPartialOverwrite(existing, next, minimumExistingLines = 5) {
  if (process.env.CURSOR_ACP_WRITE_OVERWRITE_GUARD === "false") {
    return null;
  }
  if (existing.length === 0) {
    return null;
  }
  const existingLines = countLogicalLines(existing);
  const nextLines = countLogicalLines(next);
  if (existingLines < minimumExistingLines) {
    return null;
  }
  const lineShrink = nextLines <= Math.max(3, Math.floor(existingLines * 0.1));
  const byteShrink = next.length <= Math.max(120, Math.floor(existing.length * 0.1));
  return lineShrink && byteShrink ? { existingLines, nextLines } : null;
}
function countLogicalLines(value) {
  if (value.length === 0) {
    return 0;
  }
  const withoutTrailingNewline = value.endsWith(`
`) ? value.slice(0, -1) : value;
  if (withoutTrailingNewline.length === 0) {
    return 1;
  }
  return withoutTrailingNewline.split(`
`).length;
}
function resolveBashCommand(args) {
  const direct = coerceToString2(args.command ?? args.cmd ?? args.script ?? args.input);
  if (direct !== null && direct.trim().length > 0) {
    return direct;
  }
  if (Array.isArray(args.command)) {
    const parts = args.command.map((part) => coerceToString2(part)).filter((part) => typeof part === "string" && part.trim().length > 0);
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }
  const commandObject = args.command;
  if (typeof commandObject === "object" && commandObject !== null && !Array.isArray(commandObject)) {
    const record3 = commandObject;
    const base = coerceToString2(record3.command ?? record3.cmd);
    if (base !== null && base.trim().length > 0) {
      if (Array.isArray(record3.args)) {
        const argParts = record3.args.map((entry) => coerceToString2(entry)).filter((entry) => typeof entry === "string" && entry.trim().length > 0);
        return argParts.length > 0 ? `${base} ${argParts.join(" ")}` : base;
      }
      return base;
    }
  }
  return null;
}
function resolveWorkingDirectory(args) {
  const cwd = coerceToString2(args.cwd ?? args.workdir ?? args.path);
  if (cwd !== null && cwd.trim().length > 0) {
    return cwd;
  }
  return;
}
function resolveGlobPattern(args) {
  const direct = coerceToString2(args.pattern ?? args.globPattern ?? args.filePattern ?? args.searchPattern ?? args.includePattern);
  if (direct !== null && direct.trim().length > 0) {
    return direct;
  }
  return null;
}
function resolvePathArg(args, toolName) {
  const value = coerceToString2(args.path ?? args.filePath ?? args.targetPath ?? args.directory ?? args.dir ?? args.folder ?? args.targetDirectory ?? args.targetFile);
  if (value !== null && value.trim().length > 0) {
    return value;
  }
  if (toolName === "glob") {
    return ".";
  }
  return null;
}
function resolveTimeout(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return;
}
function resolveTimeoutMs(value) {
  const raw = resolveTimeout(value);
  if (raw === undefined)
    return 30000;
  return raw <= 600 ? raw * 1000 : raw;
}
function resolveShellOption(deps = {}) {
  const platform2 = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  if (platform2 === "win32") {
    return env.ComSpec || env.COMSPEC || true;
  }
  return env.SHELL || "/bin/bash";
}
function resolveBoolean(value, defaultValue) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return defaultValue;
}
function coerceToString2(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (typeof item === "object" && item !== null) {
        const record3 = item;
        if (typeof record3.text === "string") {
          parts.push(record3.text);
        } else if (typeof record3.content === "string") {
          parts.push(record3.content);
        } else if (typeof record3.value === "string") {
          parts.push(record3.value);
        } else {
          parts.push(JSON.stringify(record3));
        }
      } else {
        parts.push(String(item));
      }
    }
    return parts.length > 0 ? parts.join("") : null;
  }
  if (typeof value === "object") {
    const record3 = value;
    if (typeof record3.text === "string") {
      return record3.text;
    }
    if (typeof record3.content === "string") {
      return record3.content;
    }
    if (typeof record3.value === "string") {
      return record3.value;
    }
    return JSON.stringify(record3);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}
async function nodeFallbackGrep(pattern, searchPath, include) {
  const fs2 = await import("fs/promises");
  const path2 = await import("path");
  let regex2;
  try {
    regex2 = new RegExp(pattern);
  } catch {
    return "Invalid regex pattern";
  }
  let includeRegex;
  if (include) {
    const incPattern = include.replace(/\./g, "\\.").replace(/\?/g, ".").replace(/\*/g, ".*");
    includeRegex = new RegExp(`^${incPattern}$`);
  }
  const results = [];
  async function walk(dir) {
    if (results.length >= 100)
      return;
    let entries;
    try {
      entries = await fs2.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code !== "ENOENT" && err?.code !== "EACCES") {
        fallbackLog.error("Unexpected error reading directory", { dir, code: err?.code, message: err?.message });
      }
      return;
    }
    for (const entry of entries) {
      if (results.length >= 100)
        return;
      const fullPath = path2.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!FALLBACK_SKIP_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (includeRegex && !includeRegex.test(entry.name))
          continue;
        let content;
        try {
          content = await fs2.readFile(fullPath, "utf-8");
        } catch (err) {
          if (err?.code !== "ENOENT" && err?.code !== "EACCES") {
            fallbackLog.error("Unexpected error reading file", { path: fullPath, code: err?.code, message: err?.message });
          }
          continue;
        }
        const lines = content.split(`
`);
        for (let i = 0;i < lines.length; i++) {
          if (regex2.test(lines[i])) {
            results.push(`${fullPath}:${i + 1}:${lines[i]}`);
            if (results.length >= 100)
              break;
          }
        }
      }
    }
  }
  let stat;
  try {
    stat = await fs2.stat(searchPath);
  } catch {
    return "Path not found";
  }
  if (stat.isFile()) {
    let content;
    try {
      content = await fs2.readFile(searchPath, "utf-8");
    } catch (err) {
      if (err?.code !== "ENOENT" && err?.code !== "EACCES") {
        fallbackLog.error("Unexpected error reading file", { path: searchPath, code: err?.code, message: err?.message });
      }
      return "Path not found";
    }
    const lines = content.split(`
`);
    for (let i = 0;i < lines.length; i++) {
      if (regex2.test(lines[i])) {
        results.push(`${searchPath}:${i + 1}:${lines[i]}`);
        if (results.length >= 100)
          break;
      }
    }
  } else {
    await walk(searchPath);
  }
  return results.join(`
`) || "No matches found";
}
async function nodeFallbackGlob(pattern, searchPath) {
  const fs2 = await import("fs/promises");
  const path2 = await import("path");
  const results = [];
  const isPathPattern = pattern.includes("/");
  let regexPattern = pattern.replace(/\./g, "\\.").replace(/\*\*/g, "\x00").replace(/\*/g, "[^/]*").replace(/\x00/g, ".*");
  let regex2;
  try {
    regex2 = isPathPattern ? new RegExp(`${regexPattern}$`) : new RegExp(`^${regexPattern}$`);
  } catch {
    return "No files found";
  }
  async function walk(dir) {
    if (results.length >= 50)
      return;
    let entries;
    try {
      entries = await fs2.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code !== "ENOENT" && err?.code !== "EACCES") {
        fallbackLog.error("Unexpected error reading directory", { dir, code: err?.code, message: err?.message });
      }
      return;
    }
    for (const entry of entries) {
      if (results.length >= 50)
        return;
      const fullPath = path2.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!FALLBACK_SKIP_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const matchTarget = isPathPattern ? fullPath.replace(/\\/g, "/") : entry.name;
        if (regex2.test(matchTarget)) {
          results.push(fullPath);
        }
      }
    }
  }
  await walk(searchPath);
  return results.join(`
`) || "No files found";
}
var WRITE_TOOL_TARGETED_EDIT_CONTRACT = "Use only for new files or intentional full-file replacement. For targeted edits to existing files, use edit with old_string and new_string.", FALLBACK_SKIP_DIRS, fallbackLog;
var init_defaults = __esm(() => {
  init_logger();
  FALLBACK_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);
  fallbackLog = createLogger("tools:fallback");
});

// src/provider/boundary.ts
function parseProviderBoundaryMode(value) {
  const normalized = (value ?? "v1").trim().toLowerCase();
  if (normalized === "legacy" || normalized === "v1") {
    return { mode: normalized, valid: true };
  }
  return { mode: "v1", valid: false };
}
function createProviderBoundary(mode, providerId) {
  const shared = createSharedBoundary(providerId);
  if (mode === "v1") {
    return { ...shared, mode: "v1" };
  }
  return { ...shared, mode: "legacy" };
}
function createSharedBoundary(providerId) {
  return {
    providerId,
    resolveChatParamTools(toolLoopMode, existingTools, refreshedTools) {
      if (toolLoopMode === "proxy-exec") {
        if (refreshedTools.length > 0) {
          return { tools: refreshedTools, action: "override" };
        }
        return { tools: existingTools, action: "none" };
      }
      if (toolLoopMode === "opencode") {
        if (existingTools != null) {
          return { tools: existingTools, action: "preserve" };
        }
        if (refreshedTools.length > 0) {
          return { tools: refreshedTools, action: "fallback" };
        }
        return { tools: existingTools, action: "none" };
      }
      return { tools: existingTools, action: "none" };
    },
    computeToolLoopFlags(toolLoopMode, forwardToolCalls, emitToolUpdates) {
      const proxyExec = toolLoopMode === "proxy-exec";
      const opencode = toolLoopMode === "opencode";
      return {
        proxyExecuteToolCalls: proxyExec && forwardToolCalls,
        suppressConverterToolEvents: opencode || proxyExec && !forwardToolCalls,
        shouldEmitToolUpdates: proxyExec && emitToolUpdates
      };
    },
    matchesProvider(inputModel) {
      if (!inputModel || typeof inputModel !== "object") {
        return false;
      }
      const modelProviderId = typeof inputModel.providerID === "string" && inputModel.providerID || typeof inputModel.providerId === "string" && inputModel.providerId || typeof inputModel.provider === "string" && inputModel.provider || "";
      return modelProviderId === providerId;
    },
    normalizeRuntimeModel(model) {
      const raw = typeof model === "string" ? model.trim() : "";
      if (raw.length === 0) {
        return "auto";
      }
      const prefix = `${providerId}/`;
      if (raw.startsWith(prefix)) {
        const stripped = raw.slice(prefix.length).trim();
        return stripped.length > 0 ? stripped : "auto";
      }
      return raw;
    },
    resolveRuntimeModel(model, cursorModel) {
      const rawCursorModel = typeof cursorModel === "string" ? cursorModel.trim() : "";
      if (rawCursorModel.length > 0) {
        return this.normalizeRuntimeModel(rawCursorModel);
      }
      return this.normalizeRuntimeModel(model);
    },
    applyChatParamDefaults(output, proxyBaseURL, defaultBaseURL, defaultApiKey) {
      output.options = output.options || {};
      output.options.baseURL = proxyBaseURL || defaultBaseURL;
      output.options.apiKey = output.options.apiKey || defaultApiKey;
    },
    maybeExtractToolCall(event, allowedToolNames, toolLoopMode) {
      if (toolLoopMode !== "opencode") {
        return { action: "skip", skipReason: "tool_loop_mode_not_opencode" };
      }
      return extractOpenAiToolCall(event, allowedToolNames);
    },
    createNonStreamToolCallResponse(meta, toolCall) {
      return createToolCallCompletionResponse(meta, toolCall);
    },
    createStreamToolCallChunks(meta, toolCall) {
      return createToolCallStreamChunks(meta, toolCall);
    }
  };
}
var init_boundary = __esm(() => {
  init_tool_loop();
});

// src/provider/runtime-interception.ts
import { existsSync as existsSync5, readFileSync as readFileSync2 } from "fs";
async function handleToolLoopEventLegacy(options) {
  const {
    event,
    toolLoopMode,
    allowedToolNames,
    toolSchemaMap,
    toolLoopGuard,
    toolMapper,
    toolSessionId,
    shouldEmitToolUpdates,
    proxyExecuteToolCalls,
    suppressConverterToolEvents,
    toolRouter,
    responseMeta,
    onToolUpdate,
    onToolResult,
    onInterceptedToolCall,
    passThroughTracker
  } = options;
  const extraction = toolLoopMode === "opencode" ? extractOpenAiToolCall(event, allowedToolNames) : { action: "skip", skipReason: "tool_loop_mode_not_opencode" };
  if (extraction.action === "passthrough") {
    passThroughTracker?.trackTool(extraction.passthroughName);
    log19.debug("MCP tool passed through to cursor-agent (legacy)", {
      tool: extraction.passthroughName
    });
    return { intercepted: false, skipConverter: suppressConverterToolEvents };
  }
  if (extraction.action === "skip" || !extraction.toolCall) {
    const updates2 = await toolMapper.mapCursorEventToAcp(event, event.session_id ?? toolSessionId);
    if (shouldEmitToolUpdates) {
      for (const update of updates2) {
        await onToolUpdate(update);
      }
    }
    if (toolRouter && proxyExecuteToolCalls) {
      const toolResult = await toolRouter.handleToolCall(event, responseMeta);
      if (toolResult) {
        await onToolResult(toolResult);
      }
    }
    return { intercepted: false, skipConverter: suppressConverterToolEvents };
  }
  const interceptedToolCall = extraction.toolCall;
  if (interceptedToolCall) {
    const compat = applyToolSchemaCompat(interceptedToolCall, toolSchemaMap);
    let normalizedToolCall = compat.toolCall;
    log19.debug("Applied tool schema compatibility (legacy)", {
      tool: normalizedToolCall.function.name,
      originalArgKeys: compat.originalArgKeys,
      normalizedArgKeys: compat.normalizedArgKeys,
      collisionKeys: compat.collisionKeys,
      validationOk: compat.validation.ok
    });
    const reroutedWrite = tryRerouteEditToWrite(normalizedToolCall, compat, allowedToolNames, toolSchemaMap);
    if (reroutedWrite) {
      log19.debug("Rerouting full-file edit call to write (legacy)", {
        missing: compat.validation.missing
      });
      await onInterceptedToolCall(reroutedWrite);
      return { intercepted: true, skipConverter: true };
    }
    const schemaAbsentEditValidation = buildSchemaAbsentEditValidation(normalizedToolCall, compat);
    if (schemaAbsentEditValidation) {
      const hintChunk = createNonFatalSchemaValidationHintChunk(responseMeta, normalizedToolCall, schemaAbsentEditValidation);
      log19.debug("Skipping schema-absent malformed edit call in legacy", {
        missing: schemaAbsentEditValidation.missing
      });
      await onToolResult(hintChunk);
      return { intercepted: false, skipConverter: true };
    }
    if (compat.validation.hasSchema && !compat.validation.ok) {
      const validationTermination = evaluateSchemaValidationLoopGuard(toolLoopGuard, normalizedToolCall, compat.validation);
      if (validationTermination) {
        if (validationTermination.soft) {
          const hintChunk = createLoopGuardHintChunk(responseMeta, normalizedToolCall, validationTermination);
          log19.debug("Soft-blocking schema validation loop guard in legacy (emitting hint)", {
            tool: normalizedToolCall.function.name,
            fingerprint: validationTermination.fingerprint
          });
          await onToolResult(hintChunk);
          return { intercepted: false, skipConverter: true };
        }
        return { intercepted: false, skipConverter: true, terminate: validationTermination };
      }
      if (shouldEmitNonFatalSchemaValidationHint(normalizedToolCall, compat.validation)) {
        const hintChunk = createNonFatalSchemaValidationHintChunk(responseMeta, normalizedToolCall, compat.validation);
        log19.debug("Emitting non-fatal schema validation hint in legacy and skipping malformed tool execution", {
          tool: normalizedToolCall.function.name,
          missing: compat.validation.missing,
          typeErrors: compat.validation.typeErrors
        });
        await onToolResult(hintChunk);
        return { intercepted: false, skipConverter: true };
      }
    }
    const termination = evaluateToolLoopGuard(toolLoopGuard, normalizedToolCall);
    if (termination) {
      if (termination.soft) {
        const hintChunk = createLoopGuardHintChunk(responseMeta, normalizedToolCall, termination);
        log19.debug("Soft-blocking tool loop guard in legacy (emitting hint)", {
          tool: normalizedToolCall.function.name,
          fingerprint: termination.fingerprint
        });
        await onToolResult(hintChunk);
        return { intercepted: false, skipConverter: true };
      }
      return { intercepted: false, skipConverter: true, terminate: termination };
    }
    await onInterceptedToolCall(normalizedToolCall);
    return { intercepted: true, skipConverter: true };
  }
  const updates = await toolMapper.mapCursorEventToAcp(event, event.session_id ?? toolSessionId);
  if (shouldEmitToolUpdates) {
    for (const update of updates) {
      await onToolUpdate(update);
    }
  }
  if (toolRouter && proxyExecuteToolCalls) {
    const toolResult = await toolRouter.handleToolCall(event, responseMeta);
    if (toolResult) {
      await onToolResult(toolResult);
    }
  }
  return {
    intercepted: false,
    skipConverter: suppressConverterToolEvents
  };
}
async function handleToolLoopEventV1(options) {
  const {
    event,
    boundary,
    schemaValidationFailureMode = "pass_through",
    toolLoopMode,
    allowedToolNames,
    toolSchemaMap,
    toolLoopGuard,
    toolMapper,
    toolSessionId,
    shouldEmitToolUpdates,
    proxyExecuteToolCalls,
    suppressConverterToolEvents,
    toolRouter,
    responseMeta,
    onToolUpdate,
    onToolResult,
    onInterceptedToolCall,
    passThroughTracker
  } = options;
  let extraction;
  try {
    extraction = boundary.maybeExtractToolCall(event, allowedToolNames, toolLoopMode);
  } catch (error) {
    throw new ToolBoundaryExtractionError("Boundary tool extraction failed", error);
  }
  if (extraction.action === "passthrough") {
    passThroughTracker?.trackTool(extraction.passthroughName);
    log19.debug("MCP tool passed through to cursor-agent (v1)", {
      tool: extraction.passthroughName
    });
    return { intercepted: false, skipConverter: suppressConverterToolEvents };
  }
  if (extraction.action === "skip" || !extraction.toolCall) {
    const updates = await toolMapper.mapCursorEventToAcp(event, event.session_id ?? toolSessionId);
    if (shouldEmitToolUpdates) {
      for (const update of updates) {
        await onToolUpdate(update);
      }
    }
    if (toolRouter && proxyExecuteToolCalls) {
      const toolResult = await toolRouter.handleToolCall(event, responseMeta);
      if (toolResult) {
        await onToolResult(toolResult);
      }
    }
    return { intercepted: false, skipConverter: suppressConverterToolEvents };
  }
  const interceptedToolCall = extraction.toolCall;
  const compat = applyToolSchemaCompat(interceptedToolCall, toolSchemaMap);
  let normalizedToolCall = compat.toolCall;
  const editDiag = normalizedToolCall.function.name.toLowerCase() === "edit" ? {
    rawArgs: safeArgTypeSummary(event),
    normalizedArgs: compat.normalizedArgs
  } : undefined;
  log19.debug("Applied tool schema compatibility", {
    tool: normalizedToolCall.function.name,
    originalArgKeys: compat.originalArgKeys,
    normalizedArgKeys: compat.normalizedArgKeys,
    collisionKeys: compat.collisionKeys,
    validationOk: compat.validation.ok,
    ...editDiag ? { editDiag } : {}
  });
  const reroutedWrite = tryRerouteEditToWrite(normalizedToolCall, compat, allowedToolNames, toolSchemaMap);
  if (reroutedWrite) {
    const suspiciousOverwrite = detectSuspiciousStreamContentWrite(compat, reroutedWrite);
    if (suspiciousOverwrite) {
      const cursorOwnedMutation = detectCursorOwnedMutation(event, normalizedToolCall.function.name);
      log19.debug("Skipping suspicious streamContent edit-to-write reroute", {
        filePath: suspiciousOverwrite.filePath,
        existingLines: suspiciousOverwrite.existingLines,
        nextLines: suspiciousOverwrite.nextLines,
        ...cursorOwnedMutation ? { cursorOwnedMutation } : {}
      });
      return {
        intercepted: false,
        skipConverter: true,
        ...cursorOwnedMutation ? { cursorOwnedMutation } : {}
      };
    }
    log19.debug("Rerouting full-file edit call to write", {
      missing: compat.validation.missing,
      typeErrors: compat.validation.typeErrors
    });
    await onInterceptedToolCall(reroutedWrite);
    return {
      intercepted: true,
      skipConverter: true
    };
  }
  const schemaAbsentEditValidation = buildSchemaAbsentEditValidation(normalizedToolCall, compat);
  if (schemaAbsentEditValidation) {
    const hintChunk = createNonFatalSchemaValidationHintChunk(responseMeta, normalizedToolCall, schemaAbsentEditValidation);
    log19.debug("Skipping schema-absent malformed edit call", {
      missing: schemaAbsentEditValidation.missing
    });
    await onToolResult(hintChunk);
    return {
      intercepted: false,
      skipConverter: true
    };
  }
  if (compat.validation.hasSchema && !compat.validation.ok) {
    log19.debug("Tool schema compatibility validation failed", {
      tool: normalizedToolCall.function.name,
      missing: compat.validation.missing,
      unexpected: compat.validation.unexpected,
      typeErrors: compat.validation.typeErrors,
      repairHint: compat.validation.repairHint
    });
    const validationTermination = evaluateSchemaValidationLoopGuard(toolLoopGuard, normalizedToolCall, compat.validation);
    if (validationTermination) {
      if (validationTermination.soft) {
        const hintChunk = createLoopGuardHintChunk(responseMeta, normalizedToolCall, validationTermination);
        log19.debug("Soft-blocking schema validation loop guard (emitting hint)", {
          tool: normalizedToolCall.function.name,
          fingerprint: validationTermination.fingerprint,
          repeatCount: validationTermination.repeatCount
        });
        await onToolResult(hintChunk);
        return { intercepted: false, skipConverter: true };
      }
      return { intercepted: false, skipConverter: true, terminate: validationTermination };
    }
    const termination2 = evaluateToolLoopGuard(toolLoopGuard, normalizedToolCall);
    if (termination2) {
      if (termination2.soft) {
        const hintChunk = createLoopGuardHintChunk(responseMeta, normalizedToolCall, termination2);
        log19.debug("Soft-blocking tool loop guard in validation path (emitting hint)", {
          tool: normalizedToolCall.function.name,
          fingerprint: termination2.fingerprint,
          repeatCount: termination2.repeatCount
        });
        await onToolResult(hintChunk);
        return { intercepted: false, skipConverter: true };
      }
      return { intercepted: false, skipConverter: true, terminate: termination2 };
    }
    if (schemaValidationFailureMode === "pass_through" && shouldTerminateOnSchemaValidation(normalizedToolCall, compat.validation)) {
      return {
        intercepted: false,
        skipConverter: true,
        terminate: createSchemaValidationTermination(normalizedToolCall, compat.validation)
      };
    }
    if (schemaValidationFailureMode === "pass_through" && shouldEmitNonFatalSchemaValidationHint(normalizedToolCall, compat.validation)) {
      const hintChunk = createNonFatalSchemaValidationHintChunk(responseMeta, normalizedToolCall, compat.validation);
      log19.debug("Emitting non-fatal schema validation hint and skipping malformed tool execution", {
        tool: normalizedToolCall.function.name,
        missing: compat.validation.missing,
        typeErrors: compat.validation.typeErrors
      });
      await onToolResult(hintChunk);
      return {
        intercepted: false,
        skipConverter: true
      };
    }
    if (schemaValidationFailureMode === "terminate") {
      return {
        intercepted: false,
        skipConverter: true,
        terminate: createSchemaValidationTermination(normalizedToolCall, compat.validation)
      };
    }
    log19.debug("Forwarding schema-invalid tool call to OpenCode loop", {
      tool: normalizedToolCall.function.name,
      repairHint: compat.validation.repairHint
    });
    await onInterceptedToolCall(normalizedToolCall);
    return {
      intercepted: true,
      skipConverter: true
    };
  }
  const termination = evaluateToolLoopGuard(toolLoopGuard, normalizedToolCall);
  if (termination) {
    if (termination.soft) {
      const hintChunk = createLoopGuardHintChunk(responseMeta, normalizedToolCall, termination);
      log19.debug("Soft-blocking tool loop guard (emitting hint)", {
        tool: normalizedToolCall.function.name,
        fingerprint: termination.fingerprint,
        repeatCount: termination.repeatCount
      });
      await onToolResult(hintChunk);
      return { intercepted: false, skipConverter: true };
    }
    return { intercepted: false, skipConverter: true, terminate: termination };
  }
  await onInterceptedToolCall(normalizedToolCall);
  return { intercepted: true, skipConverter: true };
  return { intercepted: false, skipConverter: suppressConverterToolEvents };
}
async function handleToolLoopEventWithFallback(options) {
  const {
    boundaryMode,
    autoFallbackToLegacy,
    onFallbackToLegacy,
    ...shared
  } = options;
  if (boundaryMode === "legacy") {
    return handleToolLoopEventLegacy(shared);
  }
  try {
    const schemaValidationFailureMode = autoFallbackToLegacy && boundaryMode === "v1" && !shouldUsePassThroughForEditSchema(shared.event) ? "terminate" : "pass_through";
    const result = await handleToolLoopEventV1({
      ...shared,
      schemaValidationFailureMode
    });
    if (result.terminate && autoFallbackToLegacy && boundaryMode === "v1" && (result.terminate.reason === "loop_guard" || result.terminate.reason === "schema_validation")) {
      if (result.terminate.reason === "loop_guard") {
        if (result.terminate.errorClass === "validation" || result.terminate.errorClass === "success") {
          return result;
        }
        shared.toolLoopGuard.resetFingerprint(result.terminate.fingerprint);
        onFallbackToLegacy?.(new Error(`loop guard: ${result.terminate.fingerprint}`));
      } else {
        onFallbackToLegacy?.(new Error(`schema validation: ${result.terminate.tool}`));
      }
      return handleToolLoopEventLegacy(shared);
    }
    return result;
  } catch (error) {
    if (!autoFallbackToLegacy || boundaryMode !== "v1" || !(error instanceof ToolBoundaryExtractionError)) {
      throw error;
    }
    onFallbackToLegacy?.(error.cause ?? error);
    return handleToolLoopEventLegacy(shared);
  }
}
function evaluateToolLoopGuard(toolLoopGuard, toolCall) {
  const decision = toolLoopGuard.evaluate(toolCall);
  if (!decision.tracked) {
    return null;
  }
  if (!decision.triggered) {
    return null;
  }
  log19.debug("Tool loop guard triggered", {
    tool: toolCall.function.name,
    fingerprint: decision.fingerprint,
    repeatCount: decision.repeatCount,
    maxRepeat: decision.maxRepeat,
    errorClass: decision.errorClass
  });
  if (decision.errorClass === "success") {
    return {
      reason: "loop_guard",
      message: "",
      tool: toolCall.function.name,
      fingerprint: decision.fingerprint,
      repeatCount: decision.repeatCount,
      maxRepeat: decision.maxRepeat,
      errorClass: decision.errorClass,
      silent: true
    };
  }
  const isFirstTrigger = decision.repeatCount === decision.maxRepeat + 1;
  return {
    reason: "loop_guard",
    message: `Tool loop guard stopped repeated failing calls to "${toolCall.function.name}" ` + `after ${decision.repeatCount} attempts (limit ${decision.maxRepeat}). ` + "Adjust tool arguments and retry.",
    tool: toolCall.function.name,
    fingerprint: decision.fingerprint,
    repeatCount: decision.repeatCount,
    maxRepeat: decision.maxRepeat,
    errorClass: decision.errorClass,
    soft: isFirstTrigger
  };
}
function createSchemaValidationTermination(toolCall, validation) {
  const reasonParts = [];
  if (validation.missing.length > 0) {
    reasonParts.push(`missing required: ${validation.missing.join(", ")}`);
  }
  if (validation.unexpected.length > 0) {
    reasonParts.push(`unsupported fields: ${validation.unexpected.join(", ")}`);
  }
  if (validation.typeErrors.length > 0) {
    reasonParts.push(`type errors: ${validation.typeErrors.join("; ")}`);
  }
  const reasonText = reasonParts.length > 0 ? reasonParts.join(" | ") : "arguments did not match schema";
  const repairHint = validation.repairHint ? ` ${validation.repairHint}` : "";
  return {
    reason: "schema_validation",
    message: `Invalid arguments for tool "${toolCall.function.name}": ${reasonText}.${repairHint}`.trim(),
    tool: toolCall.function.name,
    errorClass: "validation",
    repairHint: validation.repairHint,
    missing: validation.missing,
    unexpected: validation.unexpected,
    typeErrors: validation.typeErrors
  };
}
function buildSchemaAbsentEditValidation(toolCall, compat) {
  if (toolCall.function.name.toLowerCase() !== "edit" || compat.validation.hasSchema) {
    return null;
  }
  const args = compat.normalizedArgs;
  const missing = [];
  if (typeof args.filePath !== "string" || args.filePath.trim().length === 0) {
    missing.push("filePath");
  }
  if (typeof args.oldString !== "string") {
    missing.push("oldString");
  }
  if (typeof args.newString !== "string") {
    missing.push("newString");
  }
  if (missing.length === 0) {
    return null;
  }
  return {
    hasSchema: true,
    ok: false,
    missing,
    unexpected: [],
    typeErrors: [],
    repairHint: "edit requires filePath, oldString, and newString"
  };
}
function evaluateSchemaValidationLoopGuard(toolLoopGuard, toolCall, validation) {
  const validationSignature = buildValidationSignature(validation);
  const decision = toolLoopGuard.evaluateValidation(toolCall, validationSignature);
  if (!decision.tracked || !decision.triggered) {
    return null;
  }
  const isFirstTrigger = decision.repeatCount === decision.maxRepeat + 1;
  log19.debug("Tool loop guard triggered on schema validation", {
    tool: toolCall.function.name,
    fingerprint: decision.fingerprint,
    repeatCount: decision.repeatCount,
    maxRepeat: decision.maxRepeat,
    validationSignature,
    soft: isFirstTrigger
  });
  return {
    reason: "loop_guard",
    message: `Tool loop guard stopped repeated schema-invalid calls to "${toolCall.function.name}" ` + `after ${decision.repeatCount} attempts (limit ${decision.maxRepeat}). ` + "Adjust tool arguments and retry.",
    tool: toolCall.function.name,
    fingerprint: decision.fingerprint,
    repeatCount: decision.repeatCount,
    maxRepeat: decision.maxRepeat,
    errorClass: decision.errorClass,
    soft: isFirstTrigger
  };
}
function buildValidationSignature(validation) {
  const parts = [];
  if (validation.missing.length > 0) {
    const sortedMissing = [...validation.missing].sort();
    parts.push(`missing:${sortedMissing.join(",")}`);
  }
  if (validation.typeErrors.length > 0) {
    const sortedTypeErrors = [...validation.typeErrors].sort();
    parts.push(`type:${sortedTypeErrors.join(",")}`);
  }
  if (parts.length === 0) {
    return "invalid";
  }
  return parts.join("|");
}
function shouldEmitNonFatalSchemaValidationHint(toolCall, validation) {
  if (toolCall.function.name.toLowerCase() !== "edit") {
    return false;
  }
  if (validation.typeErrors.length > 0) {
    return false;
  }
  const missing = new Set(validation.missing);
  return missing.has("old_string") || missing.has("oldString") || missing.has("new_string") || missing.has("newString") || missing.has("path") || missing.has("filePath");
}
function shouldTerminateOnSchemaValidation(toolCall, validation) {
  if (toolCall.function.name.toLowerCase() !== "edit") {
    return false;
  }
  if (validation.typeErrors.length > 0) {
    return true;
  }
  return false;
}
function detectSuspiciousStreamContentWrite(compat, reroutedWrite) {
  if (!hasStreamContentArg(compat.originalArgs)) {
    return null;
  }
  let args;
  try {
    const parsed = JSON.parse(reroutedWrite.function.arguments);
    if (!isRecord5(parsed)) {
      return null;
    }
    args = parsed;
  } catch {
    return null;
  }
  const filePath = typeof args.path === "string" ? args.path : typeof args.filePath === "string" ? args.filePath : null;
  const content = typeof args.content === "string" ? args.content : typeof args.fileText === "string" ? args.fileText : null;
  if (!filePath || content === null || !existsSync5(filePath)) {
    return null;
  }
  const existing = readFileSync2(filePath, "utf-8");
  if (existing.length === 0) {
    return null;
  }
  const existingLines = countLogicalLines2(existing);
  const nextLines = countLogicalLines2(content);
  if (existingLines < 5) {
    return null;
  }
  const lineShrink = nextLines <= Math.max(3, Math.floor(existingLines * 0.1));
  const byteShrink = content.length <= Math.max(120, Math.floor(existing.length * 0.1));
  return lineShrink && byteShrink ? { filePath, existingLines, nextLines } : null;
}
function detectCursorOwnedMutation(event, tool2) {
  if (event.subtype !== "completed") {
    return;
  }
  const payload = firstToolPayload(event);
  const result = isRecord5(payload?.result) ? payload.result : undefined;
  const success = isRecord5(result?.success) ? result.success : undefined;
  if (!success) {
    return;
  }
  return {
    tool: tool2,
    path: typeof success.path === "string" ? success.path : undefined,
    status: "completed",
    source: "cursor-agent",
    reason: "completed_cursor_edit_success"
  };
}
function firstToolPayload(event) {
  const toolCallPayload = event.tool_call;
  if (!isRecord5(toolCallPayload)) {
    return;
  }
  const first = Object.values(toolCallPayload)[0];
  return isRecord5(first) ? first : undefined;
}
function hasStreamContentArg(args) {
  return Object.keys(args).some((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === "streamcontent");
}
function countLogicalLines2(value) {
  if (value.length === 0) {
    return 0;
  }
  const withoutTrailingNewline = value.endsWith(`
`) ? value.slice(0, -1) : value;
  if (withoutTrailingNewline.length === 0) {
    return 1;
  }
  return withoutTrailingNewline.split(`
`).length;
}
function createNonFatalSchemaValidationHintChunk(meta, toolCall, validation) {
  const termination = createSchemaValidationTermination(toolCall, validation);
  const fallbackHint = "Use write for full-file replacement, or provide path, old_string, and new_string for edit.";
  const suffix = termination.repairHint ? "" : ` ${fallbackHint}`;
  const content = `Skipped malformed tool call "${toolCall.function.name}": ${termination.message}${suffix}`.trim();
  return {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content
        },
        finish_reason: null
      }
    ]
  };
}
function createLoopGuardHintChunk(meta, toolCall, termination) {
  const content = `Tool "${toolCall.function.name}" has been temporarily blocked after ` + `${termination.repeatCount} repeated ${termination.errorClass} failures. ` + "Do not retry this tool. Use a different approach to complete the task.";
  return {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content
        },
        finish_reason: null
      }
    ]
  };
}
function safeArgTypeSummary(event) {
  try {
    let raw;
    const toolCallPayload = event?.tool_call;
    if (isRecord5(toolCallPayload)) {
      const entries = Object.entries(toolCallPayload);
      if (entries.length > 0) {
        const [, payload] = entries[0];
        if (isRecord5(payload)) {
          raw = payload.args;
          if (raw === undefined) {
            const { result: _result, ...rest } = payload;
            if (Object.keys(rest).length > 0) {
              raw = rest;
            }
          }
        }
      }
    }
    if (raw === undefined) {
      raw = event?.function?.arguments ?? event?.arguments;
    }
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof parsed !== "object" || parsed === null) {
      return { _raw: typeof parsed };
    }
    const summary = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null) {
        summary[k] = "null";
      } else if (Array.isArray(v)) {
        summary[k] = `array[${v.length}]`;
      } else {
        summary[k] = typeof v;
      }
    }
    return summary;
  } catch {
    return { _error: "parse_failed" };
  }
}
function shouldUsePassThroughForEditSchema(event) {
  const toolCallPayload = event?.tool_call;
  if (!isRecord5(toolCallPayload)) {
    return false;
  }
  const keys = Object.keys(toolCallPayload);
  if (keys.length === 0) {
    return false;
  }
  const rawName = keys[0];
  const normalizedName = rawName.endsWith("ToolCall") ? rawName.slice(0, -"ToolCall".length) : rawName;
  return normalizedName.toLowerCase() === "edit";
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var log19, ToolBoundaryExtractionError;
var init_runtime_interception = __esm(() => {
  init_tool_loop();
  init_logger();
  init_tool_schema_compat();
  log19 = createLogger("provider:runtime-interception");
  ToolBoundaryExtractionError = class ToolBoundaryExtractionError extends Error {
    cause;
    constructor(message, cause) {
      super(message);
      this.name = "ToolBoundaryExtractionError";
      this.cause = cause;
    }
  };
});

// src/provider/passthrough-tracker.ts
class PassThroughTracker {
  tools = new Set;
  errors = [];
  trackTool(name) {
    this.tools.add(name);
  }
  trackError(toolName, message) {
    this.errors.push(`${toolName}: ${message}`);
  }
  getSummary() {
    return {
      tools: Array.from(this.tools),
      errors: [...this.errors],
      hasActivity: this.tools.size > 0
    };
  }
  reset() {
    this.tools.clear();
    this.errors.length = 0;
  }
}

// src/services/toast-service.ts
class ToastService {
  client = null;
  setClient(client3) {
    this.client = client3;
  }
  async show(options) {
    if (!this.client?.tui?.showToast) {
      log20.debug("Toast not available; client.tui.showToast missing", { message: options.message });
      return;
    }
    try {
      await this.client.tui.showToast({
        body: {
          title: options.title,
          message: options.message,
          variant: options.variant
        }
      });
    } catch (error) {
      log20.debug("Toast failed", { error, message: options.message });
    }
  }
  async showPassThroughSummary(tools) {
    if (tools.length === 0)
      return;
    const toolList = tools.length <= 3 ? tools.join(", ") : `${tools.slice(0, 3).join(", ")} +${tools.length - 3} more`;
    await this.show({
      title: "MCP Tools",
      message: `\uD83C\uDFAD ${tools.length} tool${tools.length > 1 ? "s" : ""} handled by cursor-agent: ${toolList}`,
      variant: "info"
    });
  }
  async showErrorSummary(errors) {
    if (errors.length === 0)
      return;
    const errorList = errors.length <= 2 ? errors.join("; ") : `${errors.slice(0, 2).join("; ")} +${errors.length - 2} more`;
    await this.show({
      title: "MCP Errors",
      message: `笞・・${errors.length} MCP tool${errors.length > 1 ? "s" : ""} failed: ${errorList}`,
      variant: "warning"
    });
  }
}
var log20, toastService;
var init_toast_service = __esm(() => {
  init_logger();
  log20 = createLogger("services:toast");
  toastService = new ToastService;
});

// src/provider/tool-loop-guard.ts
function parseToolLoopMaxRepeat(value) {
  if (value === undefined) {
    return { value: 2, valid: true };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return { value: 2, valid: false };
  }
  return { value: Math.floor(parsed), valid: true };
}
function createToolLoopGuard(messages, maxRepeat) {
  const coarseMaxRepeat = maxRepeat * COARSE_LIMIT_MULTIPLIER;
  const {
    byCallId,
    latest,
    latestByToolName,
    initialCounts,
    initialCoarseCounts,
    initialValidationCounts,
    initialValidationCoarseCounts
  } = indexToolLoopHistory(messages);
  const counts = new Map(initialCounts);
  const coarseCounts = new Map(initialCoarseCounts);
  const validationCounts = new Map(initialValidationCounts);
  const validationCoarseCounts = new Map(initialValidationCoarseCounts);
  return {
    evaluate(toolCall) {
      const errorClass = normalizeErrorClassForTool(toolCall.function.name, byCallId.get(toolCall.id) ?? latestByToolName.get(toolCall.function.name) ?? latest ?? "unknown");
      const argShape = deriveArgumentShape(toolCall.function.arguments);
      if (errorClass === "success") {
        const valueSignature = deriveArgumentValueSignature(toolCall.function.arguments);
        const successFingerprint = `${toolCall.function.name}|values:${valueSignature}|success`;
        const repeatCount = (counts.get(successFingerprint) ?? 0) + 1;
        counts.set(successFingerprint, repeatCount);
        const isExplorationTool = EXPLORATION_TOOLS.has(toolCall.function.name.toLowerCase());
        const effectiveMaxRepeat = isExplorationTool ? maxRepeat * EXPLORATION_LIMIT_MULTIPLIER : maxRepeat;
        const coarseSuccessFingerprint = deriveSuccessCoarseFingerprint(toolCall.function.name, toolCall.function.arguments);
        const coarseRepeatCount = coarseSuccessFingerprint ? (coarseCounts.get(coarseSuccessFingerprint) ?? 0) + 1 : 0;
        if (coarseSuccessFingerprint) {
          coarseCounts.set(coarseSuccessFingerprint, coarseRepeatCount);
        }
        const coarseTriggered = coarseSuccessFingerprint ? coarseRepeatCount > effectiveMaxRepeat : false;
        return {
          fingerprint: coarseTriggered ? coarseSuccessFingerprint : successFingerprint,
          repeatCount: coarseTriggered ? coarseRepeatCount : repeatCount,
          maxRepeat: effectiveMaxRepeat,
          errorClass,
          triggered: repeatCount > effectiveMaxRepeat || coarseTriggered,
          tracked: true
        };
      }
      const strictFingerprint = `${toolCall.function.name}|${argShape}|${errorClass}`;
      const coarseFingerprint = `${toolCall.function.name}|${errorClass}`;
      return evaluateWithFingerprints(toolCall.function.name, errorClass, strictFingerprint, coarseFingerprint, counts, coarseCounts, maxRepeat, coarseMaxRepeat);
    },
    evaluateValidation(toolCall, validationSignature) {
      const normalizedSignature = normalizeValidationSignature(validationSignature);
      const strictFingerprint = `${toolCall.function.name}|schema:${normalizedSignature}|validation`;
      const coarseFingerprint = `${toolCall.function.name}|validation`;
      return evaluateWithFingerprints(toolCall.function.name, "validation", strictFingerprint, coarseFingerprint, validationCounts, validationCoarseCounts, maxRepeat, coarseMaxRepeat);
    },
    resetFingerprint(fingerprint) {
      counts.delete(fingerprint);
      coarseCounts.delete(fingerprint);
      validationCounts.delete(fingerprint);
      validationCoarseCounts.delete(fingerprint);
      const parts = fingerprint.split("|");
      if (parts.length >= 3) {
        const tool2 = parts[0];
        const errorClass = parts[parts.length - 1];
        coarseCounts.delete(`${tool2}|${errorClass}`);
        validationCoarseCounts.delete(`${tool2}|${errorClass}`);
      } else if (parts.length === 2) {
        const tool2 = parts[0];
        const errorClass = parts[1];
        for (const key of counts.keys()) {
          if (key.startsWith(`${tool2}|`) && key.endsWith(`|${errorClass}`)) {
            counts.delete(key);
          }
        }
        for (const key of validationCounts.keys()) {
          if (key.startsWith(`${tool2}|`) && key.endsWith(`|${errorClass}`)) {
            validationCounts.delete(key);
          }
        }
      }
    }
  };
}
function indexToolResultErrorClasses(messages) {
  const byCallId = new Map;
  let latest = null;
  for (const message of messages) {
    if (!isRecord6(message) || message.role !== "tool") {
      continue;
    }
    const errorClass = classifyToolResult(message.content);
    latest = errorClass;
    const callId = typeof message.tool_call_id === "string" && message.tool_call_id.length > 0 ? message.tool_call_id : null;
    if (callId) {
      byCallId.set(callId, errorClass);
    }
  }
  return { byCallId, latest };
}
function indexToolLoopHistory(messages) {
  const { byCallId, latest } = indexToolResultErrorClasses(messages);
  const initialCounts = new Map;
  const initialCoarseCounts = new Map;
  const initialValidationCounts = new Map;
  const initialValidationCoarseCounts = new Map;
  const assistantCalls = extractAssistantToolCalls(messages);
  const latestByToolName = new Map;
  for (const call of assistantCalls) {
    const ec = byCallId.get(call.id);
    if (ec !== undefined) {
      latestByToolName.set(call.name, normalizeErrorClassForTool(call.name, ec));
    }
  }
  for (const call of assistantCalls) {
    const schemaSignature = deriveSchemaValidationSignature(call.name, call.argKeys);
    const errorClass = normalizeErrorClassForTool(call.name, byCallId.get(call.id) ?? latestByToolName.get(call.name) ?? latest ?? "unknown");
    if (errorClass === "success") {
      incrementCount(initialCounts, `${call.name}|values:${call.argValueSignature}|success`);
      const coarseSuccessFP = deriveSuccessCoarseFingerprint(call.name, call.rawArguments);
      if (coarseSuccessFP) {
        incrementCount(initialCoarseCounts, coarseSuccessFP);
      }
      if (schemaSignature) {
        incrementCount(initialValidationCounts, `${call.name}|schema:${schemaSignature}|validation`);
        incrementCount(initialValidationCoarseCounts, `${call.name}|validation`);
      }
      continue;
    }
    const strictFingerprint = `${call.name}|${call.argShape}|${errorClass}`;
    const coarseFingerprint = `${call.name}|${errorClass}`;
    incrementCount(initialCounts, strictFingerprint);
    incrementCount(initialCoarseCounts, coarseFingerprint);
    if (!schemaSignature) {
      continue;
    }
    incrementCount(initialValidationCounts, `${call.name}|schema:${schemaSignature}|validation`);
    incrementCount(initialValidationCoarseCounts, `${call.name}|validation`);
  }
  return {
    byCallId,
    latest,
    latestByToolName,
    initialCounts,
    initialCoarseCounts,
    initialValidationCounts,
    initialValidationCoarseCounts
  };
}
function classifyToolResult(content) {
  const text = toLowerText(content);
  if (!text) {
    return "unknown";
  }
  if (containsAny(text, [
    "missing required",
    "missing required argument",
    "invalid",
    "schema",
    "unexpected",
    "type error",
    "must be of type"
  ])) {
    return "validation";
  }
  if (containsAny(text, ["enoent", "not found", "no such file"])) {
    return "not_found";
  }
  if (containsAny(text, ["permission denied", "eacces", "forbidden"])) {
    return "permission";
  }
  if (containsAny(text, ["timeout", "timed out"])) {
    return "timeout";
  }
  if (containsAny(text, [
    "refused to overwrite",
    "refusing suspicious partial overwrite",
    "partial overwrite",
    "suspicious partial",
    "would reduce",
    "would partially overwrite",
    "much smaller"
  ])) {
    return "tool_error";
  }
  if (containsAny(text, ["# todos", `
[ ] `, `
[x] `, `
[x]`])) {
    return "success";
  }
  if (containsAny(text, ["success", "completed", '"ok":true', '"success":true'])) {
    return "success";
  }
  if (containsAny(text, ["error", "failed", '"is_error":true', '"success":false'])) {
    return "tool_error";
  }
  return "unknown";
}
function deriveArgumentShape(rawArguments) {
  try {
    const parsed = JSON.parse(rawArguments);
    return JSON.stringify(shapeOf(parsed));
  } catch {
    return "invalid_json";
  }
}
function deriveArgumentValueSignature(rawArguments) {
  try {
    const parsed = JSON.parse(rawArguments);
    return hashString(JSON.stringify(canonicalizeValue(parsed)));
  } catch {
    return `invalid:${hashString(rawArguments)}`;
  }
}
function deriveSuccessCoarseFingerprint(toolName, rawArguments) {
  const lowered = toolName.toLowerCase();
  if (lowered !== "edit" && lowered !== "write") {
    return null;
  }
  try {
    const parsed = JSON.parse(rawArguments);
    if (!isRecord6(parsed)) {
      return null;
    }
    const path2 = typeof parsed.path === "string" ? parsed.path : "";
    if (!path2) {
      return null;
    }
    if (lowered === "edit") {
      const oldString = typeof parsed.old_string === "string" ? parsed.old_string : null;
      if (oldString !== "") {
        return null;
      }
    }
    return `${toolName}|path:${hashString(path2)}|success`;
  } catch {
    return null;
  }
}
function extractAssistantToolCalls(messages) {
  const calls = [];
  for (const message of messages) {
    if (!isRecord6(message) || message.role !== "assistant" || !Array.isArray(message.tool_calls)) {
      continue;
    }
    for (const call of message.tool_calls) {
      if (!isRecord6(call)) {
        continue;
      }
      const id = typeof call.id === "string" ? call.id : "";
      const fn = isRecord6(call.function) ? call.function : null;
      const name = fn && typeof fn.name === "string" ? fn.name : "";
      const rawArguments = fn && typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn?.arguments ?? {});
      if (!id || !name) {
        continue;
      }
      calls.push({
        id,
        name,
        rawArguments,
        argShape: deriveArgumentShape(rawArguments),
        argValueSignature: deriveArgumentValueSignature(rawArguments),
        argKeys: extractArgumentKeys(rawArguments)
      });
    }
  }
  return calls;
}
function extractArgumentKeys(rawArguments) {
  try {
    const parsed = JSON.parse(rawArguments);
    if (!isRecord6(parsed)) {
      return [];
    }
    return Object.keys(parsed);
  } catch {
    return [];
  }
}
function deriveSchemaValidationSignature(toolName, argKeys) {
  if (toolName !== "edit") {
    return null;
  }
  const argKeySet = new Set(argKeys);
  const required = ["path", "old_string", "new_string"];
  const missing = required.filter((key) => !argKeySet.has(key));
  if (missing.length === 0) {
    return null;
  }
  return `missing:${missing.join(",")}`;
}
function normalizeValidationSignature(signature) {
  const normalized = signature.trim().toLowerCase();
  return normalized.length > 0 ? normalized : "invalid";
}
function evaluateWithFingerprints(toolName, errorClass, strictFingerprint, coarseFingerprint, strictCounts, coarseCounts, maxRepeat, coarseMaxRepeat) {
  if (errorClass === "success") {
    return {
      fingerprint: strictFingerprint,
      repeatCount: 0,
      maxRepeat,
      errorClass,
      triggered: false,
      tracked: false
    };
  }
  const isExplorationTool = EXPLORATION_TOOLS.has(toolName.toLowerCase());
  const effectiveMaxRepeat = isExplorationTool ? maxRepeat * EXPLORATION_LIMIT_MULTIPLIER : maxRepeat;
  const strictRepeatCount = (strictCounts.get(strictFingerprint) ?? 0) + 1;
  strictCounts.set(strictFingerprint, strictRepeatCount);
  const strictTriggered = strictRepeatCount > effectiveMaxRepeat;
  if (isExplorationTool) {
    return {
      fingerprint: strictFingerprint,
      repeatCount: strictRepeatCount,
      maxRepeat: effectiveMaxRepeat,
      errorClass,
      triggered: strictTriggered,
      tracked: true
    };
  }
  const coarseRepeatCount = (coarseCounts.get(coarseFingerprint) ?? 0) + 1;
  coarseCounts.set(coarseFingerprint, coarseRepeatCount);
  const coarseTriggered = coarseRepeatCount > coarseMaxRepeat;
  const preferCoarseFingerprint = coarseTriggered && !strictTriggered;
  return {
    fingerprint: preferCoarseFingerprint ? coarseFingerprint : strictFingerprint,
    repeatCount: preferCoarseFingerprint ? coarseRepeatCount : strictRepeatCount,
    maxRepeat: preferCoarseFingerprint ? coarseMaxRepeat : maxRepeat,
    errorClass,
    triggered: strictTriggered || coarseTriggered,
    tracked: true
  };
}
function incrementCount(map2, key) {
  map2.set(key, (map2.get(key) ?? 0) + 1);
}
function shapeOf(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return ["empty"];
    }
    return [shapeOf(value[0])];
  }
  if (isRecord6(value)) {
    const shaped = {};
    for (const key of Object.keys(value).sort()) {
      shaped[key] = shapeOf(value[key]);
    }
    return shaped;
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}
function canonicalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }
  if (isRecord6(value)) {
    const canonical = {};
    for (const key of Object.keys(value).sort()) {
      canonical[key] = canonicalizeValue(value[key]);
    }
    return canonical;
  }
  return value;
}
function hashString(value) {
  let hash = 2166136261;
  for (let i = 0;i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function normalizeErrorClassForTool(toolName, errorClass) {
  if (errorClass === "unknown" && UNKNOWN_AS_SUCCESS_TOOLS.has(toolName.toLowerCase())) {
    return "success";
  }
  return errorClass;
}
function toLowerText(content) {
  const rendered = renderContent(content);
  return rendered.trim().toLowerCase();
}
function renderContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (isRecord6(part) && typeof part.text === "string") {
        return part.text;
      }
      return JSON.stringify(part);
    }).join(" ");
  }
  if (content === null || content === undefined) {
    return "";
  }
  return JSON.stringify(content);
}
function containsAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var UNKNOWN_AS_SUCCESS_TOOLS, EXPLORATION_TOOLS, COARSE_LIMIT_MULTIPLIER = 3, EXPLORATION_LIMIT_MULTIPLIER = 5;
var init_tool_loop_guard = __esm(() => {
  UNKNOWN_AS_SUCCESS_TOOLS = new Set([
    "bash",
    "shell",
    "read",
    "write",
    "edit",
    "grep",
    "ls",
    "glob",
    "stat",
    "mkdir",
    "rm",
    "webfetch",
    "semsearch",
    "readlints"
  ]);
  EXPLORATION_TOOLS = new Set([
    "read",
    "grep",
    "glob",
    "ls",
    "stat",
    "semsearch",
    "bash",
    "shell",
    "webfetch",
    "task"
  ]);
});

// src/utils/binary.ts
import { existsSync as fsExistsSync } from "fs";
import * as pathModule from "path";
import { homedir as osHomedir } from "os";
function resolveCursorAgentBinary(deps = {}) {
  const platform2 = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const checkExists = deps.existsSync ?? fsExistsSync;
  const home = (deps.homedir ?? osHomedir)();
  const envOverride = env.CURSOR_AGENT_EXECUTABLE;
  if (envOverride && envOverride.length > 0) {
    return envOverride;
  }
  if (platform2 === "win32") {
    const pathJoin = pathModule.win32.join;
    const localAppData = env.LOCALAPPDATA ?? pathJoin(home, "AppData", "Local");
    const knownPath = pathJoin(localAppData, "cursor-agent", "cursor-agent.cmd");
    if (checkExists(knownPath)) {
      return knownPath;
    }
    log21.warn("cursor-agent not found at known Windows path, falling back to PATH", { checkedPath: knownPath });
    return "cursor-agent.cmd";
  }
  const knownPaths = [
    pathModule.join(home, ".cursor-agent", "cursor-agent"),
    "/usr/local/bin/cursor-agent"
  ];
  for (const p of knownPaths) {
    if (checkExists(p)) {
      return p;
    }
  }
  log21.warn("cursor-agent not found at known paths, falling back to PATH", { checkedPaths: knownPaths });
  return "cursor-agent";
}
function resolveCursorAgentBinaryStrict(deps = {}) {
  const platform2 = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const checkExists = deps.existsSync ?? fsExistsSync;
  const home = (deps.homedir ?? osHomedir)();
  const envOverride = env.CURSOR_AGENT_EXECUTABLE;
  if (envOverride && envOverride.length > 0) {
    return envOverride;
  }
  if (platform2 === "win32") {
    const pathJoin = pathModule.win32.join;
    const localAppData = env.LOCALAPPDATA ?? pathJoin(home, "AppData", "Local");
    const knownPath = pathJoin(localAppData, "cursor-agent", "cursor-agent.cmd");
    if (checkExists(knownPath)) {
      return knownPath;
    }
    throw new BinaryNotFoundError(knownPath);
  }
  return resolveCursorAgentBinary(deps);
}
function formatShellCommandForPlatform(command, platform2 = process.platform) {
  if (platform2 !== "win32") {
    return command;
  }
  if (command.startsWith('"') && command.endsWith('"')) {
    return command;
  }
  return `"${command}"`;
}
var log21;
var init_binary = __esm(() => {
  init_logger();
  init_errors();
  log21 = createLogger("binary");
});

// src/client/cursor-agent-child.ts
import { spawn as spawn3 } from "node:child_process";
import { randomBytes as randomBytes2 } from "node:crypto";
import { existsSync as existsSync6 } from "node:fs";
import { EventEmitter as EventEmitter2 } from "node:events";
import { PassThrough as PassThrough3 } from "node:stream";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { dirname as dirname2, resolve as resolve3 } from "node:path";
function isAgentPoolEnabled() {
  const value = process.env.CURSOR_ACP_AGENT_POOL?.toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}
function parseAgentPoolIdleMs() {
  const value = process.env.CURSOR_ACP_AGENT_POOL_IDLE_MS?.trim();
  if (value == null || value === "")
    return DEFAULT_IDLE_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    return DEFAULT_IDLE_MS;
  return Math.floor(parsed);
}
function buildAgentPoolKey(workspace, model) {
  return `${workspace}\x00${model}`;
}
function resolveCursorAgentRunnerPath(currentFile = fileURLToPath2(import.meta.url), checkExists = existsSync6, env = process.env) {
  const override = env.CURSOR_ACP_CURSOR_AGENT_RUNNER_PATH?.trim();
  if (override) {
    if (checkExists(override)) {
      return override;
    }
    throw new Error(`CURSOR_ACP_CURSOR_AGENT_RUNNER_PATH does not exist: ${override}`);
  }
  const currentDir = dirname2(currentFile);
  const candidates = [
    resolve3(currentDir, "../../scripts/cursor-agent-runner.mjs"),
    resolve3(currentDir, "../scripts/cursor-agent-runner.mjs")
  ];
  for (const candidate of candidates) {
    if (checkExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(`cursor-agent-runner.mjs not found. Tried: ${candidates.join(", ")}`);
}
function resolveNodeBinary2() {
  return process.env.CURSOR_ACP_NODE_BIN || "node";
}
function generateRequestId2() {
  return randomBytes2(8).toString("hex");
}

class CursorAgentPoolRunner {
  runnerProcess = null;
  pendingRequests = new Map;
  lineBuffer = "";
  starting = null;
  poolKey;
  onIdle;
  binaryMissing = false;
  attemptedPath = null;
  constructor(poolKey, onIdle) {
    this.poolKey = poolKey;
    this.onIdle = onIdle;
  }
  async ensureRunning() {
    if (this.runnerProcess || this.binaryMissing)
      return;
    if (this.starting)
      return this.starting;
    this.starting = this.doSpawn();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }
  async doSpawn() {
    try {
      resolveCursorAgentBinaryStrict();
    } catch (err) {
      if (err instanceof BinaryNotFoundError) {
        this.binaryMissing = true;
        this.attemptedPath = err.attemptedPath;
        log22.warn("cursor-agent binary not found on Windows, falling back to SDK runner", {
          attemptedPath: err.attemptedPath,
          platform: process.platform,
          fallback: "sdk-runner"
        });
        return;
      }
      throw err;
    }
    const nodeBin = resolveNodeBinary2();
    const runnerPath = resolveCursorAgentRunnerPath();
    log22.info("spawning persistent cursor-agent runner", {
      poolKeyHash: this.poolKey.slice(0, 8) + "窶ｦ",
      runnerPath,
      nodeBin
    });
    this.runnerProcess = spawn3(nodeBin, [runnerPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.runnerProcess.stdout?.on("data", (chunk) => {
      this.handleStdoutChunk(chunk);
    });
    this.runnerProcess.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8").trimEnd();
      for (const line of text.split(`
`)) {
        if (line)
          log22.debug(`[runner stderr] ${line}`);
      }
    });
    this.runnerProcess.on("close", (code) => {
      log22.error(`cursor-agent runner exited with code ${code}`, { poolKeyHash: this.poolKey.slice(0, 8) + "窶ｦ" });
      this.runnerProcess = null;
      for (const [, pending] of this.pendingRequests.entries()) {
        pending.promiseRejector(new Error(`Runner exited with code ${code}`));
        pending.controller.error(new Error(`Runner exited with code ${code}`));
      }
      this.pendingRequests.clear();
    });
    this.runnerProcess.on("error", (err) => {
      log22.error("cursor-agent runner spawn error", { error: err.message });
      this.runnerProcess = null;
      for (const [, pending] of this.pendingRequests.entries()) {
        pending.promiseRejector(err);
        pending.controller.error(err);
      }
      this.pendingRequests.clear();
    });
  }
  sendRequest(requestId, request) {
    if (!this.runnerProcess?.stdin) {
      throw new Error("Runner process not ready");
    }
    const payload = {
      id: requestId,
      model: request.model,
      cwd: request.cwd,
      prompt: request.prompt,
      resumeChatId: request.resumeChatId,
      force: request.force ?? false,
      cursorAgent: resolveCursorAgentBinary()
    };
    this.runnerProcess.stdin.write(JSON.stringify(payload) + `
`);
  }
  cancel(requestId) {
    if (!this.runnerProcess?.stdin) {
      log22.warn("cancel() called but runner stdin not ready", { requestId });
      return;
    }
    this.runnerProcess.stdin.write(JSON.stringify({ cancel: requestId }) + `
`);
  }
  handleStdoutChunk(chunk) {
    this.lineBuffer += chunk.toString("utf8");
    const lines = this.lineBuffer.split(`
`);
    this.lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim())
        continue;
      try {
        const wrapped = JSON.parse(line);
        const requestId = wrapped.id;
        if (!requestId) {
          log22.warn("Wrapped response missing id", { wrapped });
          continue;
        }
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
          log22.warn(`Received response for unknown request ${requestId}`);
          continue;
        }
        if (wrapped.done) {
          pending.controller.close();
          pending.controller.closeStderr();
          pending.promiseResolver(wrapped.exitCode ?? 0);
          this.pendingRequests.delete(requestId);
          this.notifyIdleIfEmpty();
        } else if (wrapped.stderr != null) {
          const text = typeof wrapped.stderr === "string" ? wrapped.stderr : String(wrapped.stderr);
          pending.controller.enqueueStderr(new TextEncoder().encode(text));
        } else if (wrapped.event) {
          const eventJson = extractEventJson(line);
          pending.controller.enqueue(new TextEncoder().encode(eventJson + `
`));
        }
      } catch (err) {
        log22.error("Failed to parse wrapped response line", {
          line,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
  isIdle() {
    return this.pendingRequests.size === 0;
  }
  notifyIdleIfEmpty() {
    if (this.pendingRequests.size === 0) {
      this.onIdle(this.poolKey);
    }
  }
  registerPending(controller, promiseResolver, promiseRejector) {
    const id = generateRequestId2();
    this.pendingRequests.set(id, { controller, promiseResolver, promiseRejector });
    return id;
  }
  failAllPending(err) {
    for (const [, pending] of this.pendingRequests.entries()) {
      pending.promiseRejector(err);
      pending.controller.error(err);
    }
    this.pendingRequests.clear();
  }
  kill() {
    if (this.runnerProcess) {
      try {
        this.runnerProcess.kill("SIGKILL");
      } catch {}
      this.runnerProcess = null;
    }
    this.failAllPending(new Error("Runner killed"));
  }
}

class CursorAgentPoolManager {
  runners = new Map;
  idleTimers = new Map;
  getRunner(poolKey) {
    this.clearIdleTimer(poolKey);
    let runner = this.runners.get(poolKey);
    if (!runner) {
      while (this.runners.size >= DEFAULT_MAX_POOL_ENTRIES) {
        const oldest = this.runners.keys().next().value;
        if (oldest === undefined)
          break;
        this.clearIdleTimer(oldest);
        this.runners.get(oldest)?.kill();
        this.runners.delete(oldest);
      }
      runner = new CursorAgentPoolRunner(poolKey, (idlePoolKey) => {
        this.scheduleIdleEviction(idlePoolKey);
      });
      this.runners.set(poolKey, runner);
    }
    return runner;
  }
  size() {
    return this.runners.size;
  }
  clearIdleTimer(poolKey) {
    const timer = this.idleTimers.get(poolKey);
    if (!timer)
      return;
    clearTimeout(timer);
    this.idleTimers.delete(poolKey);
  }
  scheduleIdleEviction(poolKey) {
    this.clearIdleTimer(poolKey);
    const idleMs = parseAgentPoolIdleMs();
    if (idleMs <= 0)
      return;
    const timer = setTimeout(() => {
      this.idleTimers.delete(poolKey);
      const runner = this.runners.get(poolKey);
      if (!runner || !runner.isIdle())
        return;
      runner.kill();
      this.runners.delete(poolKey);
      log22.debug("evicted idle cursor-agent runner", {
        poolKeyHash: poolKey.slice(0, 8) + "窶ｦ",
        idleMs
      });
    }, idleMs);
    timer.unref?.();
    this.idleTimers.set(poolKey, timer);
  }
  stopAll() {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    for (const runner of this.runners.values()) {
      runner.kill();
    }
    this.runners.clear();
  }
}
function createCursorAgentPoolNodeChild(options) {
  const poolKey = buildAgentPoolKey(options.cwd, options.model);
  const child = new CursorAgentPoolNodeChild(options.sdkApiKey, options.createSdkChild);
  child.spawn({ ...options, poolKey });
  return child;
}
var log22, DEFAULT_MAX_POOL_ENTRIES = 16, DEFAULT_IDLE_MS, poolManager, CursorAgentPoolNodeChild;
var init_cursor_agent_child = __esm(() => {
  init_logger();
  init_binary();
  init_errors();
  init_sdk_child();
  log22 = createLogger("cursor-agent-child");
  DEFAULT_IDLE_MS = 15 * 60 * 1000;
  poolManager = new CursorAgentPoolManager;
  CursorAgentPoolNodeChild = class CursorAgentPoolNodeChild extends EventEmitter2 {
    stdout = new PassThrough3;
    stderr = new PassThrough3;
    requestId = null;
    runner = null;
    sdkChild = null;
    sdkApiKey;
    createSdkChildFn;
    constructor(sdkApiKey, createSdkChild) {
      super();
      this.sdkApiKey = sdkApiKey;
      this.createSdkChildFn = createSdkChild;
    }
    spawn(options) {
      this.spawnInternal(options);
    }
    async spawnInternal(options) {
      try {
        const runner = poolManager.getRunner(options.poolKey);
        this.runner = runner;
        await runner.ensureRunning();
        if (runner.binaryMissing) {
          if (!this.sdkApiKey) {
            throw new Error(`Pool binary unavailable (${runner.attemptedPath}); SDK fallback also failed: no sdkApiKey provided.`);
          }
          try {
            const sdkChildFactory = this.createSdkChildFn ?? createSdkNodeChild;
            const sdkChild = sdkChildFactory({
              apiKey: this.sdkApiKey,
              model: options.model,
              prompt: options.prompt,
              cwd: options.cwd
            });
            this.sdkChild = sdkChild;
            sdkChild.stdout.on("data", (chunk) => {
              this.stdout.write(chunk);
            });
            sdkChild.stderr.on("data", (chunk) => {
              this.stderr.write(chunk);
            });
            sdkChild.on("close", (code) => {
              this.stderr.end();
              this.emit("close", code);
            });
            sdkChild.on("error", (err) => {
              const combinedErr = new Error(`Pool binary unavailable (${runner.attemptedPath}); SDK fallback also failed: ${err.message}`);
              this.emit("error", combinedErr);
              this.stderr?.end?.();
              this.stdout?.end?.();
              this.emit("close", 1);
            });
            log22.debug("cursor-agent pool fallback to SDK runner", {
              poolKeyHash: options.poolKey.slice(0, 8) + "窶ｦ"
            });
            return;
          } catch (sdkErr) {
            throw new Error(`Pool binary unavailable (${runner.attemptedPath}); SDK fallback also failed: ${sdkErr instanceof Error ? sdkErr.message : String(sdkErr)}`);
          }
        }
        const controller = {
          enqueue: (data) => {
            this.stdout.write(data);
          },
          enqueueStderr: (data) => {
            this.stderr.write(data);
          },
          close: () => {
            this.stdout.end();
          },
          closeStderr: () => {
            this.stderr.end();
          },
          error: (err) => {
            this.stdout.destroy(err);
          }
        };
        const requestId = runner.registerPending(controller, (code) => {
          this.stderr.end();
          this.emit("close", code);
        }, (err) => {
          this.stderr.end();
          this.emit("error", err);
        });
        this.requestId = requestId;
        runner.sendRequest(requestId, options);
        log22.debug("cursor-agent pool request dispatched", {
          requestId,
          poolKeyHash: options.poolKey.slice(0, 8) + "窶ｦ",
          resume: !!options.resumeChatId
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log22.error("Failed to spawn cursor-agent pool child", { error: error.message });
        this.emit("error", error);
        this.stderr.end();
        this.stdout.end();
        this.emit("close", 1);
      }
    }
    kill() {
      if (this.runner && this.requestId) {
        log22.debug(`kill() cancelling pool request ${this.requestId}`);
        this.runner.cancel(this.requestId);
      } else if (this.requestId) {
        log22.debug(`kill() called before runner ready for ${this.requestId}`);
      }
      if (this.sdkChild) {
        this.sdkChild.kill();
      }
    }
  };
});

// src/provider/backend.ts
function parseCursorBackendPreference(value) {
  if (value === undefined || value.trim() === "") {
    return { preference: "auto", valid: true };
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "cursor-agent" || normalized === "sdk") {
    return { preference: normalized, valid: true };
  }
  return { preference: "auto", valid: false };
}
function selectBackendForRequest(input) {
  if (input.preference === "sdk") {
    return "sdk";
  }
  if (input.preference === "auto" && !input.cursorAgentAvailable && isUsableSdkApiKey(input.sdkApiKey)) {
    return "sdk";
  }
  return "cursor-agent";
}
var init_backend = __esm(() => {
  init_auth();
  init_auth();
});

// src/cli/model-discovery.ts
import { execFileSync } from "child_process";
function parseCursorModelsOutput(output) {
  const clean = stripAnsi(output);
  const models = [];
  const seen = new Set;
  for (const line of clean.split(`
`)) {
    const trimmed = line.trim();
    if (!trimmed)
      continue;
    const match = trimmed.match(/^([a-zA-Z0-9._-]+)\s+-\s+(.+?)(?:\s+\((?:current|default)\))*\s*$/);
    if (!match)
      continue;
    const id = match[1];
    if (seen.has(id))
      continue;
    seen.add(id);
    models.push({ id, name: match[2].trim() });
  }
  return models;
}
function discoverModelsFromCursorAgent() {
  const raw = execFileSync(resolveCursorAgentBinary(), ["models"], {
    encoding: "utf8",
    ...process.platform !== "win32" && { killSignal: "SIGTERM" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: MODEL_DISCOVERY_TIMEOUT_MS
  });
  const models = parseCursorModelsOutput(raw);
  if (models.length === 0) {
    throw new Error("No models parsed from cursor-agent output");
  }
  return models;
}
function fallbackModels() {
  return [
    { id: "auto", name: "Auto" },
    { id: "composer-1.5", name: "Composer 1.5" },
    { id: "composer-1", name: "Composer 1" },
    { id: "opus-4.6-thinking", name: "Claude 4.6 Opus (Thinking)" },
    { id: "opus-4.6", name: "Claude 4.6 Opus" },
    { id: "sonnet-4.6", name: "Claude 4.6 Sonnet" },
    { id: "sonnet-4.6-thinking", name: "Claude 4.6 Sonnet (Thinking)" },
    { id: "opus-4.5", name: "Claude 4.5 Opus" },
    { id: "opus-4.5-thinking", name: "Claude 4.5 Opus (Thinking)" },
    { id: "sonnet-4.5", name: "Claude 4.5 Sonnet" },
    { id: "sonnet-4.5-thinking", name: "Claude 4.5 Sonnet (Thinking)" },
    { id: "gpt-5.4-high", name: "GPT-5.4 High" },
    { id: "gpt-5.4-medium", name: "GPT-5.4" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-3-pro", name: "Gemini 3 Pro" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash" },
    { id: "grok", name: "Grok" },
    { id: "kimi-k2.5", name: "Kimi K2.5" }
  ];
}
var MODEL_DISCOVERY_TIMEOUT_MS = 5000;
var init_model_discovery = __esm(() => {
  init_errors();
  init_binary();
});

// src/models/discovery.ts
var exports_discovery = {};
__export(exports_discovery, {
  ModelDiscoveryService: () => ModelDiscoveryService
});

class ModelDiscoveryService {
  cache = null;
  cacheTTL;
  fallbackModels;
  constructor(config = {}) {
    this.cacheTTL = config.cacheTTL || 5 * 60 * 1000;
    this.fallbackModels = config.fallbackModels || this.getDefaultModels();
  }
  async discover(apiKey) {
    if (this.cache && Date.now() - this.cache.timestamp < this.cacheTTL) {
      return this.cache.models;
    }
    const backendPreference = parseCursorBackendPreference(process.env.CURSOR_ACP_BACKEND).preference;
    const queryOrder = backendPreference === "sdk" ? ["sdk"] : backendPreference === "cursor-agent" ? ["cursor-agent"] : ["cursor-agent", "sdk"];
    for (const backend of queryOrder) {
      try {
        const models = backend === "cursor-agent" ? await this.queryCursorAgent() : await this.queryViaSdk(apiKey);
        this.cache = { models, timestamp: Date.now() };
        return models;
      } catch {}
    }
    this.cache = { models: this.fallbackModels, timestamp: Date.now() };
    return this.fallbackModels;
  }
  async queryCursorAgent(apiKey) {
    return discoverModelsFromCursorAgent().map((model) => ({
      id: model.id,
      name: model.name,
      description: `Cursor ${model.name} model`
    }));
  }
  async queryViaSdk(apiKey) {
    const key = resolveSdkApiKey({ env: process.env, storedApiKey: apiKey });
    if (!key) {
      throw new Error("No Cursor API key available");
    }
    const sdkModels = await listModelsViaRunner(key);
    return sdkModels.map((m) => ({
      id: m.id,
      name: m.name,
      description: `Cursor ${m.name} model`
    }));
  }
  getDefaultModels() {
    return [
      { id: "auto", name: "Auto", description: "Auto-select best model" },
      { id: "composer-1.5", name: "Composer 1.5" },
      { id: "composer-1", name: "Composer 1" },
      { id: "opus-4.6-thinking", name: "Claude 4.6 Opus (Thinking)" },
      { id: "opus-4.6", name: "Claude 4.6 Opus" },
      { id: "sonnet-4.6", name: "Claude 4.6 Sonnet" },
      { id: "sonnet-4.6-thinking", name: "Claude 4.6 Sonnet (Thinking)" },
      { id: "opus-4.5", name: "Claude 4.5 Opus" },
      { id: "opus-4.5-thinking", name: "Claude 4.5 Opus (Thinking)" },
      { id: "sonnet-4.5", name: "Claude 4.5 Sonnet" },
      { id: "sonnet-4.5-thinking", name: "Claude 4.5 Sonnet (Thinking)" },
      { id: "gpt-5.4-high", name: "GPT-5.4 High" },
      { id: "gpt-5.4-medium", name: "GPT-5.4" },
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
      { id: "gemini-3-pro", name: "Gemini 3 Pro" },
      { id: "gemini-3-flash", name: "Gemini 3 Flash" },
      { id: "grok", name: "Grok" },
      { id: "kimi-k2.5", name: "Kimi K2.5" }
    ];
  }
  invalidateCache() {
    this.cache = null;
  }
}
var init_discovery2 = __esm(() => {
  init_sdk_child();
  init_model_discovery();
  init_auth();
  init_backend();
});

// src/plugin.ts
var exports_plugin = {};
__export(exports_plugin, {
  shouldRegisterNativeToolHook: () => shouldRegisterNativeToolHook,
  shouldProcessModel: () => shouldProcessModel,
  resolveWorkspaceDirectory: () => resolveWorkspaceDirectory,
  resolvePromptForBackend: () => resolvePromptForBackend,
  resolveChatParamTools: () => resolveChatParamTools,
  normalizeWorkspaceForCompare: () => normalizeWorkspaceForCompare,
  maybeEvictResumeChatId: () => maybeEvictResumeChatId,
  isRootPath: () => isRootPath,
  isReusableProxyHealthPayload: () => isReusableProxyHealthPayload,
  fetchProxyHealthWithTimeout: () => fetchProxyHealthWithTimeout,
  extractCompletionFromStream: () => extractCompletionFromStream,
  ensurePluginDirectory: () => ensurePluginDirectory,
  default: () => plugin_default,
  captureResumeChatIdFromOutput: () => captureResumeChatIdFromOutput,
  captureResumeChatIdFromEvent: () => captureResumeChatIdFromEvent,
  buildCursorAgentCommand: () => buildCursorAgentCommand,
  buildAvailableToolsSystemMessage: () => buildAvailableToolsSystemMessage,
  applyCursorWriteToolContract: () => applyCursorWriteToolContract,
  CursorPlugin: () => CursorPlugin
});
import { tool as tool2 } from "@opencode-ai/plugin/tool";
import { spawn as spawn4, spawnSync } from "child_process";
import { realpathSync } from "fs";
import { mkdir } from "fs/promises";
import { homedir as homedir4 } from "os";
import { isAbsolute, join as join5, relative, resolve as resolve4 } from "path";
function getMcpToolDefinitionName(mcpToolDefs, index) {
  const name = mcpToolDefs[index]?.function?.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}
function buildAvailableToolsSystemMessage(lastToolNames, lastToolMap, mcpToolDefs, mcpToolSummaries, subagentNames = []) {
  const parts = [];
  if (lastToolNames.length > 0 || lastToolMap.length > 0) {
    const names = lastToolNames.join(", ");
    const mapping = lastToolMap.map((m) => `${m.id} -> ${m.name}`).join("; ");
    parts.push(`Available OpenCode tools (use via tool calls): ${names}. Original skill ids mapped as: ${mapping}. Aliases include oc_skill_* and oc_superskill_* when applicable.`);
  }
  if (mcpToolSummaries && mcpToolSummaries.length > 0) {
    const summariesWithCallNames = mcpToolSummaries.map((summary, index) => ({
      ...summary,
      callName: summary.callName ?? getMcpToolDefinitionName(mcpToolDefs, index) ?? namespaceMcpTool(summary.serverName, summary.toolName)
    }));
    const servers = new Map;
    for (const s of summariesWithCallNames) {
      const list = servers.get(s.serverName) ?? [];
      list.push(s);
      servers.set(s.serverName, list);
    }
    const lines = [
      `MCP TOOLS 窶・Call these tools by their FULL exact name (e.g. mcp__filesystem__read_file).`,
      `Important: There is NO tool named 'mcp'. Every MCP tool has the format mcp__<server>__<tool>.`,
      "Do NOT call a tool named 'mcp' with parameters. Always use the complete tool name below.",
      ""
    ];
    for (const [server2, tools] of servers) {
      lines.push(`Server: ${server2}`);
      for (const t of tools) {
        const paramHint = t.params?.length ? ` (params: ${t.params.join(", ")})` : "";
        const sourceHint = t.callName === t.toolName ? "" : ` (server: ${t.serverName}; tool: ${t.toolName})`;
        lines.push(`  - ${t.callName}${paramHint}${t.description ? " 窶・" + t.description : ""}${sourceHint}`);
      }
      lines.push("");
    }
    parts.push(lines.join(`
`));
  }
  if (subagentNames.length > 0) {
    parts.push(`When calling the task tool, set subagent_type to one of: ${subagentNames.join(", ")}. Do not omit this parameter.`);
  }
  return parts.length > 0 ? parts.join(`

`) : null;
}
async function ensurePluginDirectory() {
  const configHome = process.env.XDG_CONFIG_HOME ? resolve4(process.env.XDG_CONFIG_HOME) : join5(homedir4(), ".config");
  const pluginDir = join5(configHome, "opencode", "plugin");
  try {
    await mkdir(pluginDir, { recursive: true });
    log23.debug("Plugin directory ensured", { path: pluginDir });
  } catch (error) {
    log23.warn("Failed to create plugin directory", { error: String(error) });
  }
}
function shouldProcessModel(model) {
  if (!model)
    return false;
  return model.startsWith(CURSOR_PROVIDER_PREFIX);
}
function getGlobalKey() {
  return "__opencode_cursor_proxy_server__";
}
function isCursorAgentAvailable() {
  if (cursorAgentAvailabilityCache !== undefined) {
    return cursorAgentAvailabilityCache;
  }
  const binary = resolveCursorAgentBinary();
  const result = spawnSync(formatShellCommandForPlatform(binary), ["--version"], {
    stdio: "ignore",
    timeout: 1000,
    shell: process.platform === "win32"
  });
  const error = result.error;
  cursorAgentAvailabilityCache = error?.code === "ENOENT" ? false : true;
  return cursorAgentAvailabilityCache;
}
function resolveBackendForRequest(sdkApiKey) {
  const parsed = parseCursorBackendPreference(process.env.CURSOR_ACP_BACKEND);
  if (!parsed.valid) {
    log23.warn("Invalid CURSOR_ACP_BACKEND value; falling back to auto", {
      value: process.env.CURSOR_ACP_BACKEND
    });
  }
  return selectBackendForRequest({
    preference: parsed.preference,
    cursorAgentAvailable: isCursorAgentAvailable(),
    sdkApiKey
  });
}
function buildCursorAgentCommand(model, workspaceDirectory, resumeChatId) {
  const cmd = [
    resolveCursorAgentBinary(),
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--workspace",
    workspaceDirectory,
    "--model",
    model
  ];
  if (resumeChatId) {
    if (RESUME_CHAT_ID_SAFE_RE.test(resumeChatId)) {
      cmd.push("--resume", resumeChatId);
    } else {
      log23.warn("Refusing to pass unsafe resume chat ID to cursor-agent; --resume omitted", {
        resumeChatIdHash: hashForLog(resumeChatId),
        model
      });
    }
  }
  if (FORCE_TOOL_MODE) {
    cmd.push("--force");
  }
  return cmd;
}
function resolvePromptForBackend(input) {
  let fullPrompt;
  const getFullPrompt = () => fullPrompt ??= buildPromptFromMessages(input.messages, input.tools, input.subagentNames, input.workspaceDirectory);
  if (input.backend !== "cursor-agent" || !isSessionResumeEnabled()) {
    return { prompt: getFullPrompt(), usedIncremental: false };
  }
  const anchorResult = deriveConversationAnchor(input.messages);
  if (!anchorResult) {
    log23.warn("Session resume enabled but no usable conversation anchor; skipping resume", {
      model: input.model,
      workspaceDirectoryHash: sanitizeSessionKey(input.workspaceDirectory)
    });
    return { prompt: getFullPrompt(), usedIncremental: false };
  }
  const { anchor, contentPrefix: anchorContentPrefix } = anchorResult;
  const resumePrefixes = deriveConversationResumePrefixes(input.messages);
  const contentPrefix = resumePrefixes?.lookupContentPrefix ?? anchorContentPrefix;
  const recordContentPrefix = resumePrefixes?.recordContentPrefix ?? contentPrefix;
  const sessionKey = buildSessionKey(input.workspaceDirectory, input.model, anchor);
  const sessionKeyHash = sanitizeSessionKey(sessionKey);
  const toolFingerprint = buildToolFingerprint(input.tools);
  const subagentFingerprint = input.subagentNames.slice().sort().join(",");
  const resumeChatId = getResumeChatId(sessionKey, contentPrefix, toolFingerprint, subagentFingerprint);
  const resumeChatIdHash = resumeChatId ? sanitizeSessionKey(resumeChatId) : undefined;
  if (!resumeChatId) {
    const isContinuation = input.messages.some((m) => m?.role === "assistant");
    if (isContinuation) {
      log23.warn("Session resume enabled but no chatId found for sessionKey; falling back to full prompt", {
        sessionKeyHash
      });
    }
    return { prompt: getFullPrompt(), sessionKey, usedIncremental: false, contentPrefix, recordContentPrefix, toolFingerprint, subagentFingerprint };
  }
  const incremental = buildIncrementalPrompt(input.messages);
  if (incremental) {
    if (log23.isDebugEnabled()) {
      log23.debug("Using incremental prompt with session resume", {
        sessionKeyHash,
        resumeChatIdHash,
        promptChars: incremental.length,
        fullPromptChars: getFullPrompt().length
      });
    }
    return { prompt: incremental, resumeChatId, sessionKey, usedIncremental: true, contentPrefix, recordContentPrefix, toolFingerprint, subagentFingerprint };
  }
  log23.info("Session resume active but incremental prompt unavailable; using full prompt", {
    sessionKeyHash,
    resumeChatIdHash
  });
  return { prompt: getFullPrompt(), resumeChatId, sessionKey, usedIncremental: false, contentPrefix, recordContentPrefix, toolFingerprint, subagentFingerprint };
}
function captureResumeChatIdFromEvent(event, sessionKey, model, workspaceDirectory, contentPrefix, toolFingerprint, subagentFingerprint) {
  if (!sessionKey || !isSessionResumeEnabled())
    return;
  const chatId = event.session_id;
  if (chatId == null)
    return;
  if (typeof chatId === "string" && chatId.trim()) {
    recordResumeChatId(sessionKey, chatId.trim(), contentPrefix ?? "", toolFingerprint, subagentFingerprint);
    return;
  }
  log23.warn("cursor-agent emitted invalid session_id", {
    type: typeof chatId,
    length: String(chatId).length,
    sessionKeyHash: sanitizeSessionKey(sessionKey)
  });
}
function captureResumeChatIdFromOutput(output, sessionKey, model, workspaceDirectory, contentPrefix, toolFingerprint, subagentFingerprint) {
  if (!sessionKey || !isSessionResumeEnabled() || !output)
    return;
  for (const line of output.split(/\r?\n/)) {
    const event = parseStreamJsonLine(line);
    if (event) {
      captureResumeChatIdFromEvent(event, sessionKey, model, workspaceDirectory, contentPrefix, toolFingerprint, subagentFingerprint);
    }
  }
}
function maybeEvictResumeChatId(errSource, resumeChatId, sessionKey, logFields = {}) {
  if (!resumeChatId || !sessionKey || !isSessionResumeEnabled() || !isResumeSpecificFailure(errSource)) {
    return false;
  }
  clearResumeChatId(sessionKey);
  log23.warn("Evicting resume chatId after resume-specific cursor-agent failure", {
    code: logFields.code,
    spawnError: logFields.spawnError,
    sessionKeyHash: sanitizeSessionKey(sessionKey),
    resumeChatIdHash: sanitizeSessionKey(resumeChatId),
    failureTextHash: logFields.failureTextHash,
    hadResume: true
  });
  return true;
}
function isSuccessfulResultEvent(event) {
  return isResult(event) && event.is_error !== true && event.subtype !== "error";
}
function shouldTreatCursorAgentFailureAsDiagnostic(errSource, sawSuccessfulStreamOutput) {
  if (!sawSuccessfulStreamOutput) {
    return false;
  }
  return parseAgentError(errSource).type === "quota";
}
function warnIfResumeNotCaptured(sessionResumeKey, sessionResumeKeyHash, sessionResumeContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint, model) {
  if (sessionResumeKey && isSessionResumeEnabled() && !hasResumeChatId(sessionResumeKey, sessionResumeContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint)) {
    log23.warn("Session resume enabled but no session_id captured from cursor-agent response; resume will not activate on the next turn", {
      sessionKeyHash: sessionResumeKeyHash,
      model
    });
  }
}
function createCursorAgentBunChild(model, prompt, workspaceDirectory, resumeChatId) {
  const bunAny = globalThis;
  if (!bunAny.Bun?.spawn) {
    throw new Error("This provider requires Bun runtime.");
  }
  const child = bunAny.Bun.spawn({
    cmd: buildCursorAgentCommand(model, workspaceDirectory, resumeChatId),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunAny.Bun.env
  });
  child.stdin.write(prompt);
  child.stdin.end();
  return child;
}
function createBunChildForBackend(input) {
  if (input.backend === "sdk") {
    if (!input.sdkApiKey) {
      throw new Error("SDK backend requires CURSOR_API_KEY or OpenCode auth.");
    }
    return createSdkBunChild({
      apiKey: input.sdkApiKey,
      model: input.model,
      prompt: input.prompt,
      cwd: input.workspaceDirectory
    });
  }
  return createCursorAgentBunChild(input.model, input.prompt, input.workspaceDirectory, input.resumeChatId);
}
function createCursorAgentNodeChild(model, prompt, workspaceDirectory, resumeChatId) {
  const cmd = buildCursorAgentCommand(model, workspaceDirectory, resumeChatId);
  const child = spawn4(formatShellCommandForPlatform(cmd[0]), cmd.slice(1), {
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32"
  });
  child.stdin.write(prompt);
  child.stdin.end();
  return child;
}
function createNodeChildForBackend(input) {
  if (input.backend === "sdk") {
    if (!input.sdkApiKey) {
      throw new Error("SDK backend requires CURSOR_API_KEY or OpenCode auth.");
    }
    return createSdkNodeChild({
      apiKey: input.sdkApiKey,
      model: input.model,
      prompt: input.prompt,
      cwd: input.workspaceDirectory
    });
  }
  if (isAgentPoolEnabled()) {
    log23.debug("Using cursor-agent pool for request", {
      model: input.model,
      resume: !!input.resumeChatId
    });
    return createCursorAgentPoolNodeChild({
      model: input.model,
      prompt: input.prompt,
      cwd: input.workspaceDirectory,
      resumeChatId: input.resumeChatId,
      force: FORCE_TOOL_MODE,
      sdkApiKey: input.sdkApiKey
    });
  }
  return createCursorAgentNodeChild(input.model, input.prompt, input.workspaceDirectory, input.resumeChatId);
}
function getOpenCodeConfigPrefix() {
  const configHome = process.env.XDG_CONFIG_HOME ? resolve4(process.env.XDG_CONFIG_HOME) : join5(homedir4(), ".config");
  return join5(configHome, "opencode");
}
function canonicalizePathForCompare(pathValue) {
  const resolvedPath = resolve4(pathValue);
  let normalizedPath = resolvedPath;
  try {
    normalizedPath = typeof realpathSync.native === "function" ? realpathSync.native(resolvedPath) : realpathSync(resolvedPath);
  } catch {
    normalizedPath = resolvedPath;
  }
  if (process.platform === "darwin" || process.platform === "win32") {
    return normalizedPath.toLowerCase();
  }
  return normalizedPath;
}
function isWithinPath(root, candidate) {
  const normalizedRoot = canonicalizePathForCompare(root);
  const normalizedCandidate = canonicalizePathForCompare(candidate);
  const rel = relative(normalizedRoot, normalizedCandidate);
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
function resolveCandidate(value) {
  if (!value || value.trim().length === 0) {
    return "";
  }
  return resolve4(value);
}
function isNonConfigPath(pathValue) {
  if (!pathValue) {
    return false;
  }
  return !isWithinPath(getOpenCodeConfigPrefix(), pathValue);
}
function isRootPath(pathValue) {
  if (!pathValue) {
    return false;
  }
  const resolved = resolve4(pathValue);
  if (resolved === "/") {
    return true;
  }
  return /^[A-Za-z]:[\\/]?$/.test(resolved);
}
function isAcceptableWorkspace(pathValue, configPrefix) {
  if (!pathValue) {
    return false;
  }
  if (isRootPath(pathValue)) {
    return false;
  }
  if (isWithinPath(configPrefix, pathValue)) {
    return false;
  }
  return true;
}
function resolveWorkspaceDirectory(worktree, directory) {
  const configPrefix = getOpenCodeConfigPrefix();
  const envWorkspace = resolveCandidate(process.env.CURSOR_ACP_WORKSPACE);
  if (envWorkspace && !isRootPath(envWorkspace)) {
    return envWorkspace;
  }
  const envProjectDir = resolveCandidate(process.env.OPENCODE_CURSOR_PROJECT_DIR);
  if (envProjectDir && !isRootPath(envProjectDir)) {
    return envProjectDir;
  }
  const worktreeCandidate = resolveCandidate(worktree);
  if (isAcceptableWorkspace(worktreeCandidate, configPrefix)) {
    return worktreeCandidate;
  }
  const dirCandidate = resolveCandidate(directory);
  if (isAcceptableWorkspace(dirCandidate, configPrefix)) {
    return dirCandidate;
  }
  const cwd = resolve4(process.cwd());
  if (isAcceptableWorkspace(cwd, configPrefix)) {
    return cwd;
  }
  const home = resolveCandidate(homedir4());
  if (home && !isRootPath(home)) {
    return home;
  }
  return configPrefix;
}
function normalizeWorkspaceForCompare(pathValue) {
  const resolved = resolve4(pathValue);
  if (process.platform === "darwin" || process.platform === "win32") {
    return resolved.toLowerCase();
  }
  return resolved;
}
function isReusableProxyHealthPayload(payload, workspaceDirectory) {
  if (!payload || payload.ok !== true) {
    return false;
  }
  if (typeof payload.workspaceDirectory !== "string" || payload.workspaceDirectory.length === 0) {
    return false;
  }
  return normalizeWorkspaceForCompare(payload.workspaceDirectory) === normalizeWorkspaceForCompare(workspaceDirectory);
}
async function fetchProxyHealthWithTimeout(url, timeoutMs = CURSOR_PROXY_HEALTH_TIMEOUT_MS) {
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout.unref === "function") {
    timeout.unref();
  }
  try {
    return await fetch(url, { signal: controller.signal }).catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}
function parseToolLoopMode(value) {
  const normalized = (value ?? "opencode").trim().toLowerCase();
  if (normalized === "opencode" || normalized === "proxy-exec" || normalized === "off") {
    return { mode: normalized, valid: true };
  }
  return { mode: "opencode", valid: false };
}
function resolveChatParamTools(mode, existingTools, refreshedTools) {
  return PROVIDER_BOUNDARY.resolveChatParamTools(mode, existingTools, refreshedTools);
}
function applyCursorWriteToolContract(tools) {
  if (!Array.isArray(tools)) {
    return tools;
  }
  let changed = false;
  const writeContract = buildCursorWriteToolContract(tools);
  const patched = tools.map((tool3) => {
    if (!tool3 || typeof tool3 !== "object") {
      return tool3;
    }
    const record3 = tool3;
    const functionRecord = record3.function;
    const isFunctionWrite = functionRecord && typeof functionRecord === "object" && functionRecord.name === "write";
    const isTopLevelWrite = record3.name === "write";
    if (!isFunctionWrite && !isTopLevelWrite) {
      return tool3;
    }
    const target = isFunctionWrite ? functionRecord : record3;
    const description = typeof target.description === "string" ? target.description : "";
    if (description.includes(writeContract)) {
      return tool3;
    }
    changed = true;
    const baseDescription = description.replace(WRITE_TOOL_TARGETED_EDIT_CONTRACT, "").trim();
    const nextDescription = baseDescription ? `${baseDescription} ${writeContract}` : writeContract;
    if (isFunctionWrite) {
      return {
        ...record3,
        function: {
          ...functionRecord,
          description: nextDescription
        }
      };
    }
    return {
      ...record3,
      description: nextDescription
    };
  });
  return changed ? patched : tools;
}
function buildCursorWriteToolContract(tools) {
  const editSchema = findToolParameters(tools, "edit");
  const editArgs = editSchema ? detectEditArgumentNames(editSchema) : null;
  if (!editArgs) {
    return WRITE_TOOL_TARGETED_EDIT_CONTRACT;
  }
  return [
    "Use only for new files or intentional full-file replacement.",
    `For targeted edits to existing files, use edit with ${editArgs.path}, ${editArgs.old}, and ${editArgs.next}.`
  ].join(" ");
}
function findToolParameters(tools, name) {
  for (const tool3 of tools) {
    if (!tool3 || typeof tool3 !== "object") {
      continue;
    }
    const record3 = tool3;
    const fn = record3.function && typeof record3.function === "object" ? record3.function : record3;
    if (fn.name === name) {
      return fn.parameters;
    }
  }
  return null;
}
function detectEditArgumentNames(schema) {
  if (!schema || typeof schema !== "object") {
    return null;
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") {
    return null;
  }
  const keys = new Set(Object.keys(properties));
  const path2 = keys.has("filePath") ? "filePath" : keys.has("path") ? "path" : null;
  const old = keys.has("oldString") ? "oldString" : keys.has("old_string") ? "old_string" : null;
  const next = keys.has("newString") ? "newString" : keys.has("new_string") ? "new_string" : null;
  return path2 && old && next ? { path: path2, old, next } : null;
}
function createChatCompletionResponse(model, content, reasoningContent, usage) {
  const message = {
    role: "assistant",
    content
  };
  if (reasoningContent && reasoningContent.length > 0) {
    message.reasoning_content = reasoningContent;
  }
  const response = {
    id: `cursor-acp-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: "stop"
      }
    ]
  };
  if (usage) {
    response.usage = usage;
  }
  return response;
}
function createChatCompletionChunk(id, created, model, deltaContent, done = false) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: deltaContent ? { content: deltaContent } : {},
        finish_reason: done ? "stop" : null
      }
    ]
  };
}
function extractCompletionFromStream(output) {
  const lines = output.split(`
`);
  let assistantText = "";
  let reasoningText = "";
  let usage;
  let sawAssistantPartials = false;
  let sawThinkingPartials = false;
  const tracker = new MixedDeltaTracker;
  for (const line of lines) {
    const event = parseStreamJsonLine(line);
    if (!event) {
      continue;
    }
    if (isAssistantText(event)) {
      const text = extractText(event);
      if (!text)
        continue;
      const isPartial = typeof event.timestamp_ms === "number";
      if (isPartial) {
        sawAssistantPartials = true;
        assistantText += tracker.nextText(text);
      } else if (!sawAssistantPartials) {
        assistantText = text;
      }
    }
    if (isThinking(event)) {
      const thinking = extractThinking(event);
      if (thinking) {
        const isPartial = typeof event.timestamp_ms === "number";
        if (isPartial) {
          sawThinkingPartials = true;
          reasoningText += tracker.nextThinking(thinking);
        } else if (!sawThinkingPartials) {
          reasoningText = thinking;
        }
      }
    }
    if (isResult(event)) {
      usage = extractOpenAiUsageFromResult(event) ?? usage;
    }
  }
  return { assistantText, reasoningText, usage };
}
function formatToolUpdateEvent(update) {
  return `event: tool_update
data: ${JSON.stringify(update)}

`;
}
function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function createBoundaryRuntimeContext(scope) {
  let activeBoundary = PROVIDER_BOUNDARY;
  let fallbackActive = false;
  const canAutoFallback = ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK && PROVIDER_BOUNDARY.mode === "v1";
  const activateLegacyFallback = (operation, error) => {
    if (!canAutoFallback || activeBoundary.mode === "legacy") {
      return false;
    }
    activeBoundary = LEGACY_PROVIDER_BOUNDARY;
    const details = {
      scope,
      operation,
      error: toErrorMessage(error)
    };
    if (!fallbackActive) {
      log23.warn("Provider boundary v1 failed; switching to legacy for this request", details);
    } else {
      log23.debug("Provider boundary fallback already active", details);
    }
    fallbackActive = true;
    return true;
  };
  return {
    getBoundary() {
      return activeBoundary;
    },
    run(operation, fn) {
      try {
        return fn(activeBoundary);
      } catch (error) {
        if (!activateLegacyFallback(operation, error)) {
          throw error;
        }
        return fn(activeBoundary);
      }
    },
    async runAsync(operation, fn) {
      try {
        return await fn(activeBoundary);
      } catch (error) {
        if (!activateLegacyFallback(operation, error)) {
          throw error;
        }
        return fn(activeBoundary);
      }
    },
    activateLegacyFallback(operation, error) {
      activateLegacyFallback(operation, error);
    },
    isFallbackActive() {
      return fallbackActive;
    }
  };
}
async function findFirstAllowedToolCallInOutput(output, options) {
  if (options.allowedToolNames.size === 0 || !output) {
    return { toolCall: null, terminationMessage: null };
  }
  const toolMapper = new ToolMapper;
  const toolSessionId = options.responseMeta.id;
  for (const line of output.split(`
`)) {
    const event = parseStreamJsonLine(line);
    if (!event || event.type !== "tool_call") {
      continue;
    }
    let interceptedToolCall = null;
    const result = await handleToolLoopEventWithFallback({
      event,
      boundary: options.boundaryContext.getBoundary(),
      boundaryMode: options.boundaryContext.getBoundary().mode,
      autoFallbackToLegacy: ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK,
      toolLoopMode: options.toolLoopMode,
      allowedToolNames: options.allowedToolNames,
      toolSchemaMap: options.toolSchemaMap,
      toolLoopGuard: options.toolLoopGuard,
      toolMapper,
      toolSessionId,
      shouldEmitToolUpdates: false,
      proxyExecuteToolCalls: false,
      suppressConverterToolEvents: false,
      responseMeta: options.responseMeta,
      onToolUpdate: () => {},
      onToolResult: () => {},
      onInterceptedToolCall: (toolCall) => {
        interceptedToolCall = toolCall;
      },
      onFallbackToLegacy: (error) => {
        options.boundaryContext.activateLegacyFallback("findFirstAllowedToolCallInOutput", error);
      }
    });
    if (result.terminate) {
      return {
        toolCall: null,
        terminationMessage: result.terminate.silent ? null : result.terminate.message
      };
    }
    if (result.intercepted && interceptedToolCall) {
      return {
        toolCall: interceptedToolCall,
        terminationMessage: null
      };
    }
  }
  return { toolCall: null, terminationMessage: null };
}
async function ensureCursorProxyServer(workspaceDirectory, toolRouter) {
  const key = getGlobalKey();
  const g = globalThis;
  const normalizedWorkspace = normalizeWorkspaceForCompare(workspaceDirectory);
  const state = g[key] ?? { baseURL: "", baseURLByWorkspace: {} };
  state.baseURLByWorkspace = state.baseURLByWorkspace ?? {};
  g[key] = state;
  const existingBaseURL = state.baseURLByWorkspace[normalizedWorkspace] ?? state.baseURL;
  if (typeof existingBaseURL === "string" && existingBaseURL.length > 0) {
    // Re-validate cached proxy 窶・a hung/zombie listener must not be reused
    // (Windows ghost sockets accept TCP but never answer /health).
    try {
      const healthUrl = existingBaseURL.replace(/\/v1\/?$/, "/health");
      const res = await fetchProxyHealthWithTimeout(healthUrl);
      if (res && res.ok) {
        const payload = await res.json().catch(() => null);
        if (isReusableProxyHealthPayload(payload, workspaceDirectory)) {
          return existingBaseURL;
        }
      }
    } catch {}
    log23.warn("Cached cursor-acp proxy unhealthy; starting a new listener", {
      existingBaseURL
    });
    delete state.baseURLByWorkspace[normalizedWorkspace];
    if (state.baseURL === existingBaseURL) state.baseURL = "";
  }
  state.baseURL = "";
  const resolveRequestSdkApiKey = (authHeader) => resolveSdkApiKey({
    env: process.env,
    storedApiKey,
    authorizationHeader: authHeader
  });
  const handler = async (req) => {
    try {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ ok: true, workspaceDirectory }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.pathname === "/v1/models" || url.pathname === "/models") {
        try {
          const { ModelDiscoveryService: ModelDiscoveryService2 } = await Promise.resolve().then(() => (init_discovery2(), exports_discovery));
          const discovery = new ModelDiscoveryService2;
          const modelList = await discovery.discover(resolveRequestSdkApiKey());
          const models = modelList.map((m) => ({
            id: typeof m === "string" ? m : m.id,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "cursor"
          }));
          return new Response(JSON.stringify({ object: "list", data: models }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        } catch (err) {
          log23.error("Failed to list models", { error: String(err) });
          return new Response(JSON.stringify({ error: "Failed to fetch models" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
      if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/chat/completions") {
        return new Response(JSON.stringify({ error: `Unsupported path: ${url.pathname}` }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
      log23.debug("Proxy request (bun)", { method: req.method, path: url.pathname });
      const reqPerf = new RequestPerf(`bun-${Date.now()}`);
      const body = await req.json().catch(() => ({}));
      reqPerf.mark("body-read");
      reqPerf.mark("body-parsed");
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const stream = body?.stream === true;
      const tools = Array.isArray(body?.tools) ? body.tools : [];
      log23.debug("raw request body", {
        model: body?.model,
        cursorModel: body?.cursorModel,
        stream,
        toolCount: tools.length,
        toolNames: tools.map((t) => t?.function?.name ?? t?.name ?? "unknown"),
        messageCount: messages.length,
        messageRoles: messages.map((m) => m?.role),
        hasMessagesWithToolCalls: messages.some((m) => Array.isArray(m?.tool_calls) && m.tool_calls.length > 0),
        hasToolResultMessages: messages.some((m) => m?.role === "tool")
      });
      const allowedToolNames = extractAllowedToolNames(tools);
      const bridgeJsonEnabled = isBridgeJsonEnabled();
      const toolSchemaMap = buildToolSchemaMap(tools);
      const toolLoopGuard = createToolLoopGuard(messages, TOOL_LOOP_MAX_REPEAT);
      const boundaryContext = createBoundaryRuntimeContext("bun-handler");
      const subagentNames = readSubagentNames();
      const model = boundaryContext.run("resolveRuntimeModel", (boundary) => boundary.resolveRuntimeModel(body?.model, body?.cursorModel));
      const authHeader = req.headers.get("authorization");
      const sdkApiKey = resolveRequestSdkApiKey(authHeader);
      const backend = resolveBackendForRequest(sdkApiKey);
      reqPerf.mark("backend-resolved");
      const resolvedPrompt = resolvePromptForBackend({
        backend,
        messages,
        tools,
        subagentNames,
        model,
        workspaceDirectory
      });
      const prompt = applyBridgeJsonPrompt(resolvedPrompt.prompt, { allowedToolNames });
      const {
        resumeChatId,
        sessionKey: sessionResumeKey,
        usedIncremental,
        contentPrefix: sessionResumeContentPrefix,
        recordContentPrefix: sessionResumeRecordContentPrefix,
        toolFingerprint: sessionResumeToolFingerprint,
        subagentFingerprint: sessionResumeSubagentFingerprint
      } = resolvedPrompt;
      reqPerf.mark("prompt-built");
      const sessionResumeKeyHash = sessionResumeKey ? sanitizeSessionKey(sessionResumeKey) : undefined;
      const resumeChatIdHash = resumeChatId ? sanitizeSessionKey(resumeChatId) : undefined;
      const msgSummaryBun = messages.map((m, i) => {
        const role = m?.role ?? "?";
        const hasTc = Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0;
        const clen = typeof m?.content === "string" ? m.content.length : Array.isArray(m?.content) ? `arr${m.content.length}` : typeof m?.content;
        return `${i}:${role}${hasTc ? `(tc:${hasTc})` : ""}(clen:${clen})`;
      });
      log23.debug("Proxy chat request (bun)", {
        stream,
        model,
        messages: messages.length,
        tools: tools.length,
        promptChars: prompt.length,
        msgRoles: msgSummaryBun.join(","),
        sessionResume: resumeChatId ? { chatIdHash: resumeChatIdHash, incremental: usedIncremental } : undefined
      });
      if (backend === "sdk" && !sdkApiKey) {
        return new Response(JSON.stringify({ error: "Cursor SDK backend requires a real Cursor API key. Set CURSOR_API_KEY or run `opencode auth login`; the legacy `cursor-agent` placeholder is not valid SDK auth." }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      reqPerf.mark("child-create-start");
      const child = createBunChildForBackend({
        backend,
        sdkApiKey,
        model,
        prompt,
        workspaceDirectory,
        resumeChatId
      });
      reqPerf.mark("child-created");
      if (!stream) {
        const [stdoutText, stderrText] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text()
        ]);
        const stdout = (stdoutText || "").trim();
        const stderr = (stderrText || "").trim();
        const exitCode = await child.exited;
        log23.debug("cursor-agent completed (bun non-stream)", {
          exitCode,
          stdoutChars: stdout.length,
          stderrChars: stderr.length
        });
        captureResumeChatIdFromOutput(stdout, sessionResumeKey, model, workspaceDirectory, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint);
        warnIfResumeNotCaptured(sessionResumeKey, sessionResumeKeyHash, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint, model);
        const meta = {
          id: `cursor-acp-${Date.now()}`,
          created: Math.floor(Date.now() / 1000),
          model
        };
        const intercepted = await findFirstAllowedToolCallInOutput(stdout, {
          toolLoopMode: TOOL_LOOP_MODE,
          allowedToolNames,
          toolSchemaMap,
          toolLoopGuard,
          boundaryContext,
          responseMeta: meta
        });
        if (intercepted.terminationMessage) {
          const payload2 = createChatCompletionResponse(model, intercepted.terminationMessage);
          return new Response(JSON.stringify(payload2), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (intercepted.toolCall) {
          const toolCall = intercepted.toolCall;
          log23.debug("Intercepted OpenCode tool call (non-stream)", {
            name: toolCall.function.name,
            callId: toolCall.id
          });
          const payload2 = boundaryContext.run("createNonStreamToolCallResponse", (boundary) => boundary.createNonStreamToolCallResponse(meta, toolCall));
          return new Response(JSON.stringify(payload2), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        const completion = extractCompletionFromStream(stdout);
        const bridgeToolCall = bridgeJsonEnabled ? extractBridgeToolCallFromStreamOutput(stdout, allowedToolNames, toolSchemaMap.get("write")) : null;
        if (bridgeToolCall) {
          const toolCall = bridgeToolCall;
          log23.debug("Intercepted bridge JSON tool call (non-stream)", {
            name: toolCall.function.name,
            callId: toolCall.id
          });
          const payload2 = boundaryContext.run("createNonStreamBridgeToolCallResponse", (boundary) => boundary.createNonStreamToolCallResponse(meta, toolCall));
          return new Response(JSON.stringify(payload2), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (exitCode !== 0) {
          const errSource = stderr || stdout || `cursor-agent exited with code ${String(exitCode ?? "unknown")} and no output`;
          maybeEvictResumeChatId(errSource, resumeChatId, sessionResumeKey, {
            code: exitCode,
            failureTextHash: hashForLog(errSource)
          });
          const parsed = parseAgentError(errSource);
          const userError = formatErrorForUser(parsed);
          log23.error("cursor-cli failed", {
            type: parsed.type,
            failureTextHash: hashForLog(parsed.message),
            code: exitCode
          });
          const errorPayload = createChatCompletionResponse(model, userError);
          return new Response(JSON.stringify(errorPayload), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        const payload = createChatCompletionResponse(model, completion.assistantText || stdout || stderr, completion.reasoningText || undefined, completion.usage);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      const encoder = new TextEncoder;
      const id = `cursor-acp-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const perf = reqPerf;
      const toolMapper = new ToolMapper;
      const toolSessionId = id;
      const passThroughTracker = new PassThroughTracker;
      perf.mark("child-dispatched");
      const sse = new ReadableStream({
        async start(controller) {
          let streamTerminated = false;
          let firstTokenReceived = false;
          let firstStdoutByteReceived = false;
          let firstSseWritten = false;
          let sawSuccessfulStreamOutput = false;
          let usage;
          const enqueueSse = (payload) => {
            if (!firstSseWritten) {
              perf.mark("first-sse-write");
              firstSseWritten = true;
            }
            controller.enqueue(encoder.encode(payload));
          };
          try {
            const reader = child.stdout.getReader();
            const converter = new StreamToSseConverter(model, { id, created });
            const lineBuffer = new LineBuffer;
            const emitToolCallAndTerminate = (toolCall) => {
              log23.debug("Intercepted OpenCode tool call (stream)", {
                name: toolCall.function.name,
                callId: toolCall.id
              });
              const streamChunks = boundaryContext.run("createStreamToolCallChunks", (boundary) => boundary.createStreamToolCallChunks({ id, created, model }, toolCall));
              for (const chunk of streamChunks) {
                enqueueSse(`data: ${JSON.stringify(chunk)}

`);
              }
              enqueueSse(formatSseDone());
              streamTerminated = true;
              try {
                child.kill();
              } catch {}
            };
            const emitTerminalAssistantErrorAndTerminate = (message) => {
              if (streamTerminated) {
                return;
              }
              const errChunk = createChatCompletionChunk(id, created, model, message, true);
              enqueueSse(`data: ${JSON.stringify(errChunk)}

`);
              enqueueSse(formatSseDone());
              streamTerminated = true;
              try {
                child.kill();
              } catch {}
            };
            while (true) {
              if (streamTerminated)
                break;
              const { value, done } = await reader.read();
              if (done)
                break;
              if (!value || value.length === 0)
                continue;
              if (!firstStdoutByteReceived) {
                perf.mark("first-stdout-byte");
                firstStdoutByteReceived = true;
              }
              if (!firstTokenReceived) {
                perf.mark("first-token");
                firstTokenReceived = true;
              }
              for (const line of lineBuffer.push(value)) {
                if (streamTerminated)
                  break;
                const event = parseStreamJsonLine(line);
                if (!event) {
                  continue;
                }
                captureResumeChatIdFromEvent(event, sessionResumeKey, model, workspaceDirectory, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint);
                if (isResult(event)) {
                  usage = extractOpenAiUsageFromResult(event) ?? usage;
                  if (isSuccessfulResultEvent(event)) {
                    sawSuccessfulStreamOutput = true;
                  }
                }
                if (bridgeJsonEnabled && isAssistantText(event)) {
                  const bridgeToolCall = extractBridgeToolCallFromText(extractText(event), allowedToolNames, toolSchemaMap.get("write"));
                  if (bridgeToolCall) {
                    emitToolCallAndTerminate(bridgeToolCall);
                    break;
                  }
                }
                if (event.type === "tool_call") {
                  perf.mark("tool-call");
                  const result = await handleToolLoopEventWithFallback({
                    event,
                    boundary: boundaryContext.getBoundary(),
                    boundaryMode: boundaryContext.getBoundary().mode,
                    autoFallbackToLegacy: ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK,
                    toolLoopMode: TOOL_LOOP_MODE,
                    allowedToolNames,
                    toolSchemaMap,
                    toolLoopGuard,
                    toolMapper,
                    toolSessionId,
                    shouldEmitToolUpdates: SHOULD_EMIT_TOOL_UPDATES,
                    proxyExecuteToolCalls: PROXY_EXECUTE_TOOL_CALLS,
                    suppressConverterToolEvents: SUPPRESS_CONVERTER_TOOL_EVENTS,
                    toolRouter,
                    responseMeta: { id, created, model },
                    passThroughTracker,
                    onToolUpdate: (update) => {
                      enqueueSse(formatToolUpdateEvent(update));
                    },
                    onToolResult: (toolResult) => {
                      enqueueSse(`data: ${JSON.stringify(toolResult)}

`);
                    },
                    onInterceptedToolCall: (toolCall) => {
                      emitToolCallAndTerminate(toolCall);
                    },
                    onFallbackToLegacy: (error) => {
                      boundaryContext.activateLegacyFallback("handleToolLoopEvent", error);
                    }
                  });
                  if (result.terminate) {
                    if (!result.terminate.silent) {
                      emitTerminalAssistantErrorAndTerminate(result.terminate.message);
                    } else {
                      enqueueSse(formatSseDone());
                      streamTerminated = true;
                      try {
                        child.kill();
                      } catch {}
                    }
                    break;
                  }
                  if (result.intercepted) {
                    break;
                  }
                  if (result.skipConverter) {
                    continue;
                  }
                }
                const sseChunks = converter.handleEvent(event);
                if (sseChunks.length > 0 && (isAssistantText(event) || isThinking(event))) {
                  sawSuccessfulStreamOutput = true;
                }
                for (const sse2 of sseChunks) {
                  enqueueSse(sse2);
                }
              }
            }
            if (streamTerminated) {
              return;
            }
            for (const line of lineBuffer.flush()) {
              if (streamTerminated)
                break;
              const event = parseStreamJsonLine(line);
              if (!event) {
                continue;
              }
              captureResumeChatIdFromEvent(event, sessionResumeKey, model, workspaceDirectory, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint);
              if (isResult(event)) {
                usage = extractOpenAiUsageFromResult(event) ?? usage;
                if (isSuccessfulResultEvent(event)) {
                  sawSuccessfulStreamOutput = true;
                }
              }
              if (bridgeJsonEnabled && isAssistantText(event)) {
                const bridgeToolCall = extractBridgeToolCallFromText(extractText(event), allowedToolNames, toolSchemaMap.get("write"));
                if (bridgeToolCall) {
                  emitToolCallAndTerminate(bridgeToolCall);
                  break;
                }
              }
              if (event.type === "tool_call") {
                const result = await handleToolLoopEventWithFallback({
                  event,
                  boundary: boundaryContext.getBoundary(),
                  boundaryMode: boundaryContext.getBoundary().mode,
                  autoFallbackToLegacy: ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK,
                  toolLoopMode: TOOL_LOOP_MODE,
                  allowedToolNames,
                  toolSchemaMap,
                  toolLoopGuard,
                  toolMapper,
                  toolSessionId,
                  shouldEmitToolUpdates: SHOULD_EMIT_TOOL_UPDATES,
                  proxyExecuteToolCalls: PROXY_EXECUTE_TOOL_CALLS,
                  suppressConverterToolEvents: SUPPRESS_CONVERTER_TOOL_EVENTS,
                  toolRouter,
                  responseMeta: { id, created, model },
                  passThroughTracker,
                  onToolUpdate: (update) => {
                    enqueueSse(formatToolUpdateEvent(update));
                  },
                  onToolResult: (toolResult) => {
                    enqueueSse(`data: ${JSON.stringify(toolResult)}

`);
                  },
                  onInterceptedToolCall: (toolCall) => {
                    emitToolCallAndTerminate(toolCall);
                  },
                  onFallbackToLegacy: (error) => {
                    boundaryContext.activateLegacyFallback("handleToolLoopEvent.flush", error);
                  }
                });
                if (result.terminate) {
                  if (!result.terminate.silent) {
                    emitTerminalAssistantErrorAndTerminate(result.terminate.message);
                  } else {
                    enqueueSse(formatSseDone());
                    streamTerminated = true;
                    try {
                      child.kill();
                    } catch {}
                  }
                  break;
                }
                if (result.intercepted) {
                  break;
                }
                if (result.skipConverter) {
                  continue;
                }
              }
              const sseChunks = converter.handleEvent(event);
              if (sseChunks.length > 0 && (isAssistantText(event) || isThinking(event))) {
                sawSuccessfulStreamOutput = true;
              }
              for (const sse2 of sseChunks) {
                enqueueSse(sse2);
              }
            }
            if (streamTerminated) {
              return;
            }
            const exitCode = await child.exited;
            if (exitCode !== 0) {
              const stderrText = await new Response(child.stderr).text();
              const errSource = (stderrText || "").trim() || `cursor-agent exited with code ${String(exitCode ?? "unknown")} and no output`;
              if (shouldTreatCursorAgentFailureAsDiagnostic(errSource, sawSuccessfulStreamOutput)) {
                log23.warn("cursor-agent exited non-zero after successful streamed output; treating quota text as diagnostic", {
                  code: exitCode,
                  failureTextHash: hashForLog(errSource)
                });
              } else {
                maybeEvictResumeChatId(errSource, resumeChatId, sessionResumeKey, {
                  code: exitCode,
                  failureTextHash: hashForLog(errSource)
                });
                const parsed = parseAgentError(errSource);
                const msg = formatErrorForUser(parsed);
                log23.error("cursor-cli streaming failed", {
                  type: parsed.type,
                  code: exitCode,
                  failureTextHash: hashForLog(parsed.message)
                });
                const errChunk = createChatCompletionChunk(id, created, model, msg, true);
                enqueueSse(`data: ${JSON.stringify(errChunk)}

`);
                enqueueSse(formatSseDone());
                return;
              }
            }
            log23.debug("cursor-agent completed (bun stream)", {
              exitCode
            });
            warnIfResumeNotCaptured(sessionResumeKey, sessionResumeKeyHash, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint, model);
            const passThroughSummary = passThroughTracker.getSummary();
            if (passThroughSummary.hasActivity) {
              await toastService.showPassThroughSummary(passThroughSummary.tools);
            }
            if (passThroughSummary.errors.length > 0) {
              await toastService.showErrorSummary(passThroughSummary.errors);
            }
            const doneChunk = createChatCompletionChunk(id, created, model, "", true);
            enqueueSse(`data: ${JSON.stringify(doneChunk)}

`);
            if (usage) {
              const usageChunk = createChatCompletionUsageChunk(id, created, model, usage);
              enqueueSse(`data: ${JSON.stringify(usageChunk)}

`);
            }
            enqueueSse(formatSseDone());
          } finally {
            perf.mark("request:done");
            perf.summarize();
            controller.close();
          }
        }
      });
      return new Response(sse, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  };
  if (REUSE_EXISTING_PROXY) {
    try {
      const res = await fetchProxyHealthWithTimeout(`http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/health`);
      if (res && res.ok) {
        const payload = await res.json().catch(() => null);
        if (isReusableProxyHealthPayload(payload, workspaceDirectory)) {
          state.baseURL = CURSOR_PROXY_DEFAULT_BASE_URL;
          state.baseURLByWorkspace[normalizedWorkspace] = CURSOR_PROXY_DEFAULT_BASE_URL;
          return CURSOR_PROXY_DEFAULT_BASE_URL;
        }
      }
    } catch {}
  }
  const http = await import("http");
  const requestHandler = async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, workspaceDirectory }));
        return;
      }
      if (url.pathname === "/v1/models" || url.pathname === "/models") {
        try {
          const { ModelDiscoveryService: ModelDiscoveryService2 } = await Promise.resolve().then(() => (init_discovery2(), exports_discovery));
          const discovery = new ModelDiscoveryService2;
          const modelList = await discovery.discover(resolveRequestSdkApiKey());
          const models = modelList.map((m) => ({
            id: typeof m === "string" ? m : m.id,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "cursor"
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ object: "list", data: models }));
        } catch (err) {
          log23.error("Failed to list models", { error: String(err) });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to fetch models" }));
        }
        return;
      }
      if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/chat/completions") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unsupported path: ${url.pathname}` }));
        return;
      }
      log23.debug("Proxy request (node)", { method: req.method, path: url.pathname });
      const reqPerf = new RequestPerf(`node-${Date.now()}`);
      const bodyChunks = [];
      for await (const chunk of req) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      reqPerf.mark("body-read");
      const body = Buffer.concat(bodyChunks).toString("utf8");
      const bodyData = JSON.parse(body || "{}");
      reqPerf.mark("body-parsed");
      const messages = Array.isArray(bodyData?.messages) ? bodyData.messages : [];
      const stream = bodyData?.stream === true;
      const tools = Array.isArray(bodyData?.tools) ? bodyData.tools : [];
      const allowedToolNames = extractAllowedToolNames(tools);
      const bridgeJsonEnabled = isBridgeJsonEnabled();
      const toolSchemaMap = buildToolSchemaMap(tools);
      const toolLoopGuard = createToolLoopGuard(messages, TOOL_LOOP_MAX_REPEAT);
      const boundaryContext = createBoundaryRuntimeContext("node-handler");
      const subagentNames = readSubagentNames();
      const model = boundaryContext.run("resolveRuntimeModel", (boundary) => boundary.resolveRuntimeModel(bodyData?.model, bodyData?.cursorModel));
      const authHeaderNode = req.headers["authorization"];
      const sdkApiKeyNode = resolveRequestSdkApiKey(authHeaderNode);
      const backend = resolveBackendForRequest(sdkApiKeyNode);
      reqPerf.mark("backend-resolved");
      const resolvedPrompt = resolvePromptForBackend({
        backend,
        messages,
        tools,
        subagentNames,
        model,
        workspaceDirectory
      });
      const prompt = applyBridgeJsonPrompt(resolvedPrompt.prompt, { allowedToolNames });
      const {
        resumeChatId,
        sessionKey: sessionResumeKey,
        usedIncremental,
        contentPrefix: sessionResumeContentPrefix,
        recordContentPrefix: sessionResumeRecordContentPrefix,
        toolFingerprint: sessionResumeToolFingerprint,
        subagentFingerprint: sessionResumeSubagentFingerprint
      } = resolvedPrompt;
      reqPerf.mark("prompt-built");
      const sessionResumeKeyHashNode = sessionResumeKey ? sanitizeSessionKey(sessionResumeKey) : undefined;
      const resumeChatIdHashNode = resumeChatId ? sanitizeSessionKey(resumeChatId) : undefined;
      const msgSummary = messages.map((m, i) => {
        const role = m?.role ?? "?";
        const hasTc = Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0;
        const tcId = m?.tool_call_id ? "yes" : "no";
        const tcName = m?.name ?? "";
        const contentLen = typeof m?.content === "string" ? m.content.length : Array.isArray(m?.content) ? `arr${m.content.length}` : typeof m?.content;
        return `${i}:${role}${hasTc ? `(tc:${hasTc})` : ""}${role === "tool" ? `(tcid:${tcId},name:${tcName},clen:${contentLen})` : `(clen:${contentLen})`}`;
      });
      log23.debug("Proxy chat request (node)", {
        stream,
        model,
        messages: messages.length,
        tools: tools.length,
        promptChars: prompt.length,
        msgRoles: msgSummary.join(","),
        sessionResume: resumeChatId ? { chatIdHash: resumeChatIdHashNode, incremental: usedIncremental } : undefined
      });
      if (backend === "sdk" && !sdkApiKeyNode) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cursor SDK backend requires a real Cursor API key. Set CURSOR_API_KEY or run `opencode auth login`; the legacy `cursor-agent` placeholder is not valid SDK auth." }));
        return;
      }
      reqPerf.mark("child-create-start");
      const child = createNodeChildForBackend({
        backend,
        sdkApiKey: sdkApiKeyNode,
        model,
        prompt,
        workspaceDirectory,
        resumeChatId
      });
      reqPerf.mark("child-created");
      if (!stream) {
        const stdoutChunks = [];
        const stderrChunks = [];
        let spawnErrorText = null;
        child.on("error", (error) => {
          spawnErrorText = String(error?.message || error);
          log23.error("Failed to spawn cursor-agent", { errorHash: hashForLog(spawnErrorText), model });
        });
        child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
        child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
        child.on("close", async (code) => {
          const stdout = Buffer.concat(stdoutChunks).toString().trim();
          const stderr = Buffer.concat(stderrChunks).toString().trim();
          log23.debug("cursor-agent completed (node non-stream)", {
            code,
            stdoutChars: stdout.length,
            stderrChars: stderr.length,
            spawnError: spawnErrorText != null
          });
          captureResumeChatIdFromOutput(stdout, sessionResumeKey, model, workspaceDirectory, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint);
          warnIfResumeNotCaptured(sessionResumeKey, sessionResumeKeyHashNode, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint, model);
          const meta = {
            id: `cursor-acp-${Date.now()}`,
            created: Math.floor(Date.now() / 1000),
            model
          };
          const intercepted = await findFirstAllowedToolCallInOutput(stdout, {
            toolLoopMode: TOOL_LOOP_MODE,
            allowedToolNames,
            toolSchemaMap,
            toolLoopGuard,
            boundaryContext,
            responseMeta: meta
          });
          if (intercepted.terminationMessage) {
            const terminationResponse = createChatCompletionResponse(model, intercepted.terminationMessage);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(terminationResponse));
            return;
          }
          if (intercepted.toolCall) {
            const toolCall = intercepted.toolCall;
            log23.debug("Intercepted OpenCode tool call (non-stream)", {
              name: toolCall.function.name,
              callId: toolCall.id
            });
            const payload = boundaryContext.run("createNonStreamToolCallResponse", (boundary) => boundary.createNonStreamToolCallResponse(meta, toolCall));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
            return;
          }
          const completion = extractCompletionFromStream(stdout);
          const bridgeToolCall = bridgeJsonEnabled ? extractBridgeToolCallFromStreamOutput(stdout, allowedToolNames, toolSchemaMap.get("write")) : null;
          if (bridgeToolCall) {
            const toolCall = bridgeToolCall;
            log23.debug("Intercepted bridge JSON tool call (non-stream)", {
              name: toolCall.function.name,
              callId: toolCall.id
            });
            const payload = boundaryContext.run("createNonStreamBridgeToolCallResponse", (boundary) => boundary.createNonStreamToolCallResponse(meta, toolCall));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
            return;
          }
          if (code !== 0 || spawnErrorText) {
            const errSource = stderr || stdout || spawnErrorText || `cursor-agent exited with code ${String(code ?? "unknown")} and no output`;
            maybeEvictResumeChatId(errSource, resumeChatId, sessionResumeKey, {
              code,
              spawnError: spawnErrorText != null,
              failureTextHash: hashForLog(errSource)
            });
            const parsed = parseAgentError(errSource);
            const userError = formatErrorForUser(parsed);
            log23.error("cursor-cli failed", {
              type: parsed.type,
              failureTextHash: hashForLog(parsed.message),
              code
            });
            const errorResponse = createChatCompletionResponse(model, userError);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(errorResponse));
            return;
          }
          const response = createChatCompletionResponse(model, completion.assistantText || stdout || stderr, completion.reasoningText || undefined, completion.usage);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        });
      } else {
        if (res.socket)
          res.socket.setNoDelay(true);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        res.flushHeaders();
        const id = `cursor-acp-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);
        const perf = reqPerf;
        perf.mark("child-dispatched");
        const converter = new StreamToSseConverter(model, { id, created });
        const lineBuffer = new LineBuffer;
        const toolMapper = new ToolMapper;
        const toolSessionId = id;
        const passThroughTracker = new PassThroughTracker;
        const stderrChunks = [];
        let streamTerminated = false;
        let firstTokenReceived = false;
        let firstStdoutByteReceived = false;
        let firstSseWritten = false;
        let sawSuccessfulStreamOutput = false;
        let usage;
        const writeSse = (payload) => {
          if (!firstSseWritten) {
            perf.mark("first-sse-write");
            firstSseWritten = true;
          }
          res.write(payload);
        };
        child.stderr.on("data", (chunk) => {
          stderrChunks.push(Buffer.from(chunk));
        });
        child.on("error", (error) => {
          if (streamTerminated || res.writableEnded) {
            return;
          }
          const errSource = String(error?.message || error);
          log23.error("Failed to spawn cursor-agent (stream)", { errorHash: hashForLog(errSource), model });
          const parsed = parseAgentError(errSource);
          const msg = formatErrorForUser(parsed);
          const errChunk = createChatCompletionChunk(id, created, model, msg, true);
          writeSse(`data: ${JSON.stringify(errChunk)}

`);
          writeSse(formatSseDone());
          streamTerminated = true;
          res.end();
        });
        const emitToolCallAndTerminate = (toolCall) => {
          if (streamTerminated || res.writableEnded) {
            return;
          }
          log23.debug("Intercepted OpenCode tool call (stream)", {
            name: toolCall.function.name,
            callId: toolCall.id
          });
          const streamChunks = boundaryContext.run("createStreamToolCallChunks", (boundary) => boundary.createStreamToolCallChunks({ id, created, model }, toolCall));
          for (const chunk of streamChunks) {
            writeSse(`data: ${JSON.stringify(chunk)}

`);
          }
          writeSse(formatSseDone());
          streamTerminated = true;
          res.end();
          try {
            child.kill();
          } catch {}
        };
        const emitTerminalAssistantErrorAndTerminate = (message) => {
          if (streamTerminated || res.writableEnded) {
            return;
          }
          const errChunk = createChatCompletionChunk(id, created, model, message, true);
          writeSse(`data: ${JSON.stringify(errChunk)}

`);
          writeSse(formatSseDone());
          streamTerminated = true;
          res.end();
          try {
            child.kill();
          } catch {}
        };
        const chunkQueue = [];
        let draining = false;
        let childClosed = false;
        let childCloseHandled = false;
        let childExitCode = null;
        const processLines = async (lines) => {
          for (const line of lines) {
            if (streamTerminated || res.writableEnded)
              break;
            const event = parseStreamJsonLine(line);
            if (!event)
              continue;
            captureResumeChatIdFromEvent(event, sessionResumeKey, model, workspaceDirectory, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint);
            if (isResult(event)) {
              usage = extractOpenAiUsageFromResult(event) ?? usage;
              if (isSuccessfulResultEvent(event)) {
                sawSuccessfulStreamOutput = true;
              }
            }
            if (bridgeJsonEnabled && isAssistantText(event)) {
              const bridgeToolCall = extractBridgeToolCallFromText(extractText(event), allowedToolNames, toolSchemaMap.get("write"));
              if (bridgeToolCall) {
                emitToolCallAndTerminate(bridgeToolCall);
                break;
              }
            }
            if (event.type === "tool_call") {
              perf.mark("tool-call");
              const result = await handleToolLoopEventWithFallback({
                event,
                boundary: boundaryContext.getBoundary(),
                boundaryMode: boundaryContext.getBoundary().mode,
                autoFallbackToLegacy: ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK,
                toolLoopMode: TOOL_LOOP_MODE,
                allowedToolNames,
                toolSchemaMap,
                toolLoopGuard,
                toolMapper,
                toolSessionId,
                shouldEmitToolUpdates: SHOULD_EMIT_TOOL_UPDATES,
                proxyExecuteToolCalls: PROXY_EXECUTE_TOOL_CALLS,
                suppressConverterToolEvents: SUPPRESS_CONVERTER_TOOL_EVENTS,
                toolRouter,
                responseMeta: { id, created, model },
                passThroughTracker,
                onToolUpdate: (update) => {
                  writeSse(formatToolUpdateEvent(update));
                },
                onToolResult: (toolResult) => {
                  writeSse(`data: ${JSON.stringify(toolResult)}

`);
                },
                onInterceptedToolCall: (toolCall) => {
                  emitToolCallAndTerminate(toolCall);
                },
                onFallbackToLegacy: (error) => {
                  boundaryContext.activateLegacyFallback("handleToolLoopEvent", error);
                }
              });
              if (result.terminate) {
                if (!result.terminate.silent) {
                  emitTerminalAssistantErrorAndTerminate(result.terminate.message);
                } else {
                  streamTerminated = true;
                  try {
                    child.kill();
                  } catch {}
                }
                break;
              }
              if (result.intercepted)
                break;
              if (result.skipConverter)
                continue;
            }
            if (streamTerminated || res.writableEnded)
              break;
            const sseChunks = converter.handleEvent(event);
            if (sseChunks.length > 0 && (isAssistantText(event) || isThinking(event))) {
              sawSuccessfulStreamOutput = true;
            }
            for (const sse of sseChunks) {
              writeSse(sse);
            }
          }
        };
        const drainQueue = async () => {
          if (draining)
            return;
          draining = true;
          try {
            while (chunkQueue.length > 0) {
              if (streamTerminated || res.writableEnded)
                break;
              const chunk = chunkQueue.shift();
              if (!firstStdoutByteReceived) {
                perf.mark("first-stdout-byte");
                firstStdoutByteReceived = true;
              }
              if (!firstTokenReceived) {
                perf.mark("first-token");
                firstTokenReceived = true;
              }
              await processLines(lineBuffer.push(chunk));
            }
            if (childClosed && !childCloseHandled && !streamTerminated && !res.writableEnded) {
              childCloseHandled = true;
              await processLines(lineBuffer.flush());
              if (streamTerminated || res.writableEnded)
                return;
              perf.mark("request:done");
              perf.summarize();
              const stderrText = Buffer.concat(stderrChunks).toString().trim();
              log23.debug("cursor-agent completed (node stream)", {
                code: childExitCode,
                stderrChars: stderrText.length
              });
              if (childExitCode !== 0) {
                const errSource = stderrText || `cursor-agent exited with code ${String(childExitCode ?? "unknown")} and no output`;
                if (shouldTreatCursorAgentFailureAsDiagnostic(errSource, sawSuccessfulStreamOutput)) {
                  log23.warn("cursor-agent exited non-zero after successful streamed output; treating quota text as diagnostic", {
                    code: childExitCode,
                    failureTextHash: hashForLog(errSource)
                  });
                } else {
                  maybeEvictResumeChatId(errSource, resumeChatId, sessionResumeKey, {
                    code: childExitCode,
                    failureTextHash: hashForLog(errSource)
                  });
                  const parsed = parseAgentError(errSource);
                  const msg = formatErrorForUser(parsed);
                  const errChunk = createChatCompletionChunk(id, created, model, msg, true);
                  writeSse(`data: ${JSON.stringify(errChunk)}

`);
                  writeSse(formatSseDone());
                  streamTerminated = true;
                  res.end();
                  return;
                }
              }
              warnIfResumeNotCaptured(sessionResumeKey, sessionResumeKeyHashNode, sessionResumeRecordContentPrefix, sessionResumeToolFingerprint, sessionResumeSubagentFingerprint, model);
              const passThroughSummary = passThroughTracker.getSummary();
              if (passThroughSummary.hasActivity) {
                await toastService.showPassThroughSummary(passThroughSummary.tools);
              }
              if (passThroughSummary.errors.length > 0) {
                await toastService.showErrorSummary(passThroughSummary.errors);
              }
              const doneChunk = {
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
              };
              writeSse(`data: ${JSON.stringify(doneChunk)}

`);
              if (usage) {
                const usageChunk = createChatCompletionUsageChunk(id, created, model, usage);
                writeSse(`data: ${JSON.stringify(usageChunk)}

`);
              }
              writeSse(formatSseDone());
              streamTerminated = true;
              res.end();
            }
          } finally {
            draining = false;
            if (!streamTerminated && !res.writableEnded && (chunkQueue.length > 0 || childClosed && !childCloseHandled)) {
              drainQueue();
            }
          }
        };
        child.stdout.on("data", (chunk) => {
          chunkQueue.push(Buffer.from(chunk));
          drainQueue();
        });
        child.on("close", (code) => {
          childClosed = true;
          childExitCode = code;
          drainQueue();
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  };
  let server2 = http.createServer(requestHandler);
  try {
    await new Promise((resolve5, reject) => {
      server2.listen(CURSOR_PROXY_DEFAULT_PORT, CURSOR_PROXY_HOST, () => resolve5());
      server2.once("error", reject);
    });
    const baseURL = `http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/v1`;
    state.baseURL = baseURL;
    state.baseURLByWorkspace[normalizedWorkspace] = baseURL;
    return baseURL;
  } catch (error) {
    if (error?.code !== "EADDRINUSE") {
      throw error;
    }
    if (REUSE_EXISTING_PROXY) {
      try {
        const res = await fetchProxyHealthWithTimeout(`http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/health`);
        if (res && res.ok) {
          const payload = await res.json().catch(() => null);
          if (isReusableProxyHealthPayload(payload, workspaceDirectory)) {
            state.baseURL = CURSOR_PROXY_DEFAULT_BASE_URL;
            state.baseURLByWorkspace[normalizedWorkspace] = CURSOR_PROXY_DEFAULT_BASE_URL;
            return CURSOR_PROXY_DEFAULT_BASE_URL;
          }
        }
      } catch {}
    }
    // Prefer the known fallback port (32125) before an ephemeral bind when the
    // default port is a hung Windows ghost socket (TCP accept, no /health).
    const fallbackPort = CURSOR_PROXY_DEFAULT_PORT === 32124 ? 32125 : CURSOR_PROXY_DEFAULT_PORT + 1;
    try {
      server2 = http.createServer(requestHandler);
      await new Promise((resolve5, reject) => {
        server2.listen(fallbackPort, CURSOR_PROXY_HOST, () => resolve5());
        server2.once("error", reject);
      });
      const baseURL = `http://${CURSOR_PROXY_HOST}:${fallbackPort}/v1`;
      state.baseURL = baseURL;
      state.baseURLByWorkspace[normalizedWorkspace] = baseURL;
      log23.warn("Default cursor-acp proxy port busy/unhealthy; listening on fallback", {
        fallbackPort
      });
      return baseURL;
    } catch (fallbackError) {
      if (fallbackError?.code !== "EADDRINUSE") {
        throw fallbackError;
      }
    }
    server2 = http.createServer(requestHandler);
    await new Promise((resolve5, reject) => {
      server2.listen(0, CURSOR_PROXY_HOST, () => resolve5());
      server2.once("error", reject);
    });
    const addr = server2.address();
    const baseURL = `http://${CURSOR_PROXY_HOST}:${addr.port}/v1`;
    state.baseURL = baseURL;
    state.baseURLByWorkspace[normalizedWorkspace] = baseURL;
    return baseURL;
  }
}
function jsonSchemaToZod(jsonSchema) {
  const z2 = tool2.schema;
  const properties = jsonSchema.properties || {};
  const required = jsonSchema.required || [];
  const zodShape = {};
  for (const [key, prop] of Object.entries(properties)) {
    const p = prop;
    let zodType;
    switch (p.type) {
      case "string":
        zodType = z2.string();
        if (p.description) {
          zodType = zodType.describe(p.description);
        }
        break;
      case "number":
        zodType = z2.number();
        if (p.description) {
          zodType = zodType.describe(p.description);
        }
        break;
      case "boolean":
        zodType = z2.boolean();
        if (p.description) {
          zodType = zodType.describe(p.description);
        }
        break;
      case "object":
        zodType = z2.record(z2.string(), z2.any());
        if (p.description) {
          zodType = zodType.describe(p.description);
        }
        break;
      case "array":
        zodType = z2.array(z2.any());
        if (p.description) {
          zodType = zodType.describe(p.description);
        }
        break;
      default:
        zodType = z2.any();
        break;
    }
    if (!required.includes(key)) {
      zodType = zodType.optional();
    }
    zodShape[key] = zodType;
  }
  return zodShape;
}
function resolveToolContextBaseDirWithSession(context, fallbackBaseDir, sessionWorkspaceBySession) {
  const sessionID = typeof context?.sessionID === "string" && context.sessionID.trim().length > 0 ? context.sessionID.trim() : "";
  const worktree = resolveCandidate(typeof context?.worktree === "string" ? context.worktree : undefined);
  const directory = resolveCandidate(typeof context?.directory === "string" ? context.directory : undefined);
  const fallback = resolveCandidate(fallbackBaseDir);
  const pinned = sessionID && sessionWorkspaceBySession ? resolveCandidate(sessionWorkspaceBySession.get(sessionID)) : "";
  const pinSession = (candidate) => {
    if (sessionID && sessionWorkspaceBySession && isNonConfigPath(candidate)) {
      if (!sessionWorkspaceBySession.has(sessionID) && sessionWorkspaceBySession.size >= SESSION_WORKSPACE_CACHE_LIMIT) {
        const oldestSession = sessionWorkspaceBySession.keys().next().value;
        if (typeof oldestSession === "string") {
          sessionWorkspaceBySession.delete(oldestSession);
        }
      }
      sessionWorkspaceBySession.set(sessionID, candidate);
    }
  };
  if (isNonConfigPath(worktree)) {
    pinSession(worktree);
    return worktree;
  }
  if (isNonConfigPath(pinned)) {
    return pinned;
  }
  if (isNonConfigPath(directory)) {
    pinSession(directory);
    return directory;
  }
  if (isNonConfigPath(fallback)) {
    pinSession(fallback);
    return fallback;
  }
  return null;
}
function toAbsoluteWithBase(value, baseDir) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || isAbsolute(trimmed)) {
    return value;
  }
  return resolve4(baseDir, trimmed);
}
function applyToolContextDefaults(toolName, rawArgs, context, fallbackBaseDir, sessionWorkspaceBySession) {
  const baseDir = resolveToolContextBaseDirWithSession(context, fallbackBaseDir, sessionWorkspaceBySession);
  if (!baseDir) {
    return rawArgs;
  }
  const args = { ...rawArgs };
  for (const key of [
    "path",
    "filePath",
    "targetPath",
    "directory",
    "dir",
    "folder",
    "targetDirectory",
    "targetFile",
    "cwd",
    "workdir"
  ]) {
    args[key] = toAbsoluteWithBase(args[key], baseDir);
  }
  const baseName = toolName.startsWith("oc_") ? toolName.slice(3) : toolName;
  if ((baseName === "bash" || baseName === "shell") && args.cwd === undefined && args.workdir === undefined) {
    args.cwd = baseDir;
  }
  if ((baseName === "grep" || baseName === "glob" || baseName === "ls") && args.path === undefined) {
    args.path = baseDir;
  }
  return args;
}
function shouldRegisterNativeToolHook(toolName, mode) {
  return !(mode === "opencode" && OPENCODE_NATIVE_TOOL_HOOK_EXCLUSIONS.has(toolName));
}
function buildToolHookEntries(registry, fallbackBaseDir) {
  const entries = {};
  const sessionWorkspaceBySession = new Map;
  const tools = registry.list();
  for (const t of tools) {
    if (TOOL_HOOK_EXCLUSIONS.has(t.name))
      continue;
    const handler = registry.getHandler(t.name);
    if (!handler)
      continue;
    const zodArgs = jsonSchemaToZod(t.parameters);
    const createEntry = (toolName) => tool2({
      description: t.description,
      args: zodArgs,
      async execute(args, context) {
        try {
          const normalizedArgs = applyToolContextDefaults(toolName, args, context, fallbackBaseDir, sessionWorkspaceBySession);
          return await handler(normalizedArgs);
        } catch (error) {
          log23.debug("Tool hook execution failed", { tool: toolName, error: String(error?.message || error) });
          throw error;
        }
      }
    });
    if (shouldRegisterNativeToolHook(t.name, TOOL_LOOP_MODE)) {
      entries[t.name] = createEntry(t.name);
    }
    const ocAlias = `oc_${t.id}`;
    if (!entries[ocAlias]) {
      entries[ocAlias] = createEntry(ocAlias);
    }
    if (t.name === "bash" && !entries.shell) {
      entries.shell = createEntry("shell");
    }
  }
  return entries;
}
var log23, CURSOR_PROVIDER_ID2 = "cursor", CURSOR_PROVIDER_PREFIX, CURSOR_PROXY_HOST = "127.0.0.1", CURSOR_PROXY_DEFAULT_PORT = Number(process.env.CURSOR_ACP_PROXY_PORT) || 32124, CURSOR_PROXY_DEFAULT_BASE_URL, CURSOR_PROXY_HEALTH_TIMEOUT_MS = 3000, REUSE_EXISTING_PROXY, storedApiKey, cursorAgentAvailabilityCache, SESSION_WORKSPACE_CACHE_LIMIT = 200, FORCE_TOOL_MODE, EMIT_TOOL_UPDATES, FORWARD_TOOL_CALLS, TOOL_LOOP_MODE_RAW, TOOL_LOOP_MODE, TOOL_LOOP_MODE_VALID, PROVIDER_BOUNDARY_MODE_RAW, PROVIDER_BOUNDARY_MODE, PROVIDER_BOUNDARY_MODE_VALID, LEGACY_PROVIDER_BOUNDARY, PROVIDER_BOUNDARY, ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK, TOOL_LOOP_MAX_REPEAT_RAW, TOOL_LOOP_MAX_REPEAT, TOOL_LOOP_MAX_REPEAT_VALID, PROXY_EXECUTE_TOOL_CALLS, SUPPRESS_CONVERTER_TOOL_EVENTS, SHOULD_EMIT_TOOL_UPDATES, TOOL_HOOK_EXCLUSIONS, OPENCODE_NATIVE_TOOL_HOOK_EXCLUSIONS, CursorPlugin = async ({ $, directory, worktree, client: client3, serverUrl }) => {
  const workspaceDirectory = resolveWorkspaceDirectory(worktree, directory);
  log23.debug("Plugin initializing", {
    directory,
    worktree,
    workspaceDirectory,
    cwd: process.cwd(),
    serverUrl: serverUrl?.toString()
  });
  if (!TOOL_LOOP_MODE_VALID) {
    log23.warn("Invalid CURSOR_ACP_TOOL_LOOP_MODE; defaulting to opencode", { value: TOOL_LOOP_MODE_RAW });
  }
  if (!PROVIDER_BOUNDARY_MODE_VALID) {
    log23.warn("Invalid CURSOR_ACP_PROVIDER_BOUNDARY; defaulting to v1", {
      value: PROVIDER_BOUNDARY_MODE_RAW
    });
  }
  if (!TOOL_LOOP_MAX_REPEAT_VALID) {
    log23.warn("Invalid CURSOR_ACP_TOOL_LOOP_MAX_REPEAT; defaulting to 3", {
      value: TOOL_LOOP_MAX_REPEAT_RAW
    });
  }
  if (ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK && PROVIDER_BOUNDARY.mode !== "v1") {
    log23.debug("Provider boundary auto-fallback is enabled but inactive unless mode=v1");
  }
  log23.info("Tool loop mode configured", {
    mode: TOOL_LOOP_MODE,
    providerBoundary: PROVIDER_BOUNDARY.mode,
    proxyExecToolCalls: PROXY_EXECUTE_TOOL_CALLS,
    providerBoundaryAutoFallback: ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK,
    toolLoopMaxRepeat: TOOL_LOOP_MAX_REPEAT
  });
  await ensurePluginDirectory();
  autoRefreshModels().catch(() => {});
  const mcpManager = new McpClientManager;
  let mcpToolEntries = {};
  let mcpToolDefs = [];
  let mcpToolSummaries = [];
  const mcpEnabled = process.env.CURSOR_ACP_MCP_BRIDGE !== "false";
  if (mcpEnabled) {
    try {
      const configs = readMcpConfigs();
      if (configs.length === 0) {
        log23.debug("No MCP servers configured, skipping MCP bridge");
      } else {
        log23.debug("MCP bridge: connecting to servers", { count: configs.length });
        await Promise.allSettled(configs.map((c) => mcpManager.connectServer(c)));
        const tools = mcpManager.listTools();
        if (tools.length === 0) {
          log23.debug("MCP bridge: no tools discovered");
        } else {
          mcpToolEntries = buildMcpToolHookEntries(tools, mcpManager);
          mcpToolDefs = buildMcpToolDefinitions(tools);
          mcpToolSummaries = tools.map((t) => ({
            serverName: t.serverName,
            toolName: t.name,
            callName: namespaceMcpTool(t.serverName, t.name),
            description: t.description,
            params: t.inputSchema ? Object.keys(t.inputSchema.properties ?? {}) : undefined
          }));
          log23.info("MCP bridge: registered tools", {
            servers: mcpManager.connectedServers.length,
            tools: Object.keys(mcpToolEntries).length
          });
        }
      }
    } catch (err) {
      log23.debug("MCP bridge init failed", { error: String(err) });
    }
  }
  toastService.setClient(client3);
  const toolsEnabled = process.env.CURSOR_ACP_ENABLE_OPENCODE_TOOLS !== "false";
  const legacyProxyToolPathsEnabled = toolsEnabled && TOOL_LOOP_MODE === "proxy-exec";
  if (toolsEnabled && TOOL_LOOP_MODE === "opencode") {
    log23.debug("OpenCode mode active; skipping legacy SDK/MCP discovery and proxy-side tool execution");
  } else if (toolsEnabled && TOOL_LOOP_MODE === "off") {
    log23.debug("Tool loop mode off; proxy-side tool execution disabled");
  }
  const serverClient = legacyProxyToolPathsEnabled ? createOpencodeClient({ baseUrl: serverUrl.toString(), directory: workspaceDirectory }) : null;
  const discovery = legacyProxyToolPathsEnabled ? new OpenCodeToolDiscovery(serverClient ?? client3) : null;
  const localRegistry = new ToolRegistry;
  registerDefaultTools(localRegistry);
  const timeoutMs = Number(process.env.CURSOR_ACP_TOOL_TIMEOUT_MS || 30000);
  const localExec = new LocalExecutor(localRegistry);
  const sdkExec = legacyProxyToolPathsEnabled ? new SdkExecutor(serverClient ?? client3, timeoutMs) : null;
  const mcpExec = legacyProxyToolPathsEnabled ? new McpExecutor(serverClient ?? client3, timeoutMs) : null;
  const executorChain = [localExec];
  if (sdkExec)
    executorChain.push(sdkExec);
  if (mcpExec)
    executorChain.push(mcpExec);
  const toolsByName = new Map;
  const skillLoader = new SkillLoader;
  let skillResolver = null;
  const router = legacyProxyToolPathsEnabled ? new ToolRouter({
    execute: (toolId, args) => executeWithChain(executorChain, toolId, args),
    toolsByName,
    resolveName: (name) => skillResolver?.resolve(name)
  }) : null;
  let lastToolNames = [];
  let lastToolMap = [];
  async function refreshTools() {
    toolsByName.clear();
    const toolEntries = [];
    const add = (name, t) => {
      if (!toolsByName.has(name)) {
        toolsByName.set(name, t);
      }
      toolEntries.push({
        type: "function",
        function: {
          name,
          description: `${describeTool(t)} (skill id: ${t.id})`,
          parameters: toOpenAiParameters(t.parameters)
        }
      });
    };
    const localTools = localRegistry.list().map((t) => ({ ...t, name: `oc_${t.id}` }));
    for (const asTool of localTools) {
      const nsName = asTool.name;
      add(nsName, asTool);
    }
    let discoveredList = [];
    if (discovery) {
      try {
        discoveredList = await discovery.listTools();
        discoveredList.forEach((t) => toolsByName.set(t.name, t));
      } catch (err) {
        log23.debug("Tool discovery failed, using local tools only", { error: String(err) });
      }
    }
    const allTools = [...localTools, ...discoveredList];
    const skills = skillLoader.load(allTools);
    skillResolver = new SkillResolver(skills);
    if (sdkExec) {
      sdkExec.setToolIds(discoveredList.filter((t) => t.source === "sdk").map((t) => t.id));
    }
    if (mcpExec) {
      mcpExec.setToolIds(discoveredList.filter((t) => t.source === "mcp").map((t) => t.id));
    }
    for (const t of discoveredList) {
      add(t.name, t);
      if (t.name === "bash" && !toolsByName.has("shell")) {
        add("shell", t);
      }
      const baseId = t.id.replace(/[^a-zA-Z0-9_\\-]/g, "_");
      const skillAlias = `oc_skill_${baseId}`.slice(0, 64);
      if (!toolsByName.has(skillAlias))
        add(skillAlias, t);
      const superAlias = `oc_superskill_${baseId}`.slice(0, 64);
      if (!toolsByName.has(superAlias))
        add(superAlias, t);
      const spAlias = `oc_superpowers_${baseId}`.slice(0, 64);
      if (!toolsByName.has(spAlias))
        add(spAlias, t);
    }
    lastToolNames = toolEntries.map((e) => e.function.name);
    lastToolMap = allTools.map((t) => ({ id: t.id, name: t.name }));
    log23.debug("Tools refreshed", { local: localTools.length, discovered: discoveredList.length, total: toolEntries.length });
    return toolEntries;
  }
  const proxyBaseURL = await ensureCursorProxyServer(workspaceDirectory, router);
  log23.debug("Proxy server started", { baseURL: proxyBaseURL });
  // Mid-session recovery gate: the proxy process can die (Windows ghost
  // sockets on 32124/32125 accept TCP but never respond), leaving the startup
  // baseURL pinned to a dead port. chat.params calls getOrRefresh() per
  // request so a hung proxy is re-detected (throttled) and ensureCursorProxyServer
  // re-binds on a healthy port without an OpenCode restart.
  const proxyHealthGate = createProxyHealthGate({
    probe: async (url) => {
      try {
        const healthUrl = url.replace(/\/v1\/?$/, "/health");
        const res = await fetchProxyHealthWithTimeout(healthUrl);
        if (!res || !res.ok) return false;
        const payload = await res.json().catch(() => null);
        return isReusableProxyHealthPayload(payload, workspaceDirectory);
      } catch {
        return false;
      }
    },
    rebind: async () => {
      const next = await ensureCursorProxyServer(workspaceDirectory, router);
      log23.warn("cursor-acp proxy recovered mid-session", { baseURL: next });
      syncProviderOptionsBaseURL(next);
      return next;
    },
    throttleMs: 2000
  });
  proxyHealthGate.setBaseURL(proxyBaseURL);
  // Keep /provider options.baseURL aligned after a mid-session rebind so the
  // live config reflects the recovered port, not the dead startup port.
  let cursorProviderOptionsRef = null;
  const syncProviderOptionsBaseURL = (url) => {
    if (cursorProviderOptionsRef && typeof url === "string" && url.length > 0) {
      cursorProviderOptionsRef.baseURL = url;
    }
  };
  const toolHookEntries = buildToolHookEntries(localRegistry, workspaceDirectory);
  return {
    // Keep /provider options.baseURL aligned with the live proxy (may be 32125
    // when 32124 is a Windows ghost socket). Without this, OpenCode can still
    // advertise the dead :32124 URL even though chat.params rewrites per request.
    config(cfg) {
      const provider = cfg?.provider?.[CURSOR_PROVIDER_ID2];
      if (!provider || typeof provider !== "object") return;
      provider.options = provider.options && typeof provider.options === "object" ? provider.options : {};
      provider.options.baseURL = proxyBaseURL;
      cursorProviderOptionsRef = provider.options;
    },
    tool: { ...toolHookEntries, ...mcpToolEntries },
    auth: {
      provider: CURSOR_PROVIDER_ID2,
      async loader(getAuth) {
        try {
          const auth = await getAuth();
          if (auth?.type === "api" && auth.key) {
            storedApiKey = auth.key;
            log23.debug("Stored API key from auth loader");
          }
        } catch (err) {
          log23.debug("No stored auth available", { error: String(err) });
        }
        return {};
      },
      methods: [
        {
          type: "api",
          label: "Cursor API Key (cursor.com/settings)"
        }
      ]
    },
    async "chat.params"(input, output) {
      const boundaryContext = createBoundaryRuntimeContext("chat.params");
      const providerMatch = boundaryContext.run("matchesProvider", (boundary) => boundary.matchesProvider(input.model));
      if (!providerMatch) {
        return;
      }
      const liveProxyBaseURL = await proxyHealthGate.getOrRefresh();
      boundaryContext.run("applyChatParamDefaults", (boundary) => boundary.applyChatParamDefaults(output, liveProxyBaseURL, CURSOR_PROXY_DEFAULT_BASE_URL, "cursor-agent"));
      if (toolsEnabled) {
        try {
          const existingTools = output.options.tools;
          const shouldRefresh = TOOL_LOOP_MODE === "proxy-exec" || TOOL_LOOP_MODE === "opencode" && existingTools == null;
          const refreshedTools = shouldRefresh ? await refreshTools() : [];
          const resolved = boundaryContext.run("resolveChatParamTools", (boundary) => boundary.resolveChatParamTools(TOOL_LOOP_MODE, existingTools, refreshedTools));
          if (resolved.action === "override" || resolved.action === "fallback") {
            output.options.tools = applyCursorWriteToolContract(resolved.tools);
          } else if (resolved.action === "preserve") {
            const count = Array.isArray(existingTools) ? existingTools.length : 0;
            output.options.tools = applyCursorWriteToolContract(existingTools);
            log23.debug("Using OpenCode-provided tools from chat.params", { count });
          }
        } catch (err) {
          log23.debug("Failed to refresh tools", { error: String(err) });
        }
      }
      if (mcpToolDefs.length > 0) {
        const beforeTools = Array.isArray(output.options.tools) ? output.options.tools : [];
        if (Array.isArray(output.options.tools)) {
          output.options.tools = [...output.options.tools, ...mcpToolDefs];
        } else {
          output.options.tools = mcpToolDefs;
        }
        const afterTools = Array.isArray(output.options.tools) ? output.options.tools : [];
        log23.debug("Injected MCP tool definitions into chat.params", {
          injectedCount: mcpToolDefs.length,
          beforeCount: beforeTools.length,
          afterCount: afterTools.length,
          mcpNames: mcpToolDefs.slice(0, 10).map((t) => t?.function?.name ?? t?.name ?? "unknown"),
          tailNames: afterTools.slice(-10).map((t) => t?.function?.name ?? t?.name ?? "unknown")
        });
      }
    },
    async "experimental.chat.system.transform"(input, output) {
      if (!toolsEnabled)
        return;
      const boundaryContext = createBoundaryRuntimeContext("experimental.chat.system.transform");
      const providerMatch = boundaryContext.run("matchesProvider", (boundary) => boundary.matchesProvider(input.model));
      if (!providerMatch) {
        return;
      }
      const subagentNames = readSubagentNames();
      const systemMessage = buildAvailableToolsSystemMessage(lastToolNames, lastToolMap, mcpToolDefs, mcpToolSummaries, subagentNames);
      if (!systemMessage)
        return;
      output.system = output.system || [];
      output.system.push(systemMessage);
    }
  };
}, plugin_default;
var init_plugin = __esm(() => {
  init_openai_sse();
  init_parser();
  init_logger();
  init_perf();
  init_errors();
  init_prompt_builder();
  init_bridge_json();
  init_session_resume();
  init_tool_loop();
  init_discovery();
  init_schema();
  init_router();
  init_sync();
  init_config();
  init_client_manager();
  init_tool_bridge();
  init_dist();
  init_local();
  init_sdk();
  init_mcp();
  init_executor();
  init_defaults();
  init_boundary();
  init_runtime_interception();
  init_toast_service();
  init_tool_schema_compat();
  init_tool_loop_guard();
  init_sdk_child();
  init_cursor_agent_child();
  init_backend();
  init_binary();
  log23 = createLogger("plugin");
  CURSOR_PROVIDER_PREFIX = `${CURSOR_PROVIDER_ID2}/`;
  CURSOR_PROXY_DEFAULT_BASE_URL = `http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/v1`;
  REUSE_EXISTING_PROXY = process.env.CURSOR_ACP_REUSE_EXISTING_PROXY !== "false";
  FORCE_TOOL_MODE = process.env.CURSOR_ACP_FORCE !== "false";
  EMIT_TOOL_UPDATES = process.env.CURSOR_ACP_EMIT_TOOL_UPDATES === "true";
  FORWARD_TOOL_CALLS = process.env.CURSOR_ACP_FORWARD_TOOL_CALLS !== "false";
  TOOL_LOOP_MODE_RAW = process.env.CURSOR_ACP_TOOL_LOOP_MODE;
  ({ mode: TOOL_LOOP_MODE, valid: TOOL_LOOP_MODE_VALID } = parseToolLoopMode(TOOL_LOOP_MODE_RAW));
  PROVIDER_BOUNDARY_MODE_RAW = process.env.CURSOR_ACP_PROVIDER_BOUNDARY;
  ({
    mode: PROVIDER_BOUNDARY_MODE,
    valid: PROVIDER_BOUNDARY_MODE_VALID
  } = parseProviderBoundaryMode(PROVIDER_BOUNDARY_MODE_RAW));
  LEGACY_PROVIDER_BOUNDARY = createProviderBoundary("legacy", CURSOR_PROVIDER_ID2);
  PROVIDER_BOUNDARY = PROVIDER_BOUNDARY_MODE === "legacy" ? LEGACY_PROVIDER_BOUNDARY : createProviderBoundary(PROVIDER_BOUNDARY_MODE, CURSOR_PROVIDER_ID2);
  ENABLE_PROVIDER_BOUNDARY_AUTOFALLBACK = process.env.CURSOR_ACP_PROVIDER_BOUNDARY_AUTOFALLBACK !== "false";
  TOOL_LOOP_MAX_REPEAT_RAW = process.env.CURSOR_ACP_TOOL_LOOP_MAX_REPEAT;
  ({
    value: TOOL_LOOP_MAX_REPEAT,
    valid: TOOL_LOOP_MAX_REPEAT_VALID
  } = parseToolLoopMaxRepeat(TOOL_LOOP_MAX_REPEAT_RAW));
  ({
    proxyExecuteToolCalls: PROXY_EXECUTE_TOOL_CALLS,
    suppressConverterToolEvents: SUPPRESS_CONVERTER_TOOL_EVENTS,
    shouldEmitToolUpdates: SHOULD_EMIT_TOOL_UPDATES
  } = PROVIDER_BOUNDARY.computeToolLoopFlags(TOOL_LOOP_MODE, FORWARD_TOOL_CALLS, EMIT_TOOL_UPDATES));
  TOOL_HOOK_EXCLUSIONS = new Set(["grep"]);
  OPENCODE_NATIVE_TOOL_HOOK_EXCLUSIONS = new Set(["edit", "write"]);
  plugin_default = CursorPlugin;
});

// src/plugin-entry.ts
init_plugin_toggle();
init_logger();
var log24 = createLogger("plugin-entry");
var CursorPluginEntry = async (input) => {
  const state = shouldEnableCursorPlugin();
  if (!state.enabled) {
    log24.info("Plugin disabled in OpenCode config; skipping initialization", {
      configPath: state.configPath,
      reason: state.reason
    });
    return {};
  }
  const mod = await Promise.resolve().then(() => (init_plugin(), exports_plugin));
  return mod.CursorPlugin(input);
};
var plugin_entry_default = CursorPluginEntry;
export {
  plugin_entry_default as default
};
