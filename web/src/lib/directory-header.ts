/**
 * Helpers for attaching the workspace `directory` to OpenCode requests.
 *
 * HTTP header values are WebIDL `ByteString` and cannot carry characters
 * outside U+0000–U+00FF. Non-Latin-1 paths (e.g. Japanese) would make
 * `Headers.set()` / `fetch()` throw `... greater than 255`. The primary
 * transport is therefore the `?directory=` query parameter (auto
 * percent-encoded by `URLSearchParams`); the `x-opencode-directory` header
 * is sent only when the value is header-safe, for backward compatibility.
 *
 * This module is imported from both browser and server code, so it must not
 * depend on environment-specific APIs.
 */

/** True when every char is in U+0000–U+00FF and no CR/LF/NUL is present. */
export function isHeaderSafeValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0xff) return false;
    if (code === 0x0d || code === 0x0a || code === 0x00) return false;
  }
  return true;
}

/**
 * Build the `x-opencode-directory` header record for `directory`.
 *
 * Returns `{}` (never throws) when `directory` is empty or contains
 * characters that are unsafe in a header value.
 */
export function directoryHeaders(
  directory: string | null | undefined,
): Record<string, string> {
  if (!directory) return {};
  if (!isHeaderSafeValue(directory)) return {};
  return { "x-opencode-directory": directory };
}

/**
 * Set `?directory=` on `url` when `directory` is non-empty and return the
 * same `URL`. `URLSearchParams` percent-encodes non-ASCII automatically.
 */
export function withDirectoryQuery(
  url: URL,
  directory: string | null | undefined,
): URL {
  if (directory) {
    url.searchParams.set("directory", directory);
  }
  return url;
}