import { useMemo, useState } from "react";
import { ApiError, sendJson } from "@/lib/client";
import { isWorkflowGraphEditEnabled } from "@/lib/workflow-feature";
import type { WorkflowGraphDraft, WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/workflow-graph-types";
import type { WorkflowGraphOperation } from "@/lib/workflow-graph-mutations";
import { cx } from "@/components/ui";

type MutationResponse = { graph: WorkflowGraphDraft };
type ConflictKind = "semantic" | "layout";

const LAYOUT_OPERATIONS = new Set(["move_node", "update_node_presentation", "set_viewport"]);

function conflictKind(operations: WorkflowGraphOperation[]): ConflictKind {
  return operations.every((operation) => LAYOUT_OPERATIONS.has(operation.op)) ? "layout" : "semantic";
}

function operationError(error: unknown): string {
  return error instanceof Error ? error.message : "Graphの更新に失敗しました。";
}

function nextReviewNode(graph: WorkflowGraphDraft): { node: WorkflowGraphNode; edge: WorkflowGraphEdge } | null {
  const source = graph.nodes.find((node) => node.id === "implement_ui");
  const template = graph.nodes.find((node) => node.id === "code_review");
  if (!source || !template) return null;
  const id = `code_review_${graph.nodes.length}`;
  return {
    node: {
      ...structuredClone(template),
      id,
      label: `${template.label} ${graph.nodes.length}`,
      position: { x: template.position.x, y: template.position.y + 220 },
    },
    edge: {
      id: `${source.id}-to-${id}`,
      source: source.id,
      sourceHandle: "result",
      target: id,
      targetHandle: "input",
      kind: "dependency",
    },
  };
}

export function WorkflowGraphEditor({
  taskId,
  graph,
  selectedNodeId,
  selectedEdgeId,
  onRefresh,
}: {
  taskId: string;
  graph: WorkflowGraphDraft;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onRefresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictKind | null>(null);
  const [sourceId, setSourceId] = useState("implement_ui");
  const [targetId, setTargetId] = useState("code_review");

  const edgeOperation = useMemo<WorkflowGraphOperation>(() => ({
    op: "add_edge",
    edge: {
      id: `${sourceId}-to-${targetId}-manual-${graph.graphRevision}`,
      source: sourceId,
      sourceHandle: "result",
      target: targetId,
      targetHandle: "input",
      kind: "dependency",
    },
  }), [graph.graphRevision, sourceId, targetId]);

  if (!isWorkflowGraphEditEnabled()) return null;

  const mutate = async (operations: WorkflowGraphOperation[]) => {
    setPending(true);
    setValidationMessage(null);
    setConflict(null);
    try {
      await sendJson<MutationResponse>("PATCH", `/api/tasks/${encodeURIComponent(taskId)}/workflow/graph`, {
        expectedGraphRevision: graph.graphRevision,
        operations,
      });
      await onRefresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(conflictKind(operations));
      } else {
        setValidationMessage(operationError(error));
      }
    } finally {
      setPending(false);
    }
  };

  const addNode = () => {
    const addition = nextReviewNode(graph);
    if (addition) void mutate([{ op: "add_node", node: addition.node }, { op: "add_edge", edge: addition.edge }]);
  };
  const removeNode = () => {
    if (selectedNodeId) void mutate([{ op: "remove_node", nodeId: selectedNodeId }]);
  };
  const moveNode = () => {
    const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId);
    if (node) void mutate([{ op: "move_node", nodeId: node.id, position: { x: node.position.x + 40, y: node.position.y } }]);
  };
  const addEdge = () => void mutate([edgeOperation]);
  const removeEdge = () => {
    if (selectedEdgeId) void mutate([{ op: "remove_edge", edgeId: selectedEdgeId }]);
  };

  return (
    <section className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-3" aria-label="Graph Editor">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-1 text-xs text-text">Graph Edit</strong>
        <button type="button" disabled={pending} onClick={addNode} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">Nodeを追加</button>
        <button type="button" disabled={pending || !selectedNodeId} onClick={removeNode} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">選択Nodeを削除</button>
        <button type="button" disabled={pending || !selectedNodeId} onClick={moveNode} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">選択Nodeを移動</button>
        <button type="button" disabled={pending || !selectedEdgeId} onClick={removeEdge} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">選択Edgeを削除</button>
        <label className="flex items-center gap-1 text-[11px] text-muted">
          From
          <select aria-label="Edge source" value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="max-w-32 rounded border border-border bg-surface px-1.5 py-1 text-xs text-text">
            {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted">
          To
          <select aria-label="Edge target" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="max-w-32 rounded border border-border bg-surface px-1.5 py-1 text-xs text-text">
            {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
          </select>
        </label>
        <button type="button" disabled={pending || sourceId === targetId} onClick={addEdge} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">接続を追加</button>
      </div>
      {pending && <p className="mt-2 text-xs text-muted" role="status">Graphを検証・保存中…</p>}
      {validationMessage && <p className={cx("mt-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-xs text-danger")} role="alert" data-graph-validation>{validationMessage}</p>}
      {conflict && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-xs text-warning" role="alert" data-graph-conflict={conflict}>
          {conflict === "layout" ? "LayoutのCAS競合です。最新位置を再読込してから再試行してください。" : "SemanticのCAS競合です。Node／Edgeの最新Graphを確認してから再試行してください。"}
        </p>
      )}
    </section>
  );
}
