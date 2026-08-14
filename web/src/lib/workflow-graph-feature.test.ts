import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getSetting: vi.fn(() => null) }));

import {
  isWorkflowGraphEditEnabled,
  isWorkflowGraphEnabled,
  resolveWorkflowGraphRollout,
} from "./workflow-feature";
import {
  WORKFLOW_EXECUTION_SCHEMA_VERSION,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowExecutionSnapshot,
  type WorkflowGraphDraft,
} from "./workflow-graph-types";

describe("workflow graph feature flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.each([
    [undefined, false],
    ["false", false],
    ["0", false],
    ["invalid", false],
    ["true", true],
    ["1", true],
  ])("resolves graph flag %s to %s", (raw, expected) => {
    vi.stubEnv("LEAFCODE_WORKFLOW_MODE", "true");
    if (raw === undefined) {
      delete process.env.LEAFCODE_WORKFLOW_GRAPH;
    } else {
      vi.stubEnv("LEAFCODE_WORKFLOW_GRAPH", raw);
    }
    expect(isWorkflowGraphEnabled()).toBe(expected);
  });

  test("forces graph and edit off when workflow mode is disabled", () => {
    vi.stubEnv("LEAFCODE_WORKFLOW_MODE", "false");
    vi.stubEnv("LEAFCODE_WORKFLOW_GRAPH", "true");
    vi.stubEnv("LEAFCODE_WORKFLOW_GRAPH_EDIT", "true");
    expect(isWorkflowGraphEnabled()).toBe(false);
    expect(isWorkflowGraphEditEnabled()).toBe(false);
  });

  test("requires both graph flags before semantic editing is enabled", () => {
    vi.stubEnv("LEAFCODE_WORKFLOW_MODE", "true");
    vi.stubEnv("LEAFCODE_WORKFLOW_GRAPH", "false");
    vi.stubEnv("LEAFCODE_WORKFLOW_GRAPH_EDIT", "true");
    expect(isWorkflowGraphEditEnabled()).toBe(false);

    vi.stubEnv("LEAFCODE_WORKFLOW_GRAPH", "true");
    expect(isWorkflowGraphEditEnabled()).toBe(true);
  });

  test.each([
    [{ mode: "false", graph: "true", graphEdit: "true" }, "legacy", "workflow_disabled"],
    [{ mode: "true", graph: "false", graphEdit: "true" }, "legacy", "graph_disabled"],
    [{ mode: "true", graph: "true", graphEdit: "false" }, "graph_readonly", "graph_readonly"],
    [{ mode: "true", graph: "true", graphEdit: "true" }, "graph_edit", "graph_edit_enabled"],
  ] as const)("applies staged rollout guard %j", (raw, phase, reason) => {
    expect(resolveWorkflowGraphRollout(raw)).toMatchObject({ phase, reason });
  });
});

describe("workflow graph DTOs", () => {
  test("round-trips as plain JSON without React Flow transient state", () => {
    const draft: WorkflowGraphDraft = {
      id: "graph-1",
      workspaceId: "workspace-1",
      schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
      graphRevision: 1,
      registryVersion: "workflow-node-registry-v1",
      nodes: [
        {
          id: "implement_ui",
          type: "opencode.implement_ui",
          typeVersion: 1,
          label: "Implement UI",
          position: { x: 10, y: 20 },
          config: { agentName: "build" },
          disabled: false,
          presentation: { width: 320, collapsed: false },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    };

    const roundTripped = JSON.parse(JSON.stringify(draft)) as WorkflowGraphDraft;
    expect(roundTripped).toEqual(draft);
    expect(JSON.stringify(roundTripped)).not.toMatch(
      /"(?:selected|dragging|measured|internals)"/,
    );
  });

  test("keeps execution semantics and presentation in separate fields", () => {
    const snapshot: WorkflowExecutionSnapshot = {
      schemaVersion: WORKFLOW_EXECUTION_SCHEMA_VERSION,
      graphSchemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
      registryVersion: "workflow-node-registry-v1",
      sourceGraphId: "graph-1",
      sourceGraphRevision: 1,
      nodes: [
        {
          id: "implement_ui",
          type: "opencode.implement_ui",
          typeVersion: 1,
          config: {},
          resolvedPermissions: { write: true, subagent: true, browser: true },
          resolvedExecutor: "opencode.implement_ui.v1",
        },
      ],
      edges: [],
      canonicalHash: "sha256:example",
      presentation: {
        nodes: [{ id: "implement_ui", position: { x: 10, y: 20 } }],
      },
    };

    expect(snapshot.nodes[0]).not.toHaveProperty("position");
    expect(snapshot.presentation?.nodes[0].position).toEqual({ x: 10, y: 20 });
  });
});
