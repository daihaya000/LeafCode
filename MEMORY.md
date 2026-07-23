# MEMORY.md — OpenCode WebUI

## 2026-07-23 中優先度バグ修正（進行中）

### やったこと
ワークフローを簡略化（仕様書・多段レビュー省略、調査→修正→検証→即コミット）し、中優先度バグを修正中。まず高優先度対応で既に解決済みの項目（R44#1 symlink隔離、R2#2 二重202、R39#3 warp write-block）を切り分けた上で、未修正を修正単位に統合。

修正済み18件（コミット）:
- write-block漏れ一括（R38#2 upgrade / R39#2 sync/steal・R39#4 project/git/init / R40#2 session share / R41 project PATCH・session background・tui/* / R50#2 permission/saved）— `b2966ea`
- runGitにタイムアウト追加でBFF無期限ハング防止（R47#1、runGhは不在）— `0fe9880`
- browse/folderのpowershellにタイムアウト（R54#1）— `2dd51ee`
- files/search走査にエントリ数(20000)・深さ(12)上限（R49#3）— `7887825`
- 死んだsystrayへの更新停止＋exit時に参照破棄（R13#3）— `f2e89fc`
- Caddy HTTPS時に/api/accessが公開URL案内。hostがCaddyfileから公開origin抽出しOPENCODE_WEBUI_PUBLIC_URL付与（R42#1）— `ec3f54a`
- commit/merge成功後にinvalidateDirStatでキャッシュ無効化（R45#1）— `7722397`
- マージ後のアーカイブ失敗を黙殺せず警告表示（R7#5）— `77d34fe`
- Caddy異常exit後に自動再起動(3回/5分上限)（R35#2）— `6ed1dee`
- CreationDate未取得時は厳格cmdlineチェックで誤認taskkill防止（R35#5）— `7ce5f2a`
- stopChildrenにWebUI listen-PIDフォールバック＋waitForPortFree追加（R53#1-2）— `f5b23f4`
- temporary_copyのSKIPに.opencode-webuiを追加しコピー肥大化を防止（R46#2）— `5752590`
- writeCostDisplayPrefsが既存設定とマージしrateMode等の破壊を防止（R49#2）— `d737fb5`
- favoriteトグル時にlast_opened_atを更新せず並び順を保持（R29）— `b575825`
- worktree defaultTargetがupstream(追跡ブランチ)を優先（R33）— `59bc0ee`
- stop()後にtranscriptをクリアし録音セッション跨ぎの文言残存を防止（R51#2）— `5118d46`
- 画像送信に枚数(10枚)・サイズ(10MB)上限を追加（R28）— `420c97e`

### 判断・教訓
- R7#6（diff/files 200+git:false）はDiffPaneが既にpayload.error優先表示のため実害緩和済みと判断、コード変更せず。
- mcp_Bashのbashログインシェルは出力が欠落することがある（git status --shortが空に見えた）。cmd直実行（`git ... & echo ---END---`）で確実に確認する。
- 各修正はロジック/API/host層中心で回帰テストを追加（opencode-id, git, files/search, access, dirstat, host parseCaddyPublicUrl, shouldRestartCaddy, stronglyLooksLikeHostCommandLine, copy SKIP, currency merge, db favorite, voice-input transcript）。UIコンポーネント（DiffPane）はtsc+eslintで検証。
- 他エージェント並行作業（client.ts等）の未コミット差分には一切触れず、自分の変更ファイルのみを意味単位でコミット。
- R17(abort後再送信), R22(bindSession unsafe id), R24(intelligence基準) はUIコンポーネントのロジックで他エージェント並行作業領域と重なる可能性が高いため、BFF/ロジック層の独立した修正を優先して着手。

### 残タスク（中優先度、未着手）
UI不具合系: R25(compact失敗表示), R12#2(archived→マージ済), R15#4(空credits last-good), R35#3(自己マージ先), R36#2(フルアクセス自動承認), R9#2-3(為替clamp・AddProjectパス), R3#6-7(isMd初期false)
操作性系: R17(abort後再送信), R24(intelligence基準), R9#1(SSE再接続stale), R37#1(into=current後abort), R5#1/R4#1(Attentionフォーカス), R18(children.length===1), R21/R11#2-3(GraphPanel stale), R20/R6#2(FileTree root超え), R22(bindSession unsafe id), R16#2/R14#2(orphan掃除), R3#1/R4#2(kebab z-index)

## 2026-07-23 高優先度バグ修正（R1-R54）完了

### やったこと
docs/bugs/2026-07-23-bug-inventory.md の高優先度バグ全件を修正。サブエージェント駆動開発で23タスクを順次実装・レビュー。

**Phase 1: BFF security/data guard**
- OpenCode書込み遮断の強化（PTY v1/v2含む全mutating経路）
- /provider・/config/providers・/global/config の秘密マスク拡張
- 画像送信のUI/BFF二重fail-closed（capability=true以外は拒否）
- タイトル再生成の全ツール無効化（tools map全false、取得失敗時は502）
- 既修正3グループの回帰テスト補強（setup.bat、NestedAgent空TL、Attention busy固着）

**Phase 2: allowlist/temp copy**
- isInside根一致拒否（git.ts・project-session-sync.ts、保護root重複も拒否）
- POST /api/projects・/api/roots のパス検証（canonical実体パス、UNC/device path拒否、システム領域拒否）
- DELETE /api/roots ハンドラ追加（case-insensitive照合）
- SettingsView roots削除ボタン（確認導線、a11y、コントラスト）
- temporary_copy symlink隔離・失敗時ロールバック・cross-copy削除防止
- purgeGoneOrphans allowlist解放

**Phase 3: host reliability**
- headless検出強化（--headlessフラグ・OPENCODE_HEADLESS・OPENCODE_WEBUI_HEADLESS）
- OpenCode異常exit自動再起動（3回/5分上限、計画停止は除外）
- healthポーリング ターゲット別成功条件・60回失敗でエラー

**Phase 4: 通信/SW**
- timedFetchボディ読了タイムアウト（全body reader対応、AbortErrorのみ408）
- Service Worker非OKレスポンスキャッシュ拒否（v2にbump）

**Phase 5: UI core**
- iOS 16pxフォントサイズ対策・touchActivity 5秒ブロック
- initialCollapsed計算修正（matchMedia lazy初期化）
- SessionSwitcher snap-back解消（localSelection）
- PartView error表示（status=errorで常に表示）

### 判断理由
- 高優先度は秘密漏洩・データ破壊・コア導線停止の3カテゴリ。セキュリティを最優先で修正
- 各タスクはTDDで実装し、セキュリティ監査・UIレビューを挟んで承認後に次へ進む
- レビュー指摘はCritical/Importantを必ず修正、Minorは実装に影響なければ許容

### 教訓
- セキュリティ修正は単発で終わらず、レビューでTOCTOU・正規化前traversal・UNC別名などの追加攻撃面が発見される
- UI修正もa11y（role=alert、aria-live、フォーカス管理）とコントラスト（WCAG AA 4.5:1）を同時に確認する
- サブエージェント駆動開発で23タスクを並列処理できたが、他エージェントの未コミット差分との衝突に注意が必要

---

## 2026-07-23: CodexBar更新プロバイダー切替

- 実施: CodexBar addon に「更新するプロバイダー」パネルを追加し、providerごとの `CodexBarで更新` switch、保存中・失敗・再試行状態を実装した。usage詳細の折りたたみとは別機能である。
- API: `GET/PUT /api/addons/codexbar/providers` は許可済みprovider IDと有効状態だけを返す。固定AppData設定パスを原子的に更新し、version競合・未知ID・最後の有効provider無効化を拒否する。秘密情報・設定全体は返さない。
- 判断: 複数WebUIプロセスのread-modify-write競合を避けるため、設定隣接の排他lockを取得後にversionを再確認する。CodexBar側は設定変更を監視して次回更新を待たずに反映する。
- 教訓: snapshotは現在有効なproviderしか持たないため、設定一覧の権威ソースにできない。固定allowlistをAPI側で持ち、表示の折りたたみと取得対象の切替を混同しない。
- UIレビュー対応: 最小180pxサイドバーでは設定ボタンをヘッダー2行目の全幅に置く。操作対象は24px以上、状態は `aria-busy` / `role=status` / `role=alert` で通知し、淡い文字色だけに依存しない。

## 2026-07-23 右上ヘッダー操作をケバブメニューへ統合・セッション切替を外部dialog化

### やったこと

1. **右上ヘッダー操作をケバブメニューへ移動**: コピー/再同期/セッション/ターミナルの各ボタンをヘッダー直置きからケバブ（`...`）内の `role="menu"` 項目へ統合。ヘッダーがすっきりし、画面幅が狭い場合も操作が隠れない
2. **セッション切替を `menuitem` → 外部dialog に変更**: `role="menu"` 内に `<select>`（native select）と `<button>` を混在させるとアクセシビリティツリーが崩れる（`menuitem` 以外のロールが menu 内に存在する）ため、セッション切替はケバブから開く独立した dialog に分離。dialog 内で `<select>` + 「切り替え」ボタンを配置し、role 混在を解消
3. **dialog のフォーカス管理・キーボード操作を実装**:
   - 開いたら自動フォーカス（`autofocus` / `useEffect` で select へ）
   - Tab/Shift+Tab で dialog 内を循環（フォーカストラップ）
   - Escape で閉じる
   - backdrop（オーバーレイ）クリックで閉じる
   - 成功時（セッション切替完了）も自動クローズ＋ケバブ trigger にフォーカス復帰
4. **最終検証**: テスト 38 件（`vitest run`）・`tsc`・`eslint` すべて成功

### 判断理由

- `role="menu"` 内に native `<select>` を置くと、スクリーンリーダーが `menuitem` ロールと混同し、操作不能または予期しない読み上げになる。WCAG 4.1.2（name, role, value）違反を回避するため、セッション切替だけ dialog に切り出した
- ケバブ trigger へのフォーカス復帰は、キーボードユーザーが操作後に同じ場所から続けられるようにするため（WCAG 2.4.3 focus order）

### 教訓

- `role="menu"` は WAI-ARIA の strict な widget であり、`menuitem` 以外のロール（`combobox` / `button` / native `<select>`）を子に持たせてはいけない。見た目がメニューでも、ARIA 的には「操作項目のリスト」に徹する必要がある
- 外部 dialog への切り出しは、アクセシビリティ違反を直すだけでなく、セッション一覧が長い場合のスクロールや検索にも拡張しやすい構造になる
- フォーカストラップ・Escape・backdrop の3点セットは dialog コンポーネントの最小要件。毎回ゼロから書くのではなく、共通 `useDialog` hook 化の余地あり

## 2026-07-23 バグ発見ループ R54（発見のみ・未修正）

### ループ
- tick #22（PID 23500）。R1–R53 重複除外。死んだ browse/folder API

### 確度の高い新規バグ

1. **P2 / 死んだ `POST /api/browse/folder` が無 timeout で BFF を塞ぎうる** — `api/browse/folder/route.ts`（`maxDuration=300`、`runPowerShellSta` 80-110）
   - 症状: UI は `browse/dirs` へ移行済みでフロント参照ゼロだが API は残存。LAN から POST するとホストデスクトップに FolderBrowser が出て、閉じるまで（最大 ~300s）ワーカー占有。spawn に timeout／kill なし。連打で DoS
   - 根拠: `child.on("close")` 待ちのみ。MEMORY の「ネイティブ FolderBrowser 廃止」記述と矛盾してルートが生きている。R49#3 files/search・R47 runGit とは別面
   - 再現: `POST /api/browse/folder` → ホストにダイアログ。閉じない限りリクエストが返らない

### 据え置き
- R1–R53 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R53（発見のみ・未修正）

### ループ
- tick #21（PID 23500）。R1–R52 重複除外。host restart-all／stopChildren

### 確度の高い新規バグ

1. **P2 / 「すべて再起動」が reuse WebUI を殺さない** — `host/src/index.js` `stopChildren`（1138-1163）× `restart-targets.js` `resolveKillPids`（7-15）× ポート reuse（`webProc=null`）
   - 症状: 健全な既存 WebUI を reuse して起動したホストで「すべて再起動」しても、OpenCode は listen PID 経由で止まるが WebUI は `webProc` が null のため kill 対象に入らず生き残る。その後また reuse → 実質 WebUI 未再起動
   - 根拠: `stopWebOnly` は `resolveKillPids({ownedPid, listeningPids})` だが、`stopChildren` の WebUI 側は `[webProc?.pid, …].filter(Boolean)` のみで listen フォールバック無し。R2#2 は二重 202 no-op、R50 は headless 誤殺で、reuse 時の WebUI kill 非対称は未記載
   - 再現: WebUI だけ先行稼働 → host が reuse 起動 → トレイ／control で restart/all → WebUI PID が変わらない

2. **P2 / `stopChildren` が `waitForPortFree` しない** — `index.js` `stopChildren`（1138-1163）vs `stopWebOnly`/`stopOpencodeOnly`（1100-1135）；`restartServices` は `sleep(1000)` のみ（1285-1295）
   - 症状: 「すべて再起動」で kill 直後に再 spawn。Windows で listen 解放が遅れると EADDRINUSE／ghost／別ポートへずれ、Caddy 固定ポートと不整合しうる
   - 根拠: `waitForPortFree` 呼び出しは個別 stop のみ。`stopChildren` 経路には無し
   - 再現: restart/all 直後にポート占有エラーや Caddy と WebUI ポートの食い違いが出る環境

### 据え置き
- R1–R52 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R52（発見のみ・未修正）

### ループ
- tick #20（PID 23500）。R1–R51 重複除外。GET /provider マスク

### 確度の高い新規バグ

1. **P1 / `GET /provider` が `maskSecrets` されず API キーが平文** — `api/opencode/[...path]/route.ts:186-197` × schema `Provider.key?` / `options.apiKey`
   - 症状: BFF は `pathname === "/config"` のときだけマスク。`/provider` はそのまま upstream JSON。さらに `allowWithoutDir` 対象のため **directory ヘッダ無し**でも呼べる。UI（Home/Task/Settings）が常用する経路で、LAN から `providers[].key` / `options.apiKey` が平文で読める
   - 根拠: マスク条件が完全一致 `/config` のみ。R48=`/global/config`、R49=`/config/providers`（directory 付き）。R49 修正メモの「必要なら `/provider` も」は未登録の別エンドポイント。実機走査で keyed provider（例: ollama-cloud）を確認済みの系統
   - 再現: `GET /api/opencode/provider` → JSON の `key` が `********` ではなく実値（マスクマーカー無し）
   - 修正: R48/R49 と一括で `/provider`・`/config/*`・`/global/config*` の GET JSON に `maskSecrets`。漏えいキーはローテーション推奨

### 据え置き
- R1–R51 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R51（発見のみ・未修正）

### ループ
- tick #19（PID 23500）。R1–R50 重複除外。音声入力（use-voice-input）

### 確度の高い新規バグ

1. **P2 / 音声認識が `resultIndex` を無視し、確定文言を重複蓄積する** — `use-voice-input.ts:137-152`
   - 症状: `continuous: true` 時、ブラウザは `results` に過去の final を残したまま再送する。ハンドラが毎回 `0..length` を全部 append するため、「こんにちは」→「こんにちは こんにちは 世界」のように重複する
   - 根拠: `SpeechRecognitionEvent.resultIndex` 未参照。ローカル型にも無い。R10#2 は「音声は仕様のみ」だったが実装後のこの累積バグは未登録
   - 再現: Chrome 等でマイク入力を連続発話 → composer への挿入テキストが同一フレーズの重複になる

2. **P2 / `start`/`stop` が transcript をクリアせず、録音セッションをまたいで文言が残る** — `use-voice-input.ts` `start`/`stop`（173-195；クリアは `disabled` 時のみ 202-216）
   - 症状: `stop()` はテキストを返すだけで `transcriptRef` を空にしない。次の `start()` もリセットしない。2回目の録音が1回目の文言に連結される（#1 の同一セッション内 `results` 再走査とは別）
   - 再現: 録音→停止→再録音 → 返却／表示テキストが前回分を前置する

### 据え置き
- R1–R50 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R50（発見のみ・未修正）

### ループ
- tick #18（PID 23500）。R1–R49 重複除外。host lock／permission saved

### 確度の高い新規バグ

1. **P1 / GUI 起動が headless ホストを「劣化」と誤認して `taskkill` する** — `host/src/index.js:955-987`
   - 症状: `OPENCODE_WEBUI_HEADLESS=1` で正当に稼働中のホストに、トレイありの通常 `start-webui` を重ねると、トレイ子が無い＝劣化と判定され `taskkill /F`。制御プロセスが落ち、Caddy 有効時は `stopStrayCaddy` で orphan Caddy も殺す
   - 根拠: `headless` は**新規プロセス側**の `OPENCODE_WEBUI_HEADLESS` のみ参照。ロック保持側が意図的 headless かは見ない。R35#5 は CreationDate 失敗時の cmdline 誤認、R13#3 は死んだ systray への更新継続で、headless 誤殺は未記載
   - 再現: headless で host 起動 → 別コンソールから通常（非 HEADLESS）起動 → 既存 PID が強制終了される

2. **P2 / `DELETE …/permission/saved/{id}` が write ブロック漏れ** — `opencode.ts` `isBlockedOpencodeWrite`（5-23）× schema `v2.permission.saved.remove` × proxy `route.ts:52-55`
   - 症状: PUT/DELETE `/auth` と POST `/mcp` は遮断するが、保存済み権限の削除はプロキシ経由で通る。LAN 無認証時、許可ディレクトリ付きで always 許可を消せる
   - 根拠: denylist 評価で `DELETE /permission/saved/abc` および `DELETE /api/permission/saved/abc` がともに `blocked=false`。R38–41 の穴一覧に `permission/saved` は無い（R7#7 は MCP OAuth DELETE）
   - 再現: `DELETE /api/opencode/api/permission/saved/{id}`（またはエンジン側相当パス）→ 403 にならず upstream へ到達

### 据え置き
- R1–R49 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R49（発見のみ・未修正）

### ループ
- tick #17（PID 23500）。R1–R48 重複除外。config/providers マスク／currency Partial／files/search

### 確度の高い新規バグ

1. **P1 / `GET /config/providers` が `maskSecrets` されず API キーが平文** — `api/opencode/[...path]/route.ts:186-197` × schema `Provider.key?`
   - 症状: BFF は `pathname === "/config"` のときだけマスクする。`/config/providers` はそのまま upstream JSON を返す。稼働ホストで `GET /api/opencode/config/providers`（`x-opencode-directory` 付き）を叩くと、各 provider の `key` がマスク無しの平文（例: ollama-cloud の API キー）で返った
   - 根拠: `maskSecrets` はキー名 `/key|token|secret|…/i` をマスクできるが、適用条件が完全一致 `/config` のみ。R48 の `/global/config` と同根因の別エンドポイント。LAN 公開時は同一セグメントから秘密が読める
   - 再現: 許可ディレクトリをヘッダに付けて `GET /api/opencode/config/providers` → JSON の `providers[].key` が `********` ではなく実値
   - 修正方針メモ: GET かつ JSON なら `/config`・`/config/*`・`/global/config`・`/global/config/*`（必要なら `/provider` も）にマスクを広げる。漏えい確認済みキーはローテーション推奨

2. **P2 / `writeCostDisplayPrefs` が `Partial` をマージせず、欠落フィールドをデフォルトで上書き** — `currency.ts` `writeCostDisplayPrefs`（77–87）× `sanitizeCostDisplayPrefs`（45–64）
   - 症状: 署名は `Partial<CostDisplayPrefs>` なのに既存 prefs とマージしない。`rateMode` 欠落時は `=== "auto"` 以外すべて `"manual"` になるため、auto 利用者の設定が部分書き込み一発で manual に落ち、`showUsdSuffix` も false に戻る
   - 根拠: Settings はフルオブジェクトを渡すが、テスト `writeCostDisplayPrefs({ currency, usdJpyRate })` が rateMode→manual になる挙動を固定化。将来の部分更新呼び出しで設定破壊が起きやすい API 欠陥
   - 再現: localStorage に `rateMode:"auto"` を入れた状態で `writeCostDisplayPrefs({ showUsdSuffix: true })` → rateMode が manual、他フィールドもデフォルト化

3. **P2 / `GET /api/files/search` が同期フルツリー走査でイベントループを塞ぎうる** — `api/files/search/route.ts` `walk`（20–46, 66–68）
   - 症状: `readdirSync` の再帰をリクエストスレッドで実行。`q` が稀少マッチ／空以外でも全エントリを訪れるため、巨大リポでは `limit` 到達前に長時間ブロック。タイムアウトも無し（R47 runGit と同系統の BFF ハング面）
   - 根拠: 非同期化・深さ上限・経過時間打ち切りなし。フロントからの参照は現状薄いが BFF は公開 API
   - 再現: 巨大 tree の allowlist ディレクトリで `GET /api/files/search?directory=…&q=zzzz-rare` → レスポンス遅延／他 API のストール

### 据え置き
- R1–R48 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R48（発見のみ・未修正）

### ループ
- tick #16（PID 23500）。R1–R47 重複除外。config マスク／proxy

### 確度の高い新規バグ

1. **P1 / `GET /global/config` が `maskSecrets` されない** — `api/opencode/[...path]/route.ts:186-197`
   - 症状: インスタンス `/config` の GET だけ秘密マスクするのに、グローバル設定 GET はそのまま upstream JSON を返す。LAN から `GET /api/opencode/global/config` で API キー等（key/token/secret 系フィールド）が平文で読める可能性
   - 根拠: 条件が `pathname === "/config"` の完全一致のみ。`/global/config` は PATCH ブロック済みだが GET マスク対象外。UI は主に `/config` を使うが BFF は両方プロキシする
   - 再現: OpenCode に秘密を含む global config がある状態で `GET /api/opencode/global/config` → レスポンスにマスクされていない秘密フィールド

### 据え置き
- R1–R47 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R47（発見のみ・未修正）

### ループ
- tick #15（PID 23500）。R1–R46 重複除外。runGit／runGh／host-control

### 確度の高い新規バグ

1. **P2 / `runGit`（および `runGh`）にタイムアウトがなく、BFF が無期限ハングしうる** — `git.ts` `runGit`（28–59）× `api/git/pr/route.ts` `runGh`（9–33）× 全 git/diff/merge/commit/log/dirstat 経路
   - 症状: index.lock・巨大リポ・ネットワーク fs・credential helper 残留などで git/gh が終わらないと、該当 API リクエストが永遠に待ち、Node ワーカーを占有。`GIT_TERMINAL_PROMPT=0` は対話のみ防止で、プロセス自体の上限は無い
   - 根拠: spawn に `timeout`／`AbortSignal`／手動 `kill` なし。close 待ちのみ。過去メモは環境変数追加のみで「タイムアウト欠如」は未登録
   - 再現: 対象 repo で `git` をブロック（例: 手動で index.lock を保持）した状態で Diff の status／commit や PR 作成を叩く → リクエストが返らない

### 据え置き
- R1–R46 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R46（発見のみ・未修正）

### ループ
- tick #14（PID 23500）。R1–R45 重複除外。refresh-title／copy SKIP／git skip

### 確度の高い新規バグ

1. **P1 / タイトル再生成が `tools: {}` のままツールを止めない** — `refresh-title/route.ts:68-78` × schema `tools?: { [key: string]: boolean }`
   - 症状: 「会話からタイトル再生成」が一時セッションで prompt する際、`tools: {}` は「上書きなし」と解釈されやすく、デフォルトの bash/edit 等が有効のまま。タイトル生成中にツール実行・ディスク変更が起きうる
   - 根拠: OpenAPI 上 `tools` はツール名→boolean のマップ。空オブジェクトは全無効ではなく未指定と同等。明示的に主要ツールを `false` にする／agent を無ツールに固定するコードが無い
   - 再現: サイドバーでタイトル再生成 → OpenCode 側で temp session の tool 呼び出し有無をイベント／ログで確認

2. **P2 / `temporary_copy` の SKIP に `.opencode-webui` が無い** — `copy.ts` SKIP（5–15）
   - 症状: 隔離コピーに WebUI の sessions.json 等メタデータが入り、肥大化・旧パス情報の混入。R44 symlink とは別のコピーフィルタ欠落
   - 再現: `.opencode-webui/sessions.json` があるリポジトリで temporary_copy 作成 → コピー先に同ディレクトリが存在

### 据え置き
- R1–R45 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R45（発見のみ・未修正）

### ループ
- tick #13（PID 23500）。R1–R44 重複除外。dirstat キャッシュ／commit／CommandPalette

### 確度の高い新規バグ

1. **P2 / `invalidateDirStat` が未使用で、コミット後もサイドバー差分統計が最大15秒古いまま** — `dirstat.ts`（12–14, 38–71, 74–77）× `task-service.ts` `listTasks`（171–173）× `git/commit`・DiffPane（invalidate 呼び出しなし）
   - 症状: Diff でコミット／マージしても、タスクカードの +/-・変更ファイル数が最大 15s TTL の間古い。`filesChanged` 由来の状態チップもずれうる
   - 根拠: `invalidateDirStat` は定義のみでリポジトリ全体に参照ゼロ。commit/merge/API 成功後もキャッシュを消さない
   - 再現: 変更ありタスクでコミット成功 → すぐサイドバー／タスク一覧を見る → 数秒間はコミット前の additions/deletions のまま

### 確認メモ
- `temporary_copy` の SKIP に `.opencode-webui` 無しは軽微（P3候補）で今回非掲載
- R1–R44 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R44（発見のみ・未修正）

### ループ
- tick #12（PID 23500）。R1–R43 重複除外。temporary_copy の symlink／activity／files 周辺

### 確度の高い新規バグ

1. **P2 / `temporary_copy` が外向き symlink をそのまま複製し、隔離を破れる** — `copy.ts` `createTemporaryCopy`（28–35, `dereference: false`）× provision（workspace-service）
   - 症状: コピー元に `secrets -> C:\Users\…\.ssh` のような symlink があると、copies 配下に同じリンクが残る。allowlist はコピー根の realpath しか見ないため、エンジン／エージェントのファイル操作がリンク先（ホスト側）へ到達しうる。「一時コピーで隔離」前提が崩れる
   - 根拠: `fs.cpSync` が symlink を実体化せず保持。SKIP はディレクトリ名のみで symlink 先を検証しない。過去メモの「Windows symlink EPERM」はコピー失敗側で、成功時の外向きリンク残存は未記載
   - 再現: リポジトリに外向き symlink を置き isolation=temporary_copy でタスク作成 → コピー内のリンク先を read/write

### 確認して新規なし／既知
- touchActivity の await ブロックは R1#4 のまま未修正
- projects/restore の adopt は manifest 必須で R43 より狭い（ただし成功時は同様に allowlist 追加）

### 据え置き
- R1–R43 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R43（発見のみ・未修正）

### ループ
- tick #11（PID 23500）。R1–R42 重複除外。allowlist 拡張経路（projects／roots）を確認

### 確度の高い新規バグ

1. **P1 / `POST /api/projects`・`POST /api/roots` が任意パスを無検証で allowlist に追加** — `projects/route.ts:23-44` × `db.ts` `upsertProject`→`addAllowedRoot`（152）× `roots/route.ts:13-24`
   - 症状: 存在しないパスや `C:\` 等を指定しても許可ルートに入る。LAN 無認証時は攻撃者が allowlist を広げ、以降の OpenCode プロキシ／git API の作用域をホスト全体へ拡大できる（R38–41 の write 漏れと組み合わせると被害が跳ねる）
   - 根拠: `fs.existsSync`／`isDirectory` なし。projects は `upsertProject` が常に `addAllowedRoot`。roots は resolve＋realpath のみ。R30 は「削除手段なし」のみで追加側の無検証は未記載
   - 再現: `POST /api/projects` `{"rootPath":"C:\\\\"}` または `POST /api/roots` `{"path":"C:\\\\Windows"}` → `GET /api/roots` に登場

### 据え置き
- R1–R42 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R42（発見のみ・未修正）

### ループ
- tick #10（PID 23500）。R1–R41 重複除外。write ブロック以外（access／setup／allowlist）を確認

### 確度の高い新規バグ

1. **P2 / `GET /api/access` が常に `http://<NIC>:3000` を返す** — `api/access/route.ts:7-10,48-49,63` × Settings 接続タブ
   - 症状: `OPENCODE_WEBUI_CADDY=1`（HTTPS `:8443`）運用でも設定の「スマホ / VPN アクセス」が素の WebUI `:3000` HTTP を案内。ファイアウォール未開放や TLS 前提のスマホで接続失敗／誤コピー
   - 根拠: PORT は `OPENCODE_WEBUI_PORT||PORT||3000` のみ。Caddy 有無・公開ポート・スキームを見ない。hint 文言も「:3000」固定寄り
   - 再現: Caddy 有効で設定 → 接続タブの URL が `http://192.168.x.x:3000`（正しくは `https://…:8443` 相当）

### 確認メモ
- `setup.bat` の `:start_host` は `start … start-webui.bat` で非ブロッキング化済み → **R31 ハングは緩和**。成功前のヘルス確認欠如（R32）は残存
- allowlist `isUnder` の根一致は R35 と同根のため新規 ID なし
- write ブロック面は R38–41 で収束気味。以降は UI／運用面が主戦場
- R1–R41 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R41（発見のみ・未修正）

### ループ
- tick #9（PID 23500）。R1–R40 重複除外。残 denylist 穴（project PATCH／workspace DELETE／background／tui）

### 確度の高い新規バグ

1. **P2 / `PATCH /project/{projectID}` が write ブロック漏れ** — schema `project.update` × `isBlockedOpencodeWrite`
   - 症状: OpenCode 側プロジェクト名・icon・commands を BFF 経由で変更可能
   - 再現: `PATCH /api/opencode/project/<id>` → 403 にならない

2. **P2 / `DELETE /experimental/workspace/{id}` が write ブロック漏れ** — schema `experimental.workspace.remove`（R27 は主に POST 作成・worktree。削除エンドポイントは未列挙）
   - 症状: エンジン管理 workspace をプロキシ経由で削除できる
   - 再現: `DELETE /api/opencode/experimental/workspace/<id>` → 403 にならない

3. **P2 / `POST /experimental/session/{id}/background` が write ブロック漏れ** — schema `experimental.session.background`
   - 症状: 同期サブエージェントを強制デタッチできる（進行中タスクの挙動を壊しうる）
   - 再現: `POST /api/opencode/experimental/session/<id>/background` → 403 にならない

4. **P2 / `/tui/*` 書き換え系 POST 一式がブロック漏れ** — `tui/append-prompt`・`submit-prompt`・`clear-prompt`・`execute-command`・`select-session` 等（R39 で実害薄と据え置き→同ホストに TUI 併走時は注入可能と再評価）
   - 症状: WebUI からデスクトップ TUI 操作を誘導できる
   - 再現: `POST /api/opencode/tui/append-prompt` 等 → 403 にならない

### メモ
- write ブロック穴は R26/27/32/38–41 で網羅が進んだ。修正は denylist 追加より **mutating method の allowlist** が安全
- R1–R40 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R40（発見のみ・未修正）

### ループ
- tick #8（PID 23500）。R1–R39 重複除外。PTY／share／host restart 周辺

### 確度の高い新規バグ

1. **P1 / PTY 作成・更新・削除・connect-token が write ブロック漏れ** — `isBlockedOpencodeWrite` × schema `/pty`（POST）・`/pty/{ptyID}`（PUT/DELETE）・`/pty/{ptyID}/connect-token`（POST）
   - 症状: WebUI は PTY UI 未実装（一覧のみ）なのに BFF 経由でシェル PTY を作成・操作・WS トークン取得できる。LAN 公開時はリモートシェル相当
   - 根拠: denylist 未登録。`PtyPanel` は GET 相当のみ想定
   - 再現: `POST /api/opencode/pty` → 403 にならず upstream

2. **P2 / `POST|DELETE /session/{id}/share` が write ブロック漏れ** — schema `session.share` / `session.unshare`
   - 症状: セッション共有リンクの作成／解除がプロキシ経由で可能。UI 未使用でも会話が外部共有されうる
   - 再現: `POST /api/opencode/session/<id>/share` → 403 にならない

### 据え置き
- `session/shell` は製品機能のため今回は非掲載。`/api/host/restart` の LAN 到達は既知の認証方針枠
- R1–R39 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R39（発見のみ・未修正）

### ループ
- tick #5–#7（PID 23500）。R1–R38 重複除外。OpenAPI 危険 POST（vcs/sync/tui/project）をスキーマ突合

### 確度の高い新規バグ

1. **P1 / `POST /vcs/apply` が write ブロック漏れ** — `opencode.ts` `isBlockedOpencodeWrite` × schema `/vcs/apply` × proxy
   - 症状: 許可 directory 付きで任意パッチを作業ツリーへ適用できる。LAN 公開時は認証なしでディスク改変
   - 根拠: denylist は config/auth/mcp のみ。WebUI 自身の git API とは別経路
   - 再現: `POST /api/opencode/vcs/apply` + patch ボディ → 403 にならず upstream

2. **P2 / `POST /sync/steal` が write ブロック漏れ** — schema `/sync/steal`
   - 症状: セッションを現 workspace へ「奪取」できる（R26 move-session 同系・別パス）
   - 再現: `POST /api/opencode/sync/steal` → 403 にならない

3. **P2 / `POST /experimental/workspace/warp` が write ブロック漏れ** — schema `/experimental/workspace/warp`（R27 workspace 作成と同系・別エンドポイント）
   - 症状: セッション sync 履歴を別 workspace へ移動／detach
   - 再現: `POST /api/opencode/experimental/workspace/warp` → 403 にならない

4. **P2 / `POST /project/git/init` が write ブロック漏れ** — schema `/project/git/init`
   - 症状: プロジェクトで `git init` をエンジン経由で実行可能
   - 再現: `POST /api/opencode/project/git/init` → 403 にならない

### 確認メモ
- `POST /mcp/.../connect` は `p.startsWith("/mcp/")` で既ブロック。tui/* は実害薄く据え置き
- R1–R38 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R38（発見のみ・未修正）

### ループ
- tick #3–#4（PID 23500）。R1–R37 重複除外。dispose/upgrade／Pty／quickaccess／AddonHost 等を確認

### 確度の高い新規バグ

1. **P1 / `POST /global/dispose`・`POST /instance/dispose` が write ブロック漏れ** — `opencode.ts` `isBlockedOpencodeWrite`（4–24）× schema `/global/dispose`・`/instance/dispose` × proxy `route.ts:52-55`
   - 症状: WebUI BFF 経由で全インスタンス／現在インスタンスを dispose できる。LAN 公開時は認証なしでエンジンを落とせ、R36（OpenCode 非復帰）と合わさると復旧不能まで行く
   - 根拠: ブロックは PATCH config・auth・POST mcp のみ。host は OpenCode 直叩きで dispose するため BFF 遮断と衝突しない
   - 再現: `POST /api/opencode/global/dispose` → 403 にならず upstream 到達

2. **P2 / `POST /global/upgrade` が write ブロック漏れ** — 同上 × schema `/global/upgrade`
   - 症状: ブラウザから OpenCode 本体の upgrade を起動できる（バージョン指定可）
   - 根拠: dispose と同根の denylist 漏れ
   - 再現: `POST /api/opencode/global/upgrade` → 403 にならず upstream 到達

### 確認して新規なし／据え置き
- Pty は意図的スタブ、quickaccess Links 空は R33 付記、AddonHost 単純、SSE silence 監視あり
- R1–R37 未修正。ループ継続

---

## 2026-07-23 バグ発見ループ R37（発見のみ・未修正）

### ループ
- tick #2（PID 23500 / shell 550353）。R1–R36 重複除外。merge into=current／devcontainer／addons 等を確認

### 確度の高い新規バグ

1. **P2 / `into=current` マージコンフリクト後に中止手段がなく Diff も古いまま** — `api/git/merge/route.ts:143-150` × `DiffPane.tsx:293-310,547-549`
   - 症状: 「取り込む」でコンフリクトすると `MERGE_HEAD` 付きのまま残る。API に abort なし、UI にも中止なし。失敗時 `load()` されないため差分は空のまま・Merge 再押下可・Commit は無効のまま詰まりうる
   - 根拠: `into=branch` だけ `--abort`＋復帰（既修正）。`into=current` は 409 返却のみ。`run()` は成功時だけ `load()`
   - 再現: 衝突する2ブランチで Diff → Merge → 「取り込む」→ エラー後に更新せず操作を続ける

### 確認して新規なし
- devcontainer は host-fallback の意図的スタブ、health／opencode-id／addons は既知か確度不足

### 据え置き
- R1–R36 全件未修正。ループ継続中

---

## 2026-07-23 バグ発見ループ R36（発見のみ・未修正）

### ループ
- `/loop 2m 再開`。旧 PID 26536 死亡を確認後、新ループ PID **23500** / shell **550353** をアーム。即時1回＋2分間隔
- R1–R35 重複除外。OpenCode 再起動／Attention フルアクセス／Pty・SSE 等を確認

### 確度の高い新規バグ

1. **P1 / OpenCode 異常 exit 後に自動再起動しない** — `host/src/index.js:496-514` vs WebUI `scheduleWebRestart`（779–824）
   - 症状: OpenCode が落ちるとトレイは stopped、プロンプト等は全滅。ホスト再起動／手動「OpenCode を再起動」まで復帰しない（R35#2 Caddy と同型・対象はコアエンジン）
   - 根拠: exit は null＋reap＋メニューのみ。`restartOpencode()` は手動経路のみ
   - 再現: host 起動後 `taskkill /F /PID <opencode>`（host は残す）→ `:4096` が自動で戻らない

2. **P2 / Attention モーダルの「フルアクセス」が残キューを自動承認しない** — `AttentionQueueModal.tsx:217` × `TaskView.tsx:539-569`
   - 症状: グローバル注意モーダルで「フルアクセス」を選んでも、現在件の once 応答＋`localStorage` 更新だけ。同モーダル内の残り権限は手承認のまま
   - 根拠: 自動承認 effect は TaskView の stream のみ。モーダル／他セッション分は未配線。文言の「すべて自動承認」と不一致（既知 P3「文言 vs グローバル」とは別の動作欠陥）
   - 再現: Home 等で注意モーダルに権限が2件以上 → オプション「フルアクセス」→ 1件目は消えるが2件目以降が残る

### 確認して新規なし
- Pty／CommandPalette Esc（R8#3）／access-mode・default-model 文言／orphans／SSE（R9）／credits（R15#4）

### 据え置き
- R1–R35 全件未修正。ループは PID 23500 で継続中

---

## 2026-07-23 バグ発見ループ R35（発見のみ・未修正）

### ループ
- `/loop 2m 引き続きバグハント実施`。既存 tick ループ（PID 26536 / shell 33084）を再利用。即時1回＋以降2分間隔継続
- R1–R34・優先度表との重複を除外。host Caddy／git isInside／DiffPane／slash／lock を重点

### 確度の高い新規バグ

1. **P0 / `removeWorktree` の `isInside` がパス一致を許可し、repo 本体・worktrees 根を再帰削除しうる** — `web/src/lib/git.ts:110-113,164-168,201-204` × `project-session-sync.ts:84-87,114-122` × `workspace-service.ts:212-218`
   - 症状: 細工 `sessions.json` の `git_worktree` + `worktreePath`（プロジェクト根、または `%APPDATA%/opencode-webui/worktrees`）を restore → タスク削除でリポジトリ全体／全 worktree が `fs.rmSync(recursive, force)` される
   - 根拠: 「root **外**拒否」対策の穴。`copy.ts:44` は `!rel` で根一致を拒否するが、こちらは `rel===""` を inside 扱い。restore も同判定でスキップしない。過去の「任意パス削除」修正の残余
   - 再現: manifest に `isolation:"git_worktree"`, `worktreePath:<projectRoot>` → restore → 当該 WS 削除

2. **P2 / Caddy 異常終了後に自動再起動しない** — `host/src/index.js:595-601` vs WebUI `scheduleWebRestart`（797–820）／tray 再生成
   - 症状: `OPENCODE_WEBUI_CADDY=1` で Caddy が落ちるとトレイは `Caddy: stopped`、HTTPS/LAN 入口が死んだまま。ホスト再起動まで復帰しない
   - 根拠: exit で `caddyProc=null` とメニュー更新のみ。孤児化修正 `stopStrayCaddy` とは別件
   - 再現: Caddy 有効で host 起動 → `taskkill /F /IM caddy.exe`（host は残す）→ `:8443` が自動復帰しない

3. **P2 / DiffPane が「現在＝defaultTarget」でも自己マージ先を保持** — `DiffPane.tsx:243,529-561` × `api/git/branches/route.ts:42-46`
   - 症状: HEAD が `main`（ローカルに `main` あり）だと `mergeTarget` が `main`。選択肢からは `current` 除外なのに value は自己参照。マージ／PR ボタンが有効（自己マージ／同一 base）
   - 根拠: `defaultTarget` は current 除外なし。`disabled={!mergeTarget}` は自己参照でも true。R33 は HomeView worktree base 用で別面
   - 再現: タスク diff のマージパネルで HEAD=`main` → セレクトは空相当だがボタン活性 → 「取り込む／反映」

4. **P2 / slash 送信がコマンド一覧未取得・失敗時に通常プロンプトへ落ちる** — `TaskView.tsx:933-938` × `useSlashCommands.ts:11-34` × `slash-command.ts:86-100`
   - 症状: `/init` 等を送っても `session.command` にならず普通の prompt 扱い。サジェストも出ない／消える
   - 根拠: 送信分岐も同一 `slashCommands` 配列依存。Home 新規作成はサーバ側再取得（`tasks/route.ts`）で回避されるが TaskView 再送はクライアント依存
   - 再現: Task を開いて `/command` 応答前に既知コマンド送信、または `/api/opencode/command` を失敗させてから `/init` 送信

5. **P2 / host lock が CreationDate 失敗時に緩い cmdline で誤認→taskkill しうる** — `host/src/index.js:211-215,922-940,964-972`
   - 症状: ロック PID が別の `node …/src/index.js`（トレイ無し）だと、新 host 起動が「劣化ホスト引き継ぎ」で無関係プロセスを `taskkill /F` する
   - 根拠: 現代ロックは created 一致で安全だが、WMI 失敗時は `node` + `src/index.js` だけ。host 専用パス検証なし
   - 再現: created 照会が失敗する状況で、ロック PID を別プロジェクトの `node …/src/index.js`（tray 無し）に見立てて二重起動

### 確認して昇格しなかったもの
- SoftNav（`key={projectId}` で主要ケース抑止）、middleware 欠如の広義 LAN 無認証（browse/write 漏れは既存 ID に包含）、visualViewport、AddonSettings 永続黙殺（P3）

### 据え置き
- R1–R34 全件未修正。ループは PID 26536 で継続中

---

## 2026-07-23 発見バグの3段階優先度（R1–R54 統合）

判定基準: **高**＝セキュリティ／データ破壊／コア導線が壊れる・初回セットアップ不能。**中**＝実害あるが回避可・頻度限定。**低**＝文言／仕様ギャップ／レア edge／既に別件に包含。

### 高（すぐ直す）

| ID | 内容 |
|----|------|
| R35#1 | `removeWorktree`/`restore` の `isInside` が根一致を許可 → repo／worktrees 根の再帰削除（P0） |
| R43#1 | `POST /api/projects`・`/api/roots` が任意パスを無検証で allowlist 拡張 |
| R52#1 | `GET /provider` が maskSecrets されず key 平文（directory 不要・UI 常用） |
| R49#1 | `GET /config/providers` が maskSecrets されず `providers[].key` が平文（実機確認） |
| R48#1 | `GET /global/config` が maskSecrets されず秘密が平文で返りうる |
| R50#1 | GUI 起動が headless ホストを劣化と誤認して taskkill する |
| R46#1 | タイトル再生成が `tools: {}` でツール無効化になっていない（実行しうる） |
| R40#1 | PTY create/update/delete/connect-token の write ブロック漏れ（リモートシェル相当） |
| R38#1 | `POST /global/dispose`・`/instance/dispose` の write ブロック漏れ（エンジン落とせる） |
| R39#1 | `POST /vcs/apply` の write ブロック漏れ（任意パッチ適用） |
| R36#1 | OpenCode 異常 exit 後に自動再起動なし（エンジン全滅・手動／ホスト再起動まで） |
| R27 | experimental worktree/workspace 書き込みブロック漏れ（git 破壊） |
| R26 / R32#2 / R7#7 | move-session・console/switch・MCP OAuth DELETE の write ブロック漏れ（セットで `isBlockedOpencodeWrite` 強化） |
| R16 / R14 / R8#2 | `initialCollapsed={!isMd}` — isMd 初期 false でデスクトップ恒久最小化（master 投入済み） |
| R31 / R32#1 | `setup.bat` が start-webui 常駐で完了しない＋成功判定欠如 |
| R15#1–2 / R12#1 / R23 | temporary_copy 復元 403・copies クロス削除・失敗時残骸／path ガード |
| R19 / R30 | purgeGone allowlist 未解放＋roots 削除手段なし |
| R13#1 / R7#1–2 / R5#2 | Attention busy 固着・部分同期で pending 消失・404 を回答済み扱い |
| R11#1 | `timedFetch` ボディ無制限ハング |
| R6#1 | 画像 capability fail-open |
| R7#4 | SW が非 OK をキャッシュ |
| R3#2–5 | 再起動ポール早期成功／60回失敗でも成功／OpenCode 1.5s／health が opencode.ok 無視 |
| R1#3–4 | composer が iOS 16px 対策を無効化・touchActivity が送信を最大30s ブロック |
| R2#1 | SessionSwitcher controlled snap-back |
| R7#3 / R13#2 | NestedAgent 空 TL・PartView error 隠蔽 |

### 中（次に直す）

| ID | 内容 |
|----|------|
| R20 / R6#2 | FileTree「上へ」root 超え＋browse/dirs 任意列挙 |
| R18 | `children.length===1` 誤マッチ |
| R21 / R11#2–3 | GraphPanel directory stale／スピナー・エラー残留 |
| R17 | abort 直後再送信が idle に潰される・削除409で画面残留 |
| R24 | エージェント選択時 intelligence が手動モデル基準 |
| R9#1 | SSE 再接続中 stale idle ガード無効 |
| R3#1 / R4#2 | kebab z-index／busy 中も削除可 |
| R1#1–2 | E2E 文字化け・巻き戻し E2E 乖離 |
| R28 | 画像サイズ・枚数上限なし |
| R29 / R10#1 | favorite が last_opened を汚す／トグル失敗無言 |
| R33 | worktree defaultTarget が upstream 無視 |
| R22 | bindSession unsafe id 黙殺 |
| R16#2 / R14#2 | orphan 掃除クロス削除・削除409画面残留 |
| R12#2 | archived→「マージ済」ズレ |
| R7#5–6 | DiffPane archive 黙殺・diff/files 200+git:false |
| R9#2–3 | 為替 clamp UI ズレ・AddProject パス上書き |
| R5#1 / R4#1 | Attention フォーカス破壊・SessionSwitcher 並び遅延 |
| R25 | compact 失敗でも「巻き戻し失敗」 |
| R15#4 | CodexBar 空 credits を last-good 扱い |
| R13#3 | 死んだ systray へ更新継続 |
| R2#2 | 再起動二重 202 no-op |
| R3#6–7 | isMd 初期 false の一瞬寄せ・グローバル16px デスクトップ副作用 |
| R35#2 | Caddy 異常 exit 後に自動再起動なし（HTTPS/LAN 入口が死んだまま） |
| R35#3 | DiffPane 自己マージ先（current＝defaultTarget） |
| R35#4 | slash 未取得／失敗時に command が通常 prompt へ落ちる |
| R35#5 | host lock CreationDate 失敗時の緩い cmdline 誤認→taskkill |
| R36#2 | Attention モーダル「フルアクセス」が残キューを自動承認しない |
| R37#1 | `into=current` コンフリクト後に abort なし・DiffPane 未再読込 |
| R38#2 | `POST /global/upgrade` の write ブロック漏れ |
| R39#2–4 | `sync/steal`・`workspace/warp`・`project/git/init` の write ブロック漏れ |
| R40#2 | `session/{id}/share` POST/DELETE の write ブロック漏れ |
| R41#1–4 | `PATCH /project/{id}`・`DELETE workspace/{id}`・`session/background`・`/tui/*` のブロック漏れ |
| R42#1 | `/api/access` が Caddy HTTPS を無視して常に http://NIC:3000 |
| R44#1 | temporary_copy が外向き symlink を保持し隔離を破れる |
| R45#1 | `invalidateDirStat` 未使用でコミット後も差分統計が最大15s古い |
| R46#2 | temporary_copy の SKIP に `.opencode-webui` 欠落 |
| R47#1 | `runGit`/`runGh` にタイムアウトなし（BFF 無期限ハング） |
| R49#2 | `writeCostDisplayPrefs(Partial)` が非マージで auto→manual 等を破壊しうる |
| R49#3 | `files/search` の同期フルツリー走査で BFF イベントループ塞ぎ |
| R50#2 | `DELETE …/permission/saved/{id}` の write ブロック漏れ |
| R51#1–2 | 音声 `resultIndex` 無視で文言重複＋録音セッション跨ぎで transcript 残存 |
| R53#1–2 | restart-all が reuse WebUI を殺さない＋`stopChildren` が `waitForPortFree` しない |
| R54#1 | 死んだ `POST /api/browse/folder` が無 timeout で BFF を塞ぎうる |

### 低（後でよい）

| ID | 内容 |
|----|------|
| R15#3 | difftint `&#39;` 誤認 |
| R16#3 | PartView error 折りたたみプレビュー無し |
| R8#3 | CommandPalette Esc 常時グローバル |
| R10#2–3 | 音声／セットアップ「仕様のみ」（後者は R31 で実装済み・残は R31/32） |
| R8#1（旧） | プラン未配線 — R16 投入で上書き済み |
| R33 付記 | resolveLnkTargets 常に `[]` |
| — | access-mode「このセッション」文言 vs グローバル、default-model コメントズレ 等 P3 |

### 使い方
- 修正エージェントは **高** から。同一ファイルの write ブロック（高1行目）とプラン isMd（高2行目）は並列可。
- 中は高の PR と衝突しやすい UI（TaskView／Attention／Session）を避けてから。

---

## 2026-07-23 バグ発見ループ R34（発見のみ・未修正）／修正優先トリアージ

### ループ
- tick #36–37。新規の薄い面は収束気味。修正エージェント向けに R1–R33 の優先順を整理（コード変更なし）

### 修正優先（推奨順）

1. **P1 セキュリティ／書き込み面**: R27 experimental worktree/workspace、R26 move-session、R7 MCP DELETE、R32 console/switch — `isBlockedOpencodeWrite` 一括強化
2. **P1 デスクトップ UX**: R16/R14 `initialCollapsed={!isMd}`（isMd 初期 false 合成）
3. **P1 セットアップ**: R31 `setup.bat` が start-webui 常駐で完了しない（＋R32 成功判定）
4. **P1 データ／権限**: R15 temporary_copy allowlist 復元、R19 purgeGone allowlist、R30 roots 削除 API
5. **P1 Attention／送信**: R13 busy 固着、R7/R5 部分同期、R11 timedFetch、R17 abort resync
6. **P2 UI／ナビ**: R20 FileTree 上へ、R18 children===1、R21 GraphPanel stale、R24 agent+intelligence、R29 favorite→last_opened、R33 branches defaultTarget

### 本 tick の新規コードバグ
- 確度の高い新規はなし（トリアージのみ）

### 据え置き
- R1–R33 全件未修正。ループは継続中

---

## 2026-07-23 バグ発見ループ R33（発見のみ・未修正）

### ループ
- tick #35。git/branches defaultTarget／quickaccess フォールバックを確認。R1–R32 重複除外

### 確度の高い新規バグ

1. **P2 / worktree 基準ブランチ候補が upstream を無視して main/master 固定寄り** — `api/git/branches/route.ts:40-46` × `HomeView.tsx` baseBranch 初期化
   - 症状: ローカルに古い `main` が残る develop 中心リポジトリで、worktree の base が `main` になり、意図しない分岐点から worktree が切られる
   - 根拠: `defaultTarget` は `main`→`master`→「current 以外の先頭」のみ。`upstream`（`@{u}`）はレスポンスに含めるが defaultTarget に使わない
   - 再現: HEAD=develop、upstream=origin/develop、ローカル main あり → API の defaultTarget が main

### 確認して低優先
- `resolveLnkTargets` は常に `[]`（PS 失敗時 Links が空になるだけ・Jumplist は残る）→ P3

### 据え置き
- R1–R32 全件未修正

---

## 2026-07-23 バグ発見ループ R32（発見のみ・未修正）

### ループ
- tick #33–34。setup.bat 成功判定／experimental console switch を確認。R1–R31 重複除外

### 確度の高い新規バグ

1. **P2 / `setup.bat` がホスト起動結果を無視して success に進む** — `setup.bat:16-17` × `:start_host`（134–136）
   - 症状: R31 の常駐ハングを `start` 等で直しても、`call :start_host` の後が無条件 `goto :success`。host が即失敗／既起動エラーでも「Setup completed」になる
   - 根拠: 他ステップは `if errorlevel 1 goto :failure` だが start_host だけ未チェック。ヘルス確認も無し

2. **P2 / `POST /experimental/console/switch` が write ブロック漏れ** — schema × `isBlockedOpencodeWrite`（R26/R27 同系）
   - 症状: Console org 切替 POST がプロキシ経由で通る。アカウント境界の副作用がありうる

### 据え置き
- R1–R31 全件未修正（R31 setup ハングはセットアップ系の最優先）

---

## 2026-07-23 バグ発見ループ R31（発見のみ・未修正）

### ループ
- tick #32。新規コミット `dec70bc`（`setup.bat`）をレビュー。R1–R30 重複除外

### 確度の高い新規バグ

1. **P1 / `setup.bat` が `start-webui.bat` を `call` するため完了メッセージに到達しない** — `setup.bat:134-136` × `start-webui.bat:54`（`node src\index.js` 常駐）
   - 症状: セットアップ成功後もコンソールがホスト終了までブロック。「Setup completed」や `pause_if_interactive` に進まない。ユーザーはハングしたように見える。テストは start-webui を即 exit するモックのため検知漏れ
   - 根拠: `:start_host` が `call start-webui.bat`。本番 start-webui はトレイ host をフォアグラウンド実行
   - 再現: 実環境で `setup.bat` を最後まで走らせる → npm 成功後に窓が戻りず、完了 echo が出ない

### 据え置き
- R1–R30 全件未修正

---

## 2026-07-23 バグ発見ループ R30（発見のみ・未修正）

### ループ
- tick #31。`/api/roots`／Settings 許可ルート UI を確認。R1–R29 重複除外

### 確度の高い新規バグ

1. **P2 / 許可ルート（allowlist）に削除手段がない** — `api/roots/route.ts`（GET/POST のみ）× `SettingsView.tsx`（709–735、追加のみ）
   - 症状: 設定でルートを追加できるが、誤追加・死んだパス・temporary_copy 残骸（R19）を UI／API から外せない。`destroyProject` で「同 root の他プロジェクトがゼロ」のときだけ `removeAllowedRoot` される狭い経路のみ
   - 根拠: DELETE ハンドラなし。リストは表示のみ
   - 再現: 設定で適当なパスを許可 → 一覧に残るが削除ボタンも DELETE API も無い

### 据え置き
- R1–R29 全件未修正

---

## 2026-07-23 バグ発見ループ R29（発見のみ・未修正）

### ループ
- tick #29–30。projects PATCH／upsertProject／Sidebar 並びを確認。R1–R28 重複除外

### 確度の高い新規バグ

1. **P2 / お気に入り・名前変更が `last_opened_at` を更新し並びを乱す** — `db.ts` `upsertProject`（132–142）× `listProjects`（`ORDER BY favorite DESC, last_opened_at DESC`）× `projects/route.ts` PATCH
   - 症状: サイドバーで ★ トグルやリネームするだけで「最近開いた」扱いとなり、同お気に入り帯内のプロジェクト順がトップへ飛ぶ。実際にはプロジェクトを開いていない
   - 根拠: UPDATE が常に `last_opened_at = now`。`touchProjectOpened` とは別経路なのに同じカラムを汚す。R10 favorite 無言失敗とは別件
   - 再現: 下位のプロジェクトをお気に入り ON/OFF → 一覧が上へ移動する

### 据え置き
- R1–R28 全件未修正

---

## 2026-07-23 バグ発見ループ R28（発見のみ・未修正）

### ループ
- tick #28。画像添付クライアント／`parseImageFiles` を確認。R1–R27 重複除外

### 確度の高い新規バグ

1. **P2 / 画像添付にサイズ・枚数上限がない** — `TaskView.tsx` `addImageFiles`（1007–1021）／`HomeView.tsx`（454–471）／`tasks/route.ts` `parseImageFiles`（26–48）
   - 症状: 巨大画像や多数枚を data URL 化して BFF→OpenCode に載せられる。ブラウザメモリ逼迫、リクエストボディ肥大、エンジン／プロキシのタイムアウトや OOM につながりうる。MIME／data URL 形の検証はあるが byte 上限なし
   - 根拠: FileReader 全量読込、サーバは base64 長さの倍数チェックのみ
   - 再現: 数十MBの PNG を複数添付して送信を試みる

### 据え置き
- R1–R27 全件未修正（特に R27 experimental write・R16 isMd 合成は優先度高）

---

## 2026-07-23 バグ発見ループ R27（発見のみ・未修正）

### ループ
- tick #26–27。experimental OpenAPI 書き込み面を R26 の続きで点検。R1–R26 重複除外

### 確度の高い新規バグ

1. **P1 / experimental worktree／workspace 書き込みがブロック漏れ** — `opencode.ts` `isBlockedOpencodeWrite` × schema `/experimental/worktree`（POST/DELETE）・`/experimental/worktree/reset`（POST）・`/experimental/workspace`（POST）等
   - 症状: WebUI プロキシ経由で OpenCode のサンドボックス worktree 作成・削除・reset、workspace 作成が可能。WebUI 自身は `git.ts` で worktree を管理しているのに、並行してエンジン側 API が unrestricted。R26 の move-session と同根で、影響面は git ツリー破壊のため一段重い
   - 根拠: ブロックは config/auth/mcp のみ。`/experimental/**` の mutating メソッドは未列挙
   - 再現: 許可 directory 付きで `POST /api/opencode/experimental/worktree` → 403 にならず upstream で worktree 作成しうる

### 関連
- R26 move-session、R7 MCP DELETE とセットで `isBlockedOpencodeWrite` を allowlist／denylist 再設計すべき

### 据え置き
- R1–R26 全件未修正

---

## 2026-07-23 バグ発見ループ R26（発見のみ・未修正）

### ループ
- tick #25。`isBlockedOpencodeWrite`／OpenAPI 危険 POST／SessionActions 周辺を確認。R1–R25 重複除外

### 確度の高い新規バグ

1. **P2 / `POST /experimental/control-plane/move-session` が write ブロック漏れ** — `opencode.ts` `isBlockedOpencodeWrite`（4–24）× schema `paths["/experimental/control-plane/move-session"]`
   - 症状: WebUI BFF／`ocServer` 経由でセッションを別プロジェクト directory へ移動できる。config/auth/mcp 書き込みは遮断しているが、この実験的 control-plane POST は未登録。LAN 公開時は認証なしで呼びうる（R7 MCP DELETE と同系）
   - 根拠: ブロック対象は PATCH config・PUT/DELETE auth・POST mcp のみ。UI は未使用だがプロキシは通す
   - 再現: 許可済み directory 付きで `POST /api/opencode/experimental/control-plane/move-session` に移動ボディを送る → 403 にならず upstream へ到達

### 確認して新規なし
- PATCH `/config` はブロック済み
- provider OAuth POST はログイン用途の可能性（R18 どおり未昇格）

### 据え置き
- R1–R25 全件未修正。オープンバグ多数のため修正エージェント投入が有効な段階

---

## 2026-07-23 バグ発見ループ R25（発見のみ・未修正）

### ループ
- tick #23–24。SessionActions／health／default-model／MessageMetaHeader を確認。R1–R24 重複除外

### 確度の高い新規バグ

1. **P2 / compact 失敗時も「巻き戻し失敗」アラート** — `SessionActions.tsx` `run`（81–94）
   - 症状: コンテキスト圧縮（compact）や unrevert が失敗しても `window.alert("巻き戻し失敗: …")` と出る。操作と無関係な文言で原因が分かりにくい
   - 根拠: `compact` / `revert` / `unrevert` が共通 `run` の catch に入っており、メッセージが revert 固定
   - 再現: エンジン停止中にヘッダの compact を押す → 「巻き戻し失敗」と表示される

### 確認して新規なし
- `/api/health` の opencode.ok 無視は R3 済み
- MessageMetaHeader のゼロ cost 非表示は妥当
- default-model のコメントと優先順位の文言ズレは P3 相当で未昇格

### 据え置き
- R1–R24 全件未修正

---

## 2026-07-23 バグ発見ループ R24（発見のみ・未修正）

### ループ
- tick #21–22。model-variants／IntelligenceSelect／agent 併用／PartView を確認。R1–R23 重複除外

### 確度の高い新規バグ

1. **P2 / エージェント選択時もインテリジェンスが手動モデル基準＋variant が併送される** — `TaskView.tsx` `intelligenceVariants`（1074–1079）× `send` opts（927–931）／`HomeView.tsx` 同型（495–499, 430）
   - 症状: エージェント（独自 model）を選んでも IntelligenceSelect は手動モデルの `variants` を表示。送信時は `agent` + 手動 `model` + `variant` を同時に渡すため、実効モデルが対応しない effort（例: agent は variants 無し、UI は xhigh）が付く／無視・エラーの不定挙動
   - 根拠: `intelligenceVariants` は `providerModelsMap[model]` のみ。画像ガードは `agentModels[agent]` 優先なのに variant 側は未連動。agent `onChange` で `setIntelligence("")` もしない
   - 再現: variants 付きモデルを選び xhigh → build 等エージェントに切替 → セレクタが残ったまま送信 → payload に agent と variant が同居

### 確認して新規なし
- model-variants の disabled／未知キー無視は単体テスト済み
- PartView error プレビュー欠落は R13/R16 済み

### 据え置き
- R1–R23 全件未修正

---

## 2026-07-23 バグ発見ループ R23（発見のみ・未修正）

### ループ
- tick #19–20。access-mode／notify／favicon／copy.ts／provisionWorkspace／AddonHost を確認。R1–R22 重複除外

### 確度の高い新規バグ

1. **P2 / `temporary_copy` 失敗時に部分コピー＋allowlist が残る** — `copy.ts` `createTemporaryCopy`（25–37）× `workspace-service.ts` provision（143–153）
   - 症状: `fs.cpSync` 途中失敗や、コピー成功後の `createWorkspace`／後続エラーで、`%APPDATA%/…/copies/<id>` や `allowed_roots` エントリがロールバックされず残骸化。設定の orphan scan も temporary_copy の allowlist 解放漏れ（R19）と組み合わさると汚染が残る
   - 根拠: `createTemporaryCopy` は `mkdir` 後に `cpSync`、失敗時クリーンアップなし。provision の catch も `removeTemporaryCopy` / `removeAllowedRoot` を呼ばない。`POST /api/tasks` の rollback は `workspace` 代入後のみ
   - 再現: 巨大リポジトリでコピー中にディスク満杯／権限エラー → API 500 だが `copies/` に半端なディレクトリが残る

### 確認して新規なし / 低優先
- access-mode の「このセッション」文言 vs グローバル localStorage は仕様メモ上グローバル永続が意図。コピー不一致は P3 相当で未昇格
- notify／favicon-badge の遷移判定は妥当
- AddonHost の settings 非表示はテスト済み

### 据え置き
- R1–R22 全件未修正

---

## 2026-07-23 バグ発見ループ R22（発見のみ・未修正）

### ループ
- tick #17–18。session bind／SessionSwitcher／SSE session フィルタ／git commit／CodexBar を確認。R1–R21 重複除外

### 確度の高い新規バグ

1. **P2 / `bindSession` が unsafe id を黙って握りつぶす** — `db.ts:210-220` × `project-session-sync.ts` restore
   - 症状: manifest 復元や内部呼び出しで不正な `opencodeSessionId` が来ると `console.warn` のみで return。呼び出し側（特に restore）は成功扱いになり、ワークスペースは戻るが session が紐づかない／古い binding のまま
   - 根拠: API `workspaces/.../sessions` POST は事前に `assertSafeOpenCodeSessionId` するが、`bindSession` 自体と `project-session-sync` の restore 経路は失敗を伝播しない。R12 の細工 manifest と組み合わさると「復元成功・セッション無し」になる
   - 再現: sessions.json に `opencodeSessionId: "../x"` 等を入れて restore → DB に binding が増えないがエラーも出ない

### 確認して新規なし
- useSessionStream SSE は sessionID で厳密フィルタ
- git/commit の pathspec 限定・exclude は実装済み
- SessionSwitcher 切替後の stream scopeKey reset は妥当
- CodexBar empty credits は R12 済み

### 状況
- 未修正バックログが R1–R21 に厚い。本 tick 以降は新規 P0/P1 が減り、残余は P2 の穴埋めが中心

### 据え置き
- R1–R21 全件未修正

---

## 2026-07-23 バグ発見ループ R21（発見のみ・未修正）

### ループ
- tick #15–16 相当。GraphPanel／PtyPanel／files/content／AgentsSettings／PlanDocumentCard を確認。R1–R20 重複除外

### 確度の高い新規バグ

1. **P2 / GraphPanel が directory 切替後に古い `/api/git/log` 結果で上書きしうる** — `GraphPanel.tsx` `load`（160–201）× directory effect（213–220）
   - 症状: タスク／ワークスペースを素早く切り替えると、先に完了した遅いレスポンスが新しい directory のグラフを旧リポジトリのコミットで汚す（または逆に空→一瞬旧データ）
   - 根拠: `getJson` 後の `setPayload` にシーケンス／Abort／directory 一致チェックなし。`load` は `directory` クロージャ依存だが進行中の旧呼び出しはキャンセルされない。PtyPanel（`PtyPanel.tsx:12-37`）も同型
   - 再現: 大きいリポジトリのグラフ表示中に別タスクへ連続遷移 → ログが別 repo のものになることがある

### 確認して新規なし / 低優先
- `/api/files/content` は allowlist + `.md` + realpath ガード済み
- AgentsSettings: スキーマ上 `/agent` は裸配列（envelope 未使用想定）
- PlanDocumentCard の `initialCollapsed` 一回限りは R14/R16 済み

### 据え置き
- R1–R20 全件未修正

---

## 2026-07-23 バグ発見ループ R20（発見のみ・未修正）

### ループ
- tick #14。FileTreePanel／host control／access／remote／AgentsSettings／git/pr を確認。R1–R19 重複除外

### 確度の高い新規バグ

1. **P2 / FileTreePanel「上へ」が workspace `root` を超えてナビできる** — `FileTreePanel.tsx:48-51`
   - 症状: タスクのファイルタブで「上へ」を押すと `cwd` がプロジェクト外（親フォルダ・ホーム等）へ進み、R6 の allowlist なし `browse/dirs` 経由でホスト任意ディレクトリを UI から辿れる
   - 根拠: `up` は `cwd.replace(/[\\/][^\\/]+$/, "")` のみで、props の `root` との包含チェックなし。API が返す `parent` も未使用
   - 再現: タスク → ファイルタブ →「上へ」連打 → リポジトリ外の一覧が表示される

### 確認して新規なし
- host control-server は 127.0.0.1 bind（意図どおり）
- `/api/remote` は 501 プレースホルダ
- `/api/access` は NIC 列挙のみ
- AgentsSettings は読取専用表示
- workspaces PATCH status バリデーションは実装済み（過去メモの懸念は解消済み）

### 据え置き
- R1–R19 全件未修正（特に R6 browse/dirs と本件はセットで修正すべき）

---

## 2026-07-23 バグ発見ループ R19（発見のみ・未修正）

### ループ
- tick #13。orphans scan／allowlist／PermissionCard／CommandPalette を確認。R1–R18 重複除外

### 確度の高い新規バグ

1. **P2 / `purgeGoneOrphans` が temporary_copy の allowlist を解放しない** — `orphans/route.ts` `purgeGoneOrphans`（72–113）vs POST cleanup（309–312）vs `destroyWorkspace`（253–255）
   - 症状: 設定画面の `GET /api/workspaces/orphans?scan=1`（`SettingsView.refresh`）や `POST {action:"scan"}` で、フォルダ消失済みの temporary_copy orphan を DB から消しても `allowed_roots` に死んだパスが残る。手動 cleanup POST では `removeAllowedRoot` 済みだが scan/purge 経路だけ漏れ
   - 根拠: `purgeGoneOrphans` は `deleteWorkspace` + `persistProjectSessions` のみ。POST 一括掃除コメントは「destroyWorkspace と対称」と明記しているが scan 側未追従
   - 再現: temporary_copy を orphan 化→パス削除→設定を開く（scan=1）→ DB 行は消えるが `GET /api/roots` に旧パスが残る

### 確認して新規なし / 低優先
- PermissionCard: patterns の `key={p}` 重複はレア；成功後 busy 固着は R13（親キュー）と同系
- CommandPalette ファイル検索・Escape は妥当
- GET scan 自体の副作用（設定オープンで mark/purge）は設計として意図的だが、上記 allowlist 漏れと組み合わさると静かに汚染が進む

### 据え置き
- R1–R18 全件未修正

---

## 2026-07-23 バグ発見ループ R18（発見のみ・未修正）

### ループ
- tick #12。match-child-session／QuestionCard／oauth ブロック／cost 表示を薄い確認。R1–R17 重複除外

### 確度の高い新規バグ

1. **P2 / 並行サブエージェントで `children.length === 1` が誤マッチ** — `match-child-session.ts:113`
   - 症状: 複数 task 子のうち片方が一覧から消える（完了・離脱）と、残った1件が sticky/metadata/title なしでも採用され、別ツール呼び出しの NestedAgentPanel に誤セッションが貼り付く
   - 根拠: sibling-index フォールバックは削除済みだが、「唯一の子」フォールバックは残存。R7 要調査をコード確認で昇格

### 確認して新規なし
- QuestionCard: Enter 送信は `buildAnswers()` が `customs` を含むため custom 単問は妥当
- cost Sidebar: `(task.cost ?? 0) > 0` ガードあり
- provider OAuth POST はブロック外（ログイン用途の可能性・意図確認待ちのため未昇格）。MCP DELETE 漏れは R7 済み

### 状況
- オープンバグは R1–R17 に多数残存（修正は別エージェント想定）。本 tick の新規 P0/P1 はなし

### 据え置き
- R1–R17 全件未修正

---

## 2026-07-23 バグ発見ループ R17（発見のみ・未修正）

### ループ
- [R14バグ発見調査](fc734985-5652-4d7a-95c0-6fbd6a4321aa) を統合

### 確度の高い新規バグ

1. **P2 / abort 直後の再送信が trailing resync で idle に潰されうる** — `useSessionStream.ts` `abort`（1285–1305）× `resolveResyncStatus` pending 分岐（77–82）× `sendPrompt`
   - 症状: Stop → すぐ再送信すると、abort 完了後の `preferRest` resync が遅延 REST idle を適用し `pendingMutation` クリア＋optimistic busy を idle に戻す窓がある（二重送信／メッセージ初期化レース）
   - 根拠: abort は即 idle 解錠。finally の resync に世代ガードなし。pending 中は REST idle でも `apply+clearPending`。R9（再接続中 stale idle）とはトリガ別

2. **P2 / TaskView 削除失敗でも画面残留＋セッション先行削除** — `TaskView.tsx` `removeTask`（1136–1138）+ `destroyWorkspace`（206→230–234）
   - 症状: 409 orphaned 時 TaskView は `setSendError` のみで `/` へ遷移しない。先に `deleteBoundOpenCodeSessions` 済みなのでエンジン session は消え、DB は orphaned、Sidebar 一覧から除外 → 「死んだ」タスク画面だけ残る
   - 根拠: R14 #2（Sidebar）の TaskView 側・サーバ順序を補強。成功時のみ `router.push("/")`

### 据え置き
- R1–R16 全件未修正（R14 Sidebar 409・R16 プラン isMd 等）

---

## 2026-07-23 バグ発見ループ R16（発見のみ・未修正）

### ループ
- tick #11。コミット `1e044ba`（スマホでプランを初期最小化）を R14 予測と突合。orphans / HomeView branch / PartView preview を薄い確認

### 確度の高い新規バグ

1. **P1 / `1e044ba` が R14 の isMd 合成欠陥を master に投入** — `TaskView.tsx:1884` `initialCollapsed={!isMd}` + `PlanDocumentCard` `useState(initialCollapsed)`
   - 症状: TaskView マウント直後（`isMd` 初期 false）にプランカードが載ると `collapsed=true` で固定。matchMedia 後に desktop でも開かない／チラつき後に閉じたまま、という経路がありうる
   - 根拠: R14 #1 の未コミット差分がそのまま `1e044ba` でマージ。テストは `planCardProps` の最終 props のみ（vitest 2件 PASS）で `aria-expanded` 未検証 → 緑でも内部 state 欠陥を見逃す
   - 更新: R8 #1「未配線」は配線済みに更新。ただし製品要件（desktop 初期展開）は未達リスクあり

2. **P2 / orphan 掃除も copies 内クロス削除しうる** — `api/workspaces/orphans/route.ts:293-297`
   - 症状: 設定の orphan 掃除が `removeTemporaryCopy(row.worktree_path)` を呼ぶ。R15 #2 の細工 path が orphan 行にあれば他コピーを消せる
   - 根拠: R15 と同じ delete ヘルパー。掃除 UI が攻撃面を増やす

3. **P2 / PartView: error ツールは折りたたみ時プレビュー無し** — `PartView.tsx:224-231`
   - 症状: 失敗ツールを畳むと危険枠のみで、失敗理由プレビューが無い（展開しても R13 #2 で output 優先なら理由が隠れる）
   - 根拠: `preview` は `status === "completed"` のみ。R13 要調査を昇格

### 確認して新規なし
- HomeView ブランチ取得は `cancelled` ガードあり
- abort は pendingMutation 即解除＋preferRest（R9 stale idle 以外の新規なし）

### 据え置き
- R1–R15 全件未修正

---

## 2026-07-23 バグ発見ループ R15（発見のみ・未修正）

### ループ
- [R12バグ発見調査](9f5fb73f-97d8-46ba-adf3-118d325c96d0) を統合。R12 の temporary_copy 記述を強化

### 確度の高い新規バグ

1. **P1 / `temporary_copy` 復元で allowlist 再登録なし → 403** — `project-session-sync.ts` restore vs `workspace-service.ts:147`
   - 症状: manifest 復元後、一時コピーパス（`<dataDir>/copies/…`）が `assertAllowedDirectory` で 403。OpenCode/git/files 系が使えない
   - 根拠: provision だけ `addAllowedRoot`。暗黙許可は `worktrees` のみで `copies` 非対称

2. **P1 / `temporary_copy` の copies 内クロス削除** — 同上 + `copy.ts` `removeTemporaryCopy`
   - 症状: 細工 `sessions.json` で `worktreePath=<dataDir>/copies/<他UUID>` を import → タスク削除で他ワークスペースのコピーが `rmSync` される
   - 根拠: escape ガードは `git_worktree` のみ。`removeTemporaryCopy` は copies **配下なら削除実行**。R12「copies 外は拒否」は配下クロス削除を見落としていた → **R12 #1 を格上げ・訂正**

3. **P2 / difftint: `&#39;` を `#` コメントと誤認** — `web/src/lib/difftint.ts`
   - 症状: 単引用符を含む TS/JS 行が `const x = &` + faint 化され文字列ハイライトが壊れる（XSS ではない）
   - 根拠: escape 後にコメントパス `/#.*$/` が先。`&#39;…&#39;` の `#` にマッチ。文字列パスは後段

4. **P2 / CodexBar: 空 `credits` でエラーが last-good 扱い** — `addons/codexbar/lib/codexbar.ts` `hasLastGoodUsage`
   - 症状: `error` + `usedPercent:0` でも `credits: {}` があると「健全な 0%」表示に戻る
   - 根拠: `if (p.credits !== null) return true`。任意 object を非 null 化

### 据え置き
- R1–R14 全件未修正（R14 の WIP プラン配線欠陥を含む）

---

## 2026-07-23 バグ発見ループ R14（発見のみ・未修正）

### ループ
- tick #10。未コミットの TaskView プラン配線差分を重点レビュー。Sidebar 削除 409（R13 要調査）を検証

### 確度の高い新規バグ

1. **P1 / WIP: `initialCollapsed={!isMd}` がデスクトップを恒久最小化しうる** — 未コミット `TaskView.tsx`（`PlanDocumentCard` に `initialCollapsed={!isMd}`）
   - 症状: ハードリロード後、デスクトップでもプランが閉じたまま開かない（または初回だけ最小化固定）
   - 根拠: `isMd` 初期 `false`（R3 #6）→ 初回マウントで `initialCollapsed=true`。`PlanDocumentCard` は `useState(initialCollapsed)` のみで props 更新を追従しない（R8 #2 の合成トラップが実装に入った形）。仕様の「768以上は初期展開」に反する
   - テスト欠陥: 追加テストは `planCardProps.at(-1)?.initialCollapsed`（最終 props）のみ検証し、カード内部の `collapsed` / `aria-expanded` を見ていない → デスクトップでも props 最終値は false になり **緑なのに本番は閉じたまま** になりうる
   - 再現: 未コミット差分適用後、1440px でプラン付きタスクをハードリロード

2. **P2 / 削除 409 orphaned 時にアクティブタスク画面へ残留** — `Sidebar.tsx` `removeTask`（351–374）
   - 症状: worktree 削除失敗等で 409/orphaned になると alert＋一覧から orphan 除外されるが、`router.push("/")` は成功時のみ。今見ているタスクが orphan 化しても画面に残る
   - 根拠: catch で `notifyTasksChanged`/`refresh` のみ。R13 要調査を確認して昇格

### 更新
- R8 #1（TaskView 未配線）: 未コミットで配線試行中だが **R14 #1 のため未完了／危険**
- 本ラウンドは発見のみ。未コミット差分はコミットしない

### 据え置き
- R1–R13 全件未修正

---

## 2026-07-23 バグ発見ループ R13（発見のみ・未修正）

### ループ
- tick #9。[R10バグ発見調査](425f8a18-31fa-47f2-bdea-a3e787e2aef8) を統合

### 確度の高い新規バグ

1. **P1 / AttentionQueueModal 非404失敗でカード busy 固着** — `AttentionQueueModal.tsx` `respond`（91–110）↔ `PermissionCard`/`QuestionCard`
   - 症状: ネットワーク等の失敗でモーダル下にエラーは出るが、カードは成功扱いのまま `busy` 解除されずボタン再押下不可（閉じ→開きで復帰）
   - 根拠: `respond` が `setError` のみで **rethrow しない**。カードは成功時 `setBusy(null)` しない（unmount 前提）。TaskView 直付け経路は throw するため別

2. **P1 / PartView が tool error 時に失敗メッセージを隠す** — `PartView.tsx:219` + `useSessionStream` tool merge（151–157）
   - 症状: `status:"error"` でも旧 `output` が残ると error 文字列が UI に出ない（danger 枠に stdout 等が載る）
   - 根拠: `rawOutput = state?.output ?? state?.error`。merge は `output: part ?? prev` で error 更新時も旧 output を保持

3. **P2 / トレイ再生成上限後も死んだ systray へ更新し続ける** — `host/src/index.js` `scheduleTrayRestart` + `refreshStatusMenu`
   - 症状: 上限到達後アイコン無しのまま、5秒ごとに死んだ helper へ `sendAction`（ログノイズ／無意味 IPC）
   - 根拠: 上限時に `systray = null` しない。`systray` 真なら常に update

### 要調査（エージェント）
- Sidebar 削除 409 orphaned 時、失敗しても active タスクをホームへ飛ばさない → 孤立画面残留

### 据え置き
- R1–R12 全件未修正

---

## 2026-07-23 バグ発見ループ R12（発見のみ・未修正）

### ループ
- tick #8。Markdown／allowlist／task-status／manifest restore／host stale を重点。R1–R11 重複除外

### 確度の高い新規バグ

1. **P2 / `temporary_copy` の manifest restore に path 脱出ガードなし** — `project-session-sync.ts:114-122`
   - 症状: 細工した `sessions.json` で `isolation: temporary_copy` + 任意 `worktreePath`/`absolutePath` を import できる。destroy 時は `removeTemporaryCopy` が copies 外を拒否するため削除破壊は防げるが、DB に不正行・誤バインドが残る
   - 根拠: escape skip は `git_worktree` のみ。R11 要調査をコード確認で昇格

2. **P2 / `archived` → バッジ「マージ済」が実態とズレうる** — `task-status.ts:17` + `StatusBadge.tsx` + `PATCH /api/workspaces`
   - 症状: API で `status: archived` にするだけで UI が「マージ済」。マージ未実施のアーカイブでも成功マージに見える
   - 根拠: `deriveTaskStatus` が archived→`merged` 固定。DiffPane 以外からも PATCH 可能

### 確認して新規なし（当該領域）
- Markdown (`react-markdown` v10): `defaultUrlTransform` が `javascript:`/`data:`/`vbscript:` を空文字化。raw HTML 未使用 → XSS 新規なし
- allowlist: resolved+realpath 双方を roots/worktreeBase 配下で検証
- `isWebBuildStale` + `spawnWeb` の stale rebuild 経路は意図どおり（再起動時のみ評価は MEMORY 既存）

### 据え置き
- R1–R11 全件未修正。オープンバグ多数のためループ継続

---

## 2026-07-23 バグ発見ループ R11（発見のみ・未修正）

### ループ
- [R8未カバー領域調査](7a5c1609-29f5-40e8-ba3c-8f0b9ecf6c69) を統合（R1–R10 非重複分）

### 確度の高い新規バグ

1. **P1 / `timedFetch` がヘッダー到着で abort 解除→ボディ読みが無制限ハング** — `web/src/lib/client.ts` `timedFetch`
   - 症状: 応答ヘッダーは返るがボディ停滞時、Settings の provider/MCP/FX、`useSlashCommands`、Home/Task caps 取得などがハングしうる
   - 根拠: `fetch` 解決直後に `finally { clear() }` でタイマー解除。呼び出し側の `res.json()` は signal 非保護。`getJson`/`ocJson`/`ocServer` はボディまで signal 保護あり → ハング対策の穴

2. **P2 / GraphPanel: コミット展開失敗でスピナー永久表示** — `GraphPanel.tsx` `toggleExpand`（285–299）
   - 症状: `/api/git/show` 失敗後も `expanded` が残り、`filesByCommit[hash]` 未設定のため変更ファイル領域が Spinner のまま
   - 根拠: catch は `setError` のみ。`expanded` を戻す／空配列を入れる処理なし

3. **P2 / GraphPanel: silent ポール成功後もエラー帯が残る** — 同 `load`（169 / 178–193）
   - 症状: 手動更新失敗の赤帯のあと、silent ポール成功で一覧は更新されてもエラー文言が消えない
   - 根拠: `setError(null)` は `!silent` 時のみ。payload 更新は silent でも実行

### 要調査（エージェント）
- PtyPanel: directory 切替時の cancelled/abort なし → 旧応答の上書き
- project-session-sync: `temporary_copy` の worktreePath 信頼ベース検証が git_worktree と非対称

### 据え置き
- R1–R10 全件未修正

---

## 2026-07-23 バグ発見ループ R10（発見のみ・未修正）

### ループ
- tick #7。Sidebar／Permission・Question／仕様 docs（音声・setup bat）／TaskView extras を重点。R1–R9 重複除外

### 確度の高い新規バグ

1. **P2 / サイドバーお気に入りトグル失敗が無言** — `Sidebar.tsx:377-389` `toggleFavorite`
   - 症状: PATCH `/api/projects` が失敗しても UI・alert なし。星の見た目も楽観更新していないため「押せなかった」ようにしか見えず原因不明
   - 根拠: `catch { /* ignore */ }`。削除系は alert するのに favorite だけ握りつぶし

2. **P2 / 仕様のみ・実装なし（音声入力）** — `docs/.../2026-07-23-voice-input-design.md`（`76dcc54`）
   - 症状: Home/Task composer のマイク音声入力が仕様化されたが `use-voice-input` / UI は未着手
   - 根拠: 仕様は `web/src/lib/use-voice-input.ts` を要求。コードベースに該当ファイルなし（プラン R8 と同型のギャップ追跡）

3. **P2 / 仕様のみ・実装なし（Windows セットアップ bat）** — `docs/.../2026-07-23-windows-setup-batch-design.md`（`084b20e`）
   - 症状: セットアップバッチ改善の仕様のみ。製品コード未追従（ドキュメント債務）
   - 備考: ランタイムバグではないが発見ループの未実装ギャップとして記録

### 再確認（既出・未修正）
- R8: `PlanDocumentCard` 開閉は入ったが TaskView が `initialCollapsed` 未配線のまま（`initialCollapsed` grep ヒットなし）
- R7: inline `replyPermission`/`replyQuestion` も 404 を成功扱いで dispatch（AttentionQueueModal と同型）

### 確認して新規なし
- TaskView `setExtras` は unmount で `{}` クリア（CommandPalette の stale onFile は回避）
- PermissionCard は失敗時 error 表示。成功時はキュー除去前提で busy 解除なし（通常は unmount）
- FileTreePanel / PtyPanel はエラー表示あり

### 据え置き
- R1–R9 全件未修正

---

## 2026-07-23 バグ発見ループ R9（発見のみ・未修正）

### ループ
- [R5未踏領域バグ調査](0a97490f-c9c1-42e6-bbc1-2457cafafbab) を統合（R1–R8 非重複分）

### 確度の高い新規バグ

1. **P2 / SSE 再接続中に stale idle ガードが無効** — `useSessionStream.ts` `resolveResyncStatus`（約87–98）
   - 症状: busy 中に `reconnecting`/`down` だと、遅延 REST の `idle` で composer が解錠し二重送信しうる
   - 根拠: `staleIdle` は `connection === "live"` のときだけ抑止。`preferRest` は error 再接続の `onopen` 後のみ。visibility / 800ms resync がその窓に入る

2. **P2 / 手動為替の clamp が Settings UI に反映されない** — `SettingsView.tsx` `applyCostPrefs`/`commitRate` + `currency.ts` `writeCostDisplayPrefs`
   - 症状: 0・9999 等を blur すると入力欄は未 clamp、localStorage／他画面は 1–1000 に丸め → プレビューと実表示がズレる
   - 根拠: UI state は生値のまま、`write` 側のみ `clampUsdJpyRate`。Settings は `COST_DISPLAY_EVENT` 未購読

3. **P2 / フォルダ追加ダイアログが入力中パスを上書き** — `AddProjectButton.tsx` `load`（約102）+ open 時 `load(null)`
   - 症状: 開いた直後やナビ中に手動パスを打つと、非同期 `load` 完了で `setManualPath(data.path)` され入力が消える／別パスで追加される
   - 根拠: 進行中リクエストのキャンセルや「ユーザー編集中は触らない」ガードがない

### 通過（エージェント報告）
- Home/Task の `capabilities.input.image` 形は 2026-07-21 修正の再発なし（R6 fail-open は別件）

### 据え置き
- R1–R8 全件未修正

---

## 2026-07-23 バグ発見ループ R8（発見のみ・未修正）

### ループ
- tick #6。新規コミット `4b22b76`（プラン開閉）を重点レビュー。Pty/CommandPalette/slash は薄い確認

### 確度の高い新規バグ

1. **P1 / プラン初期最小化が TaskView 未配線** — `PlanDocumentCard.tsx`（`initialCollapsed`）vs `TaskView.tsx:1878-1885`
   - 症状: カード側の開閉 UI は入ったが、呼び出しが `initialCollapsed` を渡さない（常に default `false`＝展開）。スマホで本文が会話を占有する仕様（`72344bb`）は未達のまま
   - 根拠: grep で `initialCollapsed` の本番使用はカード定義とテストのみ。R2 #3「未実装」は部分実装に更新
   - 再現: 幅 &lt;768 でプラン付きタスクを開き、カードが初期展開のままか確認

2. **P1 / `initialCollapsed={!isMd}` を素通しするとデスクトップが恒久最小化** — `TaskView.tsx` `isMd` 初期 `false`（R3 #6）× `useState(initialCollapsed)`
   - 症状: 仕様どおり `!isMd` を渡すだけだと、初回 paint の `isMd=false` で collapsed=true が固定され、matchMedia 後もデスクトップが開かない（props 変更は state を更新しない）
   - 根拠: `useState(initialCollapsed)` はマウント時のみ。R3 の isMd 初期値問題と合成すると実装トラップ
   - 再現: 配線後に 1440px ハードリロード → プランが閉じたままか

3. **P2 / CommandPalette の Esc が常時グローバル** — `CommandPalette.tsx:54-64`
   - 症状: パレット閉時も `Escape` で `setOpen(false)` を呼ぶ（実害は薄いが、他 UI と同時リスナで余計な処理）
   - 根拠: `if (e.key === "Escape") setOpen(false)` に `open` ガードなし。要調査寄りだが明確なコード臭

### 解消・更新
- R2 #3「プラン最小化コード未着手」→ **開閉 UI は `4b22b76` で追加。初期最小化の製品要件は未達（本 R8 #1）**

### 確認して新規なし
- PtyPanel: エラー表示あり、placeholder 明示
- useSlashCommands: 失敗時空配列（autocomplete 欠落のみ）
- GraphPanel: silent poll でも初回は error 表示

### 据え置き
- R1–R7 全件未修正

---

## 2026-07-23 バグ発見ループ R7（発見のみ・未修正）

### ループ
- tick #5。[R3続きバグ発見](daec5e7e-13c5-4989-96d4-799087ad9e5e) を統合。[R2バグ発見調査](3d6367ca-dc93-4f74-9287-e4b348ac5403) は R5 と同一のため再掲せず

### 確度の高い新規バグ

1. **P1 / GlobalAttention 部分同期で未応答が消える** — `GlobalAttentionProvider.tsx` v2 per-session fetch + `reconcileDirectory`
   - 症状: 同一 directory で一部 session の v2 だけ成功すると sync フラグが立ち、失敗 session の SSE 由来 pending が reconcile で落ちる（エンジンは待ち続け UI から消える）
   - 根拠: session 単位 `.catch(() => null)`。1件非 null で `v2*Fetched=true`。`useSessionStream` の `keepLocalV2: !v2ok` 相当が Global に無い。R5 #2（全 sync 失敗）とは別経路

2. **P1 / 注意応答の 404 を回答済みとして削除** — `AttentionQueueModal.tsx:97-104`（`useSessionStream` reply も同型）
   - 症状: 誤 version／一時 404 でもキューから除去。ユーザーは失敗に気づけずエージェント待ち継続
   - 根拠: `ApiError 404` または message `/404/` で `remove()`

3. **P1 / NestedAgentPanel が message 失敗を空タイムライン扱い** — `NestedAgentPanel.tsx:186-206`
   - 症状: 子マッチ済みなのに「タイムラインはまだありません」。コメントは first-load error だが `setError` せず最後に `setError(null)`
   - 根拠: message `catch` は空配列継続。`Array.isArray` のみ（`{data:[]}` envelope も空化）

4. **P1 / SW が非 OK レスポンスをキャッシュ** — `web/public/sw.js` `cachePut`
   - 症状: デプロイ中 404/500 や壊れたチャンクが Cache API に残り、cache-first／offline で壊れた殻を出し続ける
   - 根拠: `res.ok` 判定なしで `cache.put`（navigate / static 双方）

5. **P2 / DiffPane: merge 後 archive 失敗を黙殺** — `DiffPane.tsx` merge → `PATCH /api/workspaces`
   - 症状: 「マージしました」のまま workspace が archived にならない
   - 要確認: `.catch` 握りつぶしの有無（merge 成功 notice は維持）

6. **P2 / `/api/diff/files` 例外が HTTP 200 + `git:false`** — `diff/files/route.ts:210-212`
   - 症状: 一時障害が「非 git」や弱い error 表示に見える
   - 根拠: 末端 catch で `emptyPayload` を status 200

7. **P2 / MCP OAuth DELETE が write ブロック漏れ** — `opencode.ts` `isBlockedOpencodeWrite`
   - 症状: `DELETE /mcp/{name}/auth` が proxy 経由で通る（POST `/mcp` は遮断、DELETE は `/auth` 系のみ）
   - 根拠: schema 上 `mcp.auth.remove` は DELETE

### 据え置き
- R1–R6 全件未修正

---

## 2026-07-23 バグ発見ループ R6（発見のみ・未修正）

### ループ
- tick #4。領域: 画像 capability 再発／browse／Home・Task 送信ガード。R5（Attention）と重複しない所見

### 確度の高い新規バグ

1. **P1 / 画像ガードが capability 未取得・キー欠落で fail-open** — `TaskView.tsx:897-906,992-997,2198-2201` / `HomeView.tsx:390-405,710-717`
   - 症状: TaskView は「対応していない可能性」警告を出しても送信ボタンは無効化せず、`modelCapabilities[key] === undefined` のとき `sendingImageBlocked` が false → 非対応モデル／エージェント実効モデルへ画像付き送信が通る
   - 根拠: ブロック条件に `modelCapabilities[...] !== undefined` が必須。エージェント上書きキーが provider 一覧に無い場合も恒久バイパス。UI 警告（`!imageSupported`）と送信阻止（「既知かつ非対応」のみ）が不一致
   - 再現: provider 取得前に画像添付して送信、または agent の model が caps マップ外のとき

2. **P2 / browse/dirs が任意パスを列挙可能（認証なし）** — `web/src/app/api/browse/dirs/route.ts:78-125`
   - 症状: `path` クエリでホスト上の任意ディレクトリを一覧（allowed_roots 非参照）
   - 根拠: `path.resolve(raw)` のみ。LAN 無認証 browse の既知枠を再確認・未修正

### 据え置き
- R1–R5 全件未修正（R5 は Attention フォーカス／sync 欠落）

---

## 2026-07-23 バグ発見ループ R5（発見のみ・未修正）

### ループ
- サブエージェント（デバッガー）: R1 重複禁止。HeaderKebab / activity+Sidebar / Plan最小化 docs / GlobalAttention / host restart / 直近テスト実装ズレを重点調査
- R1–R4 既出は再掲せず。修正なし

### 確度の高い新規バグ

1. **P2 / AttentionQueueModal がキュー前進でフォーカス復帰先を壊す** — `AttentionQueueModal.tsx:46-58`
   - 症状: グローバル注意キューが2件以上あるとき、1件目に応答して2件目へ進むと、閉じたあとのフォーカスがモーダル外（元のトリガー）に戻らず body 等へ落ちる
   - 根拠: `useEffect` 依存が `[open, current?.request.id]`。`open` のまま `current` が変わると `if (open)` 分岐で `previousFocusRef.current = document.activeElement` を**モーダル内要素で上書き**する。閉じるときは死んだ（またはアンマウント済み）要素へ `focus()` する
   - 再現: pending question/permission を2件以上用意 → モーダル表示 → 1件目を処理 → 「後で」または Esc で閉じる → フォーカス位置を確認

2. **P2 / タスク離脱時に sync 失敗すると pending 注意が消えたまま** — `useAttentionQueue.ts` `setActiveScope` + `GlobalAttentionProvider.tsx` `syncPendingAttention`
   - 症状: タスク画面（activeScope あり）でそのセッションの permission/question はグローバルキューから除外される。ホーム等へ戻った直後に `/api/tasks` 取得が失敗すると、除外された項目がキューに戻らずバッジ／モーダルが空のまま
   - 根拠: `setActiveScope` は一致アイテムを state から削除するだけ（退避なし）。離脱時の復元は `syncPendingAttention` 一発頼みで、先頭の `getJson("/api/tasks")` が `catch { return }` すると REST 復元も reconcile も走らない。SSE 再送もないため `onopen`/沈黙再接続まで欠落
   - 再現: 別セッションに pending がある状態で当該タスクを開く（キューから消える）→ ネットワーク遮断または `/api/tasks` を失敗させホームへ戻る → 注意バッジが戻らない

### 要調査
- HeaderKebab の Tab 閉じ: フォーカス中 menuitem をアンマウントしてから Tab 既定移動するため、意図（自然に外へ）と実装がずれ focus 喪失しうる（R2 の空 focusableIds 系と隣接）
- `TaskView.test.tsx` が activity の **await 完了待ち**を明示 assert（`542db53`）しており、R1 #4（ブロック）の修正をテストが阻害しうる
- QuestionCard `input.text-sm` は R1 #3 派生（グローバル16px 上書き）— 新規単独バグとしては未昇格

### 確認範囲（今回）
- `HeaderKebabMenu.tsx`（外側クリック / Escape / Arrow / Tab / disabled・busy）
- `activity/route.ts` + `touchSessionActivity` + `task-service`/`Sidebar` 並び（仕様どおり send 経路。SessionSwitcher 遅延は R4）
- Plan 最小化: docs のみ・コード未着手（R2 #3 と同一）
- `GlobalAttentionProvider` / `useAttentionQueue` / `AttentionQueueModal` / `replyPath`
- `SettingsView` restart + `host/src/control-server.js`（R2/R3 のポール・二重202と整合、新規昇格なし）
- 検証: `tsc --noEmit` OK。vitest（activity route / db / SettingsView / GlobalAttentionProvider）22件 PASS

### 据え置き
- R1–R4 全件未修正

---

## 2026-07-23 バグ発見ループ R4（発見のみ・未修正）

### ループ
- tick #3。[初回バグ発見調査](fe13b5b4-99c9-4ab5-b1cf-9c5a674a3a08) は R1 と一致（再検証 PASS: Settings/activity/db vitest 13・tsc OK）。新規は周辺 INV の昇格と Attention/Diff/SW の薄い確認

### 確度の高い新規バグ

1. **P2 / 送信後も SessionSwitcher の並びが古いまま** — `SessionSwitcher.tsx:40-43,118`
   - 症状: フォローアップ送信で `touchActivity`＋サイドバーは更新されるが、ヘッダーのセッション `<select>` 内の順序は `onFocus` まで再取得されない
   - 根拠: `refresh` は mount/focus/create/失敗時のみ。仕様の「最新ユーザー操作順」がドロップダウンにも及ぶなら未達
   - 再現: セッション2つ以上で非先頭セッションに送信し、フォーカスせずに select を開く（または開いたまま）

2. **P2 / kebab 削除がセッション操作 busy 中も有効** — `TaskView.tsx:1354-1361` + `HeaderKebabMenu.tsx:167-170`
   - 症状: 巻き戻し実行中に再度 kebab を開くと「タスクを削除」が押せる。`busy` は Spinner 表示のみでクリック抑止に使われない（呼び出し側が `disabled` を付けた項目だけ抑止）
   - 根拠: sessionItems は `busy !== null` で disabled。danger の delete は常時有効。二重発火のコンポーネント契約が脆い
   - 再現: 巻き戻し確認後すぐに kebab → 削除

### 確認して新規 P0/P1 なし
- GlobalAttention: v1 失敗時も v2 merge、失敗 directory は reconcile スキップ（意図的・MEMORY 既存対策と整合）
- NestedAgentPanel: `/children` null と空配列の区別あり
- DiffPane: 取得失敗は `setError`（silent「変更なし」化は見当たらず）
- SW `web/public/sw.js`: `/api` bypass・navigate network-first。チャンクはハッシュ前提でオンラインデプロイは概ね安全 → 要調査に格下げ

### 要調査
- SW の `CACHE = opencode-webui-v1` 固定＋`/_next/` cache-first がオフライン／中間障害時に古い shell を出すか
- HeaderKebab の `busy` を `disabled` に自動 OR すべきか（API 契約）

### 据え置き
- R1–R3 全件未修正

---

## 2026-07-23 バグ発見ループ R3（発見のみ・未修正）

### ループ
- tick #2。サブエージェント所見を統合: [再起動UIバグ調査](a0b43e58-b897-4b99-9031-3179e5f7f289) / [モバイルUIバグ調査](ca2947bf-680e-48bd-be81-0b9cd070202f)
- R1/R2 重複は再掲せず参照のみ

### 確度の高い新規バグ

1. **P1 / kebab ポップアップが後続DOMに隠れる** — `HeaderKebabMenu.tsx`（`z-30`）+ `TaskView.tsx` `<header>`（z-index なし）
   - 症状: モバイルで「その他の操作」を開くと、直下のタブバー（`lg:hidden`・`bg-surface`）やチャット領域にメニューが欠け／クリック不能
   - 根拠: `b200dc1` は overflow クリップのみ解消。ポータルも header stacking もない。document 順で後続が上に描画される
   - 再現: 狭い幅で kebab を開き、タブ（会話/変更…）との重なりを確認

2. **P1 / WebUI 再起動ポールが旧プロセス応答で早期成功** — `SettingsView.tsx:289-299`
   - 症状: 「再起動しています…」がすぐ消えボタン再有効化。裏ではまだ kill/build/spawn 中
   - 根拠: ホストは 202 後 `setImmediate` で kill。UI は1秒後から `/api/health`。旧プロセスが生きていれば `h.ok` で break

3. **P1 / ポール60回失敗でも成功扱い** — `SettingsView.tsx:289-307`
   - 症状: 約60秒後に進行表示が消えエラーなし。ビルド遅延や起動失敗でも完了に見える
   - 根拠: ループ終了後に `throw` せず `refresh()` → `finally` で `setRestarting(null)`

4. **P1 / OpenCode 再起動待機が固定1.5秒** — `SettingsView.tsx:300-302`
   - 症状: 進行表示が約1.5秒で消えるが、ホスト側は最大約45秒。ポート変更時の WebUI 追従も UI が待たない
   - 根拠: `target === "opencode"` は sleep のみ。ホスト失敗は control-server で握りつぶし（R2 #2 と同系統）

5. **P1 / health 復帰判定が HTTP のみ（opencode.ok 無視）** — `SettingsView.tsx:294-295` / `api/health/route.ts:29-33`
   - 症状: `all` 再起動で WebUI だけ起きればポール終了。OpenCode 未就绪でも進行クリア
   - 根拠: health は OpenCode 落ちても常に HTTP 200（`webui.ok: true`）。UI はボディの `opencode.ok` を見ない

6. **P2 / `isMd`/`isLg` 初期 false でデスクトップ一瞬 kebab 寄せ** — `TaskView.tsx` Zone B 条件
   - 症状: ハードリロード直後、パネルボタンが kebab 側のみ → matchMedia 後に Zone B へチラつき
   - 根拠: `useState(false)` + effect 更新。CSS `hidden lg:` 廃止の副作用

7. **P2 / グローバル16px のデスクトップ副作用** — `globals.css:102-106`（`cb3d9db`）
   - 症状: モバイル限定でないため、SessionSwitcher/`text-[11px]` select 等が大きくなりヘッダー密度が崩れる可能性
   - 備考: R1 #3（utility 上書きで iOS 対策無効）と表裏。カスケード環境により「対策無効」か「デスクトップ肥大」のどちらか／両方が出る。`@media` 絞り込みが必要

### 要調査・低優先
- confirm 後〜`setRestarting` 反映前の二重クリック（R2 #2 の狭いレース）
- `useSessionActions.error` を TaskView が表示せず alert のみ（`9e7a4eb`）
- モバイルタブと kebab のパネル入口重複が意図か整理漏れか

### 据え置き（既出）
- R1: E2E文字化け / 巻き戻しE2E乖離 / composer iOS zoom / touchActivity 30s ブロック
- R2: SessionSwitcher スナップバック / 再起動二重202 no-op / プラン最小化未実装

---

## 2026-07-23 バグ発見ループ R2（発見のみ・未修正）

### ループ
- tick #1（sentinel `AGENT_LOOP_TICK_bugfind`, PID 26536 継続）
- R1 重複禁止。HeaderKebab / SessionSwitcher / host restart / Plan仕様ギャップを重点調査

### 確度の高い新規バグ

1. **P1 / セッション切替の controlled select が瞬間的に戻る** — `SessionSwitcher.tsx:103-116` + `TaskView.tsx:1614`
   - 症状: ドロップダウンで別セッションを選ぶと、選択が一瞬またはしばらく元のセッションにスナップバックし、その後やっと切り替わる
   - 根拠: `value={currentSessionId}` なのに `onSwitch={() => void refreshTask()}` を await せず発火。`refreshTask` 完了前に再レンダーされると value が旧 ID のまま。`finally` の `setBusy(false)` も refresh 完了前に走る
   - 再現: セッションが2つ以上あるタスクで切替を連打／低速ネットワークで観察

2. **P2 / 再起動の二重リクエストが 202 のまま no-op** — `host/src/control-server.js` + `host/src/index.js` `restartWeb`/`restartOpencode`/`restartServices`
   - 症状: 既に再起動中にもう一度 Restart するとクライアントは成功（202）扱いだがホストはログだけ出して何もしない。設定画面は「再起動しています…」後に実質変化なしで完了しうる
   - 根拠: control-server は常に先に 202 を返し、handler 側は `restartingServices` ガードで早期 return（エラーをクライアントへ返せない）
   - 再現: 再起動中に設定から再クリック、またはトレイと WebUI から同時実行

3. **P2 / 仕様未実装ギャップ（プラン初期最小化）** — 仕様 `docs/.../2026-07-23-mobile-plan-default-collapse-design.md` vs `PlanDocumentCard.tsx`
   - 症状: スマホでプラン本文が会話を占有する問題は仕様・計画コミット済み（`72344bb`/`cbbf331`）だが、カードは常に展開表示のまま（開閉 UI・`isMd` 連携なし）
   - 根拠: `PlanDocumentCard` に collapse state / `aria-expanded` なし。実装計画はあるがコード未着手
   - 備考: 未実装機能の追跡。R1 の iOS zoom とは別件

### 要調査
- `HeaderKebabMenu`: 全 menuitem が disabled のとき `focusableIds` 空でオープンしてもフォーカス移動なし（a11y）
- `SessionSwitcher` の `text-xs` も iOS 自動拡大の上書き対象（R1 #3 の派生）
- kebab「巻き戻しを取消す」はセッションさえあれば常時有効 → 未 revert 時の API エラー UX

### 確認済み非バグ／通過
- `SettingsView.test.tsx` 再起動アナウンス: vitest 7件 PASS
- R1 の4件は未修正のまま据え置き

---

## 2026-07-23 バグ発見ループ R1（発見のみ・未修正）

### ループ
- `/loop 2m` 開始（sentinel: `AGENT_LOOP_TICK_bugfind`, PID 26536）
- 目的: コミット履歴・差分レビューでバグを発見・記録。修正は別エージェント向け

### 確認範囲
- 直近コミット: `72344bb`〜`52894d6`（再起動UI / iPhone拡大 / kebab / セッション操作時刻 / 巻き戻し表示）
- `SettingsView.tsx` restart、`TaskView.tsx` touchActivity / composer、`globals.css`、`web/e2e/task.spec.ts`、`SessionActions.tsx`、`activity/route.ts`

### 確度の高いバグ

1. **P1 / E2E文字化け** — `web/e2e/task.spec.ts:706-709`
   - 症状: `follow-up composer omits variant when default is selected` がプレースホルダ／送信ボタン名が文字化け（`繝輔か…` / `騾∽ｿ｡`）のためロケータ不一致で失敗する
   - 根拠: 同ファイルの他テスト（687–690行）は正しい日本語。導入コミット `52894d6`
   - 再現: Playwright で当該テストを実行

2. **P1 / 巻き戻しE2Eが実UIと乖離** — `web/e2e/task.spec.ts:714-746`
   - 症状: `REVERT_TITLE = "直前の入力を下の欄に戻して巻き戻す"` を探すが、本番コードにこの `title` は存在しない（grep ヒットはテストのみ）
   - 根拠: ヘッダー undo は `9e7a4eb` で kebab（「巻き戻す (undo)」）へ移動。メッセージ横ボタンは `title="このコメントを入力欄に戻して巻き戻す"`
   - 再現: `revert button stays visible in header on mobile|tablet|desktop` が要素未検出で失敗する想定

3. **P1 / iPhone自動拡大対策が主 composer で無効** — `globals.css:102-106` vs `TaskView.tsx:2088`
   - 症状: `input,textarea,select { font-size:16px }` を入れたが、フォローアップ textarea は `text-[0.925rem]`（≈14.8px）がクラス優先で上書き → iOS でフォーカス時ズームが再発しうる
   - 根拠: クラス選択子が要素選択子より強い。Home の新規タスク textarea は `text-base`（16px）で問題なし。`QuestionCard`/`CommandPalette`/`DiffPane`/`SettingsView` 等の `text-sm`/`text-[11px]` 入力も同様
   - 再現: iPhone Safari でタスク画面のフォローアップ欄にフォーカス

4. **P1 / activity 更新がプロンプト送信を最大30秒ブロック** — `TaskView.tsx` `touchActivity` + `send` / `approvePlan`
   - 症状: コメントは「must not block the prompt」だが、`await touchActivity()` を `sendPrompt` 前に実行。`sendJson` 既定タイムアウト 30s（`DEFAULT_FETCH_TIMEOUT_MS`）まで送信が遅延しうる
   - 根拠: エラーは swallow するが成功遅延・ハングは await される。導入 `1637299`
   - 再現: `/api/tasks/:id/activity` を遅延／ハングさせ、送信レイテンシを計測

### 要調査（確度低〜中）

- 再起動 UI: WebUI 再起動中にページが死ぬと `restarting` 状態表示が残らない／poll 完了前に JS が落ちる可能性（`a1d587c` は表示追加のみ）
- kebab 移動後、モバイルで「巻き戻し」がヘッダー直置きではなくなり、discoverability 低下（仕様意図なら非バグ）
- `TaskView.test.tsx` のメモリ制限で実行不可（MEMORY 既存・pre-existing）

### 修正方針メモ（実装は別エージェント）
- E2E: 706–709 を正しい日本語に戻す。巻き戻し可視性テストを kebab / メッセージ横ボタンの現行セレクタに合わせて更新
- iOS zoom: `!text-base` または `@media` で 16px 強制、もしくは composer を `text-base` に変更し utility 上書きを排除
- touchActivity: fire-and-forget（void）にするか、短い timeoutMs（例 2s）＋送信と並列化

---

## 2026-07-21 画像対応モデルへの添付が常に非対応エラーになる不具合を修正

### 症状
- 画像入力対応（vision）のはずのモデルに画像を添付して送信すると
  「選択中のエージェント/モデルは画像入力に対応していません」と表示され送信できない

### 根本原因
- `TaskView.tsx` / `HomeView.tsx` の `ProviderResponse` 型と capability 判定ロジックが、
  `opencode.jsonc` の **設定オーバーライドスキーマ**（`provider.<id>.models.<id>.attachment` /
  `modalities.input[]`、`opencode-schema.d.ts` の `ConfigV2` 系）を前提にしていた
- しかし実際に `GET /api/opencode/provider` が返す `Model` 型（同スキーマファイルの
  `components["schemas"]["Model"]` および実機 curl で確認）は
  `capabilities: { attachment, input: { image, text, ... } }` という**別のネスト形**
- そのため `m.attachment` / `m.modalities?.input` は全モデルで常に `undefined` になり、
  `claude-sonnet-5` や `gpt-5.6-sol`（実際は `capabilities.input.image: true`）を含む
  **全モデルで画像対応判定が常に false** になっていた（モデル・プロバイダ非依存の全面バグ）

### 変更
- **TaskView.tsx / HomeView.tsx**: `ProviderResponse` の型を `capabilities.attachment` /
  `capabilities.input.image` を読む形に修正し、`caps[value]` 構築ロジックも追従

### 検証
- 稼働中ホスト `http://127.0.0.1:3000/api/opencode/provider` の実レスポンスを curl 取得し、
  修正後ロジックをNodeで再現して `claude-sonnet-5`/`gpt-5.6-sol`/`cursor-acp::auto` は
  `image:true`、実際に非対応な `glm-5.2`（opencode-go/ollama-cloud経由）は `image:false` と、
  期待通りに判定が分かれることを確認
- `tsc --noEmit` OK / `eslint`（対象2ファイル）OK / `next build` OK
- Vitest: `HomeView.test.tsx` 6件 PASS。`TaskView.test.tsx` は既存のメモリ制限問題で実行不可
  （2026-07-20 MEMORY エントリと同一の pre-existing 問題。本修正と無関係）

### 判断・教訓
- **サブエージェント無言終了が6連続**したため、ユーザーの指示でメインが直接調査・修正した。
  同一提供元への機械的な再試行を繰り返さず、早めに直接対応へ切り替えるべきだった
- フロントエンドが外部APIレスポンスの型を「生成されたスキーマ (`opencode-schema.d.ts`)」から
  ではなく手書きで重複定義していたため、実際のランタイムAPI形状とのドリフトに気づけなかった。
  同種の手書き型は `opencode-schema.d.ts` の該当 `components["schemas"]` と定期的に突き合わせる
- capability 判定のような「常に false でも実害が地味に見える」バグは、実機の生JSONを
  curl 等で直接確認しないと気づけない。UIの見た目（モデル選択肢の表示等）だけでは判定不可

### 追記: コード修正後もブラウザに反映されない → ホスト再起動が必要
- 症状の再報告を受けて調査したところ、**コード・ローカル本番ビルド(`.next`)は修正済みなのに、
  稼働中のトレイホストが修正前の古いバンドルを配信し続けていた**
- 原因: `host/src/web-runtime.js` の `isWebBuildStale` は **ホスト起動時／再起動時にのみ**評価される。
  実行中の `next start` プロセスは、その起動時点の `.next` を配信し続け、後からソースを直しても
  無再起動では反映されない（`next dev` の HMR とは違い prod は再起動が要る）
- 確認手法: 稼働ホストが配信する task ページの JS チャンクハッシュ（`/task/*` の HTML から抽出）と、
  ローカル `.next` の生成物のハッシュを突き合わせ、不一致＝古い配信と判定。
  チャンク本文に `capabilities`(新) が含まれ `modalities`(旧) が消えているかも直接 grep で確認
- 対処: `POST /api/host/restart` に `{"target":"webui"}` を投げてホストを再ビルド＋再起動。
  再起動後、配信チャンクが修正版ハッシュ(`page-af4f8f632ce496b8.js`)に切り替わり、本文に
  `capabilities` 含有・`modalities` 除去を確認して反映完了
- 教訓: **フロントのコード修正は「ビルド成功」だけで完了とせず、稼働ホストが新バンドルを
  配信しているかまで確認する**。トレイホスト運用では修正後に `POST /api/host/restart`
  （target=webui）で反映させる。反映確認は配信中チャンクのハッシュ／本文 grep が確実

---

## 2026-07-21 prompts/build.md の全角括弧統一・学習済みルール文言更新

### 変更
- **prompts/build.md**: ユーザー提示の最新版と2箇所差分を検出し反映
  - 「エージェントTier/サブエージェント」内 `委任(探索...)` の半角括弧を全角 `（探索...）` に統一
  - 「学習済みルール」最終行を「bashで next dev / next start / watch 等の常駐プロセスを...」から
    「常駐プロセス禁止: `next dev` / `next start` / `npm run dev` / watch 系を bash フォアグラウンドで起動しない。
    検証は tsc/eslint/vitest か既存 host の短いヘルスチェックに限定する」に更新（npm run dev を明記、文言簡潔化）

### 検証
- Node スクリプトで現行ファイルとユーザー提示内容を行単位比較し、diff件数 0 まで確認
- `prompts/build.md` は `/prompts/build.md` として `.gitignore` 対象（意図的にローカル専用、git 管理外）。
  コミット対象外のため本変更自体はコミットせず、本 MEMORY.md のみコミット

### 判断・教訓
- `prompts/build.md` と `LESSONS.md` は `.gitignore` に明示登録されたローカル専用ファイル（`MEMORY.md` のみ追跡対象）。
  設定ファイル変更時は `git add` 前に `git ls-files` / `.gitignore` を確認し、無意味な `-f` 強制追加をしない
- テキスト差分確認は文字コード起因の誤検知（PowerShell `Compare-Object` の日本語文字化け）を避け、
  Node.js で UTF-8 として行単位比較する方が確実

---

## 2026-07-20 タブレット/スマホでの自動スクロールと巻き戻しボタン改善

### 変更
- **TaskView.tsx**: 自動スクロールを `scrollTo({ top: el.scrollHeight, behavior: "auto" })` に簡潔化。慣性スクロール中の rAF/timeout は逆効果なため避け、ストリーム変化時に同期スクロールを実行
- **SessionActions.tsx**: `MessageRevertButton` に `active:bg-surface-3 active:text-text`、`min-h-[28px] min-w-[44px]`、`touch-manipulation` を追加し、モバイルでのタップ領域と視覚フィードバックを強化
- **TaskView.test.tsx**: `@/lib/client` mock に `timedFetch`、`@/lib/useSlashCommands` mock を追加

### 検証
- `tsc --noEmit` OK
- `npx eslint` OK（対象ファイル）
- `npx next build` OK
- Vitest: `TaskView.test.tsx` は既存のメモリ制限問題で実行不可（stash した元コードでも同様）。`NestedAgentPanel.test.tsx` 等の他の task 系テストは PASS

### 判断・教訓
- モバイル Safari の慣性スクロールに対抗するために複雑なタイミング調整を入れると、かえって無視されたり遅延が生じたりする。シンプルな同期 scrollTo が最も安定
- タッチデバイスでは `:hover` だけでなく `:active` と十分なタップ領域が必須
- 既存テストのメモリ問題は本件と無関係。修正前後で再現するため、切り分けて別対応とすべき

---

## 2026-07-20 質問ポップアップにセッション名表示

### 変更
- **AttentionQueueModal**: ヘッダーにセッション名（タスクタイトル）を表示。解決できない場合は `sessionID` にフォールバック。ホバーで ID を確認可能
- **resolveAttentionSessionTitle**: directory+sessionId 優先、なければ sessionId のみでタスク一覧から解決
- **GlobalAttentionProvider**: 同期時の `/api/tasks` 結果をキューへ `setTasks` してタイトル解決を即時反映

### 検証
- Vitest: useAttentionQueue / AttentionQueueModal / GlobalAttentionProvider PASS
- `tsc --noEmit` OK

---

## 2026-07-20 その他未デバッグ分野 ラウンド6

### 結果
- **ZERO_CONFIRMED_BUGS** — R1–R5 の再監査で新規 P0/P1 なし
- `%2e%2e` / 二重エンコード、`PATCH /global/config`、解決後パスの二重ブロックを確認
- 既知の低優先（LAN 無認証 browse/roots/host、PR orphan、FK off 等）は据え置き

### ループ
- sentinel `AGENT_LOOP_TICK_misc_debug` を停止（収束）

---

## 2026-07-20 その他未デバッグ分野 ラウンド5

### 修正
1. **P0**: percent-encoded `%2e%2e` / 二重エンコードが `assertSafeOpenCodePath` をすり抜け `/auth/...` に解決されていた → セグメント decode + `resolvedOpenCodePathname` 後にも `isBlockedOpencodeWrite` を適用（BFF/`ocServer`）
2. **P1**: `PATCH /global/config` が `isBlockedOpencodeWrite` から漏れていた → ブロック追加

### 検証
- tsc / opencode-id・client Vitest PASS
- ループ継続

---

## 2026-07-20 その他未デバッグ分野 ラウンド4

### 修正（P0/P1）
1. **opencode session id パストラバーサル**: `../../auth/{provider}` 等が `new URL` で `/auth/...` に解決され DELETE 可能だった
2. **防御層**: `opencode-id.ts`（allowlist + `assertSafeOpenCodePath`）、`ocServer`/`ocJson`/BFF proxy で `..` 拒否、`bindSession`/manifest/API で不正 id 拒否、destroy 時は `openCodeSessionPath`

### 検証
- tsc / opencode-id・project-session-store・client・workspace-service Vitest PASS

---

## 2026-07-20 その他未デバッグ分野 ラウンド3

### 修正
1. **P1 GlobalAttention**: v2 permission/question の `{ data: [] }` envelope を `normalizeOcList` で展開。v1 空成功時に v2 pending が消える／復元できない問題を解消
2. **SessionSwitcher**: セッション作成失敗を握りつぶさず title/aria に表示

### 検証
- tsc / attention・GlobalAttentionProvider Vitest PASS

---

## 2026-07-20 その他未デバッグ分野 ラウンド2

### 修正（P1）
1. **NestedAgentPanel**: `/children` 一時失敗を空配列と区別し、sticky feed を消さない
2. **GlobalAttentionProvider**: v1 permission/question 失敗でも v2 を取得・reconcile（useSessionStream と同等）
3. **match-child-session**: sibling-index フォールバック削除（誤子セッション sticky 防止）
4. **assertSafeBranchName / diff base**: 日本語など Unicode ブランチ名を許可（注入・`..` は拒否）

### 検証
- tsc / match-child-session・git・NestedAgentPanel・useAttentionQueue Vitest

---

## 2026-07-20 その他未デバッグ分野 ラウンド1

### ループ
- `/loop 2m` 開始（sentinel: `AGENT_LOOP_TICK_misc_debug`, PID 26604）
- 既カバー外: git / DB マニフェスト / diff / ネスト残 / PWA 等

### 修正（P1）
1. **git/merge**: into=branch で復帰 checkout 失敗時は 500/409（`ok:true` + `restored:null` を廃止）。コンフリクト後の復帰失敗も明示
2. **DiffPane**: アーカイブは `restored` がある場合のみ。diff 失敗時は「変更なし」ではなく error 表示
3. **git/commit**: `all:false` / paths なしは 400（暗黙の `git add -A` を禁止）
4. **project-session-sync**: workspace ID 衝突時、他プロジェクトの行へ session bind しない
5. **diff/files**: base 比較の両失敗を空成功にせず error payload

### 検証
- tsc OK / project-session-sync Vitest 5件 PASS

---

## 2026-07-20 ネットワーク デバッグ ラウンド5

### 結果
- **ZERO_CONFIRMED_BUGS**（P0/P1 の新規ネットワークハングなし）
- R1–R4 のタイムアウト／再接続対策を再監査し維持を確認
- 既知の低優先（git/`gh` 子プロセス、SSE CONNECTING、folder dialog、SW）は据え置き

### ループ
- sentinel `AGENT_LOOP_TICK_network_debug` を停止（収束）

---

## 2026-07-20 ネットワーク デバッグ ラウンド4

### 修正
1. **fx-usd-jpy**: Frankfurter upstream に 8s `AbortSignal.timeout`（BFF ワーカーハング防止・P1）
2. **CommandPalette**: ファイル検索 fetch に 30s タイムアウトを `AbortSignal.any` で合成（クエリ abort も維持）
3. **SettingsView**: `/api/host/restart` を `timedFetch`（10s）へ

### 検証
- tsc OK / fx・client Vitest PASS
- ループ継続（sentinel: `AGENT_LOOP_TICK_network_debug`）

---

## 2026-07-20 ネットワーク デバッグ ラウンド3

### 修正
1. **client.ts**: `timedFetch` 追加（デフォルト 30s Abort）。`getJson`/`ocJson` 外のアドホック BFF 呼び出し用
2. **生 fetch 置換**: HomeView / TaskView / AgentsSettings / SettingsView / currency / useSlashCommands
3. `cache: "no-store"` 付き生 fetch は `web/src` から一掃を確認

### 検証
- tsc OK / `client.test.ts` 4件 PASS
- ループ継続（sentinel: `AGENT_LOOP_TICK_network_debug`）

---

## 2026-07-20 ネットワーク デバッグ ラウンド2

### 修正
1. **BFF `/api/opencode/[...path]`**: 非 SSE の upstream `fetch` に 90s `AbortSignal.timeout`。`/event`・`/global/event` は除外してストリームを維持
2. **`/api/health`**: OpenCode health に 1.5s タイムアウト（ハング防止）
3. **`/api/diff`**: session diff の upstream fetch に 30s タイムアウト

### 検証
- tsc OK / 関連 Vitest PASS

---

## 2026-07-20 ネットワーク デバッグ ラウンド1

### ループ
- `/loop 2m` ネットワーク中心デバッグ開始（sentinel: `AGENT_LOOP_TICK_network_debug`, PID 26516）

### 修正
1. **client.ts**: `getJson` / `sendJson` / `ocJson` にデフォルト 30s タイムアウト（明示指定時はそれを優先）。ハングした BFF/エンジン呼び出しで UI が永久待ちしない
2. **GlobalAttentionProvider**: SSE 沈黙検知（heartbeat + silenceWatch）と `online` 再接続。半開き接続の放置を防止
3. **useSessionStream**: `window.online` で error 扱い再接続 + preferRest resync

### 検証
- tsc / client・GlobalAttention・sse-health Vitest PASS

---

## 2026-07-20 UI/UX デバッグ ラウンド6

### 結果
- **ZERO_CONFIRMED_BUGS (P0/P1)** — R1–R5 後の再監査で致命/高優先の新規 UI バグなし
- 残存はモバイルで非表示のコピー/削除など利便性レベル（Sidebar から削除可、停止はアイコン表示）
- TaskView UTF-8 正常
- デバッグループ（PID 37076）を停止

---

## 2026-07-20 UI/UX デバッグ ラウンド5

### 修正
1. **AttentionQueueModal**: 「フルアクセス」で `writeAccessMode("full")` を呼ぶ（TaskView と同期）
2. **TaskView モバイル**: SSE 再接続/切断表示を常時表示、再同期ボタンをモバイルでも利用可
3. **slash a11y**: `aria-controls` を `slashOpen` 時のみ付与（HomeView/TaskView）
4. **SessionSwitcher**: `aria-label="セッション切替"`

### 検証
- TaskView UTF-8 正常（`???` 0）
- tsc / 関連 Vitest PASS

---

## 2026-07-20 UI/UX デバッグ ラウンド4

### 修正
1. **P0 TaskView 文字化け**: `d8eba9a` で壊れた日本語を `ae013c0` から復元し、active-session-attention 効果のみ再適用（PowerShell 経由の破壊を回避）
2. **DiffPane**: Merge/PR をモバイルでも表示、コミット/PR 入力と折りたたみボタンに aria
3. **SlashSuggestMenu**: `id="slash-suggest-listbox"`、HomeView/TaskView に combobox + `aria-controls`

### 検証
- tsc / 関連 Vitest PASS、TaskView の `???` 件数 0

---

## 2026-07-20 UI/UX デバッグ ラウンド3

### 修正
1. **モバイル Sidebar**: Escape / フォーカストラップ / dialog 属性 / フォーカス復帰
2. **現行セッション Sidebar バッジ**: `active-session-attention` モジュールで TaskView → Sidebar に pending を通知
3. **AddProjectButton**: dialog/Escape/トラップ、Attention 中は抑止、z-[65]、aria-label
4. **PartView**: ツールヘッダー inset focus ring、lightbox z-[80] + Escape stopPropagation
5. **HomeView**: スラッシュ開時に `pt-64` でメニュークリップ緩和、`cx` 利用

### 検証
- tsc / HomeView・PartView・GlobalAttention Vitest PASS

---

## 2026-07-20 UI/UX デバッグ ラウンド2

### 修正
1. **CommandPalette**: 権限モーダル表示中は Ctrl/Cmd+K を抑止・強制クローズ。dialog/aria、フォーカストラップ、z-[60]
2. **AttentionQueueModal**: z-[70] でパレットより前面
3. **Sidebar**: 権限待ちも警告ドット表示（question/permission 共通）
4. **HomeView**: 添付削除 `max-sm:opacity-100`、textarea `aria-busy`
5. **QuestionCard**: `aria-pressed` / radiogroup・group、自由入力 `aria-label`
6. **DiffPane**: 各 select に `aria-label`

### 検証
- tsc / 関連 Vitest PASS

---

## 2026-07-20 UI/UX デバッグ ラウンド1

### ループ
- `/loop 2m` UI/UX 中心デバッグ開始（sentinel: `AGENT_LOOP_TICK_uiux_debug`, PID 37076）

### 修正
1. **P0 モバイル**: `<lg` で diff タブ中に権限/質問が来たら chat タブへ自動切替（インラインカードが hidden で応答不能になる問題）
2. **NestedAgentPanel**: 実行中もヘッダーで折りたたみ可能（`(nestedActive||terminal)&&open`）。開始時・完了時は自動展開
3. **添付削除**: タッチで見えるよう `max-sm:opacity-100` + focus-visible
4. **右パネル幅**: ビューポートに合わせてクランプ（chat 列確保）+ resize 再クランプ
5. **AttentionQueueModal**: busy 中は Esc/背景閉じ禁止
6. **a11y**: composer `aria-label`/`aria-busy`、ツールヘッダー `aria-expanded`

### 検証
- tsc / 関連 Vitest PASS

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド17

### 結果
- **ZERO_CONFIRMED_BUGS** — 致命経路（composer 永久ロック / permission・question 応答不能 / sessionError 誤消去）の再監査で新規 P0/P1 なし
- デバッグループ（2分 tick）を停止

### 検証対象
- useSessionStream / TaskView / useAttentionQueue / AttentionQueueModal / GlobalAttentionProvider / NestedAgentPanel / PermissionCard / QuestionCard

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド16

### 追加修正
1. **sessionError クリア条件**: メッセージ resync 成功では消さない。idle 適用時（REST / SSE status / session.idle）または新規送信時のみクリア — エラー後に busy 残留でもバナーが残る
2. **sendPrompt/sendCommand**: 送信開始時に sessionError をクリア

### 検証
- 関連 Vitest / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド15

### 追加修正
1. **session.error / step.failed**: pendingMutation クリア + preferRest 付き resync（idle 欠落で composer がロックし続けない）
2. **PermissionCard フルアクセス**: 先に reply、成功後に mode 切替（自動承認との二重 POST 防止）
3. **SSE *.replied**: `rememberReplied` して REST resync によるカード再表示を防止
4. **scope 切替**: `preferRestStatusRef` もリセット

### 検証
- 関連 Vitest / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド14

### 追加修正
1. **abort + preferRestStatus**: 即 idle 解除後、abort 失敗でセッションがまだ busy なら REST busy を再適用（staleBusy 抑止を preferRest 時は無効化）

### 検証
- useSessionStream Vitest 12 PASS / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド13

### 追加修正
1. **abort**: POST 前に idle 解除。失敗・タイムアウトでも composer がロックしたままにならない
2. **SSE permission/question.asked**: `wasRecentlyReplied` なら再投入しない（モーダル回答後の遅延イベント対策）

### ループ
- 旧重複ループは停止済み。稼働中は PID 32792 のみ

### 検証
- 関連 Vitest / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド12

### 追加修正
1. **pendingMutation + REST status**: 送信後に SSE busy/idle を取りこぼすと composer が永久ロックされる問題を修正。`resolveResyncStatus` で pending 中は REST を信頼して `pendingMutation` をクリア
2. 重複デバッグループ（旧 PID）を停止し、単一ループ（PID 32792）に統一

### 検証
- 関連 Vitest / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド11

### 追加修正
1. **pendingMutation**: `sendPrompt`/`sendCommand` の POST 前に `pendingMutationRef=true` + optimistic busy。失敗時は idle に戻す
2. **preferRestStatus**: 再接続を `error` / `silence` に分離。error のみ REST idle を信頼（silence では mid-turn idle 上書きしない）
3. **権限・質問 mutation**: permission/question/reject と AttentionQueueModal の reply/reject に `timeoutMs: SESSION_MUTATION_TIMEOUT_MS`

### ループ
- 再起動（PID 32792 / 2分）

### 検証
- 関連 Vitest 32 PASS / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド10

### 追加修正
1. **abort**: `pendingMutationRef` をクリアし、停止後も message init がスキップされ続けないようにする
2. **SSE 切断後 idle 復帰**: 再接続 resync は `preferRestStatus` で REST idle を信頼。live 中のみ staleIdle 抑止

### ループ
- 停止していたため再起動（PID 26720）

### 検証
- Vitest / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド9

### 追加修正
1. **stale busy 抑止**: idle 後に REST の stale busy で composer を再ロックしない
2. **pendingMutationRef**: 送信直後〜busy/idle まで message init を抑止 + optimistic busy
3. **recently-replied モジュール化**: TaskView アンマウント後も回答済み ID を共有保持
4. **送信中ロック**: `sending` 状態で busy SSE 前の二重送信を防止
5. TaskView 返答時に optional global attention `remove` も呼ぶ

### 検証
- 関連 Vitest 33 PASS / tsc OK（TaskView.test は環境 OOM で未完走）

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド8

### 追加修正
1. **stale idle 抑止**: SSE が busy のとき REST の idle で status を上書きしない（二重送信防止）
2. **回答済み ID 抑制**: resync / reconcile で locally replied な permission/question を再投入しない

### 検証
- Vitest / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド7

### 追加修正
1. **resync マージ**: `syncStartedAt` 以降の SSE permission/question を REST 未反映でも保持
2. **モデルシード**: セッション切替で `seededModelRef` をリセット
3. **自動承認失敗状態**: scope 切替でクリア
4. **NestedAgentPanel**: 実行中に折りたたんでも完了時に再表示
5. **loaded/スピナー**: SSE 受信で `loaded=true`、空のときだけスピナー
6. **AttentionQueueModal**: アイテム切替で error クリア

### 検証
- Vitest / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド6

### 追加修正
1. **busy 中 init 抑止**: `loaded` 条件を外し、既 busy セッションを開いたときの delta 消失を防止
2. **busy→idle 誤発火**: セッション切替時に status ref をリセットし、`null` を idle 扱いしない
3. **activeScope**: session 切替 cleanup で `null` を挟まない（unmount 時のみ clear）

### 検証
- Vitest / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド5

### 追加修正
1. **busy→idle resync**: TaskView + `session.idle` で REST メッセージ再同期（R3 の busy 中 init 抑止の後始末）
2. **AttentionQueueModal**: PermissionCard/QuestionCard に `key` を付与（フォーム状態漏洩防止）
3. **session.next.tool.input.delta/ended**: ツール入力ストリームを蓄積・反映

### ループ
- 旧 PID 35792 は停止していたため再起動（新 PID 33436 / 2分）

### 検証
- 関連 Vitest + tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド4（/loop 2m 継続）

### 追加修正
1. **activeScope 離脱**: scope 変更時に `syncPendingAttention()` で global queue 復元
2. **NestedAgentPanel**: callID 変更時に sticky 子セッション ID をリセット
3. **isResolvedEvent**: sessionID 必須。`remove(requestId, sessionID)` で誤削除防止

### ループ
- 既存 `AGENT_LOOP_TICK_agent_debug`（PID 35792 / 2分）を継続。重複起動なし。

### 検証
- Vitest 49 PASS / tsc OK

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド3

### 追加修正
1. **resync 分離**: message 失敗でも permission/question 同期は実行
2. **busy 中の init 抑止**: ストリーム中の REST 全置換によるテキスト巻き戻り防止
3. **reconcileDirectory**: active-scope 項目を global queue に再投入しない
4. **AttentionQueueModal**: 404 時もキューから除去
5. **matchChildSession**: metadata.sessionID を sticky より優先
6. **replied イベント**: sessionID 必須（欠落時は無視）

### 検証
- Vitest 41 PASS / tsc OK
- ループ継続中（致命バグが無くなるまで）

---

## 2026-07-20 エージェント会話パス デバッグ ラウンド2

### 追加修正
1. **フルアクセス権限デッドロック**: 自動承認失敗時は PermissionCard をフォールバック表示
2. **resync 競合**: `resyncGenRef` で古いレスポンスの `init` 上書きを防止
3. **abort 後凍結**: abort 成功後に即 `idle` + `resync()` で composer 解除
4. **session.compacted**: 未処理だったため debounced resync
5. **permission/question replied**: sessionID 不一致は無視
6. **message.updated**: `props.sessionID` フォールバック

### 検証
- 関連 Vitest + tsc OK
- ループ `AGENT_LOOP_TICK_agent_debug` 継続中

---

## 2026-07-20 エージェント会話パスの致命的バグ修正（ループ第1ラウンド）

### 対象
`useSessionStream` / `TaskView` / `GlobalAttentionProvider` / `useAttentionQueue` — 送受信・SSE・権限/質問が止まる系。

### 修正内容
1. **SSE**: `message.removed` / `message.part.removed` 処理。`session.next.*` の text/reasoning/tool デルタ対応。失敗5回で `connection: "down"`。
2. **session.error**: `sessionID` 一致時のみ表示（他セッション混入防止）。
3. **送信**: `prompt_async` / `command` / `abort` に 60s タイムアウト。
4. **resync**: v1+v2 の permission/question を取得。v2 取得失敗時はローカル v2 を保持（`keepLocalV2`）。
5. **composer**: `working = hasActiveTask`（status 未ロード中の二重送信防止）。
6. **質問二重表示**: アクティブ scope の question も global queue から除外。
7. **GlobalAttention**: 再接続時に permission も REST 復元。ディレクトリ同期失敗時は既存項目を消さない。
8. **text.ended**: 空 text でストリーム済み本文を消さない。

### 検証
- Vitest: useSessionStream / useAttentionQueue / GlobalAttentionProvider / TaskView PASS
- `tsc --noEmit` OK

### ループ
- sentinel: `AGENT_LOOP_TICK_agent_debug`（2分間隔）
- バグが無くなるまで継続。停止はユーザー指示または致命バグ0確認時。

---

## 2026-07-20 Anthropic が WebUI で「provider に弾かれる」原因

### 結論
**認証拒否ではない。** UI 上の「provider に拒否された」は OpenCode の `ContentFilterError`（`The response was blocked by the provider's content filter`）をそのまま表示している。

### 証拠（`~/.local/share/opencode/log/opencode.log`）
- `ProviderAuthError`: **0**
- `ContentFilterError`: ≈132（うち anthropic 明示 ≈66）
- anthropic 成功（`hasError=false`）: 大量 → 全面拒否ではない
- 失敗例: `inputModel=anthropic/claude-sonnet-5` → `llm.runtime=ai-sdk` → 数秒後 `ContentFilterError`

### Claude Code との差
| | Claude Code | OpenCode / WebUI |
|--|-------------|------------------|
| 資格情報 | `~/.claude/.credentials.json` | `~/.local/share/opencode/auth.json` |
| トークン | OAuth 同一 | OAuth 同一 |
| 呼び出し経路 | first-party Claude Code | `ai-sdk` → Anthropic Messages API |
| WebUI の役割 | なし | model を透過転送するだけ（auth は持たない） |

同じ OAuth でも、OpenCode の agent/tools/system 文脈＋ third-party API 経路だと content filter に当たりやすい。WebUI に Anthropic 拒否ロジックは無い。

### 否定した仮説
- API key 未設定 / 別クレデンシャル
- BFF が model を壊す / Authorization を落とす
- WebUI の allowlist 除外

### 副次（別症状）
- anthropic `APIError`: `tool_use` に対応する `tool_result` 欠落、assistant prefill 非対応など（セッション履歴依存）

### 切り分け
1. エラー文が `blocked by the provider's content filter` か確認
2. 短い無害プロンプトで WebUI vs Claude Code 比較
3. content filter → OpenCode 側（system/agent/tools）を疑う。WebUI 修正では直らない
4. tool_result / prefill 系 → 新規セッションを試す

---

## 2026-07-20 アドオンを repo 直下 `addons/` に集約

### 要望
- CodexBar を `OpenCodeWebUI/addons/codexbar` に集約し、今後のアドオンもここに追加したい。

### 構成
- **本体**: `addons/<name>/`（CodexBar: widget / lib / api / public / index）
- **共有ホスト**: `web/src/lib/addons`（types/registry/state）+ `web/src/components/addons`（AddonHost/Settings）
- **薄いシム**: `web/src/app/api/addons/<name>/…/route.ts` は re-export のみ
- **静的ファイル**: 正は `addons/<name>/public/` → `npm run sync:addons` で `web/public/addons/` へコピー（gitignore）
- **alias**: `@addons/*` → `../addons/*`（tsconfig + vitest）、Next `experimental.externalDir`
- **stale 判定**: host が sibling `addons/` も監視

### 新アドオン手順
`addons/README.md` 参照。`registry.ts` に 1 行登録。

### 検証
- Vitest（addons 含む）96 PASS / typecheck OK / host web-runtime 9 PASS

---

## 2026-07-20 Composer スラッシュコマンド予測表示

### 要望
- Cursor 風に、入力欄で `/` を打つとコマンド候補を予測表示する。

### 実装
- `lib/slash-command.ts`: `/token` 検出・フィルタ・補完・送信時の command 分解
- `SlashSuggestMenu` + `useSlashCommands`: OpenCode `GET /command` から候補取得
- `HomeView` / `TaskView` の textarea 直上に候補メニュー（↑↓ / Enter・Tab 確定 / Esc 閉じ）
- 選択時は `/name ` を挿入
- 送信時: 既知コマンドなら `POST /session/{id}/command`（Home の初回作成も tasks route で分岐）
- Proxy: directory なしで `GET /command` / `GET /skill` を許可

### 注意
- 未知の `/foo` は従来どおり通常プロンプト
- ピン留め・履歴は未対応
- `HomeView.tsx` の日本語は UTF-8 で保存すること（壊れたコミット `6fff0e3` の再発防止）

### 検証
- Vitest: slash-command / tasks route / HomeView / TaskView PASS

---

﻿# MEMORY.md — OpenCode WebUI

## 2026-07-20 WebUI「プラグイン」→「アドオン」改名（OpenCode 混同防止）

### 背景
- WebUI の拡張ウィジェットを「プラグイン」と呼んでいたが、OpenCode 本体の plugin と混同しやすい。

### 変更
- 用語・パス・識別子を一括で **addon / アドオン** に変更（OpenCode schema の `plugin.*` は触らない）。
- ディレクトリ: `lib/plugins`→`lib/addons`、`components/plugins`→`components/addons`、`api/plugins`→`api/addons`、`public/plugins`→`public/addons`
- コンポーネント: `PluginHost`/`PluginSettings` → `AddonHost`/`AddonSettings`
- 設定タブ UI: 「プラグイン」→「アドオン」、`SettingsTab` `"plugins"`→`"addons"`
- API: `/api/addons/codexbar/{usage,tokens}`、静的アイコン `/addons/codexbar/*.png`
- localStorage: `webui:addons` / `webui:addon:codexbar:*`（旧 `webui:plugins` / `webui:plugin:codexbar:*` は初回読取で移行）

### 検証
- Vitest: addons / shell / settings / ProviderIcon 関連 70 tests PASS

---

## 2026-07-20 cursor-acp/Auto 画像認識の再発修正（ゾンビプロキシ + OneDrive mkdir）

### 症状
- modalities 修正後も WebUI から `cursor-acp/Auto` に画像を送ると認識できない／失敗する。

### 根本原因（追加）
1. **ゾンビ `:32124`**: TCP は通るが `/health` が返らない。`/provider` の `baseURL` が 32124 のままだと Auto 全体がハング。画像は「読めない」ように見える。
2. **OneDrive 上の `mkdir` EEXIST**: `.opencode-cursor-attachments` 作成時に `fs.mkdirSync({recursive:true})` が EEXIST を投げ、プロンプト構築が 500 で落ちる。画像付きリクエストだけ即死。

### 修正
- OpenCode 側 (`~/.config/opencode` → `OpenCode/opencode`):
  - `aa-cursor-model-guard`: ハングした強制ポートを無視し 32125 へフォールバック。`isHungProxyPort` 追加。
  - `cursor-acp`: キャッシュ済み proxy URL を毎回 health 再検証。EADDRINUSE 時は 32125 を明示試行。`config` フックで live `baseURL` を同期。
  - `image-attachments.mjs`: mkdir/write の EEXIST を許容（OneDrive/競合対策）。
- WebUI host: OpenCode spawn 時に `CURSOR_ACP_PROXY_PORT` を健全なポートへ解決して渡す。

### 検証
- `32125/health` OK、画像付き `/v1/chat/completions` → 200 で `VISION_OK` 応答。
- guard / image-attachments / host tests PASS。
- **host の spawn 変更反映にはホスト再起動が必要**（OpenCode 再起動だけでは古い host のまま）。

---

## 2026-07-20 インテリジェンス／エージェント表示の修正

### 要望
1. インテリジェンス選択肢をモデルの `variants` 対応に合わせて変化させる
2. `build（Code）` / `plan（Plan）` の括弧付き表示は冗長なのでやめる
3. セッション画面でインテリジェンスを変更できるようにする

### 実装
- `model-variants.ts`: 対応キーを `none|minimal|low|medium|high|xhigh|max|thinking` に拡張。モデルが宣言し disabled でないものだけを努力度順で返す（例: openai `gpt-5.6-sol` → none/low/medium/high/xhigh）
- `IntelligenceSelect`: 渡された variants をそのまま描画（hardcoded high/low 廃止）
- API（`/api/tasks`・opencode proxy）と `useSessionStream` の variant 検証／型も同キーへ拡張
- `HomeView`: `formatAgentLabel` を削除し、エージェントは生名（`build` / `plan`）のみ表示
- `TaskView`: 実行中（`working`）でもモデル／インテリジェンス／エージェントを変更可能に。ツールバー順をホームと同様（モデル→知性→エージェント→アクセス）へ整列

### 注意
- `cursor-acp/Auto` は variants 無しのためインテリジェンスセレクタは出ない（仕様どおり）。GPT-5.6 Sol 等へ切り替えると表示される
- 反映には WebUI の rebuild / 再起動が必要（prod の stale build 注意）

### 検証
- Vitest: model-variants / IntelligenceSelect / tasks route / opencode proxy 計 38 tests PASS

---

## 2026-07-19 cursor-acp/Auto 画像認識不可の修正（OpenCode 側）

### 結論
- WebUI のバグではなく、`~/.config/opencode`（symlink → `OpenCode/opencode`）側。
- OpenCode が `cursor-acp/auto` を text-only とみなし、添付を `ERROR: … does not support image input` に置換していた（GitHub issue #30071 と同型）。
- 修正（opencode リポジトリ）:
  - `74fe7ef` … `modalities.input: ["text","image"]` + `attachment: true`、プロキシ側で data URL 実体化
  - `8e3e309`〜`9414ef1` … `image-attachments.mjs` 分離・単体テスト・smoke
  - `401bd14` / `878c04d` / `17bc9d5` … `aa-cursor-model-guard` が config フックで modalities を実行時保証
- WebUI: `.gitignore` に `.opencode-cursor-attachments/` を追加済み（`6be6b3f`）。
- **反映には OpenCode の完全再起動が必要**（例: `POST http://127.0.0.1:18765/restart/opencode`）。
- 検証: `opencode serve --port 4098` で `capabilities.input.image=true` / `attachment=true` を確認済み。
- 矛盾の明記: 以前の「Cursor は画像読める／エージェント誤認」は IDE 直結時の話。OpenCode→cursor-acp 経路では modalities 未設定が実バグだった。
- 運用注意: 4096/32124 のゾンビ Listen が残ると WebUI→OpenCode が 503 になる。host 制御が落ちている場合は `start-webui.bat` でホストごと再起動。

### 追記（同日・復旧確認）
- 本番 `:4096` は PID 不在のゴースト Listen（16320）のまま TCP を占有。`restart/opencode` / `restart/all` だけでは解放されない。
- host を再起動すると `resolveOccupiedPort` がゴーストを検出して **`:4097` にフォールバック**。そこで `GET /provider` → `cursor-acp/auto` の `attachment=true` / `input.image=true` を確認（CAPS_OK）。
- ゴースト `:4096` / `:32124` が残る場合は OS 再起動が最終手段。WebUI はフォールバック先ポートを使うので画像修正自体は有効。

### 追記（host 再起動経路の改善）
- `restartOpencode()` がコールドスタートと同じ `resolveOccupiedPort` を使うよう修正（ゴースト時は次ポートへフォールバック）。
- OpenCode ポートが変わったら WebUI を追随再起動（spawn 時の `OPENCODE_BASE_URL` を更新）。
- `waitUntilReady` は子プロセスが先に落ちたらタイムアウト待ちせず即失敗。
- 検証: `cd host && node --test` 16/16 PASS。WebUI `GET /api/opencode/provider` で `image=true` / `attachment=true`。

### 教訓
- 「画像が読めない」はハルシネーションとは限らない。先に `opencode.jsonc` の modalities を確認する。
- OpenCode 再起動後も `/provider` で image=false なら、ポート占有ゴーストで古いプロセスを見ている可能性を疑う。

---

## 2026-07-19 起動/再起動時の stale 自動 build

### 要望
- `start-webui.bat` 起動、トレイ再起動、WebUI からの再起動で、最新 build でなければ自動で `npm run build` してほしい。

### 実装
- `host/src/web-runtime.js`: `isWebBuildStale(webDir)` を追加。`.next/BUILD_ID` の mtime と `web/src`・`public`・主要 config（package.json 等）を比較。
- `getWebLaunchPlan(mode, hasBuild, buildStale)`: prod / auto(既存 build) で `!hasBuild || buildStale` なら `needsBuild: true`。dev は対象外。
- `spawnWeb()`: stale 判定→必要なら `buildWebProduction('stale'|'missing')`→その後 `next start`。トレイ/WebUI の `restartWeb` も同じ経路。
- `start-webui.bat`: 初回のみ先行 build。既存 build 時は host 側の stale 判定に委譲する旨を表示。

### 検証
- `cd host && node --test` 16/16 PASS（stale 判定ユニット含む）
- 実ツリーで `isWebBuildStale(web)=false`（直前の本番 build と整合）

### 注意
- **この host コード変更自体の反映にはホストプロセスの再起動が必要**（WebUI 再起動だけでは古い index.js のまま）。次回からソース更新後の WebUI 再起動で自動 build が走る。

---

## 2026-07-19 最近コミットが画面に反映されない原因

### 結論
- **ビルド失敗ではない。** production の `web/.next` が古いまま `next start` されていた。
- ソース／コミットは 23:34〜23:39（画像サムネ・コスト末尾など）だが、反映前の `BUILD_ID` は **15:55**。ホスト再起動だけでは旧バンドルを再読込するだけ。

### 根拠
- `master` は `origin/master` より 3 コミット先行（`2703164` / `2ac145c` / `0b23970`）。ローカルにはコードあり。
- 稼働中: `OPENCODE_WEBUI_MODE=prod` + `next start --port 3000`（host pid 経由）。
- `start-webui.bat` は `BUILD_ID` 欠落時のみ初回 build。ソース更新では自動 rebuild しない。
- 本セッションで `web` にて `npm run build` 成功（新 BUILD_ID `Pik73kkDbKqtY6C85GasK` / 23:44）→ `POST http://127.0.0.1:18765/restart/webui` で WebUI 再起動。

### 反映手順（再発時）
1. `cd web && npm run build`
2. `POST /restart/webui`（host control `:18765`）またはトレイから WebUI 再起動
3. ブラウザはハードリロード推奨

### 教訓
- 「再起動しても変わらない」＝まず `BUILD_ID` 時刻とソース／コミット時刻を比較する。CI build 成功≠ローカル本番反映。

---

## 2026-07-19 Cursorエージェントの「画像が読めない」発言は誤認

### 結論
- **プラットフォームの画像読めないバグではない。** エージェントが能力を誤って否定した文言バグ／ハルシネーション。
- Cursor では添付画像はメッセージ文脈に入り、ワークスペース保存パス経由で `Read` しても読める（本セッションで同一スクショを実際に読めることを確認）。

### 根拠
- 先行セッションが「コスト表示を末尾に変更して」＋ `image.png` 添付に対し「画像は読めないので」と返答していた。
- 本セッションで同種の添付を読み取り、UI上の添付チップとエージェント文言の矛盾を確認済み。
- 当時の MEMORY にも「添付スクショは画像非対応で未読」と誤記していたため訂正。

### 教訓
- 「画像は読めない」「スクショ非対応」は事実確認なしに書かない。添付があれば読む／読めない場合はツール失敗理由を記す。

---

## 2026-07-19 累計コスト表示を行末尾へ移動

### 経緯
- ユーザーから「コスト表示を末尾に変更して」と依頼（添付スクショあり。当時エージェントが「画像非対応」と誤認し未読のまま進めた）。
- 対象はメッセージメタ（既に cost 末尾）ではなく、タスクヘッダー副行とサイドバーのブランチ行の累計コスト位置。

### 実装
- `TaskView.tsx`: ヘッダー副行の並びを `branch · project · contextUsage · 累計 cost` にし、コストを末尾へ。
- `Sidebar.tsx`: ブランチ行でプロバイダアイコンの後にコストを描画（アイコン無し時は `ml-auto` で右寄せ維持）。
- 実装本体は並列セッションが `2ac145c` で先行コミット済み。本セッションは `Sidebar.test.tsx` に末尾配置の回帰テストを追加してコミット。

### 検証
- `npx vitest run src/components/shell/Sidebar.test.tsx`: 14/14 PASS
- `MessageMetaHeader` / `TaskView` 関連も先行確認で PASS

### 教訓
- 並列セッションで実装が先に入ることがある。着手前に `git log` / `git status` で「既に終わっていないか」を確認し、残作業（テスト・MEMORY）だけを拾う。

---

## 2026-07-19 送信画像をチャット履歴でサムネイル表示

### 経緯
- ユーザーから「画像送信時にも元画像を表示させたい」と依頼。送信前の composer ではプレビュー済みだが、送信後のメッセージ履歴では `🖇 image.png` のようなファイル名チップだけだった。

### 実装
- 原因: `PartView` の `case "file"` が常に Paperclip + filename チップを描画しており、`mime` / `url`（data URL）を無視していた。データ自体は `useSessionStream.sendPrompt` 経由で `type: "file", mime, url, filename` として保持されていた。
- `PartView.tsx` に `FileImagePreview` を追加。`mime` が `image/*` かつ `url` がある場合は 112px サムネイルを表示し、クリックでライトボックス（Escape / 背景クリックで閉じる）。非画像や url なしは従来チップのまま。
- `PartView.test.tsx` を新規追加（サムネイル表示・ライトボックス・非画像フォールバック・url なしフォールバック）。

### 検証
- `npx vitest run src/components/task/PartView.test.tsx`: 4/4 PASS
- コミット: `2703164`

### 教訓
- 添付プレビューは composer 側と履歴側で別コンポーネント。composer に実装があっても履歴（PartView）を見落とすと「送信後に消えた」ように見える。
- この環境の PowerShell では `cmd1; cmd2` で後続の git 引数が vitest に食われることがある。検証コマンドは1つずつ実行する。

---

## 2026-07-19 チャット内サブエージェント行にもプロバイダアイコンを表示

### 経緯
- ユーザーから「build primary agent 専用。AGENTS.md の共通指示に追加して適用。」という長文＋「サブエージェントもプロバイダアイコン表示させたい」（チャット/タスク詳細画面のスクリーンショット添付）を受領。
- `prompts/build.md` は既にコミット `50420da`／`9feeb1a` で反映済みと確認し追加作業なし。実作業はUI機能追加のみ。
- スクリーンショットは「サイドバーのタスク行」ではなく、チャット内の task tool 実行行（`ToolPartView`）とネストされたサブエージェント進行パネル（`NestedAgentPanel`）だったため、直前に別セッションが実施した「サイドバーのタスク行」への表示（`89c22c5`）とは対象範囲が異なり、重複ではなく補完関係と判断した。

### 実装
- `MessageMetaHeader.tsx` にインライン定義されていた `ProviderIcon` を `web/src/components/task/ProviderIcon.tsx` へ共有コンポーネント化（`{ providerID?, className? }`、挙動は不変）。
- `web/src/lib/subagent-provider.ts`: `subagent_type` の命名規則 `<rank>-<role>-<provider>-<model>` からプロバイダIDを best-effort で推測する純粋関数 `providerIdFromSubagentType`（既知トークンをハイフン境界・長い順でマッチ）。
- `PartView.tsx`（`ToolPartView`）: task tool 行で `subagent_type` からプロバイダを推測できた場合のみ、行頭の汎用 `Bot` アイコンを `ProviderIcon` に差し替え。他ツール種別・推測失敗時は現状維持。
- `NestedAgentPanel.tsx`: 非busy時のヘッダーアイコンを `Bot` → 子セッション実メッセージの `providerID` から解決した `ProviderIcon` に変更（busy時は `Loader2` のまま）。
- `web/src/lib/plugins/codexbar.ts`: `OPENCODE_TO_CODEXBAR` に `"ollama-cloud": "ollama"` を追加（`normalizeProviderBucket` は既に ollama-cloud を ollama 系として扱っていたのに対し、アイコン解決側が未対応だった既存の欠落を修正）。

### 並列作業への対応
- 作業開始時、`MessageMetaHeader.test.tsx` / `NestedAgentPanel.test.tsx` / `currency.*` に別セッションの未コミットTDD作業（cost表示順序 + `showUsdSuffix`）が存在するのを確認。ユーザーに確認のうえ「混在させず自分の担当分だけ進める」を選択。
- 作業完了までに当該セッションが自分の変更を先にコミット（`280d540` 他）したため、最終的な差分は自分の担当分のみとなった。`NestedAgentPanel.test.tsx` へのテスト追加は既存ブロックを変更せず新規 `it(...)` の追記のみに限定。

### 検証
- `npx vitest run`（対象6ファイル）: 6 files / 55 tests PASS
- `npx tsc --noEmit` / `npx eslint`（対象ファイル）: PASS
- コミット: `d30a0f2`

### 教訓
- 同じ依頼文（長文プリアンブル＋スクリーンショット）が複数の並列セッションに送られることがある。スクリーンショットの対象UI（サイドバー vs チャット内タスク行）を早期に見極めないと重複実装のリスクがある。
- 未コミットの他者差分があるファイルに追記する場合、対象セッションが先にコミットして基点が変わることがあるため、コミット直前に `git diff` で実差分を再確認してから `git add` する（ファイル丸ごとではなく意図した差分のみをステージ）。

---

## 2026-07-19 サイドバーのタスク行にプロバイダアイコンを表示

### 経緯
- ユーザーから「セッションに現在対応中のエージェントのプロバイダアイコンを表示させたい」と依頼（サイドバーのプロジェクト配下タスク一覧のスクリーンショット添付）。
- 依頼冒頭に「build primary agent 専用。AGENTS.md の共通指示に追加して適用。」という長文が付いていたが、調査の結果 `prompts/build.md` は既にコミット `50420da`（build専用ルール反映）・`9feeb1a`（学習済みルール昇格）で反映済みと判明。追加作業は不要と判断し、UI機能追加のみを実施した。

### 実装
- `web/src/lib/types.ts`: `TaskSummary` に `agent?` / `providerID?` / `modelID?` をフラット追加。
- `web/src/lib/task-service.ts`: 既存の `sessionCostFor`（cost専用）を `sessionMetaFor` に拡張し、同一の `/session` フェッチ1回で `cost` / `agent` / `model.providerID` / `model.id` をまとめて取得（OpenCode `Session` スキーマに元々これらのフィールドが存在することを `opencode-schema.d.ts` で確認済み）。`listTasks()` / `getTask()` 双方に反映。
- `web/src/components/shell/Sidebar.tsx`: `MessageMetaHeader.tsx` の `ProviderIcon`（brand画像→`Cpu`フォールバック）と同じパターンをローカル実装し、ブランチ行の右端に `task.providerID` がある場合のみ表示。
- 実装は lead-programmer（anthropic/opus-4.8）へ委任。TDDで進め、`task-service.test.ts` / `Sidebar.test.tsx` にテスト追加。`vitest run`（対象23件・全394件）・`tsc --noEmit`・`eslint` すべて green。
- コミット: `89c22c5`

### 判断理由・教訓
- 並列セッション前提のルールに従い、委任前に `git status` で他セッションの未コミット差分（settings/currency/MessageMetaHeader関連、後に codexbar/subagent-provider 関連へ変化）を確認し、lead-programmer への指示で対象ファイルを5つに限定・他ファイル編集禁止を明記した。実装完了後も自分の5ファイルの diff 行数（318+/24-）がlead-programmerの報告と一致することを確認してからステージ・コミットし、他セッション差分の混入を防いだ。
- 初回のコミットで `$(cat <<'EOF' ... EOF)` 形式のヒアドキュメントを bash ツール経由のコミットメッセージに使ったところ、シェルが正しく解釈せずコミットメッセージが壊れた（`git log` で確認して発覚）。`git commit --amend -m "..." -m "..."` の複数 `-m` 形式で修正。**この環境のシェル経由コミットではヒアドキュメント構文を使わず、複数行は `-m` を複数回渡す**。
- Task（サブエージェント委任）ツールが2回連続で無言終了（結果が空）した。学習済みルール通り同一エージェントへ再試行せず別モデルへ切り替えたが、それも空振りしたため、探索作業は自分で Grep/Glob/Read ツールを直接使って進めた。この環境ではTaskの結果が返らないことがあるため、探索系の委任が無反応の場合は早めに直接ツールへ切り替える判断が有効だった。
- 既存プロジェクト内に同種の `ProviderIcon` 実装が `MessageMetaHeader.tsx` / `HomeView.tsx`（`ModelSelectIcon`）/ `TaskView.tsx` に重複して存在しており、他セッションが `web/src/components/task/ProviderIcon.tsx` という共通コンポーネントを新規作成中だった（本セッション完了時点で未コミット）。今後、共通化されたら Sidebar のローカル実装をそちらに差し替える余地がある。

---


## 2026-07-19 ホーム composer ツールバー 2 段化（完了）

### 結果
- ブランチ: `feature/home-composer-toolbar-two-row`
- 仕様: `docs/superpowers/specs/2026-07-19-home-composer-toolbar-two-row-design.md`
- 計画: `docs/superpowers/plans/2026-07-19-home-composer-toolbar-two-row.md`
- 最終レビュー: Approved（`IntelligenceSelect` の `w-full` 削除をマージ前に反映済み `dfa747c`）

### 実装要点
- HomeView フッターを固定 2 段（1: 添付/プロジェクト/作業場所 + 送信、2: モデル/知性/エージェント/アクセスモード）
- row-2 の固定 `max-w-[*]` を外し、`title` で全文表示
- TaskView は対象外
- 検証: Vitest HomeView 6/6、Playwright `composer.spec.ts` 12/12

### 次
- master へのマージ or PR（ユーザー選択待ち）

---


## 2026-07-19 JPY コスト表示の既定化と USD/JPY 自動取得

### 実装
- コスト表示の既定を `JPY + rateMode: "auto" + 150` に変更。USD を明示した設定だけを USD とし、旧設定で `rateMode` がない場合は意図しない自動更新を避けるため `manual` として扱う。
- `GET /api/fx/usd-jpy` を BFF として追加。Frankfurter から USD/JPY を取得し、JST 日付ごとのキャッシュと 1–1000 のレート検証を行う。
- Settings で「自動（本日）」と「手動」を切り替え可能にした。自動では初期表示・切替時にレートを取得して設定へ保存し、手動では blur / Enter で保存する。世代カウンターにより古い取得結果が新しい状態を上書きしない。
- 表示・テストを新しい既定に更新し、USD を期待するテストでは `USD + manual` を明示する。

### 設計判断
- 表示通貨とレートモードの既定値は `DEFAULT_COST_PREFS` に一元化し、`formatCost` などの呼び出し側で個別の既定値を持たない。
- 外部為替 API はブラウザから直接呼ばず、BFF 経由にして取得・検証・キャッシュの責務を集約する。

### 最終検証
- `npx vitest run src/lib/currency.test.ts src/lib/fx-usd-jpy.test.ts src/app/api/fx/usd-jpy/route.test.ts` — 3 files / 19 tests PASS
- `npx tsc --noEmit` — PASS
- `npx eslint src/lib/currency.ts src/lib/fx-usd-jpy.ts src/app/api/fx/usd-jpy/route.ts src/components/settings/SettingsView.tsx` — PASS

---

## 2026-07-19 Ollama/OpenCode をコーディング能力順に変更

### やったこと
- `model-options.ts` の GLM ベーススコアを 320k → 360k に上げ、OpenCode/Codex 系のコーディング能力目安順に合わせた:
  GLM-5.2 → DeepSeek-V4-Pro → Kimi-K2.7-Code → DeepSeek-V4-Flash
- ユニットテスト更新（11件 pass）。本番ビルド＋WebUI 再起動で反映。

### 判断理由
- 旧ヒューリスティックは DeepSeek Pro を GLM より上にしていたが、ユーザー指定のコーディング能力順では GLM が先頭。

### 教訓
- 「賢い順」と「コーディング能力順」は一致しない。クラウド系は用途別の明示順を優先する。

---

## 2026-07-19 モデル並び順を Sol → Terra → Luna → 5.5 に変更

### やったこと
- `model-options.ts` の GPT ヒューリスティックを変更。旧順は Sol > 5.5 > Terra > Luna（5.5 を「系譜の旗艦」扱いで Terra より上にしていた）。
- 新順: Sol → Terra → Luna → 5.5（その他非コードネーム GPT）。ユニットテストも同順に更新（11件 pass）。
- 本番: `npm run build` → `POST /api/host/restart` target=webui（BUILD_ID 11:12:42）。ブラウザはハードリロード推奨。

### 判断理由
- 利用頻度・推奨順のユーザー指定。5.5 は 5.6 コードネーム群の後ろに置く。

### 教訓
- 「賢い順」ヒューリスティックはユーザーの推奨順とズレうる。明示順があるならスコアをそれに合わせる。
- ソース変更だけでは本番ドロップダウンは変わらない。production build + WebUI 再起動が必要。

---

## 2026-07-19 フロントエンド崩壊（壊れた `.next` / 競合 Next プロセス）

### 症状
- `/api/tasks` が 500、`/task/[id]` が 500。ホームは 200 でもタスク一覧が取れない。
- `web/dev-review.log`: `Cannot find module './712.js'`（`webpack-runtime.js` から）、webpack cache の `EPERM`/`ENOENT`、Jest worker 例外。

### 原因（ランタイム証拠）
- `.next/server/webpack-runtime.js` が `./712.js`（`server/712.js`）を要求するが、実体は `server/chunks/712.js` のみ → 開発/本番・複数 `next` インスタンスが同一 `.next` を共有してキャッシュ不整合。
- 同時に `next dev`（:3000 他）と孤児 `next start`/`dev`（3100/3101/3102/3110/3200）が並走。OneDrive 配下での PackFileCache rename 失敗も併発。
- ホスト（PID 37388）は生きていたが WebUI 子が落ちたまま（OpenCode は 4099、Caddy/tray のみ）で lock が残っていた。

### やったこと
1. OpenCodeWebUI 配下の競合 `next` プロセスをすべて停止。
2. 壊れた `web/.next` を `web/.next-broken-712-20260719-105859` へ退避（削除せず。過去の ACL/OneDrive 知見に従う）。
3. `web/` で `npm run build`（Next 15.5.20）成功。
4. 劣化ホストを tree kill → `host.lock` 削除 → `start-webui.bat` で本番再起動。

### 検証
- `GET /api/tasks` 200、`GET /` 200、`GET /task/...` 200、OpenCode `global/health` healthy。

### 教訓
- 同一 `web/.next` に複数の `next dev`/`start` を立てない。壊れたら削除より rename 退避→クリーンビルド→ホスト再起動。
- 「ホストは動いているが画面が死んでいる」ときは lock PID の子に WebUI がいるかを先に見る。

---

## 2026-07-19 Haiku だけ「(latest)」と表示される不具合

### やったこと
- 実 API（`/api/opencode/provider`）で確認: Anthropic の `claude-haiku-4-5` だけ `name` が `Claude Haiku 4.5 (latest)`。Opus/Sonnet/Fable には無し。WebUI は `m.name` をそのままラベルにしていた。
- `formatModelLabel` を `model-options.ts` に追加し、末尾の `(latest)` を表示ラベルから除去。Home / Task / Settings の3箇所で適用。`value`（modelID）は変更しない。
- ユニットテスト3件追加（計11件 pass）。

### 判断理由
- 根本は upstream OpenCode の命名非対称。UI一貫性のため表示名だけ正規化し、エンジンが返す ID はそのまま使う。

### 教訓
- モデル表示の不揃いは WebUI フォーマットより provider カタログの `name` を先に疑う。

---

## 2026-07-19 症状C（SSE/UI断絶）対策を実装

### やったこと
- `NestedAgentPanel`: タブ非表示時は2sポーリングを止め、`visibilitychange`で復帰時に即時再取得（GraphPanelと同パターン）。子GETに15s timeout。
- BFF SSEプロキシ: 15s周期で named `heartbeat` イベントを送出（コメント行は EventSource が無視するため named event）。
- `useSessionStream`: heartbeat/メッセージで最終活動時刻を更新。45s無音かつ OPEN なら再接続＋resync。タブ復帰時も resync。強制再接続時は onerror の二重スケジュールを抑止。
- 共通: `sse-health.ts`（閾値・encode・可視判定）。テスト10件追加。全339 tests pass。`architecture.md` §8.1 を更新。

### 判断理由
- 症状Cは「子が死んでいる」ではなく表示/接続層。親スキルでは解けないため WebUI 側で対処。
- heartbeat を named event にしたのは、SSE comment ではクライアントの無音検知が動かないため。

### 教訓
- 背景タブの setInterval 間引きと SSE サイレント切断は別原因だが、どちらも「サブエージェントが止まった」に見える。可視性＋heartbeat＋timeout をセットで入れる。

### 反映
- production 反映には WebUI 再ビルド＋再起動が必要。

---

## 2026-07-19 サブエージェント長時間無応答の調査（修正なし）

### やったこと
- 症状を既存設計どおり **A（子の実質失敗/空/不完全）** と **C（SSE/UI だけ止まる）** に分けてコード追跡。修正は行わず根本原因の切り分けまで実施。
- 主要経路を確認: 親は `useSessionStream` のルート SSE のみ、子は `NestedAgentPanel` の 2s REST ポーリング（`architecture.md` §8.1）。同期 `task` 中は親がブロックされ自己 abort 不可（設計正本どおり）。
- コード根拠で有力ギャップを特定（症状 C 系）:
  1. `NestedAgentPanel` に `visibilitychange` が無い（`GraphPanel`/`Sidebar`/`TaskView` にはある）。背景タブで interval が間引かれ、復帰時の即時再取得も無い → 「子が止まった」ように見える。
  2. SSE プロキシは初回 `: connected` のみで周期ハートビート無し。`EventSource.onerror` は接続が閉じたときだけ → サイレント切断で `task` status が `running` 固着し Nested が無限ポーリング。
  3. `ocJson` に Abort/timeout 無し → エンジン遅延が UI にそのまま伝播し得る。
- 症状 A は既に docs のみの回復手順あり（`docs/agent-guidance/subagent-stall-recovery.md`）。症状 C は設計で明示的に deferred。

### 判断理由
- 「無応答」は単一バグではなく A/C の混同が調査を迷わせる。今回は再現手順が無いため runtime 修正に入らず、次の修正候補を層ごとに固定した。

### 次の一手（要ユーザー確認の症状切り分け）
- **画面のスピナーだけ止まる／タブ復帰後も古い** → 症状 C。優先修正候補: NestedAgentPanel の可視性連動ポーリング、SSE 周期 heartbeat + 無音検知後 resync、`ocJson` timeout。
- **Stop 後に子結果が空・エラーで親が止まる** → 症状 A。親へ `subagent-stall-recovery.prompt.md` 取り込み＋縮約再委任（WebUI 変更不要）。
- **エンジン自体が子セッションで idle のまま** → OpenCode 本体側（本リポジトリ外）。現状 WebUI に子 idle タイムアウトは無い。

### 教訓
- サブエージェント問題は「エンジンハング」と「表示が追いつかない」を先に分ける。後者は NestedAgent のポーリング設計とルート SSE 健全性の両方が絡む。

---

## 2026-07-19 モデル選択ドロップダウンの並びを固定

### やったこと
- `web/src/lib/model-options.ts` を追加。プロバイダ順を OpenAI → Anthropic → Ollama → OpenCode → Cursor に固定し、各プロバイダ内はモデル名ヒューリスティックで賢い順にソート。
- Home / Task / Settings のモデル `GhostSelect` 構築時に `sortModelOptions` を適用。`ollama-cloud` / `opencode-go` / `cursor-acp` などのエイリアスも正規化。
- ユニットテスト 8 件を追加（`model-options.test.ts`）。

### 判断理由
- API の返却順に依存すると接続状態で並びが変わり、毎回探して選ぶコストが高い。利用頻度の高いクラウド frontier を先頭に、ローカル/ACP 系を後ろに置く。

### 教訓
- モデル順は exact ID リストより名前ヒューリスティック（sol/terra/luna、fable/opus/sonnet/haiku、pro/flash）の方が新モデル追加に強い。接続中モデルで回帰テストを書く。

---

## 2026-07-18 最小化 CodexBar をサイドバー左下へ固定

### やったこと
- `Sidebar` のPluginHostをスクロール領域から外し、サイドバーフッターへ移動。最小化CodexBarピルをPC・モバイルdrawerとも左下へ固定した。
- production buildで `.next` の削除ACLにより通常ビルドが失敗したため、別distで成功ビルド→削除なしコピー同期→WebUI再起動で安全に反映した。
- 実URLのPlaywright確認で、desktop（1600x1000）とmobile（390x844）の両方でサイドバー最下部48px以内に配置され、ブラウザエラーなしを確認。

### 判断理由
- 利用状況の最小化ピルはプロジェクト一覧を妨げないサイドバー最下部が最も発見しやすく、composerやチャット領域と干渉しない。

### 教訓
- `.next` に削除拒否ACLがある環境では、別distでビルドして削除なし同期する回復策を使う。恒久ACL変更は明示承認後に検討する。

---

## 2026-07-18 セッションごとの累計コスト表示UIを追加

### やったこと
- 既存の per-message cost（`m.info.cost`）とは別に、OpenCode の `Session.cost`（セッション単位でエンジンが集計済みの累計USD）を取得・表示するUIを追加。
- `task-service.ts` に `sessionCostFor(dirs)` を新設（`GET /session`（ディレクトリ単位）を叩き `sessionId→cost` map を作成、既存 `sessionStatusFor` と同じ best-effort 方針）。`TaskSummary.cost` として `listTasks()`/`getTask()` の両方に配線。
- `currency.ts` に `formatCostValue`（"cost "ラベル無しの金額のみ）と `useCostDisplayPrefs()`（Settings の通貨設定を `COST_DISPLAY_EVENT` で同期する共有フック）を追加。`TaskView.tsx` の重複した costPrefs state/effect をこのフックに置き換え。
- UI: サイドバーの各タスク行（ブランチラベルの隣）と TaskView ヘッダー（ブランチ/プロジェクト名の行）に `task.cost` がある場合のみ「· $X.XXXX」を表示。cost が無い/0のタスクはバッジ非表示（新規セッションで違和感を出さない）。
- テスト: `task-service.test.ts` 新規5件（cost付与・セッション不一致・API失敗時の非throw・binding無し）、`currency.test.ts` に `formatCostValue`/`useCostDisplayPrefs` を追加、`Sidebar.test.tsx` に表示/非表示2件追加。vitest 42 files / 252 tests pass、`tsc --noEmit` / `eslint` / `next build` クリーン。

### 判断理由
- メッセージ単位のコストを自前で合算せず、OpenCode 自身が管理する `Session.cost` を採用（集計ロジックの二重化・ズレを避ける）。
- costPrefs の読み書きロジックが TaskView に加えて Sidebar でも必要になったため、この時点で共有フックへ抽出（3箇所目の重複が出る前に先んじてDRY化）。

### 教訓
- RTL で同一 describe 内に複数 `render()` を追加する際は `afterEach(cleanup)` を入れないと、`screen` のグローバルクエリに前のテストのDOMが残り誤判定する（本プロジェクトは `testing-library/jest-dom` 未セットアップのため `toBeInTheDocument` 等は使わず `toBeTruthy()`/`toBeNull()` で統一する）。

---

## 2026-07-18 worktreeバグの残骸（stray git worktree）を除去 + UI掃除機能を追加

### やったこと
- 実残骸を特定: このリポジトリ自身のプロジェクト行（root_path=当リポジトリ）に紐づく3つのworktree（`webui__master__git-3030bedc` / `test-6b308905` / `test-bbae6694`）が `%APPDATA%\opencode-webui\worktrees\<projectId>\` 配下に残存。DB `workspaces` テーブルに対応行なし（＝直前のバグで `git worktree add` 後 `assertAllowedDirectory` 403 で `createWorkspace` に到達できなかった残骸）。
- 除去: `git worktree remove --force` は `.git/worktrees/<name>` 管理ディレクトリ削除で `Permission denied`（OneDrive reparse point起因、git.ts の `removeWorktree` が本来リトライで解消する既知パターン）。`attrib -r -s -h /s /d` で読み取り専用属性を解除後 `rmdir /s /q` で3件とも削除し、`git worktree list` / dataDir 双方が空になったことを確認。
- 恒久修正（本質的な欠陥）: 設定画面の「orphan を掃除」ボタンは `orphans.length===0` で disabled になり、DB行の無い stray worktree は**UIから一切掃除する手段が無かった**（検出のみで実行動線が無い）。`GET /api/workspaces/orphans` の stray 検出ロジックを `findStrayWorktrees()` に共通化し、新規 `cleanupStrayWorktrees()`（既存の read-only 属性リトライ付き `removeWorktree()` を再利用）を実装。POST `{action:"cleanup"}`（idsなし＝一括掃除時のみ）で stray も併せて除去するようにし、ボタンの disabled 条件も `stray.length===0` を追加考慮に変更。
- テスト: `route.test.ts` 新規5件（stray検出2件・cleanup成功/失敗/idsターゲット時のスキップ3件）。vitest 41 files / 241 tests pass、`tsc --noEmit` / `eslint` クリーン。

### 判断理由
- stray除去は既存 `removeWorktree()`（Windows/OneDrive読み取り専用リトライ済み）を再利用し、新規ロジックを持ち込まない。GET（受動的なsettings表示）では削除せず、POST cleanup（明示的なユーザー操作）でのみ削除することで、provisionWorkspace実行中の一瞬の未整合を誤って削除するリスクを避けた。

### 教訓
- バグ修正時は「発生済みの残骸」と「今後も同種の残骸が起きた場合の掃除導線」の両方を確認する。検出UIはあっても実行導線が無ければ、ユーザーは毎回手動git操作を強いられる。

---

## 2026-07-18 worktree開始時のセッション開始不能バグ修正

### やったこと
- 原因特定: 9336e84 で新規worktreeを `<dataDir>/worktrees/` へ移設した際、`assertAllowedDirectory` が allowlist 外として403を返し、`provisionWorkspace` の `pathCheck` で失敗 → POST /api/tasks（git_worktree isolation）が常に失敗していた。
- 修正1: `allowlist.ts` に `<dataDir>/worktrees` を暗黙の許可ベースとして追加（`removeWorktree` の defense-in-depth と同じ境界。ユーザーroot未設定時の403ゲートは維持）。
- 修正2: `project-session-sync.ts` の manifest 復元ガードも新ロケーションを信頼対象に追加（旧前提のままだと復元時にworktreeワークスペースが全スキップされる2次バグ）。
- テスト: `allowlist.test.ts` に3ケース追加、`project-session-sync.test.ts` を新規作成（復元ガード3ケース）。vitest 40 files / 236 tests pass、`tsc --noEmit` クリーン。

### 判断理由
- provision時に `addAllowedRoot` する方式（temporary_copy と同様）より、固定ベースの暗黙許可の方が状態を持たず、削除失敗時の allowed_roots 汚染も無い。worktreeベース配下は本アプリのみが作成するため境界として安全。

### 教訓
- パスのロケーション移設時は、検証・制限箇所（allowlist / 復元ガード / 削除ガード）を全箇所洗い出して同じ境界定義に揃える（LESSONS.md に新規エントリ追加）。

---

## 2026-07-18 CodexBar のサイドバー常設化と本番検証

### やったこと
- CodexBarを固定オーバーレイから、サイドバーの「プロジェクトを追加」直下へ移設。モバイルでは同じ位置のdrawer内に表示する。
- 設定画面での非表示、サイドバー内の横あふれ、desktop/mobileの位置関係をユニット/E2Eで追加検証。
- production buildとWebUI再起動後、実URLでdesktop・mobileともサイドバー内に収まりcomposerと重ならないことを確認。

### 判断理由
- viewport幅でfixed overlayを退避する方式は、composerとの干渉を画面サイズごとに再発させた。常設のサイドバー領域が利用状況表示の情報密度と非干渉を両立する。

### 教訓
- 同型の指摘が3回に達したため、`LESSONS.md` のルールを `prompts/build.md` に昇格した。

---

## 2026-07-18 サブエージェント無応答回復ガイドの配備完了

### やったこと
- `docs/agent-guidance/README.md` と貼り付け用 `subagent-stall-recovery.prompt.md` を追加済み（Task 2）
- フルガイドに手動検証表を追加済み（Task 3, `57ced55`）
- ファイル存在と architecture 参照を確認: README / フルガイド / prompt / 設計正本いずれも True、`architecture.md` に `subagent-stall-recovery` マッチあり
- 手動シナリオ 1〜3: **未実施**（親エージェントへの prompt 取り込み＋実エンジン対話が必要。ガイドと存在確認まで完了）

### 判断理由
- 仕様どおり WebUI 非変更。親への取り込みは人手（OpenCode agent instructions）が前提。

### 教訓
- 同期 task 待ち中は親が動けないため、回復は失敗返却と Stop 後に限定する。
- Subagent-Driven 実行中に Task ツール枠が尽きた場合はコントローラが残りタスクをインライン完了し、ledger に記録する。

---

## 2026-07-18 Task 2: 発見可能性（README + 貼り付け用プロンプト）

### やったこと
- `docs/agent-guidance/README.md` を新設（ガイド索引・取り込み方・SSE/UI 対象外の明記）。
- `docs/agent-guidance/subagent-stall-recovery.prompt.md` を新設（親 instructions へ貼る 30 行の断片）。
- `subagent-stall-recovery.md` 冒頭に prompt への 1 行リンクを追加。
- 報告: `.superpowers/sdd/task-2-report.md`

### 判断理由
- Task 1 で仕様適合済みのフルガイドを、README 索引と短い prompt 断片で発見・取り込みしやすくする docs-only 改善。ランタイム変更は不要。

### 教訓
- 発見性は README 索引 + 貼り付け用 `.prompt.md` + フルガイド冒頭リンクの 3 点セットが最小で効く。prompt は 40 行以内を目安にフルガイドの判断根拠はリンク先へ委ねる。

### 関連コミット
- `92de5a1` 親エージェント向けの再委任プロンプト断片と案内を追加

---

## 2026-07-18 Task 1: サブエージェント回復ドキュメントの仕様適合チェック

### やったこと
- `.superpowers/sdd/task-1-brief.md` のチェックリスト 7 項目を設計・運用ガイド・architecture §8.1 に照合。全項目 OK、修正不要。
- 報告: `.superpowers/sdd/task-1-report.md`

### 判断理由
- 症状 A in / C out、回復トリガ（失敗・空・不完全・Stop 後）、再試行上限 2、再委任雛形、escalate、§8.1 リンク、親の自己時計 abort 不可はいずれも文書間で整合。ガイドは「症状 A/C」字母を使わないが prose で同等のスコープ境界を満たす。

### 教訓
- docs-only 適合チェックは意味的一致を優先し、設計正本の記号（A/C）を運用ガイドが prose で言い換えているだけなら fix 不要。

---

## 2026-07-18 サブエージェント無応答時の回復設計（親任せ）

### やったこと
- ブレインストーミングで方針を確定: 対象は症状 A（子の失敗／空／不完全）。症状 C（SSE/UI 断絶）はスコープ外。
- 回復主体は親エージェント（案2）。WebUI の stall 監視・ワンクリック再委任は作らない。
- 仕様: `docs/superpowers/specs/2026-07-18-subagent-stall-recovery-design.md`
- 運用ガイド: `docs/agent-guidance/subagent-stall-recovery.md`（再委任雛形・上限2回・escalate）
- `architecture.md` §8.1 に参照段落を追加

### 判断理由
- 同期 `task` 中は親がブロックされるため「2〜3分で自己 abort」はエンジンが制御を返さない限り不可。回復は失敗返却／Stop 後に限定するのが現実的。
- UI 半自動（案1）は A+C に強いが、ユーザーが案2＋C除外を選択したためドキュメントのみで閉じる。

### 教訓
- 「フリーズ対策」と言っても A（子無応答）と C（UI断絶）は別レイヤ。後者は親スキルでは解けない。

---

## 2026-07-18 一時ファイル掃除と CodexBar サイドバー移設の整理

### やったこと
- コミット対象外の一時ファイルを削除: `web/*.log`（build/error/stderr/vitest 等）、`.superpowers/`（エージェントスクラッチ）、空の `web/test-results/`。
- いずれも `.gitignore` 済みのため git 差分は出ない。`.next` や runtime 状態（`.opencode-webui` 等）は残した。
- 未コミットだった CodexBar のサイドバー移設（`PluginHost` を `Sidebar` 内へ、右下オーバーレイ廃止）とテストをコミット対象に含めた。

### 判断理由
- ログとエージェント差分スクラッチは再現可能な作業痕跡で、リポジトリを汚すだけ。ビルド成果物とセッション状態は開発継続に必要なので掃除対象外。

---

## 2026-07-18 コミットメッセージを日本語に統一

### やったこと
- 今後の git コミットメッセージを常に日本語にする方針を確定。
- プロジェクトルール `.cursor/rules/japanese-commits.mdc`（alwaysApply）を追加。

### 判断理由
- リポジトリ履歴と会話言語（日本語）を揃えると、変更意図が追いやすい。

---

## 2026-07-18 サブエージェント実行中UIを時系列タイムライン化

### やったこと
- サブエージェント（`task` ツール / 子セッション）を、主セッション（build）と同様に `PartView` で時系列表示するよう大幅改善。
- `NestedAgentPanel` の「最新1行要約」を廃止し、子の全メッセージを 2s ポーリングで取得して描画。
- 各 `task` 行を明示 ID → タイトル → 兄弟順序で **1子だけ** に紐付け（並行 task の混在を防止）。
- 完了後も折りたたみ詳細内でタイムラインを再表示可能。
- 設計: `docs/superpowers/specs/2026-07-18-subagent-timeline-design.md` / 計画: `docs/superpowers/plans/2026-07-18-subagent-timeline.md`
- 主要実装: `match-child-session.ts`(+test)、`NestedAgentPanel.tsx`、`PartView.tsx`、`TaskView.tsx`、`architecture.md` §8.1

### 判断理由
- architecture §8.1 の「子に SSE を張らない」を維持しつつ、表示粒度だけ主タイムラインに揃えるのが最小リスク。
- `PartView` 再利用で tool/text/reasoning の見た目・操作を build と一致させた。

### 教訓
- `NestedAgentPanel` ↔ `PartView` の循環 import はクライアントコンポーネントでは実行時に成立するが、`matchHint` のオブジェクト参照でポーリング effect がリセットされないよう依存は primitive に落とす。

### 検証
- `tsc --noEmit` クリーン、`vitest match-child-session` 9 tests PASS、対象 eslint クリーン。
- 実画面反映には WebUI 再ビルド＋ホスト再起動が必要。

---

## 2026-07-18 タブレット幅の CodexBar composer 重なりを修正

### やったこと
- タブレット幅のスクリーンショットで、`sm`（640px）以上で右下へ戻るCSSがcomposerと重なることを確認。
- `/task/*` ではviewport幅に関係なくCodexBarを safe-area + 9rem 上へ固定し、ホームなどの非タスク画面だけ従来の右下配置にした。
- production build・WebUI再起動後、Playwright 1280x836でCodexBar下端692px / composer input上端734px、重なりなしを確認。

### 判断理由
- composerはタスク画面で常に下端固定のため、ブレークポイントでCodexBarの下端配置へ戻す設計は不適切。route単位で位置を決める。

### 教訓
- 同型のユーザー指摘が2回となったため、`LESSONS.md` に pain_count: 2 として記録。次の同型失敗で `prompts/build.md` へ昇格する。

---

## 2026-07-18 モバイルCodexBar修正の本番反映

### やったこと
- 「再起動しても変わらない」報告を受け、ソース更新時刻より `.next/BUILD_ID` が古いことを確認。
- `web` で `npm run build` を実行し、host control (`POST /restart/webui`) でWebUIだけを再起動。
- Playwrightの390x844実機相当viewportでHTTPS URLを検証し、CodexBarピル bottom=700px・composer input top=742px、重なりなしを確認。

### 判断理由
- トレイ/WebUIの再起動は既存のproduction buildを再読込するだけで、`npm run build` を実行しなければ新しいソース変更は配信されない。

### 教訓
- 本番起動中のUI変更は「ビルド→対象サービス再起動→実URL/モバイルviewport検証」までを一連で行う。

---

## 2026-07-18 CodexBar ピルのモバイル composer 重なりを修正

### やったこと
- スクリーンショットで、縮小状態のCodexBarピルがフォローアップ入力欄の操作列と重なることを確認。
- `PluginHost` をモバイル時だけ safe-area + 9rem 上へ固定し、composerの上側へ退避。`sm` 以上の右下配置は維持。

### 判断理由
- パネル横幅のresponsive化だけでは、固定配置の縮小ピルと下部composerの垂直方向の衝突を解消できなかった。

### 教訓
- モバイルの固定オーバーレイは展開時だけでなく、縮小ピル状態でも固定composerとの垂直干渉を実画面で確認する。

---

## 2026-07-18 WebUI/OpenCode 個別再起動（トレイ + 設定）

### やったこと
- トレイメニューの単一「Restart」を **Restart WebUI** / **Restart OpenCode** / **Restart all** に分割。
- ホストに localhost 制御 API（既定 `127.0.0.1:18765`）を追加。`POST /restart/webui|opencode|all`、`GET /health`。
- WebUI 設定 > エンジンに「WebUI を再起動」「OpenCode を再起動」「すべて再起動」ボタンを追加（`/api/host` / `/api/host/restart` 経由）。
- reuse（他ホスト由来の子プロセス）でもポート listen PID を解決して kill できるよう `resolveKillPids` を導入。

### 判断理由
- architecture の「BFF のみ再起動」要件に合わせ、OpenCode を落とさず WebUI だけ直せるようにした。
- WebUI からホストを操作するには IPC が必要なため、127.0.0.1 限定の制御ポート + `%APPDATA%/opencode-webui/host-control.json` で発見可能にした。

### 教訓
- WebUI 再起動は制御 API が **202 を先に返してから** kill しないと、呼び出し側がレスポンスを受け取れない。

---

## 2026-07-18 CodexBar のスマホ重なりを防止

### やったこと
- `PluginHost` をスマホ幅では全幅コンテナ＋左右余白にし、プラグインを画面端で切らないようにした。
- CodexBar の展開パネルをスマホでは `calc(100vw - 2rem)`、`sm` 以上では従来の288pxにした。
- プロバイダ名を可変幅・省略可能にし、プランバッジも最大幅を制限して使用率や操作アイコンへの重なりを防いだ。

### 判断理由
- 固定288pxパネルと幅制約のない横並び要素が、狭い画面で表示領域・使用率・操作アイコンを圧迫していた。
- PCの既存配置は `sm` ブレークポイントで維持し、モバイルだけを流動幅にした。

### 教訓
- 固定オーバーレイはモバイル時に親幅・子幅・横並び要素の縮小規則をセットで定義する。

---

## 2026-07-18 サイドバー操作ボタン常時表示・右上集約

### やったこと
- `Sidebar.tsx` のプロジェクト行: お気に入り・削除の `md:opacity-0` / `group-hover` を削除し常時表示。
- タスク行: タイトル再生成・削除を absolute + ホバー表示から、行右上の flex グループへ集約して常時表示。
- E2E（`sidebar.spec.ts` / `session-title-refresh.spec.ts`）をホバー前提から常時表示前提に更新。

### 判断理由
- デスクトップでホバー必須だと発見しづらく、タイトルと absolute ボタンが重なっていた。
- お気に入りはプロジェクト単位、タイトル生成はタスク単位のまま（データモデル変更なし）。

---

## 2026-07-18 質問ツール表示バグ（「確認 回答待ち」+ SchemaError）

タイムラインで `question` ツールが SchemaError（`Missing key at ["questions"][0]["question"]`）なのにヘッダが「確認 回答待ち」になり、回答待ちに見えていた。

### 原因
- LLM 側の不正引数で tool part は `status: "error"`（本物の `question.asked` / QuestionCard ではない）
- `PartView.toolSummary` が `input.question`（存在しないトップレベル）を見てフォールバック `"回答待ち"` を出していた。正しくは `input.questions[0].question`

### 修正
- `web/src/components/task/tool-part-summary.ts` 新設: `questions[]` から要約、error 時は「引数が不正です」等
- `PartView.tsx` の question 分岐を差し替え、`inputFields` も `questions[]` 対応

### 検証
- vitest `tool-part-summary.test.ts` 7 tests PASS、`next build` 成功

---

## 2026-07-18 会話タイトル再生成を日本語化

### やったこと
- `refresh-title` API のタイトル生成 system prompt を英語指定から日本語指定へ変更。
- 最大8 words ではなく「最大20文字程度」「タイトルのみ・引用符/説明不要」と明示。
- 既存のタイトル再生成テストで、日本語タイトルが返ることと prompt に「日本語タイトル」が含まれることを確認。

### 判断理由
- UI が日本語中心のため、会話から再生成するタイトルも日本語に揃える方が一覧で読みやすい。
- 生成後の sanitize/保存フローは既存処理を維持し、生成指示だけを最小変更した。

### 教訓
- LLM 出力言語はUI言語に合わせて system prompt 側で明示し、テストでも prompt の言語指定を確認する。

---

## 2026-07-18 ポート4096幽霊ソケットでホスト起動失敗

`start-webui.bat` が `Port 4096 is in use but OpenCode health check failed` で即終了。

### 原因
- `127.0.0.1:4096` が LISTENING のまま残っていたが、OwningProcess PID（40780）は既に死んでいた（Windows の ghost TCP socket）。
- health (`/global/health`) はタイムアウト。`taskkill` / WinNat 再起動でも解放不可。再起動以外ではポート自体は空けられない。
- 旧 `resolvePortPlan()` は「使用中かつ unhealthy → throw」だけだったため、幽霊ポートで起動不能になっていた。

### 修正（host）
- `host/src/port-plan.js`: `netstat -ano` の LISTENING PID 解析（`:40960` 誤マッチ防止）
- `resolveOccupiedPort()`: unhealthy かつ生存 PID → kill して再利用 / ghost → 次の空きポートへフォールバック
- WebUI 起動 env に `OPENCODE_BASE_URL` / `OPENCODE_PORT` を渡し、フォールバック先（例: 4097）を BFF が追従
- `OPENCODE_PORT` 環境変数で既定ポート上書き可能

### 検証
- `node --test`（host）6 tests PASS
- 実起動: `Falling back to :4097` → OpenCode `listening on :4097` / WebUI `:3000` Ready

### 運用メモ
- 4096 の幽霊ソケットは OS 再起動で消える。それまではホストが自動で 4097+ に退避する。
- 根本解消したい場合は Windows 再起動を推奨。

---

## 2026-07-18 UI 4点改善（ブランド名・デフォルトモデル・右パネル状態維持・プロバイダアイコン）

ユーザー要望4件を実装。いずれも web フロントエンドのみ。

### やったこと
- **ブランド名**: 左サイドバー `Sidebar.tsx`、モバイルヘッダ `AppShell.tsx`、`layout.tsx` の appleWebApp.title、`manifest.ts` の short_name、`TaskView.tsx` のタブタイトルを `OpenCode` → `OpenCodeWebUI` に変更。`metadata.title` は元から `OpenCode WebUI` だったが TaskView の document.title 周りも `OpenCodeWebUI` に統一。内部識別子（API パス `/api/opencode`、プロバイダ名 `opencode-go`、SettingsView の「OpenCode のコスト」等）はユーザー目線のブランド表示ではないため変更せず。
- **デフォルト選択モデル**: `lib/default-model.ts` 新設（localStorage `webui:default-model`、CustomEvent `webui:default-model` で他画面へ即時反映）。`SettingsView.tsx` に「デフォルトモデル」欄を追加（provider 一覧を `/api/opencode/provider` から取得、`GhostSelect` で選択、クリアボタン付き）。`HomeView.tsx`/`TaskView.tsx` の初期モデル決定で `readDefaultModel()` を OpenCode config.model より優先。TaskView は設定変更イベントを listen して開いているタスクの composer も追従（手動選択済みなら上書きしない）。OpenCode config への PATCH は BFF でブロック済み（`isBlockedOpencodeWrite`）のため localStorage 方式を採用。
- **右パネル状態のセッション切替時維持**: `lib/side-panel-state.ts` 新設。`sidePanel`（diff/files/pty/graph）・`showDiff`・`tab`（chat/diff）を localStorage に永続化。`TaskView.tsx` は page.tsx が `key={id}` で TaskView を再マウントするため、useState 初期値を固定値から `read*()` に切替、各 setter を `change*()` ラッパー経由で `write*()` するよう変更。これでタスク/セッション切替時も「ツリー表示を選択していたらその選択状態が維持」される。
- **モデル選択アイコンをプロバイダ別に**: `lib/plugins/codexbar.ts` に `providerIconSrcForOpencodeId()` を追加（OpenCode provider id → CodexBar ブランドアイコンキー `openai→codex`, `anthropic→claude`, `ollama→ollama`, `opencode-go→opencode` 等のマッピング）。`HomeView.tsx`/`TaskView.tsx`/`SettingsView.tsx` に `ModelSelectIcon`/`DefaultModelIcon` を追加し、モデル選択 `GhostSelect` の `icon` を汎用 `<Cpu/>` からプロバイダ別 PNG（`/plugins/codexbar/*.png`、壊れ時は Cpu/円 にフォールバック）に差替。エージェント選択は agent 名から provider が判定できないためユーザー合意で `<Bot/>` のまま維持。

### 判断理由
- デフォルトモデルを opencode config に書き込まず localStorage にした: BFF が `/config` PATCH を意図的にブロックしており、WebUI 側で完結する方が安全。ユーザーが opencode.json を直接編集した場合は `readDefaultModel()` が空なら config.model がフォールバック効く設計。
- 右パネル状態を URL ではなく localStorage にした: `key={id}` で TaskView が再マウントされる仕様上、state をコンポーネント外に持ち出す必要があり、localStorage が最小改修で要件を満たす。`sideWidth` と同じパターン。

### 検証
- `npm run typecheck`（tsc --noEmit）クリーン、`npm run lint`（eslint）クリーン、`npm test`（vitest）**19 files / 113 tests** 全通過。node_modules が未導入だったため `npm install` してから検証（node_modules は gitignore 済み）。
- コミット: `7cf828e`。作業ツリークリーン。

### 教訓
- node_modules 無し環境で `npx tsc` を叩くと別パッケージの tsc が応答して混乱する。`npm run typecheck`（package.json の `tsc --noEmit`）を使うか、先に `npm install` する。

---

## 2026-07-18 他セッション要求のグローバルモーダル表示

全ワークスペースを対象に、現在表示していないセッションで発生した `question` / `permission` を WebUI 内のキュー式モーダルで表示する機能を追加した。表示中セッションは従来の `TaskView` インライン表示のまま。モーダルは一時的に閉じられ、待機バッジから再表示。回答後も現在画面を維持。

### 主要ファイル
- `web/src/lib/attention.ts`: グローバルイベント解析、reply/reject パス解決、解決済み判定
- `web/src/lib/useAttentionQueue.ts`: キュー状態管理、タスク解決
- `web/src/components/shell/GlobalAttentionProvider.tsx`: `/api/opencode/global/event` 購読
- `web/src/components/shell/AttentionQueueModal.tsx`: 1 件ずつ表示するモーダル
- `web/src/components/shell/AttentionBadge.tsx`: 待機バッジ
- `web/src/components/shell/AppShell.tsx` / `ShellContext.tsx` / `Sidebar.tsx`: Provider 統合とバッジ配置
- `web/src/components/task/TaskView.tsx`: 表示中セッションの activeScope 配信

### 検証
- Vitest 24 files / 123 tests PASS、`tsc --noEmit` クリーン、Next production build 成功
- ESLint は warning 2 件（`GlobalAttentionProvider.tsx` / `ShellContext.tsx` の `useEffect`/`useMemo` dependency）だが、いずれも既存パターンと同一の挙動を保つため許容

### コミット
`8e95191` → `f39da2e` → `c96a969` → `c1bca8a` → `499eedd` → `0493603` → `e464304` → `f703627`

---

## 2026-07-17 徹底デバッグ監査ループ 完了（第7ラウンド＝新規バグゼロ／ループ停止）

前セッションがトークン制限で中断した「/loop 2m: サブエージェント徹底デバッグ→監査→完全にバグが無くなるまで」を引き継ぎ、計7ラウンドを実施して**収束完了**した。第7ラウンド（収束確認、[徹底デバッグ調査R7](fb9c192f-0114-416f-8e59-0f24600e6ff6)・完全読み取り専用）は、これまで未精査の領域（PartView の XML/JSON 抽出、Markdown、CommandPalette キーボードナビ、SessionSwitcher、AddProjectButton/SettingsView、client.ts、access-mode、favicon-badge/notify、remote/roots/access/health/codexbar ルート、codexbar/codex-tokens の数値境界、localStorage 破損耐性、日付/TZ・日本語エンコーディング境界）を精査し、**新規の確実な実バグはゼロ**と結論。監査でもゼロを確認したため、ループ（PID 15904）を停止した。

### 引き継ぎ後の全ラウンド累計（このセッションで修正した実バグ 12 件）
- 第1(R): 5件 — proxy query directory 正規化 / merge into=branch worktree checkout 409 / diff/files base 正規表現 / devcontainer JSONC / NestedAgentPanel status 増幅
- 第2(R): 3件 — orphans temporary_copy の removeAllowedRoot / getTask engineOk 統一 / browse/dirs files=1（FileTreePanel 機能化）
- 第4(R): 2件 — merge コンフリクト時 `merge --abort` / commit pathspec 限定
- 第5(R): 1件 — worktree ブランチ名の先頭ドット除去（ドットファイル系タイトルの 500 回避）
- 第6(R): 1件 — 劣化ホスト引き継ぎ時の Caddy 孤児化（stopStrayCaddy）
- 第7(R): 0件（収束確認）
- ※深刻度の推移: 初回 critical/high 混在 → medium → medium → medium → low → **ゼロ**。バグ密度は low 以下に収束。

### 最終検証（全緑）
- Web: Vitest **18 files / 107 tests** 全通過、`tsc --noEmit` クリーン、ESLint クリーン、Next 15.5.20 production build（`NEXT_DIST_DIR=.next-verify`）exit 0。
- Host: `node --check host/src/index.js` OK、`node --test` **5 tests** 全通過。
- コミット: `36e845c`(引継前) → `2b7def5` → `cca889d` → `f26a54d` → `ec173bd` → `c858ffb` → (本エントリ)。作業ツリーはクリーン。

### 運用メモ
- 各修正の実画面反映には**ホスト再起動が必要**（稼働 prod は旧 `.next`／host は旧コード）。次回 `start-webui.bat` 起動時、または host tree kill → lock 削除 → 再起動で反映。
- サブエージェントは読み取り専用指示でも一度 MEMORY.md を単独コミット（`dd1d960`）した実績あり。soft reset で取り消し済み。以降のプロンプトでコミット禁止を明示して再発なし。
- 保留中の low 改善提案（実バグではない）: SQLite `foreign_keys` PRAGMA 未有効化、copy.ts の Windows symlink EPERM/ルート名一致時の空コピー、各種 in-flight stale-response、resync v2→v1 降格。将来の機能追加時に個別対応を検討。

---

## 2026-07-17 サブエージェント徹底デバッグ + 監査（第6ラウンド／バグ1件修正）

/loop 2m の追tickで実施。読み取り専用サブエージェント（[徹底デバッグ調査R6](21917beb-34d6-4c9b-b49a-e36b729f4efa)・コード非変更）が host/lib/API を精査し「新規の critical/high/medium 実バグは無し、確実な新規実バグは low 1件」と報告。コードで検証し修正した。

### 修正した不具合
- **[low] 劣化ホスト引き継ぎ時に Caddy が孤児化し、新 Caddy が bind 失敗する** (`host/src/index.js`): トレイ無しの劣化ホストを引き継ぐ経路は host 本体のみ `taskkill /F`（`/T` なし）で終了し、子（OpenCode/WebUI/Caddy）を生かして再利用する設計。だが `resolvePortPlan()` は OpenCode/WebUI の2ポートしか再利用判定せず、`startChildren()` は `CADDY_ENABLED` なら無条件で `spawnCaddy()` する。旧 Caddy がポートを保持したままなので `caddy run` が bind エラーで即 exit → `caddyProc=null`、旧 Caddy はどのホストにも管理されない孤児として残留（Caddy ポートは Caddyfile 依存で host からは不定のため OpenCode/WebUI 式のポート再利用が難しい）。修正: 引き継ぎ経路（`CADDY_ENABLED` 時のみ）で孤児 Caddy を停止する `stopStrayCaddy()`（`taskkill /F /IM caddy.exe` best-effort）を追加し、新ホストが管理下の Caddy を fresh 起動できるようにした。通常の健全ホスト二重起動（`process.exit(0)` 退避）や正規 Restart/Quit（フルツリー kill）には非干渉。

### 検証
- `node --check host/src/index.js` OK、host `node --test` **5 tests** 全通過。web 非変更のため vitest/build は対象外。※実反映にはホスト再起動が必要。

### 監査で「実バグでない」と再確認した主な箇所（誤検知回避）
- proxy の directory 検証/SSE/content-encoding/config マスク、merge（checkout 409＋コンフリクト `--abort`＋復帰）、`git.ts`（removeWorktree ガード/quotepath/端末プロンプト無効化）、tasks/route の失敗時 `destroyWorkspace` 巻き戻し、useSessionStream の part マージ（id 一意・順序安定）・scope gate・stale ガード、db.ts の各 statement・bindSession 冪等/時刻保持、host の lock（creation-time 検証/wx 排他）・tray 再生成バックオフ・quit 順序・web-runtime の BUILD_ID 判定。
- 保留（実害限定/条件付き low）: copy.ts の Windows symlink EPERM・ルート名が除外名と一致時の空コピー、restore の docstring 冪等契約とのズレ（`restored` は UI 非表示）、SQLite FK PRAGMA。

---

## 2026-07-17 サブエージェント徹底デバッグ + 監査（第5ラウンド／バグ1件修正）

/loop 2m の追tickで実施。読み取り専用サブエージェント（[徹底デバッグ調査R5](b648149f-c9be-4d54-a3c4-adc48d14d5c8)・今回は指示どおりコード/コミット非実行）が新規の確実な実バグ medium 1 件を報告。コードで真偽検証し、実バグと確認して修正した。

### 修正した不具合
- **[medium] worktree ブランチ名生成が先頭ドットを除去せず、git が拒否する ref を作る** (`lib/workspace-branch.ts`): `sanitizeBranchSegment` が先頭/末尾の**ダッシュのみ**除去しドットを残すため、`.gitignore を修正` のようなドットファイル系タイトル/プロンプトで slug が `.gitignore` になり、`webui/main/.gitignore-<id8>` を生成。git の `check-ref-format` は「スラッシュ区切りの各コンポーネントはドット始まり不可」のため `addWorktree` が `fatal: not a valid branch name` で失敗 → **worktree タスク作成（既定の隔離方式）が HTTP 500**。`assertSafeBranchName` も先頭 `-`/`..` しか弾かず先頭ドットは素通り。修正: サニタイズの前後トリムを `/^[.-]+|[.-]+$/g` に拡張し、先頭/末尾のドットもダッシュと同様に除去（内部ドット `v1.2` 等は保持）。base セグメントにも同関数が効くため理論上の先頭ドット問題も同時に解消。`git check-ref-format` で実挙動確認済み。
- 回帰テスト（`workspace-branch.test.ts`）: 「`.gitignore` 始まり → `webui/main/gitignore-<id8>`（先頭ドット無し）」「`...`（サニタイズ後に空）→ `task` フォールバック」を追加 → 計 **107 tests**。

### 検証
- Vitest **18 files / 107 tests** 全通過、`tsc --noEmit` クリーン、ESLint クリーン（純粋関数の変更のためビルドは省略、型検査でカバー）。※実反映にはホスト再起動が必要。

### 監査で「実バグでない」と確認した主な箇所（誤検知回避）
- v2 permission/question 返信 URL・body 形（スキーマ整合）、`git/pr` の gh CLI 引数配列渡し（注入なし）、`git/commit` pathspec 限定・`git/merge` の `--abort`＋復帰（前ラウンド修正が正しく機能）、diff/files・codexbar tokens/usage・graph-layout・DiffPane 全選択判定・PermissionCard/QuestionCard v1/v2 分岐。

---

## 2026-07-17 サブエージェント徹底デバッグ + 監査（第4ラウンド／バグ2件修正）

/loop 2m の追tickで実施。読み取り専用サブエージェント（[徹底デバッグ調査R3](f0db682a-9bae-416b-bfa3-8e0ef8ac4010)）が重点領域（useSessionStream / db.ts / copy・quickaccess / git ルート / TaskView・CommandPalette・SessionSwitcher / host runtime）を再監査。過去19件との重複を避け、確実な実バグ medium 1 件・low 1 件を報告。両方コードで真偽検証し、実バグと確認して修正した。（※サブエージェントが指示に反し MEMORY.md を単独コミット `dd1d960` していたため soft reset で取り消し、監査後の本エントリへ統合）

### 修正した不具合
- **[medium] `git merge`（into=branch「→ 反映する」）がコンフリクト時に worktree を対象ブランチへ置き去りにする** (`app/api/git/merge/route.ts`): `git checkout <target>` 成功後の `git merge <current>` がコンフリクト（code≠0）した際、元ブランチへ戻す `git checkout <current>` は **マージ進行中（MERGE_HEAD 有・unmerged index）では "you need to resolve your current index first" で必ず失敗**し無視されていた。→ worktree が対象ブランチ上のコンフリクト状態で残る。コンフリクト分岐で checkout 前に `git merge --abort` を実行し index をクリーンにしてから元ブランチへ戻すよう修正。現行 UI では current_folder 隔離で到達（worktree 隔離は前ラウンド修正の checkout 段 409 で手前で止まる）。
- **[low] paths 指定コミットが事前ステージ済みの別ファイルも巻き込む** (`app/api/git/commit/route.ts`): 一部ファイル選択コミット時、`git add -- <paths>` の後に pathspec なしの `git commit -m msg` を実行しており、index に既にあった他のステージ済み変更まで含めてコミットしていた。commit 側にも `-- <paths>` を渡して選択集合に限定（`all` 指定時は従来どおり全体）。

### 監査で見送った指摘（実バグでない/リスク優先で保留）
- **[low/robustness] SQLite `foreign_keys` PRAGMA 未有効化** (`lib/db.ts`): スキーマの `ON DELETE CASCADE` が no-op だが、`deleteWorkspace`/`destroyProject` が手動で子行を削除しており実害なし。有効化は既存データ次第で挙動が変わる回帰リスクがあるため本ラウンドでは見送り（潜在リスクとして記録）。
- **[low] `useSessionStream.sendPrompt` の 800ms resync タイマー未キャンセル / NestedAgentPanel の in-flight setFeeds**: `stale()` ガード等で実害ほぼ無し。既知の stale-response カテゴリとして保留。

### 検証
- Vitest **18 files / 105 tests** 全通過、`tsc --noEmit` クリーン、ESLint クリーン。
- Next 15.5.20 production build（`NEXT_DIST_DIR=.next-verify`）exit 0（後述コミット時に実施）。稼働中 `.next` 非干渉。※実反映にはホスト再起動が必要。

<details><summary>サブエージェント原報告（詳細・コード引用）</summary>

### 新規に確認した実バグ

- **[medium] `git merge`（into=branch「→ 反映する」）がコンフリクト時に worktree を対象ブランチに置き去りにする** (`web/src/app/api/git/merge/route.ts` L57〜93)
  - 症状: 「→ 反映する」で対象（main 等）に current をマージしようとしてコンフリクトした場合、以後この workspace の diff/commit が意図せず対象ブランチを操作対象にし、作業ツリーにコンフリクトマーカーが残る。
  - 根本原因: `git checkout <target>` 成功 → `git merge <currentBranch>` がコンフリクト（code≠0）した後、`await runGit(check.path, ["checkout", currentBranch])` で元ブランチへ戻そうとするが、**マージ進行中（MERGE_HEAD 有・index に unmerged）では `git checkout` は "you need to resolve your current index first" で必ず失敗**し、その失敗は無視される。`git merge --abort` を呼んでいないため作業ツリーは対象ブランチ上のコンフリクト状態のまま残る。コード引用:
    ```
    const merge = await runGit(check.path, args);
    if (merge.code !== 0) {
      // try return to original branch
      await runGit(check.path, ["checkout", currentBranch]);   // ← 進行中マージのため必ず失敗
      return NextResponse.json({ error, conflict }, { status: 409 });
    }
    ```
  - 再現条件: current_folder 等、対象ブランチが別 worktree でチェックアウトされていない状況（worktree 隔離では checkout 段で 409 になり到達しない）で、into=branch マージがコンフリクトする。
  - 推奨修正: コンフリクト分岐で `git checkout` の前に `git merge --abort` を実行してから元ブランチへ戻す（abort 後は index がクリーンになり checkout が成功する）。

- **[low] paths 指定コミットが「事前にステージ済みの別ファイル」も巻き込んでコミットする** (`web/src/app/api/git/commit/route.ts` L60〜73)
  - 症状: 特定ファイルのみ選択してコミットしたのに、UI で選択解除したファイルが「すでに git index にステージ済み」だった場合、そのファイルも一緒にコミットされる。
  - 根本原因: `git add -- <paths>` の後に **pathspec なしの `git commit -m msg`** を実行しているため、index にある全ステージ済み変更がコミットされる。コード引用:
    ```
    const add = await runGit(check.path, ["add", "--", ...body.paths]);
    ...
    const commit = await runGit(check.path, ["commit", "-m", body.message.trim()]);  // ← pathspec 無し
    ```
  - 再現条件: 外部 git 操作や過去の中断で index に事前ステージが残っている状態で、DiffPane の一部ファイルを選択解除してコミット。WebUI は通常 add+commit を原子的に行うため自前では作り込まない前提条件（＝実害は限定的、low）。
  - 推奨修正: `git commit -m <msg> -- <paths>` のように commit 側にも pathspec を渡す（選択集合に限定）。

### 憶測・改善提案（low・実害限定または前提条件付き）

- **[low/robustness] SQLite の `foreign_keys` PRAGMA 未有効化で `ON DELETE CASCADE` が no-op** (`web/src/lib/db.ts` L38 付近): `db.pragma("journal_mode = WAL")` のみで `foreign_keys = ON` が無い。better-sqlite3/SQLite 既定は FK off のため、スキーマの `ON DELETE CASCADE`（workspaces→projects、session_bindings→workspaces）は効いていない。現状は `deleteWorkspace`/`destroyProject` が手動で子行を削除しているため実害は出ていないが、将来 cascade に依存するコードが入ると孤児行が残る潜在リスク。`db.pragma("foreign_keys = ON")` の追加を推奨（回帰リスクは要検証）。
- **[low] `useSessionStream.sendPrompt` の 800ms 後 resync がスコープ離脱後もタイマー未キャンセルで発火** (`useSessionStream.ts` L495): `setTimeout(() => void resync(), 800)` は cleanup で clear されない。resync 内の `stale()` ガードで dispatch は抑止されるため実害はほぼ無いが、不要な fetch が 1 回走りうる。
- **[low] NestedAgentPanel の in-flight `loadChildTree` が active=false 遷移後に `setFeeds` しうる** (`NestedAgentPanel.tsx` L186〜194): interval は clear されるが進行中の非同期解決はガードされていない。stale 表示の可能性のみで、既知の stale-response カテゴリ（前回監査で保留）と同種。

### 結論
- 新規の critical/high の確実な実バグは発見できなかった。確実な実バグは上記 **medium 1 件・low 1 件**（いずれも本ラウンドで修正済み）。残りは low の改善提案。

</details>

---

## 2026-07-17 サブエージェント徹底デバッグ + 監査（第3ラウンド／バグ3件修正）

/loop 2m の2回目のtickで実施。読み取り専用サブエージェント（[徹底デバッグ調査R2](671b447d-039c-43d5-bc3f-d3a0c38aafbd)）は「新規の critical/high の確実な実バグは無し、low 3件のみ」と報告。3件ともコードで真偽検証し、実バグと確認して修正した。

### 修正した不具合（すべて low）
- **orphan クリーンアップが temporary_copy の allowlist を解放しない** (`app/api/workspaces/orphans/route.ts`): `destroyWorkspace`（workspace-service）は temp copy 削除後に `removeAllowedRoot` を呼ぶが、orphans の一括クリーンアップ POST は呼んでおらず `allowed_roots` に死んだエントリが蓄積していた。`removeAllowedRoot(row.worktree_path)` を追加して対称化。
- **`getTask` の engineOk 判定が `listTasks` と非対称** (`lib/task-service.ts`): 単一タスク画面の `getTask` はインラインの `/session/status` fetch が失敗すると engineOk=false 扱いで、非503 API エラー（＝エンジンは生存）でもタスクが誤って「unknown」表示になり得た。`sessionStatusFor([dir])` を再利用して `listTasks` と同一ロジックへ統一。
- **`FileTreePanel`（「ファイル」タブ）がファイルを一切開けないデッドフィーチャー** (`app/api/browse/dirs/route.ts` + `components/task/FileTreePanel.tsx`): browse/dirs はディレクトリのみ返すため、ファイル→Diff の動線（onFile）が発火しなかった。browse/dirs に `?files=1` のオプトインでファイル（`kind:"file"`）を追加（プロジェクトピッカーは従来どおりディレクトリのみ）。ディレクトリ→ファイルの順でソート。FileTreePanel は `files=1` を付与。route.test に files=1 の回帰テスト追加。

### 検証
- Vitest **18 files / 105 tests**（browse/dirs に1件追加）全通過、`tsc --noEmit` クリーン、ESLint クリーン。
- Next 15.5.20 production build（`NEXT_DIST_DIR=.next-verify`）exit 0。稼働中 `.next` 非干渉。※実反映にはホスト再起動が必要。

---

## 2026-07-17 サブエージェント徹底デバッグ + 監査（第2ラウンド・引き継ぎ／バグ5件修正）

前セッションがトークン制限に達したため「/loop 2m: サブエージェント徹底デバッグ→監査→完全にバグが無くなるまで」を引き継ぎ、1ラウンド実施。読み取り専用サブエージェント（[徹底デバッグ調査](d6cb2de4-64f1-429e-a310-4ce70cb70163)）の報告をコードで真偽検証し、確認できた実バグのみ修正した。

### 修正した不具合
- **[medium/security] OpenCode プロキシの directory 検証の多層防御の穴** (`app/api/opencode/[...path]/route.ts`): allowlist 検証は header 優先の `directory` 値で行うが、転送 URL に元 query（`?directory=`）を無検証で丸ごと付けていた。header と query が食い違うと未検証パスが upstream に到達しうる。検証後、query の `directory` を検証済み値へ上書きして header/query を一致させた。
- **[medium] worktree での merge「→ 反映する」(`into=branch`) が常に生 500 で失敗** (`app/api/git/merge/route.ts`): worktree タスクでは対象ブランチ（main 等）が親フォルダでチェックアウト済みのため `git checkout <target>` が "already checked out" で失敗する。stderr を判定し、409 + 実行可能な案内メッセージ（メインのフォルダで「取り込む」か PR 作成）＋ `worktreeConflict` フラグを返すようにした。
- **[low/security] `diff/files` の `base` 正規表現が先頭 `-`/`..` を許可** (`app/api/diff/files/route.ts`): `assertSafeBranchName`（`git.ts`）は先頭 `-` と `..` を拒否するのに、こちらは緩く option 風文字列（`-R` 等）が `git diff <base>` の引数位置に入り得た。同等の検証（先頭 `-` 不可 + `..` 不可）へ統一。
- **[low] `devcontainer.ts` の JSONC コメント除去が文字列内 `//` を破壊** (`lib/devcontainer.ts`): `raw.replace(/\/\/.*$/gm, "")` が文字列値内の `https://…` URL を切り落とし JSON.parse 失敗→name 取得不可。文字列/エスケープを尊重する `stripJsoncComments`（`//` 行・`/* */` ブロック対応）に置換。ユニットテスト7件追加。
- **[low/perf] `NestedAgentPanel` がグローバル `/session/status` を子ごとに再取得** (`components/task/NestedAgentPanel.tsx`): 深さ3・子多数のツリーで 2 秒ごとにリクエスト増幅。`refresh` で 1 回だけ取得しツリー全体で共有するよう変更（意味のないステータス分岐の冗長 recurse も整理）。

### 検証
- Vitest **18 files / 104 tests**（devcontainer 7 件追加）全通過、`tsc --noEmit` クリーン、ESLint クリーン。
- Next 15.5.20 production build（`NEXT_DIST_DIR=.next-verify`）exit 0。稼働中 `.next`（:3000）へは非干渉。
- 実機ヘルス: WebUI `/api/health` と OpenCode `/global/health` はいずれも ok（v1.17.11）。※本修正の実反映にはホスト再起動が必要（稼働 prod は旧ビルド）。

### 監査で見送った指摘（実バグでない/低優先）
- 既知の非バグ（resync v2→v1 降格懸念、一部 stale-response、browse/dirs allowlist 非適用）は再報告どおり見送り。writeProjectManifest の tmp→rename 競合は同期実行で実害なしと確認。


## 狭幅画面のフォーム横はみ出し・スクロールバー修正 (2026-07-17)

- **症状**: 約500px幅で実行設定3項目が固定幅 `160 + 144 + 144px`（さらにgap 16px）の横並びとなり、フォーム内の利用可能幅448pxを16px超過。枠内に横スクロールバーが出て、右側がはみ出していた
- **修正 (`HomeView.tsx`)**: 下段を `overflow-x-auto` の横スクロール式flexからレスポンシブgridへ変更。480px以上は均等3列、480px未満は2列へ自然に折り返し、1280px以上は160 / 144 / 144pxの明示3列を維持。各 `GhostSelect` は列幅いっぱいに収める
- **回帰テスト (`smoke.spec.ts`)**: 既存の全5ラベル省略検証を1280 / 1024 / 500 / 400pxへ拡張。1024 / 500 / 400pxではフォームの `scrollWidth <= clientWidth` も確認し、横方向にはみ出さないことを固定
- **検証**:
  - Vitest **91 passed**、typecheck、lint、検証用・本番production build成功、対象Playwright E2E **1 passed**
  - 本番1280pxでフォーム `clientWidth=scrollWidth=862`、実行設定 `clientWidth=scrollWidth=490`、`overflow-x: visible` を確認。狭幅500 / 400pxはE2Eでスクロールなし
  - 本番ホスト再起動後: host PID 5144 / OpenCode PID 40384 / Caddy PID 36008 / tray PID 22444。WebUI・OpenCode・Caddyはいずれも HTTP 200
- **運用メモ**: 旧production生成物は `web/.next-before-home-overflow-20260717` へ退避してクリーンビルド（Git管理外）

## ホーム入力フォームの幅・選択ラベル可読性修正 (2026-07-17)

- **症状**: 1280px画面でもタスク作成フォームが672px (`max-w-2xl`) に固定され、右側のモデル・エージェント・権限が各約94pxまで圧縮。表示ラベル領域は各約38pxしかなく、`GPT-5.6 Sol`（67px必要）・`build（Code）`（81px必要）・`フルアクセス`が「…」になり、右側へ詰まって見えていた
- **修正 (`HomeView.tsx`)**:
  - フォームをメイン領域いっぱいの `max-w-4xl` へ拡張（実表示672px→864px）
  - 1280px以上は `auto / minmax(0,1fr) / auto` の3列グリッドで「プロジェクト系 / 実行設定 / 送信」を自然幅配置。左右グループを同率 `flex-1` にして右側だけ圧縮していた構造を解消
  - 1280px未満は従来の2段グリッドを維持し、モデル160px・エージェント144px・権限144pxを確保。プロジェクト160px・作業場所128pxも下限を設定
- **回帰テスト (`smoke.spec.ts`)**: APIをモックして `★ opencode` / `worktree` / `GPT-5.6 Sol` / `build（Code）` / `フルアクセス` を表示し、1280pxと1024pxの両方で全ラベルの `clientWidth >= scrollWidth`（省略なし）を検証
- **検証**:
  - Vitest **91 passed**、typecheck、lint、production build、対象Playwright E2E **1 passed**
  - 本番1280px実測: フォーム864px、各項目幅160 / 128 / 160 / 144 / 144px。全5項目 `truncated=false`
  - 本番ホスト再起動後: host PID 3892 / OpenCode PID 30072 / Caddy PID 38440 / tray PID 36316。WebUI・OpenCode・Caddyはいずれも HTTP 200
- **運用メモ**: OneDrive配下の `.next` 上書き時の `readlink EINVAL` 回避のため、旧production生成物は `web/.next-before-home-ui-final-20260717` へ退避してからクリーンビルド（Git管理外）

## プラグイン有効化トグルの表示・操作修正 (2026-07-17)

- **症状1（表示）**: ON状態のつまみがトラック右外へ完全にはみ出していた。実画面の修正前実測はトラック `x=1062..1106`（44px）に対し、つまみが `x=1106..1126`（20px）
- **症状2（操作）**: 設定画面でも有効中のCodexBarウィジェットを右下へ重ねていたため、スクロール後のトグル中央をウィジェット内のプランバッジが覆い、クリックしてもON/OFFが変わらなかった
- **修正**:
  - `PluginSettings.tsx`: つまみを `left-0.5` でトラック左端へ固定し、OFF=`translate-x-0` / ON=`translate-x-5` に変更。44pxトラック内に左右2pxの余白で収まるようにした
  - `PluginHost.tsx`: `/settings` 配下ではプラグインウィジェットを描画せず、設定トグルを常に操作可能にした。通常画面では従来どおり有効ウィジェットを表示
  - `smoke.spec.ts`: 設定画面にウィジェットが重ならないこと、ON/OFF両方でつまみがトラック内にあること、クリック後に `aria-checked=false` になることを回帰テスト化
- **検証**:
  - Vitest **91 passed**、typecheck、lint、`git diff --check` 成功
  - 検証用production build成功、対象Playwright E2E **1 passed**。本番production buildも成功
  - 本番実画面でONはトラック `1062..1106` / つまみ `1084..1104`、OFFはつまみ `1064..1084` と実測。クリック可能、ON→OFF→ONへの復元、設定画面ではウィジェット非表示、通常画面へ戻るとウィジェット再表示を確認
  - 本番ホスト再起動後: host PID 31992 / OpenCode PID 35780 / Caddy PID 29148 / tray PID 16704。`/api/health`、OpenCode `/global/health`、Caddy HTTPSはいずれも HTTP 200
- **運用メモ**: OneDrive同期で既存 `.next` のリンクが壊れ `readlink EINVAL` になったため、削除せず `web/.next-broken-toggle-20260717` へ退避してから `.next` をクリーンビルドした（退避先は生成物・Git管理外）

## プロジェクト追加ダイアログが進まない不具合修正 (2026-07-17)

- **症状**: 「プロジェクトを追加」→「フォルダを選択」でパス表示が `…` のままになり、「再読込」「このフォルダを追加」が長時間無効になる
- **切り分け**:
  - ブラウザー実機で停止状態を再現。`GET /api/browse/dirs` と既存 `Test` の冪等な `POST /api/projects` 自体は正常（保存 110ms）
  - 初回の `/api/browse/dirs` が、Windows Explorer の Links/Jump List に含まれる全クイックアクセス先の解析完了を `await` していた。PowerShell に終了上限がなく、オフラインドライブや壊れたショートカット次第でフォルダ一覧全体が待たされる構造だった
- **修正**:
  - `browse/dirs/route.ts`: クイックアクセス取得を最大750msだけ待ち、超過時は通常のフォルダ一覧を `quickAccess: []` で先に返す。解析は継続して次回用キャッシュを作る
  - `quickaccess.ts`: 同時リクエストで重複スキャンしない `pending` Promise を追加。Links 解決用 PowerShell は2秒で停止し、失敗時は従来どおり安全に空結果へフォールバック
  - `route.test.ts`: クイックアクセス Promise が永久に解決しない場合でも751ms後に HTTP 200 相当を返す回帰テストを追加
- **検証**:
  - Vitest **91 passed**、typecheck/lint、検証用・本番 production build 成功
  - キャッシュなし検証サーバーで `/api/browse/dirs` は795ms、本番再起動直後は806msで HTTP 200
  - 本番ホスト再起動後、ブラウザーで追加ダイアログを開くとユーザーホームディレクトリの一覧と有効な「このフォルダを追加」を即時確認
  - 稼働確認: host PID 38564 / OpenCode PID 16404 / Caddy PID 4516 / tray PID 40320。`/api/health`・`/global/health` は HTTP 200

## トレイ無し旧ホストの引き継ぎ・二重起動判定修正 (2026-07-17)

- **症状**: トレイの自動再生成が上限まで失敗した旧ホストや修正前のゾンビホストでは、`host.lock` の PID が生存しているため再度 `start-webui.bat` を実行しても「起動済み」と判定され、トレイを復旧できなかった。強制終了後の PID 再利用でも、無関係なプロセスをホストと誤認する可能性があった
- **単一インスタンス修正 (`host/src/index.js`)**:
  - ロックを旧来の PID 文字列から `{ pid, created }` JSON に変更し、Windows のプロセス生成時刻 (FILETIME) まで一致するか検証。旧ロックはコマンドライン (`node ... src/index.js`) で後方互換判定
  - PowerShell は `execFileSync` の引数配列で実行し、`cmd.exe` の引用符解釈でトレイ検出クエリが壊れる問題を解消。CIM 問い合わせ失敗は「トレイ無し」と断定せず、稼働ホストを安全側で維持
  - 生存ホストに `tray_windows*` の直接子プロセスが無い場合は3秒待って再確認し、なお不在ならホスト本体だけを終了。4096/3000 の既存サービスは `resolvePortPlan()` で再利用して、新ホストがトレイを引き継ぐ
  - ロック書込は `wx` の排他作成 + 最大3回再判定にし、同時起動時の上書き競合を防止。ロック削除も所有 PID が一致する場合だけ実行
- **Caddy 修正**: Explorer/非対話起動の `PATH` に WinGet Links が無い環境でも、`%LOCALAPPDATA%\Microsoft\WinGet\Links\caddy.exe` をフォールバック探索して起動できるようにした
- **ランチャー修正**: 正常終了メッセージを3秒表示。標準入力リダイレクト時にエラーになる `timeout` ではなく `ping` 待機を使用
- **作業ファイル整理**: `.opencode/opencode-loop/` はマシン固有の空ジョブ状態なので `.gitignore` 対象に追加
- **検証**:
  - `node --check host/src/index.js`、`git diff --check` 成功
  - 健全ホストへの二重起動で host/tray PID が不変。トレイ helper を強制停止すると別 PID で自動復旧し、その後の二重起動でも維持
  - `start-webui.bat` を標準入力なしで実行し、リダイレクトエラーなし・終了コード0
  - Web: Vitest **90 passed**、typecheck/lint 成功、`NEXT_DIST_DIR=.next-verify` の production build 成功（自動変更された `tsconfig.json` は元に復元）
  - 最終コードで実ホストを再起動: host PID 30844 / tray PID 41584 / OpenCode PID 43820 / Caddy PID 39728。`/api/health` と `/global/health` は HTTP 200。再度起動しても同じ PID 群を維持

## CodexBar: サービス枠でくくる（プラグイン）＋プランバッジ統一（デスクトップ） (2026-07-17)

- **要件**: (1) プラグイン版が「白でサービス別に分かりにくい」→ プロバイダごとに枠でくくる。(2) デスクトップ版のプランラベル表記をプラグイン版（小バッジ）に合わせる
- **プラグイン（`components/plugins/codexbar/CodexBarWidget.tsx`）**:
  - `ProviderRow` の `<li>` を**枠付きカード化**: `rounded-lg border border-border bg-surface-2/40 p-2`。これで各サービスが明確に区切られる（従来は境界なしで白背景に並ぶだけ）
  - 見出しボタンの hover をカード背景(surface-2)に埋もれないよう `hover:bg-surface-2` → `hover:bg-surface-3`
  - プランバッジをカード背景と対比させるため `bg-surface-2` → `border border-border bg-surface-3`
- **デスクトップ（`App/UsagePopupForm.cs` `DrawCard`）**: 従来の `プロバイダ名 — プラン`（title へ連結）を廃止し、**名前の直後に小さなプランピル**を描画（`BarTrack` 塗り + `CardBorder` 枠線 + `SecondaryText` 文字、9px、角丸 Scale(4)）＝プラグインの `bg-surface-3`+border バッジと同スタイル。タイトル行内で縦センタリング、展開/最小化どちらでも表示。`dotnet build -c Release` 緑（0/0）→ 稼働 exe 停止→リビルド→再起動（PID 35424）
- **検証**: WebUI typecheck/lint/vitest（codexbar 22）緑。UI 反映はプラグイン＝WebUI 再ビルド＋ホスト再起動後、デスクトップ＝トレイポップアップ（ユーザー手動確認）
- **並行作業配慮**: `host/src/index.js`・`start-webui.bat`・別エージェントの MEMORY 追記に非干渉。WebUI コミットは `CodexBarWidget.tsx`/`MEMORY.md` のみ

## CodexBar プラグイン: プラン表示追加（デスクトップ版と同様） (2026-07-17)

- **要件**: CodexBar プラグイン（WebUI 右下ウィジェット）にも、デスクトップ版ポップアップと同様の「プラン」表示を追加。デスクトップは各プロバイダ見出しを `プロバイダ名 — プラン`（`UsagePopupForm.DrawCard`、`card.Snapshot.Plan`）で描画していた
- **根本原因（ギャップ）**: プラン名は CodexBar のインメモリ `UsageSnapshot.Plan`（各 Provider が設定: Codex=JWT/plan、Claude=SubscriptionType、Cursor=membership、Ollama=ParsePlan、OpenCodeGo="Go"）にあるが、**エクスポート JSON（`usage-snapshot.json`）には出力されていなかった**ため、プラグインからは参照不可だった
- **CodexBar 側（C#, `Core/UsageExporter.cs`）**: `Entry` に `[JsonPropertyName("plan")] string? Plan` を**加算的**に追加（schema `codexbar.usage-snapshot/v1` 維持＝後方互換）。`BuildEntry` で `Plan = snapshot?.Plan` を設定。docstring の消費者契約にも `plan : string?` を追記。`dotnet build -c Release`（`.build/release`）緑（0 warn/0 err）→ 稼働 exe(PID 18500) を停止→リビルド→再起動(PID 33240)。新 snapshot に plan 出力を確認（codex=Team/claude=Team/ollama=Pro/opencode-go=Go/cursor=Pro）
- **WebUI 側（TS）**:
  - `lib/plugins/codexbar.ts`: `CodexBarProvider.plan: string \| null` を追加、`parseCodexBarSnapshot` で `asString(p.plan)`（空文字は null）
  - `components/plugins/codexbar/CodexBarWidget.tsx`: `ProviderRow` の見出しでプロバイダ名の右に **プランを小さな `bg-surface-2` バッジ**で表示（`title="プラン: {plan}"`）。plan が無ければ非表示
  - `codexbar.test.ts`: plan パース（値/欠落/空文字→null）テスト追加 → 計 **22 passed**（当該ファイル）。typecheck/lint 緑
- **注意（並行作業）**: 別エージェントが WebUI の `host/src/index.js`・`start-webui.bat` を編集中のため、それらには一切触れず、コミットは CodexBar プラグイン関連ファイル（`codexbar.ts`/`codexbar.test.ts`/`CodexBarWidget.tsx`/`MEMORY.md`）のみに限定
- **未検証（要ホスト再起動）**: ブラウザでのプラン表示は WebUI の再ビルド＋ホスト再起動後に反映（稼働 prod `.next` は旧ビルド）。純粋ロジックは unit テスト＋snapshot 実データで確認済み

## トレイ常駐しない不具合修正（自動復旧＋ローカルキャッシュ起動） (2026-07-17)

- **報告**: 起動してもタスクトレイにアイコンが常駐しない
- **調査**: 稼働中ホスト（node `src\index.js`）は生存しているのに `tray_windows_release.exe`（systray2 ヘルパー）が消滅していた。過去ログ(7/16)は "Tray host ready" 済＝以前は表示できていた
  - 隔離検証: `debug:false` なら OneDrive 配下から直接起動しても正常表示・8秒後も生存。`debug:true` は `tray_windows.exe`(非release)を探し ENOENT（＝あくまで検証時の注意）
- **根本原因**: `host/src/index.js` に **systray 子プロセスの `exit`/`error` を検知して再生成・ログ出力する処理が皆無**。ヘルパーが異常終了するとアイコンが消えたまま node だけ生き続ける（＝「常駐しない」）。加えて `quit()` の `systray.kill(false)` は node を終了させず、5秒間隔の `setInterval` によりゾンビ化する副次バグもあった
- **修正（`host/src/index.js`）**:
  - `createTray()` を `buildTrayMenu()`/`startTray()`/`wireTrayLifecycle()`/`scheduleTrayRestart()` に分割
  - `startTray()`: `copyDir:true`（`~/.cache/node-systray/<ver>/` へコピーして起動＝OneDrive の同期/デハイドレート影響を排除）を優先し、失敗時は `copyDir:false`（その場実行）へフォールバック
  - `wireTrayLifecycle()`: `onError` をログ化。子プロセス `exit` を監視し、`quitting` でなければ `code/signal` をログ出力して `scheduleTrayRestart()`。60秒生存で「安定」とみなし再起動予算 `trayRestarts` をリセット
  - `scheduleTrayRestart()`: 最大5回・1→5秒バックオフで `startTray()` を再実行し、成功後 `refreshStatusMenu()`
  - `quit()`: タイマ解除 → `stopChildren` → `removeLock` → `await systray.kill(false)` → `process.exit(0)`（確実終了）
- **検証**: `node --check` OK。隔離テストで copyDir=true 起動（`%USERPROFILE%\.cache\node-systray\2.1.4\tray_windows_release.exe`）と kill→再生成を確認。実ホスト再起動（PID 37120, Caddy=1）後、ログに `Tray host ready (copyDir=true)`、トレイヘルパー常駐。ヘルパーを taskkill → `Recreating tray in 1000ms (attempt 1/5)…` → 新 pid で復帰を実機確認
- **運用**: 修正適用にはホスト再起動が必要（今回実施済み）。ヘルパーは今後 OneDrive 外のローカルキャッシュから起動。異常時ログは `%APPDATA%\opencode-webui\host-out.log`

## セッションのプロジェクト内保持・再開 (2026-07-17)

- **目的**: セッションのやり取り（紐付け）を開いているプロジェクト（リポジトリ）内に保持し、閉じて開き直しても再開できるように。従来はセッション紐付けがグローバル DB（`%APPDATA%/opencode-webui/webui.db`）のみに存在し、DB リセット・別マシン・クローンでは失われていた
- **仕組み（サイドカー方式）**: DB を実行時の真実として維持しつつ、各プロジェクトの `<projectRoot>/.opencode-webui/sessions.json` に workspace/session 紐付けをミラー保存。再オープン時に DB へ取り込んで復元
  - `web/src/lib/project-session-store.ts`（純粋+fs）: マニフェスト型 `ProjectSessionManifest`/`ManifestWorkspace`/`ManifestSession`、`parseManifest`（防御的パース・壊れ要素除外）、`upsertWorkspaceInManifest`/`removeWorkspaceFromManifest`（純粋）、`readProjectManifest`/`writeProjectManifest`（`.tmp`→rename の擬似アトミック書込）。`.opencode/` は別エージェント使用中のため衝突回避で `.opencode-webui/` を採用
  - `web/src/lib/project-session-sync.ts`（DB⇔マニフェスト橋渡し・best-effort/throw しない）: `persistProjectSessions(projectId)`（DB を真実にマニフェスト全再生成）、`restoreProjectFromManifest(root, projectId)`（DB に無い workspace/binding のみ冪等取り込み）、`restoreAllKnownProjects()`、`adoptProjectFromManifest(root)`（未知リポジトリを upsert して復元）
  - `web/src/lib/db.ts`: `listSessionBindings(workspaceId)` / `importWorkspaceRow`（id/status/created_at 保持の INSERT、既存 id はスキップ）/ `bindSession` に任意 `updatedAt` 追加（復元時に元時刻を保持）
- **配線**:
  - 書込: `provisionWorkspace`・`destroyWorkspace`（workspace-service）/ `POST /api/tasks` の bind 後 / `POST /api/workspaces/[id]/sessions` の bind 後 → `persistProjectSessions`
  - 復元: `POST /api/projects`（プロジェクト追加=再オープン時）で `restoreProjectFromManifest` を実行しレスポンスに `restored` を付与。`listTasks()` はプロセス初回のみ `restoreAllKnownProjects()`（memo 化・冪等）でアプリ再起動時に自動復元
  - 手動: `POST /api/projects/restore`（body 無し=既知全プロジェクト復元 / `{rootPath}`=そのリポジトリを登録して復元）
- **テスト**: `project-session-store.test.ts`（8）追加 → 計 **89 passed**。typecheck/lint 緑。`NEXT_DIST_DIR=.next-verify` でビルド緑（新ルート `/api/projects/restore` 確認、稼働 prod `.next` 無干渉）
- **運用注意（重要）**: `next build` は `tsconfig.json` を自動で書き換える（`include` へ dist types 追加＋配列を整形）。別エージェントが `tsconfig.json` を編集中だったため、検証後に `git show HEAD:web/tsconfig.json` で元内容へ手動復元済み。今後も検証ビルド後は tsconfig の差分に注意

## プラグイン基盤 + CodexBar 利用状況ウィジェット (2026-07-17)

- **プラグイン機能自体を新規追加**（右下オーバーレイ型ウィジェットの仕組み）
  - `lib/plugins/types.ts`: `WebUIPlugin`（id/name/description/defaultEnabled/Widget）
  - `lib/plugins/state.ts`: localStorage(`webui:plugins`)で ON/OFF 永続化 + `webui:plugins` カスタムイベント同期。純粋関数 `isEnabled`/`sanitizePrefs`（`access-mode.ts` を踏襲）
  - `lib/plugins/registry.ts`: 登録テーブル（新プラグインはここに追加）
  - `components/plugins/PluginHost.tsx`: 有効プラグインの Widget を `fixed bottom-4 right-4 z-30` にスタック表示。`AppShellInner` にマウント（全ページ共通）
  - `components/plugins/PluginSettings.tsx`: 設定画面「プラグイン」セクションのトグルスイッチ
- **第1プラグイン: CodexBar 利用状況**（`components/plugins/codexbar/CodexBarWidget.tsx`）
  - データ源: `%APPDATA%\CodexBar\usage-snapshot.json`（schema `codexbar.usage-snapshot/v1`）。トークン/コストは含まれず**使用率(%)・limited/maxed・resetsAt**のみ
  - BFF: `app/api/plugins/codexbar/usage/route.ts`（nodejs/force-dynamic）。ファイル読取→`parseCodexBarSnapshot`。未起動(ENOENT)/JSON壊れは常に 200 + `available:false` で graceful。env `OPENCODE_WEBUI_CODEXBAR_SNAPSHOT` でパス上書き可
  - `lib/plugins/codexbar.ts`（純粋）: `parseCodexBarSnapshot`/`providerLabel`/`usageTone`(ok<75/warn>=75/danger=limited|maxed|error)/`clampPercent`/`formatResetsIn`/`worstProvider`
  - UI: プロバイダ毎に色分けバー(緑/橙/赤)+%+リセット時刻、30s ポーリング(可視時のみ)、折りたたみ(localStorage `webui:plugin:codexbar:collapsed`)、更新/閉じるボタン
- **テスト**: `codexbar.test.ts`(12)+`state.test.ts`(4) 追加 → 計 **63 passed**。typecheck/lint/build すべて緑
- **E2E**: `e2e/smoke.spec.ts` に「右下ウィジェット描画＋折りたたみでピル化」「設定にプラグイントグル」を追加 → **6 passed**（エンジン非依存）。折りたたみピルには `aria-label` を付与（role 名で参照可能に）
- **E2E ビルド分離**: 稼働中 prod ホスト（既定 `.next`）を壊さないよう、E2E は `NEXT_DIST_DIR=.next-e2e` へビルドして検証。`.next-*/` を .gitignore と eslint ignore に追加（生成物を lint/コミットから除外）
- **鮮度判定**: `isStale(generatedAt, now, 15分)` を追加（CodexBar は5分更新＝3周期超で stale）。widget フッターに「古い可能性（CodexBar 停止中?）」を warning 色で表示。`isStale` は unit テスト3本追加 → 計 **66 passed**
- **トークン使用量集計（Codex セッションログ）**: CodexBar の snapshot にトークンが無いため、Codex 本体の `~/.codex/sessions/**/*.jsonl` の `payload.type=="token_count"` → `info.total_token_usage`（セッション累計）を集計
  - `lib/plugins/codex-tokens.ts`（純粋）: `parseTokenCountLine`/`lastTokenUsageFromText`（ファイル内最後の累計を採用）/`sumUsage`/`formatTokens`（k/M）+ 型 `TokenUsage`/`CodexTokensResult`。unit テスト8本
  - `lib/plugins/codex-tokens-server.ts`（node）: セッションディレクトリ再帰列挙 → mtime が期間内のファイルのみ → **mtime+size キャッシュ**で再読込回避、`MAX_FILES=300`/`MAX_FILE_BYTES=64MB` 上限。env `OPENCODE_WEBUI_CODEX_SESSIONS` で上書き可
  - BFF: `app/api/plugins/codexbar/tokens/route.ts`（`?days=1..90`、既定1、失敗も 200+available:false）
  - widget: 本体に「直近24h トークン: {formatTokens} · {sessions}s」行を追加（tokens は usage と独立フェッチ・失敗時は前回値維持）
  - **重要バグ修正**: `codex-tokens.ts` 先頭 JSDoc に glob `**/*.jsonl` を書いたら `*/` でコメントが早期終了しパースエラー → コメントから glob を除去
  - **実データ検証**（一時サーバ :3402、稼働ホスト無干渉）: days=1 → 4セッション 約59.3M tok、days=7 → 5セッション 約68.7M tok（大半は cachedInput）。計 **74 tests passed**、typecheck/lint 緑
- **実機検証済み**: ホスト再起動して新ビルド配信。`/api/plugins/codexbar/usage` が HTTP/HTTPS(8443) 両方で 200 + 実データ5件（codex1%/claude23%/ollama56.3%/opencode-go78%/cursor100%）。ブラウザで右下ウィジェット描画をスクショ確認
- **注意（既知の運用）**: `npm run build` は既定 `.next` を上書きするため、稼働中 prod ホストは新ルートが 404 になる → **ホスト再起動が必要**。今回は host tree kill → lock 削除 → `start-webui.bat`(OPENCODE_WEBUI_CADDY=1) 再起動で解消。Caddy もホスト管理下(:8443)に復帰

### 全 window 表示対応 + 折りたたみ「全体値」修正 (2026-07-17)

- **要件**: (1) 最小化ピルが最大値優先で全体を反映しないバグ、(2) 各プロバイダの複数レート枠（5時間/週間/月間 等）を全部表示
- **根本原因**: CodexBar の `UsageExporter.BuildEntry` が全 window を **max 1つ**に集約して出力していた（snapshot に window 詳細が無い）
- **CodexBar 側拡張（C#）**: `src/CodexBar.Win/Core/UsageExporter.cs` の `Entry` に `windows[]`（`id`/`title`/`usedPercent`/`resetsAt?`/`windowMinutes?`）を**加算的**に追加（schema `v1` 維持＝後方互換）。`snapshot.Windows` から生成。`dotnet build -c Release`（出力 `.build/release`）→ 稼働 exe を停止してリビルド→再起動。新 snapshot に `windows` 出力を確認
  - 実データ例: claude=5時間/週間/週間(Fable)、ollama=セッション/週間、opencode-go=ローリング/週間/月間、cursor=プラン/Auto/API、codex=週間
- **WebUI 側（TS）**:
  - `lib/plugins/codexbar.ts`: 型 `CodexBarWindow` + `CodexBarProvider.windows[]` 追加、`parseCodexBarSnapshot` で防御的パース（非配列/null要素は除外→`[]`）。新ヘルパ `percentTone`(>=90 danger/>=75 warn)、`overallUsedPercent`(=各プロバイダ usedPercent の平均、null 除外)、`limitedCount`
  - `CodexBarWidget.tsx`: プロバイダ毎に **windows があれば各枠を個別バー**（title+%+リセット）で列挙、無ければ従来の集約バーにフォールバック。カードは `w-72` + `max-h-80vh`（ヘッダ/フッタ固定・本文スクロール）
  - **折りたたみピル修正**: 従来の `worstProvider().usedPercent`(最大値) → **`全体 {overall}%`（平均）+ `{n} 制限`**（limited/maxed 件数の赤バッジ）。色調は最悪プロバイダ基準で緊急度は維持
- **テスト**: `codexbar.test.ts` に windows パース/`percentTone`/`overallUsedPercent`/`limitedCount` を追加 → 計 **79 passed**。typecheck/lint/build 緑
- **実機検証**: ホスト再起動→ `/api/plugins/codexbar/usage` が HTTP/HTTPS(8443) 両方で `windows` を返却。ブラウザで全枠バー描画＋折りたたみピル「全体 52% · 1 制限」をスクショ確認

### Cursor「API 優先」バグ修正（プラン＝総使用量） (2026-07-17)

- **報告**: Cursor の「プラン」が総使用量（Auto+API 込み）だが、代表値が最大値=API(100%) になり maxed 誤判定＋折りたたみで誤「1 制限」
- **根本原因**: `UsageExporter.BuildEntry` の集約が「全 window の最大値」。Cursor の内訳窓（Auto/API/オンデマンド）が総量窓（プラン）を上書き
- **修正（CodexBar C#, 集約対象を限定）**:
  - `RateWindow` に `CountsTowardLimit`（既定 true）を追加。集約対象か否かのフラグ
  - `CursorUsageProvider`: `cursor-auto`/`cursor-api`/`cursor-ondemand` を `CountsTowardLimit: false`（プランの内訳のため）。`cursor-plan` のみ集約対象
  - `UsageExporter.BuildEntry`: 集約 max と soonestReset を `CountsTowardLimit` 窓のみで計算（どれも該当しなければ全窓にフォールバック）。**全 window は表示用に引き続きエクスポート**
- **結果**: Cursor `usedPercent` = プラン(82.67%)、`limited/maxed=false`。window 一覧は プラン/Auto/API を維持（API 100% は内訳として赤バー表示）
- **WebUI 変更不要**（集約値をそのまま利用）。live 検証: API が cursor 82.67%/limited:false を返却、ヘッダ「Cursor 83%（橙）」、折りたたみピル「全体 48%」で誤「制限」バッジ消滅をスクショ確認

### CodexBar 本体（トレイ/ポップアップ）も同修正 (2026-07-17)

- **報告**: WebUI だけでなく CodexBar のトレイ tooltip も「Cursor 100%」＆「全体」に内訳窓が混入して誤り（例: `全体 41% … Cursor 100%`）
- **修正（`App/TrayApplicationContext.cs`）**:
  - tooltip の「全体」平均 `allPercents` と `secondaryValues` を `CountsTowardLimit` 窓のみに限定（内訳の Auto/API/オンデマンドを除外、該当なしは全窓フォールバック）
  - プロバイダ別 `peak` を全窓 max → 集計対象窓 max に変更（Cursor は プラン 値）
- **修正（`App/UsagePopupForm.cs`）**: プロバイダ見出しの `isLimited`/`isMaxed` を集計対象窓のみで判定（API 100% で見出しが maxed 化しない）。**各窓行の描画は不変**＝プラン/Auto/API を個別色で表示（API は赤のまま詳細表示）
- リビルド＆再起動済み。トレイは `全体`＝集計対象窓平均、Cursor は プラン(83%) を表示

### 「全体」値のプラグイン版⇔デスクトップ版の不一致を統一 (2026-07-17)

- **報告**: 「全体」の値が WebUI プラグインと CodexBar デスクトップで違う
- **調査結果（算出方法が別物）**:
  - WebUI `overallUsedPercent` = **各プロバイダ代表値の平均**（5値、例 (1+23+56.3+78+82.67)/5 ≈ **48%**）
  - CodexBar 旧 `displayPrimary = AveragePercent(allPercents)` = **全「集計対象窓」の平均**（窓数で重み付け、10値 ≈ **32%**）。窓数の多いプロバイダに偏る上、CodexBar 自身のツールチップ列挙値（各プロバイダ peak）平均とも不一致だった
- **修正（`TrayApplicationContext.cs`）**: `allPercents`（全窓）→ `providerPeaks`（各プロバイダの集計対象窓 max＝ツールチップ列挙値と同一）に変更し `displayPrimary = AveragePercent(providerPeaks)`。これでトレイの「全体」＝列挙プロバイダ値の平均になり、WebUI と一致（両者 48%）。トレイアイコンの gauge/highlight も同値ベース
- 丸めは両者 `Math.Round`/`Math.round` で一致。リビルド＆再起動で反映

### プロバイダごとのアイコン + 展開/最小化（プラグイン & デスクトップ） (2026-07-17)

- **要件**: プラグイン版もプロバイダごとに括りアイコンを設定。デスクトップと共通で、プロバイダ単位に展開/最小化でき、最小化時は代表値のみ表示
- **WebUI プラグイン（実装・live 検証済み）**:
  - CodexBar デスクトップのブランドアイコン（codex/claude/cursor/ollama/opencode）を `web/public/plugins/codexbar/` に同梱。`providerIconSrc(id)`（`codexbar.ts`）で解決、ユニットテスト追加
  - `CodexBarWidget` の各プロバイダ行にアイコン + クリック可能な見出しを追加。見出しクリックで**窓の展開/最小化**をトグル、最小化時は代表値(%)のみ表示。状態は `localStorage`(`webui:plugin:codexbar:providers`) にプロバイダ別で永続化。画像 404 時は Activity アイコンにフォールバック
  - typecheck/lint/build 緑。ブラウザで Cursor 行を最小化→「Cursor 83%」のみ表示、再展開で窓復帰をスクショ確認
- **CodexBar デスクトップ（実装・要手動確認）**:
  - `AppSettings.CollapsedProviders`（永続化）を追加
  - `UsagePopupForm`: `ProviderCard.Collapsed` を追加し、最小化時はカード高さ=見出しのみ、右端に代表値（集計対象窓の peak）を描画。`IsProviderCollapsed`/`ToggleProviderCollapsed`（settings 更新→Save→`UpdateCards` で再レイアウト）
  - クリック検出は2経路: reorder 有効時は `DoDragDrop` がドロップせず戻った＝クリックとしてトグル / reorder 無効時は mousedown→mouseup 同一カード・移動小でトグル
  - ビルド緑・起動安定を確認。※トレイポップアップの対話操作は当方から駆動不可のため、クリックでの展開/最小化はユーザー手動確認が必要

### プラグイン: 最小化時も代表値バー + 最上部に全体バー (2026-07-17)

- 最小化したプロバイダ行でも**代表値のバー**を表示（従来は数値のみ）→ `ProviderRow` collapsed 分岐に `UsageBar`(tone=usageTone, percent=usedPercent) を追加
- ボディ最上部に **`全体` バー**（`OverallRow`, percent=`overallUsedPercent`, 色は `percentTone(overall)`）をトークン行の上に追加
- build 緑。ブラウザ検証: 最上部「全体 49%」緑バー、Cursor 最小化で「Cursor 84%」+橙バー表示、再展開で窓復帰
- 注意: 別エージェント稼働中のため CodexBar 関連ファイルのみコミット（`ui.test.ts` 等の未追跡物には非干渉）

### デスクトップ版: 最小化時も代表値バー + 最上部に全体バー (2026-07-17)

- WebUI プラグインと同じ 2 点をデスクトップ版ポップアップ（`UsagePopupForm`）にも反映
- **最小化カードの代表値バー**: `ProviderCard.Collapsed` 分岐で高さを `Scale(2)+BarHeight` 拡張し、`DrawCard` collapsed 分岐でタイトル右の代表値(%) に加え代表値バーを描画
- **最上部の `全体` バンド**: ヘッダー直下・カード群の上に「全体 NN%」ラベル + バーを描画（`DrawOverallBand`）。全体値は `OverallPercent()`＝各プロバイダ代表値（集計対象窓の peak）の平均で WebUI と一致
- レイアウト整合: `ContentTop`（= `CardPadding+HeaderHeight+overallBandHeight`）プロパティを新設し、`BuildCards`/`CardAt`/`CardIndexAtY`/`RecomputeCardPositions`/コンストラクタの座標基点を統一。バー塗り色は共通ヘルパ `DrawValueBar`、全体バーは全プロバイダ accent の平均色（`BlendAccents`）
- CodexBar リポジトリで `dotnet build` 緑（0 err/0 warn）→ commit `1606ec8`。※トレイ描画の目視はユーザー手動確認（当環境の非対話シェルからは tray アプリが常駐表示されないため CodexBar を停止→再ビルドのみ実施、再起動はユーザー側で）

## Caddy HTTPS セットアップ実行完了 (2026-07-17)

- ローカル PC で HTTPS を実際に有効化・検証済み:
  - Caddy を `:8443` で起動（admin API :2019 稼働）
  - **CA を Windows 信頼ストアへ登録**（管理者で `caddy trust` → "root certificate is already trusted by system" / exit 0）
  - ファイアウォール 8443 inbound 許可を追加
- **重要な発見**: `caddy trust` は起動中 Caddy の admin API(:2019) から CA を取得するため、**Caddy が動いていないと `dial tcp :2019 refused` で失敗**する。→ `scripts/caddy-trust.bat` に 2019 到達チェックを追加
- 検証: `Invoke-WebRequest`（証明書検証あり・バイパスなし）で `https://localhost:8443/api/health` → **STATUS 200**。信頼が有効に機能。※`curl.exe`(schannel) は exit 35 になるが、その curl ビルド固有のバグで実害なし（.NET/ブラウザは正常）
- 現状 Caddy は手動 detached 起動。次回 `start-webui.bat` からはトレイホスト（`OPENCODE_WEBUI_CADDY=1` 設定済み）が Caddy を管理する

## Caddy HTTPS 対応 (2026-07-17)

- `deploy/Caddyfile` 既定を **HTTPS `:8443` + `tls internal`**（Caddy ローカル CA・自己署名）へ変更。HTTP(:8080) と 公開ドメイン(Let's Encrypt) はコメントブロックで同梱
- **重要な発見**: `:8443`（ホスト名なし）だと `tls internal` が SNI 向け証明書を発行できず TLS handshake で `internal error`(alert 80) を返す。→ site 行に**名前/IP を明示列挙**する必要がある: `https://localhost:8443, https://127.0.0.1:8443, https://192.168.0.102:8443`
- 起動時 UAC ハング回避のため global に `skip_install_trust`。信頼登録は別途 `scripts/caddy-trust.bat`（管理者/1回）で `caddy trust`
- 検証: Node https(rejectUnauthorized:false) で localhost / LAN IP / SNIなし すべて **STATUS 200**（webui/opencode ok）。※Windows の curl(schannel)/.NET は localhost CA と相性が悪く失敗するが、これはクライアント側制限で Caddy は正常
- `scripts/caddy-trust.bat`（CA を信頼ストア登録＋スマホ用 root.crt パス案内）、`scripts/allow-firewall-8443.bat`（8443 開放）追加。README に HTTPS 手順追記
- アクセス: `https://localhost:8443` / `https://<LAN・VPN IP>:8443`。LAN IP 変更時は Caddyfile の site 行に追記（DHCP 予約推奨）。PWA/SW は信頼済み証明書が必要

## E2E: 設定ページ + テーマ切替 (Phase Q) (2026-07-17)

- `smoke.spec.ts` に設定ページ（`/settings`）描画検証（「設定」「Remote Workspace」見出し）とテーマ切替の実挙動（html class 変化）を追加。E2E 4 passed

## Playwright E2E スモーク (Phase Q) (2026-07-17)

- `@playwright/test` 導入、`web/playwright.config.ts`（webServer=`npm run start`、port 3100）+ `web/e2e/smoke.spec.ts`（ホーム見出し/composer/タイトル、OpenCode 非依存）
- `web/vitest.config.ts` で `include: src/**/*.test.ts` に限定し e2e spec を vitest から除外
- `npm run e2e` スクリプト、CI に playwright ジョブ追加（`playwright install --with-deps chromium` → build → e2e）
- ローカル実行: E2E 2 passed / vitest 47 / lint / typecheck / build すべて緑

## デスクトップ通知 (Phase UI-4) (2026-07-17)

- `web/src/lib/notify.ts`: `decideNotification`（純粋・状態遷移で通知種別判定。granted かつ非フォーカス時のみ、rising edge で要確認優先/完了）+ `notificationText`
- TaskView に統合: 実行中/要確認で権限リクエスト、遷移時に `new Notification`（tag=task-id）
- `notify.test.ts`(9) 追加、計 47 tests 緑。Web Push（タブ閉時）は別途サーバ実装が必要なため未

## CI に build 追加 + ビルド検証 (Phase Q) (2026-07-17)

- ローカル `next build` がクリーン通過（exit 0）を確認
- CI web ジョブに `npm run build`（NEXT_TELEMETRY_DISABLED）ステップ追加

## tasks 集約ロジックのテスト (Phase Q) (2026-07-17)

- `task-service.ts` の状態判定を純粋関数 `deriveTaskStatus` として `task-status.ts` に分離（重い依存を巻き込まずテスト可能に）
- `task-status.test.ts`(9): orphaned/merged/working(busy,retry)/unknown/ready/idle 優先順位と binding 無し時の分岐
- 計 38 tests 緑

## ユニットテスト拡充 (Phase Q) (2026-07-17)

- `diffparse.test.ts`(8): parseUnifiedDiff（変更/新規/binary/rename/複数）+ untrackedHunk（全 +/truncate）
- `allowlist.test.ts`(5): `./db` を vi.mock、assertAllowedDirectory の 引数欠落/rootなし/配下許可/root自身/範囲外拒否
- 計 29 tests 緑（lint/typecheck も緑）

## PWA Service Worker (Phase UI-4) (2026-07-17)

- `web/public/sw.js`: オフラインシェル + 静的アセットキャッシュ。ナビゲーションは network-first→cache フォールバック、`/_next/`・アセットは cache-first。`/api/*`(SSE 含む) は非介入、GET/同一オリジンのみ
- `web/src/components/ServiceWorkerRegister.tsx`: 本番のみ登録（layout に追加）
- eslint ignore に `public/**` 追加。lint/typecheck/test 緑

## openapi 型生成 (T3) (2026-07-17)

- `openapi-typescript` を devDep 追加、`npm run gen:types` で `docs/opencode/openapi.json` → `web/src/lib/opencode-schema.d.ts`（3.1.0 / 156 paths / 444 schemas）を生成
- `web/src/lib/opencode-api.ts`: `OcSchemas` / `OcSchema<K>` / `OcPaths` / `OcOperations` エイリアス。新規エンジン呼び出しはこれを利用、手書き型は段階的移行
- 生成 .d.ts はスナップショットとしてコミット（CI typecheck が生成なしで通る）。lint/typecheck/test 緑

## base branch 比較 diff (Phase UI-3) (2026-07-17)

- `/api/diff/files` に `base` クエリ追加: `git diff --merge-base <base>`（失敗時 2-dot fallback）。ref は正規表現でガード、payload に `base` 追加
- DiffPane にブランチ比較 select（「未コミット変更」/ `vs <branch>`）。比較中はコミット無効化・commit パネル自動クローズ
- Phase UI-3 完了（typecheck/lint/test 緑）

## コミットメッセージ生成補助 (Phase UI-3) (2026-07-17)

- `web/src/lib/commit-message.ts`: 選択ファイル群から決定論的にメッセージ案（Add/Update + basename or `N files in <dir>`）
- DiffPane commit パネルに「生成」ボタン追加。`suggestCommitMessage` は vitest 5 本（計 16 tests 緑）

## favicon バッジ通知 (Phase UI-4) (2026-07-17)

- `web/src/lib/favicon-badge.ts`: canvas 生成の favicon に状態ドット（attention=赤/working=橙/idle=無）
- `TaskView` のタブタイトル effect に統合。純粋関数 `badgeColor` は vitest 済（11 tests 緑）

## CI 追加 (Phase Q) (2026-07-17)

- `.github/workflows/ci.yml` 追加: push/PR で 2 ジョブ
  - web: `npm ci` → lint / typecheck / vitest（node20, npm キャッシュ）
  - host: `node --check host/src/index.js`
- `web/package.json` に `typecheck`(`tsc --noEmit`) スクリプト追加
- ローカル検証: lint / typecheck / test すべて緑（8 tests passed）

## Caddy セットアップ完了 (2026-07-17)

- Caddy 2.11.4 を winget でインストール（`%LOCALAPPDATA%\Microsoft\WinGet\Links\caddy.exe`）
- `deploy/Caddyfile`（gitignore 済ユーザー固有）を生成: 既定はプレーン HTTP `:8080` → `reverse_proxy 127.0.0.1:3000`（SSE 無バッファ）。Basic 認証 / ローカル HTTPS(tls internal+skip_install_trust) / 公開ドメイン の各ブロックをコメントで同梱
- `caddy validate` 通過 + 実起動で `http://localhost:8080/api/health` が正常応答（webui/opencode ok）を確認。TLS 自動化は UAC/CA インストールでハングするため既定は避けた
- 恒久設定: ユーザー環境変数 `OPENCODE_WEBUI_CADDY=1` を設定（今後 start-webui.bat がホスト経由で Caddy を起動）
- `scripts/allow-firewall-8080.bat` 追加（管理者実行で 8080 を LAN 許可）。LAN IP 例: 192.168.0.102 → `http://192.168.0.102:8080`

## Caddy 対応 + 計画書 Phase 整理 (2026-07-17)

- ホスト（`host/src/index.js`）に Caddy 逆プロキシ管理を追加
  - `OPENCODE_WEBUI_CADDY=1` で有効化、`OPENCODE_WEBUI_CADDYFILE` でパス指定
  - 初回に `deploy/Caddyfile.example` → `deploy/Caddyfile` を自動生成（gitignore 済）
  - opencode/web と起動・停止・再起動を連動、トレイ Status に Caddy 表示
  - OpenCode は 127.0.0.1 固定、公開は BFF(:3000) のみ。VPN/認証必須を README に明記
- `deploy/Caddyfile.example` を SSE 無バッファ + HTTPS/LAN 2 案 + 認証コメント付きに刷新
- `docs/improvement-plan.md` を Phase 構成へ整理: §4 各フェーズに ✅/🔶/⬜ ステータス、Phase R(リモート/Caddy) 追加、§9 を「Phase 別ステータス + 残タスク」へ再編

## worktree 残骸削除の堅牢化 (2026-07-17)

- 症状: git がもう認識しない worktree フォルダ（.git リンクも消えた残骸）が orphan に残り、掃除で消えない
- 原因: `fs.rmSync` が Windows の read-only（git objects/packs 等）で EPERM → 削除失敗
- 対策: `rmDirBestEffort` を EPERM 時に read-only 属性を再帰解除して再試行するよう強化

## Diff フィルタ表記 (2026-07-16)

- tracked/untracked → 「既存の変更」「新規ファイル」。並列 → 「並列表示」
- バッジ new/binary → 「新規」「バイナリ」

## Home composer: master/worktree 二択 (2026-07-16)

- 横スクロールバー廃止 → `flex-wrap`
- isolation は `master`(current_folder) / `worktree`(git_worktree) の二択のみ
- ベースブランチ select は隠し、API の default/master/main を自動使用
- 一時コピー / Dev Container は Home から除外（API 経由は従来どおり）

## Worktree ブランチ命名 (2026-07-16)

- 規則: `webui/{base}/{slug}-{id8}`
  - `base` = 分岐元ブランチの leaf（未指定時 `main`）
  - `slug` = タイトルの ASCII 化（2文字未満なら `task`）— 日本語だけのタイトルは `task`
  - `id8` = workspace UUID 先頭8桁（時刻乱数やめ）
- 例: `webui/master/fix-login-a1b2c3d4` / `webui/main/task-deadbeef`
- Sidebar: 各タスク下にブランチ表示（current_folder は `master`/`main`、worktree は `webui/` 除去）

## レスポンシブ UI/UX 改善 (2026-07-16)

- TaskView: モバイルで 変更/ファイル/グラフ タブ到達。ヘッダは横スクロール＋窄幅で副次ボタンを隠す
- Home composer: select 横スクロール、送信ボタン固定。safe-area bottom
- AppShell/Sidebar: safe-area、タッチで ★/削除を常時表示
- Diff 並列は sm+、Graph バッジは狭幅で折り返し。globals overflow-x clip
- 第2弾: Diff の Merge/PR/並列を sm+ のみ、Commit ラベルも sm+（アイコンは常時）。チェックボックス tap 拡大
- FileTree/Graph/Pty の `border-l` は lg+ のみ（モバイル全幅時の二重線回避）
- Settings: engine/アクセス行を flex-wrap、safe-area bottom
- 第3弾: Task タイトル truncate 強化、SessionSwitcher をモバイルでも表示
- Task composer を Home 同様の横スクロール＋送信固定に統一
- CommandPalette safe-area / esc 非表示、Permission 名 break-all、NestedAgent 幅対策
- 第4弾: SessionActions をモバイル表示、「入力欄に戻す」をタッチ常時表示
- Markdown テーブル横スクロール／インライン code 折返し、Diff commit/PR 縦積み、Graph diff 溢れ対策
- 第5弾: AppShell ノッチでヘッダ潰れ修正、Home エンジン未接続警告、ツール詳細/cost/Question 折返し
- **サイドバー幅**: デスクトップ右端ドラッグで 180–480px 可変。`webui.sidebar.width` に永続。ダブルクリックで 240px リセット
- **右パネル幅**: Diff/Files/Graph/Pty 左端ドラッグで 280–900px 可変。`webui.sidepanel.width` に永続。ダブルクリックで 520px リセット

## Git グラフのブランチ表示修正 (2026-07-16)

- マージ後の合流で第2レーンが途切れて見えていた → 複数レーンが同一 commit を待つとき upper merge を描画
- マージ commit から side parent へは lower fork を描画
- tip 共有のブランチバッジが並びすぎる問題 → 最大2件 + `+N`（current 優先）

## Code/Ask/Plan と agent の重複解消 (2026-07-16)

- Home composer の Code/Ask/Plan は OpenCode agent（build/plan）選択と同じ役割で二重だった
- モード select を廃止し agent select に一本化。表示は `build（Code）` / `plan（Plan）` などラベル補足

## Git グラフパネル (2026-07-16)

- タスク右カラムに `sidePanel: "graph"`（ヘッダ GitGraph アイコン）
- `GET /api/git/log`（commits + branch refs）/ `GET /api/git/show`（ファイル一覧・ファイル diff）
- `GraphPanel` + `layoutGraph` スイムレーン描画。展開で変更ファイル、クリックで diff プレビュー

## worktree 削除失敗 / orphan 残留 (2026-07-16)

- 症状: タスク削除で 409 → 「要復旧の Workspace」に残る（フォルダは消えていることが多い）
- 原因: Windows/OneDrive で `git worktree remove` や rimraf が一時ロックに負ける
- 対策: remove リトライ強化。パスが既に無い場合は成功扱い（DB 行削除）。設定画面の scan で gone orphan を自動 purge。Sidebar 削除失敗を alert 表示

## Diff パネル修正 (2026-07-16)

- `openFileInDiff` が `setSidePanel("diff")` せず FileTree/Pty 表示中に Diff へ戻れなかった
- パスを directory 相対に正規化。Diff 列に `min-h-0` ラッパ
- busy→idle に加え patch/edit 完了でも `diffKey` 更新。`/api/diff/files` は存在しない cwd 等で 500 せず `{git:false,error}` 

## フルアクセス（権限モード）ドロップダウン (2026-07-16)

- composer（Home / Task）にアクセスモード select: **確認する** / **フルアクセス**
- フルアクセス時は pending permission を `once` で自動承認。localStorage `webui:access-mode` で永続化
- PermissionCard の「オプション…」ドロップダウンから **常に許可** / **フルアクセス** も選べる

## 巻き戻し → 入力欄へ復元 (2026-07-16)

- 意図: 巻き戻したユーザーコメントを下の composer に入れて編集・再送できる
- メッセージの「入力欄に戻す」/ ヘッダ戻る: テキスト抽出 → revert（当該以降を非表示）→ `setInput` + focus

## 巻き戻し位置の修正 (2026-07-16)

- インライン「巻き戻し」は**そのメッセージを残し、これより後だけ**戻す
- OpenCode は messageID のみだと直前 user まで snap するため、次メッセージ + 先頭 partID で呼ぶ
- ヘッダの戻るは「直前ターン全体の取り消し」（入力＋返答を消す）のまま

## 巻き戻しが効かない修正 (2026-07-16)

- OpenCode の revert はメッセージを**削除せず** `session.revert.messageID` でソフト非表示
- WebUI が全メッセージを表示し続けていたため「OKしても変わらない」ように見えた
- `filterRevertedMessages` + `GET /session/{id}` で revert 状態を取得し、以降を隠す。バナーで復元可。Diff も再読込

## 巻き戻し (revert) 修正 (2026-07-16)

- OpenCode `POST /session/{id}/revert` は **messageID 必須**。空 body だと失敗していた
- ヘッダの戻るアイコン: 直前の user メッセージ ID を渡す + confirm。隣に unrevert
- 各 user メッセージにホバーで「巻き戻し」インラインボタン

## 競合ギャップ P0〜P3 実装スプリント (2026-07-16)

- **プロジェクト削除**: `DELETE /api/projects` + `destroyProject`。Settings / Sidebar から削除可
- **ToDo**: `GET /session/{id}/todo` を resync。cancelled 表示、busy 時展開、ヘッダバッジ
- **サブ/孫エージェント**: `NestedAgentPanel` が children API を深さ3までポーリング表示
- **permission resync**: `GET /permission`。実行中ツール名をヘッダ表示
- **P1**: Diff tint / 並列表示 / フィルタ、branch picker、Ask/Plan、Merged+cleanup、cost、タブタイトル
- **P2**: SessionSwitcher、FileTree、Pty 一覧、revert/compact
- **P3**: vitest(`difftint`)、MCP 読取、Remote 明示。詳細は `docs/improvement-plan.md` §9

## question ツールで停止する問題 (2026-07-16)

- **症状**: タイムラインが `question` ツールのスピナーで止まり「作業中…」のまま
- **原因**: OpenCode の `question.asked` はユーザー回答待ち。WebUI は permission のみ実装で質問カードが無く応答不可
- **修正**: `QuestionCard` + `useSessionStream` で `question.asked/replied/rejected`（v1/v2）を処理。`GET /question` で再接続時も復元。回答は `POST /question/{id}/reply`、拒否は `/reject`

## ツール表示の人間化 + フォローアップで agent/model 変更 (2026-07-16)

- **症状**: task ツールが JSON 入力 + `<task_result>` XML をそのまま表示。「生すぎる」
- **修正**: `PartView` の ToolPart がラベル要約・フィールド一覧・結果テキスト抽出（XML 剥がし）を表示。折りたたみ時は結果プレビュー1行
- **症状**: タスク画面のフォローアップ composer に agent/model がなく途中変更不可
- **修正**: `useSessionStream.sendPrompt` が `agent`/`model` を `prompt_async` に渡す。TaskView composer に Home 同様の select。最後の assistant メッセージのモデルで初期選択を上書き

## Cursor 型左サイドバー (2026-07-16)

- **方針**: 1A（Project → Task ツリー）+ 全画面で常時サイドバー
- `AppShell` + `Sidebar`（`components/shell/`）。ルートは `app/(app)/layout.tsx` で共有
- 左: プロジェクト展開 → タスク一覧（状態ドット・相対時刻・ホバー削除）。モバイルはドロワー
- 中央: `/` = composer のみ、`/task/[id]` = 会話+Diff、`/settings` = 設定
- タスク作成/削除後は `webui:tasks-changed` でサイドバー即更新。`StatusBadge` は `components/StatusBadge.tsx` へ分離
- ⌘K はシェルに1つ。TaskView が `ShellContext` 経由で directory / onFile を渡す

### composer の「既定」選択肢を廃止 (2026-07-16)
- モデル/エージェント select から空の「既定」option を削除
- 初期選択は `/config.model`（例: `openai/gpt-5.6-sol`）を優先。無いときだけ provider `default`
- エージェントは config に文字列があればそれ、なければ `build`

### プロジェクト追加: フォルダ選択ダイアログ (2026-07-16)
- **スマホ対応**: ネイティブ FolderBrowserDialog は PC 画面に出るだけなので廃止し、`GET /api/browse/dirs` + モーダルでディレクトリを辿る UI（`AddProjectButton`）
- スタートはユーザーホーム。ホーム表示時に **クイックアクセス**（`Links\*.lnk` + JumpList `f01b4d95…`）を先頭表示（`lib/quickaccess.ts`）
- パス手入力もモーダル内に残す

### スマホ / VPN アクセス (2026-07-16)
- WebUI 既定バインド: `0.0.0.0:3000`（`OPENCODE_WEBUI_HOST`）。OpenCode は `127.0.0.1:4096` のまま
- 設定画面「スマホ / VPN アクセス」に NIC 別 URL（VPN 優先）+ コピー。`GET /api/access`
- **同一LANでも届かない主因は Windows ファイアウォール + ネットワーク分類（Public）**
- PC は Wi‑Fi `192.168.0.192`(Private) と有線 `192.168.0.102`(Public/Manual) の二重 NIC 同一サブネット
- 対策: 管理者で `scripts/fix-lan-access.bat`（Private 化 + TCP 3000 + node.exe allow）
- 相手端末の接続経路と URL を合わせる（Wi‑Fi端末→.192、有線端末→.102）。Surfshark は Allow LAN / Kill Switch 確認

### worktree 削除失敗 → orphaned (2026-07-16)
- **症状**: タスク削除で `git worktree remove failed; marked orphaned`
- **原因**: Windows/OneDrive で worktree メタデータが壊れると `git worktree remove` が `not a working tree` で失敗。フォルダと `.git/worktrees/<name>` が残留
- **修正**: `removeWorktree` が失敗時に `prune` + `fs.rmSync`(retry) + admin dir 削除へフォールバック。パスが既に無い場合は成功扱い

### バグ修正: タスク0件時の誤警告 (2026-07-16)
- **症状**: ホームに「OpenCode エンジンに接続できません」と出るが `/api/health` は `opencode.ok: true`
- **原因**: `task-service.ts` の `sessionStatusFor` が workspace ディレクトリ0件のとき `/global/health` を呼ばず `engineOk: false` のまま返していた
- **修正**: ディレクトリ0件時は `globalEngineOk()` で `/global/health` を確認

## UI-4 + トレイアイコン修正 (2026-07-16)


### トレイアイコン
旧 `host/src/icon.json` は **PNG** の base64 だったが、Windows の systray2 は **ICO** 必須 → アイコン非表示の原因。`scripts/gen-icons.mjs`(コミット済み) が 16/32px の 32bpp BMP エントリ入り ICO と PWA 用 PNG(192/512/180) を同一デザイン(青角丸+白 `>_`)から生成する。再生成: `node scripts/gen-icons.mjs`

### UI-4 実装
- PWA: `app/manifest.ts` + apple-touch-icon + themeColor (standalone 起動可)
- ⌘K/Ctrl+K コマンドパレット (`components/CommandPalette.tsx`): タスク切替+アクション+タスク内ファイル検索 (OpenCode `/find/file`)。全 3 画面に搭載
- モデル/エージェント選択: Home composer に `/provider`(connected でフィルタ)・`/agent`(primary のみ) の picker。`POST /api/tasks` → prompt_async に伝搬

### 運用ノウハウ (重要)
- **`next dev` は `.next` の本番ビルドを上書きし BUILD_ID を消す** → トレイ host の prod 起動が壊れる。対策済み: `next.config.ts` の `distDir` が `NEXT_DIST_DIR` を読む。`.claude/launch.json` の dev は `.next-dev` を使用
- ホストを `taskkill` で殺すと `%APPDATA%\opencode-webui\host.lock` が残留する。次回起動は stale 検知で回復するが、PID 再利用中だと誤検知しうる → 異常時は lock を手動削除
- ホスト再起動手順: lock の PID を taskkill /T → `start-webui.bat`(または `cd host; node src\index.js` を detached)。ログは `%APPDATA%\opencode-webui\host-out.log`(今回の起動分)
- 検証済み: 本番 3000 で新 UI 配信・manifest・トレイ表示・エンジン接続 (2026-07-16 再起動済み)

### バグ修正: タスク0件時の誤警告 (2026-07-16)
- **症状**: ホームに「OpenCode エンジンに接続できません」と出るが `/api/health` は `opencode.ok: true`
- **原因**: `task-service.ts` の `sessionStatusFor` が workspace ディレクトリ0件のとき `/global/health` を呼ばず `engineOk: false` のまま返していた
- **修正**: ディレクトリ0件時は `globalEngineOk()` で `/global/health` を確認

## Codex 型 UI 実装 (2026-07-16)

### 実装内容 (Phase UI-0〜UI-3 + Settings)
- **UI-0**: semantic tokens (`globals.css`, light/dark + next-themes)、UI プリミティブ (`components/ui.tsx`)、`/` `/task/[id]` `/settings` ルーティング分割
- **UI-1**: composer-first ホーム (`home/HomeView.tsx`)。`POST /api/tasks` が workspace+session+prompt_async+binding を1アクションで実行。タスクカード (状態チップ+diff stat+相対時刻、`lib/task-service.ts` で集約、dirstat 15s キャッシュ)
- **UI-2**: `lib/useSessionStream.ts` — SSE `message.part.updated` で増分更新 (全量ポーリング廃止)。Part レンダラ (`task/PartView.tsx`: Markdown/Tool カード/Reasoning 折りたたみ/Patch チップ)。権限キュー+インラインカード、abort、todo パネル
- **UI-3**: `task/DiffPane.tsx` — `/api/diff/files` (unified diff パース+untracked 内容合成) でファイル別表示、選択コミット/Merge/PR
- 旧 AppShell/ChatApp/ProjectLauncher/DiffPanel/FileSearch は削除。workspace 生成は `lib/workspace-service.ts` に集約

### 重要バグ修正: プロキシの content-encoding
`/api/opencode/[...path]` が upstream の `content-encoding: gzip` ヘッダを転送していたが、Node fetch はボディを解凍済みで返すため、**大きいレスポンス(圧縮閾値超え)だけ**ブラウザで解凍エラー → `Failed to fetch` / 空データになる。HOP_BY_HOP に `content-encoding` を追加して解決。小さいレスポンスでは発生しないため Phase 0 検証をすり抜けていた。

### 検証済み (dev 3210 + 実エンジン 1.17.11)
composer→タスク作成→タイムライン表示→SSE 増分ストリーミング (追いプロンプトがリロードなしで表示)→状態遷移 (実行中→変更あり)→Diff ペイン→タスク削除。`npm run build` クリーン。

### 残タスク (Phase UI-4 以降)
PWA / ⌘K パレット / モデル・エージェント選択 / diff シンタックスハイライト / vitest+Playwright。ブラウザ自動操作時の注意: React controlled input は form_input が効かない (native setter+input event が必要)

## 改善・開発計画立案 (2026-07-16)

- MVP コード監査 + Codex UI 調査を実施し、[docs/improvement-plan.md](docs/improvement-plan.md) を作成
- 骨子: UI-0 デザイン基盤(shadcn/tokens/型生成) → UI-1 composer-first Home → UI-2 Part レンダラ+SSE 増分更新(最重要) → UI-3 Diff レビュー → UI-4 モバイル/PWA
- 確認済み: OpenCode 1.17.11 に `message.part.updated` / `session.status` / `abort` / `todo` / `/find/file` / Part 型(Tool/Reasoning/File 等) が揃っており、Codex 型 UI の材料はエンジン側に全部ある(UI が未使用なだけ)
- 次の着手: Phase UI-0（shadcn/ui + next-themes + openapi-typescript + ルーティング分割）

## 起動デバッグ (2026-07-16)

### 原因
1. **`SysTray is not a constructor`** — systray2 の ESM/CJS 二重 default
2. **`spawn EINVAL`** — Windows で `npm.cmd` / shim を `shell:false` で起動
3. **opencode パス** — extensionless shim を優先してしまっていた

### 修正
- SysTray: `default.default` 解決
- opencode: `opencode-ai/bin/opencode.exe` を解決
- WebUI: `npm-cli.js` を Node から直接起動（`shell:false`）。prod は有効な `.next/BUILD_ID` があれば `next start`
- `start-webui.bat`: 初回 build、失敗時 pause
- `OPENCODE_WEBUI_HEADLESS=1` でトレイなし検証可

### 検証
- headless host → WebUI/OpenCode ready
- `scripts/smoke-api.mjs` → Smoke passed
- SysTray `new` → tray ok

## リリース起動

```bat
start-webui.bat
```

環境変数: `OPENCODE_WEBUI_MODE=prod|dev` / `OPENCODE_WEBUI_HOST=0.0.0.0|127.0.0.1` / `OPENCODE_WEBUI_NO_BROWSER=1` / `OPENCODE_WEBUI_HEADLESS=1`


## 2026-07-17 Home composer UI 再設計（ゴーストセレクト化）

### やったこと
- ui-ux-designer に仕様策定を委任し docs/home-composer-redesign.md を作成
- ui.tsx に GhostSelect（アイコン+選択値+ChevronDown の上に透明 native select を重ねる）を追加し、HomeView の 5 セレクト・AccessModeSelect・TaskView follow-up composer を置換
- Primary（プロジェクト/worktree）左・Secondary（モデル/エージェント/アクセス）右にグループ化。sm 未満は 2 行分離 + アクセスモードを order-first で先頭
- ui-ux-reviewer 指摘を修正: Ctrl+Enter の engineOk 迂回ガード、送信中 textarea readOnly、エラー role=alert、TaskView focus ring
- e2e composer.spec.ts 追加（aria-label combobox、キーボードフォーカス、375px 横スクロールなし、空入力 disabled）

### 判断理由
- Radix/shadcn 不採用方針のため、a11y をネイティブ select に担わせる透明オーバーレイ方式を採用（display:none / pointer-events:none は不可）
- full アクセスは警告色を維持（安全上、視覚的重みを落とさない）
- codexbar 関連ファイルは並行セッション稼働中のため一切触らず、コミット対象から除外

### 教訓
- PNG スクリーンショットはこの環境の Read では検証不可。視覚検証は e2e の DOM アサーション（scrollWidth、aria、focus）で代替する
- 並行セッションが web/tsconfig.json 等に EOL のみの差分を残すことがある。git diff 空なら checkout で復元してよい

## 2026-07-17 徹底デバッグ（状態競合・モバイル遮蔽・依存脆弱性）

### 修正した不具合
- **CodexBar が初期状態で画面を覆う**: 固定配置の展開済みウィジェットが 375px 画面の大半と 1280px の composer 右側を遮蔽していた。未保存時の既定をコンパクト表示へ変更し、明示的に展開した既存設定は維持。
- **タスク/セッション切替で前の状態が残る**: 動的 task route を `key={id}` で再マウントし、`useSessionStream` に directory+session の scope key、即時 render gate、非同期 resync/SSE の stale 応答ガードを追加。messages/status/permissions/questions/todos/revert/error を scope 切替時に初期化。
- **実行中の追いプロンプト誤送信**: Stop ボタン表示中でも textarea の Enter から `prompt_async` が送れた。`working` の送信ガードと `readOnly` を追加し、入力内容は保持。
- **プロジェクト切替時の base branch 競合**: 前プロジェクトの branches 応答が後着して `baseBranch` を上書きし得た。effect cleanup、project-id ownership、取得完了まで submit disabled を追加。取得失敗時は `master` を推測せず base を省略して現在の HEAD を使う。
- **コマンドパレットの検索結果逆転**: debounce 後の古い file search / task load が新しい query や閉じたパレットへ state を書けた。AbortController と unmount/cancel guard を追加。
- **再利用サービスのトレイ誤表示**: healthy な既存 OpenCode/WebUI を再利用すると ChildProcess handle がないため `stopped` と表示していた。HTTP health を優先する純関数へ分離し Node test を追加。
- **git branch の option-like 入力**: `--force` のような先頭 `-` を安全な branch 名として許可していたため拒否するよう強化。

### 依存関係とセキュリティ
- `next` / `eslint-config-next` を 15.5.9 → 15.5.20、`vitest` を 3.2.4 → 3.2.7 へ更新。
- Next 内部の固定 `postcss@8.4.31` は `overrides` で 8.5.10 に更新。`npm audit` は Web/host とも **0 vulnerabilities**。

### 回帰テスト / 検証
- Web: ESLint、`tsc --noEmit`、Vitest **17 files / 94 tests**、Playwright **13 tests** 全通過。
- Host: `node --test` **2 tests**、host/scripts の JS/MJS 構文チェック全通過。
- Next 15.5.20 production build は `NEXT_DIST_DIR=.next-verify` で通過。稼働中の :3000 が `.next` を保持しているため通常出力の同時再ビルドだけ `readlink EINVAL` になる。`start-webui.bat` は BUILD_ID 不在を検知して停止後の次回起動時に自動再ビルドする。
- in-app browser で 375x720 を確認: page horizontal overflow なし、console warning/error なし、CodexBar は右下の compact pill となり composer を遮蔽しない。
- API smoke は修正前ベースラインで全通過。今回 API 契約自体の変更なし。

## 2026-07-17 WebUI stopped の自己修復

### 症状と原因
- トレイが `OpenCode: running / WebUI: stopped / Caddy: running` を表示し、実際に 3000 番ポートも停止していた。表示だけの問題ではない。
- 稼働中の `.next` に通常の production build を重ねた際に出力が不完全になり、`.next/BUILD_ID` が消失していた。
- `start-webui.bat` は起動前なら欠損を再ビルドできる一方、既に動いているトレイの Restart は `next start` を直接実行していたため、欠損ビルドから復旧できなかった。
- WebUI 子プロセスの異常終了時も、状態表示を更新するだけで再起動していなかった。

### 修正
- prod モードで `BUILD_ID` がなければ、不完全な `.next` だけを削除して `npm run build` を実行し、`BUILD_ID` の生成を確認してから起動する自己修復を追加。
- ビルド中はトレイに `WebUI: building…` と表示し、失敗時は起動済みの子プロセスを残さず終了する。
- WebUI の予期しない終了を最大 5 回、1〜5 秒の上限付きバックオフで自動再起動する。60 秒安定稼働後に試行回数をリセットする。
- 手動 Restart / Quit は自動再起動タイマーと競合しないようキャンセルし、Restart の多重実行も抑止する。
- npm は `.cmd` + `shell:true` ではなく `npm-cli.js` を Node から直接実行し、DEP0190 警告と引数連結リスクを解消。
- 起動方針と再試行バックオフを `web-runtime.js` へ分離し、Node test を追加。

### 実機検証
- 不完全な `.next` の削除 → Next 15.5.20 production build → `BUILD_ID` 再生成 → 3000 番ポート起動まで実際に通過。
- 稼働中の Next.js プロセスだけを強制停止し、1 秒後に別 PID で自動復帰して `/api/health` が 200 になることを確認。
- 80 (Caddy) / 3000 (WebUI) / 4096 (OpenCode) がすべて待受中。`/` と `/api/health` は 200、API smoke は全項目通過。
- Host test は **5 tests** 全通過、`node --check` と `git diff --check` も通過。最終起動ログに DEP0190 なし。

## 2026-07-17 サブエージェント徹底デバッグ + 監査（バグ11件修正）

3体の読み取り専用サブエージェント（API ルート / lib コア / React UI）に徹底デバッグを依頼し、各報告をコードを直接読んで真偽検証（監査）した上で、確認できた実バグのみ修正した。

### 修正した不具合（深刻度順）
- **[critical] 細工マニフェストによる任意ディレクトリ再帰削除**: クローンした未信頼リポジトリの `.opencode-webui/sessions.json` が `worktreePath` を無検証で DB に取り込み、タスク削除時に `removeWorktree` の `fs.rmSync(recursive, force)` フォールバックがリポジトリ外の任意パスを削除し得た。`git.ts` の `removeWorktree` に「repoRoot 配下でなければ拒否」ガードを追加（`copy.ts` の既存ガードに倣う）。加えて `restoreProjectFromManifest` で git_worktree の worktreePath が root 外なら取り込み拒否（多層防御）。
- **[high] difftint がキーワード着色で自分の HTML を破壊**: KEYWORDS に `class` が含まれ、コメント/文字列 span の `class` 属性が再マッチして `<span <span …>` に化けていた（表示破損。入力は escape 済で XSS には至らず）。キーワードパスを最初に実行し、後続のコメント/文字列パスが自分の markup にマッチしない順序へ変更。回帰テスト追加。
- **[high] diffparse がハンク内の `---`/`+++` をヘッダ誤認**: 内容が `-- ` で始まる行の削除（diff 上 `--- ...`）がカウント漏れ、`++ ` 追加が `file.path` を上書き。ヘッダはハンク開始前のみ出るため `hunk === null` でガード。回帰テスト追加。
- **[high] フィルタ表示中の「全選択コミット」が隠れファイルまでコミット**: `DiffPane` がフィルタ後リストの全選択を `all:true`（=`git add -A`）に変換していた。未フィルタ総数と一致する時のみ `all` を送るよう修正。
- **[medium] merge `into=branch` 成功後に元ブランチへ戻らない**: worktree が target ブランチに残り、以後の diff/commit が意図せず target を対象に。成功時に元ブランチへ checkout し直す。
- **[medium] ツールメタデータがユーザーのコミットに混入**: `.opencode-webui` / `.webui-worktrees` が親リポジトリで未追跡として現れ、`git add -A` でステージされた。`.opencode-webui/.gitignore`(`*`) を書き出し、commit の add から pathspec 除外、dirstat/diff からも除外。
- **[medium] オーファン削除したタスクがマニフェストから復活**: orphans ルートが DB 行削除後にマニフェスト再永続化をしていなかった。`persistProjectSessions` を追加。
- **[medium] マルチバイトファイル名の文字化け**: `core.quotepath=false` 未指定で日本語名が octal エスケープのまま処理され `statSync` 失敗。`runGit` で常時 `-c core.quotepath=false` を付与。
- **[medium] `adoptProjectFromManifest` が null を返さず**: マニフェスト不在でも 200 を返し、存在しないパスをプロジェクト登録+許可リスト追加していた。不在時は null 返却。
- **[medium] クリップボードコピーが HTTP(LAN/VPN)で沈黙**: 非セキュアオリジンで `navigator.clipboard` が 
 → 同期 TypeError。`lib/clipboard.ts`（execCommand フォールバック）を追加し TaskView/SettingsView で使用。成功時のみフィードバック表示。
- **[low] その他**: `untrackedHunk` 末尾改行 off-by-one、temporary_copy 破棄時の allowlist 残置（`removeAllowedRoot`）、workspaces PATCH の status 実行時検証、SessionSwitcher onChange の未 catch、`runGit` に `GIT_TERMINAL_PROMPT=0`/`GIT_EDITOR=true`（対話プロンプトによるハング防止）。

### 検証
- `tsc --noEmit` クリーン、ESLint クリーン、Vitest **17 files / 97 tests**（difftint/diffparse に回帰テスト計3件追加）全通過。

### 監査で「実バグでない」と判断し見送った主な指摘
- resync が v2 permission/question を v1 に降格させる懸念（lib/UI 双方が指摘）: OpenCode サーバの v2 API 挙動に依存し、盲目的な変更は回帰リスクが高いため今回は見送り（要別途調査）。
- 各種 stale-response 競合（FileTree/GraphPanel 等）や useSessionStream 初回スナップショットの隙間: 実害限定的な機能改善であり、リスク回避のため保留。
- `browse/dirs` の allowlist 非適用: フォルダピッカーの仕様上のトレードオフ（認証/バインド方針とセットで対処すべき事項）。


---

## 2026-07-18 サブエージェント／孫エージェント疎通テスト

- やったこと: `b-lead-programmer-ollama-cloud-glm-5-2` を親として呼び、親から `c-explore-openai-gpt-5-6-luna` を孫として呼び出した。孫の応答 `TEST_OK` を確認した。
- 判断理由: 孫への `task` 権限を持つ lead-programmer を使い、許可された explore のみを再委任先にして glob-map allowlist を実経路で検証した。
- 教訓: 疎通テストでも終了時に生成される `.opencode-webui/sessions.json` はマシン固有ランタイム状態であり、リポジトリ直下の `.gitignore` で `.opencode-webui/` 全体を除外する。
- 関連コミット: `d857f80`。

## 2026-07-18 コスト表示の日本円対応

- やったこと: メッセージコストを設定で USD / JPY 切替できるようにした。`web/src/lib/currency.ts`（localStorage + イベント同期）、設定画面のレート入力、TaskView の `formatCost` 表示。JPY 時は `cost ¥23.1（$0.1542）` 形式（<1円は小数2桁 / <100円は小数1桁 / それ以上は整数、USD を括弧併記）。
- 判断理由: OpenCode の cost は USD 固定のため、クライアント側でユーザー編集可能な USD/JPY レート（既定 150）換算が最小変更。ライブ為替 API は依存を増やさないため見送り。
- 教訓: 並行セッションが同機能を複数ファイルに実装すると衝突する。正は `currency.ts` 一本に集約し、重複の cost-currency / cost-display は捨てる。
- 検証: `vitest src/lib/currency.test.ts` 6件通過、`tsc --noEmit` 通過。
- 関連コミット: `f86dd4a`。
- master へマージ: `webui/master/task-cc336d3d` を ort で統合（`d3855e0`）。共通祖先は `455b004`（master 側に sidebar URL 事前選択などが先行）。

## 2026-07-18 画像添付機能 + ToDo表示の更新停止バグ修正 (task-989479f8)

- やったこと: `TaskView.tsx` の Composer に画像添付機能を追加（クリップボード貼り付け onPaste / ファイル選択ボタン Paperclip / ドラッグ＆ドロップ）。画像は dataURL として `FilePartInput` で `prompt_async` に送信。選択エージェント/モデルの画像入力対応可否を provider の `modalities.input` / `attachment` フラグから判定し、未対応なら警告表示。ToDo表示が完了後に「進行中」のまま更新されないバグを修正: `useSessionStream` に `refreshTodos()` を追加し、`TaskView` の busy→idle 遷移 effect で呼び出す（エンジンが最後の `todo.updated` SSE を省略することがあるため）。
- 判断理由: 画像対応判定はエージェントの `model` 設定を優先（エージェント選択時は実際にそちらが使われる）、フォールバックで手動モデル選択。ToDoバグはフロント側に遷移バグはなく SSE 欠落が原因と推定、busy→idle の既存 effect に reconcile を乗せるのが最小修正。
- 教訓: OpenCode Engine の SSE は遷移時の最終イベントを省略することがある。idle 遷移時に能動再取得（reconcile）する設計が安全。BFF は `/api/opencode/[...path]` 汎用プロキスのため prompt_async の body 拡張のみで通る。また write ツールが既存ファイルを「存在しない」と誤判定して上書きする事故を起こしたため、既存ファイル追記時は必ず read して末尾を edit で置換する。
- 検証: `tsc --noEmit` 通過、`eslint` クリーン、`vitest useSessionStream.test.ts` 1件通過。
- 関連コミット: `fb4164c`。

## 2026-07-18 worktree 削除失敗（毎回 orphaned/要復旧）の根本修正 (task-989479f8)

- やったこと: 左メニューのセッション削除が毎回失敗し「要復旧」状態になるバグを根本修正。新規 git worktree の作成先を `<repoRoot>/.webui-worktrees/<branch>` から OneDrive 管轄外の `<dataDir>/worktrees/<projectId>/<branchSlug>`（Win は `%APPDATA%/opencode-webui/worktrees/...`）へ変更。`workspace-service.resolveWorktreeDir()` を新設し `provisionWorkspace` の git_worktree 分岐で使用。`git.removeWorktree` の `isInside` ガードを repoRoot 配下 **または** `<dataDir>/worktrees` 配下を許可に緩和。`orphans` route の stray 検出も新パスを含める。`.gitignore` の `# .webui-worktrees/` を有効化。
- 判断理由: 実プローブで原因特定。OneDrive 同期下の `.webui-worktrees` フォルダに Cloud Files の reparse point（属性 525360 = Directory|Archive|ReparsePoint）が付き、OneDrive Sync エンジンが排他ハンドルを保持。`git worktree remove --force` も `fs.rmSync` も `cmd rmdir` も Permission denied/EPERM で失敗（正常稼働中の worktree でも再現）。OneDrive 外であれば `git worktree remove --force` が code 0 で成功しフォルダも消えることを `%APPDATA%/opencode-webui/worktrees/probe` で実証済み。WebUI 側から OneDrive 同期ハンドルは解除不能なため配置場所変更が唯一の根本解決。
- 移行方針: 既存 DB 行の `worktree_path`（旧 `<repoRoot>/.webui-worktrees/...`）は書き換えず後方互換で維持。新規作成のみ新パス。旧パスの既存行削除は従来フォールバック（失敗時 orphaned + 409）のままで、ユーザーは orphan 掃除 UI で対応、または新規タスクから本バグ解消。
- 教訓: OneDrive 同期下（Files On-Demand 有効）のフォルダは reparse point でロックされ、ユーザー権限では削除も属性変更も不能。worktree や一時フォルダなど削除前提のディレクトリは同期フォルダ外（`%APPDATA%` 等のローカル）に置く。バグ調査で「毎回失敗」は環境依存の根本制約のことがあり、実プローブ（node -e で add→remove）で再現・検証してから設計を固める。
- 検証: `tsc --noEmit` 通過、`eslint` クリーン、`vitest` 19ファイル/113テスト全通過。実プローブで dataDir 配下 worktree add→remove が code 0 で成功・フォルダ削除確認。
- 関連コミット: `9336e84`。

## 2026-07-18 Plan Markdown表示と承認フロー

- やったこと: Planエージェントの完了応答がプロジェクト内Markdownの絶対パスだけを返した場合、TaskViewでファイル名とMarkdown本文を表示する `PlanDocumentCard` を追加した。最新Planには「承認して実装」を表示し、同一セッションへ `agent: "build"` の承認プロンプトを一度だけ送信する。再読込・再同期後も履歴から承認済み状態を復元する。
- 判断理由: 絶対パスだけではWebUI内で計画を確認できず、手動のagent切替も承認から実装への導線として不完全だった。読み取り範囲をタスクのプロジェクト配下の通常 `.md`（1 MiB以下）へ限定し、lexical/realpath・symlink先拡張子・Windows namespaceをサーバー側で検証した。
- 教訓: 計画の承認とOpenCodeの権限承認は別概念として扱う。承認済み状態はコンポーネントのローカルstateだけに置かずセッション履歴から導出し、Windowsパスはdrive/UNC/extended-lengthの認識とAPI側namespace正規化を一体で検証する。
- 検証: Vitest 21 files / 142 tests、TypeScript、ESLint、Next.js production build、Playwright Task E2E 10 testsが通過。コードレビューと375x812のUIレビューもCritical/Important/Minorなしで承認。



## 2026-07-18 左メニューのプロジェクト操作改善

- やったこと: プロジェクト行の操作領域を固定化し、hover/focus時のレイアウトシフトを除去。お気に入り済みの星とプロジェクト別の＋を常時表示し、＋から `projectId` 選択済みの新規タスク作成へ遷移するようにした。mobile操作領域、ARIA、focus-visible、コントラスト、loading/error表示、補助テキストも改善した。
- 判断理由: `display:none` と `inline-flex` の切替がガタつきの原因だったため、固定スロットとopacity/pointer-events切替へ変更した。URL queryはServer ComponentからHomeViewへ渡し、有効IDだけ採用することでSPA遷移と不正IDフォールバックを両立した。
- 教訓: hover操作はDOM幅を変えず、見えない操作もfocus時に可視化する。UI変更はbounding box、Tab順、mobile可視性、overflow、色コントラストを実ブラウザで測ると、見た目だけでは拾えない回帰を防げる。並行セッションのmerge中は未検証の他機能を代行コミットせず、完了を待つ。
- 検証: 並行マージ後のmasterでVitest 21 files / 142 tests、TypeScript、ESLint、Next.js production build、Playwright composer/sidebar 12 testsが全通過。1280px/375pxでhover/focus前後の行・件数位置一致、Tab順、mobile全操作表示、横overflow 0を確認。コードレビュー・UI/UXレビューともAPPROVED。
- 関連コミット: `03b4f8c`, `1aa9283`, `42ce2d0`, `816e677`, `6e9c6e0`, `558fe98`。

## 2026-07-18 composerの作業場所・インテリジェンス選択を追加

### やったこと・判断理由
- ホームの作業場所初期値を `current_folder`（表示はリポジトリの既定ブランチ）へ変更し、明示的なworktree選択は維持した。新規タスクAPIの省略時fallbackは既存互換のため変更しなかった。
- providerの `variants` metadataから有効なhigh/lowだけを条件表示し、通常の「デフォルト」はpayloadから省略。新規タスク・追加入力・proxy境界でvariantを検証した。
- レスポンシブ幅でのラベル切れと、proxyの任意variant転送をE2E/route testで検出し、UI幅調整とサーバー側400検証を追加した。

### 教訓
- provider metadataをrefだけに保持すると派生UIの再計算が不安定になるため、表示に使うmetadataはstateで管理する。
- E2Eの既存サーバー再利用はビルド後の古いコードを配信し得るため、最終確認は別ポート＋`CI=1`で実行する。

## 2026-07-18 セッションタイトルのリロード更新（セッションごと）

- やったこと: 左サイドバーの各セッション行にホバー/フォーカス表示の「会話からタイトルを再生成」ボタンを追加。押下すると対象セッションだけ loading し、会話内容からAI生成した短いタイトルで OpenCode セッション・DB binding・プロジェクト sessions.json を更新し、タイトルのみ（updated_at 保持）で反映。失敗時は旧タイトル維持＋エラー表示。新設 BFF `POST /api/workspaces/{id}/sessions/{sessionId}/refresh-title`。
- 判断理由: OpenCode には既存セッションのタイトル再生成公開APIが無いため、会話を汚さない手法として「一時セッションで `POST /session/{id}/message`（同期）しタイトル文字列を得て削除→元セッションを PATCH」を採用。タイトル生成は WebUI 側でユーザー会話の最新モデルを再利用。元セッションの updated_at は並び順維持のため触らない。
- 教訓:
  - vitest で `@/` エイリアスを解決するため `vitest.config.ts` に `resolve.alias` が必要（`vi.importActual` が `@/` を解決できない問題を解消）。全テストに影響するが既存113件は回帰なし。
  - E2E（`next start`）は `reuseExistingServer` で古いビルド/別worktreeのサーバを再利用することがあり、Sidebar 変更後はポートを kill してから再実行が必要。
  - E2E モックの `/api/tasks` が静的だと、クライアントの `notifyTasksChanged()` による即時再取得が楽観更新を上書きする。本番はDB反映後の新タイトルが返るため、モックは refresh-title 成功後に状態を切り替えるよう状態付きにする。
- 検証: `vitest run` 21 files / 127 tests pass、`tsc --noEmit` / `eslint` クリーン、`playwright test session-title-refresh` 2件 pass。
- 関連コミット: 872cac3 / a9c8202 / d276ef9 / c929bf0 / 0a61f97（ブランチ webui/master/task-8f666c9e）。

## 2026-07-18 GraphPanelにリアルタイム更新を追加

### やったこと
- `GraphPanel.tsx` に3系統の更新トリガーを追加: (1) `refreshKey` prop（`TaskView.tsx` の既存 `diffKey` を配線）でコミット/マージ/リバート/resync直後に即時再取得、(2) `working` prop（エージェント実行中フラグ）に応じて4秒（working時）/15秒（idle時）間隔のバックグラウンドポーリング、(3) `document.visibilitychange` でタブ復帰時に即時再取得しつつ非表示中はポーリングを止める。
- `load()` に `limit`/`silent` オプションを追加。バックグラウンド更新では `Math.max(commitCountRef.current, DEFAULT_LIMIT)` を渡し、「さらに読み込む」で広げた表示深度を背景更新が縮めないようにした。`silent` 時はエラー表示・スピナー表示を出さず、既存の手動更新ボタン挙動（`load()` 引数無し呼び出し）は変更していない。
- 二重発火防止に `busyRef`（同時実行ガード）と `loadRef`（`load` の最新版を保持し、directory変更由来の `useEffect` 再発火とrefreshKey/pollingの発火条件を分離）を導入。
- 新規 `GraphPanel.test.tsx`（4件）: 初回ロード1回、refreshKey変化での即時再取得、working時のポーリング間隔とunmount後の停止、タブ非表示中のポーリング抑止をfake timersで検証。
- 検証: `vitest run` 43 files / 256 tests pass、`tsc --noEmit` / `eslint` クリーン、`next build` 成功（既存の無関係な警告のみ）。

### 判断理由
- 既存の `Sidebar.tsx` の「visible時ポーリング＋visibilitychange」パターンを踏襲し、プロジェクト内の実装スタイルを統一。
- エージェントのbashツール経由のgitコミットはSSE/OpenCodeセッションイベントだけでは捕捉できないため、ポーリングを主軸にした（イベント駆動のrefreshKeyだけでは不十分と事前調査で判断）。
- `working` 中は変化が起きやすいため間隔を短く、idle中は無駄なgit呼び出しを抑えるため間隔を長くする適応的ポーリングを採用。

### 教訓
- RTLで `vi.useFakeTimers()` を使うテストの `act()` は `react` からではなく `@testing-library/react` からimportしないと "not configured to support act" 警告が出る（本プロジェクトのテスト設定と一致させる必要がある）。

## 2026-07-18 設定画面をタブ分け（全般/プロジェクト/接続/プラグイン）

### やったこと
- `SettingsView.tsx` の既存10セクション（エンジン/デフォルトモデル/スマホ・VPNアクセス/プロジェクト/許可ルート/コスト表示/プラグイン/MCP/Remote Workspace/要復旧Workspace）を、ユーザー確認の上「4タブに集約」案で再編。
  - 全般: エンジン + デフォルトモデル + コスト表示
  - プロジェクト: プロジェクト + 許可ルート（allowlist） + 要復旧のWorkspace（要復旧項目がある時のみプロジェクトタブのラベルに件数バッジを表示し、非アクティブタブに隠れて見落とされないようにした）
  - 接続: スマホ/VPNアクセス + MCP（読取） + Remote Workspace
  - プラグイン: プラグイン単独
- タブナビは新規コンポーネント化せず、`TaskView.tsx` の既存モバイルタブと同じスタイル（`border-b-2` + アクティブ時 `border-primary text-text`）をそのまま踏襲し、スタイルの一貫性を優先。
- 状態・API呼び出し・イベントハンドラのロジックは一切変更せず、JSXの並び替え＋`{activeTab === "..." && (...)}` によるセクションの出し分けのみ実施。Node スクリプトで新旧ファイルのpre-JSXロジック部分を行の多重集合として比較し、追加した3行（`cx` importと `SettingsTab` 型・`activeTab` state・`tabs` 定義）以外に差分が無いことを確認してからコミットした。
- 新規 `SettingsView.test.tsx`（3件）: 既定タブ（全般）表示とプロジェクトセクション非表示、タブクリックでの切替、要復旧Workspaceありの場合のバッジ表示。
- 検証: `vitest run` 44 files / 259 tests pass、`tsc --noEmit` / `eslint` クリーン、`next build` 成功（`/settings` 10kB、既存の無関係な警告のみ）。

### 判断理由
- タブ粒度（4タブ集約 vs 10タブ個別 vs その他）はUI設計判断のため、実装前にユーザーへ選択肢を提示し確認した（新規導線の追加にあたるため）。
- 大規模なJSX並び替えは目視確認だけでは移動ミスを検出しにくいため、テキスト比較スクリプトで機械的に「ロジック部分に意図しない差分が無いこと」を検証してからコミットする方式を採用。

### 教訓
- 大きなJSXブロックを並び替えるリファクタでは、`git diff` の目視だけでなく新旧ファイルを行の多重集合として比較するスクリプトを書くと、移動漏れ・誤字混入を確実に検出できる。
- PowerShellの `Compare-Object` はデフォルトのコンソールエンコーディングでUTF-8日本語行を誤って「差分あり」と判定することがある（文字化け起因の偽陽性）。日本語を含む行比較はNode.js等UTF-8を正しく扱うツールで行う。

## 2026-07-18 TaskViewヘッダーにコンテキストウィンドウ使用率を表示

### やったこと
- `MessageInfo`（`web/src/lib/types.ts`）に `tokens?: { total?, input, output, reasoning, cache?: {read, write} }` を追加し、`ProviderModelMeta`（`web/src/lib/model-variants.ts`）に `limit?: { context, output?, input? }` を追加（サーバーAPIが返すModel.limitの型と対応）。
- `web/src/lib/context-usage.ts` に `computeContextUsage(messages, providerModelsMap)` を新設。直近のassistantターン1件のみを対象にし（累積ではなく、そのターン送信時点のcontext使用量を表すため）、`tokens.total` を優先しつつ無ければ `input+output+reasoning+cache.read+cache.write` を合算してフォールバック。モデルのcontext limitが0以下/不明なら `null` を返す。pctは100で頭打ち。
- `context-usage.test.ts` で9ケース（メッセージ0件・token未到着・limit不明・total優先・フォールバック合算・複数ターンから最新のみ採用・末尾user無視・pct頭打ち・limit=0を不明扱い）を検証。
- `TaskView.tsx` のヘッダーに、`task.branch`/`task.cost` の並びに続けてプログレスバー＋`used/limit (pct%)` 表示を追加（`codex-tokens.ts` の `formatTokens` を流用）。バーの色は70%で警告色、90%で危険色に変化。
- 検証: `vitest run` 45 files / 268 tests pass、`eslint` / `tsc --noEmit` クリーン、`next build` 成功（既存の無関係な警告のみ）。

### 判断理由
- 累積ではなく直近ターンのみを見る設計にしたのは、`tokens.total` 等が「そのターン送信時点のコンテキスト総量」を表しており、複数ターンを合算すると実際のcontext使用率と乖離するため。
- limitが0以下や欠損の場合に0%等の誤った数値を出すより、インジケータ自体を非表示にする（null）方が誤情報を避けられると判断。

### 教訓
- 本セッションのWindows `mcp_Bash` ツールはbash専用のコマンド置換（`$(printf '...')` 等）を展開できない（cmd.exe相当）。改行を含むコミットメッセージは一時ファイル＋`git commit -F` を使い、コミット後は `git log -1 --pretty=%B` で本文を必ず確認する。
- 作業中に無関係な `$null` という空ファイルがリポジトリルートに混入していた（過去セッションの誤ったリダイレクトの残骸とみられる）。コミット前の `git status --short` チェックでこうした意図しないファイルにも気づけるため、`git add -A` を使う前に必ず内容を確認する。

## 2026-07-18 サイドバーの質問待ちドットを警告色に変更

### やったこと
- `Sidebar.tsx` から既存の `GlobalAttentionProvider` のキューを参照し、`kind === "question"` かつ `request.sessionID === task.sessionId` のタスクを質問待ちとして判定。
- 質問待ちのドット色を実行中の青（`bg-working`）から既存の警告色オレンジ（`bg-warning`）へ変更。質問が解決されキューから消えると、通常のタスク状態色へ自動復帰する。
- 実行中のパルスは質問待ちでも維持し、色だけを警告色へ置換。permission要求や別セッションの質問では色を変えない。
- `Sidebar.test.tsx` に、対象質問、別セッション、permission非対象、通常working、質問解決後の色復帰、パルス維持、working色との非併存を含むテストを追加。
- 検証: Sidebar 8 tests pass、全Vitest 45 files / 273 tests pass、ESLint / TypeScript pass、Next.js production build成功（既存の無関係な警告3件のみ）。タスクレビューと最終レビューはいずれもAPPROVED。

### 判断理由
- タスクAPIへattention状態を重複追加せず、既にリアルタイム更新されるグローバルattentionキューを再利用することで、質問の発生・解決と表示色を同じ情報源から同期できるため。
- `warning` は既存の意味トークンであり、実行中の青と視覚的に区別できる一方、dangerほど強いエラー表現にならないため。

### 教訓
- 状態色を優先条件で上書きする際は、色classと動きのclassを一緒に条件除外しない。今回は初回実装で質問待ち時に `animate-pulse` まで消えたため、レビュー後に「動き」と「色」の条件を分離した。
- 色の優先テストは目的色の存在だけでなく、旧色が併存しないことも検証すると、Tailwind class競合による不定な見た目を防げる。

## 2026-07-19 コンテキスト使用量の中間ゼロレコード修正

### やったこと
- 実環境の `/api/opencode/session/:id/message` を確認し、最新assistantに `tokens` の全項目が0の中間レコードが混在することを特定。
- `computeContextUsage` がそのゼロレコードを採用して使用量0を表示していたため、実質使用量が0のassistantレコードをスキップし、直前の非ゼロ使用量へ遡るよう修正。
- 回帰テストを追加し、全Vitest 45 files / 274 tests、ESLint、TypeScript、Next.js buildを通過。

### 判断理由
- 型定義やproviderのlimit取得ではなく、実データに存在する中間ゼロレコードが直接原因だったため、APIやUIを変更せず使用量算出の探索条件だけを修正した。

### 教訓
- APIデータの「最新」をそのまま採用せず、ストリーミング中間状態（全項目0・未確定値）を実データで確認してから算出ロジックを決める。

## 2026-07-19 実行中セッション累計コストのリアルタイム更新

### やったこと
- `Sidebar` は8秒の常時ポーリングを廃止し、`working` タスクがあり可視状態のときだけ3秒間隔で `/api/tasks` を再取得するよう変更。可視状態への復帰では即時更新し、idle/error/非表示では定期取得を停止する。
- `TaskView` は現在のタスクがworking、またはSSE状態がretryのときだけ3秒間隔で `/api/tasks/:id` を再取得するよう変更。可視復帰時の即時更新、timer/listener cleanup、既存のbusy/retry→idle時の最終refreshを維持した。
- `refreshTask()` にリクエスト世代とtaskIdのガードを追加し、pollと完了時refreshの競合やセッション切替後の古いレスポンスを破棄する。pollのAPI失敗時は既存のTaskView表示を維持する。
- テスト: Sidebarのworkingコスト更新、TaskViewのworking/retry更新・idle停止・可視復帰・失敗時表示維持・stale responseを追加。関連テスト、全Vitest（47 files / 287 tests）、Next.js buildを実行した。

### 判断理由
- 累計コストの正規値は引き続きOpenCode `Session.cost` とし、クライアントでメッセージコストを再集計しない。
- `TaskStatus` にretryは存在せず、タスク一覧ではretryはworkingとして扱われるため、Sidebarはworkingを対象とし、TaskViewではSSEのretry状態も更新対象にした。

### 教訓
- 短間隔pollと完了時refreshを共存させる場合、後発要求だけを反映する世代ガードがないと、遅い古いレスポンスで確定コストが戻る。
- この作業時点の `tsc --noEmit` は同時作業中の未追跡 `HomeView.test.tsx` にある重複import/HTMLElement型エラーで失敗した。一方、Next.js buildは型検査を含め成功した。

## 2026-07-19 設定画面にサブエージェント一覧「エージェント」タブを追加

### やったこと
- `SettingsView.tsx` の既存4タブに5つ目「エージェント」タブを追加し、新設 `AgentsSettings.tsx` を出し分け表示（既存タブパターン踏襲、SettingsView本体は差分6行）。
- 新設 `agent-utils.ts`: OpenCode `GET /api/opencode/agent`（directory不要の許可済みプロキシパス）の `AgentDto` を受け、命名規則 `<rank>-<role>-<provider>-<model>` の解析・Rank A→Eグループ化・role/name昇順ソート・検索フィルタを純粋関数で実装。provider/model部にハイフンを含み名前だけのパースは曖昧なため、`agent.model` の providerID/modelID を kebab 化して name 末尾一致した場合のみ解析し、不一致・model欠損は「その他のエージェント」へ原文表示。
- 表示: デスクトップは rank グループごとの table（th scope="col"、Rank/エージェント/モデル/Mode/説明列）、モバイルは ul/li 行カード。件数表示+クライアント検索（name/role/provider/model/説明/mode対象）。loading/error（再試行）/空/検索0件の4状態。Rank・mode は色に依存せずテキスト表示し、rank装飾に success/warning/danger を使わない。
- ui-ux-reviewer 指摘を修正: 再試行中の busy/disabled とエラー領域維持、検索input・再試行ボタンの focus-visible、必須情報の text-faint→text-muted、長い modelID の break-words、placeholder 文言整合。
- 検証: vitest 49 files / 312 tests 全pass（新規20件含む）、eslint / tsc クリーン。コミット ee1cc71（機能）+ 6a0ecc5（レビュー修正）。

### 判断理由
- 配置（設定タブ vs 独立ページ vs ホーム）と情報範囲（基本情報のみ vs 権限詳細込み）は実装前にユーザーへ選択肢提示して確定。新規導線のため 要件→ui-ux-designer→lead-programmer→ui-ux-reviewer→修正 の UIルーティングに従った。
- タブの ARIA tabs 化（role="tab"/aria-selected）はレビューで指摘されたが、既存5タブ全体に及ぶ変更で設計仕様が明示的にスコープ外としたため今回は見送り（既存タブパターン全体の改修として別途検討）。
- 並行セッションが `api/tasks/route.ts`・`HomeView.tsx`・`CodexBarWidget.tsx`・`MEMORY.md` を編集中だったため、全コミットで対象ファイルを明示指定し `git add -A` を使わなかった。

### 教訓
- サブエージェント名のパースは名前文字列だけでは決定できない（provider/model にハイフンを含む）。API の構造化データ（model.providerID/modelID）と突き合わせ、一致した場合のみ解析する方式が安全。
- レビュー用サブエージェントがリポジトリ内にスクリーンショット（web/review-*.png）や `$null` ゴミファイルを残すことがある。完了報告前の `git status` チェックで未追跡ゴミも確認して掃除する。

## 2026-07-19 トップ画面の画像添付を初回タスク送信へ対応

### やったこと
- トップ画面の入力欄へ、画像の貼り付け・複数ファイル選択・プレビュー・個別削除を追加し、画像だけでもタスクを開始可能にした。
- `POST /api/tasks` に画像ファイル契約を追加し、Data URLと画像MIMEを検証してOpenCodeの`file` partへ転送するようにした。
- HomeViewとAPIの回帰テストを追加し、全312テスト、型チェック、lint（既存警告3件のみ）を確認した。

### 判断理由
- 原因は既存タスク画面だけに画像添付が実装され、トップ画面と初回タスクAPIには添付状態・送信契約が無かったことだったため、既存の`TaskView` / `useSessionStream`と同じfile part形式へ統一した。
- UIだけの対症療法にせず、初回APIまで一貫して画像を渡し、画像のみの場合は既定タイトルを付けることで送信経路全体を修正した。

### 教訓
- 入力コンポーザーの機能追加時は、継続入力と初回入力の両方について、UI・API・下流送信形式の対応差を確認する。

## 2026-07-19 mainブランチのセッション開始調査

### やったこと
- `master` 以外のブランチで開始できないという報告を受け、ブランチ検出API、HomeView、worktree作成、タスクAPIまでのデータ経路を追跡した。
- `main` のみを持つCodexBarプロジェクトで、worktree作成と初回プロンプトを含む `POST /api/tasks` が200となり、セッション開始に成功することを実機確認した。
- 調査用worktreeはAPIでGit登録を解除し、調査用ブランチも削除した。Windowsのディレクトリロックにより空フォルダの削除だけ失敗し、workspaceはorphanedとして記録された。

### 判断理由
- 旧版にはbranches API失敗時に存在しない`master`を送る不具合があったが、現行版では取得失敗時にbaseBranchを省略して現在のHEADを使う修正が既に入っている。
- 現行コードと実機の両方で`main`開始を再現できなかったため、推測による追加修正は行わず、具体的な失敗条件やエラーの追加情報を待つ。

### 教訓
- ブランチ名起因の疑いは、UI表示だけで判断せず、実リポジトリでbranches API→worktree→sessionの各境界を分けて検証する。
- 稼働中セッションを使うworktree実機試験は、Windowsでプロセスのディレクトリロックが残り得る。自動試験では一時Gitリポジトリと独立プロセスを使い、確実に停止してから削除する。

## 2026-07-19 質問モーダルの全セッション対応

### やったこと
- 現在表示中セッションの `question` もグローバルattentionキューへ保持し、インラインカードに加えてモーダルでも通知するよう変更した。現在セッションの `permission` は従来どおりインライン表示のみ。
- 入力欄、テキストエリア、contenteditable にフォーカス中は自動表示を保留し、フォーカス解除後に未解決項目があれば一度だけモーダルを開くよう修正した。
- 手動で閉じた同一キューを通常のフォーカス移動だけで再表示せず、新しい項目が追加された場合は再度自動表示できる状態管理を追加した。
- TDDでキュー判定とフォーカス解除後表示の回帰テストを追加。全Vitest 49 files / 317 tests、TypeScriptを通過し、ESLintは既存警告3件のみだった。

### 判断理由
- 質問は回答が必要な明示的な停止点なので、現在画面内のカードだけに依存せず全セッションで同じモーダル通知を行う。一方、permissionまで現在画面で二重表示すると操作が過剰になるため従来仕様を維持した。
- 入力中に即座にモーダルを重ねると作業を遮るため、通知を捨てるのではなくフォーカス解除まで保留する方式にした。

### 教訓
- フォーカス中の自動表示を抑止するだけでは、依存値が変化しない限りReact effectは再実行されない。保留状態には、解除条件となるDOMイベントと一度限りの再試行を明示的に設ける。

## 2026-07-19 CodexBarクレジット表示への追従

### やったこと
- CodexBar最新コミット`f6adead`の任意`credits { title, used, limit, balance }`をWebUIのスナップショット型・防御的パーサーへ追加した。
- プロバイダー展開領域へ使用額、上限、残高、正の上限がある場合の使用率バーを追加し、クレジットだけのプロバイダーも展開可能にした。
- パーサー25件、Widget表示1件を含む全Vitest 51 files / 329 tests、TypeScript、ESLint、Next.js production buildを検証した。ESLint/buildの既存警告3件は今回の対象外。

### 判断理由
- クレジットは課金枠でレート制限とは意味が異なるため、`usedPercent`、全体平均、制限件数、警告toneには混ぜず、詳細表示だけに限定した。
- `credits`は追加任意フィールドなので、不在・不正型を`null`として旧スナップショットとの互換性を維持した。

### 教訓
- 並行セッションと共有するNext.jsの`.next`は同時ビルドで不整合になり得る。ソース上に対象ルートが存在する`PageNotFoundError`は、他差分を触らず生成キャッシュだけを再作成して切り分ける。
- 小規模で明確な1ファイル文書作成を外部委譲すると、委譲待ちが直接作業より遅くなる場合がある。共有・待機コストが上回る軽微作業はメインが直行する。

## 2026-07-19 エージェント返答メタデータのヘッダー集約

### やったこと
- 通常／サブエージェント返答のヘッダーを共通 `MessageMetaHeader` に統一し、プロバイダアイコン、モデル表示名、返答単位コスト、時刻を単一行へ集約した。
- `build` などの内部agent名と通常返答下段の `cost · modelID` を除去し、コスト0／未取得、未知provider、モデル表示名未解決、長いモデル名へフォールバックを追加した。
- Vitest 362件、TypeScript、ESLint、Next.js build、task E2E 13件を検証し、通常・280px幅・280pxダークのスクリーンショットを取得した。

### 判断理由
- 返答単位の実行モデルとコストを本文直前の一箇所で比較でき、通常セッションと子セッションで同じ認知規則を使えるため。
- 子セッション側でprovider APIを重複取得せず、親が解決済みのモデル名マップと通貨設定を `PartView` 経由で渡すことで表示と設定の一貫性を保った。

### 教訓
- 並列セッション中は共有indexへstageしたファイルが別セッションのcommitに巻き込まれ得る。対象ファイルを限定するだけでなく、commit直前のstatus確認からcommitまでの間隔を最小化し、巻き込み時は履歴改変せず現在差分を再検証して独立commitする。
- Playwrightがproduction serverを使う構成では、UI変更後にE2Eを実行する前にproduction buildを更新しないと、古い `.next` を検証して誤ったREDになる。

## 2026-07-19 サイドバー処理中スピナーと質問待ち復元

### やったこと
- 実データの Global event envelope `{ directory, payload:{ type, properties } }` を `attention.ts` で正規化し、従来の flat 形式と両対応にして質問イベントの取りこぼしを解消した。
- `useAttentionQueue` に directory 単位の reconcile を追加。REST 結果で対象 directory の保留質問を置換しつつ、他 directory・permission・同期開始後に SSE 追加された項目を保持する。
- `GlobalAttentionProvider` で初回接続と再接続の `onopen` に `/api/tasks`→一意 directory→`/question` 並列取得を追加。SSE と REST を id で重複排除し、切断中に解決された質問を削除。directory 単位の取得失敗時は既存項目を維持する。
- `Sidebar` の状態表示を固定幅 `h-3 w-3` スロットへ収め、`working` かつ質問待ちでないセッションを `Loader2`（`animate-spin text-working`、`aria-label="エージェントが処理中"`）へ切替。質問待ちは既存の黄色点を優先。
- 検証: 関連 Vitest 4 files / 41 tests PASS、フル Vitest 55 files / 362 tests PASS、TypeScript PASS、ESLint 0 errors / 既存警告 2 件のみ、Next.js build 成功（同警告 2 件）。ブラウザでは展開後のセッション行で `ready` の緑点と固定幅スロットを確認。当時の live タスクに `working` / 保留質問が無かったため、回転リングと黄色点の切替は Sidebar / Provider の回帰テストで担保した。

### 判断理由
- 質問待ちは応答が必要な明示的停止点なので、envelope 正規化と接続時 REST 復元で新着・再読込・再接続いずれでも見逃さないようにした。permission の REST 復元は操作過剰を避けるため非対象のまま維持した。
- reconcile は「同期開始時刻より後に SSE 追加された項目」を保護し、遅れて返る REST 結果が新しい質問を消さないようにした。

### 教訓
- 実データと既存テストの envelope 形状が異なる場合、片方だけに合わせると本番で無言の取りこぼしになる。正規化ヘルパーで両形式を単一の内部形式へ収れんさせる。
- 非同期 REST 同期は「同期開始時刻」を基準に保護範囲を決めると、SSE と REST の競合による誤削除を防げる。
- Task 5 の全体検証をサブエージェントに丸投げすると待ち時間が長くなる。検証コマンドはメインが直接実行し、記録とコミットだけを短く閉じる方が速い。

## 2026-07-19 トップ入力欄ツールバーの可変フレックス整理

### やったこと
- HomeView 入力欄フッターの xl 固定 rem Grid をやめ、1行の可変フレックス（左コンテキスト / 中央実行設定 / 右送信）へ置き換えた。
- エージェントの `min-w-[9rem]` とアクセスモードの `order-first` を削除し、幅不足は truncate で吸収するよう整理した。
- HomeView 回帰テストと Playwright 実寸法計測で重なりゼロを確認した。1100px はアクセスモード x=927.609375–1027、送信 x=1035–1071、1280px は x=1035.609375–1135 と x=1143–1179、1440px は x=1115.609375–1215 と x=1223–1259 で、各幅の `hits: []`・`submitInside: true` だった。

### 判断理由
- 固定列合計が中央幅を超える構造欠陥だったため、列幅の応急調整ではなく可変フレックスで再発を防いだ。

### 教訓
- 子の `min-width` が親グリッド列より大きいと、overflow なしでも隣接コントロールと重なる。実測の getBoundingClientRect で重なりを検証する。

## 2026-07-19: cursor-acp「Workspace directory does not exist」修正

### やったこと
- 根因: WebUI のタスク削除が worktree だけ消し、OpenCode `session.directory` が削除済みパスを指したまま残る。cursor-acp はその path を `--workspace` に渡し、cursor-agent が存在確認で失敗していた（cursor-acp 自体のパス生成バグではない）。
- `destroyWorkspace` で `git_worktree` / `temporary_copy` の bound session を disk 削除前に `DELETE /session/{id}`（best-effort）。`current_folder` は共有ディレクトリのため対象外。
- 作成失敗ロールバックで bind 前でも session DELETE するよう `POST /api/tasks` を補強。
- 既存 stale: webui worktree 系 65 件を `scripts/purge-stale-opencode-sessions.mjs --apply --sql` で掃除（残 missing 6 は別プロジェクト削除分）。
- 検証: Vitest 56 files / 367 tests PASS、`tsc --noEmit` PASS。

### 判断理由
- 症状は cursor-acp に見えるが、削除整合性は WebUI `destroyWorkspace` の責務。エンジン側セッションを残すと最終 fallback（cursor-acp）で必ず再発する。

### 教訓
- 隔離 worktree を消すときは、WebUI DB / マニフェストだけでなく OpenCode session も同じライフサイクルで消す。事後掃除スクリプトは webui path に限定し、無関係な missing directory は触らない。

## 2026-07-19: build agent専用ルールの反映 + コスト表示の順序/USD併記オプション化

### やったこと
- ユーザー指示で渡された build primary agent 専用の運用ルール（ワークフロー・モデルフォールバック方針・エージェントTier/サブエージェント方針・学習ループ）を `prompts/build.md` に追記し、既存の「学習済みルール」1件は保持したまま統合した。
- `MessageMetaHeader.tsx` のフィールド順を `[model, cost, time]` から `[model, time, cost]` に変更し、エージェント名行のコスト表示を末尾へ移動。
- `currency.ts` に `CostDisplayPrefs.showUsdSuffix`（既定 `false`）を追加し、JPY表示時のUSD併記「（$0.0254）」をオプション化。`sanitizeCostDisplayPrefs` は欠落・旧形式JSONも含め明示的な `true` 以外は `false` として扱うため、既存ユーザーも自動的にデフォルトOFFになる。`SettingsView.tsx` に「USD ($) を併記」トグル（JPY選択時のみ表示）を追加。
- 実装は `b-lead-programmer-anthropic-claude-opus-4-8` に委任（lib/components/settings/tests にまたがる3ファイル以上・モジュール横断のため）。委任時に副次的な `Sidebar.test.tsx` の壊れテスト2件も修正されたと報告あり、うち1件はHEAD時点（この変更前）から既に壊れていた並行作業由来の不整合と判明したため、cost表示の実際の挙動（JPYデフォルト）に合わせて期待値を更新した。
- 検証: `vitest run` 58 files / 381 tests PASS、`tsc --noEmit` PASS、`eslint .` 0 errors（既存無関係ファイルの warning 3件のみ）。

### 判断理由
- 併記オプションは `formatCostValue` 一箇所に集約されているため、Sidebar/TaskViewの累計コスト表示にもコード変更なしで自動的に反映される設計とした（表示箇所ごとの個別対応を避け、既存の prefs 共有フックのアーキテクチャに乗せた）。
- 既存 localStorage の互換性を優先し、`showUsdSuffix` 欠落時は明示的に `false` とすることで「デフォルトOFF」をユーザー指示通り徹底した。

### 教訓
- `git add` と `git commit` を1回のシェルツール呼び出し内で改行区切りで続けて実行すると、コミットが実行されずに `git log` へ反映されないことがあった（サイレント失敗）。`git add` と `git commit` は別々のツール呼び出しに分割し、各コマンド後に個別に成功出力・`git log` で反映を確認する。
- 並行セッションの未コミット差分（`task-service.ts` / `types.ts` 等）は自分の変更と無関係と確認したため、`git add` でファイルを明示列挙してステージし、混在を避けた。

## 2026-07-19: コミット履歴から実名・社用メールを全履歴匿名化（git-filter-repo）

### 経緯
- 別リポジトリ（`~/.config/opencode`）でのOSS公開前セキュリティ監査作業の流れで、
  ユーザーから「これってOpenCodeWebUIの話をしているか」という指摘を受け、作業対象の
  取り違えが発覚（本セッション冒頭の「build primary agent専用」指示は既にこの
  リポジトリの `prompts/build.md`・コミット `50420da` で完了済みだった）。
- OpenCodeWebUIへ切り替えて調査した結果、**328コミット中325件**（`git log --all`
  ベース）が author情報として著者の実名（日英2表記）と**社用メールアドレス
  （従業員番号を含む形式）**を記録していることが判明。ローカル `git config`
  （`user.name`/`user.email`）にも同じ実名/社用メールが設定されたままで、
  今後のコミットも同様になる状態だった。`git remote -v` は空でまだどこにも
  pushされていなかった。
  （注: 本エントリでは実際の値を再掲しない。理由はこのMEMORY.md自体が
  git追跡対象であり、値を書くと消したはずの情報を平文で再度コミットして
  しまうため。値そのものは filter-repo 実行前の `git bundle`
  バックアップにのみ残す。）

### やったこと
- ユーザーに状況（露出範囲・リスク・pushされていない事実）を報告し、
  「ローカルgit configを匿名アイデンティティへ変更」「過去325コミットを
  git-filter-repoで全履歴匿名化」の2点について明示承認を取得。
- 作業前に `git bundle create ..\OpenCodeWebUI-backup-before-filter-repo-20260719.bundle --all`
  でリポジトリ全体（全15 refs: master・11個のworktree系ブランチ・stash含む）の
  バックアップを作成し、`git bundle verify` で整合性確認済み。
- `pip install git-filter-repo`（Python 3.14、pip経由）でツールを導入。
  PATHに実行ファイルが乗らなかったため `python <site-packages>\git_filter_repo.py`
  でモジュール直接実行。
- mailmapファイル（旧実名2表記（日英）+ 社用メール → `OpenCode WebUI
  <local@opencode-webui>`、既存の唯一の匿名コミットと同一identityに統一）を
  用意し、まず `--dry-run` で `.git/filter-repo/fast-export.{original,filtered}`
  を比較して置換内容を確認してから本実行（`--mailmap _mailmap.txt --force`）。
- 実行後、`git log --all --pretty="%an <%ae>"` で全328コミットが
  `OpenCode WebUI <local@opencode-webui>` に統一されたことを確認。
  `git log --all -p` の全文（約431万文字）に対し旧実名・旧社用メール・
  従業員番号のいずれの文字列もヒットゼロを確認（node スクリプトで文字列検索、
  cmd の `findstr` は日本語文字で信頼できないため node で代替）。
- ローカル `git config --local user.name/user.email` を
  `OpenCode WebUI <local@opencode-webui>` に更新し、以後のコミットも匿名に統一。
- 作業用の一時ファイル（mailmap、検証スクリプト、フルログ dump、
  `.git/filter-repo/` 作業ディレクトリ）をすべて削除。`git status --short` は空。
  `git ls-files` の追跡ファイル数（288件）・`prompts/build.md` の内容は
  filter-repo実行前後で不変（mailmapのみの書き換えでツリー内容は対象外のため）。

### 判断理由
- 履歴改変はAGENTS.mdで「明示的な指示がない限り実行しない」破壊的操作に該当する
  ため、リスク（露出範囲・pushされていない事実）を提示した上でユーザーの
  明示承認を2問に分けて取得してから実行した。
- 本番pushが未実施だったため、リモート側の force-push・共同作業者への影響は
  発生しない。ローカルのみの書き換えで完結する好条件だったため、
  「今すぐ実行」を選んでもリスクは限定的と判断した。
- 会社のメールアドレス・従業員番号での大量コミットは、技術的な問題ではなく
  会社の就業規則・知財規定に関わりうる事項であり、それ自体の是非は判断せず
  ユーザーの意思決定に委ねた。

### 教訓
- 複数の実プロジェクトを横断して作業しうる環境では、セッション冒頭の
  ワークスペースルート情報と実際に `cd` して作業しているディレクトリが
  一致しているかを、作業開始時点で確認する。今回は一致確認を怠り、
  無関係な別リポジトリで長時間作業してしまった（`~/.config/opencode` 側の
  MEMORY.mdにも同種の教訓を記録済み）。
- 「公開可能か」を問われた際は、直前まで作業していたTier/スコープに限定せず
  `git log --pretty=%an,%ae` で全コミットのauthor情報を横断確認するのが有効。
  ファイル内容の秘密情報スキャンだけでは、コミットメタデータ（author/committer）
  に残る実名・社用メール・従業員番号は検出できない。
- 履歴書き換え（`filter-repo`/`filter-branch`）を実行する前は、必ず
  `git bundle create --all` でリポジトリ全体（全ブランチ・stash含む）の
  バックアップを取り、`git bundle verify` で検証してから本実行する。
  `--dry-run` で `fast-export.original`/`fast-export.filtered` を比較する
  ワンクッションも、mailmapの記述ミス（display name違いの見落とし等）を
  実行前に発見できるため有効だった。
- cmdの `findstr` は日本語（マルチバイト文字）の検索で信頼性が低いことがある
  ため、非ASCII文字列の存在確認は node スクリプトで直接文字列比較する方が確実。

## 2026-07-19 内部作業ファイルの非公開化（全履歴からの完全除去）

- やったこと: ユーザーから「MEMORY.md など直接プログラムに影響しないものは非公開にしたい」と依頼。分類案（A=AIエージェント作業ログ系、B=判断が分かれる文書、C=プログラム本体）を提示し、question tool で対象範囲と方式（全履歴からfilter-repoで完全削除）を確認。対象: `MEMORY.md` `LESSONS.md` `architecture.md` `docs/improvement-plan.md` `docs/home-composer-redesign.md` `docs/agent-guidance/` `docs/superpowers/`（plans/specs計31ファイル） `prompts/build.md` `.cursor/rules/` `.claude/launch.json`。
  1. 対象ファイルをリポジトリ外（`../OpenCodeWebUI-private-files-backup-20260719/`）へ一時退避。
  2. フルバンドルバックアップ作成・検証（`../OpenCodeWebUI-backup-before-privatize-20260719.bundle`、15 refs）。
  3. `git-filter-repo --path <対象> --invert-paths --dry-run` で `fast-export.original` / `.filtered` を比較し、M/D行（実ファイルパスの追加・変更）が全対象で0件になることを確認（commit message本文中の文言としての残存は許容）。
  4. 本実行（`--force`、全332コミット、全ローカルブランチに適用）。
  5. 空になった `docs/agent-guidance` `docs/superpowers` `.cursor/rules` の残骸ディレクトリを削除。
  6. 退避していたファイルを復元し、`.gitignore` に全対象パスを追加してコミット。
- 判断理由: 「非公開」は「今後隠す」ではなく「痕跡も消す」という意図とユーザーが明言（question tool の回答）。単純な `git rm --cached` + `.gitignore` では過去コミットに内容が残り続けるため、本リポジトリは未pushで安全に書き換え可能という前提のもと、確立済みの手順（バックアップ→dry-run→本実行→検証）を踏襲した。ファイル自体はAIエージェントの継続利用のためローカルには残し、gitignoreで再追跡のみ防止。
- 教訓: `git-filter-repo` 実行後、`.git`内のremote設定がクリアされる（本件はremote未設定だったため実害なし）。空になったディレクトリはgit checkoutでは自動削除されないため手動クリーンアップが必要。`node -e "..."` のインライン実行はこのシェル環境で標準出力が失われるケースが多く、必ずスクリプトファイルに書いて `node script.mjs` で実行する（学習済みルールを再確認）。
- 検証: vitest 60 files / 401 tests 全通過、`git ls-files` で対象追跡ゼロ、`fast-export.filtered` のM/D行走査で対象ファイルパス0件を確認。
- 矛盾の明記: 本ファイル（MEMORY.md）自体が今後gitで非公開（untracked）になるため、既存の運用ルール「作業完了時にMEMORY.mdへ追記してコミット」は本セッション以降このリポジトリでは実質不可能になる。ユーザーの明示指示（非公開化）を優先し、以後このリポジトリではMEMORY.md/LESSONS.mdへの追記はローカルファイルとしてのみ継続し、git commitは行わない。
- 関連コミット: `cff7318`（`.gitignore`更新）。バックアップ資産（bundle・退避ディレクトリ）はリポジトリ外にあるため、公開前に削除または安全な場所への移動が必要（未対応、ユーザーへ伝達要）。

## 2026-07-19 GitHubへの初回公開プッシュ

- やったこと: ユーザー指示で `https://github.com/daihaya000/OpenCodeWebUI.git` へプッシュ。`git ls-remote` で対象リポジトリが既存かつ空（refなし）であることを確認してから `git remote add origin` を実行。LICENSEのCopyright行プレースホルダーを、プッシュ先URLから判明したGitHubユーザー名 `daihaya000` へ確定するかquestion toolで確認し、承認を得て確定・コミット（`f165ce9`）。`master` ブランチのみを `git push -u origin master` でプッシュ（内部作業用のworktreeブランチ群 `webui/master/*` 等は非公開のまま維持、pushしていない）。
- 判断理由: 複数の非公開作業ブランチが残存していたが、ユーザーは明示的に「push」としか指示していないため、最小スコープ（現在のmasterのみ）を選択。全ブランチのpushはユーザー未承認のスコープ拡大にあたるため避けた。
- 検証: push後 `git ls-remote origin` でリモートHEAD/refs/heads/masterが `f165ce9`（ローカル最新）と一致することを確認。`git status --short` 空を確認。
- 教訓: このBashツール環境では `node -e "インライン文字列"` や単純な `type file.txt` の出力が度々失われる（"Command executed successfully" とだけ表示され中身が出ない）。ネットワークコマンド（`git ls-remote` 等）や大きめの出力でも同様の事象があるため、結果確認は必ずファイルへリダイレクトしてReadツールで読むか、Node script経由で確実に検証する。またPowerShellの `Get-Content file | Measure-Object -Line`（パイプ経由）は本ファイル（MEMORY.md、114KB超）で行数を過小に報告する不具合があった（1357と誤報告、実際は1837行）。行数・末尾確認は `Get-Content -Raw` またはNodeで直接読む方が信頼できる。
- 未対応事項: バックアップ資産（bundle・退避ディレクトリ）はリポジトリ外に残存したまま。ユーザーへの伝達済みだが削除/移動は未実施。


## 2026-07-19 累計コスト表示を行末へ移動

- やったこと: TaskView ヘッダを `プロジェクト · コンテキスト · 累計コスト`、Sidebar タスク行を `ブランチ · プロバイダアイコン · コスト` に変更し、累計コストを末尾へ移動。
- 判断理由: ユーザー依頼「コスト表示を末尾に」。MessageMetaHeader は既に `model · time · cost`。ヘッダ/サイドバーだけコストが途中にあった。
- 検証: vitest TaskView/Sidebar/MessageMetaHeader 27 tests 通過。
- 矛盾の明記: MEMORY.md は gitignore のため本エントリはローカルのみ（コミット対象外）。


## 2026-07-19 累計コスト表示を行末尾へ移動

- やったこと: TaskView ヘッダーの並びを `branch · project · cost · context` から `branch · project · context · cost` に変更。Sidebar タスク行もブランチ名直後だったコストをプロバイダアイコンの後ろ（行末）へ移動。関連 vitest（TaskView/Sidebar）23件通過。
- 判断理由: ユーザー依頼「コスト表示を末尾に」。添付画像はモデル非対応で読めず、既に末尾化済みの MessageMetaHeader 以外でコストが中間にある箇所（ヘッダー累計・サイドバー）を対象にした。
- 教訓: 画像入力不可時は「コストが末尾でない残存箇所」をコードから特定して進める。MEMORY.md は gitignore のため追記のみ・コミットしない（2026-07-19 非公開化の方針を継続）。
- 追記: `Sidebar.test.tsx` に「provider アイコンと cost が両方あるとき cost が後」を固定するテストを追加してコミット。UI本体は `2ac145c` 済み。

## 2026-07-19 累計コスト表示を末尾へ移動

- やったこと: TaskView ヘッダを `branch · project · context · 累計コスト`、Sidebar タスク行を `branch · provider · cost` の順に変更し、累計コストを各行の末尾へ移動。MessageMetaHeader（返答メタ）は既に cost 末尾のため変更なし。
- 判断理由: ユーザー依頼「コスト表示を末尾に」。添付画像はモデル都合で読めなかったが、未コミット差分と UI 構造からヘッダ/サイドバーの累計コスト位置が対象と判断。
- 検証: vitest TaskView / Sidebar / MessageMetaHeader 27 tests 通過。
- 矛盾の明記: ユーザー規則の「MEMORY.md をコミット」は、本リポジトリで MEMORY.md が gitignore（非公開化）済みのためローカル追記のみ。コード変更のみコミット。

## 2026-07-19 コスト表示を末尾へ（完了確認）

- やったこと: 累計コストの末尾化は `2ac145c` で実装済み（TaskView: context の後 / Sidebar: provider の後）。本セッションでは未コミットだった `Sidebar.test.tsx` に末尾順序の回帰テストを追加してコミット。
- 判断理由: ユーザー依頼「コスト表示を末尾に」。添付画像は読めなかったが、MessageMetaHeader は既に `model · time · cost`、ヘッダ/サイドバーのみ途中表示だったためそちらを末尾化。
- 検証: vitest Sidebar.test.tsx 14 tests 通過。
- 矛盾の明記: MEMORY.md は gitignore のためローカル追記のみ。

## 2026-07-19 cursor-acp を Cursor アイコンにマッピング

- やったこと: `OPENCODE_TO_CODEXBAR` に `"cursor-acp": "cursor"` を追加。モデル選択・サイドバー・メタヘッダ等で `cursor-acp/Auto` が Cursor ブランドアイコン（`cursor.png`）を表示するようにした。テストも追記。
- 判断理由: ユーザー依頼「cursor-acp/AutoのアイコンをCursorのアイコンに」。`cursor` は既にマップ済みだが OpenCode 側の実 ID は `cursor-acp` で未エイリアスだった（`ollama-cloud`→`ollama` と同じパターン）。
- 検証: vitest `codexbar.test.ts` 26 tests 通過。コミット `04ebfd1`。

## 2026-07-20 OpenCode ServeError（再起動時の幽霊ポート）

### 症状
- OpenCode が先に exit code=4294967295（Windows の -1）で落ちたあと、再起動で ServeError → exit 1。
- ログに Service restart is already in progress が続くことがある。

### 原因
- 127.0.0.1:4096 が LISTENING のまま OwningProcess が死んでいる ghost TCP（今回は PID 16320）。
- 初回起動の 
esolvePortPlan / 
esolveOccupiedPort は ghost → 4097+ へ退避するが、
estartOpencode() は固定ポートへ再 bind していた。
- OPENCODE_SERVER_PASSWORD 未設定警告は無関係。lready in progress は restart mutex のレースで根因ではない。

### 修正
- 
estartOpencode(): stop 後に 
esolveOccupiedPort を実行。ghost なら次ポートへ。ポート変更時は WebUI も再起動して OPENCODE_BASE_URL を追従。
- waitUntilReady: 対象プロセスが先に死んだらタイムアウトまで待たず失敗。

### 現状（調査時）
- 4096 = ghost（health タイムアウト）
- 4097 = 生存 OpenCode / WebUI opencodeBaseUrl=http://127.0.0.1:4097 で healthy
- ghost 解消は Windows 再起動。それまでは 4097+ 退避で運用可。

### 検証
- cd host && npm test 16 tests PASS

## 2026-07-19 cursor-acp/Auto 画像認識不可の修正

- やったこと: 原因調査と検証。実修正は `~/.config/opencode`（OpenCode 設定リポ）側で実施済み。
- 根因: OpenCode が custom openai-compatible の `cursor-acp/auto` を text-only（`capabilities.input.image=false`）として扱い、添付を `ERROR: Cannot read "…" (this model does not support image input)` に置換していた。
- 修正内容（設定リポ）:
  1. `opencode.jsonc` で `attachment: true` + `modalities.input: [text, image]`
  2. `aa-cursor-model-guard` の `ensureCursorImageCapabilities` で起動時に modalities を保証
  3. `cursor-acp` プロキシで data URL を `.opencode-cursor-attachments/` へ実体化し Read 可能に
- 検証: `node --test tests/cursor-acp-image-attachments.test.mjs tests/aa-cursor-model-guard-image-caps.test.mjs` 7件 PASS。再起動後の `/provider` で `image=true attachment=true` を確認。
- 注意: 設定反映には OpenCode 再起動が必要。Windows のゴースト LISTENING（死んだ PID）があると `ServeError` で 4096 起動に失敗し、代替ポートへフォールバックする。
- 矛盾の明記: ユーザー規則の MEMORY.md コミットは本リポでは gitignore のためローカル追記のみ。


## 2026-07-20 幽霊ソケット予防（graceful stop）

### 背景
Windows で `taskkill /F` (= TerminateProcess) すると、listen ソケットを閉じる前にプロセスが死に、子が継承ハンドルを掴んだまま ghost LISTENING になることがある。OpenCode serve にプロセス終了用 HTTP は無く、`POST /global/dispose` はインスタンス/MCP/LSP 解放のみ。

### 対策（host）
1. 停止前に `POST /global/dispose`（子リソースを先に解放）
2. `taskkill /T`（/F なし）→ 最大3秒待機 → 残存時のみ `/F`
3. OpenCode 異常終了時に子 PID / 生存 LISTENER を reap
4. ポート解決で unhealthy OpenCode を落とすときも soft→hard
5. 既存の ghost フォールバック（4097+）は維持

### ファイル
- `host/src/process-stop.js` / `process-stop.test.js`
- `host/src/index.js`（stopOpencodeOnly / stopChildren / spawn exit）

### 検証
- `cd host && npm test` 24 tests PASS

### 限界
- OpenCode 自身のネイティブクラッシュは dispose 不能。完全防止は OS/エンジン側。ホスト再起動でフォールバック継続。

## 2026-07-20 build.bat 作成

- やったこと: ルートに `build.bat` を追加。web/host の依存が無ければ `npm install`、続けて `web` で `npm run build` を実行し、`BUILD_ID` の有無で成否を判定。
- 判断理由: `start-webui.bat` は初回のみ build。手動で本番バンドルを作り直す入口が無かった。
- 検証: スクリプト構文は `start-webui.bat` と同型。`BUILD_ID` 欠落時は exit 1。
- 矛盾の明記: MEMORY.md は gitignore のためローカル追記のみ。コード変更（build.bat）はコミット対象。

## 2026-07-20 CodexBar synthetic の API未設定がエラー表示されない

### 症状
CodexBar アドオンで Synthetic（APIキー未登録）が「エラー」ではなく `0%` と表示されていた。

### 根本原因
CodexBar の実スナップショットは `error: "API キーが未設定です"` と同時に `usedPercent: 0`（空 windows）を出す。WebUI は `usedPercent === null` のときだけエラーカードにしていたため、プレースホルダ 0 を「健全な使用率」と誤判定した。

### 修正
- `hasLastGoodUsage()` を追加: error + usedPercent 0 + 空 windows/credits は last-good ではない
- `usageTone` / `overallUsedPercent` / `worstProvider` / `ProviderRow.showErrorOnly` がこれを共有
- 回帰テスト: 実スナップショット形（usedPercent:0）でエラー表示、0%非表示

### 検証
`npx vitest run ../addons/codexbar/lib/codexbar.test.ts ../addons/codexbar/CodexBarWidget.test.tsx` → 36 passed

### 教訓
外部エクスポートの「0」は null と同義のプレースホルダになり得る。エラー有無と windows/credits の有無をセットで判定する。
- コミット: `9c9aaa7`

## 2026-07-20 セッション入力欄のインテリジェンスがリセットされる不具合修正

### 問題
ユーザー報告「セッションの入力欄でモデルのインテリジェンスが変更できない」。TaskView でユーザーがインテリジェンスを選んでも、最初のアシスタント応答到着時に デフォルト に巻き戻るため、実質的に選択が維持されない状態。

### 根因
TaskView の seededModelRef useEffect は [stream.loaded, stream.messages, modelOptions] に依存し、stream.messages 変更のたび発火。新規セッションでは最初の assistant メッセージ到着まで seededModelRef.current===false のまま。最初の assistant 到着で setModel(value)+setIntelligence('') が呼ばれ、ユーザー選択のインテリジェンスがリセットされていた。モデルが同一でも無条件に setIntelligence('') を呼ぶのが問題。

### 修正（web/src/components/task/TaskView.tsx）
- seededModelRef useEffect で、アシスタントメッセージのモデル value !== model の場合のみ setModel+setIntelligence('') を呼ぶ。同一モデルならインテリジェンスを保持
- モデル手動変更時は onChange で seededModelRef.current=true を設定し、以降の自動復元を抑制
- 依存配列に model を追加（setModel 後の再発火は seededModelRef.current===true で早期リターン、無限ループなし）

### 検証
- tsc --noEmit: 型エラーなし
- vitest model-variants.test.ts: 15 passed
- TaskView.test.tsx は jsdom のメモリ制限（heap OOM）で実行不可（既存問題、stash 元コードでも同様）
- e2e（task.spec.ts）は Playwright webServer の better-sqlite3 ネイティブモジュールロードエラーで起動せず（既存環境問題、本修正とは無関係）
- 実セッション画面は開発サーバーの /api/opencode/session/.../message が 500 を返し確認不能（OpenCode バックエンド未接続、既存環境問題）

### 判断・教訓
- 実行時検証が環境問題で不能だったため、コード静的解析から最も可能性の高い根因を推定して修正。推測ベースである点は残るリスク
- seededModelRef のような「初回一回」ガードは、対象データ到着前にガードが false のままだと初回到着時に副作用が走る。ガードの評価タイミングと副作用の冪等性をセットで考える
- 並列セッション（Cursor）が codexbar/タブレット修正を同時進行していた。コミット時に git show --stat で自コミットに他所差分が混入していないか必ず確認
- コミット: e90ee34
## 2026-07-21 画像非対応モデルへの画像送信ブロック（引数不正エラー防止）

### 背景・ユーザー指摘
画像添付時に OpenCode エンジンが `this model does not support image input` エラーを返すバグ。従来 TaskView/HomeView は「画像非対応モデルの可能性」警告表示のみで送信を許可し、結果的にエンジン側で引数不正として弾かれていた。

### 原因
- TaskView の `imageSupported` 判定は `effectiveModelKey`（エージェント設定モデル優先）で行っていたが、警告表示のみで送信はブロックしていなかった。
- HomeView には modelCapabilities 構築すらなく、画像対応判定が一切なかった。
- エージェント選択時は手動セレクタ(model)が無視されエージェントモデルで処理されるのに、警告は model 基準で出る不一致もあった。

### 修正
- TaskView: send 内で実際にプロンプトを処理するモデル（agentModels優先→model）の画像入力対応を確認し、非対応なら setSendError で送信ブロック。capabilities が未判明(undefined)の場合はブロックしない（過剰ブロック防止）。
- HomeView: ProviderResponse 型に attachment/modalities を追加し modelCapabilities を構築。submit で選択モデルが非対応なら setError でブロック。
- HomeView.test の `@/lib/client` モックに timedFetch を追加し、既存の失敗を修正。

### 判定の境界
- `modelCapabilities[key] !== undefined` で「プロバイダ応答にモデルが含まれていた」ことを確認してからブロック。未選択(model=='')や capabilities 未取得時は従来通り送信を許可（過剰ブロック回避）。

### 検証
- tsc --noEmit: エラーなし
- eslint: クリーン
- vitest HomeView.test.tsx: 6 passed
- vitest route.test.ts: 14 passed
- TaskView.test.tsx は既存から jsdom heap OOM で落ちる重いテスト（本変更と無関係、stash でも再現）

### 教訓
- 警告表示のみで送信を許可する UX は、下流エンジンエラーをそのままユーザーに見せる原因になる。クライアント側でブロックできる引数不正は送信前に止める。
- capabilities 未取得時は過剰ブロックを避け「判明した上で非対応」の時だけブロックするのが安全。
- コミット 556f987
---

## 2026-07-21 サブエージェントの bash タイムアウト頻発（原因調査）

### 症状
- チャット UI で bash... スピナーのまま止まり、タイムアウトが頻発
- 添付スクショ: kimi-k2.7-code が read 成功後、cd web && npx next dev を実行中のまま

### 原因（確定）
1. **主因**: エージェントが終了しない常駐プロセス（npx next dev）を blocking の bash ツールで起動している
   - bash ツールの既定タイムアウトは約 30s。dev server は終了しないため必ずタイムアウトする
2. **悪化要因**: リポジトリが OneDrive 配下。ファイル監視・npm/next の I/O が遅延し、短いコマンドでも 30s に張り付きやすい
3. **運用上の重複**: トレイ host が既に web を起動する。エージェント側で next dev を追加起動する必要はほぼ無い（過去 MEMORY でも複数 next 並走・.next 破壊の教訓あり）

### 対処方針（エージェント）
- next dev / next start / watch 系は bash でフォアグラウンド起動しない
- 検証は tsc / eslint / vitest / 既存 host の URL 確認に限定する
- どうしても起動が必要なら、短いヘルスチェックだけ行い、サーバ起動自体はユーザー/host に任せる

### 変更
- コード変更なし（調査のみ）

---

## 2026-07-21 bash常駐プロセスタイムアウト防止（再発防止ルール）

### やったこと
ユーザー「修正できる？」に対し、アプリコードではなくエージェント指示で再発防止した。

1. プロジェクト `AGENTS.md` 新設（追跡対象）— `next dev` / watch 系のフォアグラウンド起動禁止
2. `.cursor/rules/no-long-running-bash.mdc`（alwaysApply、gitignore 対象だがローカル有効）
3. `LESSONS.md` エントリ追加（pain_count: 1）※gitignore。重複破壊後に全文復元
4. `prompts/build.md` 学習済みルールへ1行追記 ※gitignore
5. グローバル `~/.config/opencode/AGENTS.md` 作業原則へ同趣旨を追加（kimi 等サブエージェント共有）

並列セッションが同趣旨を重複追記したため、LESSONS / build.md / MEMORY の重複を整理した。

### 判断理由
- タイムアウトはアプリバグではなくエージェント行動。指示レイヤが最短
- ハードブロック（bash ラッパー拒否）は OpenCode 本体変更が必要で本リポジトリ範囲外
- 他セッションの未追跡 `error.tsx` は混在コミットしない

### 教訓
- タイムアウト頻発の一次対応は timeout 延長ではなく「終了しないコマンドを起動しない」こと
- build 専用 prompts だけではサブエージェントに届かない。共通 AGENTS.md にも書く
- 並列セッション前提: 同一修正の多重書き込みでファイル欠落・重複が起きうる。コミット前に再読込と重複整理

---

## 2026-07-21 bash permission で next/dev を deny（ハードガード）

### 背景
指示ルールだけでは弱いモデルが `npx next dev` を起動しうる。ユーザー「修正できる？」への追加対応。

### やったこと（`~/.config/opencode`、コミット `6c8918f`）
1. `opencode.jsonc` の build `permission.bash` に `*next dev*` / `*next start*` / `npm|pnpm|yarn|bun` の dev 起動を deny
2. programmer / explore / lead-programmer / debugger / test-writer（bash が `*: allow` 系）へ同 deny を追加
3. `AGENTS.md` / `prompts/build.md` の常駐禁止指示を維持
4. `node --test tests/agent-config.test.mjs` 9件パス

### 判断理由（過去エントリとの関係）
- 直前エントリの「ハードブロックは本体変更が必要で範囲外」は不正確だった旨を明記。`permission.bash` の glob deny で OpenCode 設定側から拒否可能
- deny 既定エージェント（finance 等）への誤適用は checkout で撤回

### 教訓
- ソフト指示 + `permission.bash` deny の二段が再発防止に有効
- bash glob 編集は `"*": allow` 行だけを対象にする（`curl *: allow` への部分一致に注意）

---

## 2026-07-21 巻き戻しボタンがスマホ/タブレットで表示されない修正

### 背景
タスクビューのヘッダー右側アクションバーの巻き戻し(revert)ボタンが、モバイル・タブレットで見えないとの指摘。

### 原因
ヘッダーのアクションコンテナが `max-w-[55vw]` + `overflow-x-auto` かつスクロールバー非表示
(`[scrollbar-width:none]` / `[&::-webkit-scrollbar]:hidden`)。多数のアイコンボタンが 55vw に
収まらず右側が見切れ、スクロールバーもないため巻き戻しボタンが発見できなかった。
ファイルツリー/グラフ/Diff ボタンはヘッダーとモバイル下部タブに二重存在し小画面で領域を圧迫していた。

### やったこと（web/、コミット 52894d6 / 218c469）
1. ファイルツリー/グラフ/Diff ボタンを `hidden lg:inline-flex` に（小画面は下部タブがあり冗長）
2. アクションバー max-w を 55vw→70vw に緩和
3. 3 viewport(mobile 375 / tablet 768 / desktop 1440)で巻き戻しボタンの可視+in-viewport を検証する e2e 回帰テストを task.spec.ts に追加
4. playwright の test-results/ playwright-report/ を web/.gitignore に追加
5. tsc / eslint(TaskView.tsx) パス

### 判断理由
- 副次的パネル切替はモバイル下部タブで代替でき、ヘッダーから外すのが最小侵襲かつ主要操作(巻き戻し)の発見性を最優先できる
- ユーザー選択: 実ブラウザ検証はユーザー側で実施

### 教訓・注意
- host(3000, `next start`) と dev(3001, `next dev`) が同一 `.next` を共有し、`npm run build` 実行で dev server が 500 / e2e webServer 起動がタイムアウトする競合が発生。エージェント側で本番 build を走らせると常駐 dev を巻き込んで壊す。実ブラウザ検証は既存 host に対して行うか、競合しないことを確認してから
- vitest 単体実行でも本セッションで JS heap OOM が発生（空きメモリは潤沢）。原因未特定。className のみの変更でロジックテスト影響はなく tsc/eslint で担保
- 横スクロール領域はスクロールバー非表示だと発見性ゼロ。重要操作を隠れ領域に入れない

---

## 2026-07-21 繝倥ャ繝繝ｼ繝・・繝ｫ繝舌・蜴ｳ驕ｸ繝ｻkebab繝｡繝九Η繝ｼ髮・ｴ・ｼ医さ繝溘ャ繝・9e7a4eb・・
### 閭梧勹
蜑榊屓(52894d6)縺ｯ max-w 70vw 邱ｩ蜥後〒縺励・縺・□縺後・2繝懊ち繝ｳ讓ｪ荳ｦ縺ｳ+讓ｪ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ(繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繝舌・髱櫁｡ｨ遉ｺ=逋ｺ隕区ｧ繧ｼ繝ｭ)縺ｯ譬ｹ譛ｬ隗｣豎ｺ縺ｧ縺ｪ縺・・隕∵悍: 蜿ｳ荳翫・繝｡繝九Η繝ｼ鬆・岼繧貞宍驕ｸ縺励後％縺薙〒縺励°謫堺ｽ懊〒縺阪↑縺・ｂ縺ｮ縲阪ｒ蜆ｪ蜈医∵ｮ九ｊ縺ｯ繝峨Ο繝・・繝繧ｦ繝ｳ縺ｧ縺ｾ縺ｨ繧√ｋ縲・
### 繧・▲縺溘％縺ｨ・・eb/src/components/task/・・1. explore 縺ｧ12繝懊ち繝ｳ縺ｮ荳諢乗ｧ繝槭ヨ繝ｪ繧ｯ繧ｹ隱ｿ譟ｻ 竊・designer 縺ｧZone A/B/C莉墓ｧ俶嶌菴懈・
2. HeaderKebabMenu.tsx 譁ｰ隕・ 閾ｪ菴懊ラ繝ｭ繝・・繝繧ｦ繝ｳ(role=menu, ArrowUp/Down, Enter/Space, Escape, outside click, Tab縺ｯtrap縺帙★螟悶∈豬√☆, aria-disabled, aria-current)
3. SessionActions.tsx: SessionActions繧ｳ繝ｳ繝昴・繝阪Φ繝亥炎髯､ 竊・useSessionActions繝輔ャ繧ｯ(busy3謫堺ｽ懷・譛・ + CompactButton + MessageRevertButton 縺ｫ蛻・牡
4. TaskView.tsx: Zone A(蟶ｸ譎・蛛懈ｭ｢/繧ｳ繝斐・/蜀榊酔譛・Switcher/compact) / Zone B(蟷・〒蜍慕噪:繝輔ぃ繧､繝ｫ繝・Μ繝ｼ繝ｻ繧ｰ繝ｩ繝・lg莉･荳・ 繧ｿ繝ｼ繝溘リ繝ｫ=md莉･荳・ Diff=lg莉･荳・ / Zone C(kebab: undo/redo + 髯肴ｼ繝代ロ繝ｫ蛻・崛 + 蜑企勁) 縺ｫ蜀咲ｷｨ謌・5. isMd(768px) 繧・isLg(1024px)縺ｨ蜷後§matchMedia繝代ち繝ｼ繝ｳ縺ｧ霑ｽ蜉
6. headerKebabGroups 繧・useMemo 縺ｧ螳夂ｾｩ

### 逋ｺ隕九＠縺滄㍾螟ｧ繝舌げ・郁ｦ∽ｿｮ豁｣謇ｱ縺・ｼ・Zone B 縺ｮ4繝懊ち繝ｳ縺ｯCSS `hidden lg:inline-flex`/`hidden md:inline-flex` 縺ｧ髱櫁｡ｨ遉ｺ蛻ｶ蠕｡縺励※縺・◆縺後「i.tsx 縺ｮButton base class 縺ｫ `inline-flex` 縺悟ｸｸ譎ゆｻ倅ｸ弱＆繧後ｋ縺溘ａ display 繧ｫ繧ｹ繧ｱ繝ｼ繝峨〒 `hidden` 縺瑚ｲ縺代√ヶ繝ｬ繝ｼ繧ｯ繝昴う繝ｳ繝井ｻ･荳九〒繧ょｸｸ譎り｡ｨ遉ｺ縺輔ｌ縺ｦ縺・◆(繝｢繝舌う繝ｫ/繧ｿ繝悶Ξ繝・ヨ螳溽判髱｢縺ｧ遒ｺ隱・縲・S 譚｡莉ｶ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ({isLg && ...}/{isMd && ...})縺ｫ鄂ｮ縺肴鋤縺医※菫ｮ豁｣縲Ｌebab蜀・・岼(!isLg/!isMd)縺ｨ螳悟・莠定｡･縲・
### 繧ｳ繝ｼ繝峨Ξ繝薙Η繝ｼ蠕後・霑ｽ蜉菫ｮ豁｣・・-code-reviewer 謖・遭・・1. HeaderKebabMenu 縺ｮ Tab 蜃ｦ逅・ preventDefault()+close(true) 縺ｯ繝輔か繝ｼ繧ｫ繧ｹ繝医Λ繝・・蛹悶＠縺ｦ縺・◆ 竊・close(false) 縺ｮ縺ｿ(preventDefault縺ｪ縺・縺ｧ螟悶∈閾ｪ辟ｶ遘ｻ蜍・2. undo/redo: sessionId譛ｪ蟄伜惠譎ゅ↓鬆・岼縺斐→髱櫁｡ｨ遉ｺ縺縺｣縺・竊・蟶ｸ譎り｡ｨ遉ｺ縺・disabled(!hasSession||...) 縺ｧ蛻ｶ蠕｡
3. 繝｢繝舌う繝ｫ迢ｭ蟷・ｮ牙・遲・ 蜿ｳ繝・・繝ｫ繝舌・縺ｫ max-w-[60vw] overflow-x-auto(繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繝舌・髱櫁｡ｨ遉ｺ) 繧呈ｮ狗ｽｮ(sm莉･荳翫・ max-w-none)

### 蛻､譁ｭ逅・罰
- 繝代せ繧ｳ繝斐・/蜀榊酔譛・Switcher/compact 縺ｯ莉悶↓謫堺ｽ懈焔谿ｵ縺ｪ縺・蟶ｸ譎り｡ｨ遉ｺ蜆ｪ蜈・- undo縺ｯMessageRevertButton縲∝炎髯､縺ｯSidebar縲√ヱ繝阪Ν蛻・崛(lg譛ｪ貅)縺ｯ繝｢繝舌う繝ｫ繧ｿ繝悶→驥崎､・kebab縺ｸ
- compact縺ｯZone A縺ｮ縺ｿ(kebab蜀・→縺ｮ驥崎､・屓驕ｿ)
- CSS hidden邉ｻ縺ｯButton base inline-flex縺ｫ雋縺代ｋ=JS譚｡莉ｶ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ縺檎｢ｺ螳・
### 謨呵ｨ薙・豕ｨ諢・- **閾ｪ菴廝utton縺ｮbase縺ｫdisplay邉ｻ縺悟ｸｸ譎ゆｻ倅ｸ弱＆繧後ｋ蝣ｴ蜷医ゝailwind縺ｮ hidden md/lg:inline-flex 縺ｯ蜉ｹ縺九↑縺・*縲Ｅisplay繝励Ο繝代ユ繧｣縺ｮ繧ｫ繧ｹ繧ｱ繝ｼ繝蛾・ｺ上〒雋縺代ｋ縲ゅΞ繧ｹ繝昴Φ繧ｷ繝夜撼陦ｨ遉ｺ縺ｯJS譚｡莉ｶ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ縺九。utton蛛ｴ縺ｧdisplay蛻ｶ蠕｡繧定ｨｱ螳ｹ縺吶ｋclassName貂｡縺励〒陦後≧
- playwright-cli 繧・bash 縺ｧ襍ｷ蜍輔☆繧九→繝上Φ繧ｰ/繧ｿ繧､繝繧｢繧ｦ繝医☆繧九％縺ｨ縺後≠繧・譛ｬ繧ｻ繝・す繝ｧ繝ｳ縺ｧ2蝗・縲ゅΘ繝ｼ繧ｶ繝ｼ謖・､ｺ縺ｫ繧医ｊplaywright菴ｿ逕ｨ遖∵ｭ｢縺ｫ蛻・ｊ譖ｿ縺医ょｮ溽判髱｢讀懆ｨｼ縺ｯ繝ｦ繝ｼ繧ｶ繝ｼ蛛ｴ縺ｫ蟋斐・繧九°蛻･謇区ｮｵ
- vitest TaskView.test.tsx 縺ｯ螟画峩蜑榊ｾ悟撫繧上★JS heap OOM縺ｧ螳溯｡御ｸ榊庄(迺ｰ蠅・撫鬘・縲Ｕsc/eslint縺ｧ諡・ｿ・- z-30 縺ｯ SlashSuggestMenu(z-20)荳翫ヾidebar mobile(z-40)/CommandPalette(z-[60])/Modal(z-[70+])荳九〒螯･蠖


## 2026-07-22 セッション一覧を最新ユーザー操作順に変更

### やったこと
- 既存セッションへの通常プロンプト、slash command、プラン承認送信の開始時に `session_bindings.updated_at` を更新するDB関数とAPIを追加。
- TaskViewから活動時刻APIをawaitしてから送信し、送信後にSidebar再取得通知を発火。
- DB/API/UIテストを追加し、OS依存のDBテスト隔離とactivity await境界をレビューで修正。

### 判断理由
- OpenCodeの全セッション履歴を一覧取得するより、送信時刻をサーバーに永続化して既存のupdatedAtソートを再利用する方が、再読み込み・別タブでも一貫し、通信量も抑えられる。
- 活動時刻更新はbest effortとし、更新失敗でユーザーの本来の送信を妨げない。

### 教訓
- Windowsでは `npm --prefix web exec vitest ...` のパス指定が正しく解釈されないことがある。プロジェクトの `npm run test -- <args>` を使う。
- Vitestはworker数次第でOOMになるため、最終検証では `--maxWorkers=1 --minWorkers=1` を使う。
- テストのイベント順だけではawaitを保証できない。deferred Promiseで未解決中の送信を明示的にassertする。
- Sidebarの既存テストには `timedFetch` mock不足による14件の失敗が残っているが、本機能関連4ファイル30件は成功。

---

## 2026-07-22 繝｢繝舌う繝ｫ kebab 繝｡繝九Η繝ｼ縺ｮ繧ｯ繝ｪ繝・・隗｣豸茨ｼ医さ繝溘ャ繝・b200dc1・・
### 閭梧勹
TaskView蜿ｳ蛛ｴ繝・・繝ｫ繝舌・蜈ｨ菴薙・ `overflow-x-auto` 縺後∝ｭ占ｦ∫ｴ `HeaderKebabMenu` 縺ｮ邨ｶ蟇ｾ驟咲ｽｮpopup繧偵け繝ｪ繝・・縺励※縺・◆縲ゅせ繝槭・縺ｧ縺ｯ `窶ｦ` 繧帝幕縺・※繧ゅΓ繝九Η繝ｼ縺後・繝・ム繝ｼ蜀・↓蝓九ｂ繧後・・岼繧定ｪｭ繧薙□繧企∈謚槭〒縺阪↑縺九▲縺溘・
### 繧・▲縺溘％縺ｨ
- 蜿ｳ繝・・繝ｫ繝舌・繧剃ｺ悟ｱ､縺ｫ蛻・屬縺励◆縲・  - 螟門・: overflow visible縺ｪ繝ｬ繧､繧｢繧ｦ繝育畑繝ｩ繝・ヱ繝ｼ
  - 蜀・・: Zone A/B・亥●豁｢縲√さ繝斐・縲∝・蜷梧悄縲√そ繝・す繝ｧ繝ｳ蛻・崛縲…ompact縲∵擅莉ｶ莉倥″繝代ロ繝ｫ謫堺ｽ懶ｼ牙ｰら畑縺ｮ `max-w-[60vw] overflow-x-auto` 鬆伜沺
  - `HeaderKebabMenu`: 蜀・・縺ｮ螟悶↓縺ゅｋ螟門・繝ｩ繝・ヱ繝ｼ縺ｮ逶ｴ謗･縺ｮ蟄・- `HeaderKebabMenu` 縺ｮARIA縲√く繝ｼ繝懊・繝画桃菴懊｛utside click縲・scape縲】-30縲〇one A/B謫堺ｽ懊～isMd` / `isLg` 譚｡莉ｶ縺ｯ螟画峩縺励↑縺九▲縺溘・- tsc / TaskView eslint繧帝夐℃縲ゅさ繝ｼ繝峨Ξ繝薙Η繝ｼ繧る㍾螟ｧ繝ｻ驥崎ｦ√・霆ｽ蠕ｮ縺ｮ謖・遭縺ｪ縺励〒謇ｿ隱阪・
### 蛻､譁ｭ逅・罰
popup繧単ortal/fixed縺ｫ縺吶ｋ繧医ｊ縲√け繝ｪ繝・・縺吶ｋ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ鬆伜沺縺九ｉkebab繧貞・蠑溯ｦ∫ｴ縺ｨ縺励※蛻・屬縺吶ｋ譁ｹ縺後∵里蟄倥・繧｢繧ｯ繧ｻ繧ｷ繝薙Μ繝・ぅ縺ｨ驥阪↑繧企・ｒ菫晄戟縺ｧ縺阪∝､画峩遽・峇縺梧怙蟆上・
### 謨呵ｨ・- 邨ｶ蟇ｾ驟咲ｽｮpopup繧貞性繧隕∫ｴ縺ｯ縲～overflow-x-auto` / `overflow-hidden` 縺ｮ隕ｪ縺ｫ蜈･繧後↑縺・よｨｪ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ縺悟ｿ・ｦ√↑繧峨√せ繧ｯ繝ｭ繝ｼ繝ｫ蟇ｾ雎｡縺ｮ謫堺ｽ懃ｾ､縺縺代ｒ蜀・・繧ｳ繝ｳ繝・リ縺ｫ蛻・屬縺吶ｋ縲・- 繝悶Λ繧ｦ繧ｶ/Playwright讀懆ｨｼ縺ｯ繝ｦ繝ｼ繧ｶ繝ｼ謖・､ｺ縺ｧ遖∵ｭ｢縲ょ梛讀懈渊繝ｻlint繝ｻ繧ｳ繝ｼ繝峨Ξ繝薙Η繝ｼ縺ｧ諡・ｿ昴＠縲∝ｮ滓ｩ溯｡ｨ遉ｺ縺ｯ繝ｦ繝ｼ繧ｶ繝ｼ蛛ｴ縺ｧ遒ｺ隱阪☆繧九・


---

## 2026-07-22: iPhone入力フォーカス時の自動拡大対策

### やったこと
- `input`、`textarea`、`select` の共通フォントサイズを16pxに統一した（`web/src/app/globals.css`）。
- iPhone Safari は16px未満のフォーム入力をフォーカスすると自動拡大するため、個別コンポーネントではなくグローバルCSSで漏れなく対処した。

### 判断理由
- viewport の `user-scalable=no` や `maximum-scale` によるズーム制限は使わず、フォーム要素の文字サイズ補正のみで対処した。
- これによりユーザーのピンチズーム操作は制限されず、アクセシビリティを維持している。

### 検証
- `tsc --noEmit` 成功（CSS変更のみのため型エラーなし）。
- iOS実機での手動確認は未実施。

### 教訓
- モバイル Safari の自動拡大は viewport 制限ではなく、フォーム要素の `font-size: 16px` で防ぐのが最も副作用が少ない。
- グローバルCSSで一括適用することで、全画面の全フォーム要素に確実に効く。

---

## 2026-07-23 設定の再起動操作に進行フィードバックを追加

### やったこと
- 設定画面の WebUI / OpenCode / すべての再起動操作中に、対象名付きの「再起動しています…」を表示するようにした。
- 進行表示へ `role="status"` と `aria-live="polite"` を付け、スクリーンリーダーにも状態変化を通知した。
- OpenCode 再起動の確認、POST内容、進行表示を固定する回帰テストを追加した。

### 判断理由
- クリック処理とスピナーは既に存在したが、再起動受付後の明示的な状態文言がなく、操作が受理されたか判断できなかった。
- APIやホスト制御を変更せず、既存の `restarting` 状態を表示へ反映する最小修正でユーザーの不確実性を解消した。

### 教訓
- プロセス再起動のように完了まで通信が途切れ得る操作は、ボタンのスピナーだけでなく、対象と進行状態を可視・読み上げ可能な文言で示す。
- UI操作テストでは見た目だけでなく、確認ダイアログ、送信先、payload、ライブリージョンまで一連の経路を検証する。

## 2026-07-23 スマホ向けプラン初期最小化

### やったこと
- 768px未満では承認待ちを含むすべてのプランカードを初期最小化し、ヘッダーから展開・再最小化できるようにした。
- 768px以上では従来どおり初期展開し、最小化中は本文と承認ボタンをDOMから外すようにした。
- `PlanDocumentCard` と `TaskView` の18テスト、`tsc --noEmit`、タスク単位レビュー2回、全体レビューを通した。実タスクへの誤操作を避けるためブラウザ目視はスキップした。

### 判断理由
- 既存の `TaskView.isMd` を画面幅判定の正として再利用し、カード内に重複する `matchMedia` を追加しなかった。
- カードの開閉stateは初期値だけ画面幅から受け取り、その後はユーザー操作を維持する設計とした。
- R14/R16の「デスクトップでも初回最小化固定」指摘とは矛盾するが、根本原因調査では初回は `task === null` でカードが未マウント、幅判定effectが非同期タスク取得より先に反映されるため通常経路を再現できなかった。現セッションのコード追跡と18テストの結果を優先し、推測だけの追加修正は行わなかった。

### 教訓
- propsをstate初期値に使う場合は、子コンポーネントの実際のマウント順序まで追跡し、最終propsだけを観測するテストで初期stateを検証したつもりにならない。
- レスポンシブな初期値とユーザー操作後のstateは分離し、幅変更でユーザーの開閉操作を上書きしない。

---

## 2026-07-23 Windows初回セットアップバッチを追加

### やったこと
- `setup.bat` を追加し、winget、Node.js 20以上、OpenCode、web/host依存関係、production build、`BUILD_ID`を確認してからWebUIを別プロセスで起動する初回導線を実装した。
- OpenCodeはwingetを優先し、失敗時だけ公式npmパッケージへフォールバックするようにした。失敗コード1〜8、日本語の復旧案内、通常時のpauseを追加した。
- 一時ディレクトリとmock `.cmd` を使うWindows回帰テストを追加し、実インストールや常駐起動なしで成功・失敗・非同期起動を検証した。READMEには初回と通常起動、終了コードと復旧方法を記載した。

### 判断理由
- 日常起動用の `start-webui.bat` に初回導入処理を混ぜず、責務と起動速度を維持するため独立したバッチにした。
- CIのNode 20はEOLのため、新規導入には最新LTSを使い、既存Node 20以上は実ビルドで互換性を確認する方針にした。
- WindowsバッチからPATH上の `.cmd` を呼ぶときは `call` がないと呼出元へ戻らないため、外部コマンド呼出しを明示的に `call` 経由へ統一した。

### 教訓
- 初回セットアップは「ツール導入」「再現可能な依存導入」「ビルド確認」「起動」を分離し、各段階に固有終了コードと復旧案内を持たせると第三者が原因を切り分けやすい。
- 非同期起動はmarkerの存在だけでは同期実行でもテストが通る。子プロセスを意図的に待機させ、親が先に終了する時間契約まで回帰テストで固定する。
- 稼働中プロセスがnative Node moduleを保持すると `npm ci` がEPERMになるため、完全検証は一時worktreeで行うとユーザーの常駐環境を壊さず再現できる。

---

## 2026-07-23 R1～R54バグ一覧の優先度整理

### やったこと
- `docs/bugs/2026-07-23-bug-inventory.md` に、MEMORY.md のR1～R54を高・中・低の3段階で集約した。

### 判断理由
- 秘密漏洩・データ破壊・コア導線の停止を高、回避可能な実害・UI不具合・可用性低下を中、文言・仕様差分・既包含を低とした。

### 教訓
- 発見ログが増えたら、原記録を改変せず、共通の判定基準を明記した横断一覧を別文書に作ると修正順の合意と追跡が容易になる。

---

## 2026-07-23 音声入力(Web Speech API)

- やったこと: Home画面とTask画面の両composerに、Web Speech APIを用いた音声認識入力を追加した。共通フックuseVoiceInputがSpeechRecognition/webkitSpeechRecognitionをラップし、共通ボタンVoiceInputButtonがツールバーに配置される。認識テキストは停止時にcomposerの入力値末尾に追記される。
- 判断理由: 外部API依存を一切持たず、ブラウザネイティブのWeb Speech APIのみで完結する設計とした。continuous:true + interimResults:falseで確定結果のみを扱い、ユーザーが明示停止するまで認識を継続する。disabled制御はHomeViewのsubmittingとTaskViewのcomposerLockedをそのまま伝播する。
- 教訓: SpeechRecognitionの型定義がブラウザごとに異なるため、detectSpeechRecognition()でwindowのプロパティをunknown経由で安全に取得する必要があった。no-speech/abortedはユーザー操作の中断や無音タイムアウトでありエラー表示しない設計がUX上適切。continuous:trueでもブラウザが自動停止することがあるため、endイベントで必ずlisteningをリセットする。stop()の戻り値をtranscriptRefで累積管理する実装は、start()時にリセットしないとセッション間でテキストが重複するバグを生む(レビューで発覚し修正)。VoiceInputButton/composer側でtranscriptが空文字列のとき入力値を変更しないガードが必要(空文字列でも常にonTranscriptは呼ぶ設計のため、呼び出し側で無害化する)。
- 検証: use-voice-input.test.ts(14テスト)、VoiceInputButton.test.tsx(9テスト)、HomeView.test.tsx(既存+4テスト)、TaskView.test.tsx(既存+4テスト)、npm run typecheckの全PASSを確認した。


## 2026-07-23 音声入力: critical-architect最終レビューで4ラウンドの非同期バグ修正

- やったこと: subagent-driven-developmentのTask1-5完了後、最終whole-feature reviewをa-critical-architectへ委任したところ、SpeechRecognitionイベントモデルの誤解に起因する実害バグを多数検出し、4ラウンドの修正-再レビューを経て承認に至った。
- 判断理由: 各ラウンドの指摘(resultIndex無視による確定結果重複、stop()の同期戻り値による最終発話の取りこぼし、世代ガードがイベント発生元を識別しない中断/再開競合、SSR/クライアントでのsupported初期値不一致、TaskViewのsessionId未確認でのマイク有効化、stop()連打のsingle-flight化不備、Strict Modeでのeffect再実行によるinterrupted固着、starting状態でのstop()が実際に停止しない、interrupted状態がUIから不可視)はいずれも再現性のある具体的コード指摘であり、費用対効果の観点から全て修正した。endイベントを発火しないブラウザ実装での再開始保留のみ、タイムアウトによる強制復旧がraceを再導入するリスクを上回らないため、仕様書に既知の制限として明記し許容した。
- 教訓: Web Speech APIのようなブラウザネイティブ非同期APIをラップするhookは、個別タスクレビュー(仕様準拠・コード品質)だけでは並行処理の欠陥を検出できない。stop()のような操作を非同期化する際は、全終端経路(正常完了・中断・アンマウント・エラー・例外)でPromiseを必ずsettleすることと、イベントが「どのセッションから発生したか」を状態機械や世代IDで厳密に追跡することを、実装前から設計の必須要件として明記すべきだった。critical-architectへの最終レビュー委任は、通常のコードレビューでは見逃される並行処理バグを発見する上で有効だったが、却下のたびに影響範囲を確認し「今回の指摘で本当に打ち切ってよいか」の費用対効果判断をコントローラー(メイン)が行う必要がある。
- 検証: 最終状態でuse-voice-input.test.ts等4ファイル69テスト全PASS、npm run typecheckエラー0件、a-critical-architectによる最終承認を確認した。

---

## 2026-07-23 Ollamaアイコン正規化

### やったこと
- `addons/codexbar/public/ollama.png` を181×256の透過縦長PNGから、180×180・不透明な `#DFE5E8` 背景・12px内側余白のPNGへ正規化した。
- `web/public/addons/codexbar/` は追跡対象ではない生成コピーのため、`sync:addons` で同期されることを確認した。

### 判断理由
- 透過縦長アセットを `object-contain` で小さく表示すると細く見えるため、中央配置した正方形背景へ変換した。ロゴ全体を保持するため、短辺基準の拡大・切り抜きではなく長辺を156pxのコンテンツ領域へ収めた。

### 教訓
- ソースと配信コピーが同じパス構造でも、Git追跡対象かを先に確認する。生成物は同期を検証してもコミットへ混在させない。
- 全体テストでは既存のSSEモック不足と `timedFetch` モック不足により3ファイル17件が失敗した。一方、対象のProviderIconテスト、typecheck、lintは通過しており、アセット変更との因果は確認されなかった。


---

## 2026-07-23 起動不良: 開発成果物の分離

### やったこと
- `web/package.json` の `dev` を `web/scripts/dev.mjs` 経由に変更し、開発サーバーへ既定で `NEXT_DIST_DIR=.next-dev` を渡すようにした。

### 判断理由
- `next dev` とトレイホストの `next start` が同じ `web/.next` を共有すると、開発コンパイルが本番サーバーの成果物を上書きして応答不能になるため。`next.config.ts` と `.gitignore` には既に分離用の受け皿があった。

### 教訓
- 開発・本番を同じ作業ツリーで並行実行する場合、Next.js の `distDir` を必ず分離し、npm スクリプトで既定値を強制する。検証では `node --check`、package.json の parse、`npm run dev -- --help` により実行経路と引数透過を確認する。


---

## 2026-07-23 ビルド復旧: .next キャッシュ破損の切り分け

### 発見
- ホストの本番ビルドが prerender 中に `TypeError: Cannot read properties of undefined (reading 'call')`（webpack-runtime）で `/` の生成に失敗していた。
- `.next` を削除してクリーンビルドすると webpack は "Compiled successfully" で通過し、真の原因（別セッションの kebab→SessionSwitcherDialog リファクタ未完成による `KebabGroup.renderContent` 型エラー）が露出した。真因解決後（他エージェントが `0d0fb31` でコミット）にビルドは 7/7 prerender まで完全にグリーン化した。
- `web/` には `.next-broken-*` 等の破損バックアップが多数あり、並列 Next ビルド + OneDrive 同期でキャッシュ破損が起きやすい環境である。

### 判断理由
- webpack-runtime の `reading 'call'` は多くがチャンク不整合（キャッシュ破損）で、コンパイル成功後の prerender 段階で出るため tsc/lint では検出できない。まず `.next` を消してクリーン再ビルドし、真のエラーを露出させて切り分けた。
- 露出した型エラーは別エージェントが実時間で編集中の未コミット差分に起因したため、AGENTS.md の並列規則に従い当該ファイルは触らず、所有者の完了を待った。自分のコード変更は行っていない（`.next` 削除は gitignore 対象で無害）。

### 教訓
- prerender の `reading 'call'` は真因を隠すことがある。最初に `.next` を消してクリーンビルドし、真のエラーを露出させてから原因を判断する。
- 並列セッションが同一ファイルを実時間編集していると git status は数秒で変わる。編集前に毎回再確認し、他者の未コミット差分は待つ/触らない/混在させない。

---

## 2026-07-23: CodexBar addon の Qwen Cloud アイコン

### やったこと
- Qwen Code公式のApache-2.0 PNGをCodexBar addonに追加し、`qwen-cloud` と `qwen` のブランド表示・アイコン解決を対応した。
- ブランドキーとOpenCodeプロバイダIDからのアイコン解決をテストした。

### 判断理由
- OpenCodeの既存設定が使用する `qwen-cloud` を主IDとし、互換性のため `qwen` も同じQwen Cloudアイコンへ解決する。
- addonの公開資産は `addons/codexbar/public/` を正とし、`sync:addons` でWeb公開先へ同期する。

### 教訓
- addonのプロバイダ追加は、ラベル・アイコンマップ・OpenCode ID変換・公開PNG・ユニットテストを同じ変更単位で更新する。

---

## 2026-07-23 空レスポンスJSONエラーの修正

### やったこと
- 共有クライアントのJSON読み取りで、204/205および空・空白本文を `undefined` として処理した。
- `getJson`、`sendJson`、`ocJson` の回帰テストを追加し、非空の不正JSONが引き続き例外になることも確認した。

### 判断理由
- OpenCodeのcompact・permission/question応答には204 No Contentが仕様としてあり、無条件の `Response.json()` がブラウザの `Unexpected end of JSON input` を発生させていたため。

### 教訓
- JSONを期待する共通fetchヘルパーでも、HTTPのbodyなし成功（204/205）と空本文を先に扱い、`Response.json()` を無条件に呼ばない。
