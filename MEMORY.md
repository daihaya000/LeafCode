# 作業ログ: OpenCode API v2(Beta) 移行準備の実装(優先度順 P1〜P4)

## 日付

2026-08-08(無言終了の誤再送を防止)

## 依頼

「無言終了が頻発する」。

## 原因

サーバー側 `hang-watchdog` が、モデルのステップ間で一時的に
`session.status=idle` になった時点で、まだ本文を生成していないアシスタントを
「無言返答」と判定していた。実際のセッションでも、自動再開マーカーが本文生成中の
ターンに付与されており、同じプロンプトの早すぎる再送が確認できた。

## 修正内容

- `idle + 本文なし` の判定に `SILENT_RESPONSE_GRACE_MS=30秒` を追加。
- 初回観測または transcript のフィンガープリント変化時は静穏期間を開始し、abort/再送しない。
- 内容が変わらないまま静穏期間を過ぎた場合だけ、既存の1回限り自動再開へ進める。
- 実際の無言返答と、思考パートが更新中の中間 `idle` を回帰テストで固定。

## 検証結果

- Web全体: 247 files / 2932 tests 成功
- `npm run typecheck` 成功
- 対象ファイルの `npm run lint -- src/lib/hang-watchdog.ts src/lib/hang-watchdog.test.ts` 成功
- `next build` はプロジェクト指示により未実行

## 運用メモ

稼働中のWebUIはproduction mirrorの既存プロセスであるため、修正反映には通常の
WebUI再起動が必要。再起動後は、本文生成中のステップ間 `idle` で自動再開枠を消費しない。

## 日付

2026-08-08(Goalループ一時停止の即時化)

## 依頼

Goalループの一時停止を、現在ターン完了後ではなく即時停止する挙動へ変更。

## 実装内容

- `pause` 操作で `running` / `verifying_completed` も即時 `paused` へCAS遷移するよう変更。
- 実行中のOpenCodeセッションへabortを送り、競合する遅延応答はrevision CASで破棄。
- 検証フェーズの `turn_kind` は保持し、再開時に検証へ戻れるようにした。
- Goal Loop仕様書と統合テストを即時停止の挙動へ更新。

## 検証結果

- GoalLoopPanel / goal-loop統合テスト: 78 tests 成功
- `npm run typecheck`: 成功

## 日付

2026-08-08(Goalループ再開ボタンのモバイル表示)

## 依頼

一時停止後も再開ボタンが見えないという再報告。

## 実装内容

- 再開ボタンのラベルをモバイル幅でも常に表示し、再生アイコンだけにならないようにした。
- ボタンに `title` を追加し、視認性と操作対象の判別性を改善した。

## 検証結果

- `GoalLoopPanel.test.tsx`: 45 tests 成功
- `npm run typecheck`: 成功

## 日付

2026-08-08(Goalループ一時停止後の再開操作)

## 依頼

「Goalループ　一時停止後　再開ボタンがない」。

## 実装内容

- `GoalLoopPanel` で、現在ターン完了後に一時停止する `pauseRequested` 状態でも再開ボタンを表示するようにした。
- `updateGoalLoopStatus` の resume で、まだ `paused` になっていない保留中の一時停止要求を取り消せるようにした。
- 遅延一時停止中の再開操作をUIテスト・統合テストで追加検証した。

## 検証結果

- GoalLoopPanel / goal-loop 統合テスト: 80 tests 成功
- `npm run typecheck`: 成功

## 日付

2026-08-08(CodexBar OpenRouter 設定・全体率の整合)

## 依頼

CodexBar addon の「プロバイダー設定が不正」エラーと、WebUI/WinForms 間の全体率不一致を修正。

## 実装内容

- `addons/codexbar/api/providers.ts` の固定カタログへ `openrouter` を追加。`enabledProviders` に OpenRouter があっても設定 API が 503 にならないようにした。
- WebUI の旧スナップショット互換処理で、上限なし OpenRouter の旧 `usedPercent: 0` を利用率なしとして扱う。従量課金額は表示したまま全体平均から除外する。
- OpenRouter の表示名、ブランドアイコン、OpenCode provider ID のアイコン対応を追加。
- CodexBarWin の exporter は上限なしクレジット専用プロバイダーを `usedPercent: null` で出力し、Kraken LCD も数値なしの利用率を 0% と誤表示しないようにした。

## 検証結果

- `npm --prefix web run test -- ../addons/codexbar/lib/codexbar.test.ts ../addons/codexbar/api/providers.test.ts ../addons/codexbar/CodexBarWidget.providers.test.tsx` ... 45 tests 成功
- `npm --prefix web run typecheck` ... 成功
- CodexBarWin: 別出力先 Release ビルドと `--self-test` ... 成功

## 運用メモ

稼働中の WebUI は production mirror の旧 `next start` であり、この作業中に WebUI を停止するビルド/再起動は行わなかった。次回の通常の WebUI 再起動で更新済み build が反映される。

## 日付

2026-08-08(累計思考時間表示)

## 依頼

「累計金額のように累計思考時間も表示する」。

## 実装内容

- `web/src/components/task/TaskView.tsx` で、アシスタント応答ごとの
  `time.completed - time.created` を合計し、累計コストの横に
  「累計思考 Xs / Xm ss / Xh mm」形式で表示するようにした。
- 完了時刻のない応答やアシスタント以外のメッセージは集計対象外。
- 表示には既存の `formatElapsed()` を利用し、累計が0秒の場合は表示しない。

## 検証結果

- `npm run typecheck` ... 成功
- `npm run test -- src/components/task/TaskView.test.tsx` ... 113 tests 成功

## 日付

2026-08-07(同日、LAN IP → loopback 自動リダイレクト)

## 依頼

「ホストPCでアクセス確認が取れる場合 192.168.0.102 からアクセスしても
127.0.0.1 へリダイレクトする」。ユーザー選択により実装方針を
「ホストPC自身が LAN IP で開いたとき、loopback へ自動リダイレクト」とした。

## 実装内容

`web/src/lib/localhost-redirect.ts`(新規) + テスト + `(app)/layout.tsx` のフック。

- `maybeRedirectToLocalhost()` をクライアントのみで実行。
  1. `window.location.hostname` が loopback なら何もしない
  2. private(LAN/VPN)ホストのみ対象。public ホスト名(リバースプロキシ)は残す
  3. 到達性の証明: `http://127.0.0.1:18765/health` を `mode:"no-cors"` で fetch。
     成功 = このブラウザはホストPC上にある(control server の Host 検証で
     DNS リバインドは既にブロック済み)。失敗/タイムアウト = 遠隔(スマホ)で、
     リダイレクトしない(fail-closed)
  4. `window.location.replace()` でホスト名だけ `127.0.0.1` に差し替え。
     プロトコル/ポート/パス/クエリは保持
- `(app)/layout.tsx` で `useEffect` から呼ぶ(1 回だけ)

### 設計メモ

- control server への CORS は必要ない。`no-cors` fetch は opaque response を
  返し、成功/失敗しか読まない。MEMORY の「到達性の証明」設計を実装した形。
- スマホは loopback 到達不可のため永遠にリダイレクトされない。
  ホストPC上の LAN URL だけが loopback へ移動する。

## 検証結果

- `npx vitest run src/lib/localhost-redirect.test.ts` ... 10 tests 成功
- `npx vitest run src/lib` ... 125 files / 1608 tests 成功
- `npx tsc --noEmit` ... 成功
- `npx eslint`(新規3ファイル) ... 成功

## 変更ファイル

- `web/src/lib/localhost-redirect.ts`(新規)
- `web/src/lib/localhost-redirect.test.ts`(新規)
- `web/src/app/(app)/layout.tsx`

## 日付

2026-08-07(同日、前ラウンドの提案を実装)

## 依頼

「優先度順の実装計画を立ててから実装」。前ラウンドで提案した 6 案から、
投機的な死にコードになるもの(capability detection / フィーチャーフラグ)を
外し、4 段階に絞って実装した。

## 実装内容

### P1: パスレジストリ `web/src/lib/opencode-paths.ts`(新規)

- `OC_PATH_TEMPLATES` を `as const satisfies Record<string, keyof OcPaths>`
  で宣言。**生成された OpenAPI 型に存在しないパステンプレートは `tsc` が
  弾く**。実証済み: `prompt_async` を `prompt_async_RENAMED` に書き換えると
  `error TS2820: ... Did you mean "/session/{sessionID}/prompt_async"?` が
  出て、正しい候補名まで提示される。
- v1 ビルダー(`sessionMessagePath` / `sessionPromptAsyncPath` /
  `sessionAbortPath` / `sessionTodoPath` / `sessionDiffPath` /
  `sessionCommandPath` / `sessionPath` / `permissionReplyPathV1` /
  `questionReplyPathV1` / `questionRejectPathV1`)と
  v2 ビルダー(`...PathV2` 系 5 本)、定数 4 本を提供。
  id は `openCodeSessionPath` / `encodePathId` 経由で検証 + 1 回だけ encode。
- 移行した呼び出し元: `goal-loop.ts` / `hang-watchdog.ts` /
  `memory-extract.ts` / `task-service.ts` / `workflow-scheduler.ts` /
  `attention.ts` / `useSessionStream.ts` /
  `api/analytics/model-ranking/route.ts` / `api/diff/route.ts` /
  `api/workspaces/[id]/sessions/[sessionId]/refresh-title/route.ts`。
- **回帰リスクへの対処**: `model-ranking` は全 session binding をループするため、
  1 行でも不正 id があるとビルダーの throw がルート全体を 500 にしてしまう。
  パス構築を try で包み、その binding だけスキップするようにした
  (従来の `.catch(() => null)` と同じ耐性を維持)。
- テスト `opencode-paths.test.ts`(7件): 全ビルダーの厳密な出力文字列、
  traversal id の拒否、テンプレートの一意性、v1/v2 の prefix 分離。

### P2: SSE イベントレジストリ `web/src/lib/opencode-events.ts`(新規)

- `HANDLED_V1_EVENT_TYPES`(14件)/ `HANDLED_V2_EVENT_TYPES`(18件、
  `permission.v2.*`・`question.v2.*`・`session.next.*`)を宣言。
  `eventGeneration()` / `isSessionNextEvent()` /
  `RESOLVED_REQUEST_EVENT_TYPES` + `isResolvedRequestEventType()`。
- `attention.ts` の `isResolvedEvent` の 6 分岐 or 連鎖を
  `isResolvedRequestEventType()` に置換(レジストリに実消費者を持たせ、
  宣言だけの死にコードにしない)。
- テスト `opencode-events.test.ts`(7件):
  - **生成スキーマとの照合**: 宣言した全イベント型が
    `opencode-schema.d.ts` の `type: "..."` リテラルとして存在すること。
    実証済み: 存在しない `session.renamed.upstream` を足すと
    `expected [ 'session.renamed.upstream' ] to deeply equal []` で落ちる。
  - 抽出正規表現自体の健全性(50件以上見つかること)。空集合同士の比較で
    テストが空回りするのを防ぐ。
  - `useSessionStream.ts` が比較しているイベントリテラルを走査し、
    レジストリ未登録のものが無いこと(`busy`/`idle`/`text` 等の
    非イベント列挙は除外リストで明示)。

### P3: 生成物の鮮度チェック `opencode-schema-freshness.test.ts`(新規、3件)

- P1/P2 の保証は `opencode-schema.d.ts` が最新である前提に立つ。古い生成物の
  上では両方とも空回りするため、`docs/opencode/openapi.json` の
  `paths` キー集合と、生成 `.d.ts` の `export interface paths` 内の
  キー集合が**完全一致**することを検証(現在 156 パスで一致)。
  差分があれば「`npm run gen:types` を実行してコミットせよ」の指示になる。
- 両抽出器が >100 件を返すことを先に assert し、パース失敗による空振りを防ぐ。
- レジストリの全テンプレートが spec 側にも存在することを再確認
  (`satisfies` は生成物側しか見ないため)。
- `docs/opencode/VERSION`(現在 1.17.11)が semver 形式であることを確認。

### P4: ドキュメント

- **`docs/specs/opencode-api-v2-migration.md`(新規)**: 現状の API サーフェス表、
  導入した仕組みの一覧、エンジン更新時の 5 ステップ手順、意図的に未移行の
  箇所とその理由、見送った案(capability detection)。
- `architecture.md` §6.5.1 は要約 + spec への参照のみ。
  **`architecture.md` は `.gitignore` 対象(ローカル専用)** と判明したため、
  運用手順の正本は追跡対象の `docs/specs/` 側に置いた。

## 意図的に未移行として残した箇所

`opencode-access-mode.ts` / `opencode-skill-permission.ts` /
`opencode-task-permission.ts` の `PATCH /session/{id}`。これらは
「セッション id を厳格検証せず percent-encode のみ」という契約を既存テスト
(`/session/ses%2Fweird%20id` を期待)が固定しており、throw するビルダーに
載せると挙動が変わる。v2 の等価物も保存済みパーミッション API の形状が
異なり単純な差し替えでは済まないため、移行時に個別設計する。

## 検証結果

- `npx tsc --noEmit`(web)... 成功
- `npx eslint`(web 全体)... 0 errors(既存の warning 2件のみ、今回の変更対象外)
- `npx vitest run`(web 全体)... **245 files / 2898 tests 成功**
  (変更前 2872 → 新規 26 件追加、既存の失敗ゼロ)
- ドリフト検知は P1(tsc)・P2(test)とも**意図的に壊して落ちることを実証**し、
  検知後に復元済み。
- AGENTS.md の方針により `next dev` / `next build` は未実行。

## 変更ファイル

新規:
- `web/src/lib/opencode-paths.ts` / `opencode-paths.test.ts`
- `web/src/lib/opencode-events.ts` / `opencode-events.test.ts`
- `web/src/lib/opencode-schema-freshness.test.ts`
- `docs/specs/opencode-api-v2-migration.md`

変更:
- `web/src/lib/{goal-loop,hang-watchdog,memory-extract,task-service,workflow-scheduler,attention,useSessionStream}.ts`
- `web/src/app/api/{analytics/model-ranking,diff}/route.ts`
- `web/src/app/api/workspaces/[id]/sessions/[sessionId]/refresh-title/route.ts`
- `architecture.md`(gitignore 対象、ローカルのみ)

## 教訓(Windows / cmd.exe)

`node -e` や PowerShell の `-Command` にバッククォートやエスケープを含む
置換スクリプトを渡すと、cmd.exe / PowerShell の解釈で**黙って壊れた内容が
書き込まれる**(今回 PowerShell の `` `n `` がリテラルとしてファイルに入り、
以降のバッククォートまでがテンプレートリテラル扱いになって構文エラー)。
一括置換は Edit ツール(`replaceAll`)を使うこと。

---

# 作業ログ: バックエンド OpenCode CLI の V2(Beta)API との互換性調査

## 日付

2026-08-07

## 依頼

「バックエンド OpenCode CLI の V2(現在Beta)との互換性は」という質問。実装変更は行わず、
コード調査のみで現状を確定する。

## 調査して確定した事実

- 実際の機能コード(`goal-loop.ts` / `task-service.ts` / `hang-watchdog.ts` /
  `workflow-scheduler.ts` / `memory-extract.ts` / `useSessionStream.ts` 等)は
  すべて **V1 REST**(`/session`, `/session/{id}/prompt_async`, `/session/status`,
  `/session/{id}/permissions/{id}` 等)のみを呼び出している
  (`web/src/lib/opencode-schema.d.ts:1341` 以降の `session.*` operationId 群)。
- コード中に頻出する `permission.v2.asked` / `question.v2.asked` の「v2」は、
  **V1 API 内でセッションスコープ化されたパーミッション/質問イベント**を指す別概念
  (`attention.ts:72-91`, `useSessionStream.ts:913-1007` で v1/v2 両対応済み)。
  OpenCode CLI 自体の新 API 世代とは無関係で紛らわしいだけ。
- `opencode-schema.d.ts`(OpenAPI 自動生成)には、OpenCode CLI の新「V2」API と
  見られる別系統のパス(`/api/health`, `/api/session`, `/api/agent`, `/api/pty`,
  `/api/integration/*`, `/api/credential/*`)と operationId(`v2.session.prompt`
  `v2.session.wait` 等)、SSE の `SessionNext*` 系イベント(`ToolProgress` /
  `TextDelta` 等の細粒度ストリーミング)の**型定義のみ**存在する
  (`opencode-schema.d.ts:2228〜3189`)。WebUI のアプリケーションコードは
  これらのエンドポイントを一切呼び出していない(未使用の生成型)。
- プロキシの安全ガード層(`web/src/lib/opencode.ts` の `isBlockedOpencodeWrite`)
  のみ V2 パス形状(`/api/session/.../shell`, `/api/pty`,
  `/api/integration/.../connect/*`, `/api/credential/*` 等)の危険な書き込みを
  遮断できるよう先回りで拡張済み(コメント: 「v2 API proxied through
  `/api/opencode/[...path]`」)。機能実装ではなく素通り時の予防策のみ。
- `package.json` / `host/package.json` に OpenCode CLI のバージョンピンは無く、
  winget 等で都度最新を導入する運用(V1/V2 のどちらを使うかはコード側の実装で決まる)。

## 結論(初回、後で訂正)

初回調査では「非互換(未実装)」と結論したが、**これは不正確だった**(下記の
訂正ラウンドを参照)。ガード層のみ V2 パスを認識して安全側に倒す準備がある、
という部分は正しい。

## 変更ファイル

なし(調査のみ)。

---

# 作業ログ: 上記調査の訂正 + 将来のV2移行に向けた準備策の検討

## 日付

2026-08-07(同日、追調査)

## 依頼

「あらかじめ将来的な移行を踏まえた準備としてできることはあるか」というフォローアップ。

## 訂正した事実(前回の「非互換」判定は不正確)

`useSessionStream.ts` を精査した結果、**V2 API は既に部分採用済み**と判明:

- **V2 REST 採用済み**: パーミッション/質問の返信は
  `/api/session/{id}/permission/{id}/reply`,
  `/api/session/{id}/question/{id}/reply` という**真の V2 パス**を使用中
  (`attention.ts:111-125`。`opencode-schema.d.ts` の
  `v2.session.permission.reply` operationId のパスと一致確認済み)。
- **V2 SSE 採用済み**: `session.next.text.delta` / `session.next.tool.input.delta` /
  `session.next.tool.called/success/failed` / `session.next.step.failed` 等、
  SessionNext 系の細粒度ストリーミングイベントを
  `useSessionStream.ts:1323-1591` で既に処理している。
- **V1 のまま**: セッション作成・prompt 送信・ステータス取得・メッセージ一覧・
  shell・init 等の基幹操作(`goal-loop.ts` 等)。

→ 実態は「V1 メイン + V2 を部分採用したハイブリッド」。前回ラウンドの
「型定義のみで未使用」という結論はイベント/パーミッション経路に限れば誤り。

## 提案した準備策(実装はしていない、口頭提案のみ)

1. **パス文字列のハードコード解消**(優先度高): `goal-loop.ts` /
   `task-service.ts` / `hang-watchdog.ts` / `workflow-scheduler.ts` /
   `memory-extract.ts` に散在する生パス文字列(`"/session"` 等)を
   セッション操作のクライアント関数群に集約し、切替時の変更点を1箇所化。
2. **イベント正規化ロジックの整理**: `useSessionStream.ts` の巨大な if 連鎖
   (1155-1591行)をテーブル駆動/アダプタ関数に切り出し、V1イベント廃止時に
   安全に削れる形にする。
3. **Capability detection**: `/api/health`(V2)のレスポンスを見て起動時に
   V2 セッション API の利用可否を判定する仕組みを追加(現状は受動的処理のみ)。
4. **フィーチャーフラグの下地**: `auto-settings.ts` のパターンを流用し
   `engine.prefer_v2_session_api` 等の設定キーで段階ロールアウト/即時
   ロールバックを可能にする。
5. **スキーマ差分監視の運用化**(優先度高・低コスト): 既存の
   `web/package.json` の `gen:types`(`openapi-typescript
   ../docs/opencode/openapi.json`)と `docs/opencode/VERSION`
  (現在 `1.17.11`)を使い、CLI 新版リリース時に定期的に再生成 → `tsc` エラーで
   V2 operationId の破壊的変更を検知するフローを運用に組み込む。
6. **API 使用箇所の一覧文書化**: 現状のハイブリッド実態を `architecture.md`
   等に明記(誤認防止。今回自分自身が一度誤認した)。

いずれもユーザーの意思決定待ちで、この時点では未着手。

## 変更ファイル

なし(調査・提案のみ)。

---

# 作業ログ: 新環境セットアップの再検証(静的整合性 + フルフロー統合テスト)

## 日付

2026-08-07

## 依頼

「新環境で正しくセットアップされるかテスト」(前回の Caddy 自動導入変更の
続き)。

## やったこと

1. **ベースライン確認**: `cd host && npm test` を変更前にまず実行し、
   372/372 成功であることを確認(前回の Caddy 自動導入コミット時点の状態)。
2. **`scripts/start-webui.bat` の静的整合性チェック**: ラベル定義/
   `goto`・`call :label` 参照を全て抽出して突き合わせるワンショットの
   Node スクリプトで、
   - 重複ラベル: 無し
   - 参照されているが未定義のラベル: 無し
   - 定義されているが未参照のラベル: `web_build_guard_passed`
     (今回の変更より前から存在する、フォールスルー専用のマーカーラベルで
     問題無し)
   を確認。`:check_caddy` / `:caddy_skip_no_winget` / `:caddy_install_failed`
   はいずれも正しく定義・参照されている。
3. **「完全新規機」統合テストの強化**
   (`start-webui.bat installs winget/Node.js/OpenCode/Caddy/deps on a fresh
   machine, then reaches the host tail`、旧名称から Caddy を追記):
   - 個別の Caddy テスト(前回追加)とは別に、Node.js 未対応バージョン +
     OpenCode 未導入 + Caddy 未導入を**同時に**満たす唯一のフルフロー
     シナリオに `caddy-winget-installed` マーカーの存在と
     `install --id CaddyServer.Caddy ...` のログ行の存在を追加。
   - さらに **インストール順序**の検証を追加: ログ中の
     `OpenJS.NodeJS.LTS` → `SST.opencode` → `CaddyServer.Caddy` →
     `npm ... web ci` の順で出現することを確認。必須コンポーネント
     (Node.js/OpenCode)が任意コンポーネント(Caddy)より先に解決され、
     Caddy の試行が web 依存関係インストールより前に完了していることを
     保証する(セットアップ中の透明性 / 診断のしやすさのため)。

## 検証結果

- `cd host && npm test -- src/start-webui-bat.test.js`... 20/20 成功。
- `cd host && npm test`(全体)... 372/372 成功(既存テストの強化のみで
  テスト件数は前回コミットと同じ)。
- AGENTS.md の方針により `next dev`/`next build`/exe の実起動は行わず、
  静的解析 + サンドボックス化した `.bat` テストのみで検証。

## 変更ファイル

- `host/src/start-webui-bat.test.js`: 「完全新規機」フルフローテストに
  Caddy 自動導入のアサーションとインストール順序の検証を追加。
  (`scripts/_label-check.mjs` はラベル整合性の使い捨て確認用に一時作成し、
  検証後に削除済み。コミット対象外。)

---

# 作業ログ: Caddy をセットアップ時に自動インストールするように変更

## 日付

2026-08-07

## 依頼

前回の調査(下の「新規環境での初回セットアップ検証」)で「Caddy 自体は自動
インストールされない(README にも導入手順が無い)」ことを報告したところ、
「必要なコンポーネントはすべて自動インストールするように」という指示。

## 変更内容(`scripts/start-webui.bat`)

- `:check_node` / `:check_opencode` と同じ位置(依存関係インストールの前)に
  `:check_caddy` を追加。winget の package ID は `CaddyServer.Caddy`
  (`winget search caddy` で確認済み)。
- 判定順序:
  1. `OPENCODE_WEBUI_CADDY=0` が明示されていれば何もせず終了(既存のランタイム
     opt-out と同じ変数で、インストール自体もスキップできるようにした)。
  2. `caddy version` が通ればスキップ(導入済み)。
  3. `%LOCALAPPDATA%\Microsoft\WinGet\Links\caddy.exe` が存在すればスキップ。
     winget は Caddy を LOCALAPPDATA 配下の Links シムとして入れることが多く、
     今のコンソールの PATH にまだ反映されていなくても
     `host/src/index.js` の `findCaddy()` が同じパスを直接見て検出できるため、
     ここで PATH を無理に更新する必要は無いと判断(既存の `findCaddy()` の
     設計とここを一致させた)。
  4. winget が無ければ「スキップした」旨をログしてそのまま続行。
  5. `winget install --id CaddyServer.Caddy ...` を実行。失敗しても
     **エラーコードを返さず**、警告ログを出して続行。
- Node.js/OpenCode とは異なり `:check_caddy` は**常に exit code 0**を返す
  設計にした。理由: Caddy は既にランタイム側(`host/src/index.js`
  `spawnCaddy()`)で「無ければ黙ってスキップ」というフェイルセーフを持つ
  opt-in 機能であり、ここを Node.js/OpenCode 同様の必須扱い(失敗で
  WebUI 全体を止める)にすると、オフライン環境や社内プロキシで Caddy の
  winget ソースだけ届かないケースで WebUI 本体まで起動できなくなる
  リグレッションになるため。「自動インストールを試みるが、失敗しても
  本体の起動は妨げない」という設計にした。

## テスト(`host/src/start-webui-bat.test.js`)

- winget モックに `CaddyServer.Caddy` 分岐を追加(成功時に
  `caddy-winget-installed` マーカーを作成)。
- サンドボックスの `LOCALAPPDATA` を隔離用の一時ディレクトリに固定
  (これが無いと、開発機に実際に Caddy が winget 導入済みのため
  `:check_caddy` が実 shim を検出して常にスキップしてしまい、
  「新規機」を再現できていなかった → 修正)。
- 新規テスト6件:
  - 新規機で winget 経由に自動導入されること。
  - `caddy` が既に PATH にある場合は再インストールしないこと。
  - WinGet Links シムが既にある場合は再インストールしないこと。
  - winget install 失敗時もホストは起動すること(exit 0 のまま)。
  - `OPENCODE_WEBUI_CADDY=0` でインストール自体もスキップされること。
  - winget が無くてもクラッシュせずスキップして起動すること。
- `cd host && npm test`(372 tests、`start-webui-bat.test.js` 20 tests /
  `bat-encoding.test.js` 7 tests 含む)... 全件成功。ASCII-only/CRLF 制約
  (AGENTS.md)も維持されていることを確認。

## README 更新

- クイックスタートの自動導入リストに Caddy(任意)を追記。
- 「スマホ・別 PC からアクセスする」節に、Caddy は winget で自動導入される
  こと、失敗時は WebUI 本体は影響を受けないこと、手動導入コマンド
  (`winget install --id CaddyServer.Caddy`)、`OPENCODE_WEBUI_CADDY=0` で
  インストール自体もスキップできることを追記。

## 検証結果

- `cd host && npm test`... 372/372 成功。
- AGENTS.md の方針により `next dev`/`next build`/exe の実起動は行わず、
  コード変更 + サンドボックス化した `.bat` 単体テストのみで検証
  (稼働中の WebUI・実機の Caddy 環境には触れていない)。

## 変更ファイル

- `scripts/start-webui.bat`: `:check_caddy` を追加。
- `host/src/start-webui-bat.test.js`: winget モックへの caddy 分岐 +
  `LOCALAPPDATA` 隔離 + 新規テスト6件。
- `README.md`: 自動導入の説明を更新。

---

# 作業ログ: 新規環境での初回セットアップ検証(Caddy 連携を重点確認)

## 日付

2026-08-07

## 依頼

「まったく新規の環境で exe 実行時の初回セットアップが適切に動作するかテスト。
caddy 関連は特に」という調査依頼。

## 調査した範囲

- `OpenCodeWebUI.exe`(`scripts/launcher/Launcher.cs`)→
  `scripts/start-webui.bat`(winget / Node.js / OpenCode CLI / web・host・
  browser-bridge の依存関係 / production build)→
  `host/src/index.js`(トレイ host 本体、OpenCode・WebUI・Caddy の起動管理)
  という起動チェーン全体を読み、特に Caddy 関連(`findCaddy` / `ensureCaddyfile` /
  `syncCaddyfileAddresses` / `spawnCaddy` / `resolveBrowserUrl`)を精査。

## 発見した設計(バグではなく仕様として妥当と判断)

- **Caddy 自体は自動インストールされない**: `scripts/start-webui.bat` は
  winget で Node.js と OpenCode CLI は自動導入するが、Caddy を導入するステップは
  存在しない。README にも Caddy 自体の winget パッケージ ID 等の導入手順は書かれて
  いない(`scripts\caddy-trust.bat` 等の「導入済み前提」の手順のみ)。
- `scripts/start-webui.bat` は `if not defined OPENCODE_WEBUI_CADDY set
  OPENCODE_WEBUI_CADDY=1` としており、**既定で Caddy 連携が有効**になる
  (README の「明示的なオプトイン」という説明とは字面上ややズレるが、実害は次の
  フェイルセーフで吸収されている)。
- `findCaddy()`(`host/src/index.js`)は `where.exe caddy` → 失敗時に
  `%LOCALAPPDATA%\Microsoft\WinGet\Links\caddy.exe` の順で探し、両方失敗すると
  `null` を返すのみでインストールは行わない。
- `spawnCaddy()` は `findCaddy()` が `null` の場合、
  `error('Caddy enabled but not found on PATH. ...')` をログ(コンソール +
  `/api/host/logs`)に出すだけで **host 全体はクラッシュせず継続**する。
  この経路では `ensureCaddyfile()` は一切呼ばれないため、`deploy/Caddyfile` も
  作られない(中途半端な設定ファイルが残らない)。
- `resolveBrowserUrl()` は Caddyfile が存在しない(=読めない)場合
  `detectCaddyLoopbackUrl`/`detectCaddyPublicUrl` が例外を握り潰して `null` を
  返すため `probeUrl` が `null` になり、`waitForHttpUp` の待機を一切発生させずに
  即座に `pickBrowserUrl` が `webuiUrl`(`http://127.0.0.1:3000`)にフォール
  バックする。**Caddy 未導入の新規機（マシン)でもブラウザは待たされずに開く**。
- Caddy が後から導入され、`deploy/Caddyfile` が存在しない状態で次回起動すると
  `ensureCaddyfile()` が `deploy/Caddyfile.example` からシードし、
  `syncCaddyfileAddresses()` で現在の LAN IPv4 アドレスを site 行に反映する。
  既存の `deploy/Caddyfile`(ユーザー編集済み)がある場合は上書きされない。

## テスト(新規環境をエミュレート)

- 既存の `host/src/caddy-sites.test.js` / `caddyfile.test.js` /
  `index.test.js`(`pickBrowserUrl` / `parseCaddyPublicUrl` /
  `parseCaddyLoopbackUrl` / `isOurCaddyCommandLine` / `shouldRestartCaddy` 等)
  は Caddy まわりの純粋ロジックを既にカバーしていたが、**`findCaddy` /
  `ensureCaddyfile`(副作用ありの実処理)は無テストだった**ため、
  `host/src/index.js` の当該2関数を(既存の他の内部関数と同じ慣習で)
  `export` し、新規 `host/src/caddy-setup.test.js` を追加:
  - `findCaddy` が `PATH` にも WinGet Links にも無い場合 `null` を返す
    (`PATH` を `%SystemRoot%\System32` のみに絞り、`LOCALAPPDATA` を空の
    一時ディレクトリに差し替えて検証。`where.exe` 自体は Windows の既定探索
    順序で解決されるため、この方法で「caddy だけが無い」状態を安全に再現できる)。
  - `findCaddy` が WinGet Links のシムにフォールバックすることを、一時
    ディレクトリにダミー `caddy.exe` を置いて検証。
  - `findCaddy` が実環境(このマシンには caddy 導入済み)で実 caddy を解決
    することを確認(未導入マシンでは自動的にアサーションをスキップ)。
  - `ensureCaddyfile` が `OPENCODE_WEBUI_CADDYFILE` を一時パスに向けた状態
    (キャッシュバスティング付き動的 `import()` で env 反映後のモジュールを
    再ロード)で、初回は example からシードし、2回目はユーザー編集を
    上書きしない no-op になることを確認。
  - `ensureCaddyfile` が書き込み先の親ディレクトリが無い(書き込み失敗)
    場合も例外を投げず `false` を返すことを確認(host のクラッシュ防止)。
  - 実運用中の `deploy/Caddyfile`(gitignore 対象、ユーザーのドメイン/認証
    設定を含む)には一切触れず、すべて一時ディレクトリ上で検証した
    (稼働中のトレイ host / Caddy への影響ゼロ)。

## 検証結果

- `cd host && npm test`(`node --test`、366 tests)... 全件成功
  (新規5件含む)。
- host には eslint 設定が無いため lint はスキップ(既存の repo 構成通り、
  lint 対象は `web/` のみ)。
- AGENTS.md の方針により `next dev` / `next build` / exe の実起動は行わず、
  コード精査 + 単体テストのみで検証(稼働中の WebUI への影響なし)。

## 結論

- 新規環境で Caddy が未導入のまま `OpenCodeWebUI.exe` を実行しても、
  host はクラッシュせず、WebUI は `http://127.0.0.1:3000` で正常に起動する。
  Caddy 連携は「使えるなら使う、無ければ黙ってスキップ」という設計で、
  ログにはエラーとして記録されるため後から原因を追跡できる。
- 唯一の実務上のギャップは **Caddy 自体の導入手順がドキュメント化されて
  いない**点(README は「PATH に無ければスキップ」とは書くが、導入方法
  自体は書いていない)。バグではなくドキュメント改善の余地として記録のみ
  行い、今回は依頼範囲外のため変更していない。

## 変更ファイル

- `host/src/index.js`: `findCaddy` / `ensureCaddyfile` をテスト可能にする
  ため `export` を追加(ロジック変更なし)。
- `host/src/caddy-setup.test.js`(新規): 上記のテスト5件。

---

# 作業ログ: 既存プロファイルへの vendor CLI プロキシ自動更新機構

## 日付

2026-08-07

## 依頼と背景

前ラウンドで CommandCode CLI Proxy の接続不安定バグ(index.mjs)を修正したが、
`installWebUiDependencies` の `copyVendorFiles` は `if (fs.existsSync(target)) continue;`
で**既存ファイルを決して上書きしない**ため、当時の修正は既に導入済みのプロファイルには
一切反映されない問題があった。ユーザー指摘「既存のプロファイルに導入済みの古いバージョン
は差し替えた?」→ No。よって「vendor の上書き更新の仕組み」を追加した。

## 設計: ハッシュ比較 + マーカーファイル

- 導入済みプロファイル直下に **`.webui-vendor-versions.json`** を置き、
  「vendor 相対パス → コンテンツハッシュ(sha256)」を記録する。
- `installWebUiDependencies` 実行時、バンドル(ソース)側のハッシュとマーカーを比較:
  - **一致** → スキップ(従来の idempotent を維持)。
  - **不一致 or マーカー無し** → `copyEntry` で上書きし、マーカーを更新。
- `hashEntry(source)`: ファイル/ディレクトリの安定ハッシュ。ツリーを辿って
  各ファイル sha256 を連結して sha256(シンボリックリンクは無視)。ディレクトリ内
  に新規ファイルが増えた場合も含めて伝播する。
- `copyEntry` は既に各ファイルを上書き、ディレクトリは再帰コピーするため、
  配下の新ファイルも同期される(既存実装を再利用)。

## 変更ファイル

- `web/src/lib/profiles/webui-dependencies.ts`
  - import に `crypto`、定数 `VENDOR_VERSIONS_FILE = ".webui-vendor-versions.json"` を追加。
  - `copyVendorFiles` を「存在すればスキップ」→「ハッシュ差分があれば上書き」に変更。
  - ヘルパ: `readVendorVersions` / `writeVendorVersions`(atomic temp+rename) /
    `readVendorVersion` / `writeVendorVersion` / `hashEntry` を追加。
- `web/src/lib/profiles/webui-dependencies.test.ts`
  - 「updates an already-installed CommandCode CLI Proxy when the bundle hash changes」
    同一バンドル再実行で idempotent / バンドル内容変更で既存プロファイルが更新される。
  - 「records and reuses the installed CommandCode version marker」
    マーカー JSON に `plugin/...` と `packages/...` の両キーが記録され、マーカーを削除
    したレガシー経路でも再コピーされる。

Cursor / Claude CLI Proxy にも同ロジックが適用される(`copyVendorFiles` 共通関数)。

## 検証

- `npx vitest run src/lib/profiles/` → 7 files / 92 tests 全PASS。
- `npx tsc --noEmit` → 成功。
- git コミット `ec9ee2a`。

## 並行プロセス注意(再発)

作業中、**別エージェントが未コミットの変更を巻き戻した**。私の import 編集・コピー更新ロジック・
テスト追加の全てが一度消え、git ワーキングツリーがクリーンに戻った。`copyVendorFiles` の
再適用とテストの作り直しを余儀なくされた。proof:
- 19 tests PASS(単体)→ 直後 17 tests(2件消失)→ git status clean。
並行エージェントが同じファイル群(copy vendor 更新)を扱う環境では、編集→検証→コミットを
素早く行い、都度 `git status` を確認する。MEMORY.md 更新と本修正のコミットを各独立に行う。

---

# 作業ログ: ハングウォッチドッグが未回答の質問/パーミッションをハングと誤判定するバグ修正

## 日付

2026-08-07

## 依頼

「質問UIで未回答がハング判定されないように修正」というバグ報告。

## 発見した問題（`web/src/lib/hang-watchdog.ts`）

- サーバー側ハングウォッチドッグ（`docs/specs/hang-watchdog-server-side.md`）は
  「`/session/status` が busy のまま、かつ transcript に無活動時間が
  ハング閾値を超えた」ことだけを見て自動 abort → 1回だけ自動再送する。
- OpenCode の `question`/`permission` ツールがユーザーの回答を待っている間、
  エンジンはツール呼び出しを完了させられないため `/session/status` は
  `busy` のままになり得る一方、transcript には新しい timestamp/テキストが
  一切増えない。
- 結果として、**ユーザーが質問カード/パーミッションカードに答える前に
  ハング閾値（既定5分）が経過すると、ウォッチドッグがそのターンを
  「ハングした」と誤認して `abort` してしまう**。同じリクエストは
  hang-retry として1回だけ自動再送されるが、質問はやり直しになり、
  ユーザーの操作が silently に無視される形になる。
- クライアント側 `useSessionStream.ts` は `/permission`・`/question`
  （v1/v2 両方）を見て pending 状態を UI に出しているが、サーバー側
  ウォッチドッグには同等のチェックが存在しなかった（見落とし）。

## 修正内容（`web/src/lib/hang-watchdog.ts`）

- `hasPendingUserInput(directory, sessionId)` を追加。
  `/api/session/{id}/permission`・`/api/session/{id}/question`（v2、
  セッション scoped）と `/permission`・`/question`（v1、全体リストを
  `sessionID` でフィルタ）の4エンドポイントを順に確認し、いずれかに
  未解決のリクエストがあれば true を返す。個々のエンドポイントの
  404/未対応は「ここには無い」として無視し、他のエンドポイントを試す
  （fail-safe で誤検知しない側に倒す）。
- `evaluateWatch()` の最終ハング確定判定
  （`now - activityAt >= timeoutMs`）の直前にこのチェックを挿入。
  pending な質問/パーミッションがあれば `last_progress_at` を現在時刻に
  進めて `armed` のまま次のフルタイムアウト分待ち直す（`resolveHang` を
  呼ばない = abort しない）。リストが空になった時点で通常のハング判定に
  戻る。

## テスト

- `web/src/lib/hang-watchdog.test.ts` に3件追加:
  - 未回答の質問がある間は abort されず `armed` のまま維持される。
  - 未回答のパーミッションがある間も同様。
  - 質問/パーミッションのリストが空になれば、通常どおりハング確定して
    abort + 自動再送される（既存動作が壊れていないことの確認）。
- 既存 `hang-watchdog.test.ts` の全22ケースは引き続き成功
  （新規チェックが busy status のモックレスポンスと衝突しないことを確認）。

## 検証結果

- `npx tsc --noEmit -p .`（web）... 成功。
- `npx eslint src/lib/hang-watchdog.ts src/lib/hang-watchdog.test.ts`... 成功。
- `npx vitest run src/lib/hang-watchdog.test.ts src/lib/hang-retry.test.ts
  src/lib/useSessionStream.test.ts src/lib/useSessionStream.stuck-busy.test.ts
  src/app/api/tasks/route.test.ts "src/app/api/opencode/[...path]/route.test.ts"
  src/components/task/TaskView.test.tsx`... 339 tests 成功。
- `npx vitest run`（web 全体）... 241 files / 2872 tests 成功。
- 本番ビルド（`next build`）は AGENTS.md の方針によりエージェントからは
  未実行（ユーザー判断に委ねる）。

# 作業ログ: CommandCode CLI Proxy の接続不安定バグ調査と修正

## 日付

2026-08-06

## 依頼

「CommandCodeの接続が安定しない」というユーザー報告の調査。「CommandCode」は
`vendor/commandcode-cli-proxy`（OpenCode プラグイン。`command-code` CLI を
loopback の OpenAI 互換プロキシとして公開し、Provider API を直接叩かずに
Go-plan アカウントの CLI 経由アクセスを維持する）を指すと判明（質問で確認済み）。

## 発見した問題（`packages/commandcode-cli-proxy/index.mjs`）

- **タイムアウトが皆無**: `runCliOnce` は `child.on("close")` を待つだけで、
  `command-code` CLI が権限確認待ち・ネットワーク不通などでハングすると
  リクエストが**永久に pending** になっていた。ユーザーからは「応答が返らない」
  「接続が切れたように見える」という不安定さとして観測される。
- **stream レスポンスの `finish_reason` が常に `null`**: `[DONE]` の前に
  `finish_reason: "stop"` を持つ終端チャンクを送っていなかった。OpenAI 互換の
  クライアントが turn の完了を検出できないケースがある。
- **クライアント切断の検知先が誤り**: 直していないが気付いた点として、当初の
  実装にはクライアント切断検知が無く、後から `req` の `"close"` を使う実装を
  試したところ、**通常のリクエストでもボディ読了時に発火する**ため、正常な
  リクエストを誤って abort してしまうバグを自分で作り込んだ → `res` の
  `"close"`（+ `writableEnded` ガード）に直して解決。
- Windows で `spawn(..., { shell: true })` の場合、`child.kill()` は cmd.exe
  だけを終了し実体の `command-code` プロセスは残る。`taskkill /pid <pid> /t /f`
  でプロセスツリーごと終了するよう修正。
- リトライの正規表現に `timeout` を含めていたため、タイムアウトで殺した直後の
  エラーメッセージ自体がリトライ対象になり、ハング時に待ち時間が2倍になる
  バグがあった → `isRetryableError()` に切り出し、タイムアウト/abort は
  リトライ対象外に。

## 修正内容

- `computeTimeoutMs(env)` を追加。既定 120s、`COMMANDCODE_CLI_TIMEOUT_MS` で
  上書き可。タイムアウト/クライアント切断時は `killTree()`（win32 は
  `taskkill /t /f`、他は `child.kill()`）でプロセスを確実に終了。
- `chatCompletionChunks(id, text)` を追加し、streaming の最終チャンクに
  `finish_reason: "stop"` を含める。
- `isRetryableError(message)` を追加（`API server encountered` / `try again` /
  `network` のみ対象、`timeout`/`aborted` は対象外）。
- ハンドラは `res` の `"close"`（`writableEnded` ガード付き）で
  `AbortController` を発火し、実行中の CLI プロセスを止める。

## テスト

- `vendor/commandcode-cli-proxy/packages/commandcode-cli-proxy/index.test.mjs`
  （新規）: `computeTimeoutMs` / `isRetryableError` / `chatCompletionChunks`
  の純粋関数ユニットテスト6件。
- `vendor/commandcode-cli-proxy/packages/commandcode-cli-proxy/server.integration.test.mjs`
  （新規）: `COMMANDCODE_CLI` を PATH 上の一時 `.cmd`（内部で fake CLI の
  Node スクリプトを実行）に差し替え、実際に HTTP サーバーを立てて
  非stream/stream/`/v1/models`/ハング/CLI失敗の5パターンを検証。
  - Windows で `process.execPath`（`C:\Program Files\nodejs\node.exe` 等）を
    そのまま `COMMANDCODE_CLI` に入れるとスペースを含むパスの shell 引数解釈が
    破綻するため、PATH 解決可能な短い `.cmd` 名を使う方式にした。
  - モジュールキャッシュ対策でクエリ文字列付き `import()` を使い毎テストで
    新規サーバーを起動。**`server.close()` を呼ばないと listening HTTP server
    が event loop を掴んだままになり `node --test` が終了しない**ことに注意
    （`start()` を export してテストから `server.close()` できるようにした）。
- `node --test`（`vendor/commandcode-cli-proxy/packages/commandcode-cli-proxy`
  ディレクトリ内）... 11 tests 成功。
- `npx tsc --noEmit` / `npm run lint` / `npm run --prefix web test`
  （238 files / 2847 tests）... 成功（web 側は無変更のため既存回帰確認のみ）。

## 精査して問題なしを確認

- `web/src/components/settings/CommandCodeCliProxyAuth.tsx` /
  `web/src/app/api/provider/commandcode/auth/route.ts`（認証キー保存側、
  今回のバグと無関係）。
- `web/src/lib/profiles/webui-dependencies.ts` のプラグイン配布ロジック
  （vendor からプロファイルへのファイルコピーのみで、今回の修正対象コードには
  影響しない）。
- `spawn(executable(), args, { shell: true })` に Node 22 系で
  `DEP0190`（shell:true 時の args 未エスケープ）警告が出る。既存コードから
  存在した設計で、`--model` は設定由来の固定値、prompt は stdin 経由のため
  injection リスクは低いと判断し、今回はスコープ外として着手していない。

## 未コミット状態との遭遇（並行プロセス注意）

- 作業完了直前に `git status` が clean になっており、確認すると別プロセスが
  ほぼ同時に `feat(web): add memory REST API routes and auto-extraction driver`
  というコミットを作成し、**このラウンドの commandcode 修正も一緒に**
  巻き込んでいた（stage していたファイルが先にコミットされた）。このリポジトリは
  複数エージェントが並行して動作する環境であることが判明。以後の git 操作は
  `git status` を都度確認しながら慎重に行うこと。

---

# 作業ログ: 自動抽出フック(goal-completed)

## 日付

2026-08-07(前回に続き)

## 実装内容

`docs/specs/memory-layer.md` の「自動抽出トリガー」のうち goal-completed 分。

### 新規ファイル

- `web/src/lib/goal-memory-hook.ts` — 抽出フック
  - `AUTO_EXTRACT_SETTING_KEY = "memory.auto_extract"`(settings テーブル, デフォルト有効)
  - `isAutoExtractEnabled()`(settings 未取得/例外時は有効扱い — goal-loop 統合テストが
    `./db` を getSetting 無しでモックするため防衛的にデフォルト true)
  - `scheduleAutoExtractAfterGoalCompleted(loop)` — fire-and-forget で
    `runMemoryExtraction({workspaceId, sessionId})` を起動。失敗は無視(ループを妨げない)。session 未束縛はスキップ
- `web/src/lib/goal-memory-hook.test.ts` — 5件(デフォルト有効 / 無効設定 / 実行 / 無効時のスキップ / 未束縛スキップ)

### goal-loop.ts 変更

- `applyAssistantResult`(goal-loop.md 遷移#9)で、UPDATE が成功し `nextStatus === "completed"`
  (`applied.changes !== 0`)になった直後に `scheduleAutoExtractAfterGoalCompleted(loop)` を呼ぶ。
  `loop.workspaceId` / `loop.sessionId`(= opencode_session_id) をそのまま抽出に使う。

### 設計ポイント

- 抽出はネットワーク/モデルを伴うため、goal loop の状態遷移から完全に切り離して fire-and-forget。
- `runMemoryExtraction` は `workspaceId` + `sessionId` を引数に取り、未承認候補(approved=0)だけを蓄積。

### 補足(前フェーズからの差分なし)

- goal-loop 全体 31+34テスト(前から)、hook 5件が全て成功。tsc / eslint clean。

---

# 作業ログ: メモリ層 REST API ルート + 自動抽出ドライバ

## 日付

2026-08-06

## 実装内容

`docs/specs/memory-layer.md` の「API」と「自動抽出」フェーズ。

### 新規ファイル

- `web/src/lib/memory-extract.ts` — 自動抽出ドライバ（純粋関数 + ocServer 薄ラッパー）
  - `messageText` / `extractTranscriptTail`(末尾16KB) / `lastJsonBlock` / `parseExtractionJson` / `buildExtractionPrompt`
  - `resolveLightweightModel`（`chooseAutoModel` を tier:"light"/mode:"cost" で呼ぶ）
  - `runMemoryExtraction`（スローアウェイ session を作り prompt_async → ポーリング → フェンス JSON を parse → `insertExtractedMemories`。approved=0 で挿入）
  - 定数: `MEMORY_EXTRACT_TRANSCRIPT_MAX_CHARS=16000` / `RESULT_TIMEOUT_MS=120000` / `POLL_MS=2000`
- `web/src/lib/memory-extract.test.ts` — 純粋関数8件（parse/block/tail/text/prompt）
- `web/src/app/api/memory/route.ts` — GET 一覧(workspace_id/approved/kind) + POST /extract
- `web/src/app/api/memory/[id]/route.ts` — PATCH(内容/種別) + DELETE
- `web/src/app/api/memory/[id]/approve/route.ts` — POST 承認
- `web/src/app/api/memory/route.test.ts` — ルート5件（workspace 行は upsertProject+createWorkspace で実物を作る）

### 設計ポイント

- 全ルート `requireAuthorized` ガード + `runtime="nodejs"` / `dynamic="force-dynamic"`。
- `runMemoryExtraction` は失敗時 `{created,skipped,errors,error}` を返し、API は 502 で返す。
- 抽出セッションは `title:"memory-extract"`、モデル未解決なら engine デフォルトにフォールバック。
- ポーリング終了判定は「assistant で `time.completed` が付いた最後のメッセージ」のフェンス JSON を parse できた時点。

### 検証

- `tsc --noEmit` / `eslint`（対象ファイル）/ `vitest run`（全体 239 files / 2855 tests 成功）
- `api-guard-coverage.test.ts` は新ルート検出後も7件パス（全ルートで requireAuthorized 済み確認）

---

# 作業ログ: バグハント第8ラウンド（PTY input の上限チェック単位修正）

## 日付

2026-08-06

## 発見したバグ

`web/src/app/api/pty-session/input/route.ts` が送信ペイロード上限
（`MAX_INPUT_BYTES = 64KB`）を **文字数**（`body.data.length`）で比較していた。

- 多バイト文字（CJK 3 byte / emoji 4 byte）の場合、文字数が上限以下でも
  UTF-8 エンコード後は最大約 4 倍（〜256KB）になり得る。
- 定数名・エラーメッセージは bytes を謳っており実装と不一致。

## 修正内容

- `web/src/app/api/pty-session/input/route.ts`
  - `Buffer.byteLength(body.data, "utf8")` で比較するよう修正。
- `web/src/app/api/pty-session/input/route.test.ts`（新規5件）
  - host-only ガード / 非文字 data / relay 未接続 409 /
    文字数＜上限だがバイト数＞上限の 413 回帰（fix 除去で失敗確認済み）/
    正常系（relay.ws.send への転送）。
  - 従来このルートにはテストが無かったため、ガード系も合わせて補完。

## 精査して問題なしを確認（このラウンド）

- `pty-relay.ts`（relay 重複接続防止・cursor replay・refcount/清掃・
  realm-safe なバイナリ判定・UTF-8 ストリーミングデコード）
- `pty-session.ts`（cwd の realpath スコープ検証・command/args/env 不転送・
  シェル許容性チェック・v1 API 統一・WS チケット）
- `pty-session/{stream,input,resize}/route.ts`（4404 と一時切断の区別、
  ハートビート/abort 清掃、次元クランプ）

## 検証結果

- `npx tsc --noEmit` / `npm run lint` ... 成功
- `npm run --prefix web test` ... 235 files / 2833 tests 成功（+5）

---

# 作業ログ: バグハント第7ラウンド（browser-bridge brokerの誤りエラーコード修正）

## 日付

2026-08-06

## 発見したバグ

`browser-bridge/broker/server.mjs` の `/internal/tools/:tool` ハンドラの最終フォールバックが、
**拡張が接続済みでも** `503 EXTENSION_DISCONNECTED` を返していた。

- このフォールバックに到達するのは `validateToolInput` が受理する未実装ツール
  （現状 `browser_wait` のみ。未知ツール名は検証段階で INVALID_REQUEST）。
- `!extensionSocket` ガードはそれより前に 503 を返すため、最終行到達時は必ず
  拡張接続済み → 「拡張未接続」は事実と異なるエラーになる。
- 仕様（docs/specs/browser-bridge-mcp.md）のエラー契約でも
  `EXTENSION_DISCONNECTED` は「拡張が未接続」に限定されており、
  未実装ツールは INVALID_REQUEST が整合的。

## 修正内容

- `browser-bridge/broker/server.mjs`
  - 最終フォールバックを `400 INVALID_REQUEST` に変更
    （正当な `!extensionSocket` ガードの 503 は維持）。
- `browser-bridge/test/broker-server.test.mjs`
  - 回帰テスト追加: ペアリング+認証済み（拡張接続あり）の状態で
    `browser_wait` を呼ぶと 400 INVALID_REQUEST が返り、
    `/internal/status` は引き続き `connected: true` を示すことを検証。
    fix を外すと失敗することを確認済み。

## 調査して問題なし/未実装と確認した箇所

- broker のペアリング（人間承認・TTL失効・切断時破棄・再接続時の鍵再利用）、
  認証、承認フロー、スナップショット dedupe、result の世代検証、revoke、close 清掃
- `policy.mjs` / `audit.mjs` / `state.mjs` / MCP クライアント・サーバー
- 既知の未実装（バグではない）: MCP に `browser_click` / `browser_wait` が未登録、
  承認は単発のみで MCP 呼び出し元へ結果を返す経路がない（screenshot の
  キャッシュ経由のみ）。これは計画 Task 7/9 の範囲で意図的な部分実装。
- 未使用の `rejectUnlessLocalOrPrivateNetwork`（web側、第1ラウンド記録済み）と同様、
  将来 `browser_wait` を実装する際は同期応答経路を設計すること。

## 検証結果

- `npm --prefix browser-bridge test` ... 77 tests 成功（+1）

---

# 作業ログ: バグハント第6ラウンド（workflow schedulerの例外スタック修正）

## 日付

2026-08-06

## 発見したバグ

`workflow-scheduler.ts` の `runWorkflowSchedulerTick` が各 attempt 処理を
try/catch なしで await していた。

- `processRunningAttempt` → `activateReviewers`（reviewer用セッション作成の
  `POST /session`）や `advanceReviewGate`（`JSON.parse(row.config)` 等）が
  例外を投げると tick 全体が中断し、**他の全ワークフローの処理も止まる**。
- 最も深刻な経路: Implement が `succeeded` 確定済み → `activateReviewers` が
  一時エラー（engine 再起動等）で失敗 → reviewer attempt が未作成のまま
  run は `running` で残留。**再トリガー経路が無く永久スタック**する。

## 修正内容

- `workflow-scheduler.ts`
  - `pauseAttemptBestEffort(attemptId, error)` を追加。
    `pauseWorkflowForAttempt` を投げない形で呼ぶ（pause 失敗でも tick を止めない）。
  - `runningAttempts()` ループと `dispatchAttempt` 呼び出しを try/catch で包み、
    想定外例外はその run を `scheduler_error` で pause するだけの影響に限定。
    （`pauseWorkflowForAttempt` は attempt が `dispatching` 以外なら run の
    pause のみ行うため、succeeded 済み attempt の状態は壊さない。）
- `workflow-scheduler.test.ts`
  - 回帰テスト追加: Implement 完了 → reviewer セッション作成が例外を投げる
    ケースで、attempt は succeeded のまま run が `scheduler_error` で
    pause されることを検証。fix を外すとテストが落ちることを確認済み。

## 合わせて精査し問題なしを確認（このラウンド）

- `workflow-control.ts` / `workflow-control-executor.ts`（トランザクションCAS、
  監査ハッシュ）
- `useSessionStream.ts` 全文（第5ラウンド: 新規バグなし）
- `db.ts` / `git.ts` / diff系（第3・4ラウンド: 新規バグなし）

## 検証結果

- `npx tsc --noEmit` / `npm run lint` ... 成功
- `npm run --prefix web test` ... 234 files / 2828 tests 成功（+1）

---

# 作業ログ: バグハント（設定画面・アップデート・ログインの3件修正）

## 日付

2026-08-06

## 目的

静的チェック（typecheck/lint/全テスト）が全緑の状態から、コードレビューで潜在バグを
探し出して修正する。

## 見つけて修正したバグ

1. **`ProfileSyncSettings` のエラーバナーが成功後も残る**
   - `refresh()` の成功パスが `setError(null)` を呼んでいなかった。姉妹コンポーネント
     `ProfileAgentsSyncSettings.refresh()` は呼んでおり不整合だった。
   - 「ファイルを開く」失敗等のエラーが、その後の「状況を更新」成功後も消えずに残る。
   - 修正: `web/src/components/settings/ProfileSyncSettings.tsx` の refresh 成功時に
     `setError(null)` を追加。

2. **アップデートAPIのクライアント側タイムアウトがサーバー側より短い**
   - `SettingsView.updateService()` は全ターゲット一律 130 秒で `timedFetch` していたが、
     サーバー側の最長処理時間は webui release 更新が最大 360 秒超
     （release取得/ZIP取得/展開 各120秒）、nextjs が 180 秒。
   - クライアントが先に abort して「タイムアウト」エラーになる一方、サーバー側では
     更新処理が継続・適用される（誤った失敗表示）。
   - 修正: ターゲット別にタイムアウトを設定（nextjs 200 秒 / webui 400 秒 /
     それ以外 130 秒）。

3. **ログインが試行回数制限(429)で拒否されたときの表示が「通信エラー」になる**
   - host は 429 で「試行回数が多すぎます。X 秒後に再試行してください」を返すが、
     `web/src/lib/auth.ts` の `login()` は 401 以外の例外を全て
     「通信エラーが発生しました」に潰していた。
   - 修正: 429 はサーバーのメッセージをそのまま表示する分岐を追加。
   - テスト: `web/src/lib/auth.test.ts`（新規4件: 成功 / 401 / 429 / その他）。

## 調査して問題なしと確認した箇所（抜粋）

- `host/src/control-server.js`（DNSリバインディングガード、HMACセッション、
  revocation store、スロットリング）
- `host/src/windows-auth.js` / `auth-store.js` / `audit-log.js` / `secure-file.js`
- `web/src/lib/api-guard.ts` / `local-request.ts` / `session.ts` / `client-ip.ts`
- `web/src/lib/hang-watchdog.ts` / `oc-server.ts` / `useSessionStream.ts` の SSE 再接続
- `web/src/app/api/opencode/[...path]/route.ts` の SSE ハートビート/クリーンアップ
- `rejectUnlessLocalOrPrivateNetwork` は XFF のプライベート値を信頼するため
  公開環境ではバイパス可能だが、**現在はどのルートからも未使用**（死代码）。
  将来再利用する際は左端 XFF を信頼しない設計に見直すこと。

## 検証結果

- `npm run --prefix web typecheck` ... 成功
- `npm run --prefix web lint` ... 成功
- `npm run --prefix web test` ... 234 files / 2827 tests 成功（+4）
- `npm run --prefix host test` ... 361 tests 成功

---

# 作業ログ: Hermes Agent 的機能の仕様書 再レビューと追加修正

## 日付

2026-08-06

## 目的

前回の修正(M1〜M6, S1〜S4, A1〜A4)自体が新たな不整合を生んでいないか再レビューする。

## 検出した問題(前回修正の副作用・見落とし)

- **R1** memory-layer.md: 前回のFTS対策(`INTEGER PK`+`public_id`)は過剰。他テーブル全て
  `id TEXT PRIMARY KEY` なので、それを保ったまま FTS5 の `id UNINDEXED` 列で解決するよう簡素化。
- **R2/R3** memory-layer.md: 「`embedding`列を確保」(実在しない)、「FTS類似度0.9以上」
  (FTS5のbm25は正規化0-1類似度ではない)という不正確な記述を削除・訂正。
- **R4** memory-layer.md: `${OPENCODE_WORKSPACE}` 変数展開は根拠不明のため「未検証」と明記。
- **R5(高)** self-improvement-loop.md: 実行ドライバー手順が反映表(S1で確定した「memoryは自動反映」)
  を反映しておらず、全target `pending` 挿入のままだった。target別分岐に修正。
- **R6** self-improvement-loop.md: 出力契約JSONの `memory` フィールドが memory-layer.md の
  `memories` スキーマ(`kind`必須)と不整合だった。
- **R7(高)** agent-monitor.md: Escalateの宛先が「`(kind,ref_id)`が結びつくセッション」だと
  `kind=subagent` 行が自分自身に送ることになり無意味。`parent_ref_id` 列を追加し、
  Escalateは `kind=subagent` カード限定に修正。
- **R8** agent-monitor.md: `kind=adhoc` が状態写像に存在せず未定義だった。v1は手動作成限定と明記。
- **R9** agent-monitor.md: 新設SSEにハートビート言及が無かった。既存 `sse-health.ts` の
  `SSE_HEARTBEAT_MS`/`SSE_SILENCE_MS` を再利用するよう追記。
- **R10** 全体: idle系トリガーがagent-monitorのイベントエミッターに依存する旨を
  memory-layer/self-improvement 双方の「実装順序」に明記(循環しないよう
  「エミッター未実装の間は goal-completed のみで運用」と明示)。

## 教訓

一度のレビュー修正で終わらせず、**修正自体を再レビューする**ことで、
「存在しないコード機構(サーバー内イベントバス)を前提に別の修正をしてしまう」
ような二次的な誤りを検出できた(A2の修正が `events.ts` の実態を誤認していた点など)。
仕様書間の相互参照(idle検出の共有)が生む実装順序の暗黙の依存関係も、
明示しないと循環に見えるため、各仕様書の「実装順序」に依存を書き込む運用とする。

---

# 作業ログ: Hermes Agent 的機能の仕様書 3本目の追加レビュー(実コード突合)

## 日付

2026-08-06

## 目的

前2回の修正は仕様書間の整合に焦点を当てた。今回はさらに一歩進め、
**仕様書が参照する実コード・既存specへ突合して**、参照の誤り・古さを検出する。

## 検出した問題(実コードとの不整合)

- **R11(高)** self-improvement-loop.md: 「`auto-model.ts` のルーティングに `retrospective`
  タスク種別を追加」はコードと不整合。`auto-model.ts` にタスク種別ルーティングは無く、
  `classifyPrompt` → ティア(light/standard/heavy)+ `chooseAutoModel`(コスト帯)で選ぶ。
  →「`standard` ティアを固定指定」へ修正。memory-layer 側は `light` ティア・最安帯。
- **R12(高)** agent-monitor.md: goal-loop の pause_reason 写像表が不完全。実在する
  `user` / `manual_send` / `unreadable_result` / `turn_timeout` / `unknown_delivery` /
  `boundary_lost` が表外だった(コードの `GOAL_LOOP_PAUSE_REASONS` と goal-loop.md 遷移表より)。
  →「上記以外の paused は needs-review に既定」の行を追加。
- **R17(高)** agent-monitor.md: 「`Retry`: needs-review/blocked の再開」が goal-loop では成立しない
  (`blocked` は終端、resume は `paused` のみ、goal-loop.md 遷移表#8/#10)。→ kind 別の再開可否を明記。
- **R13** agent-monitor.md: subagent検知の表現。`opencode-schema.d.ts` ではサブエージェントは
  `SubtaskPart`(`type:"subtask"`)で、`task` ツールは権限/イベント側。→「tool part」の断言を修正。
- **R14** memory-layer.md: MCP env 変数展開の「未検証」を上方修正。`install-mcp.mjs` が
  `{env:OPENCODE_WEBUI_BROWSER_BROKER}` を使い env 展開は**実績あり**。未検証はコマンド引数展開のみ。
- **R15** memory-layer.md: `provenance` enum に self-improvement が使う
  `auto-extract-retrospective` を追加(enum 不整合)。
- **R16** self-improvement-loop.md: goal-completed で memory-layer の自動抽出(approved=0)と
  retro(approved=1)が両方 memories に書く重複を明記し、完全一致 dedup で吸収する方針を追記。
- **R18** memory-layer.md: 表示前変換の参照が「`message-parts.ts` 相当」とあったが、同ファイルは
  画像パーツの描画グルーピング専用。→ PartView 描画経路に新規フックとして追加する旨に修正。

## 教訓

仕様書レビューは「コードへ照会」を加えることで質が上がる。特に
「既存モジュールを再利用」と書いた部分は、実際の API/型/enum を読んで
存在・呼び出し方を確認しないと、存在しない機能を前提にすることが多い。
今回検出はすべて実ファイル(goal-loop.ts・auto-model.ts・install-mcp.mjs・
opencode-schema.d.ts・goal-loop.md)を読んで確定した。

---

# 作業ログ: Hermes Agent 的機能の仕様書レビューと修正

## 日付

2026-08-06

## 目的

仕様書3本(`memory-layer.md` / `self-improvement-loop.md` / `agent-monitor.md`)を
既存コードと突き合わせてレビューし、指摘を仕様へ反映する。

## レビューで確定した事実(コード確認済み)

- `web/src/lib/db.ts` はバージョン管理ランナーを持たず、`CREATE TABLE IF NOT EXISTS` +
  guard付き `ALTER TABLE` で初期化する。FTS同期トリガは `DROP TRIGGER IF EXISTS` → `CREATE TRIGGER` で冪等化。
- `journal_mode = WAL` は既に設定済み(`db.ts:116`)だが `busy_timeout` は未設定。
- `web/src/lib/events.ts` は**ブラウザ専用**(`window.dispatchEvent`)。サーバー内イベントバスではない。
- 既存の workflow SSE(`api/tasks/[id]/workflow/events/route.ts`)は**1秒ポーリング + revision差分**。
  イベント駆動ではない。
- 本リポジトリに `.opencode/` ディレクトリは現存しない(グローバル設定が実体)。

## 修正内容

### memory-layer.md

- M1 注入がトランスクリプトに永続化される事実を明記し、UIは表示前変換で `<workspace-memory>` を除外する方式に変更。
- M2 MCPは `busy_timeout` + WAL を接続時に設定。DBパスは env `OPENCODE_WEBUI_DATA_DIR` で絶対指定。
- M3 FTS外部コンテンツ表(`content_rowid`)を廃止し、独立FTS5表+トリガ同期に変更。`id INTEGER PRIMARY KEY` + `public_id`。
- M4 `memory_add` のプロンプト汚染対策(監査・UI常時表示・出所表示)を追記。
- M5 「既存のマイグレーション機構」の誤記を実態(`CREATE TABLE IF NOT EXISTS` + guard付き ALTER)に修正。
- M6 60分idle検出は新規実装であることを明記(agent-monitor のエミッターを参照)。

### self-improvement-loop.md

- S1 適用ポリシーを確定: `memories` テーブルへの機械生成のみ自動反映(1日10件上限)、
  AGENTS.md / skills は必ず人間承認。
- S2 `MEMORY.md` は本機構から書き込まない(人間管理のまま)。機械生成の真実は `memories` テーブル。
- S3 実行は goal-loop の「メッセージ送信 + 構造化結果パース」を流用(独自状態機械を作らない)。
- S4 skill 配置は対象リポジトリの `.opencode/skills/`(無ければ新設)。グローバルには書かない。

### agent-monitor.md

- A1 goal-loop の `paused` を `pause_reason` ごとの写像表に確定(`transcript_unreadable` のみ blocked)。
- A2 SSE購読の記述を撤廃し、サーバー内イベントエミッター(`agent-events.ts` 新設)による駆動に変更。
  既存 workflow SSE がポーリング方式である事実を明記。
- A3 subagent 検知は tool part の `task` ツール開始/完了で判定(`opencode-schema.d.ts` 確認前提)。
- A4 Escalate 宛先フォールバック: 親セッション直送 → 改善Inbox。

## コミット

- `docs(specs): review 指摘を仕様書に反映(Hermes 的機能3本)`

---

# 作業ログ: Hermes Agent 的機能の仕様策定(メモリ層・自己改善ループ・エージェント監視)

## 日付

2026-08-06

## 目的

「このツールに Hermes Agent 的な機能を追加するなら」という依頼に対し、
候補5案(永続メモリ / 自己改善ループ / cron / メッセンジャーGW / マルチエージェント監視)から
1(メモリ層)・2(自己改善)・5(監視UI)を具体化し、仕様書として確定する。
実装は行わず設計のみ。

## 作成した仕様書

- `docs/specs/memory-layer.md` ... ワークスペース単位の永続記憶。
  SQLite `memories` + FTS5、MCPツール(memory_search 等)で公開、
  セッション完了時の自動抽出は承認制、承認済み記憶を冒頭メッセージに注入。
- `docs/specs/self-improvement-loop.md` ... `retrospective` エージェントが
  構造化JSON提案のみ作成。改善Inboxで人間承認。MEMORY.md追記のみ自動可、
  AGENTS.md/skills は必ず承認。却下理由を次回プロンプトに否定例注入。
- `docs/specs/agent-monitor.md` ... goal loop / workflowノード / サブエージェントを
  `agent_runs` テーブルに集約し、kanban UI(`/agents`)で監視。
  ストール判定は既存 hang-watchdog を再利用、操作は既存APIへの委譲のみ。

## 設計上の原則(他2案にも適用する方針)

- 新機能は host 側のNodeロジックとMCPプラグインに寄せ、OpenCode本体はフォークしない。
- 状態は自然言語パースで推論せず、DBの明示列で表現する(goal-loop.md 方針の踏襲)。
- 自動化は抽出まで。ファイル/設定への変更は人間承認を必須とする。
- すべての新規 `/api/**` は `api-guard.ts` の `requireAuthorized` を通す(coverageテスト対象)。

## 次のステップ(実装時)

1. メモリ層を先に実装(他2案の保存基盤になる)。
2. 実装順序は各仕様書の「実装順序」セクションに従う。
3. 着手前に隣接ファイルではなく `api-guard.ts` と coverage テストを確認する
   (CSRF ガード漏れの手戻り教訓を繰り返さない)。

---

# 作業ログ: プロファイル/同期系設定に「ファイルを開く」「フォルダを開く」を追加

## 日付

2026-08-06

## 目的

設定画面の複数セクションから、対応する設定ファイル/フォルダを直接エクスプローラーで
開けるようにする。ユーザー指定の対応表:

- 登録済プロファイル（`ProfilesSettings`） → フォルダを開く（既存機能）
- プロファイル同期（`ProfileSyncSettings`） → ファイルを開く（マスター/Codex/Claude）
- AGENTS.md同期（`ProfileAgentsSyncSettings` instructions） → ファイルを開く
- Skills 同期（`ProfileAgentsSyncSettings` skills） → フォルダを開く

## 実装内容

### 共通ヘルパー

- `web/src/lib/profiles/open.ts`（新規）
  - `openFolder(target)` / `openFileReveal(target)` を集約。
  - 既存の `[id]/open/route.ts` にインラインだったロジックをここへ移動し、
    `open-target/route.ts` と共有。

### API

- `web/src/app/api/profiles/[id]/open/route.ts`（既存、内部実装のみ変更）
  - `openFolder`/`openFileReveal` を `lib/profiles/open` からインポートするだけに簡略化。
- `web/src/app/api/profiles/open-target/route.ts`（新規）
  - `POST /api/profiles/open-target`、ボディ `{ target, action }`。
  - `target` は allowlist（`sync-master`/`sync-codex`/`sync-claude`/
    `agents-master`/`agents-claude`/`agents-codex`/`skills-opencode`/
    `skills-claude`/`skills-codex`/`skills-agents`）のキーのみ許可。
    クライアントは生パスを一切送れない — サーバー側で `profilePaths()`
    （`sync-engine.ts`）と `agentsSyncPaths()`（`agents-sync-engine.ts`）から
    解決する。
  - `agents-sync-engine.ts` のプライベート `paths()` を `agentsSyncPaths()` として export。

### UI

- `web/src/components/settings/ProfileSyncSettings.tsx`
  - マスター(opencode.jsonc)/Codex(config.toml)/Claude(settings.json) の各行に
    「ファイルを開く」ボタンを追加（`target` が存在する場合のみ表示）。
- `web/src/components/settings/ProfileAgentsSyncSettings.tsx`
  - マスター(AGENTS.md)/Claude(CLAUDE.md)/Codex(AGENTS.md) 行に「ファイルを開く」。
  - Skills マスター(opencode/skills)行と、mirrorsを side（claude/codex/agents）
    別にグループ化した見出し行に「フォルダを開く」を追加。
  - `mirrors` はこれまで `{side}:{name}` キーのフラットリストを1件ずつ表示していたが、
    フォルダを開くボタンを side 単位に置くため side でグループ化するレンダリングに変更
    （`SkillRow` → `SkillItemRow` に改名し、side の見出し表示は分離）。

### テスト

- `web/src/app/api/profiles/open-target/route.test.ts`（新規、7件）
  - 非ローカル拒否、不正な target/action 拒否、パス不存在時 409、
    ファイル/フォルダそれぞれの正常系、内部エラー時 500。

## 重大な手戻り: CSRF ガード漏れ

- 実装直後の `npm run test` で `api-guard-coverage.test.ts` が失敗した。
  このプロジェクトには「`/api/**` は `requireAuthorized`/`requireHostMachine`
  を呼ばない限りデフォルト拒否」という coverage テストがあり、
  過去に別作業で `rejectUnlessLocal`（CSRF 未対策の旧ヘルパー）から
  `requireAuthorized`（`api-guard.ts`、CSRF→認可の順で保護）への全面移行が
  行われていた。
- しかし本セッションの前半で作成した `[id]/open/route.ts`（前回コミット時点）と
  今回追加した `open-target/route.ts` は、移行前のパターンを見て `rejectUnlessLocal`
  を使ってしまっていた。両方を `requireAuthorized(req)` に修正。
- **教訓**: 新しい `/api/**` route を追加・変更する際は、既存の同ディレクトリの
  “隣”のファイルではなく `src/lib/api-guard.ts` と
  `src/lib/api-guard-coverage.test.ts` を必ず確認する。似た機能の既存ファイルが
  古いパターンを使ったまま残っている可能性があり、コピー元として信用できない。
  実装後は必ず `npm run test`（全体）を通し、coverage テストで検出させる。

## 検証

- `npm --prefix web run typecheck` 合格
- `npm --prefix web run lint` 合格
- `npm --prefix web run test` 合格（233 files / 2823 tests）
- `api-guard-coverage.test.ts` の3件の失敗（`/api/profiles/[id]/open` の
  guard漏れ検出）を修正後に再確認し、全合格。

# 作業ログ: Next.js 手動アップデート機能

## 日付

2026-08-06

## 目的

設定画面から Next.js の最新版を手動でアップデートできるようにする。
起動時には自動実行せず、ユーザーの明示的な操作でのみ `npm install next@latest` を実行する。

## 実装内容

### API

- `web/src/lib/npm-cli.ts`（新規）
  - npm の JS CLI エントリポイント `npm-cli.js` を解決する。
  - まず `npm_execpath`（Next.js サーバーを起動したのと同じ npm）を使用し、
    存在しなければ `where.exe npm.cmd` から候補を探す。
  - `node <npm-cli.js> ...` として npm を呼び出すことで、`npm.cmd` シムの
    shell quoting 問題を避ける。`host/src/index.js` の `spawnNpm` と同一方式。
- `web/src/app/api/updates/nextjs/route.ts`（新規）
  - `POST /api/updates/nextjs` で `node <npm-cli.js> install next@latest` を
    `web/` ディレクトリで実行する。
  - 常に `next@latest` を取得する（メジャーバージョン含む破壊的変更の可能性を
    受け入れる）。
  - 成功時は `web/node_modules/next/package.json` からインストールされた
    バージョンを返す。
  - `requireAuthorized(req)` で CSRF → 認可の順に保護する（既存 API ガード）。
- `web/src/app/api/updates/status/route.ts`
  - レスポンスに `nextjs` フィールドを追加。
  - `checkNextJs()` は `web/node_modules/next/package.json` の `version` を
    取得し、npm レジストリ `next@latest` と比較する。
  - `node_modules` が読めない場合は `web/package.json` の `dependencies.next` の
    宣言値をフォールバックとして current とする。

### UI

- `web/src/components/settings/SettingsView.tsx`
  - `UpdateTarget` に `"nextjs"` を追加。
  - `updateAvailability` の型に `nextjs` を追加。
  - `/api/updates/status` から取得した `nextjs.available` をアップデート通知に表示。
  - 「Next.js を更新」ボタンを追加（WebUI 更新ボタンの隣）。
  - 更新中/成功/失敗のメッセージ対応に `nextjs` を追加。

### テスト

- `web/src/lib/npm-cli.test.ts`（新規）
  - `npm_execpath` 優先 / `where.exe` フォールバック / 見つからない場合のエラー。
- `web/src/app/api/updates/nextjs/route.test.ts`（新規）
  - 正常系、npm install 失敗、npm-cli.js 解決失敗、非 loopback からの 403。
- `web/src/app/api/updates/status/route.test.ts`
  - Next.js 更新ありのケース。
  - `node_modules` 不可読時の `package.json` フォールバック。
  - バージョン決定不能時のエラー。
  - レジストリ取得失敗時のエラー。
- `web/src/lib/api-guard-coverage.test.ts` は自動的に新規 `/api/updates/nextjs` を
  カバレッジチェックする（`requireAuthorized` 呼び出しあり）。

## 注意点・設計判断

- **自動更新ではない**: 起動時の `pullLatestWebSource()`（git pull）には
  `npm install` を追加していない。Next.js の更新は設定画面からの手動操作のみ。
- **メジャーバージョンも対象**: `next@latest` をそのまま取得する。
  破壊的変更のリスクはユーザーが更新ボタンを押すことで受け入れたものとする。
- **反映には WebUI 再起動が必要**: `next install` 後も既に実行中の Next.js
  プロセスは旧バージョンのまま。更新成功メッセージに「WebUI の再起動が必要」と
  明記し、既存の WebUI 再起動ボタンを併用する。
- **ホスト側変更なし**: npm レジストリ経由の独立した更新なので、
  `host/src/index.js` や `scripts/start-webui.bat` の git/npm フローには影響しない。

## 検証結果

- `npm run --prefix web typecheck` ... 成功
- `npm run --prefix web lint` ... 成功
- `npm run --prefix web test` ... 232 test files, 2811 tests 成功

## 日付

2026-08-08(自動再開通知の自動消去)

## 依頼

「応答が10分止まったため自動的に停止し、同じ処理を再開しました」などの通知を30秒で消す。

## 実装内容

- `TaskView` の自動再開通知を表示から30秒後に自動消去するようにした。
- 再開回数単位の手動消去と、新しい自動再開時の再表示は維持した。
- 30秒経過前後の表示を `TaskView.test.tsx` で検証した。

## 検証結果

- `npm run test -- src/components/task/TaskView.test.tsx` ... 115 tests 成功
- `npm run typecheck` ... 成功

---

# 作業ログ: WebUI ユーザーログイン機能

## 日付

2026-08-06

## 目的

OpenCodeWebUI にユーザーログイン機能を追加し、設定画面からユーザー（追加・変更・削除）を管理できるようにする。
既存の「this endpoint is only available from the host machine」というローカルホスト限定のセマンティクスを維持する。

## 実装内容

### host 側（トレイホストのコントロールサーバー）

- `host/src/auth-store.js` を新規作成
  - `%APPDATA%\opencode-webui\users.json` への永続化
  - パスワードは sha256 + salt でハッシュ化
  - ユーザー一覧、検証、追加・更新、削除、存在確認を提供
- `host/src/control-server.js` に以下エンドポイントを追加
  - `GET /users` ... ユーザー一覧（パスワードハッシュ除く）
  - `POST /users` ... ユーザー追加・更新
  - `DELETE /users` ... ユーザー削除
  - `POST /auth/login` ... ログイン、セッションクッキー発行
  - `POST /auth/logout` ... ログアウト、クッキー破棄
- `host/src/index.js` に `authStore` と `sessionSecret` を `createControlServer` に接続

### web 側（Next.js BFF + UI）

- `web/src/lib/auth.ts` を新規作成
  - ブラウザ側から `/api/auth/*` を呼び出す認証 API
- `web/src/app/api/auth/login/route.ts`
- `web/src/app/api/auth/logout/route.ts`
- `web/src/app/api/auth/users/route.ts`
  - それぞれホストコントロールサーバーへの中継 API
- `web/src/components/auth/LoginGate.tsx` とテストを新規作成
  - 未ログイン時にログイン画面を表示
  - ユーザーが未作成の場合はゲートを表示しない（初期セットアップ）
- `web/src/app/(app)/layout.tsx` に `LoginGate` を組み込み
- `web/src/components/settings/SettingsView.tsx` に「ユーザー」タブを追加
  - ユーザー追加・変更・削除 UI
  - ユーザー未作成時の初期ユーザー作成 UI

## ログイン要求の判定ルール（127.0.0.1 は不要）

`GET /api/auth/session` がサーバ側で判定して `{ local, hasUsers, loginRequired }` を返す。
`loginRequired = !local && hasUsers`。

| アクセス元 | 認証手段なし | ユーザー登録済み or Windows認証ON |
| --- | --- | --- |
| 127.0.0.1 / localhost / ::1 | 不要 | **不要** |
| LAN / リモート | 不要 | 必要 |

`canAuthenticate = hasUsers || windowsAuth`、`loginRequired = !local && canAuthenticate`。

- `local` の判定は既存の `web/src/lib/local-request.ts:isLocalHostRequest` を再利用。
  Host ヘッダがループバックかつ、X-Forwarded-For が無いか直近ホップもループバックの場合のみ true。
  Caddy が Host をループバックに書き換えても、XFF が LAN アドレスなら false（ヘッダ偽装対策）。
- ホストに繋がらない場合は fail-closed（`hasUsers = true` 扱い）。ただし `local` なら通す。
- ユーザー未登録時にゲートを出さないのは、ユーザー管理自体がホスト限定のため、
  出すと初回起動で誰も突破できずロックアウトするから。
- `/api/auth/users` は `rejectUnlessLocal` でホスト限定。
  これが無いと LAN クライアントが無認証で自分のアカウントを作成でき、ゲートが無意味になる。

## Windows アカウントでのログイン

既定は**無効**。設定 → ユーザー のトグル（`/api/auth/config`、ホスト限定）で opt-in。
有効時、`POST /auth/login` は `users.json` を先に試し、外れた場合のみ Windows へフォールバックする。

### 実装方式: Win32 `LogonUser`（`scripts/validate-windows-credentials.ps1`）

`System.DirectoryServices.AccountManagement.ValidateCredentials` を最初に試したが、
このPCで実測したところ**存在しないローカルアカウントの否定に 14.4 秒**かかった
（内訳: `Add-Type` 9ms / コンテキスト生成 7ms / `ValidateCredentials` 14,437ms）。
`LogonUser` に変更して**約 0.5 秒**になった（`Add-Type` 158ms / `LogonUser` 15ms）。

- `LOGON32_LOGON_NETWORK` を使用。`1385 ERROR_LOGON_TYPE_NOT_GRANTED` の場合のみ
  `LOGON32_LOGON_INTERACTIVE` で再試行する（ネットワークログオンを拒否された正規ユーザー救済）。
- 資格情報エラー（1326/1327/1330/1331/1793/1907/1909）は `INVALID`、
  それ以外のコードは `ERROR:` としてホストログに出す。無効・ロック・期限切れは
  `LogonUser` が個別のコードを返すので AccountManagement は不要。
- **パスワードは argv に載せない**。`-File` でスクリプトを渡し、stdin の
  1行目=ユーザー名 / 2行目=パスワードで送る。argv は `wmic process get commandline`
  等でローカルの他ユーザーから読めるため。
- stdin/stdout は UTF-8 を明示（コンソールのコードページに依存させない）。
- ユーザー名・パスワードに改行/制御文字が含まれる場合は spawn 前に拒否する
  （stdin の行フレーミングを崩して認証を偽装されるのを防ぐ）。
- `powershell.exe`（5.1）を明示。`pwsh` では対象アセンブリ/挙動が異なる。
- 非 Windows・スクリプト不在・タイムアウト・PowerShell 異常は**すべて false**。
  検証できない状態をログイン成功と取り違えない。

### スロットリング

`createLoginThrottle`（既定 5 回 / 5 分、ユーザー名ごと）。
**Windows は失敗のたびに OS のアカウントロックアウトカウンタを進めるため**、
無制限だと LAN の端末から管理者を自分のPCから締め出せてしまう。
制限超過は `429` + `Retry-After` を返し、Windows へは問い合わせない。

## host-only API のリモート開放（ログイン済みなら変更可能に）

### 発覚した問題: ログインゲートが飾りだった

`verifySessionToken` / `getSessionCookie` / `setAuthCookie` は**定義のみでどこからも呼ばれておらず**、
`LoginGate` が localStorage を見て UI を隠すだけだった。API は一切保護されておらず、
LAN から `curl` で素通りできた。この状態で host-only ガードを「ログイン済みなら通す」にすると
検証されない Cookie を根拠にすることになり、逆に穴を開けることになる。
そのため先にセッション検証を実装した。

### 仕組み

1. host に `POST /auth/verify` を追設。BFF は `webui_session` cookie の token を
   転送し、host が HMAC 署名を検証して `{ ok, username }` を返す。
   署名 secret（`CONTROL_SECRET`）は host プロセスだけが持つため BFF 単独では検証できない。
2. `web/src/lib/session.ts` の `verifySession(req)` がこれを呼ぶ。
   cookie 無し・署名不正・期限切れ・host 到達不可はすべて null（fail closed）。
3. `rejectUnlessLocalOrAuthenticated`（loopback **または**検証済みセッション）を
   host-only ルート 29 ファイルに適用。

検証済みセッションは loopback 判定より**強い**根拠である。
`Host` / `X-Forwarded-For` は LAN の第三者が偽装できるが、token は HMAC 署名されている。

### 追記: `/api/browse/folder` も認証済みに開放（LAN IP 経由のホストPC対応）

ホストPC上のブラウザで `http://192.168.0.102:3000` を開くと `Host` が loopback で
ないため 403 になっていたが、ダイアログはホストの画面に出るので実際には使える。
`rejectUnlessLocalOrAuthenticated` に変更した。

判定について: `Host` ヘッダではスマホとホストPCを区別できない。堅牢な方法は
「ブラウザが `127.0.0.1:18765` に到達できるか」を検証すること（到達性の証明）だが、
control server への CORS 追加が必要で、その前提として後述の DNS リバインディング
対策が必要になる。**ユーザー判断により簡易版（クライアント検証なし）を採用**した。

そのため「ログイン済みなら誰でもホストPCの画面にダイアログを開ける」。緩和策:

- 非 loopback 呼び出しは待ち時間を 290 秒 → **60 秒**に短縮し、
  `504` + `reason=dialog_unattended` を返す（遠隔クライアントが worker を長時間占有しない）
- ダイアログの同時起動を防ぐ in-flight ロック。2 個目は `409` + `reason=picker_busy`
- クライアントは 409/504 を一覧フォールバック付きの通知として表示する

### 旧方針（参考）: `/api/browse/folder` を loopback 限定にしていた理由

ネイティブダイアログはホストPCのデスクトップに表示され、人間のクリックを待つ。
本当に遠隔のクライアント（スマホ等）からは見えないため、
`/api/browse/dirs` によるブラウザ内一覧＋手入力にフォールバックする。

### LoginGate をサーバー権威に変更

`/api/auth/session` が `authenticated` / `username` を返すようにし、
LoginGate は localStorage ではなくこれを見る。
`CONTROL_SECRET` は**host 起動ごとに再生成**されるため、host 再起動後は
cookie が無効になる。localStorage を信じていると「画面は出るが全 API が 403」に
なるので、サーバー判定に統一した。

### 併せて修正したトークンのバグ

- `payload.indexOf(':')` → `lastIndexOf(':')`。
  ユーザー名にコロンが含まれると ts のパースが壊れていた（fail closed なので無害だが不正確）。
- 未来日時のトークンを拒否（60 秒の skew 許容）。偽造 ts でセッション期限を伸ばせないようにする。

## 検証結果

- `npm run --prefix web typecheck` ... 成功
- `npm run --prefix web lint` ... 成功
- `npm run --prefix web test` ... 228 test files, 2774 tests 成功
- `npm run --prefix host test` ... 299 tests 成功

実機確認済み（`scripts/validate-windows-credentials.ps1`）:

- 存在しないアカウント + 誤パスワード → `INVALID` / 約 0.45 秒
- 実在アカウント（`Daichi` @ `X870`）+ 誤パスワード → `INVALID` / 0.51 秒、`ERROR:` なし
- `VALID` の経路のみ未確認（実パスワードが必要なためユーザー側で確認）

## コミット

- `8005654` feat(auth): WebUIにユーザーログインとユーザー管理を追加
- `a218884` feat(auth): 127.0.0.1 からのアクセス時はログインを不要にする
- `4d9b8af` feat(auth): Windows アカウントのユーザー名/パスワードでログインできるようにする
- `b7825ab` feat(auth): ログイン済みならリモートからも host-only 設定を変更できるようにする
- `34d1874` feat(browse): LAN IP 経由でもネイティブフォルダ選択を使えるようにする
- `1559245` docs: セキュリティ棚卸しと修正計画を追加
- `ad953f8` fix(security): API を default-deny 化し CSRF 対策を追加（Phase 1/2）
- `3aa757f` fix(security): control server に Host ヘッダ検証を追加（Phase 3）

## 次のステップ

- 起動中の WebUI とトレイホストを再起動し、新しい認証エンドポイントが有効になることを確認する。
  再起動しないと `/api/auth/*` は 404 のままになる。
- 本番ビルドは `AGENTS.md` の禁止事項によりエージェント側では行わない。ユーザーが明示的に実行する。
- 実機確認の観点:
  1. `http://127.0.0.1:3000` … ログイン画面が出ずそのまま使える
  2. 設定 → ユーザー でユーザーを作成
  3. LAN URL（`http://192.168.x.x:3000`）… ログイン画面が出る
  4. LAN から設定 → ユーザー … 403 になる（ホスト限定のため意図通り）

## 脆弱性修正: Phase 1/2 完了（`ad953f8`）

計画と進捗は `docs/specs/security-remediation-plan.md`。

### 修正前に判明していた状態

**P0-1**: API ルート 97 本のうち **66 本が無認証**。
`/api/opencode/[...path]`（全メソッド）と `/api/tasks` を含むため、
LAN 上の任意端末が認証なしにエージェントを起動でき、**実質的に無認証 RCE**。
`deploy/Caddyfile` の Basic Auth もコメントアウトで外側ゲート無し。
ログイン UI は LAN でログインを要求するため保護されていると誤認しやすかったが、
ゲートは UI のみで API は保護していなかった。

**P0-2**: `Origin` を検証するルートが 0 件。`isLocalHostRequest` は資格情報を
要求しないため、ホストPCで悪意あるページを開くと `http://127.0.0.1:3000/api/...` へ
`text/plain` で POST でき（preflight 回避）、全状態変更 API を叩けた。

### 修正内容

`web/src/lib/api-guard.ts` の `requireAuthorized` が **CSRF → 認可** の順に判定する。

1. `rejectCrossSite`: 状態変更メソッドで `Origin` の allowlist 一致を要求。
   `Sec-Fetch-Site: cross-site` も拒否。同一ホストの別ポートは許可（Caddy 経由）。
   `Origin` 欠落は非ブラウザ client とみなし通す（ブラウザは必ず付けるため）。
   `Origin: null` は拒否。**loopback でも必ずこの判定を通す**のが要点。
2. 認可: loopback または host が検証したセッション。

公開は `PUBLIC_API_ROUTES` の 4 本のみ（`/api/health`、`/api/auth/{session,login,logout}`）。
`/api/health` を公開に残したのは、トレイホストの supervisor と Caddy が
死活監視に使うため。

`web/src/lib/api-guard-coverage.test.ts` が全ルートを走査し、
ガードの無いルート・旧 `rejectUnlessLocal*` の残存・opencode プロキシの
ガード位置（`context.params` より前）を検証する。**再発するとテストが落ちる。**

### 実装上の注意点

- `req` 引数を持たないハンドラが 19 個あり、引数を追加した。
- `/api/addons/codexbar/*` は `@addons/codexbar/api/*` の**再エクスポート**で、
  実装は `web/src` 外にある。走査テストは再エクスポート先も読む。
- テスト側は `Host` ヘッダを付けないと 403 になる（33 ファイルが該当した）。
  **本番の fail-closed を維持するため、Host 欠落時に URL へフォールバックしない。**
  `0.0.0.0` バインド時、Host を省いた生の HTTP リクエストで Next が `localhost` を
  補完し loopback 扱いになる回避経路が生まれるため。

## 未修理の脆弱性: host control server の DNS リバインディング（P1-1）— 修正済み（`3aa757f`）

`isLoopbackHostHeader(host, port)` で `Host` が loopback かつ待受ポートと一致するかを
ルート照合より先に検証する。`evil.test` が `127.0.0.1` に解決されても
`Host: evil.test:18765` になるため 403 で弾かれる。

**未対応。ユーザー判断により今回は修正を見送った。**

`host/src/control-server.js` は `Host` / `Origin` を一切検証していない
（`req.headers` の参照は cookie のみ）。`127.0.0.1:18765` で待ち受けているため、
攻撃者が自ドメインを `127.0.0.1` に DNS リバインドすると、ブラウザから見て
**same-origin** になり CORS では防げない。ユーザーが悪意あるページを開いている間に:

- `POST /users` で任意アカウント作成 → WebUI に外部からログイン可能（完全侵害）
- `GET /users` でユーザー名列挙、`POST /auth/config` で Windows 認証を有効化
- `POST /restart/all` でホスト妨害

修正方法: control server で `Host` ヘッダを allowlist 検証する
（`127.0.0.1:<port>` / `localhost:<port>` のみ許可）。数行で塞げる。
ローカル証明（到達性検証）を実装する場合はこの修正が前提になる。

## 既知の未対応・制約

- ログアウトはサーバー側でトークンを失効させない（ステートレス HMAC）。
  cookie を消すだけなので、token を抜き取られていれば 7 日間有効。
  実質的な失効手段は host 再起動（`CONTROL_SECRET` 再生成）のみ。
- ログイン済みリモート主体は `/api/auth/users` と `/api/auth/config` も操作できる。
  つまり WebUI ユーザーが Windows 認証を有効化したり他ユーザーを削除できる。
  権限モデル（`remote-authz.md` の `project:read` 等）は未実装で、認可は
  「loopback または検証済みセッション」の 2 値のみ。
- CSRF 対策は未実装。`remote-authz.md` が要求する token 二重送信・Origin 検証は入っていない。
  session cookie は `SameSite=Strict` なので基本的なクロスサイト送信は防げるが、
  仕様が求める水準には達していない。
- 監査ログ未実装。
- `users.json` / `auth-config.json` は `mode: 0o600` で書いているが、
  **Windows では POSIX パーミッションは効かない**（Node は 0666 を報告する）。
  同一PCの別ユーザーからパスワードハッシュを読める。ACL 設定は未実装。
- Windows 認証の `VALID` 経路は実パスワードが必要なため未検証。
- `LogonUser` を1回呼ぶたびに Windows の失敗カウンタが進む。
  WebUI 側は 5 回で止めるが、OS 側のロックアウト閾値が 5 未満だと
  WebUI のスロットリングより先に OS がロックする。

---

# 作業ログ: 右メニューに Markdown ビューワーを追加

## 日付

2026-08-06

## 目的

TaskView の右サイドパネルに「Markdown ビューワー」を追加し、エージェントが提出した
`.md` ファイル（計画書やレポート）を一覧から選んで閲覧できるようにする。

## 実装内容

### `web/src/lib/side-panel-state.ts`

- `SidePanelKind` に `"markdown"` を追加
- `readSidePanel()` の復元対象に `markdown` を追加

### `web/src/components/task/MarkdownViewerPanel.tsx`

- セッションメッセージから assistant 発の `.md` ファイルパスと inline Markdown text part を抽出する
  `collectMarkdownEntries()` をエクスポート
  - `part.type === "file"` の `filename` と `part.type === "text"` の本文が
    絶対パス形式の `.md` ならファイル候補とする（`extractPlanMarkdownPath` の緩和版）
  - 画像添付（`isImageFilePart`）は除外
  - 重複パスは初出順で 1 件だけ表示
  - 単なる `.md` パスではなく、見出し・リスト・強調・リンク・コードなど Markdown 構文を含む
    assistant text part を「メッセージ Markdown」として一覧追加
- entry の `kind` を `"file" | "text"` に分離
  - file: 既存の `/api/files/content` で取得し、`Markdown` コンポーネントで描画
  - text: API 呼び出しなしで直接 `Markdown` コンポーネントに本文を渡す
- 左リスト＋右本文の 2 ペイン構成（md 未満では縦積み）
- ファイルとテキストでアイコンを分けて表示（`FileText` / `MessageSquare`）
- 読み込み中 / エラー / 再試行 UI を備える
- 空状態メッセージ: 「エージェントが提出した Markdown ファイルはありません」

### `web/src/components/task/TaskView.tsx`

- `FileText` アイコンと `MarkdownViewerPanel` をインポート
- ヘッダーツールバーに Markdown ビューワーボタンを追加（`isLg` のみ表示）
- ヘッダーのケバブメニュー「パネル切替」に `panel-markdown` を追加
- `sidePanel === "markdown"` のとき `MarkdownViewerPanel` をレンダリング
  - `directory={task.directory}` / `messages={stream.visibleMessages}` を渡す

### `web/src/components/task/MarkdownViewerPanel.test.tsx`

- `collectMarkdownEntries` の抽出・重複排除・画像除外
- ファイルエントリ・メッセージ Markdown エントリの両方をカバー
- パネルの空状態・自動選択・内容描画・切替・エラー時再試行
- inline text part は `/api/files/content` を呼ばないことを検証
- 計 12 テスト

## 設計上のメモ

- `/api/files/content` はプロジェクトディレクトリ配下の `.md` のみ許可する
  （`assertAllowedDirectory` + 拡張子チェック済み）。プロジェクト外パスは 403。
- plan エージェント以外の提出も拾うため `extractPlanMarkdownPath` ではなく
  専用の `partMarkdownPath` を定義（`agent="plan"` / `completed` ゲートなし）。
- 画像添付ファイルはインラインプレビューが別途あるため除外。
- テキストエントリは Markdown 構文を含むもののみ対象。プレーンな短文は一覧に出さない。

## 検証結果

- `npx tsc --noEmit` ... 変更ファイルにエラーなし
  （無関係な既存テストファイルの構文エラーのみ存在）
- `npx eslint` ... 成功
- `npx vitest run src/components/task/MarkdownViewerPanel.test.tsx` ... 12 passed
- `npx vitest run src/components/task/TaskView.test.tsx` ... 113 passed
- `npx vitest run src/components/task/PlanDocumentCard.test.tsx` ... 3 passed

---

# 作業ログ: 脆弱性修正 Phase 4（セッション失効・role による権限分離）

## 日付

2026-08-06

## 目的

`docs/specs/security-remediation-plan.md` の Phase 4（P1-2 セッション失効 / P2-1 権限モデル）を実施する。

## 背景

- **P1-2**: session token は 7 日間有効なステートレス HMAC。ログアウトは cookie を
  消すだけで、token 自体は取得済みの攻撃者にとって期限まで有効なままだった。
- **P2-1**: 認証済みなら誰でも `/users` の作成・削除、`/auth/config`
  （Windows 認証の有効化）を操作できた。権限の区別が無かった。

## 実装内容

### host 側

- `host/src/control-server.js`
  - `signSessionToken` / `verifySessionToken` のペイロードを
    `username:jti:ts` に変更。jti にランダム 8byte を使い、
    username・jti にコロンを含んでいても `lastIndexOf` の二段分割で正しく復元する。
  - `createRevocationStore({ persist })` を新設・export。
    `jti -> revokedAt` の `Map` をメモリに保持し、
    `%APPDATA%\opencode-webui\revoked-sessions.json` に永続化する。
    **`Set` ではなく `Map` にした理由**: 新しい失効を書き込むたびに
    全エントリのタイムスタンプが書き込み時刻で上書きされると、
    古いエントリが二度と期限切れにならず prune されないバグになるため、
    エントリごとに個別のタイムスタンプを保持する。
  - `POST /auth/logout` が cookie の token から jti を復元し失効させる。
  - `POST /auth/verify` は失効済み jti を 401 で拒否し、
    `{ ok, username, jti, isAdmin }` を返す。
  - `Host` ヘッダ検証の直後に走る認可チェックとして、
    `resolveSession(req)` ヘルパーを追加。`/users`（POST/DELETE）と
    `/auth/config`（POST）は `authStore.isAdmin(username) === true` を要求し、
    満たさない場合は 403。`GET` は変更なし（引き続き無認証で一覧取得可）。
- `host/src/auth-store.js`
  - `UserRecord` に `role: 'admin' | 'user'` を追加。
  - 既存ユーザー・`role` 欠落・未知の値はすべて `admin` にフォールバック
    （さもないと移行直後に誰も管理操作できなくなる）。
  - `isAdmin(username)` を追加。`upsertUser` はパスワード変更時に既存の
    `role` を保持し、新規作成時は `admin` にする。
- `host/src/index.js`: `authStore.isAdmin` を接続。

### web 側

- **見つけた不整合**: `web/src/app/api/auth/users/route.ts` と
  `web/src/app/api/auth/config/route.ts` の `forwardToHost` は
  host へブラウザの `Cookie` ヘッダを転送していなかった。
  admin チェック追加後は、この2ルートの POST/DELETE が
  常に 403 になる状態だったため、`forwardToHost` に `req` を渡し
  `Cookie` ヘッダを転送するよう修正した。
- `web/src/lib/auth.ts`: `AuthUser` 型に `role` を追加。
- `web/src/components/settings/SettingsView.tsx`: ユーザー一覧に
  「管理者」「一般」バッジを追加。

## 検証結果

- `npm run --prefix host test` ... 319 tests 成功（+21）
- `npm run --prefix web typecheck` / `lint` ... エラーなし
- `npm run --prefix web test` ... 228 test files, 2780 tests 成功

## コミット

- `f85bac3` fix(security): セッション失効と role による権限分離を追加（Phase 4）

## 次のステップ

- **Phase 5**: 完了（下記）。
- ログアウトの失効は jti 単位。同一ユーザーの他デバイスのセッションは
  ログアウトしても失効しない仕様（意図的、他デバイスの誤爆防止）。
  全デバイス強制ログアウトが必要になった場合は別途 API を追加する。

---

# 作業ログ: 脆弱性修正 Phase 5（ファイル権限・監査ログ・IP スロットリング）

## 日付

2026-08-06

## 目的

`docs/specs/security-remediation-plan.md` の Phase 5（P2-2 ファイル権限 /
P2-3 監査ログ / P2-4 IP スロットリング）を実施し、修正計画を完了させる。

## 実装内容

### P2-2 ファイル権限（`host/src/secure-file.js` 新規）

`fs.writeFileSync(..., { mode: 0o600 })` は Windows では**無効**。NTFS に POSIX
モードビットが無く、Node は 0666 を返し、実際の権限は親ディレクトリからの継承で決まる。

**実測して分かったこと**: このマシンの `%APPDATA%` は `CodexSandboxUsers` を含む
複数グループに継承で `(M)` を与えていた。最初 `icacls /remove:g` で広いグループだけを
削除する実装にしたが、**`/remove` は継承 ACE を削除できない**。その結果、
保護したはずのファイルと未保護のファイルの ACL が完全に一致した（＝無意味だった）。
検証スクリプトで両者を比較して初めて気づいた。

そのため `/inheritance:r` で継承を切り、以下を明示付与する方式に変更した。

- 所有者 `(R,W,D)` — **`D` が必須**。付けないと親ディレクトリ削除が EPERM になり、
  テストのクリーンアップもアンインストールも壊れる（実際に踏んだ）
- `SYSTEM` `(F)` / `BUILTIN\Administrators` `(F)` — 継承を切ると消えるので再付与。
  well-known SID（`*S-1-5-18` / `*S-1-5-32-544`）を使い OS の表示言語に依存させない

適用: `users.json` / `auth-config.json` / `revoked-sessions.json` / `audit.log`。
実機で ACL が 3 エントリのみになり、ディレクトリ削除も成功することを確認済み。

### P2-3 監査ログ（`host/src/audit-log.js` 新規）

`%APPDATA%\opencode-webui\audit.log` に JSON Lines で追記。

- **`log-buffer.js` は使わなかった**。あれは負荷時に古い行を追い出すリングバッファで、
  「誰がログインしたか」の記録には不適切（Caddy のエラー洪水で消える）
- 記録: `login.success` / `login.failure` / `login.throttled` / `logout` /
  `user.create` / `user.update` / `user.delete` / `authconfig.update` / `authz.denied`
- **既知フィールドのみ直列化**するので、呼び出し側が誤って password や token を
  渡しても記録されない（テストで担保）
- ユーザー名は攻撃者が制御できるため改行・タブを潰し、1 イベント 1 行を保証
  （偽の監査行を注入させない）
- 2MB × 5 世代でローテーション

### P2-4 IP スロットリング

- `createLoginThrottle` に永続ストア（`createThrottleStore`）を追加。
  ホスト再起動でカウンタが消えると、再起動を待つだけで budget がリセットされる
- 送信元 IP 用の第2リミッタ（20 回 / 5 分）。ユーザー名ごとの制限だけでは
  アカウントを順に試して回避できる。IP の budget を大きめにしたのは
  1 アドレスに複数の正規ユーザーがいる構成（共用 PC、NAT）があるため
- IP は BFF が `x-ocw-client-ip` で転送（control plane は loopback しか見えない）。
  **認可には使わない** — ローカルプロセスが詐称できるため
- `X-Forwarded-For` は**最右**（自前 Caddy が付与した値）を採用。
  最左はクライアントが詐称でき、毎回別 IP を名乗れば制限を素通りできる
- ログイン成功時に IP カウンタは**リセットしない**。1 つでも有効な資格情報を持つ
  攻撃者が制限を回避できてしまうため

### テストの副作用を修正

`control-server.test.js` が `auditLog` を渡していなかったため、テスト実行のたびに
開発機の実 `audit.log` に 49 行書き込まれていた。`noopHandlers` に
インメモリの監査ログを追加して封じた（汚染されたファイルは削除済み）。

### テストで見つけたバグ

`clientIpFromRequest` の IPv6 パースで、ポート除去の判定条件が誤っており
`2001:db8::1` が `2001:db8:` に切り詰められていた。コロン数で判定する方式に修正。

## 検証結果

- `npm run --prefix host test` ... 361 tests 成功（+42）
- `npm run --prefix web typecheck` / `lint` ... エラーなし
- `npm run --prefix web test` ... 230 test files, 2800 tests 成功
- 実機確認: `users.json` / `audit.log` の ACL が
  `BUILTIN\Administrators:(F)` / `NT AUTHORITY\SYSTEM:(F)` / `X870\Daichi:(R,W,D)`
  の 3 エントリのみ、監査行の内容も正しく、ディレクトリ削除も成功

## コミット

- `f55c0d6` fix(security): ファイル権限・監査ログ・IP スロットリングを追加（Phase 5）

## 未対応の制約

- **IP を判定できない構成がある**: `OPENCODE_WEBUI_HOST=0.0.0.0` で Caddy を挟まず
  直接 LAN に bind すると `X-Forwarded-For` が無く、Next.js は socket peer を
  公開しないため IP は `null`。この場合 per-IP 制限は効かない（per-username は効く）。
  `null` を1バケットに束ねると未プロキシのクライアント全員が相互にロックし合うため、
  意図的に除外している。
- 監査ログの閲覧 UI は無い（ファイルを直接読む）。
- `remote-authz.md` の JWT / 権限モデル（`project:read` 等）は未実装。
  現行の認可は「loopback または検証済みセッション」＋「admin か否か」の 2 段階のみ。

---

# 作業ログ: モデルドロップダウンに Qwen Cloud が表示されない問題の調査と修正

## 日付

2026-08-06

## 目的

WebUI のモデルドロップダウンに Qwen Cloud（qwen-cloud プロバイダ）が表示されない原因を特定し修正する。

## 調査結果

- ドロップダウンのデータソースは `/api/opencode/provider` の `all` + `connected` と
  `/api/extensions/provider-models`（HomeView.tsx）。
- アクティブだった `test` プロファイルの `opencode.jsonc` には qwen-cloud
  （npm: `@ai-sdk/openai-compatible`）が定義済みなのに、OpenCode ランタイムの
  `/config` はプロバイダ `[cursor, commandcode]` のみ返却。qwen-cloud は
  サイレントにドロップされていた（エラーログなし）。
- `default` プロファイル（node_modules なし）では qwen-cloud が正常ロードされていた。

## 根本原因

`test` プロファイル（`%APPDATA%\opencode-webui\profiles\test`）の node_modules に
`@ai-sdk/openai-compatible` が無かった（`@ai-sdk/provider` のみ存在）。
ローカル node_modules が存在すると OpenCode がそちらで SDK を解決しようとし、
パッケージ欠落のためプロバイダ定義ごと除外していた。node_modules が無い
`default` プロファイルでは OpenCode 同梱 SDK に解決がフォールバックするため動いていた。

## 対応

- test プロファイルで `npm install @ai-sdk/openai-compatible@3.0.0` を実行
  （OpenCode グローバル install に同梱される 3.0.0 と一致）。
- `@ai-sdk/provider` は 4.0.0 に hoist され、`@opencode-ai/plugin` は nested に
  provider@3.0.8 を保持（バージョン競合なし）。
- OpenCode を再起動（`POST /api/host/restart?target=opencode`）。

## 検証結果

- `/api/opencode/provider` ... qwen-cloud が `all` と `connected` に存在
- `/api/opencode/config` ... プロバイダキー `[cursor, qwen-cloud, commandcode]`
- `/api/extensions/provider-models` ... qwen-cloud enabled。
  qwen3.8-max-preview / qwen3.7-plus / qwen3.6-flash が on
  （glm-5.2 / deepseek-v4-pro はユーザー設定で off のまま）
- リポジトリのコード変更なし（git status clean）


---

# 実装ログ: メモリ層 MCP フェーズ（memory-mcp）

## 日付
2026-08-07

## 概要
memory-layer 実装のフェーズ3（MCP サーバー）を完了。メモリ FTS 検索系を opencode のエージェントに stdio MCP 経由で公開する。

## 実装内容
- `browser-bridge/shared/memory-schema.mjs`: kinds/provenances/max chars + `toFtsPhrase` + `memoryValidate`（search/add/update/delete。未知KEY拒否、INVALID_REQUEST code）
- `browser-bridge/mcp/memory-server.mjs`: `createMemoryMcpServer({dbPath,workspaceId})`。better-sqlite3、busy_timeout=5000、WAL、fileMustExist。4ツール登録: `memory_search`（FTS5 + approved のみ + last_used_at/use_top バンプ）/ `memory_add`（agent, approved=1）/ `memory_update`（存在しない→NOT_FOUND）/ `memory_delete`
  - `resolveWorkspace`（--workspace=<id> / --workspace <id>、env OPENCODE_WEBUI_MEMORY_WORKSPACE フォールバック）、`resolveDataDir`（OPENCODE_WEBUI_DATA_DIR で上書き、既定は OS 別データディレクトリ）
- `browser-bridge/scripts/install-memory-mcp.mjs`: インストーラ。--workspace 必須（--uninstall は不要）。buildDesiredEntry（局部 server / 絶対 server path + --workspace + env OPENCODE_WEBUI_MEMORY_WORKSPACE）、atomicWrite（temp+rename）。exit 0/1/2
- テスト: `browser-bridge/test/memory-mcp-stdio.test.mjs`（3件）、`install-memory-mcp.test.mjs`（7件）

## 検証結果
- browser-bridge `node --test` 全体 87 tests／87 pass
- web の tsc --noEmit エラーなし（web 側コード変更なし）

## 備考
- FTS5 はハイフンでトークン分割されるため multi-stage はヒットしない。テストでは Dockerfile 等の clean word を使用


---

# 実装ログ: メモリ層 注入フェーズ

## 日付
2026-08-07

## 概要
memory-layer のフェーズ4（自動抽出の goal-completed トリガーは既完了）のうち、「注入」を実装。最初の goal ターンに承認済みメモリの <workspace-memory> ブロックを先頭に付与し、UI 描画でそのブロックを除外する。

## 実装内容
- \`web/src/lib/memory.ts\`:
  - \`memoryInjectionFor\` を、injected 各行の use_count を+1（last_used_at 更新）する挙動に変更（仕様「注入された行の use_count を+1」）
  - \`stripMemoryInjectionBlock(text)\`: 先頭の \`<workspace-memory>…</workspace-memory>\` ブロックを描画時除去
- \`web/src/lib/goal-loop.ts\`:
  - \`buildGoalPromptWithMemory(loop,turnNumber,maxTurns)\`: turnNumber===1（最初のターン）のみ \`memoryInjectionFor\` を prefix、それ以外は素のプロンプト
  - processLoop の goal プロンプト送信でこれを使用。seams に \`buildGoalPromptWithMemory\` を追加
- \`web/src/components/task/PartView.tsx\`: user ロールの text part 描画時に \`stripMemoryInjectionBlock\` を適用（内部コンテキストを表示しない）

## 検証結果
- \`web\` vitest 全体 240 files / 2866 tests 全パス
- \`tsc --noEmit\` / eslint clean
- goal-loop.integration.test.ts の in-memory fixture に memories テーブル/FTS/トリガを追加（注入が読むため）

## 備考
- 注入は scheduling/prompt の過程で実行されるため、goal-loop.integration の fake DB に memories テーブルが必要になった
- UI 除外分の単体テスト: PartView.test.tsx に「ユーザーメッセージの先頭ブロックが消える / メモリのみの場合空 / ブロックなしは維持」を追加
---

# 実装ログ: メモリ層 UI フェーズ(5)

## 日付
2026-08-07

## 概要
memory-layer のフェーズ5(UI 管理画面)を実装。設定ビューに「メモリ」タブを追加し、承認済み/候補の一覧・個別/一括承認・却下(削除)・インライン編集・「今すぐ抽出」を提供。

## 実装内容
- `web/src/components/settings/MemorySettings.tsx`(新規):
  - ワークスペース選択(GET /api/workspaces)→ セッション選択(GET /api/workspaces/:id/sessions)
  - 承認済み/候補タブ切替、一括承認・個別承認(POST /api/memory/:id/approve)
  - 編集をインラインテキストエリア+種別ドロップダウンで保存(PATCH /api/memory/:id)、削除(DELETE /api/memory/:id)
  - 「今すぐ抽出」(POST /api/memory/extract)で抽出した件数を表示
- `web/src/components/settings/SettingsView.tsx`: SettingsTab に `memory` 追加、tabs 配列に「メモリ」、render 分岐 `{activeTab === "memory" && <MemorySettings />}`
- テスト `MemorySettings.test.tsx`(3件): タブ一覧表示・編集 PATCH・抽出 POST

## 検証結果
- web vitest 全体 241 files / 2869 tests 全パス(前回 2866 → +3)
- tsc --noEmit / eslint clean(SettingsView の既存テスト 29件もパス)

## 備考
- 既定で最初のワークスペースを自動選択し、そのセッション列をロード
- 抽出は選択セッションを指定。テストは waitFor でボタン活性化を確認してから click する---

# 実装ログ: メモリ層 idle トリガー(フェーズ6)

## 日付
2026-08-07

## 概要
memory-layer のフェーズ6(idle トリガー)を実装。goal-loop `completed` に加えて、セッションが60分間 idle になったことを検出して自動抽出する。

## 実装方針(ユーザー確認済み)
- 仕様は「agent-monitor のイベントエミッター依存」と記載されていたが、それは未実装。
  → 既存シグナル(session_bindings.updated_at)で判定する方式に変更(ユーザー承認)。
- 重複防止は「同一(ワークスペース, セッション)は1回/生存期間」のレジャー方式(ユーザー承認)。

## 実装内容
- `web/src/lib/db.ts`:
  - `memory_idle_extracts` テーブル追加(workspace_id, session_id, extracted_at / PK 2列 / FK CASCADE)
  - `markIdleExtracted` / `isIdleExtracted` / `listIdleExtracts` ヘルパー追加
- `web/src/lib/memory-idle.ts`(新規):
  - `IDLE_THRESHOLD_MS` = 60分
  - `idleSessionsSince(nowMs, thresholdMs)`: session_bindings.updated_at が閾値より古い行を列挙
  - `sweepIdleExtractions()`: 閾値超過かつ未レジャーのセッションに `runMemoryExtraction` を発火
  - 自動抽出設定(memory.auto_extract)と連動、失敗は fire-and-forget
- `web/src/lib/goal-loop.ts`: `runGoalLoopSchedulerTick()` 冒頭で `sweepIdleExtractions()` を呼ぶ
  (既存スケジューラーtickに相乗り。独立タイマーは追加しない)
- テスト `memory-idle.test.ts`(7件): 閾値判定・境界・レジャーによる重複防止・
  ワークスペース消失耐性・設定無効時スキップ・updatedAt取得・再起動後も再抽出しない

## 検証結果
- web vitest 全体 242 files / 2881 tests 全パス(前回 2869 → +12)
- tsc --noEmit / eslint clean

## 備考
- スイープは goal-loop スケジューラーの既存 tick 内で実行(追加の setInterval なし)
- レジャー記録を抽出発火前に先行書き込みするため、抽出途中でクラッシュしても二重実行されない
- host/src/index.js の未コミット変更(CADDYFILE の export 等)は別件のため手を付けず残置
---

# 本番ビルド復旧: Next.js 16 誤更新の巻き戻しとメジャー固定 (2026-08-07)

## 症状
起動時の production build が Turbopack のパニックで失敗し、host が exit 1 で終了。
`Invalid distDirRoot: "../../../../../AppData/Roaming/opencode-webui/web-build".
distDirRoot should not navigate out of the projectPath.`

## 原因1: Next.js のメジャー更新 (dbc1727)
- Settings の「Next.js を更新」ボタン (`POST /api/updates/nextjs`) が
  `npm install next@latest` を実行し、15.5.20 → ^16.3.0 へメジャー跨ぎで更新されていた。
- Next 16 の Turbopack は distDir がプロジェクト外へ出ることを禁止 (Rust 側 `Project::project_fs` で検証)。
  本プロジェクトは OneDrive 同期回避のため `%APPDATA%\opencode-webui\web-build` へ出力する設計なので全面的に非互換。
- 16 系での回避策は実測の結果いずれも不採用:
  - `next build --webpack` … 後述の原因2 とは別に webpack 自体が Next 17 で削除予定
  - `web/.next-prod` ジャンクション … OneDrive が実体を追跡する危険
  - ビルド後に外部へ移動 … Next 非サポート
- 対応: `web/package.json` / `package-lock.json` を dbc1727 の親へ戻し (`next: 15.5.20`)、`npm ci`。

## 原因2: クライアントコンポーネントがサーバ専用モジュールを取り込んでいた
- `PartView.tsx`("use client") が `@/lib/memory` から `stripMemoryInjectionBlock` を import。
  `memory.ts` → `db.ts` → `paths.ts` が `node:fs` / `node:os` を引き、
  `UnhandledSchemeError: Reading from "node:os" is not handled by plugins` でビルド失敗。
- 対応: 純粋関数を `web/src/lib/memory-text.ts` へ分離し、`memory.ts` は再エクスポートのみ。
  `PartView.tsx` は `@/lib/memory-text` を import。

## 再発防止: 更新ボタンをメジャー内に固定 (ユーザー承認済み)
- `web/src/lib/nextjs-major.ts`(新規): `majorOf` / `installSpecForMajor` / `latestInMajor`。
- `POST /api/updates/nextjs`: インストール済み major(取得できなければ package.json の宣言)から
  `next@15` のようなスペックを組み立てて install。major 不明時は npm を実行せず 500。
- `GET /api/updates/status`: abbreviated packument (`Accept: application/vnd.npm.install-v1+json`) を取得し、
  同一 major 内の最新安定版のみを latest として提示(ボタンが入れられない 16.x を提示しない)。
- テスト: `nextjs-major.test.ts`(6件) 追加、updates 系ルートテストを更新/追加(計29件パス)。

## 検証結果
- production build: `NEXT_DIST_DIR=%APPDATA%\opencode-webui\web-build` + `NODE_PATH=web\node_modules` で EXIT=0
  (`✓ Compiled successfully`, postbuild の verify-tsconfig も clean)
- web vitest: 246 files / 2908 tests 全パス、`tsc --noEmit` clean、eslint は既存 warning 2件のみ
- host の `start-webui.bat` 系テストはこの実行環境では元から失敗
  (HEAD で45件失敗 / 本変更後41件失敗) — 本件とは無関係の既存事象

## 備考
- Next 16 への移行は「外部 distDir をやめる/別方式にする」設計判断とセットで別途計画が必要。
---

# 実装ログ: メモリ API 405 バグ修正(extract ルート欠落)

## 日付
2026-08-07

## バグ
`POST /api/memory/extract` が 405(Method Not Allowed)を返す。UI(MemorySettings.tsx)は
`/api/memory/extract` へ POST するが、実装は `/api/memory/route.ts` の POST として
`/api/memory` に生えていた。`/api/memory/extract` は動的ルート `[id]` にマッチし、
PATCH/DELETE しか無いため 405 になった。

## 修正
- `web/src/app/api/memory/extract/route.ts` を新設し POST を移設(静的セグメントは
  Next.js で動的 `[id]` より優先される)
- `route.ts` から POST と不要 import を削除(GET のみに)
- `route.test.ts` の import を `./extract/route` から POST を取得する形に更新
- api-guard-coverage は extract route が requireAuthorized を通すためそのまま合格

## 検証結果
- web vitest 全体 246 files / 2908 tests 全パス
- tsc / eslint clean
- UI が呼ぶ全メモリ関連エンドポイントの実在とメソッドを照合確認
---

# Next 16 移行: ハードリンクミラーで production build をリポジトリ外へ (2026-08-07)

## 背景
Next 16 の Turbopack は distDir がプロジェクト外へ出ることを禁止する(`Invalid distDirRoot`)。
本プロジェクトは OneDrive 同期回避のため `%APPDATA%\opencode-webui\web-build` へ出力していたため全面非互換だった。
「出力だけ外に出す」ことが不可能になったので、**プロジェクトごと同期ツリーの外で動かす**方式に変更。

## 検証して却下した案
- `next build --webpack`: Next 17 で削除予定。加えて別要因(node: import)でも失敗
- **ジャンクション/シンボリックリンク**: バンドラが reparse point を実パスへ正規化するため、
  モジュールが `../../../OneDrive/...` として解決され破綻(実測で確認)
- `output: 'standalone'` + コピー: host の起動経路変更・static/public 手動コピー・native module 検証が必要
- リポジトリ丸ごとバイトコピー: 530MB / 36k ファイルの複製が毎回必要

## 採用: ハードリンクミラー
- `scripts/web-build-mirror.mjs`(新規)
  - ミラー先 `%LOCALAPPDATA%\opencode-webui\build\<basename>-<sha1(8)>`(`OPENCODE_WEBUI_BUILD_DIR` で上書き)
    → インストールパスでハッシュ分離。複数チェックアウトが同じミラーを奪い合わない
  - ハードリンクは reparse point ではないので正規化されず、バンドラから通常ファイルに見える。追加ディスクほぼゼロ
  - 差分同期(size + mtime 比較)＋ソースから消えたファイルの prune。`.next` は SKIP_DIRS で保護
  - **書き込み対象はコピー**: `web/tsconfig.json` / `web/next-env.d.ts` / `web/public/**`
    (ハードリンク経由の in-place 書き込みはリポジトリ側の実体を書き換えてしまうため)
  - EXDEV/EPERM(別ボリューム等)はバイトコピーへ自動退避
- `scripts/build-web.mjs`(新規): ガード → sync:addons(リポジトリ側) → ミラー同期 → ミラー内で `next build`
  → BUILD_ID 検証。bat / host 双方の単一入口。`--skip-guard` は呼び出し側が既にガード済みの場合用
- `installationRoot()` に `OPENCODE_WEBUI_INSTALL_ROOT` を追加。ミラーから `next start` しても
  自己更新・git-restore・OpenCode 設定パスは実リポジトリを見る
- `production-webui-build-guard.mjs`: `next start` の識別にミラーの web ディレクトリも許容
  (でないと自分のサーバーを「正体不明のリスナー」と誤認して全ビルドを拒否する)
- next.config: `turbopack.resolveAlias` で react/react-dom/react/jsx-runtime を実体パッケージへ。
  tsconfig の `paths`(addons/ から web/node_modules を解決するために必要)を Turbopack が実行時解決にも
  適用し、型定義パッケージを読もうとして失敗するため。tsconfig 側は tsc 用にそのまま維持
  ※ Turbopack は非ワイルドカードの `paths` に複数候補を与えるとエラーにするので配列併記は不可
- next.config の git 呼び出しは `OPENCODE_WEBUI_INSTALL_ROOT` を cwd に(ミラーに .git はない)

## 撤去したもの
- `scripts/web-dist-dir.mjs` と そのテスト
- `web/scripts/verify-tsconfig.mjs` と そのテスト、`postbuild` フック
  (distDir がプロジェクト内に戻ったので絶対パス汚染自体が起きない)
- host / build.bat / start-webui.bat の `NODE_PATH` 注入
- `dist-dir.ts` の絶対→相対変換。プロジェクト外の値は例外にする方針へ変更
- host の `removeLegacyInRepoBuild` は旧 `%APPDATA%\opencode-webui\web-build` も掃除対象に追加

## 検証結果
- 本番ビルド(ミラー経由・Next 16.3.0): 初回 同期30.7s + ビルド、差分 同期7.9s + ビルド2.3s、いずれも EXIT=0
- ミラーから `next start`(127.0.0.1:3311): Ready、`/api/access` 200、
  `/api/updates/status` が git 由来の commit を返す = INSTALL_ROOT オーバーライドが機能
- web vitest 246 files / 2911 tests 全パス、`tsc --noEmit` clean
- host 単体テスト(mirror/web-runtime/build-bat) 45件パス
- host の `start-webui.bat` サンドボックステストはこの実行環境では変更前から39件失敗しており、
  変更後も同数。bat の動作確認は静的アサーションと `build-web.mjs` の実行確認で代替した

## 備考
- `sed -i` は .bat の CRLF を壊す(実際に一度壊して復元した)。バッチファイルは Edit で編集すること
- 稼働中の WebUI(旧 %APPDATA% ビルドを配信中)は停止していない。次回 host 起動時に
  ミラーへ切り替わり、旧ディレクトリは自動削除される
---

# 作業ログ: 無言返答の自動再開(ハングと同様のフロー)

## 日付

2026-08-08

## 依頼

「無言返答で終了した際もハングと同様の自動再開処理を追加」。

## 実装内容(web/src/lib/hang-watchdog.ts)

- 従来は /session/status が idle になると即座に監視解除していた。このため
  プロバイダが何も返さず idle で終わる「無言返答」は検知できず、保存済みの
  リクエストも破棄されていた。
- `hasAssistantResponse(messages, startedAt)` を追加。ウォッチ開始時刻以降の
  最新ユーザー送信の後に、実質的なアシスタント返答(text パートで非空白 /
  structured 出力 / error 付き)が 1 つも存在しない場合を「無言」と判定する。
- `evaluateWatch` の idle 分岐で、監視解除前にこの判定を行い、無言であれば
  `resolveHang`(既存の abort + 1 回だけ同一リクエスト再送)へ進める。
- 返答ありは従来どおり監視解除。transcript 取得失敗時は武装を維持。
- 再送回数制限(retry_used=1)/本文サイズ上限(MAX_WATCH_BODY_BYTES)等の
  既存ガードは無言時にもそのまま適用される。

## テスト(web/src/lib/hang-watchdog.test.ts)

- "drops the watch once the engine is no longer busy with a response":
  idle + 返答ありで従来どおり監視解除。
- "resumes an idle turn that produced no assistant response":
  idle + 無言で abort 後に /prompt_async が 1 回だけ再送され retry_used=1 になる。

## 検証結果

- npx vitest run src/lib/hang-watchdog.test.ts ... 23 tests 成功
- npx vitest run(web 全体)... 247 files / 2922 tests 成功
- npx tsc --noEmit ... 成功
- next dev / next build は AGENTS.md の方針により未実行。

## 変更ファイル

- web/src/lib/hang-watchdog.ts
- web/src/lib/hang-watchdog.test.ts

---

# 作業ログ: ハング判定閾値の表示同期

## 日付

2026-08-08

## 確認内容

- サーバーの `hang-timeout` は DB の `600000ms`（10分）だった。
- 画面の shell ツール警告は localStorage の既定値 `300000ms`（5分）を使っていたため、7分台で警告だけが表示され、サーバー watchdog の確認対象にはまだなっていなかった。
- 対象セッションの watchdog 行は `armed` で登録済みだった。

## 実装内容

- `web/src/components/HangTimeoutSync.tsx` を追加し、ログイン後の共通レイアウトでサーバー設定とブラウザ設定を同期する。
- サーバー設定が存在する場合はサーバー値を画面へ反映し、未設定の場合のみ既存 localStorage のカスタム値をサーバーへ移行する。
- 設定画面は `webui:hang-timeout` イベントを購読し、同期後の入力値も更新する。
- `web/src/lib/hang-timeout.test.ts` にサーバー値採用と未設定時の移行テストを追加した。

## 検証結果

- `npm run typecheck` 成功
- `npm run lint` 成功（既存警告2件）
- `npm test` 成功（247 files / 2924 tests）

---

# 作業ログ: 実行中ツールの idle 瞬間に監視を解除しない

## 日付

2026-08-08

## 確認内容

- 実行中の shell tool が画面に残っていても、OpenCode engine の `/session/status`
  が agent step の切り替え中に一時的に `idle` を返すことがある。
- 既存の idle 分岐は transcript にアシスタント返答があると watch を削除していたため、
  その後も `running` の tool が残るケースではハング監視が失われていた。

## 実装内容

- `web/src/lib/hang-watchdog.ts` に `hasActiveTool()` を追加した。
- status が idle でも transcript に `running` / `pending` の tool part があれば、
  実行中ターンとして通常の無活動判定を継続する。
- 実行中 tool がない完了ターンと、無言返答の自動再開処理は従来どおり維持した。
- `web/src/lib/hang-watchdog.test.ts` に idle status + 実行中 tool の停止・1回再開テストを追加した。

## 検証結果

- `npm run typecheck` 成功
- `npm run lint` 成功（既存警告2件）
- `npm test` 成功（247 files / 2925 tests）

## 変更ファイル

- `web/src/lib/hang-watchdog.ts`
- `web/src/lib/hang-watchdog.test.ts`

---

# Browser Bridge MCP 動作チェック (2026-08-08)

## 結果

- Browser Bridge の内部テストは 87 tests / 87 pass。
- 実 MCP stdio クライアントで接続成功。7 ツールを列挙し、`browser_status` は `paired: true` / `extension.connected: false` を返した。
- `browser_list_tabs` は拡張機能未接続のため `EXTENSION_DISCONNECTED`。
- Broker は `http://127.0.0.1:18766` で稼働し、Bearer token も設定済み。
- グローバル設定の server path が存在しない `web\\browser-bridge\\mcp\\server.mjs` を指している。正しい実体はプロジェクト直下の `browser-bridge\\mcp\\server.mjs`。インストーラの dry-run でも既存設定との差分として検出された。

## 修正

- `C:\\Users\\Daichi\\.config\\opencode\\opencode.jsonc` の server path を実在する `browser-bridge\\mcp\\server.mjs` に修正。
- 新規セットアップの `resolveServerPath()` とインストールテストは既に正しいパスを使用していたため変更不要。
- 修正後の installer dry-run は up to date、Browser Bridge テストは 87 tests / 87 pass。

---

# 作業ログ: 停止済みGoal Loopのコンポーサー復元

## 日付

2026-08-08

## 依頼

「ループを完全停止したあと、再度コンポーザーからループを再作成するとき、前回の入力内容/設定を復元してほしい」。

## 実装内容

- 停止済み (`stopped`) のGoal LoopでコンポーサーのループトグルをONにしたとき、
  保存済みの `goal`、承認条件、最大ターン数を入力欄へ復元する。
- 同時に、前回のエージェント、モデル、variantもコンポーサー設定へ戻す。
- 既存のGoal Loop DBレコードに必要な値が保存されているため、新しい永続化テーブルは追加していない。
- `TaskView.test.tsx` に停止済みループの復元テストを追加した。

## 検証結果

- `npm run typecheck` 成功
- `npm run lint` 成功（既存警告2件）
- `npm test` 成功（247 files / 2928 tests）

## 変更ファイル

- `web/src/components/task/TaskView.tsx`
- `web/src/components/task/TaskView.test.tsx`

---

# 作業ログ: 無言に見えるGoal Loop完了と古い結果の誤採用を修正

## 日付

2026-08-08

## 事象

- Goal Loopの完了ターンがfenced JSONだけを返すと、内部結果JSONをチャット表示から隠す処理により、画面上は無言のままループが完了したように見えた。
- OpenCodeが1ターンを複数assistantメッセージへ分割する途中で、最後のassistantステップがまだ無言・streaming中でも、`finalAssistantAfter` が後ろから古い完了済みassistant結果を拾う可能性があった。

## 修正

- Goal Loopの結果候補を境界後の最後のassistantメッセージだけに限定し、最後のステップが未完了なら結果を適用しないようにした。
- JSONブロックだけの応答は、チャット上に結果の `summary` を表示するようにした。通常の自然文付きJSONは従来どおりJSON部分だけを隠す。
- Goal / verificationプロンプトに、JSONブロック前の人間向け要約を要求する指示を追加した。
- 古い結果の誤採用とJSON-only応答の表示を単体・統合テストで固定した。

## 検証結果

- 対象テスト: 3 files / 129 tests 成功
- Web全体: 247 files / 2931 tests 成功
- `npm run typecheck` 成功
- 対象ファイルの `npx eslint` 成功
- `next build` はプロジェクト指示により未実行

## 変更ファイル

- `web/src/lib/goal-loop.ts`
- `web/src/lib/goal-loop.test.ts`
- `web/src/lib/goal-loop.integration.test.ts`
- `web/src/lib/useSessionStream.ts`
- `web/src/lib/useSessionStream.test.ts`
## 日付

2026-08-09(Goalループ完了後の通常会話誤再開)

## 依頼

「ループ完了後、普通に会話したあと、ループ判定で勝手に会話が継続されるバグ」。

## 原因

`TaskView` の `goalLoopEnabled` がループ完了後も残っていた。`completed` は
非 live 扱いになるため、次の通常メッセージが composer の新規 Goal ループ開始条件
(`goalLoopEnabled && !goalLoopLive`) に入り、意図せず新しいループとして送信されていた。

## 修正内容

- Goal ループが `completed` / `blocked` / `stopped` になった時点で composer の
  ループモードを自動解除。
- 完了後の通常会話が通常の `sendPrompt` に進み、Goal ループ API を再度呼ばない
  回帰テストを追加。

## 検証結果

- `npm run typecheck` ... 成功
- `npm run test -- src/components/task/TaskView.test.tsx` ... 116 tests 成功
- `npm run lint -- src/components/task/TaskView.tsx src/components/task/TaskView.test.tsx` ... 成功
## 日付

2026-08-09(Goalループ完了直後の送信レース対策)

## 依頼

同じ「ループ完了後、普通に会話したあと、ループ判定で勝手に会話が継続される」
不具合が再発。

## 追加修正

完了状態を検知して `goalLoopEnabled` を解除する effect だけでは、状態更新と
composer の送信イベントが同じ描画タイミングに発生するレースを防げなかった。
通常送信の Goal 開始分岐自体でも `completed` / `blocked` を拒否し、完了系状態を
新しい Goal ループとして誤送信しないようにした。

## 検証結果

- `npm run typecheck` ... 成功
- `npm run test -- src/components/task/TaskView.test.tsx` ... 116 tests 成功
- `npm run lint -- src/components/task/TaskView.tsx` ... 成功

# レビュー記録: メモリ機能の実装上の問題点 (2026-08-09)

対象: `web/src/lib/memory*.ts`、メモリ API、goal-loop 連携、
`browser-bridge/mcp/memory-server.mjs`。

- **高: MCP の更新・削除がワークスペースにスコープされない。**
  `memory-server.mjs` の `memory_update` / `memory_delete` は `WHERE id = ?`
  だけで実行される。MCP プロセスは起動時に workspace を固定しているが、別
  workspace の memory ID を入力できれば読み書きできる。`workspace_id = ?` を
  条件に追加し、取得も同じ条件で行う必要がある。
- **高: Web API が workspace 境界を強制しない。** `GET /api/memory` は
  `workspace_id` が省略可能で全 workspace の行を返し、`PATCH` / `DELETE` /
  `approve` は ID だけで対象を操作する。メモリ層の「workspace 単位」という
  契約を API で守れていない。workspace ID を必須にして、各更新系の SQL にも
  workspace 条件を付けるべきである。
- **中: workspace 削除時に memories が残る。** `memories.workspace_id` は
  `workspaces` への FK/CASCADE を持たず、`deleteWorkspace` も memories を
  削除しない。削除済み workspace の内容と FTS 行が DB に永続し、UI から通常は
  到達できない孤児データになる。FK + `ON DELETE CASCADE`（既存 DB 向けには明示
  削除を含むマイグレーション）を追加する必要がある。
- **中: 自動抽出用の throwaway session を削除しない。**
  `runMemoryExtraction` は session を作成するが、成功・失敗・タイムアウトの
  いずれでも `DELETE /session/:id` を発行しない。goal completed と idle の実行
  回数に比例して OpenCode 側に `memory-extract` セッションが蓄積するため、
  `finally` で best-effort に削除すべきである。
- **中: idle 抽出は失敗しても永久に再試行されない。**
  `launchIdleExtraction` は非同期処理の開始前に `markIdleExtracted` を実行し、
  例外を握り潰す。そのためモデル障害・タイムアウト・DB失敗で候補が一件も
  作られなくても、同一 session は以後抽出対象外になる。成功完了後に ledger を
  記録するか、失敗状態と再試行方針を ledger に持たせる必要がある。
- **中: MCP からの書き込みは監査されない。** 仕様は `memory_add` /
  `memory_delete` の全操作を監査対象とするが、MCP の `add` / `update` / `delete`
  は DB を直接操作するだけで監査ログを出さない。プロンプト汚染の調査経路が
  欠落するため、Web API と共通の永続監査基盤に記録する必要がある。

検証: `npm --prefix browser-bridge test` (87件成功)、
`npm --prefix web run typecheck` (成功)。
