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
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-auth-test-"));
  process.env = { ...ORIGINAL_ENV };
  process.env.CLAUDE_CONFIG_DIR = tempHome;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("GET /api/provider/claude/auth", () => {
  it("reports disconnected when no token env and no credential file exist", async () => {
    const response = await GET(localReq());
    expect(await response.json()).toEqual({ connected: false });
  });

  it("reports connected when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const response = await GET(localReq());
    expect(await response.json()).toEqual({ connected: true });
  });

  it("reports connected when a claude credential file exists on disk", async () => {
    fs.writeFileSync(path.join(tempHome, ".credentials.json"), "{}");

    const response = await GET(localReq());
    expect(await response.json()).toEqual({ connected: true });
  });
});
