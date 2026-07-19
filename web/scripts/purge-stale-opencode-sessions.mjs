import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = path.join(
  process.env.USERPROFILE ?? "",
  ".local",
  "share",
  "opencode",
  "opencode.db",
);
const dryRun = !process.argv.includes("--apply");
const includeOther = process.argv.includes("--all-missing");
const useSql = process.argv.includes("--sql");
const baseUrl = process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096";

const WEBUI_DIR_RE = /opencode-webui[/\\]worktrees|\.webui-worktrees/i;

if (!fs.existsSync(dbPath)) {
  console.error("opencode.db not found:", dbPath);
  process.exit(1);
}

function loadTargets(readonly) {
  const db = new Database(dbPath, { readonly });
  const rows = db
    .prepare("SELECT id, directory FROM session WHERE directory IS NOT NULL")
    .all();
  const missing = rows.filter((row) => !fs.existsSync(row.directory));
  const targets = includeOther
    ? missing
    : missing.filter((row) => WEBUI_DIR_RE.test(row.directory));
  return { db, rows, missing, targets };
}

const preview = loadTargets(true);
console.log(
  JSON.stringify(
    {
      total: preview.rows.length,
      missing: preview.missing.length,
      targets: preview.targets.length,
      scope: includeOther ? "all-missing" : "webui-worktrees-only",
      dryRun,
      mode: useSql ? "sql" : "api",
      samples: preview.targets.slice(0, 5),
    },
    null,
    2,
  ),
);
preview.db.close();

if (dryRun) {
  console.log(
    "Re-run with --apply [--sql] to delete target sessions. Default scope is webui worktrees only.",
  );
  process.exit(0);
}

if (useSql) {
  const { db, targets } = loadTargets(false);
  db.pragma("foreign_keys = ON");
  const del = db.prepare("DELETE FROM session WHERE id = ?");
  const tx = db.transaction((ids) => {
    for (const id of ids) del.run(id);
  });
  tx(targets.map((t) => t.id));
  console.log(JSON.stringify({ deleted: targets.length, failed: 0 }, null, 2));
  db.close();
  process.exit(0);
}

let deleted = 0;
let failed = 0;
for (const row of preview.targets) {
  try {
    let res = await fetch(new URL(`/session/${row.id}`, baseUrl), {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok && res.status !== 404) {
      res = await fetch(new URL(`/session/${row.id}`, baseUrl), {
        method: "DELETE",
        headers: { "x-opencode-directory": row.directory },
        cache: "no-store",
      });
    }
    if (res.ok || res.status === 404) {
      deleted += 1;
    } else {
      failed += 1;
      console.error(row.id, res.status, await res.text());
    }
  } catch (err) {
    failed += 1;
    console.error(row.id, err instanceof Error ? err.message : err);
  }
}

console.log(JSON.stringify({ deleted, failed }, null, 2));
