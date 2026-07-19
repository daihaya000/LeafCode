/**
 * Best-effort mapping from a subagent naming convention to an OpenCode
 * provider id.
 *
 * Subagent types follow `<rank>-<role>-<provider>-<model>`, e.g.
 * `c-explore-opencode-go-kimi-k2-7-code`. We look for a known provider token
 * delimited by hyphen boundaries, preferring the longest match so that
 * multi-word providers (`opencode-go`, `ollama-cloud`) win over their prefixes.
 */
const KNOWN_PROVIDER_TOKENS = [
  "opencode-go",
  "ollama-cloud",
  "anthropic",
  "openai",
  "cursor",
  "ollama",
] as const;

// Longest-first so "opencode-go" beats a hypothetical "opencode", and
// "ollama-cloud" beats "ollama".
const PROVIDERS_BY_LENGTH = [...KNOWN_PROVIDER_TOKENS].sort(
  (a, b) => b.length - a.length,
);

export function providerIdFromSubagentType(
  subagentType: string | null | undefined,
): string | null {
  if (!subagentType) return null;
  const name = subagentType.toLowerCase();
  const tokens = name.split("-").filter(Boolean);
  if (tokens.length === 0) return null;

  for (const provider of PROVIDERS_BY_LENGTH) {
    const parts = provider.split("-");
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      let match = true;
      for (let j = 0; j < parts.length; j++) {
        if (tokens[i + j] !== parts[j]) {
          match = false;
          break;
        }
      }
      if (match) return provider;
    }
  }
  return null;
}
