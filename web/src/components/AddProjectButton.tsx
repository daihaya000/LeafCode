"use client";

import type { ComponentProps } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Star,
  X,
} from "lucide-react";
import { Button, Spinner, cx } from "@/components/ui";
import { useOptionalGlobalAttention } from "@/components/shell/GlobalAttentionProvider";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import type { ProjectDto } from "@/lib/types";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type DirEntry = { name: string; path: string };
type DirList = {
  path: string | null;
  parent: string | null;
  quickAccess?: DirEntry[];
  entries: DirEntry[];
  error?: string;
};
type NativeFolderPickerResult = { path?: string; cancelled?: boolean };

type Props = {
  onAdded?: (project: ProjectDto) => void;
  variant?: "button" | "icon";
  className?: string;
  label?: string;
  /** Passed through to the underlying Button when variant="button". */
  buttonVariant?: ComponentProps<typeof Button>["variant"];
  /** Passed through to the underlying Button when variant="button". */
  buttonSize?: ComponentProps<typeof Button>["size"];
};

/** Lightweight client-side path format validation (Windows + Unix). */
function isValidPathShape(p: string): boolean {
  const trimmed = p.trim();
  if (!trimmed) return false;
  // Windows drive path (C:\ or C:/) or Unix absolute path.
  return /^[A-Za-z]:[\\/]/.test(trimmed) || /^\//.test(trimmed);
}

/** Shown when the native dialog is refused; it can only appear on the host screen. */
const NATIVE_PICKER_FORBIDDEN =
  "ネイティブフォルダ選択はホストPC（127.0.0.1/localhost）でのみ使えます。下の一覧から選択してください";

/** Shown when server-side browsing is refused, i.e. the session is not signed in. */
const BROWSE_FORBIDDEN =
  "フォルダ一覧の取得にはログインが必要です。ログインし直してください";

/**
 * Translate an API error into a Japanese message based on HTTP status.
 *
 * `forbiddenMessage` differs per call site: a 403 from the native dialog means
 * "not on the host machine", while a 403 from directory browsing means "not
 * signed in". Reusing one message for both misreports the cause.
 */
function apiErrorMessage(
  err: unknown,
  fallback: string,
  forbiddenMessage: string = BROWSE_FORBIDDEN,
): string {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: number }).status;
    if (status === 403) return forbiddenMessage;
    if (status === 404) return "フォルダが見つかりません";
    if (status === 400) return "このフォルダは追加できません（許可されていません）";
    if (status === 408) return "通信がタイムアウトしました";
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function isWindowsClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const candidates = [
    nav.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ].filter((v): v is string => typeof v === "string");
  return candidates.some((v) => /win/i.test(v));
}

export function AddProjectButton({
  onAdded,
  variant = "button",
  className,
  label = "プロジェクトを追加",
  buttonVariant,
  buttonSize,
}: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [quickAccess, setQuickAccess] = useState<DirEntry[]>([]);
  const [manualPath, setManualPath] = useState("");
  const attention = useOptionalGlobalAttention();
  const attentionOpen = attention?.open ?? false;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const reqIdRef = useRef(0);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const pickerBusyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reqIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (attentionOpen && open) setOpen(false);
  }, [attentionOpen, open]);

  // M3: lock body scroll while the dialog is open.
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) {
      if (prevFocusRef.current) {
        prevFocusRef.current.focus();
        prevFocusRef.current = null;
      }
      return;
    }
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!busy) setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !(el as HTMLButtonElement).disabled);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const load = useCallback(async (dir: string | null) => {
    // H3: invalidate any in-flight request before starting a new one.
    if (!mountedRef.current) return;
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const q = dir ? { path: dir } : undefined;
      const data = await getJson<DirList>("/api/browse/dirs", q);
      // H3: drop the response if a newer request superseded this one.
      if (!mountedRef.current || id !== reqIdRef.current) return;
      setCwd(data.path);
      setParent(data.parent);
      setEntries(data.entries ?? []);
      setQuickAccess(data.quickAccess ?? []);
      // Sync the path field to the folder currently shown so the "add this
      // folder" action targets what the user navigated to. This mirrors the
      // standard explorer UX: clicking a folder opens it and selects it.
      if (data.path) setManualPath(data.path);
    } catch (err) {
      if (!mountedRef.current || id !== reqIdRef.current) return;
      // H4: translate API errors to Japanese.
      setError(apiErrorMessage(err, "一覧取得に失敗しました"));
    } finally {
      if (mountedRef.current && id === reqIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(null);
  }, [open, load]);

  // M5: reset transient state when the dialog closes so the next open
  // doesn't briefly show stale entries/selection.
  useEffect(() => {
    if (open) return;
    setCwd(null);
    setParent(null);
    setEntries([]);
    setQuickAccess([]);
    setManualPath("");
    setError(null);
    setNotice(null);
  }, [open]);

  const confirm = useCallback(
    async (rootPath: string) => {
      // A4: guard against double-submit while a request is in flight.
      if (busyRef.current) return;
      const p = rootPath.trim();
      if (!p) return;
      // H2: lightweight client-side path shape validation.
      if (!isValidPathShape(p)) {
        setError("パスの形式が正しくありません");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const data = await sendJson<{ project: ProjectDto }>("POST", "/api/projects", {
          rootPath: p,
        });
        if (!mountedRef.current) return;
        notifyTasksChanged();
        onAdded?.(data.project);
        setOpen(false);
      } catch (err) {
        if (!mountedRef.current) return;
        // H4: translate API errors to Japanese.
        setError(apiErrorMessage(err, "追加に失敗しました"));
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    [onAdded],
  );

  const openPicker = useCallback(async () => {
    if (attentionOpen || pickerBusyRef.current || busyRef.current) return;
    setError(null);
    setNotice(null);

    if (!isWindowsClient()) {
      setOpen(true);
      return;
    }

    // The native folder picker is a host-only API. The backend decides whether
    // the request comes from the same machine (direct loopback, or a trusted
    // local reverse proxy such as Caddy). When denied, fall back to the
    // cross-platform in-app picker and show the reason in a banner.
    pickerBusyRef.current = true;
    setPickerBusy(true);
    try {
      const selected = await sendJson<NativeFolderPickerResult>(
        "POST",
        "/api/browse/folder",
        {
          title: "プロジェクトフォルダを選択",
          initialPath: manualPath.trim() || cwd || undefined,
        },
        undefined,
        { timeoutMs: 300_000 },
      );
      if (!mountedRef.current) return;
      if (selected.cancelled || !selected.path) return;
      await confirm(selected.path);
    } catch (err) {
      if (!mountedRef.current) return;
      // If the host cannot show the native dialog, keep the project add flow
      // usable by falling back to the cross-platform in-app picker.
      const message = apiErrorMessage(
        err,
        "フォルダ選択に失敗しました",
        NATIVE_PICKER_FORBIDDEN,
      );
      // 403 is an authorization problem (not this folder), so show it as a
      // persistent banner that survives navigation inside the in-app picker.
      if (err instanceof Error && "status" in err && err.status === 403) {
        setNotice(message);
      } else {
        setError(message);
      }
      setOpen(true);
    } finally {
      pickerBusyRef.current = false;
      if (mountedRef.current) setPickerBusy(false);
    }
  }, [attentionOpen, confirm, cwd, manualPath]);

  // The add target: the path field (synced to the current folder on every
  // navigation), falling back to the current directory.
  const addTarget = manualPath.trim() || cwd || "";

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          title={pickerBusy || busy ? "フォルダ選択を開いています" : label}
          aria-label={pickerBusy || busy ? "フォルダ選択を開いています" : label}
          aria-busy={pickerBusy || busy}
          onClick={openPicker}
          disabled={pickerBusy || busy}
          className={cx(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-all hover:bg-surface-2 hover:text-text disabled:cursor-wait",
            (pickerBusy || busy) &&
              "bg-primary/15 text-primary ring-2 ring-primary/45 ring-offset-1 ring-offset-surface",
            className,
          )}
        >
          {pickerBusy || busy ? (
            <Spinner className="h-4 w-4 text-primary" />
          ) : (
            <FolderPlus className="h-4 w-4" />
          )}
          <span className="sr-only">
            {pickerBusy || busy ? "フォルダ選択を開いています" : label}
          </span>
        </button>
      ) : (
        <div className={cx(className)}>
          <Button
            variant={buttonVariant}
            size={buttonSize}
            onClick={openPicker}
            busy={pickerBusy || busy}
          >
            <FolderPlus className="h-4 w-4" />
            {label}
          </Button>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <button
            type="button"
            aria-label="閉じる"
            disabled={busy}
            className="absolute inset-0 bg-black/50"
            onClick={() => !busy && setOpen(false)}
          />
          <div
            ref={panelRef}
            className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-3">
              <h2 id={titleId} className="flex-1 text-sm font-semibold">
                フォルダを選択
              </h2>
              <button
                type="button"
                disabled={busy}
                aria-label="閉じる"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-40"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="flex items-center gap-1 border-b border-border px-2 py-2">
              <button
                type="button"
                disabled={loading || busy || cwd === null}
                onClick={() => void load(parent)}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-surface-2 disabled:opacity-40"
              >
                上へ
              </button>
              <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">
                {cwd ?? "…"}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {notice && (
                <div className="border-b border-warning/30 bg-warning-bg px-3 py-2">
                  <p className="text-xs text-warning">{notice}</p>
                </div>
              )}
              {loading ? (
                <div className="flex justify-center py-12">
                  <Spinner />
                </div>
              ) : (
                <>
                  {quickAccess.length > 0 && (
                    <div className="border-b border-border pb-1">
                      <p className="px-3 py-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
                        クイックアクセス
                      </p>
                      <ul>
                        {quickAccess.map((e) => (
                          <li key={`qa-${e.path}`}>
                            <button
                              type="button"
                              disabled={loading || busy}
                              aria-label={`${e.name} を開く`}
                              onClick={() => void load(e.path)}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-3 text-left hover:bg-surface-2 active:bg-surface-3 disabled:opacity-40"
                            >
                              <Star className="h-4 w-4 shrink-0 fill-warning text-warning" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">
                                  {e.name}
                                </span>
                                <span className="block truncate font-mono text-[10px] text-faint">
                                  {e.path}
                                </span>
                              </span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {entries.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-faint">
                      サブフォルダがありません
                    </p>
                  ) : (
                    <ul className="py-1">
                      {quickAccess.length > 0 && (
                        <li className="px-3 py-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
                          このフォルダ
                        </li>
                      )}
                      {entries.map((e) => (
                        <li key={e.path}>
                          <button
                            type="button"
                            disabled={loading || busy}
                            aria-label={`${e.name} を開く`}
                            onClick={() => void load(e.path)}
                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-3 text-left hover:bg-surface-2 active:bg-surface-3 disabled:opacity-40"
                          >
                            <Folder className="h-4.5 w-4.5 shrink-0 text-muted" />
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {e.name}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2 border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                aria-label="追加するプロジェクトのパス"
                placeholder="またはパスを入力 C:\path\to\repo"
                className="h-10 w-full rounded-lg border border-border bg-bg px-3 font-mono text-xs outline-none focus:border-border-strong"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (busy) return;
                    void confirm(manualPath);
                  }
                }}
              />
              {error && (
                <p
                  role="alert"
                  aria-live="assertive"
                  className="rounded-lg border border-danger/30 bg-danger-bg px-2 py-1.5 text-xs text-danger"
                >
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={busy || loading || !cwd}
                  onClick={() => cwd && void load(cwd)}
                >
                  再読込
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  busy={busy}
                  disabled={busy || !addTarget}
                  onClick={() => void confirm(addTarget)}
                >
                  このフォルダを追加
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
