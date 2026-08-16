import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OcError } from "./oc-server";
import type { MessageWithParts } from "./types";

const { ocServer } = vi.hoisted(() => ({ ocServer: vi.fn() }));
vi.mock("./oc-server", async () => {
  const actual = await vi.importActual<typeof import("./oc-server")>("./oc-server");
  return { ocServer, unwrapOcData: actual.unwrapOcData, OcError: actual.OcError };
});

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
  SILENT_RESPONSE_GRACE_MS,
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

function completedTranscript(startedAt: number, text = "done"): MessageWithParts[] {
  return [
    {
      info: { id: "user_1", role: "user", time: { created: startedAt } },
      parts: [{ id: "user_part", messageID: "user_1", type: "text", text: "go" }],
    },
    {
      info: {
        id: "assistant_1",
        role: "assistant",
        time: { created: startedAt + 1, completed: startedAt + 2 },
      },
      parts: [{ id: "assistant_part", messageID: "assistant_1", type: "text", text }],
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
  it("does not classify a subagent session as hung", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath === `/session/${SESSION}`) {
        return { id: SESSION, parentID: "ses_parent" };
      }
      return busyStatus();
    });

    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(0);
    expect(callsTo("/message")).toHaveLength(0);
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("does nothing while the turn is inside the threshold", async () => {
    arm();
    ocServer.mockResolvedValue(busyStatus());
    await runHangWatchdogTick();
    expect(callsTo("/abort")).toHaveLength(0);
    expect(getHangWatch(SESSION)).not.toBeNull();
  });

  it("drops the watch once the engine is no longer busy with a response", async () => {
    arm();
    const startedAt = getHangWatch(SESSION)!.started_at;
    ocServer.mockImplementation(async (_dir: string, requestPath: string) =>
      requestPath.endsWith("/message") ? completedTranscript(startedAt) : {},
    );
    await runHangWatchdogTick();
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("drops a stale busy watch when the transcript already has a completed response", async () => {
    arm();
    const startedAt = getHangWatch(SESSION)!.started_at;
    ageWatch(TIMEOUT_MS + 1_000);
    ocServer.mockImplementation(async (_dir: string, requestPath: string) =>
      requestPath.endsWith("/message") ? completedTranscript(startedAt) : busyStatus(),
    );

    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(0);
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("drops the watch when the session no longer exists (transcript 404)", async () => {
    // Regression: a deleted/pruned session left the watch armed forever, and
    // every tick logged "could not confirm a completed response" against a
    // 404 from the engine.
    arm();
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) throw new OcError("Session not found", 404);
      return {};
    });

    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(0);
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("keeps the watch on a non-404 transcript failure (fail open)", async () => {
    arm();
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) throw new OcError("engine down", 503);
      return {};
    });

    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(0);
    expect(getHangWatch(SESSION)).not.toBeNull();
  });

  it("does not resume a finished turn that ended with finish:stop (even without text)", async () => {
    // Regression: ses_00f12ff3… finished with finish:stop then hang-watchdog
    // re-POSTed the same prompt ~10 min later.
    arm();
    const startedAt = getHangWatch(SESSION)!.started_at;
    ageWatch(TIMEOUT_MS + 1_000);
    const finished: MessageWithParts[] = [
      {
        info: { id: "user_1", role: "user", time: { created: startedAt } },
        parts: [{ id: "user_part", messageID: "user_1", type: "text", text: "go" }],
      },
      {
        info: {
          id: "assistant_1",
          role: "assistant",
          time: { created: startedAt + 1, completed: startedAt + 2 },
          finish: "stop",
        },
        parts: [
          { id: "step", messageID: "assistant_1", type: "step-start" },
          { id: "done", messageID: "assistant_1", type: "step-finish" },
        ],
      },
    ];
    ocServer.mockImplementation(async (_dir: string, requestPath: string) =>
      requestPath.endsWith("/message") ? finished : {},
    );

    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(0);
    expect(callsTo("/prompt_async")).toHaveLength(0);
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("does not resume an idle tool-only completion (assistant steps without final text)", async () => {
    arm();
    const startedAt = getHangWatch(SESSION)!.started_at;
    ageWatch(TIMEOUT_MS + 1_000);
    const toolOnly: MessageWithParts[] = [
      {
        info: { id: "user_1", role: "user", time: { created: startedAt } },
        parts: [{ id: "user_part", messageID: "user_1", type: "text", text: "go" }],
      },
      {
        info: {
          id: "assistant_1",
          role: "assistant",
          time: { created: startedAt + 1, completed: startedAt + 2 },
        },
        parts: [
          {
            id: "tool_1",
            messageID: "assistant_1",
            type: "tool",
            tool: "bash",
            state: { status: "completed", time: { start: startedAt + 1, end: startedAt + 2 } },
          },
        ],
      },
    ];
    ocServer.mockImplementation(async (_dir: string, requestPath: string) =>
      requestPath.endsWith("/message") ? toolOnly : {},
    );

    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(0);
    expect(callsTo("/prompt_async")).toHaveLength(0);
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("accepts messages wrapped as { data: [...] }", async () => {
    arm();
    const startedAt = getHangWatch(SESSION)!.started_at;
    ocServer.mockImplementation(async (_dir: string, requestPath: string) =>
      requestPath.endsWith("/message")
        ? { data: completedTranscript(startedAt) }
        : {},
    );
    await runHangWatchdogTick();
    expect(getHangWatch(SESSION)).toBeNull();
  });

  it("keeps watching an active tool across a transient idle status", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    let busy = false;
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) return transcript(stale);
      if (requestPath.endsWith("/abort")) {
        busy = false;
        return {};
      }
      if (requestPath.endsWith("/prompt_async")) return {};
      return busy ? busyStatus() : {};
    });

    // The engine reports idle while the transcript still contains a running
    // tool. The first pass records the transcript shape for confirmation.
    await runHangWatchdogTick();
    expect(getHangWatch(SESSION)).not.toBeNull();
    expect(callsTo("/abort")).toHaveLength(0);

    ageWatch(HANG_CONFIRM_GRACE_MS + 1_000);
    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(1);
    expect(callsTo("/prompt_async")).toHaveLength(1);
  });

  it("resumes an idle turn that produced no assistant response", async () => {
    arm();
    let busy = false;
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) {
        const startedAt = getHangWatch(SESSION)!.started_at;
        return [
          {
            info: { id: "user_1", role: "user", time: { created: startedAt } },
            parts: [{ id: "user_part", messageID: "user_1", type: "text", text: "go" }],
          },
        ];
      }
      if (requestPath.endsWith("/abort")) {
        busy = false;
        return {};
      }
      if (requestPath.endsWith("/prompt_async")) return {};
      return busy ? busyStatus() : {};
    });

    // The first idle observation may only be a gap between assistant steps.
    await runHangWatchdogTick();
    expect(callsTo("/abort")).toHaveLength(0);
    expect(callsTo("/prompt_async")).toHaveLength(0);
    expect(getHangWatch(SESSION)).not.toBeNull();

    ageWatch(SILENT_RESPONSE_GRACE_MS + 1_000);
    await runHangWatchdogTick();
    expect(callsTo("/abort")).toHaveLength(0);

    ageWatch(TIMEOUT_MS + 1_000);
    // The first over-threshold check only arms the short confirmation grace.
    await runHangWatchdogTick();
    expect(callsTo("/abort")).toHaveLength(0);

    ageWatch(SILENT_RESPONSE_GRACE_MS + 1_000);
    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(1);
    expect(callsTo("/prompt_async")).toHaveLength(1);
    expect(getHangWatch(SESSION)!.retry_used).toBe(1);
  });

  it("drops a stagnant reasoning-only turn without replaying the prompt", async () => {
    // An assistant row that only produced reasoning is still "activity" for this
    // turn. Replaying the original prompt would restart work that already
    // started; prefer dropping the watch over a silent auto-resume.
    arm();
    let reasoning = "first";
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) {
        const startedAt = getHangWatch(SESSION)!.started_at;
        const assistantAt = startedAt + 1_000;
        return [
          {
            info: {
              id: "user_1",
              role: "user",
              time: { created: startedAt },
            },
            parts: [{ id: "user_part", messageID: "user_1", type: "text", text: "go" }],
          },
          {
            info: {
              id: "assistant_1",
              role: "assistant",
              time: { created: assistantAt - 1_000, completed: assistantAt },
            },
            parts: [{ id: "reasoning_part", messageID: "assistant_1", type: "reasoning", text: reasoning }],
          },
        ];
      }
      return busyStatus();
    });

    ageWatch(TIMEOUT_MS + 1_000);
    reasoning = "second";
    await runHangWatchdogTick();
    expect(callsTo("/abort")).toHaveLength(0);
    expect(getHangWatch(SESSION)).toBeNull();
    expect(callsTo("/prompt_async")).toHaveLength(0);
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

  it("does not stop a turn waiting on an unanswered question", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) return transcript(stale);
      if (requestPath.endsWith(`/session/${SESSION}/question`)) {
        return [{ id: "q1", sessionID: SESSION, questions: [] }];
      }
      if (requestPath.endsWith(`/session/${SESSION}/permission`)) return [];
      if (requestPath === "/question" || requestPath.endsWith("/question")) return [];
      if (requestPath === "/permission" || requestPath.endsWith("/permission")) return [];
      return busyStatus();
    });

    // First tick records the fingerprint (grace window)…
    await runHangWatchdogTick();
    ageWatch(HANG_CONFIRM_GRACE_MS + 1_000);
    // …second tick confirms no transcript progress, but the unanswered
    // question must stop the abort from firing.
    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(0);
    const row = getHangWatch(SESSION)!;
    expect(row.state).toBe("armed");
    expect(row.last_progress_at).toBeGreaterThan(Date.now() - 1_000);
  });

  it("does not stop a turn waiting on an unanswered permission", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) return transcript(stale);
      if (requestPath.endsWith(`/session/${SESSION}/permission`)) {
        return [{ id: "p1", sessionID: SESSION, permission: "bash" }];
      }
      if (requestPath.endsWith(`/session/${SESSION}/question`)) return [];
      if (requestPath === "/question" || requestPath.endsWith("/question")) return [];
      if (requestPath === "/permission" || requestPath.endsWith("/permission")) return [];
      return busyStatus();
    });

    await runHangWatchdogTick();
    ageWatch(HANG_CONFIRM_GRACE_MS + 1_000);
    await runHangWatchdogTick();

    expect(callsTo("/abort")).toHaveLength(0);
    expect(getHangWatch(SESSION)!.state).toBe("armed");
  });

  it("still stops the turn once the question/permission lists are empty", async () => {
    arm();
    ageWatch(TIMEOUT_MS + 1_000);
    const stale = staleActivityAt();
    let busy = true;
    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (requestPath.endsWith("/message")) return transcript(stale);
      if (requestPath.endsWith("/question") || requestPath.endsWith("/permission")) return [];
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
