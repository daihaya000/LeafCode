import http from 'http';

/**
 * Match a host-control HTTP route.
 * @param {string} method
 * @param {string} pathname
 * @returns {'webui' | 'opencode' | 'all' | 'health' | 'stop-webui' | null}
 */
export function matchControlRoute(method, pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const m = method.toUpperCase();
  if (m === 'GET' && path === '/health') return 'health';
  if (m !== 'POST') return null;
  if (path === '/restart/webui') return 'webui';
  if (path === '/restart/opencode') return 'opencode';
  if (path === '/restart/all') return 'all';
  if (path === '/stop/webui') return 'stop-webui';
  return null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Request handler for the localhost control plane. Exported so it can be
 * exercised without binding a TCP port.
 * @param {{
 *   onRestartWebui: () => Promise<void> | void,
 *   onRestartOpencode: () => Promise<void> | void,
 *   onRestartAll: () => Promise<void> | void,
 *   onStopWebui?: () => Promise<void> | void,
 * }} handlers
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>}
 */
export function createControlRequestHandler(handlers) {
  return async (req, res) => {
    const method = req.method ?? 'GET';
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      pathname = '/';
    }

    const route = matchControlRoute(method, pathname);
    if (!route) {
      res.writeHead(404, JSON_HEADERS);
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    if (route === 'health') {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, service: 'opencode-webui-host' }));
      return;
    }

    if (route === 'stop-webui') {
      // Unlike restart, the caller (build.bat) must know the port is actually
      // free before it overwrites web/.next, so respond only after the stop
      // completes. A 501 tells the caller this host cannot stop the WebUI, so
      // it must not fall back to killing (the host would just restart it).
      if (typeof handlers.onStopWebui !== 'function') {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'stop is not supported by this host' }));
        return;
      }
      try {
        await handlers.onStopWebui();
      } catch (err) {
        res.writeHead(500, JSON_HEADERS);
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, target: 'webui', stopped: true }));
      return;
    }

    // Acknowledge before killing WebUI so the caller can flush the response.
    res.writeHead(202, JSON_HEADERS);
    res.end(JSON.stringify({ ok: true, target: route, accepted: true }));

    const run =
      route === 'webui'
        ? handlers.onRestartWebui
        : route === 'opencode'
          ? handlers.onRestartOpencode
          : handlers.onRestartAll;

    setImmediate(() => {
      Promise.resolve()
        .then(() => run())
        .catch(() => {
          // Errors are logged by the host restart functions.
        });
    });
  };
}

/**
 * Localhost-only control plane for tray / WebUI restart actions.
 * @param {{
 *   onRestartWebui: () => Promise<void> | void,
 *   onRestartOpencode: () => Promise<void> | void,
 *   onRestartAll: () => Promise<void> | void,
 *   onStopWebui?: () => Promise<void> | void,
 * }} handlers
 */
export function createControlServer(handlers) {
  const handle = createControlRequestHandler(handlers);
  return http.createServer((req, res) => {
    void handle(req, res);
  });
}

/**
 * @param {import('http').Server} server
 * @param {number} port
 * @returns {Promise<void>}
 */
export function listenControlServer(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * @param {import('http').Server | null} server
 * @returns {Promise<void>}
 */
export function closeControlServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
