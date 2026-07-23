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

  const expectNoRootWrites = () => {
    expect(addAllowedRoot).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(tmpdir(), "roots-route-"));
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it("rejects a non-existent path with 400", async () => {
    const res = await POST(req({ path: "C:\\definitely-nonexistent-xyz" }) as never);
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });

  it("rejects a file path with 400", async () => {
    const res = await POST(req({ path: __filename }) as never);
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });

  it.each(["C:\\", "D:\\"])("rejects drive root %s with 400", async (root) => {
    const res = await POST(req({ path: root }) as never);
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });

  it("rejects C:\\Windows with 400", async () => {
    const res = await POST(req({ path: "C:\\Windows" }) as never);
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });

  it("rejects C:\\Program Files with 400", async () => {
    const res = await POST(req({ path: "C:\\Program Files" }) as never);
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });

  it.each(["C:\\Program Files (x86)", "C:\\ProgramData"])(
    "rejects %s with 400",
    async (path) => {
      const res = await POST(req({ path }) as never);
      expect(res.status).toBe(400);
      expectNoRootWrites();
    },
  );

  it("rejects the user profile root with 400", async () => {
    const res = await POST(req({ path: process.env.USERPROFILE }) as never);
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });

  it("rejects every user profile below the profile parent with 400", async () => {
    const profileParent = path.dirname(process.env.USERPROFILE!);
    const res = await POST(req({ path: path.join(profileParent, "other-user") }) as never);
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });

  it("rejects the localhost admin-share UNC alias with 400", async () => {
    const res = await POST(
      req({ path: "\\\\localhost\\C$\\Windows" }) as never,
    );
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });

  it("accepts a valid temporary directory and stores its canonical path", async () => {
    const res = await POST(req({ path: tempRoot }) as never);
    expect(res.status).toBe(200);
    expect(addAllowedRoot).toHaveBeenCalledWith(fs.realpathSync.native(tempRoot));
    expect(setSetting).toHaveBeenCalledWith("lastDirectory", fs.realpathSync.native(tempRoot));
  });

  it("registers the canonical target of a symlink to an allowed directory", async () => {
    const target = path.join(tempRoot, "allowed-target");
    const link = path.join(tempRoot, "allowed-link");
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, "junction");

    const res = await POST(req({ path: link }) as never);
    expect(res.status).toBe(200);
    expect(addAllowedRoot).toHaveBeenCalledWith(fs.realpathSync.native(target));
    expect(setSetting).toHaveBeenCalledWith(
      "lastDirectory",
      fs.realpathSync.native(target),
    );
  });

  it("rejects a protected directory reached through an intermediate junction", async () => {
    const link = path.join(tempRoot, "windows-link");
    fs.symlinkSync(process.env.SystemRoot ?? "C:\\Windows", link, "junction");

    const res = await POST(req({ path: path.join(link, "System32") }) as never);
    expect(res.status).toBe(400);
    expectNoRootWrites();
  });
});
