import { dataDir } from '../../scripts/lib/data-dir.mjs';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { restrictToCurrentUser } from './secure-file.js';

/**
 * Append-only security audit log.
 *
 * Deliberately separate from host.log / the in-memory ring buffer: that buffer
 * evicts old entries under load (a Caddy error flood can drop hundreds of lines
 * in a minute), which is exactly the wrong property for the record of who
 * logged in. This file is only written by auth and user-management events, so
 * it stays small and complete.
 *
 * Never records a password, a session token, a jti, or a password hash — only
 * the fields below. An audit trail that leaks credentials is worse than none.
 */

/**
 * @typedef {'login.success' | 'login.failure' | 'login.throttled'
 *   | 'logout' | 'session.revoked'
 *   | 'user.create' | 'user.update' | 'user.delete'
 *   | 'authconfig.update' | 'authz.denied'} AuditAction
 */

const LOG_FILENAME = 'audit.log';
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
/** Cap a single field so a hostile username cannot bloat the file. */
const MAX_FIELD_CHARS = 200;


export function auditLogPath() {
  return join(dataDir(), LOG_FILENAME);
}

/** Collapse newlines/tabs so one event is always exactly one line. */
function sanitize(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, MAX_FIELD_CHARS);
}

/**
 * Format one event as a single JSON line.
 *
 * JSON rather than a bare text line so a username containing spaces or a
 * delimiter cannot forge extra fields when the log is parsed later.
 *
 * @param {{ action: AuditAction, actor?: string, target?: string,
 *   ip?: string, result?: 'allow' | 'deny', reason?: string, ts?: number }} event
 */
export function formatAuditLine(event) {
  const record = {
    ts: new Date(event.ts ?? Date.now()).toISOString(),
    action: sanitize(event.action),
    result: event.result === 'deny' ? 'deny' : 'allow',
  };
  if (event.actor) record.actor = sanitize(event.actor);
  if (event.target) record.target = sanitize(event.target);
  if (event.ip) record.ip = sanitize(event.ip);
  if (event.reason) record.reason = sanitize(event.reason);
  return JSON.stringify(record);
}

/**
 * @param {{
 *   file?: string,
 *   maxBytes?: number,
 *   maxFiles?: number,
 *   fs?: object,
 *   onSecure?: (file: string) => void,
 * }} [options]
 */
export function createAuditLog(options = {}) {
  const {
    file = auditLogPath(),
    maxBytes = DEFAULT_MAX_BYTES,
    maxFiles = DEFAULT_MAX_FILES,
    fs: fsApi = {},
    onSecure = (f) => restrictToCurrentUser(f),
  } = options;

  const append = fsApi.appendFileSync ?? appendFileSync;
  const stat = fsApi.statSync ?? statSync;
  const rename = fsApi.renameSync ?? renameSync;
  const exists = fsApi.existsSync ?? existsSync;
  const unlink = fsApi.unlinkSync ?? unlinkSync;
  const mkdir = fsApi.mkdirSync ?? mkdirSync;

  const generations = Math.max(1, Math.trunc(maxFiles));

  function rotate() {
    for (let i = generations; i >= 1; i -= 1) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      const to = `${file}.${i}`;
      try {
        if (!exists(from)) continue;
        if (i === generations && exists(to)) unlink(to);
        rename(from, to);
      } catch {
        // Best-effort rotation; a stuck rename must not block auditing.
      }
    }
  }

  /** @param {Parameters<typeof formatAuditLine>[0]} event */
  function record(event) {
    try {
      mkdir(dirname(file), { recursive: true });
      const isNew = !exists(file);

      let size = 0;
      try {
        size = stat(file).size;
      } catch {
        size = 0;
      }
      if (size >= maxBytes) rotate();

      append(file, `${formatAuditLine(event)}\n`);

      // The log names accounts and source IPs, so lock it down on creation
      // (and after a rotation created a fresh file).
      if (isNew || size >= maxBytes) onSecure(file);
    } catch {
      // Auditing must never take the host down or block a login response.
    }
  }

  return { record, path: file };
}
