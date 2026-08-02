import type { IntelligenceVariant } from "./model-variants";

export const WORKFLOW_TEMPLATE_KEY = "ui_implementation_review";
export const WORKFLOW_TEMPLATE_VERSION = "workflow-prompt-v1";
export const WORKFLOW_OUTPUT_SCHEMA_VERSION = "workflow-result-v1";

export type WorkflowNodeKey = "implement_ui" | "code_review" | "visual_judge";
export type WorkflowNodeKind = "implement" | "review";
export type WorkflowOutputMode = "structured" | "fenced_json";
export type WorkflowSeverity = "critical" | "major" | "minor" | "nit";
export type WorkflowReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type WorkflowModelRequest =
  | {
      mode: "explicit";
      providerID: string;
      modelID: string;
      variant?: string;
    }
  | {
      mode: "auto";
      optimizeFor: "quality" | "cost" | "speed";
    };

export type WorkflowNodePermissions = {
  write: boolean;
  subagent: boolean;
  browser: boolean;
};

export const WORKFLOW_NODE_CONFIG_FIELDS = [
  "agentName",
  "instructions",
  "contextFiles",
  "reasoningEffort",
  "model",
  "permissions",
  "gate",
] as const;

export const WORKFLOW_PERMISSION_FIELDS = [
  "write",
  "subagent",
  "browser",
] as const;

export const WORKFLOW_GATE_FIELDS = ["blockingSeverities", "optional"] as const;

export type WorkflowResultParserKey =
  | "implement-result-v1"
  | "review-result-v1"
  | "review-gate-result-v1";

export type WorkflowGateConfig = {
  blockingSeverities: WorkflowSeverity[];
  optional: boolean;
};

export type WorkflowNodeConfig = {
  agentName: string;
  instructions: string;
  contextFiles: string[];
  reasoningEffort?: WorkflowReasoningEffort;
  model: WorkflowModelRequest;
  permissions: WorkflowNodePermissions;
  gate: WorkflowGateConfig;
};

export type WorkflowNodeDefinition = {
  key: WorkflowNodeKey;
  kind: WorkflowNodeKind;
  label: string;
  config: WorkflowNodeConfig;
};

export type WorkflowEdgeDefinition = {
  from: WorkflowNodeKey;
  to: WorkflowNodeKey;
  condition: "completed" | "blocking_findings";
};

export type WorkflowDefinitionSnapshot = {
  templateKey: typeof WORKFLOW_TEMPLATE_KEY;
  outputMode: WorkflowOutputMode;
  nodes: WorkflowNodeDefinition[];
  edges: WorkflowEdgeDefinition[];
};

export type WorkflowTaskContext = {
  goal: string;
  acceptance: string[];
  constraints: string[];
};

export type ImplementResult = {
  status: "completed" | "progress" | "blocked";
  summary: string;
  evidence: string[];
  changedFiles?: string[];
  next?: string;
  blockedReason?: string;
};

export type ReviewFinding = {
  id: string;
  severity: WorkflowSeverity;
  title: string;
  detail: string;
  target?: string;
  suggestedFix?: string;
};

export type ReviewResult = {
  verdict: "pass" | "needs_changes" | "blocked" | "skipped";
  summary: string;
  evidence: string[];
  findings: ReviewFinding[];
};

export type WorkflowNodeOutcome =
  | { kind: "implement"; value: ImplementResult["status"] }
  | { kind: "review"; value: ReviewResult["verdict"] }
  | null;

export type ResolvedWorkflowModel = {
  providerID: string;
  modelID: string;
  variant?: string;
};

export type ResolvedWorkflowNodeConfig = Omit<
  WorkflowNodeConfig,
  "model"
> & {
  model: ResolvedWorkflowModel;
  modelSource: "agent" | "explicit" | "auto";
  ignoredVariant?: "ignored_by_agent";
};

export type WorkflowConfigCeiling = {
  permissions: WorkflowNodePermissions;
};

export const DEFAULT_WORKFLOW_NODES: readonly WorkflowNodeDefinition[] = [
  {
    key: "implement_ui",
    kind: "implement",
    label: "Implement UI",
    config: {
      agentName: "build",
      instructions: "Implement the requested UI and verify the result with concrete evidence.",
      contextFiles: [],
      reasoningEffort: "high",
      model: { mode: "auto", optimizeFor: "quality" },
      permissions: { write: true, subagent: true, browser: true },
      gate: { blockingSeverities: ["critical", "major"], optional: false },
    },
  },
  {
    key: "code_review",
    kind: "review",
    label: "Code Review",
    config: {
      agentName: "code-reviewer",
      instructions: "Review the implementation without changing the workspace.",
      contextFiles: [],
      reasoningEffort: "medium",
      model: { mode: "auto", optimizeFor: "cost" },
      permissions: { write: false, subagent: false, browser: false },
      gate: { blockingSeverities: ["critical", "major"], optional: false },
    },
  },
  {
    key: "visual_judge",
    kind: "review",
    label: "Visual Judge",
    config: {
      agentName: "ui-ux-reviewer",
      instructions: "Judge the approved visual evidence without changing the workspace.",
      contextFiles: [],
      reasoningEffort: "high",
      model: { mode: "auto", optimizeFor: "quality" },
      permissions: { write: false, subagent: false, browser: true },
      gate: { blockingSeverities: ["critical", "major"], optional: false },
    },
  },
];

export const DEFAULT_WORKFLOW_EDGES: readonly WorkflowEdgeDefinition[] = [
  { from: "implement_ui", to: "code_review", condition: "completed" },
  { from: "implement_ui", to: "visual_judge", condition: "completed" },
  { from: "code_review", to: "implement_ui", condition: "blocking_findings" },
  { from: "visual_judge", to: "implement_ui", condition: "blocking_findings" },
];

export function createWorkflowDefinitionSnapshot(): WorkflowDefinitionSnapshot {
  return {
    templateKey: WORKFLOW_TEMPLATE_KEY,
    outputMode: "fenced_json",
    nodes: JSON.parse(JSON.stringify(DEFAULT_WORKFLOW_NODES)) as WorkflowNodeDefinition[],
    edges: JSON.parse(JSON.stringify(DEFAULT_WORKFLOW_EDGES)) as WorkflowEdgeDefinition[],
  };
}

export function isWorkflowNodeKey(value: unknown): value is WorkflowNodeKey {
  return value === "implement_ui" || value === "code_review" || value === "visual_judge";
}

export function isWorkflowSeverity(value: unknown): value is WorkflowSeverity {
  return value === "critical" || value === "major" || value === "minor" || value === "nit";
}

export function isWorkflowReasoningEffort(
  value: unknown,
): value is WorkflowReasoningEffort {
  return (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

export function isWorkflowVariant(value: unknown): value is IntelligenceVariant {
  return (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max" ||
    value === "thinking"
  );
}
