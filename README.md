# LeafCode

CLI エージェント [OpenCode](https://opencode.ai) をブラウザから操作するための、Windows 向けローカル Web アプリケーションです。OpenCode 本体はフォークせず、`opencode serve` を別プロセスとして起動し、その HTTP API を利用します。

リポジトリは 3 つの実行単位で構成されています。

- `web/` — Next.js の UI と BFF。ブラウザからの要求を OpenCode API・Git・ファイルシステムへ中継します。
- `host/` — Windows のトレイに常駐する Node プロセス。OpenCode と Next.js の起動・監視・再起動、認証セッション、ログ収集、Caddy の連動管理を行います。
- `browser-bridge/` — 開いているブラウザタブをエージェントへ共有する MCP サーバーとブラウザ拡張。

WebUI と OpenCode は既定で `127.0.0.1` のみを待ち受けます。LAN や VPN への公開は、後述の設定を明示的に行った場合にだけ有効になります。

> **改名移行中**: 表示名は LeafCode ですが、実行ファイル名（`OpenCodeWebUI.exe`）、リポジトリ URL、環境変数 `OPENCODE_WEBUI_*`、データ保存先 `%APPDATA%\opencode-webui` は互換性のため移行前の名称のままです。

## 動作条件

| 項目 | 要件 |
| --- | --- |
| OS | Windows 10（1809 以降）または Windows 11、x64 |
| Node.js | 20 以上（未導入の場合は初回起動時に winget で導入） |
| winget | 無い場合は Microsoft Store の「アプリ インストーラー」を先に導入 |
| ネットワーク | 初回起動時に必要（Node.js / OpenCode CLI / 依存関係の取得） |

## 導入と起動

```bat
git clone https://github.com/daihaya000/LeafCode.git
cd LeafCode
```

リポジトリ直下の `OpenCodeWebUI.exe` を実行します。初回起動時に winget → Node.js → OpenCode CLI → Caddy（リモートアクセス用・任意）→ 依存関係 → production build の順に確認と導入を行います。2 回目以降は完了済みの手順を飛ばして起動します。

起動後、トレイにアイコンが常駐したら `http://127.0.0.1:3000` を開きます。トレイメニューからブラウザの起動、稼働状況の確認、WebUI / OpenCode の再起動、終了ができます。

`OpenCodeWebUI.exe` は同じフォルダーの `scripts\start-webui.bat` を実行する薄いランチャー（`scripts/launcher/Launcher.cs`）です。exe 単体を別の場所へコピーしても動作しません。`scripts/` `host/` `web/` を含むリポジトリごと配置してください。exe には署名がないため、SmartScreen の警告が出た場合は「詳細情報」→「実行」で続行します。`Launcher.cs` やアイコンを更新した場合は起動時に自動で再ビルドされます（手動で行う場合は `scripts\build-launcher.bat`）。

セットアップが失敗した場合、ウィンドウは自動で閉じずにエラー行（`[OpenCode WebUI] ERROR <コード>: ...`）と日本語の復旧案内を表示して待機します。`OPENCODE_WEBUI_NONINTERACTIVE=1` を設定すると待機しません。

### タスクバーへのピン留め

`scripts\create-shortcut.bat` を実行するとデスクトップに `OpenCode WebUI.lnk` が作成されます。ショートカットを右クリックして「タスクバーにピン留めする」を選択してください。Windows 10 1809 以降は自動ピン留めの API が提供されていないため、最後の手順のみ手動です。

## 基本操作

1. プロジェクト（作業対象のリポジトリ）を追加する。
2. ホーム画面の composer にタスク内容を入力し、プロジェクトと分離方式を選んで送信する。
3. タスク画面のタイムラインで進行を確認する。権限要求はインラインのカードで承認・拒否する。
4. 差分ペインで変更内容をレビューし、コミット、マージ、または PR を作成する。

タスクごとの作業領域は次のいずれかで分離します。`current_folder` はプロジェクトのフォルダーをそのまま使い、`git_worktree` は git worktree を作成、`temporary_copy` はローカルデータディレクトリへ複製します。`devcontainer` は設定を検知した場合にホスト実行へフォールバックします（コンテナ内での実行は未実装）。

## 機能

**タスク実行**

- composer からのタスク作成、タスク一覧、アーカイブ、SSE による増分タイムライン更新
- 権限要求・質問のインラインカード、サブエージェントの入れ子表示、ツール呼び出しの要約
- モデル・エージェント・スキルの選択、自動モデル選定、トークン量とコストの表示
- ループ（完走モード）: ゴールを与えて達成判定まで自動でターンを繰り返す
- ワークフロー: ノードグラフによる多段実行。既定では読み取り専用表示
- PTY パネルによる対話的なターミナル操作
- ハング検知とタイムアウトのサーバー側監視

**Git 連携**

- ファイル別の差分表示、ファイルツリー、任意コミットの参照
- コミットメッセージの生成、commit / push / merge、`gh` があれば PR 作成

**設定と拡張**

- エージェント、スキル、MCP サーバー、プラグイン、プロバイダー・モデルの一覧と編集
- OpenCode 設定プロファイルの切り替えと、`AGENTS.md` の同期
- メモリ層: プロジェクト単位の永続記憶。セッション終了時の自動抽出、承認、セッション冒頭への注入を MCP 経由で行う
- 画像解析: 画像非対応モデルの利用時に、OpenCode に登録済みの画像対応モデルで事前解析する
- Browser Bridge: 承認したブラウザタブをエージェントへ共有する MCP 連携
- WebUI / OpenCode / Next.js の更新確認と適用、ホストログの閲覧、ファイアウォール開放の実行

**認証とアクセス**

- ユーザー登録によるログイン、および Windows アカウント認証
- セッションは host プロセスの秘密鍵で HMAC 署名した cookie で検証する。信頼済みデバイスと監査ログに対応
- host 限定 API は loopback または検証済みセッションのみ通す

**UI**

- light / dark / システム追従のテーマ、モバイル対応、PWA、コマンドパレット、音声入力

## 設定（環境変数）

| 変数 | 既定値 | 内容 |
| --- | --- | --- |
| `OPENCODE_WEBUI_PORT` | `3000` | WebUI のポート |
| `OPENCODE_WEBUI_HOST` | `127.0.0.1` | WebUI の待ち受けアドレス |
| `OPENCODE_PORT` | `4096` | `opencode serve` のポート |
| `OPENCODE_WEBUI_MODE` | 自動判定 | `prod` / `dev` の起動モード |
| `OPENCODE_WEBUI_HEADLESS` | 未設定 | `1` でトレイを使わずコンソールのみで起動 |
| `OPENCODE_WEBUI_NO_BROWSER` | 未設定 | `1` で起動時のブラウザ自動起動を抑止 |
| `OPENCODE_WEBUI_NONINTERACTIVE` | 未設定 | `1` でセットアップ失敗時の待機を省略 |
| `OPENCODE_WEBUI_AUTO_UPDATE_OPENCODE` | `1` | 起動時に `opencode upgrade` を実行して CLI を自動アップデート。`0` で無効化（失敗時は既存バイナリで起動継続） |
| `OPENCODE_WEBUI_CADDY` | 未設定 | `1` で Caddy 逆プロキシを連動起動。`0` で自動導入も行わない |
| `OPENCODE_WEBUI_CADDYFILE` | `deploy/Caddyfile` | Caddyfile のパス |
| `OPENCODE_WEBUI_BUILD_DIR` | `%LOCALAPPDATA%\opencode-webui\build\...` | production build のミラー先 |
| `OPENCODE_WEBUI_QWEN_NATIVE` | 未設定 | `1` で画像事前解析を有効化（設定画面からも切り替え可能） |
| `OPENCODE_WEBUI_QWEN_MODEL` | 未設定 | 事前解析に使うモデルを `providerID::modelID` で指定 |
| `OPENCODE_WEBUI_WORKFLOW_MODE` | `true` | ワークフロー機能全体。`false` で旧 UI へ戻す |
| `OPENCODE_WEBUI_WORKFLOW_GRAPH` | `true` | グラフ表示。親フラグが無効なら強制無効 |
| `OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT` | ランチャー経由は `true`、host 直起動は `false` | ノード / エッジの編集。グラフ表示が無効なら強制無効 |

ワークフローのグラフ Draft は Run 開始時に実行スナップショットへ複製されるため、実行中の Run は Draft の変更を受けません。

### 画像事前解析

事前解析に使うモデルは OpenCode に登録済みのものへ一本化しています。設定画面の「画像解析」タブで、接続済みプロバイダーが持つ画像入力対応モデルだけを選択できます。認証情報は OpenCode 側の登録をそのまま使い、WebUI の設定ファイルへ API キーを複製しません。解析時はツールを無効化した一時セッションを作成し、応答を取得後に削除します。選択モデルが画像に対応している場合は事前解析を行わず、画像を直接送信します。

ローカルの Ollama も同じ経路で利用します。「画像解析」タブの「Ollama をセットアップ」を実行すると、Ollama の導入（winget）、モデルの取得（既定 `qwen2.5vl:7b`）、`opencode.jsonc` へのプロバイダー登録までを行います。起動時の自動インストールや自動 pull は行いません。登録したモデルは OpenCode の再起動後に利用できます。

## LAN / VPN からのアクセス

既定では WebUI も OpenCode も loopback のみで待ち受けます。外部からアクセスする場合は Caddy 逆プロキシの利用を推奨します。

```bat
set OPENCODE_WEBUI_CADDY=1
OpenCodeWebUI.exe
```

- Caddy は初回起動時に winget（`CaddyServer.Caddy`）で導入されます。手動導入は不要です。
- 初回起動時に [`deploy/Caddyfile.example`](./deploy/Caddyfile.example) から `deploy/Caddyfile` を生成します。ドメインと Basic 認証を編集してください。
- host が Caddy の起動・停止・再起動を WebUI と連動管理し、トレイの Status に `Caddy: running` を表示します。
- winget が使えない等で導入に失敗した場合も、WebUI 自体は `http://127.0.0.1:3000` で起動します（Caddy 連携のみ無効）。

`OPENCODE_WEBUI_HOST=0.0.0.0` で直接すべてのインターフェースへバインドすることもできますが、認証と VPN のない状態で公開しないでください。

### HTTPS（既定 `:8443`）

`deploy/Caddyfile` は既定で `:8443` を `tls internal`（Caddy のローカル CA による自己署名）で配信します。起動時に UAC が出ないよう `skip_install_trust` を指定しているため、CA の信頼登録は手動で 1 回だけ行います。

```bat
scripts\caddy-trust.bat
scripts\allow-firewall-8443.bat
```

アクセス先は `https://localhost:8443` または `https://<LAN もしくは VPN の IP>:8443` です。証明書は `deploy/Caddyfile` の site 行に列挙した名前にだけ発行されるため、使用する IP やホスト名を追記してください。LAN IP が変動する環境では DHCP 予約を推奨します。公開ドメインがある場合は Caddyfile 内の Let's Encrypt ブロック（コメント）を使うと、CA の導入なしで正規の TLS になります（80/443 の到達性と DNS が必要）。

ホスト PC 上の Caddy 経由アクセスで `this endpoint is only available from the host machine` が出る場合は、既存の `deploy/Caddyfile` の host 限定 API の `handle` に、`deploy/Caddyfile.example` と同じ `/api/host/logs*` と `/api/updates/*` を追加して Caddy を再起動してください。

### 他の端末でルート CA を信頼させる

`tls internal` は Caddy のローカル CA で署名するため、その CA を知らない端末では証明書警告になります。Caddyfile の `:8080` ブロックがルート CA の公開鍵証明書を配布します（秘密鍵は配信されません）。

```bat
scripts\allow-firewall-8080.bat
```

端末のブラウザで `http://<LAN もしくは VPN の IP>:8080/caddy-root.crt` を開いて取得し、以下の手順で導入します。

| 端末 | 手順 |
| --- | --- |
| Android | 設定 → セキュリティ → 暗号化と認証情報 → 証明書をインストール → CA 証明書 を選び `caddy-root.crt` を指定 |
| iOS / iPadOS | Safari で開いてプロファイルを許可 → 設定 → 一般 → VPN とデバイス管理 からインストール → 設定 → 一般 → 情報 → 証明書信頼設定で当該 CA を有効化 |
| Windows | 管理者で `certutil -addstore -f Root caddy-root.crt` を実行 |
| macOS | キーチェーンアクセスの「システム」に追加し、当該 CA を「常に信頼」に変更 |

警告を無視して閲覧するだけなら CA の導入は不要ですが、PWA・Service Worker・クリップボード・通知は信頼済み証明書でないと動作しません。ルート CA は 10 年有効で、Caddy の再インストールや `%APPDATA%\Caddy\pki` の削除で再生成された場合は端末側の再導入が必要です。配布 URL が 404 になる場合は Caddy が `APPDATA` を引き継いでいないため、`deploy/Caddyfile` の `root *` をルート CA の絶対パスへ変更してください。

なお、リモートワークスペースの接続 API（`/api/remote`）は未実装のプレースホルダーです。現時点では VPN 経由でローカルパスを開く運用になります。

## トラブルシューティング

`scripts/start-webui.bat` は失敗時に `[OpenCode WebUI] ERROR <code>: <english summary>` を出力し、続けて `scripts/setup-messages/` の日本語案内を表示します。

| コード | 意味 | 対処 |
| ---: | --- | --- |
| 1 | winget が見つからない | 「アプリ インストーラー」を導入する |
| 2 | Node.js の導入に失敗 | [nodejs.org](https://nodejs.org/) から手動導入する |
| 3 | Node.js が PATH に反映されていない | 再ログインまたは再起動後に再実行する |
| 4 | OpenCode の導入失敗、または PATH 未反映 | [OpenCode Docs](https://opencode.ai/docs) を確認し、必要なら再ログイン後に再実行する |
| 5 | web の依存関係の導入に失敗 | ネットワークと `web/package-lock.json` を確認する |
| 6 | web のビルドに失敗 | 表示されたビルドエラーと Node.js のバージョンを確認する |
| 7 | ビルド後に `BUILD_ID` が無い | ビルドログを確認して再実行する |
| 8 | host の依存関係の導入に失敗 | ネットワークと `host/package-lock.json` を確認する |
| 9 | Browser Bridge の依存関係の導入に失敗 | `browser-bridge` で `npm ci` を実行してエラーを確認する |
| 10 | ビルド出力ディレクトリを解決できない | Node.js の利用可否と `OPENCODE_WEBUI_DIST_DIR` の値を確認する |

UI が開かない場合は headless モードでログを直接確認できます。

```bat
cd host
set OPENCODE_WEBUI_HEADLESS=1
set OPENCODE_WEBUI_NO_BROWSER=1
set OPENCODE_WEBUI_MODE=prod
node src\index.js
```

`OpenCode is ready` と `WebUI is ready` が出力されれば起動は完了しています。

## 開発

| パス | 役割 |
| --- | --- |
| `web/` | Next.js の UI と BFF |
| `host/` | トレイ常駐プロセス（OpenCode / Next.js / Caddy の管理） |
| `browser-bridge/` | Browser Bridge の MCP サーバー、Broker、ブラウザ拡張 |
| `addons/` | WebUI 専用のアドオン（`addons/README.md` を参照） |
| `scripts/` | セットアップ、ランチャー、Caddy 連携、同期スクリプト |
| `deploy/` | Caddyfile とテンプレート |
| `docs/` | 仕様書と OpenAPI スナップショット |

開発サーバーとテスト:

```bat
cd web
npm install
npm run dev
npm run typecheck
npm run lint
npm test
```

別のターミナルで `opencode serve --hostname 127.0.0.1 --port 4096` を起動します。E2E は `npm run e2e`（web ディレクトリ）で実行します。API スモークテストは WebUI 起動後にリポジトリ直下で `node scripts/smoke-api.mjs`、Browser Bridge のスモークは host が起動済みの状態で `npm run smoke:browser-bridge` を実行します（このコマンドは host と Broker を起動しません）。各検証コマンドの前提条件は [`docs/verification.md`](./docs/verification.md) に集約しています。

### production build のミラー

production build はリポジトリ内では実行されません。`scripts/web-build-mirror.mjs` がインストール全体をハードリンクでミラーし（既定 `%LOCALAPPDATA%\opencode-webui\build\<インストール名>-<ハッシュ>`）、`next build` と `next start` はそのミラー内で動作します。

理由は 2 つあります。OneDrive の同期がビルド中・配信中の出力に触れると HTML とチャンクの世代が混在して `ChunkLoadError` になること、そして Turbopack がプロジェクト外を指す `distDir` を拒否するため、出力だけでなくプロジェクトごと同期対象の外へ置く必要があることです。

ハードリンクのため追加のディスク消費はほぼなく、同期は差分のみです。ジャンクションやシンボリックリンクは使えません（バンドラがリンクを実パスへ正規化し、モジュール解決が同期ツリーへ戻ります）。ミラーはインストールパスのハッシュで分離されるため、複数のチェックアウトが同じミラーを共有しません。ハードリンクを作成できないボリュームでは自動的にバイトコピーへ退避します。ミラーは複製なので、サーバーは `OPENCODE_WEBUI_INSTALL_ROOT` で実インストール先を受け取ります（自己更新と git restore は実リポジトリに対して動作します）。手動でビルドする場合はリポジトリ直下で `node scripts/build-web.mjs` を実行します。

配信中の出力を壊さないためのガードがあります。`build.bat` は本番 WebUI が同じポートで稼働中、またはリスナーの正体が不明な場合はビルドを中止します。`scripts/start-webui.bat` は稼働中の WebUI があれば初回ビルドを飛ばして host へ進み、健全な WebUI をそのまま再利用するか、古い `next start` を引き継いでからミラーへリビルドします（正体不明のプロセスは終了させません）。

### バッチファイルのエンコード規則

`.bat` / `.cmd` は ASCII のみで記述し、日本語メッセージは `scripts/setup-messages/*.txt`（UTF-8・BOM なし・CRLF）へ分離して `type` で出力します。cmd.exe は非 ASCII バイトを含む行の直後で読み取り位置を誤り、行の途中から実行するためです。`scripts/start-webui.bat` は英語の要約行を先に出力してから日本語の詳細を表示するため、日本語が読めない環境でもエラーコードで判別できます。メッセージファイルが欠落しても処理は完走します。README 内の `bat` コード例も ASCII のみとしてください。確認は `npm run test:encoding` です。詳細は [`docs/specs/bat-encoding-safety.md`](./docs/specs/bat-encoding-safety.md) を参照してください。

### ログとデバッグファイルの扱い

ログ出力は **host の `log-buffer` / `log-file` に集約**されています（`host/src/log-buffer.js`
はリングバッファ、`host/src/log-file.js` はディスク書き込み。設定「全般」タブのログビューアが
両方を参照します）。ホストが管理する子プロセスの出力は `recordLog` を経由してこの集約へ
入ります。

- 新規ログ出力を追加するときは、`console.log` の直書きではなく `log` / `error`（host）や
  `recordLog` 経由にしてください
- リポジトリ直下の `*.log`（`bb.log` / `build.log` / `typecheck.log` 等）は `.gitignore`
  対象でローカル専用です。コミットしないでください
- 一時的なデバッグログはタスク完了時に削除します

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [`docs/specs/`](./docs/specs/) | 機能ごとの仕様書 |
| [`docs/ui-components.md`](./docs/ui-components.md) | UI 部品の props 規約（`ui.tsx` 正本） |
| [`docs/verification.md`](./docs/verification.md) | 検証スクリプトの実行前提条件 |
| [`docs/opencode/`](./docs/opencode/) | OpenCode API の OpenAPI スナップショット |
| [`docs/browser-bridge-setup.md`](./docs/browser-bridge-setup.md) | Browser Bridge MCP のセットアップ手順 |
| [`BUG.md`](./BUG.md) | バグ発見のインベントリ（修正は本ファイル参照で別途実施） |
| [`IMPROVEMENT.md`](./IMPROVEMENT.md) | リファクタリング / 改善余地のインベントリ（優先度別） |
| [`REFACTORING_PLAN.md`](./REFACTORING_PLAN.md) | IMPROVEMENT.md の実行計画（Phase 0–7・依存順） |
| [OpenCode Docs](https://opencode.ai/docs) | OpenCode 本体のドキュメント |

## ライセンス

[MIT](./LICENSE)
