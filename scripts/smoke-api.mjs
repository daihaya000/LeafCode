/**
 * Lightweight Phase 0/1 API smoke (Node).
 * Usage: node scripts/smoke-api.mjs  (expects Next on :3000 and optionally OpenCode :4096)
 */
const BASE = process.env.WEBUI_URL || "http://127.0.0.1:3000";
const ROOT = process.env.SMOKE_ROOT || process.cwd();

async function check(name, fn) {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message || err);
    process.exitCode = 1;
  }
}

async function main() {
  await check("health", async () => {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (!body.webui?.ok) throw new Error("webui not ok");
  });

  await check("projects upsert", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: ROOT, name: "smoke" }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  });

  await check("diff", async () => {
    const u = new URL(`${BASE}/api/diff`);
    u.searchParams.set("directory", ROOT);
    const res = await fetch(u);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  });

  await check("orphans scan", async () => {
    const res = await fetch(`${BASE}/api/workspaces/orphans?scan=1`);
    if (!res.ok) throw new Error(`${res.status}`);
  });

  await check("branches", async () => {
    const u = new URL(`${BASE}/api/git/branches`);
    u.searchParams.set("directory", ROOT);
    const res = await fetch(u);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  });

  await check("config write blocked", async () => {
    const res = await fetch(`${BASE}/api/opencode/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (res.status !== 403) throw new Error(`expected 403 got ${res.status}`);
  });

  console.log(process.exitCode ? "Smoke finished with failures" : "Smoke passed");
}

main();
