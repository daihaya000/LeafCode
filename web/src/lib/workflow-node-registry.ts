import type { AnySchema } from "ajv";
import {
  DEFAULT_WORKFLOW_NODES,
  type WorkflowNodeConfig,
  type WorkflowNodeKey,
  type WorkflowNodePermissions,
  type WorkflowResultParserKey,
} from "./workflow-types";
import type { WorkflowGraphEdgeKind } from "./workflow-graph-types";

export const WORKFLOW_NODE_REGISTRY_VERSION = "workflow-node-registry-v1";

export type WorkflowNodeCategory =
  | "implementation"
  | "review"
  | "control"
  | "test"
  | "approval";

export type WorkflowNodeRuntime = "opencode_session" | "server_control";

export type WorkflowPortDefinition = {
  id: string;
  label: string;
  dataType: string;
  required: boolean;
  multiple: boolean;
  edgeKinds: readonly WorkflowGraphEdgeKind[];
  terminal?: boolean;
};

export type WorkflowNodeRegistryDefinition = {
  type: string;
  version: number;
  displayName: string;
  description: string;
  category: WorkflowNodeCategory;
  runtime: WorkflowNodeRuntime;
  userAddable: boolean;
  inputs: readonly WorkflowPortDefinition[];
  outputs: readonly WorkflowPortDefinition[];
  configSchema: AnySchema;
  resultSchema: AnySchema;
  permissionCeiling: WorkflowNodePermissions;
  executorKey: string;
  rendererKey: string;
  defaultNodeKey?: WorkflowNodeKey;
  resultParserKey: WorkflowResultParserKey;
};

export const WORKFLOW_EXECUTOR_KEYS = [
  "opencode.implement_ui.v1",
  "opencode.code_review.v1",
  "opencode.visual_judge.v1",
  "control.review_gate.v1",
] as const;

export const WORKFLOW_RENDERER_KEYS = [
  "workflow.runtime.v1",
  "workflow.review-gate.v1",
] as const;

export const WORKFLOW_RESULT_PARSER_KEYS = [
  "implement-result-v1",
  "review-result-v1",
  "review-gate-result-v1",
] as const satisfies readonly WorkflowResultParserKey[];

const workflowExecutorKeySet: ReadonlySet<string> = new Set(WORKFLOW_EXECUTOR_KEYS);
const workflowRendererKeySet: ReadonlySet<string> = new Set(WORKFLOW_RENDERER_KEYS);
const workflowResultParserKeySet: ReadonlySet<WorkflowResultParserKey> = new Set(
  WORKFLOW_RESULT_PARSER_KEYS,
);

const permissionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["write", "subagent", "browser"],
  properties: {
    write: { type: "boolean" },
    subagent: { type: "boolean" },
    browser: { type: "boolean" },
  },
} as const;

const gateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["blockingSeverities", "optional"],
  properties: {
    blockingSeverities: {
      type: "array",
      uniqueItems: true,
      items: { enum: ["critical", "major", "minor", "nit"] },
    },
    optional: { type: "boolean" },
  },
} as const;

const modelSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "optimizeFor"],
      properties: {
        mode: { const: "auto" },
        optimizeFor: { enum: ["quality", "cost", "speed"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "providerID", "modelID"],
      properties: {
        mode: { const: "explicit" },
        providerID: { type: "string", minLength: 1 },
        modelID: { type: "string", minLength: 1 },
        variant: { type: "string", minLength: 1 },
      },
    },
  ],
} as const;

export const WORKFLOW_NODE_CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "agentName",
    "instructions",
    "contextFiles",
    "model",
    "permissions",
    "gate",
  ],
  properties: {
    agentName: { type: "string", minLength: 1, maxLength: 256 },
    instructions: { type: "string", maxLength: 8_000 },
    contextFiles: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    reasoningEffort: {
      enum: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    },
    model: modelSchema,
    permissions: permissionsSchema,
    gate: gateSchema,
  },
} as const;

export const IMPLEMENT_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "evidence"],
  properties: {
    status: { enum: ["completed", "progress", "blocked"] },
    summary: { type: "string", minLength: 1 },
    evidence: { type: "array", items: { type: "string" } },
    changedFiles: { type: "array", items: { type: "string" } },
    next: { type: "string" },
    blockedReason: { type: "string" },
  },
} as const;

const reviewFindingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "severity", "title", "detail"],
  properties: {
    id: { type: "string", minLength: 1 },
    severity: { enum: ["critical", "major", "minor", "nit"] },
    title: { type: "string" },
    detail: { type: "string" },
    target: { type: "string" },
    suggestedFix: { type: "string" },
  },
} as const;

export const REVIEW_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "evidence", "findings"],
  properties: {
    verdict: { enum: ["pass", "needs_changes", "blocked", "skipped"] },
    summary: { type: "string", minLength: 1 },
    evidence: { type: "array", items: { type: "string" } },
    findings: { type: "array", items: reviewFindingSchema },
  },
} as const;

export const REVIEW_GATE_RESULT_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["decision"],
      properties: { decision: { enum: ["pass", "skip"] } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["decision", "findings"],
      properties: {
        decision: { const: "return_to_implement" },
        findings: { type: "array", items: reviewFindingSchema },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["decision", "reason"],
      properties: {
        decision: { const: "pause" },
        reason: { enum: ["blocked", "failed", "unknown_result"] },
      },
    },
  ],
} as const;

const noConfigSchema = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
} as const;

const runtimeOutput: WorkflowPortDefinition = {
  id: "result",
  label: "Result",
  dataType: "workflow.implement-result.v1",
  required: false,
  multiple: true,
  edgeKinds: ["dependency", "success"],
};

const reviewInput: WorkflowPortDefinition = {
  id: "implementation",
  label: "Implementation",
  dataType: "workflow.implement-result.v1",
  required: true,
  multiple: false,
  edgeKinds: ["dependency", "success"],
};

const reviewOutput: WorkflowPortDefinition = {
  id: "result",
  label: "Review result",
  dataType: "workflow.review-result.v1",
  required: false,
  multiple: false,
  edgeKinds: ["dependency", "control"],
};

export const WORKFLOW_NODE_DEFINITIONS: readonly WorkflowNodeRegistryDefinition[] = [
  {
    type: "opencode.implement_ui",
    version: 1,
    displayName: "Implement UI",
    description: "Implements the requested UI in an OpenCode session.",
    category: "implementation",
    runtime: "opencode_session",
    userAddable: true,
    inputs: [
      {
        id: "feedback",
        label: "Review feedback",
        dataType: "workflow.review-findings.v1",
        required: false,
        multiple: false,
        edgeKinds: ["feedback"],
      },
    ],
    outputs: [runtimeOutput],
    configSchema: WORKFLOW_NODE_CONFIG_SCHEMA,
    resultSchema: IMPLEMENT_RESULT_SCHEMA,
    permissionCeiling: { write: true, subagent: true, browser: true },
    executorKey: "opencode.implement_ui.v1",
    rendererKey: "workflow.runtime.v1",
    defaultNodeKey: "implement_ui",
    resultParserKey: "implement-result-v1",
  },
  {
    type: "opencode.code_review",
    version: 1,
    displayName: "Code Review",
    description: "Reviews implementation changes without writing to the workspace.",
    category: "review",
    runtime: "opencode_session",
    userAddable: true,
    inputs: [reviewInput],
    outputs: [reviewOutput],
    configSchema: WORKFLOW_NODE_CONFIG_SCHEMA,
    resultSchema: REVIEW_RESULT_SCHEMA,
    permissionCeiling: { write: false, subagent: false, browser: false },
    executorKey: "opencode.code_review.v1",
    rendererKey: "workflow.runtime.v1",
    defaultNodeKey: "code_review",
    resultParserKey: "review-result-v1",
  },
  {
    type: "opencode.visual_judge",
    version: 1,
    displayName: "Visual Judge",
    description: "Reviews approved visual evidence without writing to the workspace.",
    category: "review",
    runtime: "opencode_session",
    userAddable: true,
    inputs: [reviewInput],
    outputs: [reviewOutput],
    configSchema: WORKFLOW_NODE_CONFIG_SCHEMA,
    resultSchema: REVIEW_RESULT_SCHEMA,
    permissionCeiling: { write: false, subagent: false, browser: true },
    executorKey: "opencode.visual_judge.v1",
    rendererKey: "workflow.runtime.v1",
    defaultNodeKey: "visual_judge",
    resultParserKey: "review-result-v1",
  },
  {
    type: "control.review_gate",
    version: 1,
    displayName: "Review Gate",
    description: "Combines reviewer results and selects pass or feedback.",
    category: "control",
    runtime: "server_control",
    userAddable: false,
    inputs: [
      {
        id: "code_review",
        label: "Code review",
        dataType: "workflow.review-result.v1",
        required: true,
        multiple: false,
        edgeKinds: ["dependency", "control"],
      },
      {
        id: "visual_judge",
        label: "Visual judge",
        dataType: "workflow.review-result.v1",
        required: true,
        multiple: false,
        edgeKinds: ["dependency", "control"],
      },
    ],
    outputs: [
      {
        id: "passed",
        label: "Passed",
        dataType: "workflow.review-gate-decision.v1",
        required: false,
        multiple: false,
        edgeKinds: ["success", "control"],
        terminal: true,
      },
      {
        id: "feedback",
        label: "Feedback",
        dataType: "workflow.review-findings.v1",
        required: false,
        multiple: false,
        edgeKinds: ["feedback"],
      },
    ],
    configSchema: noConfigSchema,
    resultSchema: REVIEW_GATE_RESULT_SCHEMA,
    permissionCeiling: { write: false, subagent: false, browser: false },
    executorKey: "control.review_gate.v1",
    rendererKey: "workflow.review-gate.v1",
    resultParserKey: "review-gate-result-v1",
  },
];

export class WorkflowNodeRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowNodeRegistryError";
  }
}

function registryKey(type: string, version: number): string {
  return `${type}\u0000${version}`;
}

function assertUniquePorts(
  definition: WorkflowNodeRegistryDefinition,
  direction: "inputs" | "outputs",
): void {
  const seen = new Set<string>();
  for (const port of definition[direction]) {
    if (!port.id.trim()) {
      throw new WorkflowNodeRegistryError(
        `${definition.type}@${definition.version} has an empty ${direction} port`,
      );
    }
    if (seen.has(port.id)) {
      throw new WorkflowNodeRegistryError(
        `${definition.type}@${definition.version} has duplicate ${direction} port ${port.id}`,
      );
    }
    seen.add(port.id);
  }
}

export class WorkflowNodeRegistry {
  readonly version: string;
  readonly definitions: readonly WorkflowNodeRegistryDefinition[];
  readonly #byKey: ReadonlyMap<string, WorkflowNodeRegistryDefinition>;

  constructor(
    version: string,
    definitions: readonly WorkflowNodeRegistryDefinition[],
    options: {
      executorKeys?: ReadonlySet<string>;
      rendererKeys?: ReadonlySet<string>;
    } = {},
  ) {
    if (!version.trim()) throw new WorkflowNodeRegistryError("registry version is required");
    const executorKeys = options.executorKeys ?? workflowExecutorKeySet;
    const rendererKeys = options.rendererKeys ?? workflowRendererKeySet;
    const byKey = new Map<string, WorkflowNodeRegistryDefinition>();

    for (const definition of definitions) {
      if (!definition.type.trim() || !Number.isSafeInteger(definition.version) || definition.version < 1) {
        throw new WorkflowNodeRegistryError("node type and positive integer version are required");
      }
      const key = registryKey(definition.type, definition.version);
      if (byKey.has(key)) {
        throw new WorkflowNodeRegistryError(
          `duplicate node definition ${definition.type}@${definition.version}`,
        );
      }
      if (!executorKeys.has(definition.executorKey)) {
        throw new WorkflowNodeRegistryError(`unknown executor key ${definition.executorKey}`);
      }
      if (!rendererKeys.has(definition.rendererKey)) {
        throw new WorkflowNodeRegistryError(`unknown renderer key ${definition.rendererKey}`);
      }
      if (!workflowResultParserKeySet.has(definition.resultParserKey)) {
        throw new WorkflowNodeRegistryError(
          `unknown result parser key ${definition.resultParserKey}`,
        );
      }
      assertUniquePorts(definition, "inputs");
      assertUniquePorts(definition, "outputs");
      byKey.set(key, definition);
    }

    this.version = version;
    this.definitions = [...definitions];
    this.#byKey = byKey;
  }

  get(type: string, version: number): WorkflowNodeRegistryDefinition | undefined {
    return this.#byKey.get(registryKey(type, version));
  }

  has(type: string, version: number): boolean {
    return this.#byKey.has(registryKey(type, version));
  }
}

export const WORKFLOW_NODE_REGISTRY = new WorkflowNodeRegistry(
  WORKFLOW_NODE_REGISTRY_VERSION,
  WORKFLOW_NODE_DEFINITIONS,
);

export function getDefaultWorkflowNodeConfig(
  definition: WorkflowNodeRegistryDefinition,
): WorkflowNodeConfig | undefined {
  if (!definition.defaultNodeKey) return undefined;
  const config = DEFAULT_WORKFLOW_NODES.find(
    (node) => node.key === definition.defaultNodeKey,
  )?.config;
  return config ? (JSON.parse(JSON.stringify(config)) as WorkflowNodeConfig) : undefined;
}
