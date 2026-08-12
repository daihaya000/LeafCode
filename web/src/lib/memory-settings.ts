/** Server/client-safe keys used by the memory settings UI and write gate. */
export const MEMORY_AUTO_EXTRACT_SETTING_KEY = "memory.auto_extract";
export const MEMORY_WRITE_APPROVAL_SETTING_KEY = "memory.write_approval";
/**
 * Master switch for the whole memory layer. Stored as `"0"` (off) / `"1"` (on),
 * and unset means on: the feature predates this switch, so an untouched install
 * must keep behaving the way it already does.
 */
export const MEMORY_ENABLED_SETTING_KEY = "memory.enabled";
