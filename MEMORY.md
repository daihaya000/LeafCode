# MEMORY

## Auto モードの「選択可能なモデルがありません」エラーの原因切り分け改善 (2026-08-06)

### 経緯
- ユーザーから「Auto で選択可能なモデルがありません。プロバイダ接続とモデル有効化を確認してください。」が出るスクリーンショット付きで「Autoモードは有効化されているプロバイダ/モデルのみから選定するように」との指示を受けた
- 調査の結果、`chooseAutoModel`（`web/src/lib/auto-model.ts`）は**既に** `/provider` の `connected` フィルタと `provider-model-state.json` の `disabled` フィルタを適用しており、設計上「有効化されているプロバイダ/モデルのみから選定する」ようになっていた
- 稼働中ホストの実データ（`/api/opencode/provider` + `provider-model-state.json`）で候補数を検算したところ20件あり、現状は再現しない。ユーザーへ確認したところ「別環境のユーザーの報告で、いつ起きたか不明」「エラーメッセージ/原因の切り分けを改善してほしい」との回答
- コードを読むと、`resolveAutoModel`（`web/src/app/api/tasks/route.ts`）が **`/provider` fetch 失敗**（OpenCode 未接続・タイムアウト等）と **fetch成功後に候補ゼロ**（実際の設定不備）を両方 `null` に潰して同じ 400 メッセージ「プロバイダ接続とモデル有効化を確認してください」を返していた。これは fetch 失敗時には的外れな指示（本当は再試行すべきところを設定変更を促してしまう）になっていた
- TaskView.tsx（follow-up のクライアント側解決）も同様に、`autoInputs`（mount 時の `/provider` snapshot）が null（fetch未完了/失敗）の場合と、`chooseAutoModel` が候補ゼロで null を返す場合を区別せず同じ `AUTO_NO_CANDIDATE_ERROR` を表示していた

### 修正
1. **`web/src/app/api/tasks/route.ts`**
   - `resolveAutoModel` 内の `/provider` fetch の try/catch を削除し、失敗（`OcError` 等）をそのまま呼び出し元へ伝播させるように変更（`null` は「fetch成功だが候補ゼロ」専用に）
   - 呼び出し元で `resolveAutoModel` を try/catch し、fetch失敗時は 502（`OcError.status===503` なら503）で「OpenCode のプロバイダ情報を取得できませんでした。しばらくしてから再試行してください。」を返す。`decision === null`（候補ゼロ）の場合のみ既存の400「Auto で選択可能なモデルがありません。プロバイダ接続とモデル有効化を確認してください。」を返す
2. **`web/src/components/task/TaskView.tsx`**
   - 新定数 `AUTO_INPUTS_UNAVAILABLE_ERROR`（「Auto の候補情報を取得できていません。ページを再読み込みしてから再試行してください。」）を追加
   - follow-up 送信（`sendPrompt`/`sendCommand` 共通処理）と `startGoalLoop` の両方で、Auto解決前に `!autoInputs`（mount時のprovider fetchが未完了/失敗）を先にチェックし、その場合は新メッセージを表示。`autoInputs` はあるが `resolveAutoSelection` が null を返す場合（候補ゼロ）のみ既存の `AUTO_NO_CANDIDATE_ERROR` を表示
   - `autoInputs` を直接読むようになった2つの `useCallback` の依存配列に `autoInputs` を追加
3. **`web/src/app/api/tasks/route.test.ts`**
   - 既存テスト「returns 400 without provisioning when /provider is unavailable」を「returns 502 ...」に変更（generic Error → 502、メッセージが「プロバイダ情報を取得できませんでした」であることを検証）
   - 新規テスト「returns 503 without provisioning when /provider times out」を追加（`OcError(msg, 503)` → 503 になることを検証）

### 判断理由
- 「候補ゼロ」と「provider取得失敗」を同じエラーへ潰すのは、ユーザーに誤った対処（設定を弄る）を促す点でUXバグ。実際に発生したかは再現できなかったが、切り分けを改善すること自体はどちらの原因であっても有用で、次回同じ報告が来た際にエラーメッセージから原因を即座に判別できるようになる
- サーバー側は `OcError`（`ocServer` が投げる、timeout=503/その他=502相当）をそのまま使い、新しいエラークラスは増やさなかった。既存の `next-action/route.ts` 等でも同じ `err instanceof OcError` パターンを使っており一貫性がある
- クライアント側は `resolveAutoSelection` の戻り値の型を変えず（`AutoDecision | null` のまま）、呼び出し側で `autoInputs` の有無を先に見るだけの最小差分にした。関数のシグネチャ変更は2箇所の呼び出し元とテストへの影響が大きくなるため避けた

### 検証
- `npx tsc --noEmit` 合格
- `npx eslint .`（web全体）合格
- `npx vitest run`（全219ファイル/2670テスト）全合格

### 教訓
- 「エラーが再現しない」場合でも、コードのエラー分岐が2つの異なる原因（一時的な接続障害 vs 恒久的な設定不備）を同一メッセージに潰していないかを確認する価値がある。再現できなくても、原因の切り分け自体を改善しておけば次回の診断が速くなる
- Auto モデル選定は「BFF（`route.ts`）」と「クライアント（`TaskView.tsx`）」で解決ロジック（`chooseAutoModel`）は共有しているが、provider snapshot の取得元・タイミングが異なるため、エラー処理も両方に同じ設計判断（fetch失敗 vs 候補ゼロの区別）を個別に適用する必要がある

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

## AGENTS.md / Skills グローバル同期 (2026-08-05)

### 背景
- `https://github.com/DevsProtein/agents-sync` を参考に、OpenCode/Claude/Codex/agents のグローバル設定を一元管理する同期を追加
- マスター: `~/.config/opencode/AGENTS.md` と `~/.config/opencode/skills/<name>/`
- Claude: `~/.claude/CLAUDE.md` へ内容コピー、`~/.claude/skills/<name>/` へ symlink
- Codex: `~/.codex/AGENTS.md` へ内容コピー、`~/.codex/skills/<name>/` へ symlink
- agents: `~/.agents/skills/<name>/` へ symlink
- OpenCode 本体は `~/.config/opencode/opencode.jsonc` の `instructions` に `~/.config/opencode/AGENTS.md` を参照

### 追加ファイル
- `web/src/lib/profiles/agents-sync-engine.ts` — エンジン本体
- `web/src/lib/profiles/jsonc.ts` — JSONC 読み書きユーティリティ（MCP 同期と共有）
- `web/src/app/api/profiles/agents-sync/route.ts` — GET/POST API
- `web/src/components/settings/ProfileAgentsSyncSettings.tsx` — UI
- `scripts/agents-sync.mjs` — CLI エントリポイント

### npm scripts
- `npm run sync:agents` — 実行
- `npm run sync:agents:check` — ドライラン

### マイグレーション
- 既存の `~/.claude/CLAUDE.md` を `~/.config/opencode/AGENTS.md` へコピーし、opencode の `instructions` を `~/.config/opencode/AGENTS.md` を指すように変更
- `~/.codex/AGENTS.md` は `~/.config/opencode/AGENTS.md` へ上書きコピー

### 動作確認
- `npm run sync:agents:check` → 2件変更あり
- `npm run sync:agents` → `~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md` へコピー
- 2回目 `npm run sync:agents:check` → 0件変更（冪等）
- `tsc --noEmit` / `eslint` 合格

### 注意
- Windows では skills の symlink 作成に開発者モードまたは昇格が必要。junction を fallback として使用
- instructions は symlink ではなく内容コピー
- 現状 `~/.config/opencode/skills/` は空なので、skills 同期は変更なし
- `~/.claude/CLAUDE.md` は今後ミラー先となる。直接編集しても次回同期で上書きされるため注意

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

## プロファイル設定画面に「ファイルを開く」「フォルダを開く」を追加 (2026-08-06)

### 対応内容
- 設定画面の「プロファイル」タブ（`ProfilesSettings`）で、アクティブなプロファイルに対して
  - **ファイルを開く**: 設定ファイル（`opencode.jsonc` / `opencode.json` / `config.json` / `config.jsonc`）を OS のデフォルトアプリで開く / 親フォルダで選択表示
  - **フォルダを開く**: プロファイルディレクトリをエクスプローラー / Finder / ファイルマネージャーで開く

### 実装
1. **新規 API エンドポイント**: `web/src/app/api/profiles/[id]/open/route.ts`
   - `POST /api/profiles/{id}/open`、ボディ `{ action: "open-file" | "open-folder" }`
   - `rejectUnlessLocal` でローカルホストのみ許可
   - アクティブなプロファイルのみ開ける（レジストリ `activeId` と一致するか検証）
   - `open-file` 時は設定ファイル候補を順に探し、見つからなければフォルダを開く
2. **UI 追加**: `web/src/components/settings/ProfilesSettings.tsx`
   - アクティブなプロファイル行に「ファイルを開く」「フォルダを開く」ボタンを追加（desktop table / mobile cards 両方）
   - 既存の `actionBusy` 機構を流用して連打防止

### 修正履歴
- **初回実装**: `explorer.exe` を `spawnSync` で直接起動 → Windows ではプロセスが即座に `exit 1` になり、Explorer が開かない
- **修正**: PowerShell (`powershell.exe -NoProfile -Command explorer ...`) を介して起動するように変更
  - なぜ直接 `explorer.exe` ではダメなのかは未完全解明だが、Next.js の Server Action / Route Handler から呼ばれる子プロセスがデスクトップセッションやシェルコンテキストを持たないため、`explorer.exe` が GUI を起動できないと推測
  - `cmd.exe /c start "" <path>` は動作したが、設定ファイルを「親フォルダで選択」して開く `/select,` 構文が扱いにくいため PowerShell 経由を採用

### 検証
- `npm --prefix web run typecheck` 合格
- `npm --prefix web run lint` 合格
- `npm --prefix web run test` 合格（219 test files / 2669 tests passed）
- Windows 上で Node からの直接 `spawnSync('explorer.exe', ...)` は `status: 1` だが、`spawnSync('powershell.exe', ['-NoProfile','-Command',`explorer ...`])` は `status: 0` かつ実際に Explorer が開くことを手動確認

### 備考
- セキュリティ: 開くパスはレジストリに登録されたプロファイルの `path` のみ。クライアントからの任意パスは受け付けない
- プラットフォーム: Windows では PowerShell 経由の `explorer`、macOS では `open`、Linux では `xdg-open`
