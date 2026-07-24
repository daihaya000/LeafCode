"use client";

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MobileMenuHeader } from "@/components/shell/MobileMenuHeader";

/**
 * Route-level error boundary for /task/[id].
 *
 * Without this, any render-time exception inside TaskView surfaces as the
 * generic Next.js "Application error: a client-side exception has occurred"
 * page, which hides the actual cause. This boundary captures the error and
 * renders the message + stack (dev only) so the root cause can be identified
 * — especially important for mobile-only crashes that are hard to reproduce
 * on desktop.
 */
export default function TaskError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Also surface in the console for remote debugging on mobile devices.
    console.error("[TaskView render error]", error);
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="flex h-full flex-col">
      <MobileMenuHeader />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
        <p className="text-sm text-danger">
          タスク画面の表示中にエラーが発生しました。
        </p>
        <p className="max-w-md break-all text-xs text-muted">
          {error.message || "不明なエラー"}
          {error.digest ? ` (digest: ${error.digest})` : ""}
        </p>
        {isDev && error.stack && (
          <pre className="max-h-64 w-full max-w-md overflow-auto rounded-lg border border-border bg-surface-2 p-3 text-[11px] text-muted">
            {error.stack}
          </pre>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text hover:bg-surface-2"
          >
            再試行
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text hover:bg-surface-2"
          >
            ホームへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
