/**
 * Read a TCP port from an environment variable without allowing values that
 * Node's server APIs will reject later during startup.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function readPort(value, fallback) {
  if (!Number.isInteger(fallback) || fallback < 1 || fallback > 65_535) {
    throw new TypeError('Invalid fallback port');
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return fallback;
  const port = Number(value.trim());
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : fallback;
}
