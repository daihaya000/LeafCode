# OpenCode WebUI

OpenCode CLI（`opencode serve`）を実行エンジンにした、独自 Web UI（Workspace Manager）の企画・実装リポジトリ。OpenCode 本体はフォークしない。

## 正本ドキュメント

| 文書 | 役割 |
|------|------|
| [`architecture.md`](./architecture.md) | 企画・アーキテクチャの正本 |
| [`MEMORY.md`](./MEMORY.md) | 設計判断・レビュー結果の要約メモ |

実装コードは Phase 0 着手後に追加する。現状は設計文書が中心。

## 一言でいうと

複数エージェントを **Git Worktree 等で隔離**しつつ、モバイルでも承認・Diff ができる Workspace Manager。

## ロードマップ（要約）

| Phase | 内容 |
|-------|------|
| 0 着手前 | D6 / D2 / D4、SSE スパイク、allowlist、二重起動方針 |
| 0 | トレイ常駐 + BFF プロキシ + チャット + 権限承認 |
| 1 | Project / Workspace / worktree 並列 |
| 2 | Commit / Merge / Cleanup |
| 3 | temporary_copy / DevContainer 等 |

詳細と完了条件は [`architecture.md`](./architecture.md) §8 を参照。
