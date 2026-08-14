import { CliProxyAuthCard } from "./CliProxyAuthCard";

export function ClaudeSubscriptionAuth({ showHeading = true }: { showHeading?: boolean }) {
  return (
    <CliProxyAuthCard
      showHeading={showHeading}
      title="Claude CLI Proxy"
      headingId="claude-cli-proxy-heading"
      provider="claude"
      authEndpoint="/api/provider/claude/auth"
      loginCommand="claude login"
      description="Claude CLIをローカルプロキシ経由で使用します。認証情報はClaude CLI側で管理されるため、LeafCodeでAPIキーを入力・保存する必要はありません。"
    />
  );
}
