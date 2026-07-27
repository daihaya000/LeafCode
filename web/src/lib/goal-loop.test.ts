import { describe, expect, it } from "vitest";
import { goalLoopTestSeams } from "./goal-loop";
import type { MessageWithParts } from "./types";

function msg(
  id: string,
  role: "user" | "assistant",
  structured?: unknown,
  time: { created?: number; completed?: number } = { created: 1, completed: 2 },
): MessageWithParts {
  return {
    info: {
      id,
      role,
      structured,
      time,
    },
    parts: [],
  };
}

/** Assistant step that is still streaming (no `completed` timestamp). */
function running(id: string): MessageWithParts {
  return msg(id, "assistant", undefined, { created: 1 });
}

describe("goalLoopTestSeams", () => {
  it("normalizes structured goal progress", () => {
    const result = goalLoopTestSeams.normalizeStructured({
      status: "progress",
      summary: "updated files",
      next: "run tests",
      evidence: "changed src/app.ts",
    });

    expect(result).toMatchObject({
      status: "progress",
      summary: "updated files",
      next: "run tests",
      evidence: "changed src/app.ts",
    });
    expect(result?.time).toEqual(expect.any(String));
  });

  it("rejects malformed structured goal output", () => {
    expect(goalLoopTestSeams.normalizeStructured({ status: "done" })).toBeNull();
    expect(goalLoopTestSeams.normalizeStructured({ status: "progress" })).toBeNull();
    expect(goalLoopTestSeams.normalizeStructured(null)).toBeNull();
  });

  it("accepts verified_completed as a verification turn status", () => {
    const result = goalLoopTestSeams.normalizeStructured({
      status: "verified_completed",
      summary: "claim verified",
      evidence: "checks passed",
    });
    expect(result).toMatchObject({
      status: "verified_completed",
      summary: "claim verified",
      evidence: "checks passed",
    });
  });

  it("finds the final assistant message after the loop boundary", () => {
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant"),
      msg("u2", "user"),
      msg("a2", "assistant", { status: "completed", summary: "done" }),
    ];

    expect(goalLoopTestSeams.latestMessageId(messages)).toBe("a2");
    expect(goalLoopTestSeams.finalAssistantAfter(messages, "a1")?.info.id).toBe("a2");
    expect(goalLoopTestSeams.finalAssistantAfter(messages, "a2")).toBeNull();
  });

  it("skips intermediate step messages and returns the structured tail", () => {
    // OpenCode emits one assistant message per step; only the last carries
    // `structured`. Taking the first one paused every loop on turn 1.
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant"),
      msg("a2", "assistant"),
      msg("a3", "assistant", { status: "progress", summary: "done step" }),
    ];
    const found = goalLoopTestSeams.finalAssistantAfter(messages, "u1");
    expect(found?.info.id).toBe("a3");
    expect(goalLoopTestSeams.normalizeStructured(found?.info.structured)).toMatchObject({
      status: "progress",
    });
  });

  it("ignores assistant messages that are still streaming", () => {
    const messages = [msg("u1", "user"), msg("a1", "assistant"), running("a2")];
    expect(goalLoopTestSeams.finalAssistantAfter(messages, "u1")?.info.id).toBe("a1");
    expect(goalLoopTestSeams.finalAssistantAfter([running("a1")], null)).toBeNull();
  });

  it("treats a missing lastMessageId as scanning from the start", () => {
    const messages = [msg("u1", "user"), msg("a1", "assistant", { status: "progress", summary: "x" })];
    expect(goalLoopTestSeams.finalAssistantAfter(messages, null)?.info.id).toBe("a1");
  });

  it("skips user messages between the boundary and the assistant tail", () => {
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant", { status: "progress", summary: "step" }),
      msg("u2", "user"),
      msg("u3", "user"),
      msg("a2", "assistant", { status: "progress", summary: "next" }),
    ];
    expect(goalLoopTestSeams.finalAssistantAfter(messages, "a1")?.info.id).toBe("a2");
  });

  it("handles a stale lastMessageId that no longer exists in the snapshot", () => {
    const messages = [msg("a1", "assistant", { status: "progress", summary: "x" })];
    // findIndex returns -1, Math.max(0, -1 + 1) = 0 -> scans from start
    expect(goalLoopTestSeams.finalAssistantAfter(messages, "ghost")?.info.id).toBe("a1");
  });

  it("returns null for an empty message list", () => {
    expect(goalLoopTestSeams.latestMessageId([])).toBeNull();
    expect(goalLoopTestSeams.finalAssistantAfter([], null)).toBeNull();
  });

  describe("extractGoalResult", () => {
    function assistant(text: string, structured?: unknown): MessageWithParts {
      const m = msg("a1", "assistant", structured);
      m.parts = [{ id: "p1", messageID: "a1", type: "text", text }];
      return m;
    }

    it("prefers info.structured when the engine round-trips it", () => {
      const m = assistant("noise", { status: "completed", summary: "from structured" });
      expect(goalLoopTestSeams.extractGoalResult(m)?.summary).toBe("from structured");
    });

    it("reads the fenced JSON block the prompt asks for", () => {
      // `format` (json_schema) cannot be sent to this OpenCode build, so the
      // fenced block is the real transport for the turn result.
      const m = assistant(
        'Did the work.\n\n```json\n{"status":"progress","summary":"edited files","next":"run tests"}\n```',
      );
      expect(goalLoopTestSeams.extractGoalResult(m)).toMatchObject({
        status: "progress",
        summary: "edited files",
        next: "run tests",
      });
    });

    it("takes the last valid block and ignores earlier example JSON", () => {
      const m = assistant(
        'Example: {"status":"blocked","summary":"not the answer"}\n' +
          '```json\n{"status":"completed","summary":"real result"}\n```',
      );
      expect(goalLoopTestSeams.extractGoalResult(m)).toMatchObject({
        status: "completed",
        summary: "real result",
      });
    });

    it("skips trailing prose and nested braces inside strings", () => {
      const m = assistant(
        '```json\n{"status":"progress","summary":"handled {braces} and \\"quotes\\"","evidence":"tsc ok"}\n```\nDone.',
      );
      expect(goalLoopTestSeams.extractGoalResult(m)).toMatchObject({
        status: "progress",
        summary: 'handled {braces} and "quotes"',
        evidence: "tsc ok",
      });
    });

    it("accepts a bare JSON object without a fence", () => {
      const m = assistant('{"status":"completed","summary":"no fence"}');
      expect(goalLoopTestSeams.extractGoalResult(m)?.status).toBe("completed");
    });

    it("returns null when the turn produced no readable result", () => {
      expect(goalLoopTestSeams.extractGoalResult(assistant("just prose"))).toBeNull();
      expect(
        goalLoopTestSeams.extractGoalResult(assistant('```json\n{"status":"nope"}\n```')),
      ).toBeNull();
      expect(goalLoopTestSeams.extractGoalResult(assistant("{ broken json"))).toBeNull();
    });
  });

  describe("buildGoalPrompt", () => {
    it("asks for the fenced JSON block instead of relying on json_schema", () => {
      const prompt = goalLoopTestSeams.buildGoalPrompt(
        {
          goal: "ship it",
          acceptance: ["tests pass"],
          progress: [],
        } as never,
        1,
        10,
      );
      expect(prompt).toContain("<!-- webui-goal-loop-prompt -->");
      expect(prompt).toContain("```json");
      expect(prompt).toContain("tests pass");
      expect(prompt).toContain("progress, completed, blocked");
    });

    it("warns that a completed claim will be independently verified", () => {
      const prompt = goalLoopTestSeams.buildGoalPrompt(
        {
          goal: "ship it",
          acceptance: [],
          progress: [],
        } as never,
        1,
        10,
      );
      expect(prompt).toContain("independently verified");
    });

    it("states the current turn number so the agent runs one iteration only", () => {
      const prompt = goalLoopTestSeams.buildGoalPrompt(
        {
          goal: "ship it",
          acceptance: [],
          progress: [],
        } as never,
        3,
        10,
      );
      expect(prompt).toContain("This is turn 3 of at most 10.");
      expect(prompt).toContain("2 loop turn(s) completed before this one");
      expect(prompt).toContain("One turn = one iteration");
      expect(prompt).toContain("Never simulate");
    });
  });

  describe("buildVerificationPrompt", () => {
    it("asks the agent to verify the previous completed claim", () => {
      const prompt = goalLoopTestSeams.buildVerificationPrompt(
        {
          goal: "ship it",
          acceptance: ["tests pass"],
          progress: [
            { time: "2026-01-01T00:00:00.000Z", status: "completed", summary: "done", evidence: "tsc ok" },
          ],
        } as never,
        1,
        10,
      );
      expect(prompt).toContain("<!-- webui-goal-loop-prompt -->");
      expect(prompt).toContain("independently verify");
      expect(prompt).toContain("tests pass");
      expect(prompt).toContain("verified_completed");
      expect(prompt).toContain("done");
      expect(prompt).toContain("tsc ok");
    });

    it("tells the verifier how many turns actually ran so inflated claims fail", () => {
      const prompt = goalLoopTestSeams.buildVerificationPrompt(
        {
          goal: "ship it",
          acceptance: [],
          progress: [
            { time: "2026-01-01T00:00:00.000Z", status: "completed", summary: "3 loops done" },
          ],
        } as never,
        1,
        10,
      );
      expect(prompt).toContain("Only 1 loop turn(s) of at most 10 have actually been executed");
      expect(prompt).toContain("reports more turns, iterations, or work than the 1 executed turn(s)");
    });
  });

  describe("countRecentRejectedClaims", () => {
    const t = "2026-01-01T00:00:00.000Z";
    it("returns zero when no claims exist", () => {
      expect(goalLoopTestSeams.countRecentRejectedClaims([])).toBe(0);
      expect(
        goalLoopTestSeams.countRecentRejectedClaims([
          { time: t, status: "progress", summary: "wip" },
        ]),
      ).toBe(0);
    });

    it("counts a single completed-then-rejected pair", () => {
      expect(
        goalLoopTestSeams.countRecentRejectedClaims([
          { time: t, status: "completed", summary: "claim" },
          { time: t, status: "progress", summary: "verify rejected" },
        ]),
      ).toBe(1);
    });

    it("counts two consecutive rejected pairs", () => {
      expect(
        goalLoopTestSeams.countRecentRejectedClaims([
          { time: t, status: "completed", summary: "claim1" },
          { time: t, status: "progress", summary: "reject1" },
          { time: t, status: "completed", summary: "claim2" },
          { time: t, status: "progress", summary: "reject2" },
        ]),
      ).toBe(2);
    });

    it("stops at a verified pair", () => {
      expect(
        goalLoopTestSeams.countRecentRejectedClaims([
          { time: t, status: "completed", summary: "ok" },
          { time: t, status: "verified_completed", summary: "verified" },
          { time: t, status: "completed", summary: "claim" },
          { time: t, status: "progress", summary: "reject" },
        ]),
      ).toBe(1);
    });

    it("stops at a progress reset before the claim", () => {
      expect(
        goalLoopTestSeams.countRecentRejectedClaims([
          { time: t, status: "progress", summary: "real work" },
          { time: t, status: "completed", summary: "claim" },
          { time: t, status: "progress", summary: "reject" },
        ]),
      ).toBe(1);
    });
  });

  describe("transcriptIdleFor", () => {
    const quiet = 5_000;

    it("treats an empty transcript as idle", () => {
      expect(goalLoopTestSeams.transcriptIdleFor([], quiet, 10_000)).toBe(true);
    });

    it("is busy while the tail is a user message awaiting a reply", () => {
      expect(
        goalLoopTestSeams.transcriptIdleFor([msg("a1", "assistant"), msg("u1", "user")], quiet, 10_000),
      ).toBe(false);
    });

    it("is busy while the tail assistant is still streaming", () => {
      expect(goalLoopTestSeams.transcriptIdleFor([running("a1")], quiet, 10_000)).toBe(false);
    });

    it("is busy until the quiet period elapses (multi-step turns)", () => {
      const messages = [msg("a1", "assistant", undefined, { created: 1, completed: 10_000 })];
      expect(goalLoopTestSeams.transcriptIdleFor(messages, quiet, 12_000)).toBe(false);
      expect(goalLoopTestSeams.transcriptIdleFor(messages, quiet, 15_000)).toBe(true);
    });
  });

  it("clamps oversized structured fields to the documented limits", () => {
    const longSummary = "s".repeat(5000);
    const longEvidence = "e".repeat(5000);
    const result = goalLoopTestSeams.normalizeStructured({
      status: "progress",
      summary: longSummary,
      evidence: longEvidence,
      next: "n".repeat(3000),
    });
    expect(result?.summary.length).toBe(4000);
    expect(result?.evidence?.length).toBe(4000);
    expect(result?.next?.length).toBe(2000);
  });

  it("preserves blocked status and routes blockedReason into evidence when evidence is absent", () => {
    const result = goalLoopTestSeams.normalizeStructured({
      status: "blocked",
      summary: "need input",
      blockedReason: "awaiting approval",
    });
    expect(result?.status).toBe("blocked");
    expect(result?.evidence).toBe("awaiting approval");
  });
});
