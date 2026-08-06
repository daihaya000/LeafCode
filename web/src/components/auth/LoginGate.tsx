"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { currentUser, fetchAuthRequirement, login, logout } from "@/lib/auth";

export function useLoginGate() {
  const [user, setUser] = useState<string | null>(() => currentUser());
  const [checked, setChecked] = useState(false);
  const [loginRequired, setLoginRequired] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const requirement = await fetchAuthRequirement();
      if (cancelled) return;
      setLoginRequired(requirement.loginRequired);
      // The verified cookie is the authority. localStorage is only a fallback
      // for the display name when the gate does not apply at all (loopback).
      setUser(requirement.authenticated ? requirement.username : null);
      setAuthenticated(requirement.authenticated);
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const doLogin = useCallback(async (username: string, password: string) => {
    const result = await login(username, password);
    if (result.ok) {
      setUser(currentUser());
      setAuthenticated(true);
    }
    return result;
  }, []);

  const doLogout = useCallback(async () => {
    await logout();
    setUser(null);
    setAuthenticated(false);
  }, []);

  return {
    user,
    checked,
    loginRequired,
    isLoggedIn: authenticated,
    login: doLogin,
    logout: doLogout,
  };
}

type LoginFormProps = {
  onLogin: (username: string) => void;
};

export function LoginForm({ onLogin }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!username.trim() || !password) return;
      setBusy(true);
      const result = await login(username.trim(), password);
      setBusy(false);
      if (result.ok) {
        onLogin(username.trim());
        return;
      }
      setError(result.error);
    },
    [username, password, onLogin],
  );

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-12">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
      >
        <h1 className="text-center text-lg font-semibold text-text">OpenCodeWebUI</h1>
        <p className="text-center text-xs text-muted">ユーザー名とパスワードでログインしてください</p>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">ユーザー名</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            className="h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">パスワード</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
          />
        </label>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger"
          >
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          busy={busy}
          disabled={busy || !username.trim() || !password}
        >
          ログイン
        </Button>
      </form>
    </div>
  );
}

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { user, checked, loginRequired, isLoggedIn, logout: doLogout } = useLoginGate();
  const [showGate, setShowGate] = useState(true);

  useEffect(() => {
    if (!checked) return;
    setShowGate(loginRequired && !isLoggedIn);
  }, [checked, loginRequired, isLoggedIn]);

  const onLogin = useCallback(() => {
    setShowGate(false);
  }, []);

  if (!checked) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (showGate) {
    return <LoginForm onLogin={onLogin} />;
  }

  // Nothing to log out of when the gate never applied (loopback access).
  const showLogout = loginRequired && Boolean(user);

  return (
    <>
      {showLogout && (
        <div className="fixed top-0 right-0 z-50 hidden items-center gap-2 p-2 md:flex">
          <span className="text-[11px] text-muted">{user}</span>
          <button
            type="button"
            onClick={() => void doLogout()}
            className="text-[11px] text-muted underline hover:text-text"
          >
            ログアウト
          </button>
        </div>
      )}
      {children}
    </>
  );
}
