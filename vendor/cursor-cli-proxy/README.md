# Cursor CLI Proxy (fork)

このディレクトリは `@rama_nigg/open-cursor` をこのリポジトリにフォークし、
独自パッチ（プロキシヘルスゲート等）を加えて保守しているコードです。
新規ユーザーのOpenCodeプロファイル作成時に自動配置されます。

- `plugin/cursor-cli-proxy.js`: OpenCodeの自動ロード用エントリ
- `packages/cursor-cli-proxy`: Cursor CLI Proxy（ACP経由でcursor-agent CLIに委譲するローカルプロキシ）の実装
- `opencode.jsonc`: `cursor-acp`プロバイダー（OpenCode側のプロバイダーIDは既存プロファイルとの互換性のため維持）の最小設定テンプレート

実行にはCursor Agentがインストールされ、Cursor側で認証済みである必要があります。
APIキーはリポジトリに含めず、WebUIまたはOpenCodeの認証ストアから設定してください。
