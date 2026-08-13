export declare const DEFAULT_CONTROL_URL: string;

export function isLoopbackControlUrl(raw: string): boolean;

export function resolveHostControlUrl(options?: {
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  read?: (path: string, encoding: "utf8") => string;
}): string;
