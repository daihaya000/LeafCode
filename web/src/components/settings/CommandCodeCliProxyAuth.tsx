import { CliProxyAuthCard } from "./CliProxyAuthCard";

export function CommandCodeCliProxyAuth({ showHeading = true }: { showHeading?: boolean }) {
  return (
    <CliProxyAuthCard
      showHeading={showHeading}
      title="CommandCode CLI Proxy"
      headingId="commandcode-cli-proxy-heading"
      provider="commandcode"
      authEndpoint="/api/provider/commandcode/auth"
      loginCommand="command-code login"
      description="CommandCode CLIをローカルプロキシ経由で使用します。認証情報はCommandCode CLI側で管理されるため、LeafCodeでAPIキーを入力・保存する必要はありません。"
    />
  );
}
