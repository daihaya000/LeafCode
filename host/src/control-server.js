import http from 'http';

/**
 * Match a host-control HTTP route.
 * @param {string} method
 * @param {string} pathname
 * @returns {'webui' | 'opencode' | 'all' | 'health' | null}
 */
export function matchControlRoute(method, pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const m = method.toUpperCase();
  if (m === 'GET' && path === '/health') return 'health';
  if (m !== 'POST') return null;
  if (path === '/restart/webui') return 'webui';
  if (path === '/restart/opencode') return 'opencode';
  if (path === '/restart/all') return 'all';
  return null;
}

/**
 * Localhost-only control plane for tray / WebUI restart actions.
 * @param {{
 *   onRestartWebui: () => Promise<void> | void,
 *   onRestartOpencode: () => Promise<void> | void,
 *   onRestartAll: () => Promise<void> | void,
 * }} handlers
 */
export function createControlServer(handlers) {
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      pathname = '/';
    }

    const route = matchControlRoute(method, pathname);
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    if (route === 'health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'opencode-webui-host' }));
      return;
    }

    // Acknowledge before killing WebUI so the caller can flush the response.
    res.writeHead(202, { 'Content-Type': 'application/json' });
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
  });

  return server;
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
