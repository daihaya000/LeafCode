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

/** True when `host` is a bare IPv4 literal (not a hostname/domain). */
export function isIpv4Literal(host) {
  if (typeof host !== 'string' || !IPV4_RE.test(host)) return false;
  return host.split('.').every((part) => {
    const n = Number(part);
    return String(n) === part && n >= 0 && n <= 255;
  });
}

/** True for addresses that must always stay in the list. */
function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

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
    (e) => isLoopbackHost(e.host) || !isIpv4Literal(e.host),
  );
  const existingIps = site.entries
    .filter((e) => isIpv4Literal(e.host) && !isLoopbackHost(e.host))
    .map((e) => e.host)
    .sort();

  if (
    existingIps.length === wanted.length &&
    existingIps.every((ip, i) => ip === wanted[i])
  ) {
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
