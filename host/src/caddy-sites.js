import { isLoopbackHost } from '../../scripts/lib/loopback.mjs';

/**
 * Keep the Caddyfile's HTTPS site addresses in sync with the machine's current
 * LAN IPs.
 *
 * `tls internal` only issues a certificate for names that are listed in the
 * site block, and a request whose Host matches no site block is refused before
 * TLS completes. So a hardcoded `https://192.168.0.102:8443` silently stops
 * working the moment DHCP hands out a different address, a second NIC joins
 * the same subnet, or the user switches between Wi-Fi and Ethernet — the phone
 * gets ERR_CONNECTION_FAILED while the host PC keeps working over loopback.
 *
 * This module rewrites only the IPv4 literals in that address list. Loopback
 * entries and user-authored hostnames/domains are preserved verbatim, so a
 * manually added `https://myhost:8443` or a public domain block is never lost.
 */

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Placeholder hostnames from the bundled example that are documentation only:
 * they must never be issued a certificate nor advertised as a public URL.
 * `example-hostname` is dropped from the site line whenever the sync runs.
 */
const PLACEHOLDER_HOSTS = new Set(['example-hostname']);

/** True for placeholder hostnames from the example that must never be advertised. */
export function isPlaceholderHost(host) {
  return typeof host === 'string' && PLACEHOLDER_HOSTS.has(host.toLowerCase());
}

/** True when `host` is a bare IPv4 literal (not a hostname/domain). */
export function isIpv4Literal(host) {
  if (typeof host !== 'string' || !IPV4_RE.test(host)) return false;
  return host.split('.').every((part) => {
    const n = Number(part);
    return String(n) === part && n >= 0 && n <= 255;
  });
}

/** True for addresses that must always stay in the list. */
/* isLoopbackHost is imported from scripts/lib/loopback.mjs (shared). */

/**
 * Split `https://host:port` into its host and port parts.
 * @param {string} entry
 */
function parseEntry(entry) {
  const m = /^https:\/\/(\[[^\]]+\]|[^:/\s]+)(?::(\d+))?$/i.exec(entry.trim());
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : null };
}

/**
 * Find the top-level site-address line that carries the HTTPS site block.
 *
 * Returns the line index plus the parsed entries, or null when the Caddyfile
 * has no such block (e.g. only a `:8080` listener).
 * @param {string[]} lines
 */
function findHttpsSiteLine(lines) {
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '').trim();
    if (line && depth === 0 && line.endsWith('{')) {
      const head = line.slice(0, -1).trim();
      if (head && /https:\/\//i.test(head)) {
        const entries = head.split(',').map((t) => t.trim()).filter(Boolean);
        // Only manage a list made entirely of parseable https:// entries so a
        // hand-written block with matchers or odd syntax is left untouched.
        const parsed = entries.map(parseEntry);
        if (parsed.every(Boolean)) {
          return { index: i, entries: /** @type {{host:string,port:number|null}[]} */ (parsed) };
        }
      }
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  return null;
}

/**
 * Rewrite the HTTPS site address list so it covers every current LAN IPv4.
 *
 * @param {string} text Caddyfile contents.
 * @param {string[]} addresses Current non-internal IPv4 addresses.
 * @returns {{ text: string, changed: boolean, addresses: string[] }}
 */
export function syncCaddySiteAddresses(text, addresses) {
  if (typeof text !== 'string' || !Array.isArray(addresses)) {
    return { text, changed: false, addresses: [] };
  }
  const wanted = [...new Set(addresses.filter(isIpv4Literal))].sort();
  // Never blank out the list: with no detectable NIC keep whatever is there.
  if (wanted.length === 0) return { text, changed: false, addresses: [] };

  const lines = text.split(/\r?\n/);
  const site = findHttpsSiteLine(lines);
  if (!site) return { text, changed: false, addresses: [] };

  // Port comes from the existing entries so a custom port is preserved.
  const port =
    site.entries.find((e) => e.port != null)?.port ?? 8443;

  const kept = site.entries.filter(
    (e) =>
      !PLACEHOLDER_HOSTS.has(e.host.toLowerCase()) &&
      (isLoopbackHost(e.host) || !isIpv4Literal(e.host)),
  );

  // Compare against the current list (including any placeholder hostnames) so a
  // stale `example-hostname` is removed even when the IPs are already correct.
  const current = site.entries.map((e) => ({
    host: e.host,
    port: e.port ?? port,
  }));
  const target = [
    ...kept.map((e) => ({ host: e.host, port: e.port ?? port })),
    ...wanted.map((ip) => ({ host: ip, port })),
  ];
  if (sameEntries(current, target)) {
    return { text, changed: false, addresses: wanted };
  }

  const rendered = [
    ...kept.map((e) => `https://${e.host}:${e.port ?? port}`),
    ...wanted.map((ip) => `https://${ip}:${port}`),
  ];

  const original = lines[site.index];
  const indent = /^[\t ]*/.exec(original)?.[0] ?? '';
  lines[site.index] = `${indent}${rendered.join(', ')} {`;

  return { text: lines.join('\n'), changed: true, addresses: wanted };
}

/** True when two entry lists have the same hosts and ports in the same order. */
function sameEntries(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].host !== b[i].host || a[i].port !== b[i].port) return false;
  }
  return true;
}

/**
 * Loopback HTTPS origins (127.0.0.1 / localhost / [::1]) for opening the
 * browser on the host machine vs advertising a public/LAN URL to phones.
 */
export const CADDY_LOOPBACK_URL_RE = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i;

/**
 * Extract the HTTPS site addresses from Caddyfile text (pure, testable).
 * Only top-level site-address lines that open a block are considered.
 * @param {string} text
 * @returns {string[]}
 */
export function parseCaddySiteUrls(text) {
  if (typeof text !== 'string') return [];
  const candidates = [];
  let depth = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    // Only site-address lines at top level (depth 0) that open a block.
    if (depth === 0 && line.endsWith('{')) {
      const head = line.slice(0, -1).trim();
      // Skip the global options block `{ ... }` (empty head).
      if (head) {
        for (const token of head.split(',')) {
          const addr = token.trim();
          if (!addr) continue;
          const https = /^https:\/\/([^\s{]+)/i.exec(addr);
          if (https) {
            const host = https[1].split(':')[0];
            if (isPlaceholderHost(host)) continue;
            candidates.push(`https://${https[1]}`);
            continue;
          }
          // Skip explicit http:// and port-only listeners (e.g. `:8080`).
          if (/^http:\/\//i.test(addr) || addr.startsWith(':')) continue;
          // A bare hostname (optionally :443) means Caddy auto-HTTPS.
          const bare = /^([a-z0-9.-]+)(?::(\d+))?$/i.exec(addr);
          if (bare && (!bare[2] || bare[2] === '443')) {
            candidates.push(`https://${bare[1]}${bare[2] ? `:${bare[2]}` : ''}`);
          }
        }
      }
    }
    // Track brace depth so nested directive blocks aren't treated as sites.
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  return candidates;
}

/**
 * Extract the public HTTPS origin from Caddyfile text (pure, testable).
 *
 * A LAN/VPN address is preferred over localhost so phones get a reachable URL
 * (used by /api/access). Returns null when no HTTPS site address is found.
 * @param {string} text
 * @returns {string | null}
 */
export function parseCaddyPublicUrl(text) {
  const candidates = parseCaddySiteUrls(text);
  if (candidates.length === 0) return null;
  const routable = candidates.find((u) => !CADDY_LOOPBACK_URL_RE.test(u));
  return routable || candidates[0];
}

/**
 * Loopback HTTPS origin from the Caddyfile for opening the browser on the host.
 * Prefer 127.0.0.1, then localhost / [::1]. Returns null when none are listed.
 * @param {string} text
 * @returns {string | null}
 */
export function parseCaddyLoopbackUrl(text) {
  const candidates = parseCaddySiteUrls(text);
  const preferred = candidates.find((u) => /\/\/127\.0\.0\.1(:|$)/i.test(u));
  if (preferred) return preferred;
  return candidates.find((u) => CADDY_LOOPBACK_URL_RE.test(u)) || null;
}

/**
 * Pure decision for resolveBrowserUrl: prefer a loopback Caddy HTTPS origin for
 * the host browser (so host-only APIs keep working), then the public Caddy URL,
 * otherwise the local WebUI URL.
 * @param {{
 *   caddyLocalUrl?: string | null,
 *   caddyUrl?: string | null,
 *   webuiUrl: string,
 *   caddyUp: boolean,
 * }} input
 * @returns {string}
 */
export function pickBrowserUrl({ caddyLocalUrl, caddyUrl, webuiUrl, caddyUp }) {
  if (caddyUp) {
    if (caddyLocalUrl) return caddyLocalUrl;
    if (caddyUrl) return caddyUrl;
  }
  return webuiUrl;
}
