import { getSetting } from "./db";
import { MEMORY_WRITE_APPROVAL_SETTING_KEY } from "./memory-settings";

/** Resolve the shared memory write gate at the point a row is written. */
export function isMemoryWriteApprovalEnabled(): boolean {
  try {
    return getSetting(MEMORY_WRITE_APPROVAL_SETTING_KEY) === "1";
  } catch {
    return false;
  }
}
