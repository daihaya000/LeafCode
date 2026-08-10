"use client";

import { sendJson, getJson } from "./client";

export type AuthUser = { username: string; role: "admin" | "user"; updatedAt: string };

const SESSION_KEY = "webui_auth_session";
const USERS_CACHE_KEY = "webui_auth_users";

export type AuthSession = {
  username: string;
  expiresAt: number;
};

/** Server-side verdict on whether this client has to log in. */
export type AuthRequirement = {
  /** True when the browser reached the BFF over loopback (same machine). */
  local: boolean;
  /** True when at least one user is registered on the host. */
  hasUsers: boolean;
  /** True when Windows-account login is enabled on the host. */
  windowsAuth: boolean;
  /** True when the host has some credential to check against. */
  canAuthenticate: boolean;
  /** True only for remote callers once a credential source exists. */
  loginRequired: boolean;
  /** True when the request's session cookie was verified by the host. */
  authenticated: boolean;
  /** Username behind the verified session, if any. */
  username: string | null;
};

/** Host-only authentication options. */
export type AuthConfig = {
  windowsAuth: boolean;
  /** False on non-Windows hosts, where the toggle cannot be enabled. */
  windowsAuthSupported: boolean;
  hasUsers: boolean;
};

/**
 * Ask the server whether login is required. Only the server can decide this:
 * the loopback check depends on the request's Host/X-Forwarded-For headers.
 *
 * On failure we fail closed (require login) so a flaky fetch cannot be used to
 * skip the gate.
 */
export async function fetchAuthRequirement(): Promise<AuthRequirement> {
  try {
    const data = await getJson<Partial<AuthRequirement>>("/api/auth/session");
    return {
      local: data.local === true,
      hasUsers: data.hasUsers === true,
      windowsAuth: data.windowsAuth === true,
      canAuthenticate: data.canAuthenticate === true,
      loginRequired: data.loginRequired !== false,
      authenticated: data.authenticated === true,
      username: typeof data.username === "string" ? data.username : null,
    };
  } catch {
    return {
      local: false,
      hasUsers: true,
      windowsAuth: false,
      canAuthenticate: true,
      loginRequired: true,
      authenticated: false,
      username: null,
    };
  }
}

/** Read the host-only auth options. Returns null when unavailable (e.g. LAN). */
export async function fetchAuthConfig(): Promise<AuthConfig | null> {
  try {
    const data = await getJson<Partial<AuthConfig>>("/api/auth/config");
    return {
      windowsAuth: data.windowsAuth === true,
      windowsAuthSupported: data.windowsAuthSupported === true,
      hasUsers: data.hasUsers === true,
    };
  } catch {
    return null;
  }
}

export async function setWindowsAuthEnabled(
  enabled: boolean,
): Promise<{ ok: true; config: AuthConfig } | { ok: false; error: string }> {
  try {
    const result = await sendJson<{ ok?: boolean; error?: string } & Partial<AuthConfig>>(
      "POST",
      "/api/auth/config",
      { windowsAuth: enabled },
    );
    if (!result.ok) {
      return { ok: false, error: result.error || "保存に失敗しました" };
    }
    return {
      ok: true,
      config: {
        windowsAuth: result.windowsAuth === true,
        windowsAuthSupported: result.windowsAuthSupported === true,
        hasUsers: result.hasUsers === true,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: (err instanceof Error ? err.message : null) || "通信エラーが発生しました",
    };
  }
}

function isBrowser() {
  return typeof window !== "undefined";
}

function readStoredSession(): AuthSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed || typeof parsed.username !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  const session = readStoredSession();
  if (!session) return false;
  return Date.now() < session.expiresAt;
}

export function currentUser(): string | null {
  const session = readStoredSession();
  return session && Date.now() < session.expiresAt ? session.username : null;
}

function writeStoredSession(session: AuthSession | null) {
  if (!isBrowser()) return;
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

export async function login(username: string, password: string, trustDevice = false): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await sendJson<{ ok: boolean; username?: string; error?: string }>(
      "POST",
      "/api/auth/login",
      { username, password, trustDevice },
    );
    if (!result.ok || typeof result.username !== "string") {
      return { ok: false, error: result.error || "ログインに失敗しました" };
    }
    // 7 days, matching the host cookie.
    writeStoredSession({ username: result.username, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return { ok: true };
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;
    if (status === 401) {
      return { ok: false, error: "ユーザー名またはパスワードが違います" };
    }
    if (status === 429 && err instanceof Error && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "通信エラーが発生しました" };
  }
}

export async function logout(): Promise<void> {
  try {
    await sendJson("POST", "/api/auth/logout", {});
  } catch {
    // best effort
  }
  writeStoredSession(null);
}

export async function listAuthUsers(): Promise<AuthUser[]> {
  try {
    const data = await getJson<{ users?: AuthUser[] }>("/api/auth/users");
    const users = Array.isArray(data.users) ? data.users : [];
    if (isBrowser()) {
      localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
    }
    return users;
  } catch {
    if (isBrowser()) {
      const cached = localStorage.getItem(USERS_CACHE_KEY);
      if (cached) {
        try {
          return JSON.parse(cached) as AuthUser[];
        } catch {
          return [];
        }
      }
    }
    return [];
  }
}

export async function upsertAuthUser(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await sendJson<{ ok: boolean; error?: string }>("POST", "/api/auth/users", {
      username,
      password,
    });
    if (!result.ok) {
      return { ok: false, error: result.error || "保存に失敗しました" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : null) || "通信エラーが発生しました" };
  }
}

export async function deleteAuthUser(username: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await sendJson<{ ok: boolean; error?: string }>("DELETE", "/api/auth/users", {
      username,
    });
    if (!result.ok) {
      return { ok: false, error: result.error || "削除に失敗しました" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : null) || "通信エラーが発生しました" };
  }
}
