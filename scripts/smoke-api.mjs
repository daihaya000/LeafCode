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
  let engineOk = false;
  await check("health", async () => {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (!body.webui?.ok) throw new Error("webui not ok");
    engineOk = !!body.engine?.ok;
  });

  await check("projects upsert", async () => {
    // Note: do not send an explicit `name` here. This smoke check often runs
    // against a real, already-registered project (ROOT defaults to cwd), and
    // /api/projects upserts by rootPath, so a hardcoded name would overwrite
    // the real project's display name (see: name must always tie to folder).
    const res = await fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: ROOT }),
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

  // PTY terminal endpoints require a running OpenCode engine; skip when it is
  // unavailable (e.g. smoke run against a standalone Next.js dev server).
  if (engineOk) {
    await check("pty create/list/delete", async () => {
      const u = new URL(`${BASE}/api/pty-session`);
      u.searchParams.set("directory", ROOT);

      const createRes = await fetch(u, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: ROOT }),
      });
      if (createRes.status !== 200) {
        throw new Error(`${createRes.status} ${await createRes.text()}`);
      }
      const created = await createRes.json();
      if (!created.id) throw new Error("pty create did not return id");

      const listRes = await fetch(u);
      if (!listRes.ok) throw new Error(`${listRes.status} ${await listRes.text()}`);
      const listBody = await listRes.json();
      if (!Array.isArray(listBody.sessions)) {
        throw new Error("pty list did not return sessions array");
      }

      const delU = new URL(`${BASE}/api/pty-session`);
      delU.searchParams.set("id", created.id);
      delU.searchParams.set("directory", ROOT);
      const delRes = await fetch(delU, { method: "DELETE" });
      if (!delRes.ok) throw new Error(`${delRes.status} ${await delRes.text()}`);
    });
  } else {
    console.log("OK  pty create/list/delete (skipped: engine unavailable)");
  }

  console.log(process.exitCode ? "Smoke finished with failures" : "Smoke passed");
}

main();
