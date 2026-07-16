# OpenCode WebUI

OpenCode CLI（`opencode serve`）を実行エンジンにした、独自 Web UI（Workspace Manager）。本体はフォークしない。

## 正本ドキュメント

| 文書 | 役割 |
|------|------|
| [`architecture.md`](./architecture.md) | 企画・アーキテクチャの正本 |
| [`MEMORY.md`](./MEMORY.md) | 設計判断・実装状況の要約 |
| [`docs/opencode/`](./docs/opencode/) | OpenCode OpenAPI スナップショット（VERSION + openapi.json） |

## 起動（Windows）

1. PATH に `opencode` があること（現状スナップショット: **1.17.11**）
2. リポジトリ直下で `start-webui.bat` を実行
3. タスクトレイ常駐後、ブラウザで `http://127.0.0.1:3000`

初回は `web/` / `host/` の `npm install` が走ります。

## 開発構成

| パス | 役割 |
|------|------|
| `web/` | Next.js BFF + チャット UI |
| `host/` | トレイ常駐ホスト（opencode + Next 起動） |
| `start-webui.bat` | 起動入口 |

## Phase 0 の使い方（最短）

1. UI 上部の Directory に作業フォルダを入力 → **Allow**（allowlist 登録）
2. **New** でセッション作成
3. メッセージ送信（SSE で更新、権限要求時は承認 UI）

DB: `%APPDATA%/opencode-webui/webui.db`

## ロードマップ

| Phase | 内容 |
|-------|------|
| 0 | トレイ + BFF プロキシ + チャット + 権限承認（実装中） |
| 1 | Workspace / worktree 並列 |
| 2 | Commit / Merge / Cleanup |
| 3 | temporary_copy / DevContainer 等 |

詳細は [`architecture.md`](./architecture.md) §8。
