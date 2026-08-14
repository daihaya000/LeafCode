// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataDir, legacyDataDir, migrateLegacyDataDir } from "../../../scripts/lib/data-dir.mjs";

/**
 * Pins the LeafCode data-dir contract:
 * - dataDir() resolves to %APPDATA%\leafcode (win32) / ~/.leafcode
 * - migrateLegacyDataDir() renames a legacy opencode-webui dir in place once
 */
describe("data-dir migration (scripts/lib/data-dir.mjs)", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "leafcode-datadir-"));
  const prevAppData = process.env.APPDATA;
  const prevPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(() => {
    if (prevAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppData;
    if (prevPlatform) Object.defineProperty(process, "platform", prevPlatform);
    else delete (process as { platform?: unknown }).platform;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("resolves to %APPDATA%\\leafcode on win32", () => {
    process.env.APPDATA = sandbox;
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(dataDir()).toBe(path.join(sandbox, "leafcode"));
    expect(legacyDataDir()).toBe(path.join(sandbox, "opencode-webui"));
  });

  it("resolves to ~/.leafcode elsewhere", () => {
    delete process.env.APPDATA;
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(dataDir()).toBe(path.join(os.homedir(), ".leafcode"));
    expect(legacyDataDir()).toBe(path.join(os.homedir(), ".opencode-webui"));
  });

  it("migrates an existing legacy data dir once (rename)", () => {
    process.env.APPDATA = sandbox;
    Object.defineProperty(process, "platform", { value: "win32" });
    const legacy = legacyDataDir();
    fs.mkdirSync(path.join(legacy, "projects"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "webui.db"), "x");

    expect(migrateLegacyDataDir()).toBe(true);
    expect(fs.existsSync(path.join(dataDir(), "webui.db"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir(), "projects"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);

    // Second call: new dir already exists → no-op.
    expect(migrateLegacyDataDir()).toBe(false);
    expect(fs.existsSync(path.join(dataDir(), "webui.db"))).toBe(true);
  });

  it("is a no-op on a fresh install (no legacy dir)", () => {
    process.env.APPDATA = sandbox;
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(migrateLegacyDataDir()).toBe(false);
    expect(fs.existsSync(dataDir())).toBe(false);
  });

  it("is a no-op when the new dir already exists (never overwrites)", () => {
    process.env.APPDATA = sandbox;
    Object.defineProperty(process, "platform", { value: "win32" });
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), "fresh.db"), "y");
    fs.mkdirSync(legacyDataDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDataDir(), "old.db"), "z");

    expect(migrateLegacyDataDir()).toBe(false);
    expect(fs.readFileSync(path.join(dataDir(), "fresh.db"), "utf8")).toBe("y");
    expect(fs.existsSync(legacyDataDir())).toBe(true);
  });
});
