import { describe, expect, test } from "vitest";
import { executeReviewGate } from "./workflow-control-executor";
import type { WorkflowNodeConfig } from "./workflow-types";

const config = {
  agentName: "reviewer",
  instructions: "review",
  contextFiles: [],
  model: { mode: "auto", optimizeFor: "quality" },
  permissions: { write: false, subagent: false, browser: false },
  gate: { blockingSeverities: ["critical", "major"], optional: false },
} as WorkflowNodeConfig;

describe("executeReviewGate", () => {
  test("returns pass for successful reviewer inputs", () => {
    expect(executeReviewGate([
      { status: "succeeded", result: { verdict: "pass", summary: "ok", evidence: [], findings: [] }, config },
      { status: "succeeded", result: { verdict: "pass", summary: "ok", evidence: [], findings: [] }, config },
    ])).toEqual({ decision: "pass" });
  });

  test("does not silently fallback on an invalid result", () => {
    expect(executeReviewGate([{ status: "succeeded", result: { invalid: true }, config }])).toEqual({ decision: "pause", reason: "failed" });
  });
});
