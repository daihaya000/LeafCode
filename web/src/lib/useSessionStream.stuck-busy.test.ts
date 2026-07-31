import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * Regression: a task whose turn had finished kept rendering as "working"
 * (実行中 / composer locked) until the user reloaded the browser. The engine's
 * terminal `session.idle` event can be lost while the SSE connection keeps
 * heartbeating, and `/session/status` omits sessions the engine no longer
 * tracks — so the periodic REST reconcile had no way to clear the local busy
 * state. See `resolveResyncStatus` (stuck-busy recovery).
 */

const ocJson = vi.fn();

vi.mock("./client", () => ({
  apiUrl: (path: string) => path,
  ocJson: (...args: unknown[]) => ocJson(...args),
  ocFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

type Listener = (ev: { data: string }) => void;

class FakeEventSource {
  static readonly OPEN = 1;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: Listener | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

const DIRECTORY = "/repo";
const SESSION = "sess-1";

/** Status map returned by `/session/status`; empty means "not tracked". */
let statusMap: Record<string, { type: string }> = {};

function installOcJson() {
  ocJson.mockImplementation(async (path: string) => {
    if (path === "/session/status") return statusMap;
    if (path.startsWith(`/session/${SESSION}/prompt_async`)) return {};
    if (path.startsWith(`/session/${SESSION}/command`)) return {};
    if (path === `/session/${SESSION}/message`) return [];
    if (path === `/session/${SESSION}/todo`) return [];
    if (path === `/session/${SESSION}`) return { revert: null };
    if (path === "/permission" || path === "/question") return [];
    if (path.startsWith("/api/session/")) return [];
    return {};
  });
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useSessionStream stuck-busy recovery", () => {
  beforeEach(() => {
    statusMap = {};
    FakeEventSource.instances = [];
    installOcJson();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    ocJson.mockReset();
  });

  it("clears a busy state the engine already finished, without a browser reload", async () => {
    const { useSessionStream, ACTIVE_SESSION_RECONCILE_MS, STUCK_BUSY_QUIET_MS } =
      await import("./useSessionStream");

    statusMap = { [SESSION]: { type: "busy" } };
    const { result } = renderHook(() => useSessionStream(DIRECTORY, SESSION));
    await flush();

    const es = FakeEventSource.instances[0]!;
    await act(async () => {
      es.onopen?.();
    });
    await flush();
    expect(result.current.connection).toBe("live");

    // Engine reports busy over SSE, then finishes without emitting the
    // terminal idle event (and drops the session from /session/status).
    await act(async () => {
      es.onmessage?.({
        data: JSON.stringify({
          type: "session.status",
          properties: { sessionID: SESSION, status: { type: "busy" } },
        }),
      });
    });
    expect(result.current.status?.type).toBe("busy");

    statusMap = {};
    // Mid-turn tolerance: a couple of reconciles must not unlock early.
    await flush(ACTIVE_SESSION_RECONCILE_MS * 2);
    expect(result.current.status?.type).toBe("busy");

    // After sustained REST idle + SSE silence the stale busy is dropped.
    await flush(STUCK_BUSY_QUIET_MS + ACTIVE_SESSION_RECONCILE_MS * 2);
    expect(result.current.status?.type).toBe("idle");
    expect(result.current.connection).toBe("live");
  });

  it("keeps the busy state while session-scoped SSE events keep arriving", async () => {
    const { useSessionStream, ACTIVE_SESSION_RECONCILE_MS, STUCK_BUSY_QUIET_MS } =
      await import("./useSessionStream");

    statusMap = { [SESSION]: { type: "busy" } };
    const { result } = renderHook(() => useSessionStream(DIRECTORY, SESSION));
    await flush();

    const es = FakeEventSource.instances[0]!;
    await act(async () => {
      es.onopen?.();
      es.onmessage?.({
        data: JSON.stringify({
          type: "session.status",
          properties: { sessionID: SESSION, status: { type: "busy" } },
        }),
      });
    });
    expect(result.current.status?.type).toBe("busy");

    // REST lags to idle mid-turn, but the session is clearly still streaming.
    statusMap = { [SESSION]: { type: "idle" } };
    for (let i = 0; i < 10; i += 1) {
      await act(async () => {
        es.onmessage?.({
          data: JSON.stringify({
            type: "message.part.updated",
            properties: {
              sessionID: SESSION,
              part: {
                id: `p${i}`,
                messageID: "m1",
                sessionID: SESSION,
                type: "text",
                text: `chunk ${i}`,
              },
            },
          }),
        });
      });
      await flush(Math.max(ACTIVE_SESSION_RECONCILE_MS, STUCK_BUSY_QUIET_MS / 4));
    }
    expect(result.current.status?.type).toBe("busy");
  });

  it("unlocks a pending mutation when the engine drops the session and SSE stays silent", async () => {
    const {
      useSessionStream,
      ACTIVE_SESSION_RECONCILE_MS,
      MUTATION_LOST_EVENT_GRACE_MS,
    } = await import("./useSessionStream");

    statusMap = {};
    const { result } = renderHook(() => useSessionStream(DIRECTORY, SESSION));
    await flush();

    const es = FakeEventSource.instances[0]!;
    await act(async () => {
      es.onopen?.();
    });
    await flush();

    // User sends a prompt; SSE session.status busy arrives, then terminal idle
    // is lost (engine drops the session from /session/status before emitting).
    await act(async () => {
      es.onmessage?.({
        data: JSON.stringify({
          type: "session.status",
          properties: { sessionID: SESSION, status: { type: "busy" } },
        }),
      });
    });
    expect(result.current.status?.type).toBe("busy");

    await act(async () => {
      void result.current.sendPrompt("hello");
    });
    // sendPrompt immediately re-broadcasts busy and resets the grace window.
    await flush();
    expect(result.current.status?.type).toBe("busy");

    // Before the grace period ends, the engine has dropped the session and no
    // further SSE events arrive. Reconciles must not unlock early.
    await flush(MUTATION_LOST_EVENT_GRACE_MS - ACTIVE_SESSION_RECONCILE_MS);
    expect(result.current.status?.type).toBe("busy");

    // Once the grace has elapsed, the next reconcile sees the missing key and
    // synthesizes idle, clearing the pending-mutation lock.
    await flush(ACTIVE_SESSION_RECONCILE_MS * 2);
    expect(result.current.status?.type).toBe("idle");
  });
});
