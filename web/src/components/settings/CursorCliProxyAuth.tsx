import { Badge } from "@/components/ui";

export function CursorCliProxyAuth({ showHeading = true }: { showHeading?: boolean }) {
  return (
    <section aria-label={showHeading ? undefined : "Cursor CLI Proxy"} aria-labelledby={showHeading ? "cursor-cli-proxy-heading" : undefined}>
      {showHeading && <h2 id="cursor-cli-proxy-heading" className="mb-3 text-sm font-semibold text-muted">Cursor CLI Proxy</h2>}
      <div className="rounded-xl border border-border bg-surface px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">Cursor Agent CLI</h3>
              <Badge tone="success">CLIプロキシ</Badge>
            </div>
            <p className="mt-1 text-xs text-faint">
              Cursor Agent CLIをローカルプロキシ経由で使用します。認証情報はCursor CLI側で管理されるため、WebUIでAPIキーを入力・保存する必要はありません。
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          未認証の場合はターミナルで <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-text">cursor-agent login</code> を実行し、認証後にOpenCodeを再起動してください。
        </p>
      </div>
    </section>
  );
}
