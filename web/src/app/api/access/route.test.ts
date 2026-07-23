import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const ENV_KEY = "OPENCODE_WEBUI_PUBLIC_URL";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("GET /api/access", () => {
  it("advertises the Caddy public origin when set", async () => {
    process.env[ENV_KEY] = "https://webui.example.com/";
    const res = await GET();
    const body = (await res.json()) as {
      publicUrl?: string;
      addresses: { url: string }[];
    };
    expect(body.publicUrl).toBe("https://webui.example.com");
    expect(body.addresses).toHaveLength(1);
    expect(body.addresses[0].url).toBe("https://webui.example.com");
  });

  it("ignores an invalid public URL and falls back to NIC addresses", async () => {
    process.env[ENV_KEY] = "not a url";
    const res = await GET();
    const body = (await res.json()) as { publicUrl?: string };
    expect(body.publicUrl).toBeUndefined();
  });

  it("returns http NIC URLs when no public URL is set", async () => {
    const res = await GET();
    const body = (await res.json()) as {
      publicUrl?: string;
      addresses: { url: string }[];
    };
    expect(body.publicUrl).toBeUndefined();
    for (const a of body.addresses) {
      expect(a.url.startsWith("http://")).toBe(true);
    }
  });
});
