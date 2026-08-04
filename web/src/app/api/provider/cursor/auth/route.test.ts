import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const ORIGINAL_ENV = { ...process.env };

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-auth-test-"));
  process.env = { ...ORIGINAL_ENV };
  process.env.CURSOR_ACP_HOME_DIR = tempHome;
  delete process.env.CURSOR_API_KEY;
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("GET /api/provider/cursor/auth", () => {
  it("reports disconnected when no CURSOR_API_KEY and no auth file exist", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ connected: false });
  });

  it("reports connected when CURSOR_API_KEY is set", async () => {
    process.env.CURSOR_API_KEY = "sk-test";
    const response = await GET();
    expect(await response.json()).toEqual({ connected: true });
  });

  it("reports connected when a cursor-agent auth file exists on disk", async () => {
    const configDir = path.join(tempHome, ".config", "cursor");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "cli-config.json"), "{}");

    const response = await GET();
    expect(await response.json()).toEqual({ connected: true });
  });
});
