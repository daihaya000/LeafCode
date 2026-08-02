import { getDb } from "./db";
import { browserBrokerFetch } from "./browser-bridge";
import type { WorkflowPromptArtifact } from "./workflow-prompt";

export type WorkflowArtifactOrigin = "task_attachment" | "shared_tab" | "browser_bridge";
export type BrowserBridgeArtifactState = "ready" | "attention" | "blocked" | "failed";

export class BrowserBridgeArtifactError extends Error {
  constructor(readonly code: string, readonly state: BrowserBridgeArtifactState, readonly status: number) {
    super(`Browser Bridge artifact unavailable: ${code}`);
  }
}

export type WorkflowArtifactInput = {
  workflowRunId: string;
  nodeAttemptId?: string;
  kind: "screenshot";
  label: string;
  opaqueRef: string;
  origin: WorkflowArtifactOrigin;
  expiresAt?: string;
  metadata?: { tabId?: string; origin?: string; sourceId?: string };
};

const OPAQUE_REF = /^[A-Za-z0-9_:/.-]{1,512}$/;
const SAFE_CODES = new Set(["APPROVAL_REQUIRED", "TAB_NOT_SHARED", "EXTENSION_DISCONNECTED", "NOT_PAIRED", "POLICY_BLOCKED", "COMMAND_TIMEOUT", "PAYLOAD_TOO_LARGE", "INVALID_REQUEST", "PROTOCOL_MISMATCH"]);

export function mapBrowserBridgeError(code: string): BrowserBridgeArtifactState {
  if (code === "APPROVAL_REQUIRED") return "attention";
  if (["TAB_NOT_SHARED", "EXTENSION_DISCONNECTED", "NOT_PAIRED", "POLICY_BLOCKED", "COMMAND_TIMEOUT", "PROTOCOL_MISMATCH"].includes(code)) return "blocked";
  return "failed";
}

export function validateWorkflowArtifact(input: WorkflowArtifactInput): void {
  if (input.kind !== "screenshot") throw new TypeError("Only screenshot artifacts are supported");
  if (!input.label.trim() || input.label.length > 256) throw new TypeError("Invalid artifact label");
  if (!OPAQUE_REF.test(input.opaqueRef) || input.opaqueRef.startsWith("data:") || input.opaqueRef.includes("base64")) throw new TypeError("Artifact must use an opaque reference");
  if (input.metadata && JSON.stringify(input.metadata).length > 2_000) throw new TypeError("Artifact metadata is too large");
}

export function saveWorkflowArtifact(input: WorkflowArtifactInput): string {
  validateWorkflowArtifact(input);
  const id = crypto.randomUUID();
  getDb().prepare(
    `INSERT INTO workflow_artifacts (id, workflow_run_id, node_attempt_id, kind, label, opaque_ref, expires_at, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.workflowRunId, input.nodeAttemptId ?? null, input.kind, input.label.trim(), input.opaqueRef, input.expiresAt ?? null, JSON.stringify(input.metadata ?? {}), new Date().toISOString());
  return id;
}

export function workflowArtifactsForPrompt(workflowRunId: string): WorkflowPromptArtifact[] {
  const rows = getDb().prepare(
    `SELECT id, kind, label, opaque_ref, expires_at FROM workflow_artifacts
     WHERE workflow_run_id = ? AND kind = 'screenshot' AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at ASC`,
  ).all(workflowRunId, new Date().toISOString()) as Array<{ id: string; kind: "screenshot"; label: string; opaque_ref: string | null; expires_at: string | null }>;
  return rows.filter((row) => row.opaque_ref).map((row) => ({ id: row.id, kind: row.kind, label: row.label, opaqueRef: row.opaque_ref!, ...(row.expires_at ? { expiresAt: row.expires_at } : {}) }));
}

export function isKnownBrowserBridgeCode(code: string): boolean {
  return SAFE_CODES.has(code);
}

export async function verifyBrowserBridgeScreenshot(input: {
  tabId: string;
  opaqueRef: string;
  expectedOrigin?: string;
}): Promise<{ origin: string; title: string }> {
  if (input.opaqueRef !== `browser-bridge:${input.tabId}`) {
    throw new BrowserBridgeArtifactError("INVALID_ARTIFACT_REFERENCE", "failed", 400);
  }
  const response = await browserBrokerFetch("/internal/tools/browser_list_tabs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response) throw new BrowserBridgeArtifactError("BROKER_UNAVAILABLE", "blocked", 503);
  const payload = await response.json().catch(() => null) as { tabs?: Array<{ id?: string; origin?: string; title?: string }>; error?: { code?: string } } | null;
  if (!response.ok) {
    const code = typeof payload?.error?.code === "string" ? payload.error.code : "BROKER_ERROR";
    throw new BrowserBridgeArtifactError(code, mapBrowserBridgeError(code), response.status === 428 ? 428 : 503);
  }
  const tab = payload?.tabs?.find((candidate) => candidate.id === input.tabId);
  if (!tab?.origin || !tab.title) throw new BrowserBridgeArtifactError("TAB_NOT_SHARED", "blocked", 409);
  if (input.expectedOrigin && input.expectedOrigin !== tab.origin) {
    throw new BrowserBridgeArtifactError("TAB_OWNERSHIP_MISMATCH", "blocked", 409);
  }
  return { origin: tab.origin, title: tab.title };
}
