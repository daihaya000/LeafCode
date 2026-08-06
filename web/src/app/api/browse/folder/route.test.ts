import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifySession } = vi.hoisted(() => ({ verifySession: vi.fn() }));

vi.mock("@/lib/session", () => ({
  verifySession,
  SESSION_COOKIE: "webui_session",
  sessionTokenFromCookieHeader: vi.fn(),
}));

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ default: { spawn }, spawn }));

const LOCAL = "127.0.0.1:3000";
/** The host's own LAN address — a browser on the host PC may well use this. */
const HOST_LAN = "192.168.0.102:3000";

function req(host: string, extra: Record<string, string> = {}) {
  return new NextRequest("http://127.0.0.1:3000/api/browse/folder", {
    method: "POST",
    headers: { host, "content-type": "application/json", ...extra },
    body: JSON.stringify({ title: "選択" }),
  });
}

/** Fake PowerShell child. `hang: true` never closes, simulating an unattended dialog. */
function stubPicker({ emit = "", hang = false } = {}) {
  const killed: boolean[] = [];
  spawn.mockImplementation(() => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const push = (key: string, cb: (...a: unknown[]) => void) => {
      (handlers[key] ??= []).push(cb);
    };
    const child = {
      stdout: { on: (e: string, cb: () => void) => push(`stdout:${e}`, cb) },
      stderr: { on: (e: string, cb: () => void) => push(`stderr:${e}`, cb) },
      on: (e: string, cb: () => void) => push(e, cb),
      kill: () => killed.push(true),
    };
    if (!hang) {
      setImmediate(() => {
        if (emit) handlers["stdout:data"]?.forEach((cb) => cb(emit));
        handlers["close"]?.forEach((cb) => cb(0));
      });
    }
    return child;
  });
  return { killed };
}

async function loadRoute() {
  vi.resetModules();
  return (await import("./route")).POST;
}

describe("POST /api/browse/folder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifySession.mockResolvedValue(null);
  });

  it("rejects an unauthenticated LAN caller", async () => {
    stubPicker();
    const POST = await loadRoute();
    const res = await POST(req(HOST_LAN));
    expect(res.status).toBe(403);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("allows the host's own LAN address once signed in", async () => {
    // The case this feature exists for: the browser is on the host PC but
    // reached the WebUI through 192.168.x.x, so the dialog IS visible.
    verifySession.mockResolvedValue({ username: "alice" });
    stubPicker({ emit: "C:\\definitely\\missing\\path\n" });
    const POST = await loadRoute();

    const res = await POST(req(HOST_LAN, { cookie: "webui_session=tok" }));
    expect(spawn).toHaveBeenCalledTimes(1);
    // Past the guard: a non-existent path is a 400, never a 403.
    expect(res.status).not.toBe(403);
  });

  it("still allows a direct loopback caller with no session", async () => {
    stubPicker({ emit: "C:\\definitely\\missing\\path\n" });
    const POST = await loadRoute();

    const res = await POST(req(LOCAL));
    expect(res.status).not.toBe(403);
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("reports cancellation when the dialog returns nothing", async () => {
    stubPicker({ emit: "" });
    const POST = await loadRoute();

    const res = await POST(req(LOCAL));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true });
  });

  it("refuses a second dialog while one is already open", async () => {
    vi.useFakeTimers();
    try {
      verifySession.mockResolvedValue({ username: "alice" });
      stubPicker({ hang: true });
      const POST = await loadRoute();

      // Leave the first dialog pending, then ask again.
      const first = POST(req(LOCAL));
      await vi.advanceTimersByTimeAsync(1);
      const second = await POST(req(HOST_LAN, { cookie: "webui_session=tok" }));

      expect(second.status).toBe(409);
      expect((await second.json()).reason).toBe("picker_busy");
      expect(spawn).toHaveBeenCalledTimes(1);

      // Let the first request finish so nothing is left dangling.
      await vi.advanceTimersByTimeAsync(300_000);
      expect((await first).status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a remote caller a short wait and explains the unattended dialog", async () => {
    vi.useFakeTimers();
    try {
      verifySession.mockResolvedValue({ username: "alice" });
      const { killed } = stubPicker({ hang: true });
      const POST = await loadRoute();

      const pending = POST(req(HOST_LAN, { cookie: "webui_session=tok" }));
      // Remote budget is 60s, far below the 290s loopback budget.
      await vi.advanceTimersByTimeAsync(61_000);
      const res = await pending;

      expect(res.status).toBe(504);
      const body = await res.json();
      expect(body.reason).toBe("dialog_unattended");
      expect(body.error).toContain("ホストPCの画面");
      expect(killed.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out a loopback caller at the remote budget", async () => {
    vi.useFakeTimers();
    try {
      stubPicker({ hang: true });
      const POST = await loadRoute();

      const pending = POST(req(LOCAL));
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(61_000);
      expect(settled).toBe(false);

      // The host-side budget is much longer, so the dialog is still waiting.
      await vi.advanceTimersByTimeAsync(240_000);
      const res = await pending;
      expect(res.status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees the in-flight lock after a failure so the next attempt works", async () => {
    vi.useFakeTimers();
    try {
      verifySession.mockResolvedValue({ username: "alice" });
      stubPicker({ hang: true });
      const POST = await loadRoute();

      const first = POST(req(HOST_LAN, { cookie: "webui_session=tok" }));
      await vi.advanceTimersByTimeAsync(61_000);
      expect((await first).status).toBe(504);

      stubPicker({ emit: "" });
      const pending = POST(req(HOST_LAN, { cookie: "webui_session=tok" }));
      await vi.advanceTimersByTimeAsync(1);
      const second = await pending;
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ cancelled: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
