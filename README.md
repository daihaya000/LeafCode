OpenCode CLI（`opencode serve`）を実行エンジンにした Workspace Manager Web UI。本体はフォークしない。

## 起動（Windows）

1. **初回のみ**、リポジトリルートの `setup.bat` をダブルクリックします。`winget`、Node.js 20以上、OpenCode、web/hostの依存関係、production buildを確認・導入し、完了後にWebUIを起動します。
2. **2回目以降**は `start-webui.bat` をダブルクリックします。prodでは `.next` が欠落しているかソースより古い場合、起動・トレイ/WebUI再起動時に自動buildします。
3. トレイ常駐後、`http://127.0.0.1:3000` を開きます。

`setup.bat` は管理者権限、Firewallルール、Caddy設定を変更しません。通常は失敗時に画面を止めて案内を表示します。`winget` がない場合はMicrosoft Storeから「アプリインストーラー」を入手してください。Node.jsまたはOpenCodeを導入した直後に見つからない場合は、再ログインまたはPC再起動後に `setup.bat` を再実行してください。

### production build

稼働中に `web/.next` を上書きすると、配信中のHTMLとチャンクの世代が混在して `ChunkLoadError` になります。これを防ぐため、`build.bat` と `setup.bat` は本番WebUI（`next start`）が同じポートで稼働中なら、**トレイhostに停止を依頼してからビルドを続行**します。`build.bat` はビルド成功後に自動でWebUIを再起動します（ビルド失敗時は再起動せず、トレイまたは `start-webui.bat` からの起動を案内します）。

停止できない場合はビルドを中止します。

- ポートのリスナーの正体を特定できない場合は、無関係なアプリを止めないため何も停止せず中止します。
- 稼働中のトレイhostが停止エンドポイントを持たない旧バージョンの場合も中止します（強制終了してもhostが自動再起動してしまうため）。トレイからWebUIを停止するか、hostを再起動してから再実行してください。
- トレイhostが動いていない孤立した `next start` だけは、この repo の `next start` と確認できた場合に限り強制終了します。

`npm run build`（`web/` で直接実行）のガードはチェックのみで、稼働中なら従来どおり中止します。

セットアップの終了コード:

| コード | 意味 | 復旧方法 |
|---:|---|---|
| 1 | `winget` がない | 「アプリインストーラー」を導入する |
| 2 | Node.js導入失敗 | [nodejs.org](https://nodejs.org/) から手動導入する |
| 3 | Node.jsのPATHが未反映 | 再ログインまたはPC再起動後に再実行する |
| 4 | OpenCode導入失敗またはPATH未反映 | [OpenCode Docs](https://opencode.ai/docs) を参照し、必要なら再ログイン後に再実行する |
| 5 | webの依存関係導入失敗 | ネットワークと `web/package-lock.json` を確認する |
| 6 | web build失敗 | 表示されたビルドエラーとNode.jsバージョンを確認する |
| 7 | build後に`BUILD_ID`がない | ビルドログを確認して再実行する |
| 8 | hostの依存関係導入失敗 | ネットワークと `host/package-lock.json` を確認する |

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
| [`docs/opencode/`](./docs/opencode/) | OpenAPI スナップショット |
| [OpenCode Docs](https://opencode.ai/docs) | OpenCode 公式ドキュメント |

企画・アーキテクチャや開発途中の計画・作業メモは非公開のローカル文書として管理しており、本リポジトリには含まれません。

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
| UI-0〜4 | Codex 型 UI（composer-first ホーム / タスクカード / SSE 増分タイムライン / Part レンダラ / 権限インラインカード / ファイル別 Diff ペイン / light-dark テーマ / モバイル / ⌘K） |
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
- **アクセスする名前/IP は `deploy/Caddyfile` の site 行に列挙**してください（列挙した名前にだけ証明書が発行されます）。既定は `localhost, 127.0.0.1` に加えて、ご自身の環境のLAN IP（例: `192.168.1.100`）を追記します。LAN IP が変わる場合は DHCP 予約推奨。
- スマホは警告なしにするには CA(`%APPDATA%\Caddy\pki\authorities\local\root.crt`)を端末へインストール。未インストールでも「警告を無視して続行」で利用可（ただし PWA/Service Worker は信頼済み証明書が必要）。
- 公開ドメインがある場合は Caddyfile の Let's Encrypt ブロック（コメント）を使うと、全端末で警告なしの正規 TLS になります（80/443 到達性 + DNS 必須）。
- HTTP(:8080) に戻したい場合は Caddyfile の該当ブロックのコメントを解除してください。

Remote Workspace API はスタブ（`/api/remote` → 501）。当面は VPN + ローカルパスを開く運用です。

```bat
cd web && npm install && npm run dev
```

別ターミナルで `opencode serve --hostname 127.0.0.1 --port 4096`。  
スモーク: WebUI 起動後に `node scripts/smoke-api.mjs`
