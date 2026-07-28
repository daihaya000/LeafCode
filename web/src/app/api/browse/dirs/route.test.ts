import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/quickaccess", () => ({
  listQuickAccess: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn((dir: string) => ({ ok: true, path: dir })),
}));

import { GET } from "./route";
import { assertAllowedDirectory } from "@/lib/allowlist";

type EntryBody = {
  entries: { name: string; path: string; kind?: string }[];
};

/** Build a NextRequest that looks like a direct loopback call (host-only). */
function localRequest(url: string): NextRequest {
  return new NextRequest(url, { headers: { host: "localhost:3000" } });
}

/** Build a NextRequest that looks like a LAN client (non-loopback Host). */
function lanRequest(url: string): NextRequest {
  return new NextRequest(url, { headers: { host: "192.168.0.55:3000" } });
}

describe("GET /api/browse/dirs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects non-loopback callers (local-only guard)", async () => {
    const response = await GET(lanRequest("http://localhost/api/browse/dirs"));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("host machine");
  });

  it("returns the folder listing when Quick Access never resolves", async () => {
    vi.useFakeTimers();
    const responsePromise = GET(
      localRequest("http://localhost/api/browse/dirs"),
    );

    await vi.advanceTimersByTimeAsync(751);
    const response = await responsePromise;
    const body = (await response.json()) as {
      path: string;
      quickAccess: unknown[];
      entries: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.path).toBeTruthy();
    expect(body.quickAccess).toEqual([]);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("lists directories only by default and includes files with files=1", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "browse-dirs-"));
    fs.mkdirSync(path.join(base, "sub"));
    fs.writeFileSync(path.join(base, "note.txt"), "hi");
    try {
      const dirsOnly = (await (
        await GET(
          localRequest(
            `http://localhost/api/browse/dirs?path=${encodeURIComponent(base)}`,
          ),
        )
      ).json()) as EntryBody;
      expect(dirsOnly.entries.map((e) => e.name)).toContain("sub");
      expect(dirsOnly.entries.map((e) => e.name)).not.toContain("note.txt");

      const withFiles = (await (
        await GET(
          localRequest(
            `http://localhost/api/browse/dirs?path=${encodeURIComponent(base)}&files=1`,
          ),
        )
      ).json()) as EntryBody;
      const file = withFiles.entries.find((e) => e.name === "note.txt");
      expect(file?.kind).toBe("file");
      // Directories still sort before files.
      const names = withFiles.entries.map((e) => e.name);
      expect(names.indexOf("sub")).toBeLessThan(names.indexOf("note.txt"));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects files=1 requests outside allowlisted roots (R20)", async () => {
    vi.mocked(assertAllowedDirectory).mockReturnValueOnce({
      ok: false,
      error: "directory not allowlisted",
      status: 403,
    });

    const response = await GET(
      localRequest(
        `http://localhost/api/browse/dirs?path=${encodeURIComponent("/etc")}&files=1`,
      ),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("directory not allowlisted");
  });
});
