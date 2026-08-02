import { ArrowRight, CheckCircle2, Circle, CircleOff, Loader2, TriangleAlert } from "lucide-react";
import type { WorkflowGraphDraft } from "@/lib/workflow-graph-types";
import type { WorkflowGraphRuntimeState } from "@/lib/workflow-graph-react-flow";
import { cx } from "@/components/ui";

function stateLabel(status: string): string {
  if (status === "succeeded" || status === "completed") return "完了";
  if (["creating_session", "dispatching", "running"].includes(status)) return "実行中";
  if (status === "unsupported") return "未対応";
  if (status === "disabled") return "無効";
  if (status === "failed") return "失敗";
  if (status === "paused") return "一時停止";
  return "待機中";
}

function StateIcon({ status }: { status: string }) {
  if (status === "succeeded" || status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
  if (["creating_session", "dispatching", "running"].includes(status)) return <Loader2 className="h-3.5 w-3.5 animate-spin text-working" aria-hidden="true" />;
  if (status === "unsupported") return <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-hidden="true" />;
  if (status === "disabled") return <CircleOff className="h-3.5 w-3.5 text-muted" aria-hidden="true" />;
  return <Circle className="h-3.5 w-3.5 text-faint" aria-hidden="true" />;
}

export function WorkflowGraphList({
  graph,
  states,
  selectedNodeId,
  onSelectNode,
  selectedEdgeId,
  onSelectEdge,
}: {
  graph: WorkflowGraphDraft;
  states: readonly WorkflowGraphRuntimeState[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string | null) => void;
}) {
  const stateByNode = new Map(states.map((state) => [state.nodeId, state]));
  return (
    <aside className="min-w-0 rounded-lg border border-border bg-surface p-3" aria-label="Workflow Nodeと接続の一覧">
      <h3 className="text-xs font-semibold text-text">Node一覧</h3>
      <p className="mt-1 text-[10px] text-muted">Tabで移動し、EnterまたはSpaceで選択</p>
      <ul className="mt-2 space-y-1">
        {graph.nodes.length === 0 && (
          <li className="workflow-graph-empty rounded-lg bg-surface-2 px-2.5 py-3 text-xs text-muted">
            表示できるNodeがありません。
          </li>
        )}
        {graph.nodes.map((node) => {
          const state = stateByNode.get(node.id);
          const status = node.disabled ? "disabled" : (state?.status ?? "ready");
          return (
            <li key={node.id}>
              <button
                type="button"
                className={cx(
                  "flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                  selectedNodeId === node.id && "bg-surface-2 text-text",
                )}
                aria-pressed={selectedNodeId === node.id}
                aria-keyshortcuts="Enter Space"
                data-node-id={node.id}
                onClick={() => {
                  onSelectEdge(null);
                  onSelectNode(selectedNodeId === node.id ? null : node.id);
                }}
              >
                <StateIcon status={status} />
                <span className="min-w-0 flex-1 truncate">{node.label}</span>
                <span className="shrink-0 text-[10px] text-muted">{stateLabel(status)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <h3 className="mt-4 text-xs font-semibold text-text">接続一覧</h3>
      <ul className="mt-2 space-y-1.5 text-[10px] text-muted">
        {graph.edges.length === 0 && (
          <li className="rounded-lg bg-surface-2 px-2.5 py-3 text-xs text-muted">接続はありません。</li>
        )}
        {graph.edges.map((edge) => (
          <li key={edge.id}>
            <button type="button" className={cx("flex min-h-10 w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary", selectedEdgeId === edge.id && "bg-surface-2 text-text")} aria-pressed={selectedEdgeId === edge.id} data-edge-id={edge.id} onClick={() => {
              onSelectNode(null);
              onSelectEdge(selectedEdgeId === edge.id ? null : edge.id);
            }}>
            <span className="min-w-0 truncate">{edge.source}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-faint" aria-hidden="true" />
            <span className="min-w-0 truncate">{edge.target}</span>
            <span className="ml-auto shrink-0 text-faint">{edge.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
