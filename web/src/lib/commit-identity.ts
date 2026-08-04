import {
  COMMIT_AUTHOR_EMAIL_KEY,
  COMMIT_AUTHOR_NAME_KEY,
  isValidCommitAuthorEmail,
  isValidCommitAuthorName,
} from "./commit-identity-keys";
import { getSetting } from "./db";

/**
 * Commit author override.
 *
 * By default every WebUI-driven commit is stamped with the executing agent
 * (`build <build@opencode.local>`) so the work stays attributable. That is
 * useless for repositories the user actually pushes: GitHub/GitLab cannot map
 * `@opencode.local` to an account and `git shortlog` shows a robot instead of
 * the person responsible. These settings let the user pin a real identity that
 * is used both by the commit API and by the Git identity written into isolated
 * workspaces (worktree / temporary copy).
 *
 * Each field falls back independently, so setting only the name keeps the
 * agent-derived email and vice versa.
 */
export type CommitIdentity = { name: string; email: string };

function readOverride(key: string, isValid: (value: string) => boolean): string | null {
  const raw = getSetting(key)?.trim() ?? "";
  return raw.length > 0 && isValid(raw) ? raw : null;
}

/** The configured override, with `null` for a field left unset or invalid. */
export function readCommitIdentityOverride(): {
  name: string | null;
  email: string | null;
} {
  return {
    name: readOverride(COMMIT_AUTHOR_NAME_KEY, isValidCommitAuthorName),
    email: readOverride(COMMIT_AUTHOR_EMAIL_KEY, isValidCommitAuthorEmail),
  };
}

/** Identity to stamp on a commit made by `agentName`, applying the override. */
export function resolveCommitIdentity(agentName: string): CommitIdentity {
  const override = readCommitIdentityOverride();
  return {
    name: override.name ?? agentName,
    email: override.email ?? `${agentName}@opencode.local`,
  };
}
