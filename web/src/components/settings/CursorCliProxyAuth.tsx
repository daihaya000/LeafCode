import { CliProxyAuthCard } from "./CliProxyAuthCard";

export function CursorCliProxyAuth({ showHeading = true }: { showHeading?: boolean }) {
  return (
    <CliProxyAuthCard
      showHeading={showHeading}
      title="Cursor CLI Proxy"
      headingId="cursor-cli-proxy-heading"
      provider="cursor"
      authEndpoint="/api/provider/cursor/auth"
      loginCommand="cursor-agent login"
      description="Cursor CLIをローカルプロキシ経由で使用します。認証情報はCursor CLI側で管理されるため、LeafCodeでAPIキーを入力・保存する必要はありません。"
    />
  );
}
