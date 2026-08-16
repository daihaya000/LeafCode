import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveHostControlUrl } from "./host-control.mjs";

export const HOST_PLAYWRIGHT_CLI_PATH = "/playwright-cli";
export const MAX_ARGV = 64;
export const MAX_ARG_CHARS = 16_384;
export const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Directory that holds playwright-cli.cmd so OpenCode bash finds the wrap
 * before the npm global shim.
 * @param {string} repoRoot
 */
export function playwrightCliWrapDir(repoRoot) {
  return join(repoRoot, "scripts", "playwright-cli-wrap");
}

/**
 * Prepend the wrap dir to PATH and mark the env so skills can detect it.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} repoRoot
 * @param {string} [platform]
 */
export function prependPlaywrightCliWrapPath(
  env,
  repoRoot,
  platform = process.platform,
) {
  const dir = playwrightCliWrapDir(repoRoot);
  const sep = platform === "win32" ? ";" : ":";
  const current = env.PATH ?? env.Path ?? "";
  const parts = current.split(sep).filter(Boolean);
  const normalizedDir = dir.replace(/[\\/]+$/, "").toLowerCase();
  const already = parts.some(
    (part) => part.replace(/[\\/]+$/, "").toLowerCase() === normalizedDir,
  );
  const next = { ...env, LEAFCODE_PLAYWRIGHT_CLI_WRAP: "1" };
  next.PATH = already ? current : `${dir}${sep}${current}`;
  return next;
}

/**
 * Resolve the real @playwright/cli entry. Never looks up `playwright-cli` on
 * PATH (that would recurse into this wrap).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(path: string) => boolean} [exists]
 */
export function resolvePlaywrightCliJs(env = process.env, exists = existsSync) {
  const override = env.PLAYWRIGHT_CLI_JS?.trim();
  if (override) {
    if (!exists(override)) {
      throw new Error(`PLAYWRIGHT_CLI_JS not found: ${override}`);
    }
    return override;
  }

  const home = env.HOME || env.USERPROFILE || homedir();
  const candidates = [];
  if (env.APPDATA) {
    candidates.push(
      join(env.APPDATA, "npm", "node_modules", "@playwright", "cli", "playwright-cli.js"),
    );
  }
  if (home) {
    candidates.push(
      join(home, ".npm-global", "lib", "node_modules", "@playwright", "cli", "playwright-cli.js"),
    );
    candidates.push(
      join(
        home,
        "AppData",
        "Roaming",
        "npm",
        "node_modules",
        "@playwright",
        "cli",
        "playwright-cli.js",
      ),
    );
  }
  candidates.push(
    "/usr/local/lib/node_modules/@playwright/cli/playwright-cli.js",
  );

  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  throw new Error(
    "playwright-cli.js not found. Install with: npm install -g @playwright/cli",
  );
}

/**
 * @param {unknown} body
 * @returns {{ argv: string[], cwd: string } | { error: string }}
 */
export function parsePlaywrightCliRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be an object" };
  }
  const record = /** @type {Record<string, unknown>} */ (body);
  if (!Array.isArray(record.argv)) return { error: "argv must be an array" };
  if (record.argv.length > MAX_ARGV) return { error: "too many args" };
  const argv = [];
  for (const arg of record.argv) {
    if (typeof arg !== "string") return { error: "args must be strings" };
    if (arg.length > MAX_ARG_CHARS) return { error: "arg too long" };
    if (arg.includes("\0")) return { error: "arg contains NUL" };
    argv.push(arg);
  }
  if (typeof record.cwd !== "string" || !record.cwd.trim()) {
    return { error: "cwd required" };
  }
  if (record.cwd.includes("\0")) return { error: "cwd contains NUL" };
  return { argv, cwd: record.cwd };
}

/**
 * Run playwright-cli.js and complete on the child's `exit` (not `close`), so a
 * detached daemon that keeps stdio open cannot stall the caller.
 * @param {{
 *   execPath?: string,
 *   cliJs: string,
 *   argv: string[],
 *   cwd: string,
 *   env?: NodeJS.ProcessEnv,
 *   spawnFn?: typeof spawn,
 *   timeoutMs?: number,
 * }} opts
 */
export function runPlaywrightCliProcess(opts) {
  const execPath = opts.execPath ?? process.execPath;
  const spawnFn = opts.spawnFn ?? spawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = opts.env ?? process.env;

  return new Promise((resolve, reject) => {
    const child = spawnFn(execPath, [opts.cliJs, ...opts.argv], {
      cwd: opts.cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    let done = false;
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(1, "timeout");
    }, timeoutMs);
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdout?.destroy();
        child.stderr?.destroy();
      } catch {
        /* ignore */
      }
      resolve({
        code: typeof code === "number" ? code : 1,
        signal: signal ?? null,
        stdout,
        stderr,
      });
    };
    child.on("exit", (code, signal) => finish(code, signal));
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * @param {{
 *   argv: string[],
 *   cwd: string,
 *   controlUrl: string,
 *   fetchFn?: typeof fetch,
 *   timeoutMs?: number,
 * }} opts
 */
export async function runViaHost(opts) {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${opts.controlUrl.replace(/\/+$/, "")}${HOST_PLAYWRIGHT_CLI_PATH}`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ argv: opts.argv, cwd: opts.cwd }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`host returned HTTP ${response.status} with non-JSON body`);
  }
  if (!response.ok || !payload || payload.ok !== true) {
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `host returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return {
    code: typeof payload.code === "number" ? payload.code : 1,
    stdout: typeof payload.stdout === "string" ? payload.stdout : "",
    stderr: typeof payload.stderr === "string" ? payload.stderr : "",
  };
}

/**
 * OpenCode-facing entry: on Windows relay through the LeafCode host so the
 * playwright-cli daemon is not a Job Object descendant of bash.
 * @param {{
 *   argv: string[],
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 *   fetchFn?: typeof fetch,
 *   spawnFn?: typeof spawn,
 *   platform?: string,
 * }} opts
 */
export async function runWrappedCli(opts) {
  const argv = opts.argv;
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const platform = opts.platform ?? process.platform;
  const forceDirect = env.PLAYWRIGHT_CLI_WRAP_DIRECT === "1";
  const useHost = !forceDirect && platform === "win32";

  if (useHost) {
    try {
      const controlUrl = resolveHostControlUrl({ env });
      const result = await runViaHost({
        argv,
        cwd,
        controlUrl,
        fetchFn: opts.fetchFn,
      });
      if (result.stdout) stdout.write(result.stdout);
      if (result.stderr) stderr.write(result.stderr);
      return result.code;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stderr.write(`playwright-cli wrap: host relay failed: ${message}\n`);
      stderr.write(
        "Start the LeafCode tray host, or set PLAYWRIGHT_CLI_WRAP_DIRECT=1 (hangs in OpenCode bash on Windows).\n",
      );
      return 1;
    }
  }

  const cliJs = resolvePlaywrightCliJs(env);
  const result = await runPlaywrightCliProcess({
    cliJs,
    argv,
    cwd,
    env,
    spawnFn: opts.spawnFn,
  });
  if (result.stdout) stdout.write(result.stdout);
  if (result.stderr) stderr.write(result.stderr);
  return result.code;
}
