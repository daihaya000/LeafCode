export declare const HOST_PLAYWRIGHT_CLI_PATH: string;
export declare const MAX_ARGV: number;
export declare const MAX_ARG_CHARS: number;
export declare const DEFAULT_TIMEOUT_MS: number;

export function playwrightCliWrapDir(repoRoot: string): string;

export function prependPlaywrightCliWrapPath(
  env: NodeJS.ProcessEnv,
  repoRoot: string,
  platform?: string,
): NodeJS.ProcessEnv;

export function resolvePlaywrightCliJs(
  env?: NodeJS.ProcessEnv,
  exists?: (path: string) => boolean,
): string;

export function parsePlaywrightCliRequest(body: unknown):
  | { argv: string[]; cwd: string }
  | { error: string };

export function runPlaywrightCliProcess(opts: {
  execPath?: string;
  cliJs: string;
  argv: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof import("node:child_process").spawn;
  timeoutMs?: number;
}): Promise<{
  code: number;
  signal: NodeJS.Signals | string | null;
  stdout: string;
  stderr: string;
}>;

export function runViaHost(opts: {
  argv: string[];
  cwd: string;
  controlUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ code: number; stdout: string; stderr: string }>;

export function runWrappedCli(opts: {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  fetchFn?: typeof fetch;
  spawnFn?: typeof import("node:child_process").spawn;
  platform?: string;
}): Promise<number>;
