import { describe, expect, test } from "vitest";
import {
  blockingFindings,
  dedupeFindings,
  evaluateReviewGate,
  parseImplementResult,
  parseReviewResult,
  resolveWorkflowNodeConfig,
  validateWorkflowNodeConfig,
  validateWorkflowNodeKind,
} from "./workflow";
import {
  createWorkflowDefinitionSnapshot,
  type WorkflowNodeConfig,
} from "./workflow-types";

const implementConfig = (): WorkflowNodeConfig =>
  createWorkflowDefinitionSnapshot().nodes.find((node) => node.key === "implement_ui")!.config;
const reviewConfig = (): WorkflowNodeConfig =>
  createWorkflowDefinitionSnapshot().nodes.find((node) => node.key === "code_review")!.config;

describe("workflow definition and config", () => {
  test("creates the fixed three-node definition without a free DAG", () => {
    const snapshot = createWorkflowDefinitionSnapshot();
    expect(snapshot.templateKey).toBe("ui_implementation_review");
    expect(snapshot.outputMode).toBe("fenced_json");
    expect(snapshot.nodes.map((node) => node.key)).toEqual([
      "implement_ui",
      "code_review",
      "visual_judge",
    ]);
    expect(snapshot.edges).toHaveLength(4);
  });

  test("resolves an explicit model and attempt override at the highest precedence", () => {
    const resolved = resolveWorkflowNodeConfig({
      nodeConfig: implementConfig(),
      attemptOverride: {
        model: { mode: "explicit", providerID: "p", modelID: "m", variant: "high" },
        reasoningEffort: "xhigh",
      },
    });
    expect(resolved.model).toEqual({ providerID: "p", modelID: "m", variant: "high" });
    expect(resolved.modelSource).toBe("explicit");
    expect(resolved.reasoningEffort).toBe("xhigh");
  });

  test("uses the documented app, task, template, node, attempt precedence", () => {
    const resolved = resolveWorkflowNodeConfig({
      appDefault: { instructions: "app" },
      taskDefault: { instructions: "task" },
      templateConfig: { instructions: "template" },
      nodeConfig: { ...implementConfig(), instructions: "node" },
      attemptOverride: { instructions: "attempt" },
      resolvedAutoModel: { providerID: "provider", modelID: "model" },
    });
    expect(resolved.instructions).toBe("attempt");
  });

  test("resolves Auto to a concrete model and honors an agent-fixed model", () => {
    const auto = resolveWorkflowNodeConfig({
      nodeConfig: implementConfig(),
      resolvedAutoModel: { providerID: "auto-provider", modelID: "auto-model", variant: "medium" },
    });
    expect(auto.modelSource).toBe("auto");
    expect(auto.model.providerID).toBe("auto-provider");

    const fixed = resolveWorkflowNodeConfig({
      nodeConfig: {
        ...implementConfig(),
        model: { mode: "explicit", providerID: "requested", modelID: "requested", variant: "high" },
      },
      agentFixedModel: {
        providerID: "agent-provider",
        modelID: "agent-model",
        acceptsVariant: false,
      },
    });
    expect(fixed.model).toEqual({ providerID: "agent-provider", modelID: "agent-model" });
    expect(fixed.modelSource).toBe("agent");
    expect(fixed.ignoredVariant).toBe("ignored_by_agent");
  });

  test("validates node kind and clamps permissions to a ceiling", () => {
    validateWorkflowNodeKind("implement_ui", "implement");
    expect(() => validateWorkflowNodeKind("code_review", "implement")).toThrow();
    const resolved = resolveWorkflowNodeConfig({
      nodeConfig: implementConfig(),
      resolvedAutoModel: { providerID: "ceiling-provider", modelID: "ceiling-model" },
      permissionCeiling: {
        permissions: { write: false, subagent: false, browser: true },
      },
    });
    expect(resolved.permissions).toEqual({ write: false, subagent: false, browser: true });
  });

  test("keeps the shared config field allowlist aligned with manual validation", () => {
    const config = { ...implementConfig(), unexpected: true } as WorkflowNodeConfig;
    expect(validateWorkflowNodeConfig(config)).toContain(
      "unknown node config field: unexpected",
    );
  });
});

describe("workflow result and gate contracts", () => {
  test("accepts only structured Implement and Review results", () => {
    expect(
      parseImplementResult({ status: "completed", summary: "done", evidence: ["test passed"] }),
    ).toMatchObject({ status: "completed" });
    expect(parseImplementResult({ status: "completed", summary: "", evidence: [] })).toBeNull();
    expect(
      parseReviewResult({
        verdict: "needs_changes",
        summary: "fix it",
        evidence: [],
        findings: [
          { id: "f1", severity: "major", title: "Issue", detail: "Details" },
        ],
      }),
    ).toMatchObject({ verdict: "needs_changes" });
    expect(parseReviewResult({ verdict: "pass", summary: "ok", evidence: [], findings: [{}] })).toBeNull();
  });

  test("deduplicates and orders findings deterministically", () => {
    const findings = dedupeFindings([
      { id: "minor", sourceNode: "visual_judge", severity: "minor", title: "m", detail: "m" },
      { id: "major", sourceNode: "code_review", severity: "major", title: "M", detail: "M" },
      { id: "major", sourceNode: "code_review", severity: "major", title: "duplicate", detail: "duplicate" },
    ]);
    expect(findings.map((finding) => finding.id)).toEqual(["major", "minor"]);
  });

  test("returns to Implement only for configured blocking severities", () => {
    const config = reviewConfig();
    const result = {
      verdict: "needs_changes" as const,
      summary: "needs changes",
      evidence: [],
      findings: [
        { id: "minor", severity: "minor" as const, title: "minor", detail: "minor" },
      ],
    };
    expect(blockingFindings(result, ["critical", "major"])).toEqual([]);
    expect(evaluateReviewGate({ status: "succeeded", result, config })).toEqual({ decision: "pass" });
    const major = {
      ...result,
      findings: [{ id: "major", severity: "major" as const, title: "major", detail: "major" }],
    };
    expect(evaluateReviewGate({ status: "succeeded", result: major, config })).toMatchObject({
      decision: "return_to_implement",
    });
    expect(evaluateReviewGate({ status: "failed", result: null, config })).toEqual({
      decision: "pause",
      reason: "failed",
    });
  });
});
