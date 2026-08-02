import { describe, expect, test } from "vitest";
import { executorRegistryKeys, resolveExecutor, resolveLegacyExecutor, resolveSnapshotExecutor } from "./workflow-executor-registry";
import { createWorkflowGraphCompat } from "./workflow-graph-compat";
import { createWorkflowExecutionSnapshot } from "./workflow-execution-snapshot";
import { createWorkflowDefinitionSnapshot } from "./workflow-types";

describe("workflow executor registry", () => {
  test("resolves all registered v1 executors and rejects unknown keys", () => {
    expect(executorRegistryKeys()).toEqual(expect.arrayContaining([
      "opencode.implement_ui.v1",
      "opencode.code_review.v1",
      "opencode.visual_judge.v1",
      "control.review_gate.v1",
    ]));
    expect(resolveLegacyExecutor("implement_ui").runtime).toBe("opencode_session");
    expect(resolveLegacyExecutor("code_review").key).toBe("opencode.code_review.v1");
    expect(() => resolveExecutor("removed.executor.v1")).toThrow("Unknown workflow executor");
  });

  test("resolves v2 executors from the immutable snapshot, not Node keys", () => {
    const graph = createWorkflowGraphCompat(createWorkflowDefinitionSnapshot(), { id: "executor-graph", workspaceId: "ws" });
    const snapshot = createWorkflowExecutionSnapshot(graph);
    expect(resolveSnapshotExecutor(snapshot, "review_gate")).toMatchObject({
      key: "control.review_gate.v1",
      runtime: "server_control",
    });
  });
});
