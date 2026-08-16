import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

/** Loopback request so the shared API guard authorizes these handler calls. */
function localReq() {
  return new Request("http://127.0.0.1:3000/api", {
    headers: { host: "127.0.0.1:3000" },
  });
}

const ORIGINAL_ENV = { ...process.env };

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "commandcode-auth-test-"));
  process.env = { ...ORIGINAL_ENV };
  process.env.COMMANDCODE_CONFIG_DIR = tempHome;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("GET /api/provider/commandcode/auth", () => {
  it("reports disconnected when no auth file exists", async () => {
    const response = await GET(localReq());
    expect(await response.json()).toEqual({ connected: false });
  });

  it("reports connected when auth.json has an apiKey", async () => {
    fs.mkdirSync(tempHome, { recursive: true });
    fs.writeFileSync(path.join(tempHome, "auth.json"), JSON.stringify({ apiKey: "sk-test" }));

    const response = await GET(localReq());
    expect(await response.json()).toEqual({ connected: true });
  });

  it("reports disconnected when auth.json exists without an apiKey", async () => {
    fs.mkdirSync(tempHome, { recursive: true });
    fs.writeFileSync(path.join(tempHome, "auth.json"), JSON.stringify({ userName: "daihaya" }));

    const response = await GET(localReq());
    expect(await response.json()).toEqual({ connected: false });
  });
});