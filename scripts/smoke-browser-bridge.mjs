/**
 * Browser Bridge smoke check. It never starts the host or Broker; run it only
 * in the environment created by the already-running tray host.
 */
const baseUrl = process.env.OPENCODE_WEBUI_BROWSER_BROKER;
const token = process.env.OPENCODE_WEBUI_BROWSER_BROKER_TOKEN;

if (!baseUrl || !token) {
  console.error("Browser Bridge Broker environment is unavailable; start the tray host first.");
  process.exitCode = 1;
} else {
  try {
    const base = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
      throw new Error("Broker URL must be loopback");
    }
    const response = await fetch(new URL('/internal/status', base), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`Broker status check failed (${response.status})`);
    }
    if (typeof body.pendingApprovals !== 'number' || !body.extension || typeof body.extension !== 'object') {
      throw new Error("Broker status response is invalid");
    }
    console.log(`OK  Browser Bridge Broker (${body.extension.connected ? 'extension connected' : 'extension disconnected'})`);
  } catch (error) {
    console.error(`FAIL Browser Bridge Broker: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
