import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

vi.mock("@/lib/db", () => ({
  addAllowedRoot: vi.fn(),
  listAllowedRoots: vi.fn(() => []),
  setSetting: vi.fn(),
}));
vi.mock("@/lib/allowlist", () => ({
  realPathOrResolved: (p: string) => p,
}));

import { addAllowedRoot, setSetting } from "@/lib/db";
import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/roots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/roots path validation", () => {
  let tempRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(tmpdir(), "roots-route-"));
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it("rejects a non-existent path with 400", async () => {
    const res = await POST(req({ path: "C:\\definitely-nonexistent-xyz" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects a file path with 400", async () => {
    const res = await POST(req({ path: __filename }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects Windows drive root with 400", async () => {
    const res = await POST(req({ path: "C:\\" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects C:\\Windows with 400", async () => {
    const res = await POST(req({ path: "C:\\Windows" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects C:\\Program Files with 400", async () => {
    const res = await POST(req({ path: "C:\\Program Files" }) as never);
    expect(res.status).toBe(400);
  });

  it.each(["C:\\Program Files (x86)", "C:\\ProgramData"])(
    "rejects %s with 400",
    async (path) => {
      const res = await POST(req({ path }) as never);
      expect(res.status).toBe(400);
    },
  );

  it("rejects the user profile root with 400", async () => {
    const res = await POST(req({ path: process.env.USERPROFILE }) as never);
    expect(res.status).toBe(400);
  });

  it("accepts a valid temporary directory and stores its canonical path", async () => {
    const res = await POST(req({ path: tempRoot }) as never);
    expect(res.status).toBe(200);
    expect(addAllowedRoot).toHaveBeenCalledWith(fs.realpathSync.native(tempRoot));
    expect(setSetting).toHaveBeenCalledWith("lastDirectory", fs.realpathSync.native(tempRoot));
  });

  it("rejects a directory symlink whose target is protected", async () => {
    const link = path.join(tempRoot, "windows-link");
    fs.symlinkSync(process.env.SystemRoot ?? "C:\\Windows", link, "junction");

    const res = await POST(req({ path: link }) as never);
    expect(res.status).toBe(400);
    expect(addAllowedRoot).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });
});
