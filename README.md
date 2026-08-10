<div align="center">
  <img src="web/public/icon-512.png" alt="OpenCode WebUI" width="120" />

  # OpenCode WebUI

  **ターミナルの AI エージェント [OpenCode](https://opencode.ai) を、ブラウザで動かすワークスペースマネージャ**

  ダブルクリックするだけ。セットアップは全自動。<br />
  タスクの指示 → リアルタイム進行 → Diff レビュー → コミットまで、ぜんぶここで。

  [![platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D6?logo=windows&logoColor=white)](#動作条件)
  [![engine](https://img.shields.io/badge/engine-OpenCode%20CLI-F97316)](https://opencode.ai)
  [![frontend](https://img.shields.io/badge/frontend-Next.js-000000?logo=next.js&logoColor=white)](https://nextjs.org)
  [![node](https://img.shields.io/badge/Node.js-20%2B-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org)
  [![license](https://img.shields.io/badge/license-MIT-94A3B8)](./LICENSE)
</div>

---

## これは何？

**OpenCode WebUI** は、CLI ツールである [OpenCode](https://opencode.ai)（`opencode serve`）を実行エンジンにした、ローカル動作のブラウザアプリです。OpenCode 本体はフォークせず、そのまま裏側で動かします。

- ホームの **composer** に「〇〇を実装して」と書くだけでタスクが開始
- タスクごとの **タイムライン** が SSE でリアルタイム更新。進行状況が見える
- エージェントからの権限要求は **インラインカード** でその場で承認
- 完了したら **ファイル別 Diff ペイン** でレビューし、**Commit / Merge / PR** まで一気通貫

既定では `127.0.0.1`（自分の PC 内）でのみ待ち受けるので、そのまま使ってもネットワークには公開されません。

## できること

| | 機能 | 内容 |
| --- | --- | --- |
| **タスク管理** | composer-first ホーム / タスクカード / SSE 増分タイムライン | チャットのようにタスクを投げ、進行を実況表示 |
| **権限承認** | インライン承認カード / allowlist | ファイル操作・コマンド実行をその場で許可・拒否 |
| **Git 連携** | ファイル別 Diff ペイン / Commit / Merge / PR | `gh` があれば PR 作成まで UI から（任意） |
| **ワークスペース分離** | git worktree / orphan / SessionBinding | タスクごとに独立した作業領域で並行作業 |
| **トレイ常駐** | 自動セットアップ / 自動ビルド / 再起動連携 | 閉じてもバックグラウンドで待機 |
| **リモートアクセス** | Caddy 逆プロキシ / ローカル HTTPS | オプトインでスマホ・別 PC から安全に接続 |
| **UI** | light / dark テーマ / モバイル対応 / ⌘K パレット | Codex 風の composer-first デザイン |

## Workflow Graphの段階公開

Workflow Graphは既定でread-only表示が有効です。semantic編集は安全確認済み環境でのみ明示的に有効化してください。

| 環境変数 | 既定値 | 内容 |
| --- | --- | --- |
| `OPENCODE_WEBUI_WORKFLOW_MODE` | `true`（EXE） | Workflow機能全体。`false`で旧Workflow UIへrollback |
| `OPENCODE_WEBUI_WORKFLOW_GRAPH` | `true`（EXE） | Graph read-only表示。親Workflowが無効なら強制無効 |
| `OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT` | `false` | Node／Edgeのsemantic編集。Graph flagが無効なら強制無効 |

Graph DraftはRun開始時にExecution Snapshot v2へコピーされ、実行中RunはDraft変更の影響を受けません。問題がある場合は`OPENCODE_WEBUI_WORKFLOW_GRAPH=false`でread-only Graphから旧UIへ戻せます。

---

## クイックスタート

### 1. リポジトリを取得

```bat
git clone https://github.com/daihaya000/OpenCodeWebUI.git
cd OpenCodeWebUI
```

### 2. `OpenCodeWebUI.exe` をダブルクリック

初回起動時に **winget → Node.js 20+ → OpenCode CLI → Caddy（リモートアクセス用、任意）→ uv（Qwen-MM-Plugins MCP 用、任意）→ 依存関係 → production build** を自動で確認・導入します（**インターネット接続が必要**）。2 回目以降は導入済みのステップをスキップしてすぐ起動します。

> [!IMPORTANT]
> `OpenCodeWebUI.exe` は、同じフォルダの `scripts\start-webui.bat` を実行するだけの薄いランチャーです。
> **exe 単体だけを USB メモリや別 PC にコピーしないでください。** `scripts/` `host/` `web/` を含むリポジトリフォルダごと置いて実行する必要があります（単体コピーは `scripts\start-webui.bat not found` で停止します）。

> [!WARNING]
> 未署名の exe のため、Windows SmartScreen の警告が出ることがあります。
> **「詳細情報」→「実行」** を選択すると先へ進めます。

> [!TIP]
> セットアップ中に失敗すると、ウィンドウは自動で閉じず **「Press Enter to close this window...」** と表示して待機します。表示されたエラーメッセージ（`[OpenCode WebUI] ERROR <コード>: ...`）を確認してから閉じてください。環境変数 `OPENCODE_WEBUI_NONINTERACTIVE=1` を設定すると待機をスキップします。

### 3. ブラウザで `http://127.0.0.1:3000` を開く

トレイにアイコンが常駐したら起動完了です。

---

## 動作条件

| 項目 | 要件 |
| --- | --- |
| OS | Windows 10（1809 以降）/ Windows 11、x64 |
| ネットワーク | 初回実行のみ必須（winget / npm / OpenCode CLI のダウンロード） |
| winget | 無い場合は Microsoft Store から「アプリ インストーラー」を先に導入 |
| 配置場所 | exe をリポジトリフォルダ直下に置いたまま実行（単体コピー不可） |

> [!NOTE]
> Node.js または OpenCode を導入した直後に「見つからない」と言われる場合は、**再ログインまたは PC 再起動** してから再実行してください（PATH の反映に必要です）。

---

## 基本的な使い方

1. **プロジェクトを追加**（初回のみ）— 作業したいリポジトリを登録します
2. **composer にタスクを入力** — 例: 「ダークモードのトグルを追加して」
3. **Project / Isolation を選んで送信** — タスク詳細へ自動で移動します
4. **タイムラインで進行を確認** — 権限要求が来たらインラインで承認（必要なら停止）
5. **Diff ペインで変更をレビュー** — Commit → Merge（または PR 作成）

## タスクバーにピン留めする

1. `scripts\create-shortcut.bat` を実行すると、デスクトップに固有アイコン付きの `OpenCode WebUI.lnk` ができます
2. ショートカットを右クリック → **「タスクバーにピン留めする」**

> [!NOTE]
> Windows 10 1809 以降はスクリプトからの自動ピン留めが提供されていないため、最後の手順だけ手動です。
> 起動中のコンソールウィンドウは `title` コマンドで **"OpenCode WebUI"** というタイトルになるため、Alt-Tab やタスクバーでも「コマンド プロンプト」と混同しません。

<details>
<summary><b>ランチャーの詳細（exe のしくみ・再ビルド）</b></summary>

- `OpenCodeWebUI.exe` は `scripts/launcher/Launcher.cs` を .NET Framework 同梱の `csc.exe` でコンパイルしたアイコン埋め込み済みのネイティブ exe で、コンソールタイトルを設定したうえで `scripts/start-webui.bat`（セットアップ＋トレイ host 起動）を同じコンソールで実行する薄いラッパーです。ショートカットの対象を `.bat` ではなく実在の `.exe` にすることで、Explorer の「タスクバーにピン留めする」がより確実に提供されます。
- `scripts/build-launcher.bat` で exe を再生成できます。出力先はリポジトリ直下で、実行中の exe は上書きできないため rename-swap（旧 exe を `.old` に退避してから新 exe を書き、成功後に破棄）で再ビルドします。通常は不要ですが、`Launcher.cs` やアイコンを編集した後に `scripts/start-webui.bat` が起動時に新しさを検知して自動で `/quiet` 再ビルドするため、次回起動から反映されます。

</details>

---

## スマホ・別 PC からアクセスする（任意）

既定では WebUI（Next.js BFF）も OpenCode 本体も `127.0.0.1` のみで待ち受け、LAN/VPN への公開は **明示的なオプトイン** です。

| 方法 | 環境変数 | 用途 |
| --- | --- | --- |
| **Caddy 逆プロキシ（推奨）** | `OPENCODE_WEBUI_CADDY=1` | HTTPS で安全に公開。トレイ host が Caddy を連動管理 |
| 直接バインド | `OPENCODE_WEBUI_HOST=0.0.0.0` | 全インターフェースで待ち受け。**VPN と認証なしで公開しないでください** |
| Qwen画像ネイティブ統合 | `DASHSCOPE_API_KEY` | 画像非対応モデルへの送信前にWebUIが`qwen3.7-plus`で画像を直接解析。`OPENCODE_WEBUI_QWEN_VISION_MODEL`で解析モデルを変更、`OPENCODE_WEBUI_QWEN_NATIVE=0`で無効化 |
| Qwen-MM-Plugins MCP | `OPENCODE_WEBUI_QWEN_MM=1` | 画像非対応モデルでも MCP 経由で画像/動画/文書読み取り・OCR・grounding を利用。初回起動時に uv（`astral-sh.uv`）を自動導入。`DASHSCOPE_API_KEY` / `SERPER_API_KEY` は env から参照 |

Qwen画像ネイティブ統合を利用すると、画像非対応モデルへ添付した画像と依頼文が解析のためDashScopeへ送信されます。APIキーを追加・変更した場合はWebUIを再起動してください。画像対応モデルでは従来どおり選択モデルへ画像を直接送信し、Qwenによる事前解析は行いません。

```bat
set OPENCODE_WEBUI_CADDY=1
rem optional: override Caddyfile path
set OPENCODE_WEBUI_CADDYFILE=C:\path\to\Caddyfile
OpenCodeWebUI.exe
```

- Caddy 本体は `OpenCodeWebUI.exe` の初回起動時に winget（`CaddyServer.Caddy`）で自動導入されます。手動インストールは不要です
- 初回起動時に [`deploy/Caddyfile.example`](./deploy/Caddyfile.example) から `deploy/Caddyfile` を生成します（ドメイン / Basic 認証を編集してください）
- ホストが Caddy の起動 / 停止 / 再起動を OpenCode・WebUI と連動管理し、トレイの「Status」に `Caddy: running` を表示します
- winget が無い / オフライン等で Caddy の自動導入に失敗した場合でも WebUI 本体は `http://127.0.0.1:3000` で通常どおり起動します（Caddy 連携だけがスキップされます）。手動で導入する場合は `winget install --id CaddyServer.Caddy` を実行し、再起動してください
- `OPENCODE_WEBUI_CADDY=0` を明示的に設定すると、Caddy の自動導入自体もスキップされます

### HTTPS（既定: `:8443` ローカル TLS）

`deploy/Caddyfile` は既定で **HTTPS(:8443)** を `tls internal`（Caddy のローカル CA・自己署名）で配信します。起動時に UAC が出ないよう `skip_install_trust` を付けているため、証明書の信頼登録は下記スクリプトで **手動 1 回だけ** 行います。

1) CA を Windows の信頼ストアへ登録（管理者で実行 / 1 回だけ）
2) スマホ / LAN からアクセスするならファイアウォールを開放（管理者）

```bat
scripts\caddy-trust.bat
scripts\allow-firewall-8443.bat
```

- アクセス URL: `https://localhost:8443` / `https://<LAN もしくは VPN の IP>:8443`
- **アクセスする名前/IP は `deploy/Caddyfile` の site 行に列挙** してください（列挙した名前にだけ証明書が発行されます）。既定は `localhost, 127.0.0.1` に加えて、ご自身の環境の LAN IP（例: `192.168.1.100`）を追記します。LAN IP が変わる場合は DHCP 予約推奨
- `this endpoint is only available from the host machine` がホスト PC 上の Caddy 経由アクセスで出る場合は、既存の `deploy/Caddyfile` の host-only API `handle` に `deploy/Caddyfile.example` と同じ `/api/host/logs*` と `/api/updates/*` を追加して Caddy を再起動してください
- 公開ドメインがある場合は Caddyfile の Let's Encrypt ブロック（コメント）を使うと、CA 導入不要で全端末が警告なしの正規 TLS になります（80/443 到達性 + DNS 必須）
- HTTP で WebUI 自体を配信したい場合は Caddyfile の `:8080` ブロックの `handle`（リダイレクト）を、コメントで示した `reverse_proxy` 版に差し替えてください

<details>
<summary><b>別端末で「保護されていない通信」になる場合（ルート CA の配布）</b></summary>

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

- ルート CA を入れずに「警告を無視して続行」でも閲覧はできますが、**PWA / Service Worker / クリップボード / 通知は信頼済み証明書でないと動きません**
- ルート CA は 10 年有効で、Caddy の再インストールや `%APPDATA%\Caddy\pki` の削除で再生成されると端末側の再導入が必要になります
- 配布 URL が 404 になる場合は Caddy が `APPDATA` 環境変数を引き継いでいません。`deploy/Caddyfile` の `root *` をルート CA の絶対パスに書き換えてください

</details>

> [!NOTE]
> Remote Workspace API はスタブ（`/api/remote` → 501）です。当面は VPN + ローカルパスを開く運用になります。

---

## トラブルシューティング

ランチャー（内部の `scripts/start-webui.bat`）は各エラーを `[OpenCode WebUI] ERROR <code>: <english summary>` の英語行として表示します。

| コード | 意味 | 復旧方法 |
| ---: | --- | --- |
| 1 | `winget` がない | 「アプリインストーラー」を導入する |
| 2 | Node.js 導入失敗 | [nodejs.org](https://nodejs.org/) から手動導入する |
| 3 | Node.js の PATH が未反映 | 再ログインまたは PC 再起動後に再実行する |
| 4 | OpenCode 導入失敗または PATH 未反映 | [OpenCode Docs](https://opencode.ai/docs) を参照し、必要なら再ログイン後に再実行する |
| 5 | web の依存関係導入失敗 | ネットワークと `web/package-lock.json` を確認する |
| 6 | web build 失敗 | 表示されたビルドエラーと Node.js バージョンを確認する |
| 7 | build 後に `BUILD_ID` がない | ビルドログを確認して再実行する |
| 8 | host の依存関係導入失敗 | ネットワークと `host/package-lock.json` を確認する |

UI から起動しないときは、headless モードでログを直接確認できます:

```bat
cd host
set OPENCODE_WEBUI_HEADLESS=1
set OPENCODE_WEBUI_NO_BROWSER=1
set OPENCODE_WEBUI_MODE=prod
node src\index.js
```

ログに `WebUI is ready` / `OpenCode is ready` が出れば OK です。

---

## 開発者向け

### プロジェクト構成

| パス | 役割 |
| --- | --- |
| `web/` | Next.js BFF + UI |
| `host/` | トレイ常駐（opencode + Next 管理） |
| `scripts/` | セットアップ / ランチャー / Caddy 連携スクリプト |
| `deploy/` | Caddyfile テンプレート |
| `scripts/smoke-api.mjs` | API スモークテスト |

### 開発サーバー

```bat
cd web && npm install && npm run dev
```

別ターミナルで `opencode serve --hostname 127.0.0.1 --port 4096` を起動します。
スモーク: WebUI 起動後に `node scripts/smoke-api.mjs`。Browser Bridge はトレイ host が起動済みの環境で `npm run smoke:browser-bridge` を実行します（このコマンドは host / Broker を起動しません）。

<details>
<summary><b>production build のミラーとガード</b></summary>

production build は**リポジトリ内では実行されません**。`scripts/web-build-mirror.mjs` がインストール全体をハードリンクでミラーし（既定 `%LOCALAPPDATA%\opencode-webui\build\<インストール名>-<ハッシュ>`、`OPENCODE_WEBUI_BUILD_DIR` で上書き可能）、`next build` と `next start` はそのミラー内で動きます。

理由は2つあります。OneDrive 同期がビルド中・配信中の出力に触れると HTML とチャンクの世代が混在して `ChunkLoadError` になること、そして Next 16 の Turbopack が「プロジェクト外を指す distDir」を拒否するため、出力だけでなくプロジェクトごと同期対象の外に置く必要があることです。

ハードリンクなので追加ディスクはほぼゼロで、同期は差分のみです。ジャンクションやシンボリックリンクは使えません（バンドラがリンクを実パスへ正規化し、モジュール解決が同期ツリーへ戻ってしまいます）。ミラーはインストールパスのハッシュで分離されるため、複数のチェックアウトが同じミラーを奪い合うことはありません。別ボリュームなどハードリンクを作れない環境では自動的にバイトコピーへ退避します。

ミラーはコピーなので、サーバーは `OPENCODE_WEBUI_INSTALL_ROOT` で実インストール先を受け取ります（自己更新や git-restore は実リポジトリに対して動作します）。手動でビルドする場合はリポジトリ直下で `node scripts/build-web.mjs`（= `npm --prefix web run build`）を実行してください。

配信中の出力を壊さないためのガードも従来どおりです:

- `build.bat` は、本番 WebUI（`next start`）が同じポートで稼働中（またはリスナーの正体が不明）なら **ビルドを中止** します。トレイまたは `OpenCodeWebUI.exe` から WebUI を停止してから再実行してください
- ランチャー内部の `scripts/start-webui.bat` は、稼働中の WebUI があれば **初回ビルドをスキップして host 本体へ進みます**。トレイ host が健全な WebUI をそのまま再利用するか、古くなった自前の `next start` を引き継いでからミラーへリビルドします（孤立した不明プロセスは決して終了させません）

</details>

<details>
<summary><b>バッチファイルのエンコード規則（貢献者向け）</b></summary>

`.bat` / `.cmd` は ASCII のみで記述し、日本語メッセージは `scripts/setup-messages/*.txt`（UTF-8・BOM なし・CRLF）に分離して `type` で出力します。cmd.exe は非 ASCII バイトを含む行の直後で読み取り位置を誤り、行の途中から実行するためです。ランチャーが呼ぶ内部の `scripts/start-webui.bat` は英語の要約行（`[OpenCode WebUI] ERROR <code>: ...`）を先に出力し、続けて日本語詳細を `type` する二段構成のため、日本語が読めない環境でもエラーコードで判別できます。メッセージファイルが欠落していても `scripts/start-webui.bat` は完走します。README 内の `bat` コード例も ASCII のみにしてください。配布前チェック: `npm run test:encoding`。詳細は [`docs/specs/bat-encoding-safety.md`](./docs/specs/bat-encoding-safety.md) を参照してください。

</details>

### 実装済み機能

| Phase | 内容 |
| --- | --- |
| 0 | BFF プロキシ / SSE / 権限承認 / allowlist / トレイ |
| 1 | worktree / Diff / orphan / SessionBinding |
| 2 | Commit / Merge / PR（`gh` 任意） |
| 3 | `temporary_copy` / Dev Container **検知 + host-fallback**（コンテナ起動は未） |
| UI-0〜4 | Codex 型 UI（composer-first ホーム / タスクカード / SSE 増分タイムライン / Part レンダラ / 権限インラインカード / ファイル別 Diff ペイン / light-dark テーマ / モバイル / ⌘K） |
| R | リモート: トレイ管理の Caddy 逆プロキシ（`OPENCODE_WEBUI_CADDY=1`） |
| MM | Qwen-MM-Plugins MCP: 画像非対応モデルでも MCP 経由で画像/動画/文書読み取り・OCR・grounding を利用（`OPENCODE_WEBUI_QWEN_MM=1`、要 uv） |

---

## ドキュメント

| 文書 | 役割 |
| --- | --- |
| [`docs/opencode/`](./docs/opencode/) | OpenAPI スナップショット |
| [`docs/browser-bridge-setup.md`](./docs/browser-bridge-setup.md) | Browser Bridge MCP セットアップ手順 |
| [`docs/specs/bat-encoding-safety.md`](./docs/specs/bat-encoding-safety.md) | バッチファイルのエンコード安全規則 |
| [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins) | Qwen-MM-Plugins 本体リポジトリ |
| [OpenCode Docs](https://opencode.ai/docs) | OpenCode 公式ドキュメント |

> [!NOTE]
> 企画・アーキテクチャや開発途中の計画・作業メモは非公開のローカル文書として管理しており、本リポジトリには含まれません。

---

## ライセンス

[MIT](./LICENSE) — 詳細は LICENSE ファイルを参照してください。
