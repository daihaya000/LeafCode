import { useEffect, useRef, useState } from "react";
import {
  COMMIT_AUTHOR_EMAIL_KEY,
  COMMIT_AUTHOR_NAME_KEY,
  COMMIT_AUTHOR_EMAIL_MAX_CHARS,
  COMMIT_AUTHOR_NAME_MAX_CHARS,
  isValidCommitAuthorEmail,
  isValidCommitAuthorName,
} from "@/lib/commit-identity-keys";
import { getJson, sendJson } from "@/lib/client";

/**
 * Settings の「Git」タブ（REFACTORING_PLAN 5-c / IMPROVEMENT 1-1）。
 * コミット作者の名前/メールを自己完結で管理する。
 */
export function GitSettingsTab() {
  const [commitAuthorName, setCommitAuthorName] = useState("");
  const [commitAuthorEmail, setCommitAuthorEmail] = useState("");
  const [commitIdentityError, setCommitIdentityError] = useState<string | null>(
    null,
  );
  const mountedRef = useRef(false);

  // Commit author override: stored server-side because the commit API and the
  // worktree Git identity both resolve it on the host, not in the browser.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void (async () => {
      const [name, email] = await Promise.allSettled([
        getJson<{ value: string | null }>(`/api/settings/${COMMIT_AUTHOR_NAME_KEY}`),
        getJson<{ value: string | null }>(`/api/settings/${COMMIT_AUTHOR_EMAIL_KEY}`),
      ]);
      if (cancelled) return;
      if (name.status === "fulfilled") setCommitAuthorName(name.value.value ?? "");
      if (email.status === "fulfilled") setCommitAuthorEmail(email.value.value ?? "");
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const commitIdentityField = async (
    key: string,
    raw: string,
    isValid: (value: string) => boolean,
    invalidMessage: string,
  ) => {
    const value = raw.trim();
    if (value.length > 0 && !isValid(value)) {
      setCommitIdentityError(invalidMessage);
      return;
    }
    setCommitIdentityError(null);
    try {
      await sendJson("PUT", `/api/settings/${key}`, { value });
    } catch (err) {
      if (mountedRef.current) {
        setCommitIdentityError(
          err instanceof Error ? err.message : "コミット作者の保存に失敗しました",
        );
      }
    }
  };

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted">コミット作者</h2>
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-[11px] text-faint">
          未設定の場合は実行エージェント名（例:
          <code className="mx-1 font-mono">build &lt;build@opencode.local&gt;</code>）
          で記録されます。GitHub などに push するリポジトリでは、ここに実ユーザーの名前とメールアドレスを設定してください。
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="w-28 shrink-0 text-sm text-muted">名前</span>
            <input
              type="text"
              value={commitAuthorName}
              maxLength={COMMIT_AUTHOR_NAME_MAX_CHARS}
              placeholder="エージェント名を使用"
              aria-label="コミット作者名"
              onChange={(event) => setCommitAuthorName(event.target.value)}
              onBlur={() =>
                void commitIdentityField(
                  COMMIT_AUTHOR_NAME_KEY,
                  commitAuthorName,
                  isValidCommitAuthorName,
                  "コミット作者名に使用できない文字が含まれています",
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-9 w-full max-w-[22rem] rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="w-28 shrink-0 text-sm text-muted">メールアドレス</span>
            <input
              type="email"
              value={commitAuthorEmail}
              maxLength={COMMIT_AUTHOR_EMAIL_MAX_CHARS}
              placeholder="エージェント名@opencode.local を使用"
              aria-label="コミット作者メールアドレス"
              onChange={(event) => setCommitAuthorEmail(event.target.value)}
              onBlur={() =>
                void commitIdentityField(
                  COMMIT_AUTHOR_EMAIL_KEY,
                  commitAuthorEmail,
                  isValidCommitAuthorEmail,
                  "コミット作者メールアドレスの形式が不正です",
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-9 w-full max-w-[22rem] rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-border-strong"
            />
          </label>
        </div>
        {commitIdentityError && (
          <p className="mt-2 text-[11px] text-danger" role="alert">
            {commitIdentityError}
          </p>
        )}
        <p className="mt-2 text-[11px] text-faint">
          設定後に作成したワークスペース、および以降のコミットに適用されます。
        </p>
      </div>
    </section>
  );
}
