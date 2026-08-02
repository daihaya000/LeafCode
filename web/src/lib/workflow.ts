import {
  isWorkflowNodeKey,
  isWorkflowReasoningEffort,
  isWorkflowSeverity,
  type ImplementResult,
  type ResolvedWorkflowModel,
  type ResolvedWorkflowNodeConfig,
  type ReviewFinding,
  type ReviewResult,
  type WorkflowConfigCeiling,
  type WorkflowModelRequest,
  type WorkflowNodeConfig,
  type WorkflowNodeKey,
  type WorkflowNodeKind,
  type WorkflowNodePermissions,
  type WorkflowSeverity,
} from "./workflow-types";

export class WorkflowValidationError extends Error {
  readonly code = "invalid_workflow_input";

  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export type PartialWorkflowNodeConfig = Partial<WorkflowNodeConfig> & {
  permissions?: Partial<WorkflowNodePermissions>;
  gate?: Partial<WorkflowNodeConfig["gate"]>;
};

export type AgentFixedModel = ResolvedWorkflowModel & {
  acceptsVariant?: boolean;
};

export type ResolveWorkflowNodeConfigInput = {
  nodeConfig: WorkflowNodeConfig;
  attemptOverride?: PartialWorkflowNodeConfig;
  templateConfig?: PartialWorkflowNodeConfig;
  taskDefault?: PartialWorkflowNodeConfig;
  appDefault?: PartialWorkflowNodeConfig;
  agentFixedModel?: AgentFixedModel;
  resolvedAutoModel?: ResolvedWorkflowModel;
  permissionCeiling?: WorkflowConfigCeiling;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function mergeWorkflowNodeConfig(
  base: WorkflowNodeConfig,
  override?: PartialWorkflowNodeConfig,
): WorkflowNodeConfig {
  if (!override) return clone(base);
  const scalarOverrides = Object.fromEntries(
    Object.entries(override).filter(
      ([key, value]) =>
        value !== undefined &&
        key !== "contextFiles" &&
        key !== "model" &&
        key !== "permissions" &&
        key !== "gate",
    ),
  ) as Partial<WorkflowNodeConfig>;
  return {
    ...base,
    ...scalarOverrides,
    contextFiles: override.contextFiles !== undefined
      ? [...override.contextFiles]
      : [...base.contextFiles],
    model: override.model !== undefined ? clone(override.model) : clone(base.model),
    permissions: {
      ...base.permissions,
      ...override.permissions,
    },
    gate: {
      ...base.gate,
      ...override.gate,
      blockingSeverities: override.gate?.blockingSeverities
        ? [...override.gate.blockingSeverities]
        : [...base.gate.blockingSeverities],
    },
  };
}

function validateModelRequest(model: WorkflowModelRequest, errors: string[]): void {
  if (!model || typeof model !== "object") {
    errors.push("model is required");
    return;
  }
  if (model.mode === "auto") {
    for (const key of Object.keys(model as unknown as Record<string, unknown>)) {
      if (key !== "mode" && key !== "optimizeFor") errors.push(`unknown model field: ${key}`);
    }
    if (!("quality" === model.optimizeFor || "cost" === model.optimizeFor || "speed" === model.optimizeFor)) {
      errors.push("model.optimizeFor is invalid");
    }
    return;
  }
  if (model.mode !== "explicit") {
    errors.push("model.mode is invalid");
    return;
  }
  for (const key of Object.keys(model as unknown as Record<string, unknown>)) {
    if (key !== "mode" && key !== "providerID" && key !== "modelID" && key !== "variant") {
      errors.push(`unknown model field: ${key}`);
    }
  }
  if (typeof model.providerID !== "string" || !model.providerID.trim()) {
    errors.push("model.providerID is required");
  }
  if (typeof model.modelID !== "string" || !model.modelID.trim()) {
    errors.push("model.modelID is required");
  }
  if (model.variant !== undefined && !String(model.variant).trim()) {
    errors.push("model.variant must not be empty");
  }
}

export function validateWorkflowNodeConfig(
  config: WorkflowNodeConfig,
  nodeKey?: WorkflowNodeKey,
): string[] {
  const errors: string[] = [];
  const allowedKeys = new Set([
    "agentName",
    "instructions",
    "contextFiles",
    "reasoningEffort",
    "model",
    "permissions",
    "gate",
  ]);
  for (const key of Object.keys(config as unknown as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) errors.push(`unknown node config field: ${key}`);
  }
  if (
    typeof config.agentName !== "string" ||
    !config.agentName.trim() ||
    config.agentName.length > 256
  ) {
    errors.push("agentName must be 1-256 characters");
  }
  if (typeof config.instructions !== "string") {
    errors.push("instructions must be a string");
  } else if (config.instructions.length > 8_000) {
    errors.push("instructions exceeds 8000 characters");
  }
  if (
    !Array.isArray(config.contextFiles) ||
    config.contextFiles.some((file) => typeof file !== "string" || !file.trim())
  ) {
    errors.push("contextFiles must contain non-empty paths");
  }
  if (config.reasoningEffort !== undefined && !isWorkflowReasoningEffort(config.reasoningEffort)) {
    errors.push("reasoningEffort is invalid");
  }
  validateModelRequest(config.model, errors);
  if (!config.permissions || typeof config.permissions !== "object") {
    errors.push("permissions is required");
  }
  for (const key of ["write", "subagent", "browser"] as const) {
    if (!config.permissions || typeof config.permissions[key] !== "boolean") {
      errors.push(`permissions.${key} must be boolean`);
    }
  }
  for (const key of Object.keys((config.permissions ?? {}) as unknown as Record<string, unknown>)) {
    if (key !== "write" && key !== "subagent" && key !== "browser") {
      errors.push(`unknown permissions field: ${key}`);
    }
  }
  if (!config.gate || typeof config.gate !== "object") {
    errors.push("gate is required");
  } else if (!Array.isArray(config.gate.blockingSeverities)) {
    errors.push("gate.blockingSeverities must be an array");
  } else {
    const seen = new Set<string>();
    for (const severity of config.gate.blockingSeverities) {
      if (!isWorkflowSeverity(severity)) errors.push(`invalid severity: ${String(severity)}`);
      if (seen.has(String(severity))) errors.push(`duplicate severity: ${String(severity)}`);
      seen.add(String(severity));
    }
  }
  for (const key of Object.keys((config.gate ?? {}) as unknown as Record<string, unknown>)) {
    if (key !== "blockingSeverities" && key !== "optional") {
      errors.push(`unknown gate field: ${key}`);
    }
  }
  if (!config.gate || typeof config.gate.optional !== "boolean") errors.push("gate.optional must be boolean");
  if (nodeKey && nodeKey !== "implement_ui" && config.permissions?.write) {
    errors.push(`${nodeKey} cannot have write permission`);
  }
  return errors;
}

export function assertValidWorkflowNodeConfig(
  config: WorkflowNodeConfig,
  nodeKey?: WorkflowNodeKey,
): void {
  const errors = validateWorkflowNodeConfig(config, nodeKey);
  if (errors.length) throw new WorkflowValidationError(errors.join("; "));
}

export function constrainWorkflowPermissions(
  requested: WorkflowNodePermissions,
  ceiling: WorkflowConfigCeiling,
): WorkflowNodePermissions {
  return {
    write: requested.write && ceiling.permissions.write,
    subagent: requested.subagent && ceiling.permissions.subagent,
    browser: requested.browser && ceiling.permissions.browser,
  };
}

function resolveModel(
  request: WorkflowModelRequest,
  input: ResolveWorkflowNodeConfigInput,
): { model: ResolvedWorkflowModel; source: ResolvedWorkflowNodeConfig["modelSource"]; ignoredVariant?: "ignored_by_agent" } {
  if (input.agentFixedModel) {
    return {
      model: {
        providerID: input.agentFixedModel.providerID,
        modelID: input.agentFixedModel.modelID,
        ...(input.agentFixedModel.variant
          ? { variant: input.agentFixedModel.variant }
          : {}),
      },
      source: "agent",
      ...(request.mode === "explicit" && request.variant && input.agentFixedModel.acceptsVariant === false
        ? { ignoredVariant: "ignored_by_agent" as const }
        : {}),
    };
  }
  if (request.mode === "explicit") {
    return {
      model: {
        providerID: request.providerID,
        modelID: request.modelID,
        ...(request.variant ? { variant: request.variant } : {}),
      },
      source: "explicit",
    };
  }
  if (!input.resolvedAutoModel) {
    throw new WorkflowValidationError("Auto model has no resolved provider/model");
  }
  return { model: clone(input.resolvedAutoModel), source: "auto" };
}

export function resolveWorkflowNodeConfig(
  input: ResolveWorkflowNodeConfigInput,
): ResolvedWorkflowNodeConfig {
  // Lower-precedence layers are applied first. The node and attempt values are
  // the authoritative layers and therefore must be applied last. The node
  // config is also the complete fallback when an app default is not supplied.
  let merged = clone(input.nodeConfig);
  merged = input.appDefault ? mergeWorkflowNodeConfig(merged, input.appDefault) : merged;
  merged = input.taskDefault ? mergeWorkflowNodeConfig(merged, input.taskDefault) : merged;
  merged = input.templateConfig ? mergeWorkflowNodeConfig(merged, input.templateConfig) : merged;
  merged = mergeWorkflowNodeConfig(merged, input.nodeConfig);
  merged = input.attemptOverride ? mergeWorkflowNodeConfig(merged, input.attemptOverride) : merged;
  if (input.permissionCeiling) {
    merged.permissions = constrainWorkflowPermissions(
      merged.permissions,
      input.permissionCeiling,
    );
  }
  assertValidWorkflowNodeConfig(merged);
  const resolved = resolveModel(merged.model, input);
  return {
    ...merged,
    model: resolved.model,
    modelSource: resolved.source,
    ...(resolved.ignoredVariant ? { ignoredVariant: resolved.ignoredVariant } : {}),
  };
}

export function parseImplementResult(value: unknown): ImplementResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "completed" && raw.status !== "progress" && raw.status !== "blocked") {
    return null;
  }
  if (typeof raw.summary !== "string" || !raw.summary.trim()) return null;
  if (!Array.isArray(raw.evidence) || raw.evidence.some((item) => typeof item !== "string")) {
    return null;
  }
  for (const key of ["changedFiles", "next", "blockedReason"] as const) {
    if (raw[key] !== undefined && key === "changedFiles" && (!Array.isArray(raw[key]) || raw[key].some((item) => typeof item !== "string"))) {
      return null;
    }
    if (raw[key] !== undefined && key !== "changedFiles" && typeof raw[key] !== "string") return null;
  }
  return clone(raw) as ImplementResult;
}

export function parseReviewResult(value: unknown): ReviewResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.verdict !== "pass" &&
    raw.verdict !== "needs_changes" &&
    raw.verdict !== "blocked" &&
    raw.verdict !== "skipped"
  ) {
    return null;
  }
  if (typeof raw.summary !== "string" || !raw.summary.trim()) return null;
  if (!Array.isArray(raw.evidence) || raw.evidence.some((item) => typeof item !== "string")) return null;
  if (!Array.isArray(raw.findings)) return null;
  const findings: ReviewFinding[] = [];
  for (const item of raw.findings) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const finding = item as Record<string, unknown>;
    if (
      typeof finding.id !== "string" ||
      typeof finding.severity !== "string" ||
      !isWorkflowSeverity(finding.severity) ||
      typeof finding.title !== "string" ||
      typeof finding.detail !== "string"
    ) {
      return null;
    }
    for (const key of ["target", "suggestedFix"] as const) {
      if (finding[key] !== undefined && typeof finding[key] !== "string") return null;
    }
    findings.push(finding as ReviewFinding);
  }
  return { verdict: raw.verdict, summary: raw.summary, evidence: raw.evidence, findings } as ReviewResult;
}

const SEVERITY_ORDER: Record<WorkflowSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  nit: 3,
};

export function dedupeFindings(
  findings: Array<ReviewFinding & { sourceNode?: string }>,
): Array<ReviewFinding & { sourceNode?: string }> {
  const unique = new Map<string, ReviewFinding & { sourceNode?: string }>();
  for (const finding of findings) {
    const key = [finding.sourceNode ?? "", finding.id, finding.target ?? "", finding.severity].join("\u0000");
    if (!unique.has(key)) unique.set(key, clone(finding));
  }
  return [...unique.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.sourceNode ?? "").localeCompare(b.sourceNode ?? "") ||
      a.id.localeCompare(b.id) ||
      (a.target ?? "").localeCompare(b.target ?? ""),
  );
}

export function blockingFindings(
  result: ReviewResult,
  blockingSeverities: readonly WorkflowSeverity[],
): ReviewFinding[] {
  const allowed = new Set(blockingSeverities);
  return dedupeFindings(result.findings).filter((finding) => allowed.has(finding.severity));
}

export type WorkflowGateDecision =
  | { decision: "pass" }
  | { decision: "return_to_implement"; findings: ReviewFinding[] }
  | { decision: "pause"; reason: "blocked" | "failed" | "unknown_result" }
  | { decision: "skip" };

export function evaluateReviewGate(input: {
  status: "succeeded" | "failed" | "skipped";
  result: ReviewResult | null;
  config: WorkflowNodeConfig;
  overrideGate?: boolean;
}): WorkflowGateDecision {
  if (input.status === "failed" || !input.result) return { decision: "pause", reason: "failed" };
  if (input.status === "skipped" || input.result.verdict === "skipped") {
    if (input.config.gate.optional || input.overrideGate) return { decision: "skip" };
    return { decision: "pause", reason: "unknown_result" };
  }
  if (input.result.verdict === "blocked") return { decision: "pause", reason: "blocked" };
  const findings = blockingFindings(input.result, input.config.gate.blockingSeverities);
  if (findings.length) return { decision: "return_to_implement", findings };
  return { decision: "pass" };
}

export function validateWorkflowNodeKind(
  nodeKey: WorkflowNodeKey,
  kind: WorkflowNodeKind,
): void {
  if (!isWorkflowNodeKey(nodeKey)) throw new WorkflowValidationError("unknown workflow node");
  if (nodeKey === "implement_ui" && kind !== "implement") {
    throw new WorkflowValidationError("implement_ui must use implement kind");
  }
  if (nodeKey !== "implement_ui" && kind !== "review") {
    throw new WorkflowValidationError(`${nodeKey} must use review kind`);
  }
}
