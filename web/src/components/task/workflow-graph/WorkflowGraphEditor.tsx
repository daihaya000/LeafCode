import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Trash2 } from "lucide-react";
import { ApiError, sendJson } from "@/lib/client";
import { isWorkflowGraphEditEnabled } from "@/lib/workflow-feature";
import {
  getDefaultWorkflowNodeConfig,
  WORKFLOW_NODE_REGISTRY,
  type WorkflowNodeRegistryDefinition,
  type WorkflowPortDefinition,
} from "@/lib/workflow-node-registry";
import type {
  WorkflowGraphDraft,
  WorkflowGraphEdge,
  WorkflowGraphEdgeKind,
  WorkflowGraphNode,
} from "@/lib/workflow-graph-types";
import type { WorkflowGraphOperation } from "@/lib/workflow-graph-mutations";
import type { WorkflowGraphDirection } from "@/lib/workflow-graph-react-flow";
import { layoutWorkflowGraph } from "@/lib/workflow-graph-layout";

type MutationResponse = { graph: WorkflowGraphDraft };
type ConflictKind = "semantic" | "layout";
type DeleteTarget = { kind: "node" | "edge"; id: string; label: string };
const LAYOUT_OPERATIONS = new Set(["move_node", "update_node_presentation", "set_viewport"]);

function conflictKind(operations: WorkflowGraphOperation[]): ConflictKind {
  return operations.every((operation) => LAYOUT_OPERATIONS.has(operation.op)) ? "layout" : "semantic";
}

function operationError(error: unknown): string {
  return error instanceof Error ? error.message : "Graphの更新に失敗しました。";
}

function nodeDefinition(node: WorkflowGraphNode | undefined) {
  return node && WORKFLOW_NODE_REGISTRY.get(node.type, node.typeVersion);
}

function compatiblePorts(
  source: WorkflowGraphNode | undefined,
  target: WorkflowGraphNode | undefined,
  edgeKind: WorkflowGraphEdgeKind = "dependency",
): { source: WorkflowPortDefinition; target: WorkflowPortDefinition } | null {
  const outputs = nodeDefinition(source)?.outputs ?? [];
  const inputs = nodeDefinition(target)?.inputs ?? [];
  for (const output of outputs) {
    const input = inputs.find(
      (candidate) => candidate.dataType === output.dataType &&
        candidate.edgeKinds.includes(edgeKind) && output.edgeKinds.includes(edgeKind),
    );
    if (input) return { source: output, target: input };
  }
  return null;
}

function compatibleEdgeKinds(
  source: WorkflowGraphNode | undefined,
  target: WorkflowGraphNode | undefined,
): WorkflowGraphEdgeKind[] {
  const outputs = nodeDefinition(source)?.outputs ?? [];
  const inputs = nodeDefinition(target)?.inputs ?? [];
  const kinds = new Set<WorkflowGraphEdgeKind>();
  for (const output of outputs) {
    for (const input of inputs) {
      if (input.dataType !== output.dataType) continue;
      for (const kind of output.edgeKinds) {
        if (input.edgeKinds.includes(kind)) kinds.add(kind);
      }
    }
  }
  return [...kinds];
}

function nextWorkflowNode(
  graph: WorkflowGraphDraft,
  definition: WorkflowNodeRegistryDefinition | undefined,
): { node: WorkflowGraphNode; edge: WorkflowGraphEdge } | null {
  const source = graph.nodes.find((node) => node.id === "implement_ui");
  const config = definition && getDefaultWorkflowNodeConfig(definition);
  if (!source || !definition || !config) return null;
  let index = graph.nodes.length;
  const prefix = definition.defaultNodeKey ?? definition.type.split(".").at(-1) ?? "node";
  let id = `${prefix}_${index}`;
  while (graph.nodes.some((node) => node.id === id)) id = `${prefix}_${++index}`;
  const node: WorkflowGraphNode = {
    id,
    type: definition.type,
    typeVersion: definition.version,
    label: `${definition.displayName} ${index}`,
    position: { x: source.position.x + 320, y: source.position.y + index * 220 },
    config: structuredClone(config) as Record<string, unknown>,
    disabled: false,
  };
  const ports = compatiblePorts(source, node);
  if (!ports) return null;
  return {
    node,
    edge: {
      id: `${source.id}-to-${id}`,
      source: source.id,
      sourceHandle: ports.source.id,
      target: id,
      targetHandle: ports.target.id,
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
  direction,
  editingEnabled = true,
}: {
  taskId: string;
  graph: WorkflowGraphDraft;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onRefresh: () => Promise<void>;
  direction: WorkflowGraphDirection;
  editingEnabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictKind | null>(null);
  const [sourceId, setSourceId] = useState("implement_ui");
  const [targetId, setTargetId] = useState("code_review");
  const [edgeKind, setEdgeKind] = useState<WorkflowGraphEdgeKind>("dependency");
  const [nodeType, setNodeType] = useState("opencode.code_review");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const addableDefinitions = WORKFLOW_NODE_REGISTRY.definitions.filter((definition) => definition.userAddable);
  const editAvailable = editingEnabled && isWorkflowGraphEditEnabled();

  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId);
  const edgeKinds = useMemo(() => compatibleEdgeKinds(source, target), [source, target]);
  const effectiveEdgeKind = edgeKinds.includes(edgeKind) ? edgeKind : (edgeKinds[0] ?? "dependency");
  const ports = useMemo(() => compatiblePorts(source, target, effectiveEdgeKind), [effectiveEdgeKind, source, target]);
  const edgeOperation = useMemo<WorkflowGraphOperation | null>(() => ports && ({
    op: "add_edge",
    edge: {
      id: `${sourceId}-${ports.source.id}-to-${targetId}-${ports.target.id}-manual-${graph.graphRevision}`,
      source: sourceId,
      sourceHandle: ports.source.id,
      target: targetId,
      targetHandle: ports.target.id,
      kind: effectiveEdgeKind,
    },
  }), [effectiveEdgeKind, graph.graphRevision, ports, sourceId, targetId]);

  useEffect(() => {
    if (!source && graph.nodes[0]) setSourceId(graph.nodes[0].id);
    if (!target && graph.nodes[1]) setTargetId(graph.nodes[1].id);
  }, [graph.graphRevision, graph.nodes, source, target]);

  useEffect(() => {
    if (edgeKinds.length > 0 && !edgeKinds.includes(edgeKind)) setEdgeKind(edgeKinds[0]);
  }, [edgeKind, edgeKinds]);

  const mutate = useCallback(async (operations: WorkflowGraphOperation[], successMessage: string) => {
    setPending(true);
    setValidationMessage(null);
    setConflict(null);
    try {
      await sendJson<MutationResponse>("PATCH", `/api/tasks/${encodeURIComponent(taskId)}/workflow/graph`, {
        expectedGraphRevision: graph.graphRevision,
        operations,
      });
      await onRefresh();
      setAnnouncement(successMessage);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(conflictKind(operations));
      else setValidationMessage(operationError(error));
    } finally {
      setPending(false);
    }
  }, [graph.graphRevision, onRefresh, taskId]);

  useEffect(() => {
    if (!editAvailable) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target;
      if (element instanceof Element && element.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape" && deleteTarget) {
        event.preventDefault();
        setDeleteTarget(null);
        return;
      }
      if (event.key === "Delete") {
        const candidate = selectedEdge
          ? { kind: "edge" as const, id: selectedEdge.id, label: `${selectedEdge.source} → ${selectedEdge.target}` }
          : selectedNode
            ? { kind: "node" as const, id: selectedNode.id, label: selectedNode.label }
            : null;
        if (!candidate) return;
        event.preventDefault();
        setDeleteTarget(candidate);
        return;
      }
      if (!event.ctrlKey || !selectedNode || pending) return;
      const directions: Partial<Record<string, { x: number; y: number; label: string }>> = {
        ArrowLeft: { x: -20, y: 0, label: "左" },
        ArrowRight: { x: 20, y: 0, label: "右" },
        ArrowUp: { x: 0, y: -20, label: "上" },
        ArrowDown: { x: 0, y: 20, label: "下" },
      };
      const movement = directions[event.key];
      if (!movement) return;
      event.preventDefault();
      void mutate(
        [{
          op: "move_node",
          nodeId: selectedNode.id,
          position: {
            x: selectedNode.position.x + movement.x,
            y: selectedNode.position.y + movement.y,
          },
        }],
        `${selectedNode.label}を${movement.label}へ移動しました。`,
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget, editAvailable, mutate, pending, selectedEdge, selectedNode]);

  if (!editAvailable) return null;

  const addNode = () => {
    const addition = nextWorkflowNode(graph, addableDefinitions.find((definition) => definition.type === nodeType));
    if (addition) void mutate(
      [{ op: "add_node", node: addition.node }, { op: "add_edge", edge: addition.edge }],
      `${addition.node.label}を追加しました。`,
    );
  };
  const nudgeNode = (x: number, y: number, label: string) => {
    if (selectedNode) void mutate(
      [{ op: "move_node", nodeId: selectedNode.id, position: { x: selectedNode.position.x + x, y: selectedNode.position.y + y } }],
      `${selectedNode.label}を${label}へ移動しました。`,
    );
  };
  const autoLayout = () => {
    const positions = layoutWorkflowGraph(graph, direction);
    void mutate(
      graph.nodes.map((node) => ({ op: "move_node" as const, nodeId: node.id, position: positions.get(node.id) ?? node.position })),
      `Graphを${direction}方向へ自動整列しました。`,
    );
  };
  const addEdge = () => {
    if (edgeOperation) void mutate([edgeOperation], `${sourceId}から${targetId}への接続を追加しました。`);
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    const targetToDelete = deleteTarget;
    setDeleteTarget(null);
    if (targetToDelete.kind === "node") {
      void mutate([{ op: "remove_node", nodeId: targetToDelete.id }], `${targetToDelete.label}を削除しました。`);
    } else {
      void mutate([{ op: "remove_edge", edgeId: targetToDelete.id }], `${targetToDelete.label}の接続を削除しました。`);
    }
  };

  return (
    <section className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-3" aria-label="Graph Editor">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong className="text-xs text-text">Graph Edit</strong>
          <p className="mt-0.5 text-[10px] text-muted">選択NodeはCtrl＋矢印キーでも20pxずつ移動できます。</p>
        </div>
        <button type="button" disabled={pending || graph.nodes.length === 0} onClick={autoLayout} className="min-h-10 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text hover:bg-surface-2 disabled:opacity-50">自動レイアウト（{direction}）</button>
      </div>
      <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <fieldset className="min-w-0 rounded-lg border border-border/80 bg-surface/70 p-2.5">
          <legend className="px-1 text-[11px] font-semibold text-muted">Node</legend>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] text-muted">追加する種類
              <select aria-label="Node type" value={nodeType} onChange={(event) => setNodeType(event.target.value)} className="min-h-10 w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-text">
                {addableDefinitions.map((definition) => <option key={`${definition.type}@${definition.version}`} value={definition.type}>{definition.displayName}</option>)}
              </select>
            </label>
            <button type="button" disabled={pending || !nextWorkflowNode(graph, addableDefinitions.find((definition) => definition.type === nodeType))} onClick={addNode} className="min-h-10 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text hover:bg-surface-2 disabled:opacity-50">Nodeを追加</button>
            <button type="button" disabled={pending || !selectedNode} onClick={() => selectedNode && setDeleteTarget({ kind: "node", id: selectedNode.id, label: selectedNode.label })} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-danger/30 bg-surface px-3 py-2 text-xs text-danger hover:bg-danger/5 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />選択Nodeを削除</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="選択Nodeを移動">
            <span className="mr-1 text-[10px] text-muted">20px移動</span>
            <button type="button" aria-label="左へ移動" aria-keyshortcuts="Control+ArrowLeft" disabled={pending || !selectedNode} onClick={() => nudgeNode(-20, 0, "左")} className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-text hover:bg-surface-2 disabled:opacity-50"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" aria-label="上へ移動" aria-keyshortcuts="Control+ArrowUp" disabled={pending || !selectedNode} onClick={() => nudgeNode(0, -20, "上")} className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-text hover:bg-surface-2 disabled:opacity-50"><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" aria-label="下へ移動" aria-keyshortcuts="Control+ArrowDown" disabled={pending || !selectedNode} onClick={() => nudgeNode(0, 20, "下")} className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-text hover:bg-surface-2 disabled:opacity-50"><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" aria-label="右へ移動" aria-keyshortcuts="Control+ArrowRight" disabled={pending || !selectedNode} onClick={() => nudgeNode(20, 0, "右")} className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-text hover:bg-surface-2 disabled:opacity-50"><ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </fieldset>
        <fieldset className="min-w-0 rounded-lg border border-border/80 bg-surface/70 p-2.5">
          <legend className="px-1 text-[11px] font-semibold text-muted">接続</legend>
          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted">From
              <select aria-label="Edge source" value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="min-h-10 min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text">
                {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted">To
              <select aria-label="Edge target" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="min-h-10 min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text">
                {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted">種別
              <select aria-label="Edge kind" value={effectiveEdgeKind} disabled={edgeKinds.length === 0} onChange={(event) => setEdgeKind(event.target.value as WorkflowGraphEdgeKind)} className="min-h-10 min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text disabled:opacity-50">
                {edgeKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={pending || sourceId === targetId || !edgeOperation} onClick={addEdge} className="min-h-10 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text hover:bg-surface-2 disabled:opacity-50">接続を追加</button>
            <button type="button" disabled={pending || !selectedEdge} onClick={() => selectedEdge && setDeleteTarget({ kind: "edge", id: selectedEdge.id, label: `${selectedEdge.source} → ${selectedEdge.target}` })} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-danger/30 bg-surface px-3 py-2 text-xs text-danger hover:bg-danger/5 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />選択Edgeを削除</button>
          </div>
        </fieldset>
      </div>
      {!ports && sourceId !== targetId && <p className="mt-2 text-[11px] text-muted">選択したNode間に接続可能な共通ポートがありません。</p>}
      {deleteTarget && (
        <div className="mt-2 rounded-lg border border-danger/30 bg-danger/5 p-3" role="alertdialog" aria-labelledby="workflow-graph-delete-title" aria-describedby="workflow-graph-delete-description">
          <h3 id="workflow-graph-delete-title" className="text-sm font-semibold text-text">{deleteTarget.kind === "node" ? "Nodeを削除しますか？" : "接続を削除しますか？"}</h3>
          <p id="workflow-graph-delete-description" className="mt-1 text-xs text-muted">{deleteTarget.label}{deleteTarget.kind === "node" ? " と接続中のEdgeが削除されます。" : " を削除します。"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" autoFocus onClick={() => setDeleteTarget(null)} className="min-h-10 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text">キャンセル</button>
            <button type="button" onClick={confirmDelete} className="min-h-10 rounded-md border border-danger bg-danger px-3 py-2 text-xs font-medium text-white">削除する</button>
          </div>
        </div>
      )}
      {pending && <p className="mt-2 text-xs text-muted" role="status">Graphを検証・保存中…</p>}
      {validationMessage && <p className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-xs text-danger" role="alert" data-graph-validation>{validationMessage}</p>}
      {conflict && <p className="mt-2 rounded-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-xs text-warning" role="alert" data-graph-conflict={conflict}>{conflict === "layout" ? "LayoutのCAS競合です。最新位置を再読込してから再試行してください。" : "SemanticのCAS競合です。Node／Edgeの最新Graphを確認してから再試行してください。"}</p>}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}
