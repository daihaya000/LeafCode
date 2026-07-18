import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let workspace = "";

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn(() => ({ ok: true, path: workspace })),
}));

import { GET } from "./route";

function request(directory: string, filePath?: string): NextRequest {
  const params = new URLSearchParams({ directory });
  if (filePath !== undefined) params.set("path", filePath);
  return new NextRequest(`http://localhost/api/files/content?${params}`);
}

describe("GET /api/files/content", () => {
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "plan-content-"));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("returns a project-local Markdown document", async () => {
    const filename = path.join(workspace, "plan.md");
    fs.writeFileSync(filename, "# Plan\n");

    const response = await GET(request(workspace, filename));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "plan.md",
      content: "# Plan\n",
    });
  });

  it("returns a Markdown document addressed by a namespaced Windows path", async () => {
    const inWorkspaceMd = path.join(workspace, "plan.md");
    fs.writeFileSync(inWorkspaceMd, "# Plan\n");

    const response = await GET(
      request(workspace, path.toNamespacedPath(inWorkspaceMd)),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "plan.md",
      content: "# Plan\n",
    });
  });

  it.each([
    ["missing directory", undefined, undefined],
    ["missing path", workspace, undefined],
  ])("rejects %s", async (_label, directory, filePath) => {
    const response = await GET(
      request(directory ?? "", filePath),
    );

    expect(response.status).toBe(400);
  });

  it("rejects non-Markdown files", async () => {
    const filename = path.join(workspace, "notes.txt");
    fs.writeFileSync(filename, "secret");

    const response = await GET(request(workspace, filename));

    expect(response.status).toBe(403);
  });

  it("rejects a sibling traversal path", async () => {
    const outside = path.join(path.dirname(workspace), "outside.md");
    fs.writeFileSync(outside, "secret");
    try {
      const response = await GET(request(workspace, outside));

      expect(response.status).toBe(403);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("rejects a symlink escaping the workspace when supported", async () => {
    const outside = path.join(path.dirname(workspace), "outside-target.md");
    const link = path.join(workspace, "linked.md");
    fs.writeFileSync(outside, "secret");
    try {
      try {
        fs.symlinkSync(outside, link, "file");
      } catch {
        return;
      }

      const response = await GET(request(workspace, link));

      expect(response.status).toBe(403);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("rejects an in-workspace symlink whose real target is not Markdown", async () => {
    const secret = path.join(workspace, "secret.txt");
    const link = path.join(workspace, "linked.md");
    fs.writeFileSync(secret, "secret");
    try {
      fs.symlinkSync(secret, link, "file");
    } catch {
      return;
    }

    const response = await GET(request(workspace, link));

    expect(response.status).toBe(403);
  });

  it("rejects a directory named with an .md suffix", async () => {
    const directory = path.join(workspace, "not-a-file.md");
    fs.mkdirSync(directory);

    const response = await GET(request(workspace, directory));

    expect(response.status).toBe(400);
  });

  it("rejects a Markdown file larger than 1 MiB", async () => {
    const filename = path.join(workspace, "large.md");
    fs.writeFileSync(filename, Buffer.alloc(1_048_577, "x"));

    const response = await GET(request(workspace, filename));

    expect(response.status).toBe(413);
  });
});
