import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/quickaccess", () => ({
  listQuickAccess: vi.fn(() => new Promise(() => {})),
}));

import { GET } from "./route";

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
});
