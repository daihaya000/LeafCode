# 検証スクリプトと実行前提条件（IMPROVEMENT 6-4）

検証用スクリプト（`scripts/` の `smoke-*.mjs` 等）は、実行に「WebUI / host が起動済み」を
前提とするものが多い。各コマンドの前提条件をここに集約する（README の該当記述と整合）。

## 前提条件の一覧

| コマンド | 前提条件 | 未達時の挙動 |
|----------|---------|-------------|
| `node scripts/smoke-api.mjs` | WebUI（既定 `http://127.0.0.1:3000`）が起動済み。任意で OpenCode（`:4096`） | 起動していない URL のチェックが FAIL（exit code 1） |
| `npm run smoke:browser-bridge`（web） | トレイ host が起動済み（Browser Bridge Broker が `OPENCODE_WEBUI_BROWSER_BROKER*` 環境変数を提供している） | Broker 環境が無ければ exit code 1（host を先に起動） |
| `npm run e2e`（web） | Playwright のブラウザがインストール済み。対象サーバーはテストが自身で起動/接続する | 通常のテスト失敗 |

## 補足

- smoke 系は**サーバーを起動しない**。起動はユーザー（またはテストランナー）が行う
- Browser Bridge の smoke は host が Broker 環境変数を子プロセスへ渡している前提
- `scripts/check-deps.mjs` / `preflight.mjs` は起動前提なしで実行できる（host 起動前の環境確認）
