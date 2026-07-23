import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ allowed: "" }));

// Allow the temp scan root regardless of the real allow-list config.
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (dir: string) => {
    const resolved = path.resolve(dir);
    if (resolved === h.allowed || resolved.startsWith(h.allowed + path.sep)) {
      return { ok: true as const, path: resolved };
    }
    return { ok: false as const, error: "not allowed", status: 403 };
  },
}));

import { GET } from "./route";

let root = "";

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "files-search-"));
  h.allowed = root;
  fs.writeFileSync(path.join(root, "alpha.ts"), "");
  fs.writeFileSync(path.join(root, "beta.ts"), "");
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", "alpha-deep.ts"), "");
  // Skipped directories must never be walked.
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "alpha-skip.ts"), "");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/files/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe("GET /api/files/search", () => {
  it("returns matching files across nested directories", async () => {
    const res = await GET(call({ directory: root, q: "alpha" }));
    const body = (await res.json()) as { files: string[] };
    expect(body.files).toContain("alpha.ts");
    expect(body.files).toContain("sub/alpha-deep.ts");
    expect(body.files).not.toContain("beta.ts");
  });

  it("never descends into skipped directories", async () => {
    const res = await GET(call({ directory: root, q: "alpha" }));
    const body = (await res.json()) as { files: string[] };
    expect(body.files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("rejects a directory outside the allow-list", async () => {
    const res = await GET(call({ directory: path.join(os.tmpdir(), "nope") }));
    expect(res.status).toBe(403);
  });
});
