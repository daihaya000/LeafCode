import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, describe, expect, test, vi } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-graph-repo-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { dbPath, ensureDataDir } = await import("./paths");
ensureDataDir();
const {
  createWorkspace,
  deleteWorkspace,
  getDb,
  upsertProject,
} = await import("./db");
const {
  getOrMaterializeWorkflowGraph,
  materializeWorkflowGraph,
  readWorkflowGraph,
  readWorkflowGraphByWorkspace,
} = await import("./workflow-graph-repository");
const { updateWorkflowGraph } = await import("./workflow-graph-mutations");
const { createWorkflowDefinitionSnapshot } = await import("./workflow-types");
const { synthesizeWorkflowGraph } = await import("./workflow-graph-compat");

const project = upsertProject({ name: "Graph Repository", rootPath: testDataDir });

function createLegacyWorkspace(id: string, definitionSnapshot = createWorkflowDefinitionSnapshot()) {
  createWorkspace({
    id,
    projectId: project.id,
    displayName: id,
    absolutePath: path.join(testDataDir, id),
    isolation: "current_folder",
  });
  getDb()
    .prepare(
      `INSERT INTO workflow_runs
       (id, workspace_id, template_key, definition_snapshot, task_context_snapshot, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `run-${id}`,
      id,
      definitionSnapshot.templateKey,
      JSON.stringify(definitionSnapshot),
      JSON.stringify({ goal: "legacy goal", acceptance: [], constraints: [] }),
      "completed",
      "2026-08-02T00:00:00.000Z",
      "2026-08-02T01:00:00.000Z",
    );
}

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("workflow graph repository", () => {
  test("creates the aggregate transactionally and reads it back as a Graph Draft", () => {
    const workspaceId = "ws-repository-read";
    const definition = createWorkflowDefinitionSnapshot();
    const graph = synthesizeWorkflowGraph(definition, {
      id: "graph-repository-read",
      workspaceId,
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
    createWorkspace({
      id: workspaceId,
      projectId: project.id,
      displayName: workspaceId,
      absolutePath: path.join(testDataDir, workspaceId),
      isolation: "current_folder",
    });

    const saved = materializeWorkflowGraph(graph);
    expect(saved).toEqual(graph);
    expect(readWorkflowGraph(graph.id)).toEqual(graph);
    expect(readWorkflowGraphByWorkspace(workspaceId)).toEqual(graph);
    expect(
      getDb().prepare("SELECT COUNT(*) AS count FROM workflow_graph_nodes WHERE graph_id = ?").get(graph.id),
    ).toEqual({ count: 4 });
    expect(
      getDb().prepare("SELECT COUNT(*) AS count FROM workflow_graph_edges WHERE graph_id = ?").get(graph.id),
    ).toEqual({ count: 5 });
  });

  test("lazily materializes a legacy Workflow exactly once without changing the Run snapshot", () => {
    const workspaceId = "ws-repository-lazy";
    createLegacyWorkspace(workspaceId);
    const before = getDb()
      .prepare("SELECT definition_snapshot, updated_at FROM workflow_runs WHERE workspace_id = ?")
      .get(workspaceId) as { definition_snapshot: string; updated_at: string };

    const first = getOrMaterializeWorkflowGraph(workspaceId);
    expect(first).toMatchObject({
      id: `workflow-graph:${workspaceId}`,
      workspaceId,
      graphRevision: 1,
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "implement_ui" }),
        expect.objectContaining({ id: "review_gate", type: "control.review_gate" }),
      ]),
    });
    expect(first?.edges).toHaveLength(5);

    const second = getOrMaterializeWorkflowGraph(workspaceId);
    expect(second).toEqual(first);
    expect(
      getDb().prepare("SELECT COUNT(*) AS count FROM workflow_graphs WHERE workspace_id = ?").get(workspaceId),
    ).toEqual({ count: 1 });
    expect(
      getDb().prepare("SELECT COUNT(*) AS count FROM workflow_graph_nodes WHERE graph_id = ?").get(first?.id),
    ).toEqual({ count: 4 });
    expect(
      getDb().prepare("SELECT definition_snapshot, updated_at FROM workflow_runs WHERE workspace_id = ?").get(workspaceId),
    ).toEqual(before);
  });

  test("uses safe defaults for malformed presentation JSON but rejects semantic corruption", () => {
    const workspaceId = "ws-repository-presentation";
    createLegacyWorkspace(workspaceId);
    const graph = getOrMaterializeWorkflowGraph(workspaceId)!;
    getDb()
      .prepare("UPDATE workflow_graphs SET viewport = ? WHERE id = ?")
      .run("not-json", graph.id);
    getDb()
      .prepare("UPDATE workflow_graph_nodes SET presentation = ? WHERE graph_id = ? AND id = ?")
      .run("not-json", graph.id, "implement_ui");

    const read = readWorkflowGraph(graph.id)!;
    expect(read.viewport).toBeUndefined();
    expect(read.nodes.find((node) => node.id === "implement_ui")?.presentation).toBeUndefined();

    getDb()
      .prepare("UPDATE workflow_graph_nodes SET config = ? WHERE graph_id = ? AND id = ?")
      .run("not-json", graph.id, "implement_ui");
    expect(() => readWorkflowGraph(graph.id)).toThrow(/Stored Graph/);
  });

  test("rejects invalid Graph writes before creating partial rows", () => {
    const workspaceId = "ws-repository-invalid";
    createWorkspace({
      id: workspaceId,
      projectId: project.id,
      displayName: workspaceId,
      absolutePath: path.join(testDataDir, workspaceId),
      isolation: "current_folder",
    });
    const graph = synthesizeWorkflowGraph(createWorkflowDefinitionSnapshot(), {
      id: "graph-repository-invalid",
      workspaceId,
    });
    graph.edges[0].targetHandle = "missing";
    try {
      materializeWorkflowGraph(graph);
      throw new Error("expected invalid graph");
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_graph" });
    }
    expect(
      getDb().prepare("SELECT COUNT(*) AS count FROM workflow_graphs WHERE id = ?").get(graph.id),
    ).toEqual({ count: 0 });
  });

  test("cascades Graph Draft rows when the owning workspace is deleted", () => {
    const workspaceId = "ws-repository-cascade";
    createLegacyWorkspace(workspaceId);
    const graph = getOrMaterializeWorkflowGraph(workspaceId)!;
    expect(deleteWorkspace(workspaceId)).toBeTruthy();
    expect(readWorkflowGraph(graph.id)).toBeNull();
    expect(
      getDb().prepare("SELECT COUNT(*) AS count FROM workflow_graph_nodes WHERE graph_id = ?").get(graph.id),
    ).toEqual({ count: 0 });
    expect(
      getDb().prepare("SELECT COUNT(*) AS count FROM workflow_graph_edges WHERE graph_id = ?").get(graph.id),
    ).toEqual({ count: 0 });
  });

  test("returns null when a workspace has no legacy Workflow Run", () => {
    const workspaceId = "ws-repository-empty";
    createWorkspace({
      id: workspaceId,
      projectId: project.id,
      displayName: workspaceId,
      absolutePath: path.join(testDataDir, workspaceId),
      isolation: "current_folder",
    });
    expect(getOrMaterializeWorkflowGraph(workspaceId)).toBeNull();
  });

  test("rejects a corrupt legacy definition without creating a Graph", () => {
    const workspaceId = "ws-repository-corrupt-legacy";
    createLegacyWorkspace(workspaceId);
    getDb()
      .prepare("UPDATE workflow_runs SET definition_snapshot = ? WHERE workspace_id = ?")
      .run("not-json", workspaceId);
    expect(() => getOrMaterializeWorkflowGraph(workspaceId)).toThrow(/invalid definition snapshot/);
    expect(readWorkflowGraphByWorkspace(workspaceId)).toBeNull();
  });

  test("schema migration remains present after reopening the database", () => {
    const reopened = new Database(dbPath());
    expect(
      (reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'workflow_graph%'").all() as { name: string }[])
        .map((row) => row.name)
        .sort(),
    ).toEqual(["workflow_graph_edges", "workflow_graph_nodes", "workflow_graphs"]);
    reopened.close();
  });

  test("applies multiple Graph operations in one revisioned transaction", () => {
    const workspaceId = "ws-repository-cas";
    createLegacyWorkspace(workspaceId);
    const initial = getOrMaterializeWorkflowGraph(workspaceId)!;
    const updated = updateWorkflowGraph({
      workspaceId,
      expectedGraphRevision: initial.graphRevision,
      operations: [
        { op: "move_node", nodeId: "implement_ui", position: { x: 240, y: 80 } },
        { op: "set_viewport", viewport: { x: 10, y: 20, zoom: 1.25 } },
      ],
    });

    expect(updated.graphRevision).toBe(initial.graphRevision + 1);
    expect(updated.nodes.find((node) => node.id === "implement_ui")?.position).toEqual({ x: 240, y: 80 });
    expect(readWorkflowGraphByWorkspace(workspaceId)).toEqual(updated);
  });

  test("returns the latest Graph on a revision conflict and does not apply operations", () => {
    const workspaceId = "ws-repository-cas-conflict";
    createLegacyWorkspace(workspaceId);
    const initial = getOrMaterializeWorkflowGraph(workspaceId)!;
    const current = updateWorkflowGraph({
      workspaceId,
      expectedGraphRevision: initial.graphRevision,
      operations: [{ op: "move_node", nodeId: "implement_ui", position: { x: 300, y: 40 } }],
    });

    expect(() =>
      updateWorkflowGraph({
        workspaceId,
        expectedGraphRevision: initial.graphRevision,
        operations: [{ op: "move_node", nodeId: "implement_ui", position: { x: 900, y: 900 } }],
      }),
    ).toThrowError(expect.objectContaining({ code: "revision_conflict", latestGraph: current }));
    expect(readWorkflowGraphByWorkspace(workspaceId)?.nodes.find((node) => node.id === "implement_ui")?.position).toEqual({
      x: 300,
      y: 40,
    });
  });

  test("rolls back all operations when the final Graph is invalid", () => {
    const workspaceId = "ws-repository-cas-rollback";
    createLegacyWorkspace(workspaceId);
    const initial = getOrMaterializeWorkflowGraph(workspaceId)!;

    expect(() =>
      updateWorkflowGraph({
        workspaceId,
        expectedGraphRevision: initial.graphRevision,
        operations: [
          { op: "move_node", nodeId: "implement_ui", position: { x: 500, y: 500 } },
          { op: "set_node_label", nodeId: "implement_ui", label: "temporary" },
          { op: "add_edge", edge: { id: "invalid-edge", source: "implement_ui", sourceHandle: "missing", target: "code_review", targetHandle: "input", kind: "dependency" } },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_graph" }));
    expect(readWorkflowGraphByWorkspace(workspaceId)).toEqual(initial);
  });
});
