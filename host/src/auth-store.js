import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { writeSecretFile } from './secure-file.js';

/**
 * Disk-backed user authentication store for the WebUI login feature.
 *
 * Credentials live in %APPDATA%\opencode-webui\users.json with hashed
 * passwords (sha256 + salt, not suitable for production web apps but
 * acceptable for a localhost-only BFF). Passwords themselves are never
 * stored; only hashes are returned or persisted.
 */

const ALGORITHM = 'sha256';
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function dataDir() {
  const base = process.env.APPDATA || join(process.env.USERPROFILE || process.env.HOME || '.', 'AppData', 'Roaming');
  return join(base, 'opencode-webui');
}

function usersFile() {
  return join(dataDir(), 'users.json');
}

function hashPassword(password, salt) {
  const saltBuf = typeof salt === 'string' ? Buffer.from(salt, 'base64') : salt;
  const hash = Buffer.allocUnsafe(HASH_BYTES);
  const hmac = createHmac(ALGORITHM, saltBuf);
  hmac.update(password, 'utf8');
  hmac.digest().copy(hash);
  return hash;
}

function hashPasswordBase64(password, salt) {
  return hashPassword(password, salt).toString('base64');
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(a, 'base64');
  const bBuf = Buffer.from(b, 'base64');
  if (aBuf.length !== bBuf.length) return false;
  try {
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

/**
 * @typedef {{ username: string, passwordHash: string, salt: string, role: 'admin' | 'user', updatedAt: string }} UserRecord
 */

const VALID_ROLES = new Set(['admin', 'user']);

/** Coerce a stored role to a known value, defaulting existing users to admin. */
function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : 'admin';
}

function readUsers() {
  const file = usersFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (u) =>
        u &&
        typeof u === 'object' &&
        typeof u.username === 'string' &&
        typeof u.passwordHash === 'string' &&
        typeof u.salt === 'string' &&
        typeof u.updatedAt === 'string',
    ).map((u) => ({ ...u, role: normalizeRole(u.role) }));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  // Password hashes: the ACL matters more than the POSIX mode on Windows.
  writeSecretFile(usersFile(), JSON.stringify(users, null, 2));
}

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function isValidUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return false;
  // Allow ASCII letters, digits, underscore, hyphen, dot, and Japanese/common Unicode.
  return normalized.length <= 64 && !/[:\s]/.test(normalized);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 4 && password.length <= 128;
}

/**
 * List stored users (without password hashes).
 * @returns {{ username: string, role: 'admin' | 'user', updatedAt: string }[]}
 */
export function listUsers() {
  return readUsers().map(({ username, role, updatedAt }) => ({ username, role, updatedAt }));
}

/**
 * Check whether a user has the admin role.
 * @param {string} username
 * @returns {boolean}
 */
export function isAdmin(username) {
  if (!isValidUsername(username)) return false;
  const normalized = normalizeUsername(username);
  const user = readUsers().find((u) => normalizeUsername(u.username) === normalized);
  return user ? normalizeRole(user.role) === 'admin' : false;
}

/**
 * Verify a username/password pair.
 * @param {string} username
 * @param {string} password
 * @returns {boolean}
 */
export function verifyUser(username, password) {
  if (!isValidUsername(username) || !isValidPassword(password)) return false;
  const normalized = normalizeUsername(username);
  const user = readUsers().find((u) => normalizeUsername(u.username) === normalized);
  if (!user) return false;
  const expected = hashPasswordBase64(password, user.salt);
  return safeEqual(expected, user.passwordHash);
}

/**
 * Create or update a user. Creates when the username does not exist; updates
 * when it does. Returns { ok, error }.
 * @param {string} username
 * @param {string} password
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function upsertUser(username, password) {
  if (!isValidUsername(username)) {
    return { ok: false, error: 'invalid username' };
  }
  if (!isValidPassword(password)) {
    return { ok: false, error: 'password must be 4 to 128 characters' };
  }
  const normalized = normalizeUsername(username);
  const users = readUsers();
  const existingIndex = users.findIndex((u) => normalizeUsername(u.username) === normalized);

  const salt = randomBytes(SALT_BYTES).toString('base64');
  // Preserve the existing role on password updates; new users are always admin
  // until a role model that assigns non-admin on creation is added.
  const role = existingIndex >= 0 ? normalizeRole(users[existingIndex].role) : 'admin';
  const record = {
    username,
    passwordHash: hashPasswordBase64(password, salt),
    salt,
    role,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    users[existingIndex] = record;
  } else {
    users.push(record);
  }
  writeUsers(users);
  return { ok: true };
}

/**
 * Delete a user by username.
 * @param {string} username
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function deleteUser(username) {
  const normalized = normalizeUsername(username);
  const users = readUsers();
  const next = users.filter((u) => normalizeUsername(u.username) !== normalized);
  if (next.length === users.length) {
    return { ok: false, error: 'user not found' };
  }
  writeUsers(next);
  return { ok: true };
}

/**
 * Check whether any users are configured. Used by the WebUI to decide whether
 * to show a login gate.
 * @returns {boolean}
 */
export function hasUsers() {
  return readUsers().length > 0;
}

/**
 * Validate that a proposed password change request is acceptable without
 * persisting it.
 * @param {string} username
 * @param {string} password
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateUserInput(username, password) {
  if (!isValidUsername(username)) return { ok: false, error: 'invalid username' };
  if (!isValidPassword(password)) return { ok: false, error: 'password must be 4 to 128 characters' };
  return { ok: true };
}
