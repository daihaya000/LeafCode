/**
 * Host control-plane path helpers.
 *
 * `resolveHostControlUrl` / `isLoopbackControlUrl` / `DEFAULT_CONTROL_URL` are
 * delegated to the shared `scripts/lib/host-control.mjs` implementation so the
 * loopback validation cannot drift between web and CLI (6-2 / REFACTORING_PLAN P1-a).
 */
export {
  DEFAULT_CONTROL_URL,
  isLoopbackControlUrl,
  resolveHostControlUrl,
} from "../../../scripts/lib/host-control.mjs";

export type HostRestartTarget = "webui" | "opencode" | "all";

export function hostRestartPath(target: HostRestartTarget): string {
  if (target === "webui") return "/restart/webui";
  if (target === "opencode") return "/restart/opencode";
  return "/restart/all";
}

export function hostVoiceInputPath(): string {
  return "/voice-input";
}

export function hostAllowFirewallPath(): string {
  return "/allow-firewall";
}

/** POST path that asks the tray host to quit after a graceful child stop. */
export function hostShutdownPath(): string {
  return "/shutdown";
}

/** GET path for the host log tail. `since` is the last-seen entry's `seq`. */
export function hostLogsPath(since: number | null): string {
  return since !== null && Number.isFinite(since)
    ? `/logs?since=${since}`
    : "/logs";
}
