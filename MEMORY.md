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
