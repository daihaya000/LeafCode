/**
 * In-memory ring buffer for host + tee'd child-process log lines.
 *
 * Feeds the "ホストログ" panel in the WebUI Settings > 全般 tab
 * (see docs/specs/host-log-viewer.md) via control-server's `GET /logs`.
 * Never persisted to disk; cleared whenever the host process restarts.
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
    const removed = entries.shift();
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
