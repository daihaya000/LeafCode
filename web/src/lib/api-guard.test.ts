import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifySession } = vi.hoisted(() => ({ verifySession: vi.fn() }));

vi.mock("@/lib/session", () => ({
  verifySession,
  SESSION_COOKIE: "webui_session",
  sessionTokenFromCookieHeader: vi.fn(),
}));

import {
  allowedOrigins,
  rejectCrossSite,
  requireAuthorized,
  requireHostMachine,
} from "./api-guard";

const LOOPBACK = "127.0.0.1:3000";
const HOST_LAN = "192.168.0.102:8443";

function make(
  method: string,
  headers: Record<string, string>,
  host = LOOPBACK,
): Request {
  return new Request("http://127.0.0.1:3000/api/thing", {
    method,
    headers: { host, ...headers },
    ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
  });
}

beforeEach(() => {
  verifySession.mockReset();
  verifySession.mockResolvedValue(null);
  delete process.env.OPENCODE_WEBUI_ALLOWED_ORIGINS;
});

describe("allowedOrigins", () => {
  it("derives both schemes from the request Host", () => {
    expect(allowedOrigins(make("GET", {}, HOST_LAN))).toEqual(
      expect.arrayContaining([`http://${HOST_LAN}`, `https://${HOST_LAN}`]),
    );
  });

  it("includes configured extra origins", () => {
    process.env.OPENCODE_WEBUI_ALLOWED_ORIGINS =
      "https://webui.example.com, https://other.test/";
    const origins = allowedOrigins(make("GET", {}));
    expect(origins).toContain("https://webui.example.com");
    // Trailing slashes are normalised away.
    expect(origins).toContain("https://other.test");
  });
});

describe("rejectCrossSite", () => {
  it("ignores safe methods", () => {
    expect(rejectCrossSite(make("GET", { origin: "https://evil.test" }))).toBeNull();
    expect(
      rejectCrossSite(
        new Request("http://127.0.0.1:3000/api/thing", {
          method: "HEAD",
          headers: { host: LOOPBACK, origin: "https://evil.test" },
        }),
      ),
    ).toBeNull();
  });

  it("blocks a state-changing request from another site", () => {
    // The drive-by case: a page on evil.test posting to 127.0.0.1.
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = rejectCrossSite(make(method, { origin: "https://evil.test" }));
      expect(res?.status).toBe(403);
    }
  });

  it("blocks on Sec-Fetch-Site even when Origin looks acceptable", () => {
    const res = rejectCrossSite(
      make("POST", {
        origin: `http://${LOOPBACK}`,
        "sec-fetch-site": "cross-site",
      }),
    );
    expect(res?.status).toBe(403);
  });

  it("allows a same-origin request", () => {
    expect(
      rejectCrossSite(make("POST", { origin: `http://${LOOPBACK}` })),
    ).toBeNull();
  });

  it("allows the https origin behind a same-host reverse proxy", () => {
    expect(
      rejectCrossSite(
        make("POST", { origin: `https://${HOST_LAN}` }, HOST_LAN),
      ),
    ).toBeNull();
  });

  it("allows a same-host origin on a different port", () => {
    // Caddy on :8443 fronting Next on :3000 keeps the host but changes the port.
    expect(
      rejectCrossSite(
        make("POST", { origin: "https://192.168.0.102:8443" }, "192.168.0.102:3000"),
      ),
    ).toBeNull();
  });

  it("allows a missing Origin so non-browser clients still work", () => {
    // Browsers always send Origin on state-changing requests, so absence means
    // curl / scripts, which the authorization check still has to clear.
    expect(rejectCrossSite(make("POST", {}))).toBeNull();
  });

  it("blocks an opaque Origin: null", () => {
    expect(rejectCrossSite(make("POST", { origin: "null" }))?.status).toBe(403);
  });

  it("blocks a malformed Origin", () => {
    expect(rejectCrossSite(make("POST", { origin: "http://" }))?.status).toBe(403);
  });

  it("is case-insensitive about the origin", () => {
    expect(
      rejectCrossSite(make("POST", { origin: `HTTP://${LOOPBACK.toUpperCase()}` })),
    ).toBeNull();
  });
});

describe("requireAuthorized", () => {
  it("allows a loopback GET with no credential", async () => {
    await expect(requireAuthorized(make("GET", {}))).resolves.toBeNull();
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("runs the CSRF check before authorization, even for loopback", async () => {
    // This is the whole point: loopback alone must not authorize a cross-site POST.
    const res = await requireAuthorized(make("POST", { origin: "https://evil.test" }));
    expect(res?.status).toBe(403);
    expect(await res!.json()).toMatchObject({ error: expect.stringContaining("cross-site") });
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("rejects a LAN caller with no session", async () => {
    const res = await requireAuthorized(make("GET", {}, HOST_LAN));
    expect(res?.status).toBe(403);
  });

  it("allows a LAN caller holding a verified session", async () => {
    verifySession.mockResolvedValue({ username: "alice" });
    await expect(
      requireAuthorized(make("GET", { cookie: "webui_session=tok" }, HOST_LAN)),
    ).resolves.toBeNull();
  });

  it("allows a LAN POST from our own origin with a session", async () => {
    verifySession.mockResolvedValue({ username: "alice" });
    await expect(
      requireAuthorized(
        make(
          "POST",
          { cookie: "webui_session=tok", origin: `https://${HOST_LAN}` },
          HOST_LAN,
        ),
      ),
    ).resolves.toBeNull();
  });

  it("rejects a LAN POST from our own origin without a session", async () => {
    const res = await requireAuthorized(
      make("POST", { origin: `https://${HOST_LAN}` }, HOST_LAN),
    );
    expect(res?.status).toBe(403);
    expect(await res!.json()).toMatchObject({
      error: expect.stringContaining("signed-in session"),
    });
  });

  it("does not treat a spoofed loopback Host with LAN XFF as local", async () => {
    const res = await requireAuthorized(
      make("GET", { "x-forwarded-for": "192.168.0.9" }),
    );
    expect(res?.status).toBe(403);
  });
});

describe("requireHostMachine", () => {
  it("allows loopback", async () => {
    await expect(requireHostMachine(make("GET", {}))).resolves.toBeNull();
  });

  it("rejects a LAN caller even with a verified session", async () => {
    verifySession.mockResolvedValue({ username: "alice" });
    const res = await requireHostMachine(
      make("GET", { cookie: "webui_session=tok" }, HOST_LAN),
    );
    expect(res?.status).toBe(403);
  });

  it("still applies the CSRF check", async () => {
    const res = await requireHostMachine(
      make("POST", { origin: "https://evil.test" }),
    );
    expect(res?.status).toBe(403);
  });
});
