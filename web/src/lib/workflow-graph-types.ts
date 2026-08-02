import type { WorkflowNodePermissions } from "./workflow-types";

export const WORKFLOW_GRAPH_SCHEMA_VERSION = "workflow-graph-v1" as const;
export const WORKFLOW_EXECUTION_SCHEMA_VERSION = "workflow-execution-v2" as const;

export type WorkflowGraphSchemaVersion = typeof WORKFLOW_GRAPH_SCHEMA_VERSION;
export type WorkflowExecutionSchemaVersion =
  typeof WORKFLOW_EXECUTION_SCHEMA_VERSION;

export type WorkflowGraphPosition = {
  x: number;
  y: number;
};

export type WorkflowViewport = WorkflowGraphPosition & {
  zoom: number;
};

export type WorkflowGraphNodePresentation = {
  width?: number;
  collapsed?: boolean;
};

export type WorkflowGraphNode = {
  id: string;
  type: string;
  typeVersion: number;
  label: string;
  position: WorkflowGraphPosition;
  config: Record<string, unknown>;
  disabled: boolean;
  presentation?: WorkflowGraphNodePresentation;
};

export type WorkflowGraphEdgeKind =
  | "dependency"
  | "success"
  | "feedback"
  | "control";

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  kind: WorkflowGraphEdgeKind;
  label?: string;
  animated?: boolean;
};

export type WorkflowGraphDraft = {
  id: string;
  workspaceId: string;
  schemaVersion: WorkflowGraphSchemaVersion;
  graphRevision: number;
  registryVersion: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  viewport?: WorkflowViewport;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowExecutionNode = {
  id: string;
  type: string;
  typeVersion: number;
  config: Record<string, unknown>;
  resolvedPermissions: WorkflowNodePermissions;
  resolvedExecutor: string;
};

export type WorkflowExecutionPresentation = {
  nodes: Array<{
    id: string;
    position: WorkflowGraphPosition;
    presentation?: WorkflowGraphNodePresentation;
  }>;
  viewport?: WorkflowViewport;
};

export type WorkflowExecutionSnapshot = {
  schemaVersion: WorkflowExecutionSchemaVersion;
  graphSchemaVersion: WorkflowGraphSchemaVersion;
  registryVersion: string;
  sourceGraphId: string;
  sourceGraphRevision: number;
  nodes: WorkflowExecutionNode[];
  edges: WorkflowGraphEdge[];
  canonicalHash: string;
  presentation?: WorkflowExecutionPresentation;
};
