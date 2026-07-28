import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Playwright E2E wrapper for CI/automated use.
 *
 * Rules:
 * - Rejects interactive/debug modes that would hang in a non-interactive agent
 *   environment (--debug, --ui, --codegen, --trace-viewer, etc).
 * - Validates --grep patterns before running to avoid "0 tests found" + debug
 *   mode hangs that leave orphan Node/Playwright worker processes.
 * - Delegates to Playwright's CLI for everything else.
 */

const require = createRequire(import.meta.url);
const playwrightDir = require.resolve("playwright/package.json");
const playwrightCli = join(dirname(playwrightDir), "cli.js");

const FORBIDDEN_RE =
  /^--(debug|ui|codegen|trace-viewer|watch|headed|browser-channel)$/;

const rawArgs = process.argv.slice(2);

for (const arg of rawArgs) {
  if (FORBIDDEN_RE.test(arg)) {
    console.error(
      `[e2e] Forbidden interactive/long-running Playwright flag: ${arg}`,
    );
    console.error(
      `[e2e] Use 'npm run e2e' or 'node scripts/e2e.mjs' without interactive flags.`,
    );
    process.exit(1);
  }
}

// Validate grep patterns before running if the user supplied one.
const grepIndex = rawArgs.findIndex(
  (a) => a === "--grep" || a === "-g" || a.startsWith("--grep="),
);
if (grepIndex !== -1) {
  let pattern;
  const arg = rawArgs[grepIndex];
  if (arg.includes("=")) {
    pattern = arg.split("=").slice(1).join("=");
  } else {
    pattern = rawArgs[grepIndex + 1];
  }

  if (!pattern) {
    console.error(`[e2e] --grep requires a pattern.`);
    process.exit(1);
  }

  const list = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", "--list", "--grep", pattern],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

  const matched = /(\d+) test\(s\)/i.exec(list.stdout)?.[1];
  const count = matched ? Number(matched) : null;

  if (count === 0 || list.code !== 0) {
    console.error(
      `[e2e] No tests match --grep pattern: ${pattern}. Aborting to avoid a hung worker.`,
    );
    if (list.stderr) console.error(list.stderr.trim());
    if (list.stdout) console.error(list.stdout.trim());
    process.exit(1);
  }
}

const child = spawn(process.execPath, [playwrightCli, "test", ...rawArgs], {
  stdio: "inherit",
  cwd: process.cwd(),
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
