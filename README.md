# OpenCode WebUI

OpenCode CLI（`opencode serve`）を実行エンジンにした Workspace Manager Web UI。本体はフォークしない。

## 起動（Windows）

1. PATH に `opencode`（推奨スナップショット: `docs/opencode/VERSION`）
2. `start-webui.bat`
3. トレイ常駐後、ブラウザが `http://127.0.0.1:3000` を開く（`OPENCODE_WEBUI_NO_BROWSER=1` で抑制可）

## 正本

| 文書 | 役割 |
|------|------|
| [`architecture.md`](./architecture.md) | 企画・アーキテクチャ |
| [`MEMORY.md`](./MEMORY.md) | 実装状況メモ |
| [`docs/opencode/`](./docs/opencode/) | OpenAPI スナップショット |

## 構成

| パス | 役割 |
|------|------|
| `web/` | Next.js BFF + UI |
| `host/` | トレイ常駐（opencode + Next） |
| `scripts/smoke-api.mjs` | API スモーク |

## 実装済み機能

| Phase | 内容 |
|-------|------|
| 0 | BFF プロキシ / SSE / 権限承認 / allowlist / トレイ |
| 1 | Project Launcher / worktree / Diff / orphan / Files(Ctrl+P) / SessionBinding |
| 2 | Commit / Merge / PR(`gh` 任意) |
| 3 | `temporary_copy` / Dev Container **検知 + host-fallback**（コンテナ起動は未） |

## 最短フロー

1. Launcher でプロジェクト追加
2. Isolation を選んで Create & Open
3. New セッション → チャット / 承認
4. Diff → Commit → Merge（または Create PR）

## 開発

```bat
cd web && npm install && npm run dev
```

別ターミナルで `opencode serve --hostname 127.0.0.1 --port 4096`。  
スモーク: WebUI 起動後に `node scripts/smoke-api.mjs`
