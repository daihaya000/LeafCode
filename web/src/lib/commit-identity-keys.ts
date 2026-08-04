/**
 * Commit author override — keys and validation.
 *
 * Kept free of any Node-only import (the DB layer lives in `commit-identity`)
 * so the settings UI can reuse the same limits and validators in the browser.
 */
export const COMMIT_AUTHOR_NAME_KEY = "commit-author-name";
export const COMMIT_AUTHOR_EMAIL_KEY = "commit-author-email";

export const COMMIT_AUTHOR_NAME_MAX_CHARS = 128;
export const COMMIT_AUTHOR_EMAIL_MAX_CHARS = 254;

/**
 * Git writes the identity into the commit header as `Name <email>`, so `<`,
 * `>` and control characters (newlines above all) would corrupt the object —
 * or let a LAN client forge extra header lines through the unauthenticated
 * BFF. Ordinary spaces are fine; leading/trailing ones are rejected separately.
 */
function hasForbiddenIdentityChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
    if (ch === "<" || ch === ">") return true;
  }
  return false;
}

export function isValidCommitAuthorName(value: string): boolean {
  if (value.length === 0 || value.length > COMMIT_AUTHOR_NAME_MAX_CHARS) return false;
  if (value.trim() !== value) return false;
  return !hasForbiddenIdentityChars(value);
}

export function isValidCommitAuthorEmail(value: string): boolean {
  if (value.length === 0 || value.length > COMMIT_AUTHOR_EMAIL_MAX_CHARS) return false;
  return /^[^\s<>@,;]+@[^\s<>@,;]+$/.test(value);
}
