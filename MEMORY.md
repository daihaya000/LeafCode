# MEMORY

## 新規作成時の Claude CLI Proxy セットアップで provider.anthropic 定義が欠落していた (2026-08-05)

### 症状
- 新規プロファイル作成時に「Claude CLI Proxy」チェックは入っていたが、作成後の `opencode.jsonc` に `provider.anthropic` 定義が含まれていなかった
- そのため OpenCode のモデル一覧に Claude モデルが表示されず、「Claude との接続がうまくいかない」状態になっていた
- `test` プロファイル（`default` からの複製）にも `provider.anthropic` が欠落していた

### 根本原因
- `web/src/lib/profiles/webui-dependencies.ts` の `installWebUiDependencies()` は、Cursor については active profile / vendor bundle から `provider.cursor` 定義をコピーする仕組みがあった
- しかし Claude CLI Proxy については **plugin ファイル (`plugin/claude-cli-proxy.js` + `packages/claude-cli-proxy`) のコピーだけ**行い、`provider.anthropic` 定義の追加を行っていなかった
- Claude CLI Proxy プラグインは `auth.loader` で既存の anthropic プロバイダーの認証を乗っ取るだけで、provider 定義自体を作らないため、新規作成時に provider.anthropic が無いと OpenCode は Claude モデルを認識しない

### 修正
1. **`vendor/claude-cli-proxy/opencode.jsonc` を新規作成**
   - 標準的な `provider.anthropic` 定義を含める（`name`, `npm`, `whitelist`, `models`）
   - モデルは claude-opus-5 / claude-sonnet-5 / claude-haiku-4-5 の 3 種を定義（cost は不要：Claude CLI Proxy の auth loader が `cost: {input:0, output:0, cache:{read:0, write:0}}` で上書きする）
2. **`web/src/lib/profiles/webui-dependencies.ts` を修正**
   - `bundledClaudeAuth` ディレクトリから `provider.anthropic` 定義を読み込む
   - `options.claudeAuth !== false` かつ anthropic 定義が存在し、かつターゲットに `provider.anthropic` が未定義の場合、`provider.anthropic` を追加
   - 既存の Cursor コピー処理と対称的な実装にした
3. **`web/src/lib/profiles/webui-dependencies.test.ts` に回帰テストを 2 件追加**
   - 「Claude CLI Proxy 有効時に bundled Anthropic provider 定義が追加されること」
   - 「既存の `provider.anthropic` がある場合は上書きしないこと」

### 検証
- `npx tsc --noEmit` 合格
- `npx eslint`（該当ファイル）合格
- `npx vitest run src/lib/profiles/webui-dependencies.test.ts src/components/settings/ProfilesSettings.test.tsx src/app/api/profiles/settings/route.test.ts` 31件全合格
- 全 `vitest run` は時間がかかるため対象ファイルに絞って検証

### 教訓
- CLI Proxy プラグインをコピーするだけでは不十分。OpenCode がモデルを認識するには `provider.*` 定義が必要であり、新規作成時に自動追加する必要がある
- 同様に CommandCode CLI Proxy についても、commandcode provider 定義が bundle に含まれているか確認すべき。今回は `default` プロファイルに commandcode 定義が存在したため影響を受けにくいが、新規 empty 作成時に同様の漏れがないか別途確認が必要

## 設定画面「接続」タブ: Wi-Fiリンク非表示化 + ファイアウォールポート許可ボタン (2026-08-05)

## スマホ ERR_CONNECTION_FAILED = CaddyfileのIPハードコード × NIC二重接続 (2026-08-05)

### 症状
- h3無効化(前項)の後、スマホから `https://192.168.0.102:8443` が `ERR_CONNECTION_FAILED`
- ホストPCからは `curl -k https://192.168.0.102:8443/` が200を返す（＝サーバは生きている）

### 判明したネットワーク変化
`ipconfig` / `Get-NetConnectionProfile` / `Get-NetRoute` を比較して発覚:

| | 以前 | 現在 |
|---|---|---|
| IPv4 | `192.168.0.102` のみ | `192.168.0.102`(有線) と `192.168.0.193`(Wi-Fi 2) の**2つ** |
| イーサネット2 | `TP-Link_C622` / Private | **「識別中...」/ Public** |
| Wi-Fi 2 | — | `TP-Link_C622` / Private |
| 既定ルートmetric | — | Wi-Fi=**0**(優先) / 有線=256 |

- 同一サブネット `192.168.0.0/24` に有線とWi-Fiで**二重接続(dual-homed)**していた
- `curl https://192.168.0.193:8443/` は **exit 35 (SSL connect error)** — Caddyfileに `.193` が未登録

### 根本原因
`tls internal` は**サイトブロックに列挙された名前にしか証明書を発行しない**。さらに、どのサイトブロックにもマッチしないHostは**TLS完了前に接続を拒否**される。
Caddyfileは `https://192.168.0.102:8443` をハードコードしていたため、応答経路がWi-Fi(.193)側に寄る構成になった時点で、スマホから到達可能なアドレスでCaddyが応答できず `ERR_CONNECTION_FAILED` になった。
ホストPCはloopback(`localhost`/`127.0.0.1`)が列挙済みなので動き続ける → **切り分けが極めて困難**。

### 修正
1. 即時対応: `deploy/Caddyfile` のサイトブロックに `https://192.168.0.193:8443` を追加し `caddy reload`。両IPで200を確認
2. 恒久対応: **`host/src/caddy-sites.js` を新規作成**し、ホスト起動時にCaddyfileのIPv4エントリを現在のNICアドレスへ自動追従
   - `syncCaddySiteAddresses(text, addresses)` は純粋関数。`ensureCaddyfile()` から呼ぶ
   - **loopback は常に保持**（ホストPCのブラウザを壊さない）
   - **ユーザーが手書きしたホスト名/ドメインは保持**。IPv4リテラルのみ入れ替える
   - **検出0件なら書き換えない**（NIC取得失敗でリストを空にして全断させない）
   - 既存のカスタムポートを踏襲。httpsサイトブロックが無いCaddyfileは無変更。失敗しても起動をブロックしない
3. `deploy/Caddyfile.example` のコメント更新（未登録の名前は「証明書が無い」ではなく「接続自体が拒否される」と明記）
4. `host/src/caddy-sites.test.js` に10件のテスト追加

### 判断理由
- DHCP再割当・Wi-Fi/有線切替・NIC追加は日常的に起きる。そのたびに手でCaddyfileを編集させる設計は破綻している
- Caddyfileはユーザーが編集する前提のファイル(gitignored)なので、**全体を再生成せずIPv4トークンだけを最小限書き換える**方針にした

### 教訓
- **`tls internal` + 明示的サイトアドレス構成では、未登録のHostは「証明書エラー」ではなく「接続失敗」になる。** 証明書の問題だと思って調査すると迷子になる
- **「ホストからcurlは通るがスマホから繋がらない」時は、ホストPCの*全*IPv4を列挙してそれぞれcurlする。** loopbackと.102だけ見ていると、実際にスマホが到達している.193が死んでいることに気付けない
- 同一サブネットへのdual-homed接続（有線+Wi-Fi同時）は応答経路が非対称になりやすくinbound接続を壊す典型構成。`Get-NetRoute`のmetricで優先NICを確認する
- `Get-NetConnectionProfile`が「識別中...」/Publicを示すNICは、リンクがUpでも正常にLAN参加できていない可能性がある

## 設定画面「接続」タブ: Wi-Fiリンク非表示化 + ファイアウォールポート許可ボタン (2026-08-05)

### 背景
- LAN(`http://192.168.0.102:3000/`)からアクセスできないという報告を受け、まず`netstat`で調査。WebUIが`127.0.0.1:3000`(ループバックのみ)でLISTENしていたのが原因（`OPENCODE_WEBUI_HOST`未設定時のデフォルト、`host/src/index.js:120`）。ユーザー許可を得て`setx OPENCODE_WEBUI_HOST 0.0.0.0`を設定（トレイ再起動が必要、ユーザー側で実施）。Firewallルール(`OpenCode WebUI`, TCP 3000, 全プロファイル許可)は既に存在していたため変更不要だった。
- 続けてユーザーから「設定 > 接続タブのWi-Fiリンクを削除してlocalhostリンクを追加」「ポート許可をUIボタンから実行できるようにしてほしい」という2つの要望。

### やったこと
1. **Wi-Fiリンク非表示 + localhostリンク追加**（`SettingsView.tsx`）
   - `access.addresses`をそのまま表示するのではなく、`displayAddresses`という導出配列を追加: `kind !== "lan"`でフィルタ（Wi-Fi/Ethernet等の直接IPリンクを除外）、先頭に`access.localUrl`(`http://127.0.0.1:PORT`)のエントリー(`kind: "local"`)を常時追加。
   - `AccessInfo`型の`addresses[].kind`に`"local"`を追加、`kindLabel()`に`"Local"`ラベルを追加。
   - `/api/access/route.ts`自体（NIC列挙ロジック）は変更していない。既存の`route.test.ts`がWi-Fi/Tailscale両方が`addresses`に含まれることを検証しているため、API側で除外するとテストと矛盾する。UI表示側だけのフィルタなので、CaddyやVPN等の他用途には影響しない。

2. **ファイアウォールポート許可ボタン**（`host` + `web` 両方）
   - `host/src/control-server.js`: `matchControlRoute`に`POST /allow-firewall`を追加。`onAllowFirewall`ハンドラ呼び出し、成功時`{ok:true, target:'allow-firewall', ...result}`、未サポート時501、失敗時500(UACキャンセル等)。
   - `host/src/index.js`: `firewallRuleExists()`(読み取り専用、`netsh advfirewall firewall show rule name=...`、昇格不要)で既存確認→ルールが無ければ`allowFirewallPort()`がPowerShellの`Start-Process -Verb RunAs -Wait -PassThru`でUAC昇格した`netsh add rule`を実行し、ExitCodeで成否判定。ルール名`"OpenCode WebUI"`は`scripts/allow-firewall-3000.bat`と共通。`startControlServer()`で`onAllowFirewall: () => allowFirewallPort()`を登録。
   - `web/src/lib/host-control.ts`: `hostAllowFirewallPath() => "/allow-firewall"`を追加(`hostVoiceInputPath`と同型パターン)。
   - `web/src/app/api/host/allow-firewall/route.ts`(新規): `voice-input/route.ts`と同じ構造。`rejectUnlessLocal`でホストPC自身からのアクセスのみ許可（LAN上の第三者がUACダイアログをスパムできないようにするため、`restart`系で使う`rejectUnlessLocalOrPrivateNetwork`より厳しい制限を採用）。UAC応答待ちを考慮し`AbortSignal.timeout(65000)`。
   - `SettingsView.tsx`: 「ポートを許可」ボタンを接続タブのファイアウォール案内テキストの直前に配置。`sendJson(..., { timeoutMs: 70_000 })`でUAC待ちに対応。busy/success(`既に許可済み`/`許可しました`)/error(元のエラーメッセージそのまま表示、例: UACキャンセル)の3状態を管理。

### 設計判断
- ファイアウォール変更は管理者権限が必要な破壊力のある操作なので、`voice-input`と同じ「ホストPC自身からのみ」の制限（`rejectUnlessLocal`）を使い、LAN経由のリクエストは拒否。LAN上の誰かがボタンを押せてしまうと、ホストPCの前にいる人に不意打ちでUACダイアログを見せる社会工学的なリスクがあるため。
- `firewallRuleExists()`による事前チェックで、既に許可済みなら毎回UACダイアログを出さずに即座に成功を返す（べき等性）。
- Wi-Fi非表示は`route.ts`ではなく`SettingsView.tsx`側のみで実施し、既存の`route.test.ts`（Wi-Fi/Tailscaleが両方addressesに含まれることを検証）を変更せずに済ませた。UIの表示ポリシーとAPIの汎用データ収集を分離する方が影響範囲を狭められる。

### 検証
- `host`: `node --test src/*.test.js` 全204件pass（control-server.test.jsに/allow-firewallの3ケース追加）
- `web`: `tsc --noEmit`・`eslint`(該当ファイル)・`vitest run` 全2667件pass（SettingsView.test.tsxに4件、host-control.test.tsに1件、allow-firewall/route.test.tsを新規4件追加）

## 【真の原因】スマホ白画面 = Caddy HTTP/3 (QUIC) とファイアウォールTCP専用の不整合 (2026-08-05)

### 症状
- スマホ（VPN経由）から `https://192.168.0.102:8443` が白画面 / タイムアウト。1〜2日前までは動いていた
- ホストPCからは `curl -k` で200、全 `_next/static/chunks/*` も200。WebUI/OpenCode/Caddy すべて健全
- ホスト再起動しても、OpenCodeが本来のポート(4096)に戻っても症状変わらず

### 切り分け手順（重要）
- Playwright chromium をiPhone UA + モバイルviewportで LAN HTTPS URL に接続 → **正常にレンダリング**（pageerror/consoleError/失敗リクエスト すべてゼロ）。これでアプリ・JS・チャンク配信の問題を除外できた
  - 注: `waitUntil:"networkidle"` はSSEが張られ続けるため必ずタイムアウトする。これはエラーではない
- 除外できた後にプロトコル層を確認 → `curl -k -s -D -` のレスポンスヘッダに `Alt-Svc: h3=":8443"; ma=2592000` を発見。`netstat` に **UDP 0.0.0.0:8443** の listener があった
- ファイアウォールを確認 → `OpenCode WebUI Caddy HTTPS` は **Protocol TCP / LocalPort 8443 のみ**。UDP 8443 は未開放

### 根本原因
1. Caddy は既定で HTTP/3 を有効化し、TCP応答に `Alt-Svc: h3=":8443"; ma=2592000` を付ける
2. ブラウザはこれを **30日間キャッシュ**し、次回以降 QUIC (UDP 8443) で接続しようとする
3. Windowsファイアウォールは TCP 8443 しか開けていない。さらにVPN経由ではUDPが落ちる/MTU断片化しやすい
4. → QUICブラックホール。スマホは白画面/タイムアウト。一方 curl や loopback のデスクトップブラウザは h3 に切り替わらないので**ホスト側では絶対に再現しない**
5. 「1〜2日前から急に」なったのは、Alt-Svc がキャッシュされた時点以降ずっとQUICを試すようになるため（ma=30日）

### 修正
- `deploy/Caddyfile` および `deploy/Caddyfile.example` のグローバルブロックに `servers { protocols h1 h2 }` を追加 → h3を無効化。UDPリスナが消え、Alt-Svc広告も止まる
- 同ファイルの `header` ブロックに **`Alt-Svc clear`** を追加 → h3を止めるだけでは**スマホが既に保存した30日分のエントリは消えない**ため、RFC 7838 §3.1 の `clear` で能動的に破棄させる。これが無いと期限切れまで直らない
- `scripts/allow-firewall-8443.bat` に「TCPのみで正しい」理由をコメント（UDPを開ける方向の"修正"を将来やらせないため）
- `host/src/caddyfile.test.js` に回帰テスト追加（`protocols h1 h2` であること / `h3` を含まないこと）
- 稼働中Caddyへは `caddy reload --config deploy/Caddyfile` で適用（admin API 経由。WebUI/OpenCodeは再起動不要）
- 適用後の確認: `netstat` から UDP 8443 が消滅、レスポンスヘッダが `Alt-Svc: clear` に変化

### 判断理由
- UDP 8443 を開ける選択肢もあるが、VPN越しのQUICは環境依存で不安定（UDPフィルタ・MTU）。**到達可能な経路をファイアウォールが開けている物と完全に一致させる**方が決定論的で保守しやすい
- LAN/VPN内のローカルツールにh3の性能利点はほぼ無く、失敗モードのコストの方が大きい

### 教訓
- **「ホストからは動くがスマホからは動かない」場合、アプリ層を疑う前にプロトコル層（Alt-Svc / HTTP/3 / UDP）とファイアウォールのプロトコル種別を確認する。** curl と loopback ブラウザは h3 にアップグレードしないため、この種のバグはホスト側で原理的に再現しない
- ファイアウォールで「ポート8443を許可済み」でも、**TCPとUDPは別**。QUICを使うサーバでTCPだけ開けると、初回は成功し2回目以降だけ壊れるという再現性の低い症状になる
- `Alt-Svc` は広告を止めるだけでは不十分。クライアントのキャッシュを消すには明示的に `Alt-Svc: clear` を返す必要がある
- ブラウザ再現調査では Playwright のモバイルUA + `ignoreHTTPSErrors` が有効。ただし chromium は h3 のフォールバックが早いため、QUIC起因の問題は**再現しない**（＝再現しないこと自体が切り分けの情報になる）

## スマホからCaddy HTTPSアクセス時の白画面バグ修正: Service Workerの古いHTMLキャッシュ (2026-08-05)

> 注: これは上記の真因とは別の**潜在バグ**の修正。今回の症状の原因ではなかったが、
> デプロイ後に古い `/` キャッシュが死んだチャンクを参照して白画面になる経路は実在するため残置。

### 症状と原因
- スマホから `https://192.168.0.102:8443` にアクセスすると白画面になる（接続タイムアウトではなく、HTMLは200で返る）
- サーバー側（Caddy/WebUI/ファイアウォール）は完全に健全。`curl -k https://192.168.0.102:8443/` で正常なHTMLと全 `_next/static/chunks/*` が200で返ることを確認済み
- 原因: Service Worker (`web/public/sw.js`) の navigate フェッチが network-first だが、VPN遅延などで `fetch(req)` が失敗した際、`caches.match(req)` で **前回ビルドのキャッシュHTML** をフォールバック返信していた。この古いHTMLは新しいビルドには存在しない `_next/static/chunks/<old-hash>.js` を参照し、それらは404になりReactがhydrateできず白画面になる
- `/_next/` はSWのキャッシュ対象外（fetch bypass）に設定されていたため、チャンク自体はキャッシュされないが、ナビゲーションHTML（`/`）がキャッシュされる点が抜け穴だった

### 修正
- `web/public/sw.js`: キャッシュバージョン v4 → v5 に bump。`message` イベントリスナを追加し、`{type:"BUILD_ID", id}` を受信すると、現在の `activeBuildId` と異なる場合に `wipeBuildCache()` でナビゲーションキャッシュを破棄する仕組みを追加
- `web/src/components/ServiceWorkerRegister.tsx`: `NEXT_PUBLIC_BUILD_COMMIT` を読み込み、SW登録後 + `controllerchange` イベント時に `postMessage({type:"BUILD_ID", id: BUILD_COMMIT})` でSWへ通知。これで新しいビルイ（チャンクハッシュ変更）にアクセスした瞬間に古い `/` キャッシュが破棄され、白画面を防ぐ
- `web/public/sw.test.js`: v5 のキャッシュバージョン、BUILD_ID メッセージハンドラ、`/_next/` bypass の3テストを追加

### 判断理由
- Next.jsのproduction buildはチャンクファイル名にcontent hashを含むため、ビルドが変わると古いHTMLが参照するJSがすべて404になる。SWが古いHTMLをキャッシュから返すと、ネットワークから新しいチャンクが取れなくてもHTMLの参照先が古いままで白画面になる
- ビルドID（git commit SHA）は `next.config.ts` で既に `NEXT_PUBLIC_BUILD_COMMIT` としてenvに埋め込まれており、`Sidebar.tsx` で表示にも使われている。これを流用して「デプロイ境界」を検知するのが最も低コストで確実
- SW の `/_next/` bypass は維持：チャンクはキャッシュしないが、ナビゲーションHTMLキャッシュのクリアが今回の本質的修正

### 教訓
- Service Worker でナビゲーションを network-first + cached-fallback にする場合、**ビルドID/デプロイ境界を検知してキャッシュを無効化しないと、新しいデプロイ後に古いHTMLがフォールバックで返り白画面になる**。これは遅いネットワーク（VPN含む）でのみ再現するため発見が困難
- PWA + Next.js の組み合わせでは、ビルドごとにチャンクハッシュが変わるため、HTMLキャッシュのライフサイクルをビルド境界と同期させることが必須。`postMessage` でクライアントからSWへビルドIDを通知する方式が、ファイル名変更なしに実装できる

### 検証
- `npx tsc --noEmit` 合格
- `npx eslint` 合格（ServiceWorkerRegister.tsx / sw.test.js）
- `node --test public/sw.test.js` 7件全合格

## 設定画面: プロファイルタブのヘッダー簡素化と表示順入れ替え (2026-08-05)

### やったこと
- `ProfilesSettings.tsx` のヘッダーから「登録数」「現在の環境」の2枚の数値カード（グリッド部分）を削除。ユーザーが画像で「邪魔」と指摘した部分。未使用になった `activeProfile` 変数も削除。
- 続けてユーザーから「WORKSPACE IDENTITY / プロファイル / 説明文」の`<header>`カード自体も不要と指摘があり、`<header>...</header>` ブロックを丸ごと削除（`<section aria-label="プロファイル">`は維持）。
- `SettingsView.tsx` の `activeTab === "profiles"` 分岐で、`ProfileSyncSettings` と `ProfilesSettings` の描画順を入れ替え、プロファイル同期セクションをプロファイル一覧より下（最下段）に移動。
- `tsc --noEmit`・`eslint`（該当2ファイル）・`vitest`（`ProfilesSettings.test.tsx` + `SettingsView.test.tsx` 計36件）で回帰なしを確認。

### 判断理由
- 数値カードはヘッダーの説明文と情報が重複気味（プロファイル数・アクティブ名は下の一覧テーブルでも視認可能）で、ユーザー指摘通り視覚的ノイズだった。テストに依存箇所がなかったため単純削除で対応。
- ヘッダーカード自体もテスト側で参照されておらず（`ProfilesSettings.test.tsx`は「Workspace identity」等の文言に依存していない）、削除しても回帰なし。下の「登録済みプロファイル」見出し（`<h3>`）が実質的なセクションタイトルとして機能するため情報欠落なし。
- 表示順の入れ替えのみでコンポーネント自体の実装（`ProfileSyncSettings.tsx`）には手を加えていない。

## CodexBarアドオン: プロバイダー一覧の2列表示モード追加 (2026-08-05)

### やったこと
- `addons/codexbar/CodexBarWidget.tsx` にプロバイダー一覧の「2列表示」トグルを追加。ヘッダーの設定ボタンの隣に `LayoutGrid`/`LayoutList` アイコンボタンを配置し、`localStorage`(`webui:addon:codexbar:layout`)に永続化。デフォルトは従来通り1列（`space-y-2.5`）。
- 2列モード時は `<ul>` を `grid grid-cols-2 items-start gap-2` に切り替え。`items-start` を付けないと CSS Grid の行が最大高さの行に揃ってしまい、片方のカードだけ展開した時にもう片方が間延びするため必須。
- `ProviderRow` に `compact` props を追加し、2列モード中はプランバッジ（`Team・$25`等）を非表示にして名前とパーセンテージの可読性を確保。窓（windows）やクレジット等の展開内容自体は変更せず、幅が狭くなった分は既存の `truncate`/小さいフォントサイズで吸収。
- `li` に `min-w-0` を追加（grid item内で `truncate` が効くために必要）。
- 新規テスト2件追加（`CodexBarWidget.test.tsx`）: デフォルトで1列であること、トグルで2列grid化されること、`localStorage`経由で再マウント後も設定が保持されること。
- `tsc --noEmit`・`eslint`・`vitest`（addons/codexbar 全体および `web` 全2659テスト）で回帰なしを確認。

### 判断理由
- 高さを抑えたいという要望に対し、既存のトグル済み折りたたみ機構（プロバイダー毎の collapsed state）はそのまま活かし、レイアウトのみを1列/2列で切替える設計にした。既存の `collapsed`/`providerCollapsed` の状態管理と独立させることで、既存のテスト・挙動を壊さずに追加できた。
- プランバッジを2列時だけ隠したのは、カード幅が半分になることで「名前 + バッジ + パーセント + シェブロン」が窮屈になり、名前が過度に省略されるのを防ぐため。金額情報はカードを展開すれば見える。

## 機能別バグハント第6回 — デスクトップ通知の許可待ちレース・addonsのlocalStorage競合 (2026-08-04)

### やったこと
- `notify.ts`/`TaskView.tsx`(デスクトップ通知)、`addons/state.ts`、`git.ts`、`workflow-artifacts.ts`を調査、4件のバグを発見・修正（コミット`36d0389`）
- **[重大・実害あり]** `TaskView.tsx`の通知effect: `Notification.requestPermission()`は非同期に解決するが、effectは許可状態に関わらず毎回`prevAttentionRef`/`prevWorkingRef`を進めていたため、許可が"default"の間に発生した状態遷移（rising/falling edge）が、ユーザーがブラウザの許可ダイアログに答える前に消費されてしまい、許可後も通知が発火しなかった
  - 最初は「許可が"default"の間はref更新を止める」で直そうとしたが、これは別の問題を生んだ: `prevWorking`を進めないと、後で作業が完了した時の"done"エッジ（`prevWorking&&!working`）も検出できなくなる
  - 最終的な修正: refは常に正しく進める（履歴は常に正確に保つ）。エッジ検出自体は`permission:"granted"`を仮に渡して許可ゲートをバイパスし、検出したkindを`pendingKindRef`に保存。実際の許可が`"granted"`になった時点で`pendingKindRef`の内容を発火する、という「検出とゲートの分離」パターンに変更
  - さらに`requestPermission()`解決時に`permissionTick`state をbumpしてeffectを再実行させる仕組みも追加（`Notification.permission`はReactの依存配列に入れられない外部mutableな値のため）。ただし単純に実装すると「許可がdefaultのままtickが上がる→effect再実行→再度requestPermission呼び出し→また解決→tick再上昇」の無限ループになるため、`permissionRequestedRef`で「リクエスト中は再送しない」ガードを追加
  - `document.hidden`も直接読むのではなく state化 + `visibilitychange`リスナーで追従するよう変更（タブ非表示化のタイミングで再評価されるように）
- `addons/state.ts`: `writeAddonEnabled`のread-modify-write競合を、[[provider-model-state-race]]と同じマイクロタスクキューパターンで解消
- `workflow-artifacts.ts`: `origin`のランタイム検証追加、`tab.title`の空文字列誤判定(truthy→`typeof===string`)を修正
- `git.ts`: Windows上でgitタイムアウト時、`child.kill()`は`git`本体しか殺せず孫プロセス（認証ヘルパー等）が残る問題を`taskkill /PID <pid> /T /F`に変更して解消
- テスト作成中に2つの罠にはまった: (1) `Object.assign(target, {get foo(){...}})`はgetterを**1回評価してその時の値を静的プロパティとしてコピーする**ため、後から外側変数を書き換えても反映されない → `Object.defineProperty`でアクセサとして定義する必要がある。(2) jsdomの`document.hidden`は`document.visibilityState`から自動的に導出されない（本物のブラウザと違う）ため、既存の`setVisible()`ヘルパー（visibilityStateだけ上書き）では`.hidden`を直接読むコードをテストできず、`.hidden`も明示的にoverrideする必要があった
- 作業中に`.git/index.lock`が他プロセスにより一時的にロックされていたが、`Get-Process git`で実行中プロセスが無いこと・ロックのBirth時刻が10分以上前だったことを確認してから安全に削除しコミットを完了
- 全修正に回帰テストを追加。`tsc --noEmit`・全2657テストpass

### 判断理由
- 「permissionの決定を待つ」ような非同期の外部イベントに対しては、React effectの依存配列に入れられない値（`Notification.permission`）を扱うとき、「検出（historyの更新）」と「発火（実際の副作用）」を分離するのが正しいパターン。単純に「まだ確定していない間はrefを止める」という直感的な修正は、双方向のエッジ検出（rising/falling）がある場合に必ずどちらかを壊す

### 教訓
- テストでオブジェクトのgetter/setterアクセサを複製する際は`Object.assign`ではなく`Object.defineProperty`を使う。`Object.assign`はgetterを呼び出した結果の値をコピーするだけで、アクセサの動的な性質を失う
- jsdomでは`document.hidden`と`document.visibilityState`は独立したプロパティ。片方だけモックするテストヘルパーは、実装がどちらを読んでいるかによって機能しない場合があるため、両方合わせてモックする専用ヘルパーを用意する
- 非同期の許可待ち（Notification, geolocation等）× ReactのuseEffectでは、「解決を検知して再評価する」ためのtick用stateと、「二重リクエストを防ぐ」ためのref guardの両方が必要になりがちな設計パターンだと意識する

## プロファイル同期レイヤー (2026-08-04)

### 構成
- マスター: **アクティブな opencode プロファイル**の `opencode.jsonc` (`~/.config/opencode` が symlink/junction ならそのリンク先を追跡)
- CLI: `scripts/sync-profiles.mjs` (Node ESM, 外部依存なし)
- WebAPI: `web/src/app/api/profiles/sync/route.ts` (GET=状況, POST=実行)
- WebUI: `web/src/components/settings/ProfileSyncSettings.tsx` (設定 > プロファイルタブ)
- 共有エンジン: `web/src/lib/profiles/sync-engine.ts` (WebAPIから使用)

### npm scripts
- `npm run sync:profiles` — マスター → codex/claude へ反映
- `npm run sync:profiles:check` — ドライラン (変更があれば exit 1)

### 反映対象
- `~/.codex/config.toml` の `[mcp_servers.*]` テーブルのみ上書き (製品固有項目は保持)
- `~/.claude/settings.json` の `mcpServers` キーのみ上書き (permissions/theme 等は保持)

### WebUIプロファイル切替連携
- `/api/profiles/[id]/activate` で切替後、自動的に `applySync()` を実行
- 切替成功後、`profile-activated` カスタムイベントを発火
- `ProfileSyncSettings` はこのイベントを受けて自動的に状況を再取得
- マスターパスの表示はアクティブプロファイルに追従

### 設計メモ
- `{env:VAR}` 形式の env 値は codex/claude では親プロセス環境からの継承に任せるため省略
- リモート MCP (`type: "remote"`) は codex `url`+`[*.headers]` / claude `type:"sse"` へ変換
- CLIとWebAPIで実装は分離されているが振る舞いは同一。変更時は両方を更新すること
- 冪等性確認済み: 2回目実行で `already in sync` となる

### 検証
- `tsc --noEmit` 合格
- `eslint` 合格
- `vitest` プロファイル関連テスト全14件合格
- 全テスト実行時に1件 flaky timeout（TaskView desktop notifications、今回の変更無関係）
- CLI `--check` / 本実行 確認済み

## 新規プロファイル作成時のプラグイン npm依存完全脱却 (2026-08-04)

### やったこと（vendor バンドル化）
- `vendor/cursor-cli-proxy/packages/cursor-cli-proxy/index.js` を esbuild で再バンドルし、`zod`(`v3`/`v4`/`v4-mini`)・`@opencode-ai/plugin/tool`・`@modelcontextprotocol/sdk` 等の全 npm 依存をインライン化（1.3MB）。外部 import は Node.js 標準モジュールのみ。
- バンドル時に mojibake（UTF-8 `'`(E2 80 99) がCP932誤読で `窶兢`(E7 AA B6 E5 85 A2) に化け、正規表現リテラルが壊れて `node --check` が SyntaxError になる問題）を11箇所修復。`]` の欠落も復元。
- `claude-cli-proxy` と `commandcode-cli-proxy` は元々 Node.js 標準モジュール + 相対 import のみで npm 依存なしだったことを確認。
- `webui-dependencies.test.ts` に「vendored plugin self-containment」テスト（6件）を追加: 3つの vendor プラグインが外部 npm import を持たないこと、`node --check` が通ることを検証。
- README 3件とスペック（`docs/specs/opencode-config-profiles.md`）を更新。

### やったこと（既存プロファイルへの適用）
- アクティブな `test` プロファイル（`%APPDATA%\opencode-webui\profiles\test`）の `packages/cursor-cli-proxy/index.js` をバンドル後版に置換。`package.json`・`package-lock.json`・`node_modules` を削除。
- `default` プロファイル（`%APPDATA%\opencode-webui\profiles\default`）の `packages/cursor-cli-proxy/index.js` をバンドル後版に置換。`package.json` の `dependencies` から npm パッケージ（`@ai-sdk/*`・`@opencode-ai/plugin`・`@rama_nigg/open-cursor`・`jsonc-parser`・`yaml`）と `devDependencies` を削除し、`file:` 参照4件と `scripts` は保持。`package-lock.json` と `node_modules` を削除（`node_modules.bak` は念のため残置）。
- 全7プラグイン（test: 3個 / default: 7個）が `node_modules` なしで `node --import` で正常にロードできることを検証。
- ヘルスチェック: 稼働中の OpenCode は正常（`opencode.ok: true`）。次回再起動時に `node_modules` なしで起動するかはユーザーが確認。

### 判断理由
- `@rama_nigg/open-cursor` のバンドル済み index.js は `zod` と `@opencode-ai/plugin/tool` だけが外部 import として残っていた。esbuild で `packages: "external"`（node: ビルトインのみ外部）+ `alias`（zod/plugin をローカルパスに解決）で再バンドルするのが最小差分。
- `default` プロファイルの `package.json` には自作パッケージの `file:` 参照と `scripts` があるため、`dependencies` から npm パッケージのみ削除し `file:` 参照と `scripts` は保持。
- プロファイル複製時の `node_modules` 含める/除外は現状維持（既存プロファイルの互換性優先）。
- OpenCode 本体（`opencode.exe`、166MB Goバイナリ）は `@ai-sdk/anthropic` 等のプロバイダパッケージを内部に内包しているため、プロファイルの `node_modules` に依存しない。

### 教訓
- `\u7AB6` のような Unicode エスケープは、write ツールが小文字化(`\u7aa6`)して書き出すと別文字（0x7aa6 = 31398 vs 0x7AB6 = 31414）になる。`String.fromCharCode(0x7AB6)` を使えば確実。
- UTF-8 BOM 付きファイルを `readFileSync(path, "utf8")` で読むと BOM(`\uFEFF`)が先頭に残る。esbuild 入力に渡す前に `src.charCodeAt(0) === 0xFEFF` で strip する。
- mojibake で `]`(0x5D) が消えるケースがある。元の `E2 80 99 5D`(`']`) が `E7 AA B6 E5 85 A2` に化けた際、`]` が巻き込まれて消失。修復時は文脈（正規表現の文字クラス）から `]` を補完する必要がある。
- OpenCode のプラグインローダーは `plugin/*.js` を自動スキャンしてロードする。`opencode.jsonc` の `plugin` 配列に裸名を書くと npm registry に解決されるため、ローカルプラグインは `plugin/*.js` 経由か `./packages/*` ディレクトリ指定でのみ配置する。