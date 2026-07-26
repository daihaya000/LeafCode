import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ roots: [] as string[], dataDir: "" }));

vi.mock("./paths", () => ({
  dataDir: () => h.dataDir,
  ensureDataDir: () => undefined,
}));

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
  if (!h.dataDir) h.dataDir = tempDir("allow-data-");
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

  it("allows a provisioned worktree under <dataDir>/worktrees", () => {
    const root = tempDir("allow-root-");
    h.roots.push(root);
    const wt = path.join(h.dataDir, "worktrees", "proj-1", "webui__main__task-abc");
    fs.mkdirSync(wt, { recursive: true });
    const res = assertAllowedDirectory(wt);
    expect(res.ok).toBe(true);
  });

  it("allows a temporary copy under <dataDir>/copies", () => {
    const root = tempDir("allow-root-");
    h.roots.push(root);
    const copy = path.join(h.dataDir, "copies", "ws-copy-1");
    fs.mkdirSync(copy, { recursive: true });
    const res = assertAllowedDirectory(copy);
    expect(res.ok).toBe(true);
  });

  it("still rejects temporary copy paths when no roots are configured", () => {
    const copy = path.join(h.dataDir, "copies", "ws-copy-1");
    fs.mkdirSync(copy, { recursive: true });
    const res = assertAllowedDirectory(copy);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it("still rejects worktree paths when no roots are configured", () => {
    const wt = path.join(h.dataDir, "worktrees", "proj-1", "wt");
    fs.mkdirSync(wt, { recursive: true });
    const res = assertAllowedDirectory(wt);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it("rejects a dataDir path outside the worktrees and copies bases", () => {
    const root = tempDir("allow-root-");
    h.roots.push(root);
    const other = path.join(h.dataDir, "secrets");
    fs.mkdirSync(other, { recursive: true });
    const res = assertAllowedDirectory(other);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
});
