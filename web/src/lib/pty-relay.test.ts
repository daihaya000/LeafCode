import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireRelay,
  decodePtyFrame,
  deleteRelay,
  getRelay,
  relayRegistry,
  releaseRelay,
  setRelay,
  type PtyRelay,
} from "./pty-relay";

/** Minimal WebSocket stand-in; acquireRelay only stores it and may close it. */
function fakeWs(): WebSocket {
  return {
    close: vi.fn(),
    addEventListener: vi.fn(),
    send: vi.fn(),
  } as unknown as WebSocket;
}

afterEach(() => {
  relayRegistry().clear();
});

describe("acquireRelay", () => {
  it("reuses an existing live relay without reconnecting", async () => {
    const ws = fakeWs();
    const existing: PtyRelay = { ws, refcount: 1, listeners: new Set(), closed: false };
    setRelay("pty_1", existing);

    const connect = vi.fn();
    const attach = vi.fn();
    const relay = await acquireRelay("pty_1", connect, attach);

    expect(relay).toBe(existing);
    expect(connect).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("dedupes concurrent callers into a single Engine connection", async () => {
    const ws = fakeWs();
    let resolveConnect!: (ws: WebSocket) => void;
    const connect = vi.fn(
      () => new Promise<WebSocket>((resolve) => { resolveConnect = resolve; }),
    );
    const attach = vi.fn();

    // Two callers race while the connection is still in flight.
    const p1 = acquireRelay("pty_1", connect, attach);
    const p2 = acquireRelay("pty_1", connect, attach);
    resolveConnect(ws);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
    expect(getRelay("pty_1")).toBe(r1);
  });

  it("runs attach exactly once and wires it to the created relay", async () => {
    const ws = fakeWs();
    const connect = vi.fn().mockResolvedValue(ws);
    const attach = vi.fn();

    const relay = await acquireRelay("pty_1", connect, attach);

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(relay);
    expect(relay.ws).toBe(ws);
    expect(relay.refcount).toBe(0);
  });

  it("clears the in-flight slot on failure so a later call can retry", async () => {
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(fakeWs());
    const attach = vi.fn();

    await expect(acquireRelay("pty_1", connect, attach)).rejects.toThrow("boom");
    expect(getRelay("pty_1")).toBeUndefined();

    // A concurrent caller shares the same rejection (no second socket opened).
    const connect2 = vi.fn().mockRejectedValue(new Error("again"));
    const a = acquireRelay("pty_1", connect2, attach);
    const b = acquireRelay("pty_1", connect2, attach);
    await expect(a).rejects.toThrow("again");
    await expect(b).rejects.toThrow("again");
    expect(connect2).toHaveBeenCalledTimes(1);

    // After the failure the slot is free; retry succeeds.
    const relay = await acquireRelay("pty_1", connect, attach);
    expect(relay).toBeDefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("discards a redundant socket if a relay appears mid-connect", async () => {
    const lateWs = fakeWs();
    const intruder: PtyRelay = { ws: fakeWs(), refcount: 0, listeners: new Set(), closed: false };
    const connect = vi.fn(async () => {
      // Simulate another code path registering a relay while we await.
      setRelay("pty_1", intruder);
      return lateWs;
    });
    const attach = vi.fn();

    const relay = await acquireRelay("pty_1", connect, attach);

    expect(relay).toBe(intruder);
    expect(lateWs.close).toHaveBeenCalledTimes(1);
    expect(attach).not.toHaveBeenCalled();
  });
});

describe("releaseRelay", () => {
  it("closes and removes the relay when refcount reaches zero", () => {
    const ws = fakeWs();
    setRelay("pty_1", { ws, refcount: 1, listeners: new Set(), closed: false });

    releaseRelay("pty_1");

    expect(getRelay("pty_1")).toBeUndefined();
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the relay alive while other tabs hold a reference", () => {
    const ws = fakeWs();
    setRelay("pty_1", { ws, refcount: 2, listeners: new Set(), closed: false });

    releaseRelay("pty_1");

    expect(getRelay("pty_1")).toBeDefined();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("is a no-op for an unknown pty id", () => {
    expect(() => releaseRelay("pty_missing")).not.toThrow();
  });
});

describe("deleteRelay", () => {
  it("removes the entry without closing the socket", () => {
    const ws = fakeWs();
    setRelay("pty_1", { ws, refcount: 0, listeners: new Set(), closed: false });

    deleteRelay("pty_1");

    expect(getRelay("pty_1")).toBeUndefined();
    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe("decodePtyFrame", () => {
  const bytes = (...n: number[]) => new Uint8Array(n).buffer;

  // Regression: the stream route used `typeof ev.data === "string" ? ev.data : ""`,
  // which silently dropped every binary frame. The Engine sends PTY output as
  // binary, so the terminal received nothing and rendered blank.
  it("decodes binary output frames to text", () => {
    const decoder = new TextDecoder("utf-8");
    const frame = new TextEncoder().encode("hello").buffer;
    expect(decodePtyFrame(frame, decoder)).toBe("hello");
  });

  it("decodes ArrayBufferView frames", () => {
    const decoder = new TextDecoder("utf-8");
    expect(decodePtyFrame(new TextEncoder().encode("hi"), decoder)).toBe("hi");
  });

  // Regression: meta frames are `0x00` + JSON bookkeeping. Writing them to
  // xterm dumped raw `{"cursor":0}` text into the terminal.
  it("skips 0x00-prefixed meta frames", () => {
    const decoder = new TextDecoder("utf-8");
    const meta = new Uint8Array([
      0,
      ...new TextEncoder().encode(JSON.stringify({ cursor: 12 })),
    ]).buffer;
    expect(decodePtyFrame(meta, decoder)).toBeNull();
  });

  it("skips meta frames delivered as strings", () => {
    const decoder = new TextDecoder("utf-8");
    expect(decodePtyFrame("\u0000{\"cursor\":1}", decoder)).toBeNull();
  });

  it("passes plain string frames through", () => {
    const decoder = new TextDecoder("utf-8");
    expect(decodePtyFrame("plain", decoder)).toBe("plain");
  });

  it("reassembles a multi-byte UTF-8 sequence split across frames", () => {
    const decoder = new TextDecoder("utf-8");
    // "あ" is E3 81 82; deliver it as two frames.
    expect(decodePtyFrame(bytes(0xe3, 0x81), decoder)).toBe("");
    expect(decodePtyFrame(bytes(0x82), decoder)).toBe("あ");
  });

  it("returns null for empty and unsupported frames", () => {
    const decoder = new TextDecoder("utf-8");
    expect(decodePtyFrame(new ArrayBuffer(0), decoder)).toBeNull();
    expect(decodePtyFrame(null, decoder)).toBeNull();
    expect(decodePtyFrame(undefined, decoder)).toBeNull();
  });
});
