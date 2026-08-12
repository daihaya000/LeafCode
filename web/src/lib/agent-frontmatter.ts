/**
 * Client-safe agent definition frontmatter helpers (no Node I/O).
 *
 * OpenCode agent markdown files carry the same options as the JSON `agent.<name>`
 * entry in their frontmatter, including `disable: true`
 * (see https://opencode.ai/docs/agents#disable). The settings UI toggles an
 * agent by flipping that key rather than by moving the file, so the definition
 * keeps living where OpenCode expects it and the change survives a WebUI reset.
 *
 * Deliberately not a full YAML implementation — `disable`, `description`, and
 * `mode` are single-line scalars in every agent file OpenCode accepts.
 */

const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n[\s\S]*)?$/;

type Frontmatter = {
  open: string;
  body: string;
  close: string;
  rest: string;
};

function splitFrontmatter(markdown: string): Frontmatter | null {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return null;
  return {
    open: match[1],
    body: match[2],
    close: match[3],
    rest: match[4] ?? "",
  };
}

function isTruthyScalar(value: string): boolean {
  return /^(true|yes|on|1)$/i.test(value.trim().replace(/^["']|["']$/g, ""));
}

/** Top-level `key: value` line (nested/indented keys are ignored). */
function topLevelKey(line: string, key: string): RegExpExecArray | null {
  return new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line);
}

/**
 * True when the agent definition disables itself via `disable: true`.
 * Missing frontmatter or a missing key both mean "enabled".
 */
export function isAgentDisabled(markdown: string): boolean {
  const fm = splitFrontmatter(markdown);
  if (!fm) return false;
  for (const line of fm.body.split(/\r?\n/)) {
    const kv = topLevelKey(line, "disable");
    if (kv) return isTruthyScalar(kv[1]);
  }
  return false;
}

/** Convenience inverse of {@link isAgentDisabled}. */
export function isAgentEnabled(markdown: string): boolean {
  return !isAgentDisabled(markdown);
}

export type AgentFrontmatter = {
  description?: string;
  mode?: "subagent" | "primary" | "all";
  model?: { providerID: string; modelID: string };
  disabled: boolean;
};

/**
 * Read the handful of fields the settings list needs to render an agent whose
 * definition file exists but which the engine no longer reports (because the
 * file disables itself).
 */
export function parseAgentFrontmatter(markdown: string): AgentFrontmatter {
  const fm = splitFrontmatter(markdown);
  if (!fm) return { disabled: false };
  const result: AgentFrontmatter = { disabled: false };
  for (const line of fm.body.split(/\r?\n/)) {
    const disable = topLevelKey(line, "disable");
    if (disable) {
      result.disabled = isTruthyScalar(disable[1]);
      continue;
    }
    const description = topLevelKey(line, "description");
    if (description && result.description === undefined) {
      const value = unquote(description[1]);
      if (value) result.description = value;
      continue;
    }
    const mode = topLevelKey(line, "mode");
    if (mode && result.mode === undefined) {
      const value = unquote(mode[1]);
      if (value === "subagent" || value === "primary" || value === "all") {
        result.mode = value;
      }
      continue;
    }
    const model = topLevelKey(line, "model");
    if (model && result.model === undefined) {
      const value = unquote(model[1]);
      const slash = value.indexOf("/");
      if (slash > 0 && slash < value.length - 1) {
        result.model = {
          providerID: value.slice(0, slash),
          modelID: value.slice(slash + 1),
        };
      }
    }
  }
  return result;
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").trim();
}

/**
 * Return `markdown` with `disable` set to `disabled`.
 *
 * Enabling removes the key entirely rather than writing `disable: false`, so a
 * definition that was never disabled stays byte-identical after a toggle
 * round-trip. Frontmatter is created when the file has none.
 */
export function setAgentDisabled(markdown: string, disabled: boolean): string {
  const fm = splitFrontmatter(markdown);
  if (!fm) {
    if (!disabled) return markdown;
    const separator = markdown.length > 0 ? "\n" : "";
    return `---\ndisable: true\n---\n${separator}${markdown}`;
  }

  const eol = fm.open.includes("\r\n") ? "\r\n" : "\n";
  const lines = fm.body.split(/\r?\n/);
  const index = lines.findIndex((line) => topLevelKey(line, "disable"));

  if (index === -1) {
    if (!disabled) return markdown;
    lines.push("disable: true");
  } else if (disabled) {
    lines[index] = "disable: true";
  } else {
    lines.splice(index, 1);
  }

  // Dropping the only key would leave an empty frontmatter block; keep it
  // syntactically valid by emitting `---\n---`.
  const body = lines.join(eol);
  return `${fm.open}${body}${fm.close}${fm.rest}`;
}
