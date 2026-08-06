import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolve npm's JS CLI entry point so npm can be invoked as
 * `node <npm-cli.js> ...` instead of the `npm.cmd` shell shim.
 *
 * Mirrors `host/src/index.js`'s `spawnNpm`: running through `node` avoids
 * `child_process`'s `shell: true` argument-quoting pitfalls on Windows, and
 * reusing `npm_execpath` picks the exact npm this process was itself started
 * with (this route runs inside the Next.js server, which the tray host
 * always launches via `npm run dev`/`npm run start`).
 */
export function resolveNpmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((value): value is string => Boolean(value));

  // If npm_execpath already points at a real file, use it directly without
  // shelling out. This is the common case for Next.js started by the tray
  // host (which launches through npm run dev / npm run start).
  if (candidates[0] && existsSync(candidates[0])) return candidates[0];

  try {
    const npmCommands = execFileSync("where.exe", ["npm.cmd"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const npmCommand of npmCommands) {
      candidates.push(join(dirname(npmCommand), "node_modules", "npm", "bin", "npm-cli.js"));
    }
  } catch {
    // where.exe missing/failed: the Node-adjacent candidate above still
    // covers standard installs.
  }

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("npm-cli.js が見つかりませんでした。Node.js を npm 込みで再インストールしてください。");
  }
  return found;
}
