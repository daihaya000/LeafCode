import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/** Loopback request so the shared API guard authorizes these handler calls. */
function localReq() {
  return new Request("http://127.0.0.1:3000/api", {
    headers: { host: "127.0.0.1:3000" },
  });
}


const ENV_KEY = "LEAFCODE_PUBLIC_URL";
const CADDY_LOCAL_ENV_KEY = "LEAFCODE_CADDY_LOCAL_URL";
let saved: string | undefined;
let savedCaddyLocal: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  savedCaddyLocal = process.env[CADDY_LOCAL_ENV_KEY];
  delete process.env[ENV_KEY];
  delete process.env[CADDY_LOCAL_ENV_KEY];
  vi.spyOn(os, "networkInterfaces").mockReturnValue({
    "Wi-Fi": [
      {
        address: "192.168.1.100",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.100/24",
      },
    ],
    Tailscale: [
      {
        address: "100.64.0.10",
        netmask: "255.192.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "100.64.0.10/10",
      },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
  if (savedCaddyLocal === undefined) delete process.env[CADDY_LOCAL_ENV_KEY];
  else process.env[CADDY_LOCAL_ENV_KEY] = savedCaddyLocal;
});

describe("GET /api/access", () => {
  it("advertises the Caddy public origin and direct URLs when set", async () => {
    process.env[ENV_KEY] = "https://webui.example.com/";
    const res = await GET(localReq());
    const body = (await res.json()) as {
      publicUrl?: string;
      addresses: { url: string; kind: string }[];
      certificateUrls: { url: string; kind: string }[];
    };
    expect(body.publicUrl).toBe("https://webui.example.com");
    expect(body.addresses).toHaveLength(4);
    expect(body.addresses[0].url).toBe("https://127.0.0.1:8443");
    expect(body.addresses[0].kind).toBe("caddy");
    expect(body.addresses[1].url).toBe("https://webui.example.com");
    expect(body.addresses.map((a) => a.url)).toContain("http://100.64.0.10:3000");
    expect(body.addresses.map((a) => a.url)).toContain("http://192.168.1.100:3000");
    expect(body.certificateUrls.map((a) => a.url)).toContain(
      "http://100.64.0.10:8080/caddy-root.crt",
    );
    expect(body.certificateUrls.map((a) => a.url)).toContain(
      "http://192.168.1.100:8080/caddy-root.crt",
    );
  });

  it("derives the loopback Caddy URL from the public HTTPS port", async () => {
    process.env[ENV_KEY] = "https://192.168.0.102:8443";
    const res = await GET(localReq());
    const body = (await res.json()) as { addresses: { url: string }[] };
    expect(body.addresses.map((address) => address.url)).toContain(
      "https://127.0.0.1:8443",
    );
  });

  it("ignores an invalid public URL and falls back to NIC addresses", async () => {
    process.env[ENV_KEY] = "not a url";
    const res = await GET(localReq());
    const body = (await res.json()) as { publicUrl?: string };
    expect(body.publicUrl).toBeUndefined();
  });

  it("returns http NIC URLs when no public URL is set", async () => {
    const res = await GET(localReq());
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
