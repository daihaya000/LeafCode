import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  openInEditor: vi.fn<(input: { directory: string; file: string }) => { editor: "vscode" | "default" }>(
    () => ({ editor: "vscode" }),
  ),
  assertAllowedDirectory: vi.fn<(...args: unknown[]) => { ok: true; path: string }>(() => ({
    ok: true,
    path: "",
  })),
}));

vi.mock("@/lib/open-in-editor", () => ({
  openInEditor: (input: { directory: string; file: string }) => h.openInEditor(input),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));

import { POST } from "./route";

let tmpDir: string;
let target: string;

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/files/open", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-webui-open-"));
  target = path.join(tmpDir, "src", "file.ts");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "x");
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: tmpDir });
  h.openInEditor.mockReturnValue({ editor: "vscode" });
});

describe("POST /api/files/open", () => {
  it("returns 400 for paths that would touch WebUI metadata", async () => {
    const res = await post({
      directory: tmpDir,
      path: ".leafcode/sessions.json",
    });
    expect(res.status).toBe(400);
    expect(h.openInEditor).not.toHaveBeenCalled();
  });

  it("returns 404 when the file does not exist", async () => {
    const res = await post({ directory: tmpDir, path: "src/missing.ts" });
    expect(res.status).toBe(404);
    expect(h.openInEditor).not.toHaveBeenCalled();
  });

  it("opens the file with the repository directory and absolute file path", async () => {
    const res = await post({ directory: tmpDir, path: "src/file.ts" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, editor: "vscode" });
    expect(h.openInEditor).toHaveBeenCalledWith({ directory: tmpDir, file: target });
  });

  it("propagates the editor used by the launcher", async () => {
    h.openInEditor.mockReturnValue({ editor: "default" });
    const res = await post({ directory: tmpDir, path: "src/file.ts" });
    expect(await res.json()).toMatchObject({ editor: "default" });
  });

  it("rejects an absolute path", async () => {
    const res = await post({ directory: tmpDir, path: "C:\\Windows\\System32\\x.ts" });
    expect(res.status).toBe(400);
    expect(h.openInEditor).not.toHaveBeenCalled();
  });
});
