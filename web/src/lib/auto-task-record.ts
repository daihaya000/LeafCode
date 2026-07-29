/**
 * Per-task Auto selection record, handed from HomeView to TaskView through
 * `sessionStorage`.
 *
 * `sessionStorage` (tab-scoped, non-persistent) is deliberate: the decision is
 * only needed for a transient chip and a single automatic retry, so no DB
 * schema change is required. Re-opening a task in a new tab simply shows no
 * chip and performs no retry.
 *
 * Kept out of `auto-model.ts` because that module must stay pure and
 * server-importable; everything here touches a browser-only global.
 */

import {
  DEFAULT_AUTO_OPTIMIZE_MODE,
  isAutoOptimizeMode,
  type AutoDecision,
} from "./auto-model";
import type { IntelligenceVariant } from "./model-variants";

export type AutoTaskRecord = {
  decision: AutoDecision;
  /** Original prompt for the automatic retry. Omitted = retry disabled. */
  prompt?: string;
  /** Agent selected for the original submission, replayed on retry. */
  agent?: string;
  /** Already retried once (prevents a second escalation send). */
  retried?: boolean;
  /** Chip closed by the user (the key itself is kept for `retried`). */
  dismissed?: boolean;
};

/** Prompts longer than this are not stored, which disables the retry. */
export const AUTO_TASK_PROMPT_MAX = 16_000;

export function autoTaskStorageKey(taskId: string): string {
  return `webui:auto-task:${taskId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseDecision(value: unknown): AutoDecision | null {
  if (!isRecord(value)) return null;
  const { providerID, modelID, variant, tier, mode, reason, escalation } =
    value;
  if (typeof providerID !== "string" || !providerID) return null;
  if (typeof modelID !== "string" || !modelID) return null;
  if (typeof variant !== "string") return null;
  if (tier !== "light" && tier !== "standard" && tier !== "heavy") return null;
  if (typeof reason !== "string") return null;
  const decision: AutoDecision = {
    providerID,
    modelID,
    variant: variant as IntelligenceVariant | "",
    tier,
    // Records written before optimize modes existed carry no `mode`; treat
    // them (and any corrupted value) as the default rather than dropping the
    // record, which would silently disable the retry.
    mode: isAutoOptimizeMode(mode) ? mode : DEFAULT_AUTO_OPTIMIZE_MODE,
    reason,
  };
  if (isRecord(escalation)) {
    const escalationProvider = escalation.providerID;
    const escalationModel = escalation.modelID;
    const escalationVariant = escalation.variant;
    if (
      typeof escalationProvider === "string" &&
      escalationProvider &&
      typeof escalationModel === "string" &&
      escalationModel &&
      typeof escalationVariant === "string"
    ) {
      decision.escalation = {
        providerID: escalationProvider,
        modelID: escalationModel,
        variant: escalationVariant as IntelligenceVariant | "",
      };
    }
  }
  return decision;
}

/**
 * Read the record for a task. Returns null when absent, unreadable, or
 * malformed (e.g. written by an older version).
 */
export function readAutoTaskRecord(taskId: string): AutoTaskRecord | null {
  if (typeof sessionStorage === "undefined") return null;
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(autoTaskStorageKey(taskId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const decision = parseDecision(parsed.decision);
    if (!decision) return null;
    return {
      decision,
      ...(optionalString(parsed.prompt) ? { prompt: parsed.prompt as string } : {}),
      ...(optionalString(parsed.agent) ? { agent: parsed.agent as string } : {}),
      ...(parsed.retried === true ? { retried: true } : {}),
      ...(parsed.dismissed === true ? { dismissed: true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Persist the record. Returns false when the write fails (quota, disabled
 * storage): callers that rely on the write for correctness — the one-shot
 * retry guard — must abort instead of proceeding.
 */
export function writeAutoTaskRecord(
  taskId: string,
  record: AutoTaskRecord,
): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    sessionStorage.setItem(autoTaskStorageKey(taskId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
