"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HelpCircle, ShieldAlert, X } from "lucide-react";
import { PermissionCard } from "@/components/task/PermissionCard";
import { QuestionCard } from "@/components/task/QuestionCard";
import { Button, cx } from "@/components/ui";
import { ApiError, ocJson } from "@/lib/client";
import { replyPath, rejectPath, type AttentionItem } from "@/lib/attention";
import { writeAccessMode } from "@/lib/access-mode";
import { SESSION_MUTATION_TIMEOUT_MS } from "@/lib/useSessionStream";
import { useGlobalAttention } from "./GlobalAttentionProvider";

export function AttentionQueueModal() {
  const { items, open, setOpen, remove, resolveSessionTitle } = useGlobalAttention();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => a.request.receivedAt - b.request.receivedAt);
  }, [items]);

  const current = sorted[0];
  const total = sorted.length;
  const sessionLabel = current
    ? resolveSessionTitle(current) ?? current.request.sessionID
    : null;

  useEffect(() => {
    setError(null);
  }, [current?.request.id, current?.request.sessionID]);

  // Close automatically when queue becomes empty
  useEffect(() => {
    if (total === 0 && open) setOpen(false);
  }, [total, open, setOpen]);

  // Focus management
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
    // R5#1: Only run on open/close, not on current?.request.id change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape / focus trap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (busy) return;
        setOpen(false);
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !(el as HTMLButtonElement).disabled);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, busy]);

  const respond = useCallback(
    async (item: AttentionItem, fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        remove(item.request.id, item.request.sessionID);
      } catch (err) {
        // Already answered elsewhere (e.g. TaskView) — drop from queue.
        if (
          (err instanceof ApiError && err.status === 404) ||
          (err instanceof Error && /404/.test(err.message))
        ) {
          remove(item.request.id, item.request.sessionID);
          return;
        }
        setError(err instanceof Error ? err.message : "応答に失敗しました");
      } finally {
        setBusy(false);
      }
    },
    [remove],
  );

  const replyPermission = useCallback(
    async (item: AttentionItem, response: "once" | "always" | "reject") => {
      if (item.kind !== "permission") return;
      await respond(item, () =>
        ocJson(replyPath(item), item.directory, {
          method: "POST",
          body: item.request.version === "v2" ? { reply: response } : { response },
          timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
        }),
      );
    },
    [respond],
  );

  // R36#2: When switching to full-access mode, auto-approve all remaining permission requests in the queue
  const enableFullAccess = useCallback(async () => {
    writeAccessMode("full");
    // Auto-approve all pending permission requests in the queue
    const permissionItems = items.filter((item) => item.kind === "permission");
    for (const item of permissionItems) {
      try {
        await ocJson(replyPath(item), item.directory, {
          method: "POST",
          body: item.request.version === "v2" ? { reply: "once" } : { response: "once" },
          timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
        });
        remove(item.request.id, item.request.sessionID);
      } catch {
        // Ignore errors — individual failures will remain in queue for manual handling
      }
    }
  }, [items, remove]);

  const replyQuestion = useCallback(
    async (item: AttentionItem, answers: string[][]) => {
      if (item.kind !== "question") return;
      await respond(item, () =>
        ocJson(replyPath(item), item.directory, {
          method: "POST",
          body: { answers },
          timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
        }),
      );
    },
    [respond],
  );

  const rejectQuestion = useCallback(
    async (item: AttentionItem) => {
      if (item.kind !== "question") return;
      const path = rejectPath(item);
      if (!path) return;
      await respond(item, () =>
        ocJson(path, item.directory, {
          method: "POST",
          timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
        }),
      );
    },
    [respond],
  );

  if (!open || !current) return null;

  const title = current.kind === "permission" ? "権限の承認が必要です" : "確認が必要です";
  const icon = current.kind === "permission" ? <ShieldAlert className="h-4 w-4" /> : <HelpCircle className="h-4 w-4" />;

  return (
    <div
      className={cx(
        "fixed inset-0 z-[70] flex items-start justify-center bg-black/50 px-4",
        "pt-[max(12vh,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="attention-modal-title"
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-text">
              {icon}
              <span id="attention-modal-title" className="truncate">
                {title}
              </span>
              {total > 1 && (
                <span className="shrink-0 text-xs text-faint">1/{total}</span>
              )}
            </div>
            {sessionLabel && (
              <p
                className="mt-0.5 truncate pl-6 text-xs text-faint"
                title={current.request.sessionID}
              >
                {sessionLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {current.kind === "permission" ? (
            <PermissionCard
              key={current.request.id}
              request={current.request}
              onEnableFullAccess={enableFullAccess}
              onReply={async (req, response) =>
                await replyPermission(
                  { kind: "permission", directory: current.directory, request: req },
                  response,
                )
              }
            />
          ) : (
            <QuestionCard
              key={current.request.id}
              request={current.request}
              onReply={async (req, answers) =>
                await replyQuestion(
                  { kind: "question", directory: current.directory, request: req },
                  answers,
                )
              }
              onReject={async (req) =>
                await rejectQuestion({ kind: "question", directory: current.directory, request: req })
              }
            />
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-border px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            後で
          </Button>
        </div>
      </div>
    </div>
  );
}
