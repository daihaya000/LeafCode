# OpenCode WebUI

OpenCode CLI（`opencode serve`）を実行エンジンにした Workspace Manager Web UI。本体はフォークしない。

## 起動（Windows）

1. PATH に `opencode`
2. `start-webui.bat`（初回は web build あり）
3. トレイ常駐後、`http://127.0.0.1:3000` が開く

トラブル時:

```bat
cd host
set OPENCODE_WEBUI_HEADLESS=1
set OPENCODE_WEBUI_NO_BROWSER=1
set OPENCODE_WEBUI_MODE=prod
node src\index.js
```

ログに `WebUI is ready` / `OpenCode is ready` が出れば OK。

## 正本

| 文書 | 役割 |
|------|------|
| [`architecture.md`](./architecture.md) | 企画・アーキテクチャ |
| [`docs/improvement-plan.md`](./docs/improvement-plan.md) | 改善・開発計画（UI/UX を Codex に寄せる） |
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
| 1 | worktree / Diff / orphan / SessionBinding |
| 2 | Commit / Merge / PR(`gh` 任意) |
| 3 | `temporary_copy` / Dev Container **検知 + host-fallback**（コンテナ起動は未） |
| UI-0〜4 | Codex 型 UI（composer-first ホーム / タスクカード / SSE 増分タイムライン / Part レンダラ / 権限インラインカード / ファイル別 Diff ペイン / light-dark テーマ / モバイル / ⌘K）※ [docs/improvement-plan.md](./docs/improvement-plan.md) |
| R | リモート: トレイ管理の Caddy 逆プロキシ（`OPENCODE_WEBUI_CADDY=1`）|

## 最短フロー

1. ホームの composer にタスクを記述（初回はプロジェクト追加）
2. Project / Isolation を選んで送信 → タスク詳細へ自動遷移
3. タイムラインで進行を確認・権限を承認（必要なら停止）
4. Diff ペインで確認 → Commit → Merge（または PR 作成）

## リモート（任意 / Caddy）

VPN 経由で公開する場合、トレイ常駐ホストが **Caddy 逆プロキシを管理**できます。

```bat
set OPENCODE_WEBUI_CADDY=1
rem 任意: Caddyfile の場所を変更
set OPENCODE_WEBUI_CADDYFILE=C:\path\to\Caddyfile
start-webui.bat
```

- 初回起動時に [`deploy/Caddyfile.example`](./deploy/Caddyfile.example) から `deploy/Caddyfile` を生成します（ドメイン / Basic 認証を編集してください）。
- ホストが Caddy の起動 / 停止 / 再起動を OpenCode・WebUI と連動管理し、トレイの「Status」に `Caddy: running` を表示します。
- OpenCode 本体は常に `127.0.0.1` のみで待ち受け、公開されるのは Next.js BFF（:3000）のみです。**VPN と認証なしで公開しないでください。**
- Caddy が PATH に無い / 無効の場合はスキップします。

### HTTPS（既定: `:8443` ローカル TLS）

`deploy/Caddyfile` は既定で **HTTPS(:8443)** を `tls internal`（Caddy のローカル CA・自己署名）で配信します。起動時に UAC が出ないよう `skip_install_trust` を付けているため、証明書の信頼登録は下記スクリプトで**手動 1 回だけ**行います。

```bat
rem 1) CA を Windows の信頼ストアへ登録（管理者で実行 / 1回だけ）
scripts\caddy-trust.bat
rem 2) スマホ/LAN からアクセスするならファイアウォールを開放（管理者）
scripts\allow-firewall-8443.bat
```

- アクセス URL: `https://localhost:8443` / `https://<LAN もしくは VPN の IP>:8443`
- **アクセスする名前/IP は `deploy/Caddyfile` の site 行に列挙**してください（列挙した名前にだけ証明書が発行されます）。既定は `localhost, 127.0.0.1, 192.168.0.102`。LAN IP が変わる場合は DHCP 予約推奨。
- スマホは警告なしにするには CA(`%APPDATA%\Caddy\pki\authorities\local\root.crt`)を端末へインストール。未インストールでも「警告を無視して続行」で利用可（ただし PWA/Service Worker は信頼済み証明書が必要）。
- 公開ドメインがある場合は Caddyfile の Let's Encrypt ブロック（コメント）を使うと、全端末で警告なしの正規 TLS になります（80/443 到達性 + DNS 必須）。
- HTTP(:8080) に戻したい場合は Caddyfile の該当ブロックのコメントを解除してください。

Remote Workspace API はスタブ（`/api/remote` → 501）。当面は VPN + ローカルパスを開く運用です。

```bat
cd web && npm install && npm run dev
```

別ターミナルで `opencode serve --hostname 127.0.0.1 --port 4096`。  
スモーク: WebUI 起動後に `node scripts/smoke-api.mjs`
