import { evaluateReviewGate, parseReviewResult } from "./workflow";
import type { ReviewResult, WorkflowNodeConfig } from "./workflow-types";

export type ReviewGateExecutorInput = {
  status: string;
  result: unknown;
  config: WorkflowNodeConfig;
};

export type ReviewGateDecision =
  | { decision: "pass" | "skip" }
  | { decision: "return_to_implement"; findings: unknown[] }
  | { decision: "pause"; reason: "blocked" | "failed" | "unknown_result" };

export function executeReviewGate(inputs: ReviewGateExecutorInput[]): ReviewGateDecision {
  const decisions = inputs.map((input) => evaluateReviewGate({
    status: input.status === "succeeded" || input.status === "failed" || input.status === "skipped" ? input.status : "failed",
    result: input.result != null ? parseReviewResult(input.result) : null,
    config: input.config,
  }));
  const pause = decisions.find((decision) => decision.decision === "pause");
  if (pause?.decision === "pause") return { decision: "pause", reason: pause.reason };
  const findings = decisions.flatMap((decision) => decision.decision === "return_to_implement" ? decision.findings : []) as unknown[];
  return findings.length ? { decision: "return_to_implement", findings } : { decision: "pass" };
}

export function parseReviewGateInput(value: string | null): ReviewResult | null {
  if (!value) return null;
  try {
    return parseReviewResult(JSON.parse(value));
  } catch {
    return null;
  }
}
