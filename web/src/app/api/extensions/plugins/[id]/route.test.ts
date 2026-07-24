import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parse } from "jsonc-parser";

const h = vi.hoisted(() => ({ dataDir: "" }));

vi.mock("@/lib/paths", () => ({
  dataDir: () => h.dataDir,
  ensureDataDir: () => undefined,
}));

import { PATCH } from "./route";
import { GET } from "../route";

let base: string;
let data: string;

function patch(id: string, body: unknown): Promise<Response> {
  return PATCH(
    new NextRequest(
      `http://localhost/api/extensions/plugins/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
    { params: Promise.resolve({ id }) },
  );
}

async function listPluginIds(): Promise<{ id: string; name: string; enabled: boolean }[]> {
  const res = await GET(new NextRequest("http://localhost/api/extensions/plugins"));
  const body = (await res.json()) as {
    plugins: { id: string; name: string; enabled: boolean }[];
  };
  return body.plugins;
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "api-plugins-toggle-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "api-plugins-toggle-data-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  h.dataDir = data;
  fs.writeFileSync(
    path.join(base, "opencode.jsonc"),
    `{ "plugin": ["plug-a", "plug-b"] }`,
  );
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

describe("PATCH /api/extensions/plugins/[id]", () => {
  it("disables and re-enables a configured plugin via listing ids", async () => {
    const initial = await listPluginIds();
    const target = initial.find((p) => p.name === "plug-a")!;

    const off = await patch(target.id, { enabled: false });
    expect(off.status).toBe(200);
    const config = parse(
      fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8"),
    ) as { plugin: string[] };
    expect(config.plugin).toEqual(["plug-b"]);

    const mid = await listPluginIds();
    const disabled = mid.find((p) => p.name === "plug-a")!;
    expect(disabled.enabled).toBe(false);

    const on = await patch(disabled.id, { enabled: true });
    expect(on.status).toBe(200);
    const restored = parse(
      fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8"),
    ) as { plugin: string[] };
    expect(restored.plugin).toEqual(["plug-a", "plug-b"]);
  });

  it("toggles a local plugin file between plugin/ and plugin-disabled/", async () => {
    fs.mkdirSync(path.join(base, "plugin"));
    fs.writeFileSync(path.join(base, "plugin", "x.js"), "x");

    const off = await patch("local:x.js", { enabled: false });
    expect(off.status).toBe(200);
    expect(fs.existsSync(path.join(base, "plugin-disabled", "x.js"))).toBe(true);

    const on = await patch("local:x.js", { enabled: true });
    expect(on.status).toBe(200);
    expect(fs.existsSync(path.join(base, "plugin", "x.js"))).toBe(true);
  });

  it("returns 400 for malformed ids and bodies", async () => {
    expect((await patch("bogus", { enabled: false })).status).toBe(400);
    expect((await patch("local:../opencode.jsonc", { enabled: false })).status).toBe(400);
    const plugins = await listPluginIds();
    expect((await patch(plugins[0].id, { enabled: "no" })).status).toBe(400);
  });

  it("returns 404 for an unknown configured id", async () => {
    const res = await patch("config:0000000000000000.0", { enabled: false });
    expect(res.status).toBe(404);
  });

  it("returns 409 on a local file conflict", async () => {
    fs.mkdirSync(path.join(base, "plugin"));
    fs.mkdirSync(path.join(base, "plugin-disabled"));
    fs.writeFileSync(path.join(base, "plugin", "x.js"), "a");
    fs.writeFileSync(path.join(base, "plugin-disabled", "x.js"), "b");

    const res = await patch("local:x.js", { enabled: false });
    expect(res.status).toBe(409);
  });
});
