import { getSetting } from "./db";
import {
  MEMORY_AUTO_EXTRACT_SETTING_KEY,
  MEMORY_ENABLED_SETTING_KEY,
  MEMORY_WRITE_APPROVAL_SETTING_KEY,
} from "./memory-settings";

/** Resolve the shared memory write gate at the point a row is written. */
export function isMemoryWriteApprovalEnabled(): boolean {
  try {
    return getSetting(MEMORY_WRITE_APPROVAL_SETTING_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Master switch for injection and extraction, resolved at each use so a toggle
 * takes effect without a restart. Only `"0"` disables: an unset value (and an
 * unreadable settings table) keeps the feature on, because turning memory off
 * must be a deliberate user choice rather than a side effect of a failed read.
 *
 * Disabling does not delete anything; stored rows stay readable and removable
 * from the settings UI.
 */
export function isMemoryEnabled(): boolean {
  try {
    return getSetting(MEMORY_ENABLED_SETTING_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * Shared gate for automatic extraction (assistant-completed / goal-completed /
 * idle triggers). The master switch wins: with memory off, a background
 * extraction would burn model tokens for rows that can never be written or
 * injected. Only `memory.auto_extract = "0"` additionally disables it.
 */
export function isAutoExtractEnabled(): boolean {
  if (!isMemoryEnabled()) return false;
  try {
    return getSetting(MEMORY_AUTO_EXTRACT_SETTING_KEY) !== "0";
  } catch {
    return true;
  }
}
