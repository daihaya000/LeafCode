export type EnvMap = Record<string, string>;

export type McpDefinition = {
  type?: "local" | "remote";
  command?: string[];
  url?: string;
  headers?: EnvMap;
  environment?: EnvMap;
  enabled?: boolean;
};

export type ClaudeMcpEntry = {
  type?: string;
  url?: string;
  headers?: EnvMap;
  command?: string;
  args?: string[];
  env?: EnvMap;
};

export function tomlString(v: string): string;

export function tomlArray(arr: string[]): string;

export function isEnvRef(v: string): boolean;

export function envValueToCodex(v: string): string;

export function envValueToClaude(v: string): string;

export function filterEnv(env: EnvMap | undefined): EnvMap;

export function opencodeMcpToCodex(
  name: string,
  def: McpDefinition,
): string | null;

export function opencodeMcpToClaude(
  name: string,
  def: McpDefinition,
): ClaudeMcpEntry | null;

export function replaceCodexMcpTables(
  tomlText: string,
  newBlocks: string[],
): string;
