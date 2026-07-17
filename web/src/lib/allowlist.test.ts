import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ roots: [] as string[] }));

vi.mock("./db", () => ({
  listAllowedRoots: () => h.roots,
  addAllowedRoot: (p: string) => {
    h.roots.push(p);
  },
}));

import { assertAllowedDirectory } from "./allowlist";

const created: string[] = [];
function tempDir(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(d);
  return d;
}

beforeEach(() => {
  h.roots.length = 0;
});

afterAll(() => {
  for (const d of created) fs.rmSync(d, { recursive: true, force: true });
});

describe("assertAllowedDirectory", () => {
  it("rejects a missing directory argument", () => {
    const res = assertAllowedDirectory("");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it("rejects when no roots are configured", () => {
    const res = assertAllowedDirectory(os.tmpdir());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it("allows a directory under an allowed root", () => {
    const root = tempDir("allow-root-");
    const child = path.join(root, "sub");
    fs.mkdirSync(child);
    h.roots.push(root);
    const res = assertAllowedDirectory(child);
    expect(res.ok).toBe(true);
  });

  it("allows the root itself", () => {
    const root = tempDir("allow-self-");
    h.roots.push(root);
    expect(assertAllowedDirectory(root).ok).toBe(true);
  });

  it("rejects a directory outside all roots", () => {
    const root = tempDir("allow-in-");
    const outside = tempDir("allow-out-");
    h.roots.push(root);
    const res = assertAllowedDirectory(outside);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
});
