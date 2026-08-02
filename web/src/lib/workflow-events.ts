import type { WorkflowView } from "./workflow-service";

export type WorkflowSseEvent = {
  id: string;
  event: "workflow.updated";
  data: { workspaceId: string; revision: number; workflow: WorkflowView };
};

export function createWorkflowSseEvent(workspaceId: string, workflow: WorkflowView): WorkflowSseEvent {
  const revision = workflow.run?.revision ?? workflow.workspaceRevision;
  return { id: String(revision), event: "workflow.updated", data: { workspaceId, revision, workflow } };
}

export function encodeWorkflowSseEvent(event: WorkflowSseEvent): string {
  return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function encodeWorkflowHeartbeat(): string {
  return ": heartbeat\n\n";
}
