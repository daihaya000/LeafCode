"use client";

import { sendJson, getJson } from "./client";

export type AuthUser = { username: string; updatedAt: string };

const SESSION_KEY = "webui_auth_session";
const USERS_CACHE_KEY = "webui_auth_users";

export type AuthSession = {
  username: string;
  expiresAt: number;
};

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

export async function login(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await sendJson<{ ok: boolean; username?: string; error?: string }>(
      "POST",
      "/api/auth/login",
      { username, password },
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
