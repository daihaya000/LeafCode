import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, PUT } from "./credentials";

const originalAppData = process.env.APPDATA;
let appData: string;

function request(body: unknown): Request {
  return new Request("http://localhost/api/addons/codexbar/credentials", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  appData = await fs.mkdtemp(path.join(os.tmpdir(), "codexbar-credentials-"));
  process.env.APPDATA = appData;
  await fs.mkdir(path.join(appData, "CodexBar"));
  await fs.writeFile(
    path.join(appData, "CodexBar", "config.json"),
    JSON.stringify({ enabledProviders: ["codex"], syntheticApiKey: "old-secret" }),
  );
});

afterEach(async () => {
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  await fs.rm(appData, { recursive: true, force: true });
});

describe("CodexBar credential API", () => {
  it("never returns keys and updates only supported credentials", async () => {
    const initial = await GET();
    const body = await initial.json() as { credentials: unknown[]; version: string };
    expect(initial.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("old-secret");

    const updated = await PUT(request({ providerId: "synthetic", apiKey: "new-secret", version: body.version }));
    expect(updated.status).toBe(200);
    expect(JSON.stringify(await updated.clone().json())).not.toContain("new-secret");
    expect(JSON.parse(await fs.readFile(path.join(appData, "CodexBar", "config.json"), "utf8"))).toEqual({
      enabledProviders: ["codex"],
      syntheticApiKey: "new-secret",
    });
  });

  it("clears a key and rejects stale or unsupported writes", async () => {
    const initial = await GET();
    const body = await initial.json() as { version: string };
    expect((await PUT(request({ providerId: "synthetic", apiKey: "", version: body.version }))).status).toBe(200);
    expect((await PUT(request({ providerId: "synthetic", apiKey: "x", version: body.version }))).status).toBe(409);
    expect((await PUT(request({ providerId: "codex", apiKey: "x", version: body.version }))).status).toBe(400);
  });
});
