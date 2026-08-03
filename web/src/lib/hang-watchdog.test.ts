import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageWithParts } from "./types";

const { ocServer } = vi.hoisted(() => ({ ocServer: vi.fn() }));
vi.mock("./oc-server", () => ({ ocServer }));

const dataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-hang-watchdog-"));
process.env.APPDATA = dataDir;

const { getDb, setSetting } = await import("./db");
const { HANG_RETRY_METADATA_KEY } = await import("./hang-retry");
const {
  HANG_CONFIRM_GRACE_MS,
  MAX_WATCH_BODY_BYTES,
  armHangWatch,
  disarmHangWatch,
  estimateWatchBodyBytes,
  getHangWatch,
  hangTimeoutMs,
  latestActivityAt,
  progressFingerprint,
  recoverInterruptedHangWatches,
  runHangWatchdogTick,
  setHangWatchdogIdleWaitForTests,
} = await import("./hang-watchdog");

const DIR = "C:\\work\\repo";
const SESSION = "ses_abc";
const TIMEOUT_MS = 300_000;

type Call = { directory: string | null; path: string; init?: { method?: string; body?: unknown } };

function calls(): Call[] {
  return ocServer.mock.calls.map(([directory, requestPath, init]) => ({
    directory,
    path: requestPath,
    init,
  })) as Call[];
}

function callsTo(suffix: string): Call[] {
  return calls().filter((call) => call.path.endsWith(suffix));
}

function busyStatus() {
  return { [SESSION]: { type: "busy" } };
}

/** A transcript whose newest timestamp is `activityAt`. */
function transcript(activityAt: number, text = "working"): MessageWithParts[] {
  return [
    {
      info: { id: "msg_1", role: "assistant", time: { created: activityAt - 1_000 } },
      parts: [
        {
          id: "prt_1",
          messageID: "msg_1",
          type: "tool",
          tool: "bash",
          state: { status: "running", time: { start: activityAt } },
        },
        { id: "prt_2", messageID: "msg_1", type: "text", text },
      ],
    },
  ];
}

function arm(overrides?: Partial<{ startedAt: number; body: unknown; requestPath: string }>) {
  armHangWatch({
    sessionId: SESSION,
    directory: DIR,
    requestPath: overrides?.requestPath ?? `/session/${SESSION}/prompt_async`,
    body: overrides?.body ?? { parts: [{ type: "text", text: "go" }], agent: "build" },
    timeoutMs: 60_000,
    startedAt: overrides?.startedAt ?? Date.now(),
  });
}

/**
 * Transcript activity older than `started_at`, so `latestActivityAt` never wins
 * over the (deterministic) watch timestamps and the tests cannot race the clock.
 */
function staleActivityAt(): number {
  return Date.now() - TIMEOUT_MS - 60_000;
}

/** Move the watch back in time so the next tick treats it as over threshold. */
function ageWatch(byMs: number): void {
  const row = getHangWatch(SESSION)!;
  getDb()
    .prepare(
      "UPDATE session_hang_watches SET started_at = ?, last_progress_at = ? WHERE session_id = ?",
    )
    .run(row.started_at - byMs, row.last_progress_at - byMs, SESSION);
}

beforeEach(() => {
  ocServer.mockReset();
  getDb().prepare("DELETE FROM session_hang_watches").run();
  setSetting("hang-timeout", String(TIMEOUT_MS));
  setHangWatchdogIdleWaitForTests(2, 0);
});

describe("armHangWatch", () => {
  it("stores the request and resets the resume budget on a new send", () => {
    arm();
    getDb().prepare("UPDATE session_hang_watches SET retry_used = 1 WHERE session_id = ?").run(SESSION);
    arm();
    const row = getHangWatch(SESSION)!;
    expect(row.retry_used).toBe(0);
    expect(row.state).toBe("armed");
    expect(row.resume_allowed).toBe(1);
    expect(JSON.parse(row.request_body)).toEqual({
      parts: [{ type: "text", text: "go" }],
      agent: "build",
    });
  });

  it("keeps the spent resume budget when the body is already a hang retry", () => {
    arm();
    getDb().prepare("UPDATE session_hang_watches SET retry_used = 1 WHERE session_id = ?").run(SESSION);
    arm({
      body: {
        parts: [{ type: "text", text: "go", metadata: { [HANG_RETRY_METADATA_KEY]: true } }],
      },
    });
    expect(getHangWatch(SESSION)!.retry_used).toBe(1);
  });

  it("refuses to store an oversized body but still watches the turn", () => {
    arm({
      body: {
        parts: [
          { type: "text", text: "go" },
          { type: "file", mime: "image/png", url: "x".repeat(MAX_WATCH_BODY_BYTES + 1) },
        ],
      },
    });
    const row = getHangWatch(SESSION)!;
    expect(row.resume_allowed).toBe(0);
    expect(row.request_body).toBe("{}");
  });

  it("ignores blank identifiers", () => {
    armHangWatch({ sessionId: "  ", directory: DIR, requestPath: "/x", body: {}, timeoutMs: 1_000 });
    expect(getHangWatch("  ")).toBeNull();
  });

  it("disarms on demand", () => {
    arm();
    disarmHangWatch(SESSION);
    expect(getHangWatch(SESSION)).toBeNull();
  });
});

describe("hangTimeoutMs", () => {
  it("reads and clamps the stored setting", () => {
    setSetting("hang-timeout", "120000");
    expect(hangTimeoutMs()).toBe(120_000);
    setSetting("hang-timeout", "1");
    expect(hangTimeoutMs()).toBe(10_000);
    setSetting("hang-timeout", "99999999");
    expect(hangTimeoutMs()).toBe(30 * 60_000);
    setSetting("hang-timeout", "nonsense");
    expect(hangTimeoutMs()).toBe(5 * 60_000);
  });
});

describe("activity helpers", () => {
  it("takes the newest timestamp anywhere in the transcript", () => {
    expect(latestActivityAt(transcript(5_000))).toBe(5_000);
    expect(latestActivityAt([])).toBe(0);
  });

  it("fingerprints message/part counts and text length", () => {
    expect(progressFingerprint(transcript(1_000, "ab"))).toBe("1:2:2");
    expect(progressFingerprint(transcript(1_000, "abcd"))).toBe("1:2:4");
  });

  it("estimates only the fields that can be large", () => {
    expect(estimateWatchBodyBytes({ parts: [{ type: "text", text: "abc" }] })).toBe(3);
    expect(estimateWatchBodyBytes({ prompt: { files: [{ uri: "abcd" }] } })).toBe(4);
    expect(estimateWatchBodyBytes(null)).toBe(0);
  });
});

describe("runHangWatchdogTick", () => {
  it("does nothing while the turn is inside the threshold", async () => {
    arm();
    ocServer.mockResolvedValue(busyStatus());
    await runHangWatchdogTick();
    expect(callsTo("/abort")).toHaveLength(0);
    expect(getHangWatch(SESSION)).not.toBeNull();
  });

  it("drops the watch once the engine is no longer busy", async () => {
    arm();
    ocServer.mockResolvedValue({});
    await runHangWatchdogTick();
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("leaves the watch alone when /session/status is unreachable", async () => {
    arm();
    ocServer.mockRejectedValue(new Error("engine down"));
    await runHangWatchdogTick();
    expect(getHangWatch(SESSION)).not.toBeNull();
    expect(callsTo("/abort")).toHaveLength(0);
  });

  it("re-arms with a short grace on the first over-threshold confirmation", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    ocServer.mockImplementation(async (_dir: string, requestPath: string) =>
      requestPath.endsWith("/message") ? transcript(stale) : busyStatus(),
    );
    await runHangWatchdogTick();
    expect(callsTo("/abort")).toHaveLength(0);
    const row = getHangWatch(SESSION)!;
    expect(row.progress_fingerprint).not.toBe("");
    expect(row.last_progress_at).toBeGreaterThan(Date.now() - TIMEOUT_MS);
    expect(row.last_progress_at).toBeLessThanOrEqual(Date.now() - TIMEOUT_MS + HANG_CONFIRM_GRACE_MS);
  });

  it("does not stop a turn that is still making progress", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    let text = "ab";
    const stale = staleActivityAt();
    ocServer.mockImplementation(async (_dir: string, requestPath: string) =>
      requestPath.endsWith("/message") ? transcript(stale, text) : busyStatus(),
    );
    // First pass records the fingerprint, second pass sees new streamed text.
    await runHangWatchdogTick();
    ageWatch(HANG_CONFIRM_GRACE_MS + 1_000);
    text = "abcdef";
    await runHangWatchdogTick();
    expect(callsTo("/abort")).toHaveLength(0);
    expect(getHangWatch(SESSION)).not.toBeNull();
  });

  it("stops and resumes the same request exactly once", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    let busy = true;
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) return transcript(stale);
      if (requestPath.endsWith("/abort")) {
        busy = false;
        return {};
      }
      if (requestPath.endsWith("/prompt_async")) return {};
      return busy ? busyStatus() : {};
    });

    await runHangWatchdogTick();
    ageWatch(HANG_CONFIRM_GRACE_MS + 1_000);
    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(1);
    const resumes = callsTo("/prompt_async");
    expect(resumes).toHaveLength(1);
    expect(resumes[0].init?.method).toBe("POST");
    expect(resumes[0].init?.body).toEqual({
      agent: "build",
      parts: [{ type: "text", text: "go", metadata: { [HANG_RETRY_METADATA_KEY]: true } }],
    });
    const row = getHangWatch(SESSION)!;
    expect(row.retry_used).toBe(1);
    expect(row.state).toBe("armed");
  });

  it("only stops the second hang of the same turn", async () => {
    arm();
    getDb().prepare("UPDATE session_hang_watches SET retry_used = 1 WHERE session_id = ?").run(SESSION);
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    let busy = true;
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) return transcript(stale);
      if (requestPath.endsWith("/abort")) {
        busy = false;
        return {};
      }
      return busy ? busyStatus() : {};
    });

    await runHangWatchdogTick();
    ageWatch(HANG_CONFIRM_GRACE_MS + 1_000);
    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(1);
    expect(callsTo("/prompt_async")).toHaveLength(0);
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("stops without resuming when the body was not stored", async () => {
    arm({
      body: {
        parts: [{ type: "file", mime: "image/png", url: "x".repeat(MAX_WATCH_BODY_BYTES + 1) }],
      },
    });
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    let busy = true;
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) return transcript(stale);
      if (requestPath.endsWith("/abort")) {
        busy = false;
        return {};
      }
      return busy ? busyStatus() : {};
    });

    await runHangWatchdogTick();
    ageWatch(HANG_CONFIRM_GRACE_MS + 1_000);
    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(1);
    expect(callsTo("/prompt_async")).toHaveLength(0);
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("re-arms when the session stays busy after the abort", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    ocServer.mockImplementation(async (_dir: string, requestPath: string) =>
      requestPath.endsWith("/message") ? transcript(stale) : busyStatus(),
    );

    await runHangWatchdogTick();
    ageWatch(HANG_CONFIRM_GRACE_MS + 1_000);
    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(1);
    expect(callsTo("/prompt_async")).toHaveLength(0);
    expect(getHangWatch(SESSION)!.state).toBe("armed");
  });
});

describe("recoverInterruptedHangWatches", () => {
  it("puts a mid-resolve watch back under watch", () => {
    arm();
    getDb().prepare("UPDATE session_hang_watches SET state = 'resolving' WHERE session_id = ?").run(SESSION);
    recoverInterruptedHangWatches();
    expect(getHangWatch(SESSION)!.state).toBe("armed");
  });
});
