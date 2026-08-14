import { describe, expect, it, vi } from "vitest";
import { goalLoopTestSeams } from "./goal-loop";
import type { MessageWithParts } from "./types";

vi.mock("./memory", async () => ({
  memoryInjectionFor: vi.fn().mockReturnValue("<workspace-memory>\n- [fact] mock\n</workspace-memory>\n"),
}));

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
  it("treats busy and rate-limit prompt failures as transient conflicts", () => {
    expect(goalLoopTestSeams.isTransientConflictPrompt({ status: 409 })).toBe(true);
    expect(goalLoopTestSeams.isTransientConflictPrompt({ status: 429 })).toBe(true);
    expect(goalLoopTestSeams.isTransientConflictPrompt({ status: 400 })).toBe(false);
    expect(goalLoopTestSeams.isDefinitelyRejectedPrompt({ status: 409 })).toBe(false);
    expect(goalLoopTestSeams.isDefinitelyRejectedPrompt({ status: 429 })).toBe(false);
    expect(goalLoopTestSeams.isDefinitelyRejectedPrompt({ status: 422 })).toBe(true);
  });

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

  it("does not reuse an earlier result while the latest assistant step is streaming", () => {
    const messages = [msg("u1", "user"), msg("a1", "assistant"), running("a2")];
    expect(goalLoopTestSeams.finalAssistantAfter(messages, "u1")).toBeNull();
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

  it("refuses to attribute a reply when lastMessageId is gone from the snapshot", () => {
    const messages = [msg("a1", "assistant", { status: "progress", summary: "x" })];
    // Scanning from index 0 here used to let a message from before the loop be
    // consumed as this turn's result. See docs/specs/goal-loop.md invariant I4.
    expect(goalLoopTestSeams.finalAssistantAfter(messages, "ghost")).toBeNull();
    expect(goalLoopTestSeams.boundaryLost(messages, "ghost")).toBe(true);
    expect(goalLoopTestSeams.boundaryLost(messages, "a1")).toBe(false);
    expect(goalLoopTestSeams.boundaryLost(messages, null)).toBe(false);
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

    it("full-run mode forbids completion claims and uses only progress/blocked", () => {
      const prompt = goalLoopTestSeams.buildGoalPrompt(
        {
          goal: "ship it",
          acceptance: [],
          progress: [],
          forceFullRun: true,
        } as never,
        1,
        10,
      );
      expect(prompt).toContain("full-run mode");
      expect(prompt).toContain("of exactly 10");
      expect(prompt).toContain("progress, blocked");
      expect(prompt).not.toContain("progress, completed, blocked");
      expect(prompt).toContain('Do not use status "completed"');
      const cont = goalLoopTestSeams.buildGoalContinuationPrompt(
        {
          goal: "ship it",
          acceptance: [],
          progress: [],
          forceFullRun: true,
        } as never,
        3,
        10,
      );
      expect(cont).toContain("full-run mode");
      expect(cont).toContain("progress or blocked");
      expect(cont).not.toContain("progress, completed, or blocked");
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

    it("injects the memory block only on the first turn and bumps use_count", () => {
      const loop = {
        workspaceId: "goal-mem-ws",
        goal: "ship it",
        acceptance: [],
        progress: [
          {
            time: "2026-01-01T00:00:00.000Z",
            status: "progress",
            summary: "implemented the first step",
            next: "run the focused tests",
            evidence: "changed src/feature.ts",
          },
        ],
      } as never;
      const first = goalLoopTestSeams.buildGoalPromptWithMemory(loop, 1, 10);
      expect(first).toContain("<workspace-memory>");
      expect(first).toContain("<!-- webui-goal-loop-prompt -->");
      expect(first).toContain("Rules:");

      const second = goalLoopTestSeams.buildGoalPromptWithMemory(loop, 2, 10);
      expect(second).toContain("<!-- webui-goal-loop-prompt -->");
      expect(second).not.toContain("<workspace-memory>");
      expect(second).toContain("Continue the LeafCode native persistent goal loop");
      expect(second).not.toContain("- One turn = one iteration.");
      expect(second).toContain("implemented the first step");
      expect(second).toContain("run the focused tests");
      expect(second).toContain("changed src/feature.ts");
      expect(second.length).toBeLessThan(
        goalLoopTestSeams.buildGoalPrompt(loop, 2, 10).length,
      );
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

    it("preserves the latest claim summary and evidence for verification", () => {
      const prompt = goalLoopTestSeams.buildVerificationPrompt(
        {
          goal: "ship it",
          acceptance: ["tests pass"],
          progress: [
            {
              time: "2026-01-01T00:00:00.000Z",
              status: "progress",
              summary: "older progress",
              evidence: "old evidence",
            },
            {
              time: "2026-01-01T00:01:00.000Z",
              status: "completed",
              summary: "final completion claim",
              evidence: "vitest run: 42 passed; src/feature.ts changed",
            },
          ],
        } as never,
        2,
        10,
      );

      expect(prompt).toContain("summary: final completion claim");
      expect(prompt).toContain(
        "evidence: vitest run: 42 passed; src/feature.ts changed",
      );
      expect(prompt).not.toContain("summary: older progress");
      expect(prompt).not.toContain("evidence: old evidence");
    });
  });

  describe("normalizeAcceptance", () => {
    it("treats a missing list as empty and trims blank entries", () => {
      expect(goalLoopTestSeams.normalizeAcceptance(undefined)).toEqual([]);
      expect(goalLoopTestSeams.normalizeAcceptance([" tests pass ", "", "  "])).toEqual([
        "tests pass",
      ]);
    });

    it("rejects instead of truncating past the item cap", () => {
      const ten = Array.from({ length: 10 }, (_, i) => `criterion ${i}`);
      expect(goalLoopTestSeams.normalizeAcceptance(ten)).toHaveLength(10);
      // Silently dropping the 11th would verify against a different contract
      // than the caller submitted, so the request must fail instead.
      expect(goalLoopTestSeams.normalizeAcceptance([...ten, "criterion 10"])).toBeNull();
    });

    it("rejects non-array and non-string input", () => {
      expect(goalLoopTestSeams.normalizeAcceptance("tests pass")).toBeNull();
      expect(goalLoopTestSeams.normalizeAcceptance([1])).toBeNull();
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
