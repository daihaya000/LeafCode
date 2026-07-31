OpenCode CLI（`opencode serve`）を実行エンジンにした Workspace Manager Web UI。本体はフォークしない。

## 起動（Windows）

1. リポジトリルートの `OpenCodeWebUI.exe` をダブルクリックします。初回は `winget`、Node.js 20以上、OpenCode、web/hostの依存関係、production buildを確認・導入し、2回目以降は既に導入済みのステップを自動でスキップして起動だけ行います（`node_modules` / `%APPDATA%\opencode-webui\web-build\BUILD_ID` の有無で判定する冪等な処理です。出力先は `OPENCODE_WEBUI_DIST_DIR` で上書き可能）。prodでは同ディレクトリの `BUILD_ID` が欠落しているかソースより古い場合、起動・トレイ/WebUI再起動時に自動buildします。
2. トレイ常駐後、`http://127.0.0.1:3000` を開きます。

既定では WebUI（Next.js BFF）も OpenCode 本体も `127.0.0.1` のみで待ち受け、LAN/VPN への公開は明示的な opt-in です。スマホ/別PC からアクセスする場合は、Caddy 逆プロキシ（`OPENCODE_WEBUI_CADDY=1`、推奨）を使うか、`OPENCODE_WEBUI_HOST=0.0.0.0` で全インターフェースにバインドしてください。

`OpenCodeWebUI.exe` は管理者権限、Firewallルール、Caddy設定を変更しません。通常は失敗時に画面を止めて案内を表示します。`winget` がない場合はMicrosoft Storeから「アプリインストーラー」を入手してください。Node.jsまたはOpenCodeを導入した直後に見つからない場合は、再ログインまたはPC再起動後に `OpenCodeWebUI.exe` を再実行してください。

### タスクバーへのピン留め

`OpenCodeWebUI.exe` はリポジトリ直下に配置された唯一のエントリで、git 管理されています（新規 clone でもダブルクリックで即起動できます）。実体は `scripts/launcher/Launcher.cs` を `.NET Framework` 同梱の `csc.exe` でコンパイルしたアイコン埋め込み済みのネイティブ exe で、コンソールタイトルを設定したうえで内部の `scripts/start-webui.bat`（セットアップ＋トレイ host 起動）を同じコンソールで実行する薄いラッパーです。ショートカットの対象を `.bat` ではなく実在の `.exe` にすることで、Explorerの「タスクバーにピン留めする」がより確実に提供されます。

- `scripts/build-launcher.bat` で exe を再生成できます。出力先はリポジトリ直下で、実行中の exe は上書きできないため rename-swap（旧 exe を `.old` に退避してから新 exe を書き、成功後に破棄）で再ビルドします。通常は不要ですが、`Launcher.cs` やアイコンを編集した後に `scripts/start-webui.bat` が起動時に新しさを検知して自動で `/quiet` 再ビルドするため、次回起動から反映されます。
- `scripts/create-shortcut.bat` を実行すると、デスクトップに固有アイコン付きの `OpenCode WebUI.lnk` ショートカットを作成します（対象はリポジトリ直下の `OpenCodeWebUI.exe`。何らかの理由で exe が欠落している場合は `scripts/build-launcher.bat` で再生成してから対象にします）。実行中のコンソールウィンドウは `title` コマンドで "OpenCode WebUI" というタイトルになるため、Alt-Tab やタスクバーで汎用的な「コマンド プロンプト」ではなく識別しやすい表示になります。

Windows 10 1809 以降はショートカットをスクリプトから自動でタスクバーへピン留めする手段が提供されていないため、ピン留め自体は手動です。作成された `OpenCode WebUI.lnk` を右クリックし「タスクバーにピン留めする」を選択してください。

### 文字化け・エンコード

`.bat` / `.cmd` は ASCII のみで記述し、日本語メッセージは `scripts/setup-messages/*.txt`（UTF-8・BOM なし・CRLF）に分離して `type` で出力します。cmd.exe は非 ASCII バイトを含む行の直後で読み取り位置を誤り、行の途中から実行するためです。ランチャーが呼ぶ内部の `scripts/start-webui.bat` は英語の要約行（`[OpenCode WebUI] ERROR <code>: ...`）を先に出力し、続けて日本語詳細を `type` する二段構成のため、日本語が読めない環境でもエラーコードで判別できます。メッセージファイルが欠落していても `scripts/start-webui.bat` は完走します。README 内の `bat` コード例も ASCII のみにしてください。配布前チェック: `npm run test:encoding`。詳細は `docs/specs/bat-encoding-safety.md` を参照してください。

### production build

稼働中にproduction buildの出力ディレクトリ（`%APPDATA%\opencode-webui\web-build`、`OPENCODE_WEBUI_DIST_DIR`で上書き可能）を上書きすると、配信中のHTMLとチャンクの世代が混在して `ChunkLoadError` になります。これを防ぐため:

- `build.bat` は、本番WebUI（`next start`）が同じポートで稼働中（またはリスナーの正体が不明）なら**ビルドを中止**します。トレイまたは `OpenCodeWebUI.exe` からWebUIを停止してから再実行してください。
- ランチャー内部の `scripts/start-webui.bat` は、稼働中のWebUIがあれば**初回ビルドをスキップしてhost本体へ進みます**。トレイhostが健全なWebUIをそのまま再利用するか、古くなった自前の `next start` を引き継いでから `%APPDATA%\opencode-webui\web-build` へリビルドします（孤立した不明プロセスは決して終了させません）。

`npm run build`（`web/` で直接実行）のガードはチェックのみで、稼働中なら従来どおり中止します。

ランチャー（内部の `scripts/start-webui.bat`）は各エラーを `[OpenCode WebUI] ERROR <code>: <english summary>` の英語行として表示します。下記のコード表と対応します。

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
| [`docs/browser-bridge-setup.md`](./docs/browser-bridge-setup.md) | Browser Bridge MCP セットアップ手順 |
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

任意で Caddyfile の場所を変える例（`.bat` 内は ASCII のみ。日本語は書かない）:

```bat
set OPENCODE_WEBUI_CADDY=1
rem optional: override Caddyfile path
set OPENCODE_WEBUI_CADDYFILE=C:\path\to\Caddyfile
OpenCodeWebUI.exe
```

- 初回起動時に [`deploy/Caddyfile.example`](./deploy/Caddyfile.example) から `deploy/Caddyfile` を生成します（ドメイン / Basic 認証を編集してください）。
- ホストが Caddy の起動 / 停止 / 再起動を OpenCode・WebUI と連動管理し、トレイの「Status」に `Caddy: running` を表示します。
- OpenCode 本体は常に `127.0.0.1` のみで待ち受けます。Next.js BFF（:3000）も既定は `127.0.0.1` のみで、Caddy 逆プロキシ経由で LAN/VPN に公開します（`OPENCODE_WEBUI_HOST=0.0.0.0` で直接全インターフェースにバインドすることも可能ですが、**VPN と認証なしで公開しないでください**）。
- Caddy が PATH に無い / 無効の場合はスキップします。

### HTTPS（既定: `:8443` ローカル TLS）

`deploy/Caddyfile` は既定で **HTTPS(:8443)** を `tls internal`（Caddy のローカル CA・自己署名）で配信します。起動時に UAC が出ないよう `skip_install_trust` を付けているため、証明書の信頼登録は下記スクリプトで**手動 1 回だけ**行います。

1) CA を Windows の信頼ストアへ登録（管理者で実行 / 1 回だけ）  
2) スマホ / LAN からアクセスするならファイアウォールを開放（管理者）

```bat
scripts\caddy-trust.bat
scripts\allow-firewall-8443.bat
```

- アクセス URL: `https://localhost:8443` / `https://<LAN もしくは VPN の IP>:8443`
- **アクセスする名前/IP は `deploy/Caddyfile` の site 行に列挙**してください（列挙した名前にだけ証明書が発行されます）。既定は `localhost, 127.0.0.1` に加えて、ご自身の環境のLAN IP（例: `192.168.1.100`）を追記します。LAN IP が変わる場合は DHCP 予約推奨。
- `this endpoint is only available from the host machine` がホストPC上の Caddy 経由アクセスで出る場合は、既存の `deploy/Caddyfile` の host-only API `handle` に `deploy/Caddyfile.example` と同じ `/api/host/logs*` と `/api/updates/*` を追加して Caddy を再起動してください。
- 公開ドメインがある場合は Caddyfile の Let's Encrypt ブロック（コメント）を使うと、CA 導入不要で全端末が警告なしの正規 TLS になります（80/443 到達性 + DNS 必須）。
- HTTP で WebUI 自体を配信したい場合は Caddyfile の `:8080` ブロックの `handle`（リダイレクト）を、コメントで示した `reverse_proxy` 版に差し替えてください。

#### 別端末（スマホ / 別PC）で「保護されていない通信」になる場合

`tls internal` は **Caddy 自身のローカル CA** で署名するため、その CA を知らない端末では必ず証明書警告になります（設定ミスではありません）。端末側にルート CA を入れると解消します。Caddyfile の `:8080` ブロックがルート CA を配布します（公開鍵証明書のみ。秘密鍵 `root.key` は同じフォルダにありますが配信されません）。

配布用ポートを開放（管理者 / 1 回だけ）:

```bat
scripts\allow-firewall-8080.bat
```

端末のブラウザで `http://<LAN もしくは VPN の IP>:8080/caddy-root.crt` を開いてダウンロードし、下記の手順で導入します。

| 端末 | 導入手順 |
| --- | --- |
| Android | 設定 → セキュリティ → 暗号化と認証情報 → 証明書をインストール → **CA 証明書** を選び、ダウンロードした `caddy-root.crt` を指定。以後 Chrome も信頼します（「ネットワークが監視される可能性」の通知は仕様） |
| iOS / iPadOS | Safari で開き「プロファイルを許可」→ 設定 → 一般 → VPN とデバイス管理 からインストール → **設定 → 一般 → 情報 → 証明書信頼設定で当該 CA を ON**（この最後の操作を忘れると信頼されません） |
| 別の Windows PC | `certutil -addstore -f Root caddy-root.crt` を管理者で実行（または .crt をダブルクリック →「ローカル コンピューター」→「信頼されたルート証明機関」） |
| macOS | キーチェーンアクセスの「システム」に追加し、当該 CA を「常に信頼」に変更 |

- ルート CA を入れずに「警告を無視して続行」でも閲覧はできますが、**PWA / Service Worker / クリップボード / 通知は信頼済み証明書でないと動きません**。
- ルート CA は 10 年有効で、Caddy の再インストールや `%APPDATA%\Caddy\pki` の削除で再生成されると端末側の再導入が必要になります。
- 配布 URL が 404 になる場合は Caddy が `APPDATA` 環境変数を引き継いでいません。`deploy/Caddyfile` の `root *` をルート CA の絶対パスに書き換えてください。

Remote Workspace API はスタブ（`/api/remote` → 501）。当面は VPN + ローカルパスを開く運用です。

```bat
cd web && npm install && npm run dev
```

別ターミナルで `opencode serve --hostname 127.0.0.1 --port 4096`。  
スモーク: WebUI 起動後に `node scripts/smoke-api.mjs`。Browser Bridge はトレイ host が起動済みの環境で `npm run smoke:browser-bridge` を実行する（このコマンドは host / Broker を起動しない）。
