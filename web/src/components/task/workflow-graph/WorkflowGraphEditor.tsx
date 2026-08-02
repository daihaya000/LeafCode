import { useMemo, useState } from "react";
import { ApiError, sendJson } from "@/lib/client";
import { isWorkflowGraphEditEnabled } from "@/lib/workflow-feature";
import {
  getDefaultWorkflowNodeConfig,
  WORKFLOW_NODE_REGISTRY,
  type WorkflowNodeRegistryDefinition,
  type WorkflowPortDefinition,
} from "@/lib/workflow-node-registry";
import type { WorkflowGraphDraft, WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/workflow-graph-types";
import type { WorkflowGraphOperation } from "@/lib/workflow-graph-mutations";
import type { WorkflowGraphDirection } from "@/lib/workflow-graph-react-flow";
import { layoutWorkflowGraph } from "@/lib/workflow-graph-layout";

type MutationResponse = { graph: WorkflowGraphDraft };
type ConflictKind = "semantic" | "layout";
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
): { source: WorkflowPortDefinition; target: WorkflowPortDefinition } | null {
  const outputs = nodeDefinition(source)?.outputs ?? [];
  const inputs = nodeDefinition(target)?.inputs ?? [];
  for (const output of outputs) {
    const input = inputs.find(
      (candidate) => candidate.dataType === output.dataType &&
        candidate.edgeKinds.includes("dependency") && output.edgeKinds.includes("dependency"),
    );
    if (input) return { source: output, target: input };
  }
  return null;
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
  const [nodeType, setNodeType] = useState("opencode.code_review");
  const addableDefinitions = WORKFLOW_NODE_REGISTRY.definitions.filter((definition) => definition.userAddable);

  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  const ports = useMemo(() => compatiblePorts(source, target), [source, target]);
  const edgeOperation = useMemo<WorkflowGraphOperation | null>(() => ports && ({
    op: "add_edge",
    edge: {
      id: `${sourceId}-${ports.source.id}-to-${targetId}-${ports.target.id}-manual-${graph.graphRevision}`,
      source: sourceId,
      sourceHandle: ports.source.id,
      target: targetId,
      targetHandle: ports.target.id,
      kind: "dependency",
    },
  }), [graph.graphRevision, ports, sourceId, targetId]);

  if (!editingEnabled || !isWorkflowGraphEditEnabled()) return null;

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
      if (error instanceof ApiError && error.status === 409) setConflict(conflictKind(operations));
      else setValidationMessage(operationError(error));
    } finally {
      setPending(false);
    }
  };

  const addNode = () => {
    const addition = nextWorkflowNode(graph, addableDefinitions.find((definition) => definition.type === nodeType));
    if (addition) void mutate([{ op: "add_node", node: addition.node }, { op: "add_edge", edge: addition.edge }]);
  };
  const removeNode = () => { if (selectedNodeId) void mutate([{ op: "remove_node", nodeId: selectedNodeId }]); };
  const moveNode = () => {
    const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId);
    if (node) void mutate([{ op: "move_node", nodeId: node.id, position: { x: node.position.x + 40, y: node.position.y } }]);
  };
  const autoLayout = () => {
    const positions = layoutWorkflowGraph(graph, direction);
    void mutate(graph.nodes.map((node) => ({ op: "move_node" as const, nodeId: node.id, position: positions.get(node.id) ?? node.position })));
  };
  const addEdge = () => { if (edgeOperation) void mutate([edgeOperation]); };
  const removeEdge = () => { if (selectedEdgeId) void mutate([{ op: "remove_edge", edgeId: selectedEdgeId }]); };

  return (
    <section className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-3" aria-label="Graph Editor">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-1 text-xs text-text">Graph Edit</strong>
        <label className="flex items-center gap-1 text-[11px] text-muted">追加Node
          <select aria-label="Node type" value={nodeType} onChange={(event) => setNodeType(event.target.value)} className="max-w-40 rounded border border-border bg-surface px-1.5 py-1 text-xs text-text">
            {addableDefinitions.map((definition) => <option key={`${definition.type}@${definition.version}`} value={definition.type}>{definition.displayName}</option>)}
          </select>
        </label>
        <button type="button" disabled={pending || !nextWorkflowNode(graph, addableDefinitions.find((definition) => definition.type === nodeType))} onClick={addNode} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">Nodeを追加</button>
        <button type="button" disabled={pending || !selectedNodeId} onClick={removeNode} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">選択Nodeを削除</button>
        <button type="button" disabled={pending || !selectedNodeId} onClick={moveNode} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">選択Nodeを移動</button>
        <button type="button" disabled={pending || graph.nodes.length === 0} onClick={autoLayout} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">自動レイアウト（{direction}）</button>
        <button type="button" disabled={pending || !selectedEdgeId} onClick={removeEdge} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">選択Edgeを削除</button>
        <label className="flex items-center gap-1 text-[11px] text-muted">From
          <select aria-label="Edge source" value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="max-w-32 rounded border border-border bg-surface px-1.5 py-1 text-xs text-text">
            {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted">To
          <select aria-label="Edge target" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="max-w-32 rounded border border-border bg-surface px-1.5 py-1 text-xs text-text">
            {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
          </select>
        </label>
        <button type="button" disabled={pending || sourceId === targetId || !edgeOperation} onClick={addEdge} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text disabled:opacity-50">接続を追加</button>
      </div>
      {!ports && sourceId !== targetId && <p className="mt-2 text-[11px] text-muted">選択したNode間に接続可能な共通ポートがありません。</p>}
      {pending && <p className="mt-2 text-xs text-muted" role="status">Graphを検証・保存中…</p>}
      {validationMessage && <p className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-xs text-danger" role="alert" data-graph-validation>{validationMessage}</p>}
      {conflict && <p className="mt-2 rounded-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-xs text-warning" role="alert" data-graph-conflict={conflict}>{conflict === "layout" ? "LayoutのCAS競合です。最新位置を再読込してから再試行してください。" : "SemanticのCAS競合です。Node／Edgeの最新Graphを確認してから再試行してください。"}</p>}
    </section>
  );
}
