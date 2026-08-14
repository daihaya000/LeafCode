/**
 * In-memory ring buffer for host + tee'd child-process log lines.
 *
 * Feeds the "ホストログ" panel in the WebUI Settings > 全般 tab
 * (see docs/specs/host-log-viewer.md) via control-server's `GET /logs`.
 * Never persisted to disk; cleared whenever the host process restarts.
 *
 * Fairness: a single high-frequency source (e.g. Caddy error spam at ~4 lines/s)
 * used to evict low-frequency but high-signal sources (webui/host) within a
 * couple of minutes. When a source already occupies more than
 * {@link MAX_SHARE_PER_SOURCE} of the buffer, eviction drops the oldest entry
 * of the largest source instead of the global oldest, so webui/host lines
 * survive a flood from another source. Total size caps (MAX_ENTRIES / MAX_BYTES)
 * are still enforced so memory stays bounded.
 */

/** @typedef {'host' | 'opencode' | 'webui' | 'web-build' | 'caddy'} LogSource */
/** @typedef {'log' | 'error'} LogLevel */
/**
 * @typedef {{
 *   seq: number,
 *   ts: number,
 *   source: LogSource,
 *   level: LogLevel,
 *   text: string,
 * }} LogEntry
 */

const MAX_ENTRIES = 500;
const MAX_BYTES = 256 * 1024;
const MAX_ENTRY_CHARS = 4000;
/** Entries returned by default (no `since`) when the buffer holds more. */
const DEFAULT_TAIL = 200;
/**
 * No single source may keep more than this fraction of the buffer when other
 * sources are present; eviction then targets the largest source's oldest entry
 * instead of the global oldest. Keeps a noisy source from starving the rest.
 */
const MAX_SHARE_PER_SOURCE = 0.5;

let seq = 0;
/** @type {LogEntry[]} */
let entries = [];
let totalChars = 0;

function truncate(text) {
  const str = typeof text === 'string' ? text : String(text);
  return str.length > MAX_ENTRY_CHARS
    ? `${str.slice(0, MAX_ENTRY_CHARS)}…(truncated)`
    : str;
}

/**
 * Pure helper: pick the index of the entry to evict. When one source exceeds
 * {@link MAX_SHARE_PER_SOURCE} of the buffer, evict the oldest entry of the
 * largest source; otherwise evict the global oldest (index 0).
 *
 * @param {LogEntry[]} list
 * @param {number} [maxShare]
 * @returns {number} index into `list`
 */
// Test-only export (used by log-buffer.test.js).
export function pickEvictionIndex(list, maxShare = MAX_SHARE_PER_SOURCE) {
  if (!list || list.length === 0) return -1;
  const counts = new Map();
  for (const e of list) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
  const threshold = Math.floor(list.length * maxShare);
  let largestSource = null;
  let largestCount = 0;
  for (const [source, count] of counts) {
    if (count > largestCount) {
      largestCount = count;
      largestSource = source;
    }
  }
  if (largestSource !== null && largestCount > threshold) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].source === largestSource) return i;
    }
  }
  return 0;
}

/**
 * Append a log line to the ring buffer. Does not affect existing
 * console.log/process.stdout.write output — callers tee into this buffer
 * in addition to (not instead of) writing to the real console.
 * @param {LogSource} source
 * @param {LogLevel} level
 * @param {string} text
 * @returns {LogEntry}
 */
export function pushLogEntry(source, level, text) {
  const clean = truncate(text);
  seq += 1;
  /** @type {LogEntry} */
  const entry = { seq, ts: Date.now(), source, level, text: clean };
  entries.push(entry);
  totalChars += clean.length;
  while (entries.length > MAX_ENTRIES || totalChars > MAX_BYTES) {
    const idx = pickEvictionIndex(entries);
    if (idx < 0) break;
    const removed = entries.splice(idx, 1)[0];
    if (removed) totalChars -= removed.text.length;
  }
  return entry;
}

/**
 * @param {number | null} [since] Return only entries with seq > since.
 *   When omitted/null, returns the most recent {@link DEFAULT_TAIL} entries.
 * @returns {{ entries: LogEntry[], nextSeq: number }}
 */
export function getLogEntries(since) {
  const sinceSeq =
    typeof since === 'number' && Number.isFinite(since) ? since : null;
  const filtered =
    sinceSeq === null
      ? entries.slice(-DEFAULT_TAIL)
      : entries.filter((e) => e.seq > sinceSeq);
  return { entries: filtered, nextSeq: seq };
}

/** Test-only: reset buffer state between test cases. */
export function resetLogBuffer() {
  entries = [];
  totalChars = 0;
  seq = 0;
}
