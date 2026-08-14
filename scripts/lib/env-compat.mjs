/**
 * Env-var compatibility shim for the OPENCODE_WEBUI_* to LEAFCODE_*
 * rebrand (P3). Long-term support (not a deprecation window): every process
 * entry point (host, web next.config, MCP servers, browser-bridge scripts)
 * copies a legacy OPENCODE_WEBUI_* value onto the new LEAFCODE_* name
 * when the new one is unset, so existing user configuration keeps working
 * unchanged.
 *
 * The mapping is generic (any OPENCODE_WEBUI_<suffix> to LEAFCODE_<suffix>)
 * so no per-variable registry is needed; NEXT_PUBLIC_OPENCODE_WEBUI_* is
 * handled the same way for build-time-inlined variables.
 */
const LEGACY_PREFIX = "OPENCODE_WEBUI_";
const NEW_PREFIX = "LEAFCODE_";

const LEGACY_NEXT_PUBLIC_PREFIX = "NEXT_PUBLIC_OPENCODE_WEBUI_";
const NEW_NEXT_PUBLIC_PREFIX = "NEXT_PUBLIC_LEAFCODE_";

/**
 * Copy legacy OPENCODE_WEBUI_* (and NEXT_PUBLIC_OPENCODE_WEBUI_*) values onto
 * the LEAFCODE_* names, unless the new name is already set (new name
 * wins). Mutates the passed env object (defaults to process.env). Idempotent.
 */
export function normalizeWebuiEnv(env = process.env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith(LEGACY_PREFIX)) {
      const nextKey = NEW_PREFIX + key.slice(LEGACY_PREFIX.length);
      if (env[nextKey] === undefined) env[nextKey] = env[key];
    } else if (key.startsWith(LEGACY_NEXT_PUBLIC_PREFIX)) {
      const nextKey = NEW_NEXT_PUBLIC_PREFIX + key.slice(LEGACY_NEXT_PUBLIC_PREFIX.length);
      if (env[nextKey] === undefined) env[nextKey] = env[key];
    }
  }
  return env;
}
