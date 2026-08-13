/**
 * HTTP health checks and service readiness waiting for the host process
 * (REFACTORING_PLAN P6-a / IMPROVEMENT 4-1: Web build/start group).
 * Pure waiting logic; logging, sleeping and port probes are injected so the
 * host can wire its own log pipeline (recordLog) into it.
 */
import { isPortInUse } from './port-scanner.js';

/**
 * @param {import('child_process').ChildProcess | null | undefined} proc
 * @returns {boolean}
 */
export function procRunning(proc) {
  return proc != null && proc.exitCode == null && !proc.killed;
}

/**
 * @param {{
 *   log?: (message: string) => void,
 *   error?: (message: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   isPortInUse?: (port: number) => boolean,
 * }} [deps]
 */
export function createHttpWaiter(deps = {}) {
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? (() => {});
  const error = deps.error ?? (() => {});
  const isPortBusy = deps.isPortInUse ?? isPortInUse;

  const isHttpUp = async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      return res.status < 500;
    } catch {
      return false;
    }
  };

  const waitForHttpUp = async (url, attempts = 1, delayMs = 1000) => {
    for (let i = 0; i < attempts; i += 1) {
      if (await isHttpUp(url)) return true;
      if (i < attempts - 1) await sleep(delayMs);
    }
    return false;
  };

  /** Poll interval while waiting for a child service to answer HTTP. */
  const READY_POLL_MS = 250;

  /**
   * @param {number} attempts Timeout in seconds. The name is historical: the loop
   *   used to probe once per second. Probing every 250 ms instead returns up to
   *   ~750 ms sooner on a normal start while keeping the same overall timeout.
   */
  const waitUntilReady = async (
    url,
    label,
    attempts = 60,
    { proc, pollMs = READY_POLL_MS } = {},
  ) => {
    const iterations = Math.max(1, Math.ceil((attempts * 1000) / pollMs));
    for (let i = 0; i < iterations; i += 1) {
      if (await isHttpUp(url)) {
        log(`${label} is ready`);
        return true;
      }
      // ServeError / crash: fail fast instead of waiting the full timeout.
      if (proc && !procRunning(proc())) {
        error(`${label} exited before becoming ready (${url})`);
        return false;
      }
      await sleep(pollMs);
    }
    error(`${label} did not become ready in time (${url})`);
    return false;
  };

  const waitForPortFree = async (port, attempts = 40) => {
    for (let i = 0; i < attempts; i += 1) {
      if (!isPortBusy(port)) return true;
      await sleep(250);
    }
    return !isPortBusy(port);
  };

  return { isHttpUp, waitForHttpUp, waitUntilReady, waitForPortFree };
}
