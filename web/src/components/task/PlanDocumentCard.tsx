import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { getJson } from "@/lib/client";
import { Markdown } from "./Markdown";

type Document = { name: string; content: string };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; document: Document }
  | { status: "error" };

function basename(path: string) {
  return path.split(/[\\/]/).pop() || "計画書";
}

export function PlanDocumentCard({
  path,
  directory,
  actionable,
  working,
  approved = false,
  initialCollapsed = false,
  onApprove,
}: {
  path: string;
  directory: string;
  actionable: boolean;
  working: boolean;
  /** Derived from session history: the plan was already approved (survives reload). */
  approved?: boolean;
  /** Initial card state only; later viewport changes do not override user interaction. */
  initialCollapsed?: boolean;
  onApprove: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [reload, setReload] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [approvalError, setApprovalError] = useState(false);
  const [approving, setApproving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const approvingRef = useRef(false);
  const fallbackName = basename(path);
  const isSubmitted = submitted || approved;

  useEffect(() => {
    let active = true;
    setLoadState({ status: "loading" });
    void getJson<Document>("/api/files/content", { directory, path }).then(
      (document) => {
        if (active) setLoadState({ status: "ready", document });
      },
      () => {
        if (active) setLoadState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [directory, path, reload]);

  useEffect(() => {
    approvingRef.current = false;
    setApprovalError(false);
    setApproving(false);
    setSubmitted(false);
  }, [path]);

  const approve = async () => {
    if (working || isSubmitted || approvingRef.current) return;
    approvingRef.current = true;
    setApproving(true);
    setApprovalError(false);
    try {
      await onApprove();
      setSubmitted(true);
    } catch {
      setApprovalError(true);
    } finally {
      approvingRef.current = false;
      setApproving(false);
    }
  };

  const fileName =
    loadState.status === "ready" ? loadState.document.name : fallbackName;

  return (
    <section
      aria-label={`計画書: ${fileName}`}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
        className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-muted ${
          collapsed ? "" : "border-b border-border"
        }`}
      >
        <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{fileName}</span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!collapsed && (
        <div className="space-y-3 px-3 py-3">
          {loadState.status === "loading" && (
            <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
              <span aria-hidden="true">
                <Spinner />
              </span>
              計画書を読み込み中…
            </div>
          )}
          {loadState.status === "error" && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="text-sm text-danger">
                計画書を読み込めませんでした
              </p>
              <Button variant="secondary" size="sm" onClick={() => setReload((v) => v + 1)}>
                再試行
              </Button>
            </div>
          )}
          {loadState.status === "ready" && <Markdown text={loadState.document.content} />}
          {loadState.status === "ready" && actionable && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {approvalError && (
                <p role="alert" className="text-sm text-danger">
                  実装開始の送信に失敗しました
                </p>
              )}
              <Button
                variant="primary"
                disabled={working || approving || isSubmitted}
                busy={approving}
                onClick={() => void approve()}
              >
                {isSubmitted ? "実装を開始しました" : "承認して実装"}
              </Button>
              {isSubmitted && (
                <span role="status" aria-live="polite" className="sr-only">
                  実装を開始しました
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
