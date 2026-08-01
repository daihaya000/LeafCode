# Cursor ACP bundled dependency

このディレクトリは、新規ユーザーのOpenCodeプロファイル作成時に
Cursor ACPを自動配置するための同梱ファイルです。

- `plugin/cursor-acp.js`: OpenCodeの自動ロード用エントリ
- `packages/cursor-acp`: Cursor ACPプロキシ・ツール連携の実装
- `opencode.jsonc`: `cursor-acp`プロバイダーの最小設定テンプレート

実行にはCursor Agentがインストールされ、Cursor側で認証済みである必要があります。
APIキーはリポジトリに含めず、WebUIまたはOpenCodeの認証ストアから設定してください。
