"use client";

import { useEffect } from "react";

/**
 * Global error boundary — the last-resort fallback that replaces the root
 * layout when it itself throws. Must render its own <html>/<body> because
 * the root layout is bypassed while this is active.
 *
 * This catches the rare case where an exception escapes the (app) group's
 * error.tsx (e.g. thrown during the root layout render itself), preventing
 * the opaque "a client-side exception" page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global render error]", error);
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";

  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          background: "#f7f7f8",
          color: "#18181b",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            minHeight: "100dvh",
            maxWidth: "40rem",
            margin: "0 auto",
          }}
        >
          <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>
            画面の表示中にエラーが発生しました。
          </p>
          <p
            style={{
              color: "#71717a",
              fontSize: "0.75rem",
              wordBreak: "break-all",
            }}
          >
            {error.message || "不明なエラー"}
            {error.digest ? ` (digest: ${error.digest})` : ""}
          </p>
          {isDev && error.stack && (
            <pre
              style={{
                maxHeight: "16rem",
                overflow: "auto",
                width: "100%",
                background: "#f0f0f1",
                border: "1px solid #e4e4e7",
                borderRadius: "0.5rem",
                padding: "0.75rem",
                fontSize: "0.6875rem",
                color: "#71717a",
                whiteSpace: "pre-wrap",
              }}
            >
              {error.stack}
            </pre>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: "1px solid #e4e4e7",
              background: "#ffffff",
              borderRadius: "0.5rem",
              padding: "0.375rem 0.75rem",
              fontSize: "0.875rem",
              color: "#18181b",
              cursor: "pointer",
            }}
          >
            再試行
          </button>
        </div>
      </body>
    </html>
  );
}