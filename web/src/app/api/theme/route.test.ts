import { describe, expect, it } from "vitest";
import { GET } from "./route";

function themeReq(name: string | null) {
  const url =
    name === null
      ? "http://127.0.0.1:3000/api/theme"
      : `http://127.0.0.1:3000/api/theme?name=${encodeURIComponent(name)}`;
  return new Request(url, { headers: { host: "127.0.0.1:3000" } });
}

describe("GET /api/theme", () => {
  it("serves the oyster token JSON", async () => {
    const res = await GET(themeReq("oyster"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      name: string;
      tokens: Record<string, string>;
    };
    expect(body.name).toBe("oyster");
    expect(body.tokens["--bg"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(body.tokens["--text"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(body.tokens).length).toBeGreaterThan(10);
  });

  it("rejects unknown theme names", async () => {
    const res = await GET(themeReq("../../etc/passwd"));
    expect(res.status).toBe(404);
  });

  it("rejects a missing theme name", async () => {
    const res = await GET(themeReq(null));
    expect(res.status).toBe(404);
  });
});
