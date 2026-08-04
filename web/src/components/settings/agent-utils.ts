/**
 * Pure helpers for the settings "エージェント" tab.
 *
 * The OpenCode `/agent` endpoint returns a flat list. Subagents follow the
 * naming convention `<rank>-<role>-<provider>-<model>` (rank a–e), but because
 * both the provider and model segments can themselves contain hyphens, the name
 * alone is ambiguous. We therefore only attempt to parse rank/role when the
 * agent carries an explicit `model`, and only when the trailing part of the name
 * matches the kebab-cased provider/model pair.
 */

/**
 * Where an agent's definition lives:
 * - "project": this project's `.opencode/agents/` or its `opencode.jsonc`.
 * - "global": `~/.config/opencode/agents/` or its `opencode.jsonc`.
 * - "builtin": shipped with OpenCode itself (e.g. `build`, `plan`, `general`);
 *   not backed by any file on disk.
 */
export type AgentScope = "global" | "project" | "builtin";

export type AgentDto = {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  model?: { providerID: string; modelID: string };
  enabled?: boolean;
  toggleable?: boolean;
  /** Omitted when the source hasn't been resolved (e.g. hand-built fixtures). */
  scope?: AgentScope;
  /** Display-friendly path (e.g. `~/.config/opencode/agents/foo.md` or
   *  `.opencode/agents/foo.md`); `null` for "builtin" or when unresolved. */
  sourcePath?: string | null;
};

export type AgentRank = "A" | "B" | "C" | "D" | "E";

export type ParsedAgent = AgentDto & {
  /** Parsed rank ("A"–"E") or null when the name did not match the convention. */
  rank: AgentRank | null;
  /** Parsed role, or null when unparsed. */
  role: string | null;
  /** Role when parsed, otherwise the raw name. Used as the primary label. */
  displayName: string;
};

export type AgentGroup = {
  /** "A"–"E" for ranked groups, or "other". */
  key: AgentRank | "other";
  title: string;
  agents: ParsedAgent[];
};

const RANKS: AgentRank[] = ["A", "B", "C", "D", "E"];

/** Lowercase kebab-case: collapse any non-alphanumeric run into a single dash. */
function kebab(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse a single agent, extracting rank/role only when the model is present and
 * the name ends with the kebab-cased `-<provider>-<model>` suffix.
 */
export function parseAgent(dto: AgentDto): ParsedAgent {
  const unparsed: ParsedAgent = {
    ...dto,
    rank: null,
    role: null,
    displayName: dto.name,
  };

  const model = dto.model;
  if (!model) return unparsed;

  const rankMatch = /^([a-e])-/.exec(dto.name);
  if (!rankMatch) return unparsed;

  const providerKebab = kebab(model.providerID);
  const modelIdRaw = model.modelID.includes("/")
    ? model.modelID.slice(model.modelID.lastIndexOf("/") + 1)
    : model.modelID;
  const modelKebab = kebab(modelIdRaw);
  if (!providerKebab || !modelKebab) return unparsed;

  const suffix = `-${providerKebab}-${modelKebab}`;
  if (!dto.name.endsWith(suffix)) return unparsed;

  const role = dto.name.slice(2, dto.name.length - suffix.length);
  if (!role) return unparsed;

  const rank = rankMatch[1].toUpperCase() as AgentRank;
  return { ...dto, rank, role, displayName: role };
}

/** Japanese label for an agent's scope, used by the settings table and search. */
export function scopeLabel(scope: AgentScope | undefined): string {
  switch (scope) {
    case "project":
      return "プロジェクト";
    case "global":
      return "グローバル";
    default:
      return "ビルトイン";
  }
}

/** Case-insensitive substring search over name/role/provider/model/desc/mode/state/scope/path. */
export function filterAgents(
  agents: ParsedAgent[],
  query: string,
): ParsedAgent[] {
  const q = query.trim().toLowerCase();
  if (!q) return agents;
  return agents.filter((a) => {
    const stateLabel = a.enabled === false ? "無効" : "有効";
    const haystack = [
      a.name,
      a.role ?? "",
      a.model?.providerID ?? "",
      a.model?.modelID ?? "",
      a.description ?? "",
      a.mode,
      stateLabel,
      scopeLabel(a.scope),
      a.sourcePath ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function byRoleThenName(a: ParsedAgent, b: ParsedAgent): number {
  const roleA = (a.role ?? "").toLowerCase();
  const roleB = (b.role ?? "").toLowerCase();
  if (roleA !== roleB) return roleA < roleB ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function byName(a: ParsedAgent, b: ParsedAgent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Group agents into Rank A→E sections followed by "その他のエージェント".
 * Empty groups are omitted. Ranked groups sort by role then name; the "other"
 * group sorts by name.
 */
export function groupAgents(agents: ParsedAgent[]): AgentGroup[] {
  const groups: AgentGroup[] = [];

  for (const rank of RANKS) {
    const members = agents
      .filter((a) => a.rank === rank)
      .sort(byRoleThenName);
    if (members.length > 0) {
      groups.push({ key: rank, title: `Rank ${rank}`, agents: members });
    }
  }

  const others = agents.filter((a) => a.rank === null).sort(byName);
  if (others.length > 0) {
    groups.push({ key: "other", title: "その他のエージェント", agents: others });
  }

  return groups;
}
