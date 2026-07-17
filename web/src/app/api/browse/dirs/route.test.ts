import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/quickaccess", () => ({
  listQuickAccess: vi.fn(() => new Promise(() => {})),
}));

import { GET } from "./route";

type EntryBody = {
  entries: { name: string; path: string; kind?: string }[];
};

describe("GET /api/browse/dirs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the folder listing when Quick Access never resolves", async () => {
    vi.useFakeTimers();
    const responsePromise = GET(
      new NextRequest("http://localhost/api/browse/dirs"),
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
          new NextRequest(
            `http://localhost/api/browse/dirs?path=${encodeURIComponent(base)}`,
          ),
        )
      ).json()) as EntryBody;
      expect(dirsOnly.entries.map((e) => e.name)).toContain("sub");
      expect(dirsOnly.entries.map((e) => e.name)).not.toContain("note.txt");

      const withFiles = (await (
        await GET(
          new NextRequest(
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
});
