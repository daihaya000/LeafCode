import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "./providers";

/** Loopback request so the shared API guard authorizes these handler calls. */
function localReq() {
  return new Request("http://127.0.0.1:3000/api", {
    headers: { host: "127.0.0.1:3000" },
  });
}

const originalAppData = process.env.APPDATA;
let appData: string;

function request(body: unknown): Request {
  return new Request("http://localhost/api/addons/codexbar/providers", {
    method: "PUT",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(async () => {
  appData = await fs.mkdtemp(path.join(os.tmpdir(), "codexbar-providers-"));
  process.env.APPDATA = appData;
  await fs.mkdir(path.join(appData, "CodexBar"));
  await fs.writeFile(
    path.join(appData, "CodexBar", "config.json"),
    JSON.stringify({ enabledProviders: ["codex", "claude", "codex"], syntheticApiKey: "not-returned" }),
  );
});

afterEach(async () => {
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  await fs.rm(appData, { recursive: true, force: true });
});

describe("CodexBar provider settings API", () => {
  it("returns only a fixed safe catalog and a version", async () => {
    const response = await GET(localReq());
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      providers: expect.arrayContaining([
        expect.objectContaining({ id: "codex", name: "Codex", enabled: true, configurable: true }),
        expect.objectContaining({ id: "claude", enabled: true }),
        expect.objectContaining({ id: "synthetic", enabled: false }),
      ]),
      version: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("not-returned");
  });

  it("deduplicates enabledProviders, preserves unrelated config, and rejects stale writes", async () => {
    const initial = await responseJson(await GET(localReq()));
    const updatedResponse = await PUT(
      request({ providerId: "claude", enabled: false, version: initial.version }),
    );
    const updated = await responseJson(updatedResponse);

    expect(updatedResponse.status).toBe(200);
    expect(updated.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "codex", enabled: true }),
      expect.objectContaining({ id: "claude", enabled: false }),
    ]));
    const saved = JSON.parse(await fs.readFile(path.join(appData, "CodexBar", "config.json"), "utf8"));
    expect(saved).toEqual({ enabledProviders: ["codex"], syntheticApiKey: "not-returned" });

    const stale = await PUT(request({ providerId: "cursor", enabled: true, version: initial.version }));
    expect(stale.status).toBe(409);
  });

  it("re-reads the version after a config-adjacent cross-process lock", async () => {
    const file = path.join(appData, "CodexBar", "config.json");
    const initial = await responseJson(await GET(localReq()));
    const lockFile = `${file}.providers.lock`;
    const lock = await fs.open(lockFile, "wx", 0o600);
    const pending = PUT(request({ providerId: "cursor", enabled: true, version: initial.version }));

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await fs.writeFile(file, JSON.stringify({ enabledProviders: ["codex", "claude", "synthetic"] }));
    } finally {
      await lock.close();
      await fs.unlink(lockFile);
    }

    expect((await pending).status).toBe(409);
  });

  it("rejects unknown input and disabling the final enabled provider", async () => {
    const initial = await responseJson(await GET(localReq()));
    expect(await PUT(request({ providerId: "unknown", enabled: true, version: initial.version }))).toMatchObject({ status: 400 });

    await fs.writeFile(path.join(appData, "CodexBar", "config.json"), JSON.stringify({ enabledProviders: ["codex"] }));
    const single = await responseJson(await GET(localReq()));
    const response = await PUT(request({ providerId: "codex", enabled: false, version: single.version }));
    expect(response.status).toBe(400);
  });

  it("does not overwrite a missing or malformed config", async () => {
    const file = path.join(appData, "CodexBar", "config.json");
    await fs.writeFile(file, "{broken secret-looking text");
    const response = await GET(localReq());
    expect(response.status).toBe(503);
    expect(await fs.readFile(file, "utf8")).toBe("{broken secret-looking text");
  });

  it("parses config.json written with a UTF-8 BOM (native CodexBar app export)", async () => {
    const file = path.join(appData, "CodexBar", "config.json");
    const bom = "\ufeff";
    await fs.writeFile(file, bom + JSON.stringify({ enabledProviders: ["codex", "claude"] }), "utf8");

    const response = await GET(localReq());
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "codex", enabled: true }),
      expect.objectContaining({ id: "claude", enabled: true }),
      expect.objectContaining({ id: "cursor", enabled: false }),
    ]));
  });
});
