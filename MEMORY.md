# 作業ログ: スキル青文字表示とホバー概要

## 日付

2026-08-11

## 内容

- Composer入力の `/skill-name` を `text-accent`（青）でハイライトし、キャレット位置のスキル概要を `title` でホバー表示する。
- `slash-command.ts` に `isSkillCommand` / `findSkillTokens` / `segmentSkillHighlights` / `skillDescriptionAt` を追加。
- HomeView / TaskView の Composer に `commands={slashCommands}` を配線。
- スラッシュ候補メニューと設定スキル一覧でもスキル名を青文字にし、ホバーで概要を確認できる。

## 検証

- `npm.cmd test -- --run src/lib/slash-command.test.ts src/components/Composer.test.tsx src/components/SlashSuggestMenu.test.tsx src/components/settings/ExtensionsSettings.test.tsx` ... 50 tests 成功
- `npm.cmd run typecheck` ... 成功

---

# 作業ログ: 中断ターンの「再開」ボタン追加

## 作業ログ: PC向けタスク左右分割表示

### 日付

2026-08-11

### 仕様

- 初期状態は従来どおり1ペイン。分割状態は保存せず、ページ再読み込み時も1ペインから始める。
- 1024px以上のPC表示で、開いているタスクとは異なるタスクをサイドバーから画面右半分へドラッグ＆ドロップすると、現在のタスクを左、ドロップしたタスクを右に表示する。
- 左半分へドロップした場合は、ドロップしたタスクを新しい左タスクとして開き、それまで左にあったタスクを右へ移す。分割済みなら既存の右タスクを置換するため、右タスクを左へ落とすと左右が入れ替わる。
- 分割中に別タスクをドロップすると右ペインを置換する。右タスクのヘッダーから1ペインへ戻せる。
- 1024px未満へリサイズした場合は分割を自動終了する。モバイルではタスクをドラッグ可能にせず、分割UIも表示しない。

### 実装

- `TaskSplitContext` が主タスク（URL）、右タスク、操作対象ペイン、PC幅判定を管理する。状態はメモリ内だけに保持する。
- `Sidebar` の通常タスク行へカスタムMIME `application/x-opencode-task` のHTML D&Dを追加した。右表示中のタスクは枠線とペインアイコンで識別できる。
- `AppShell` に左右のドロップ領域と等幅2ペインを追加した。左ドロップ時は旧主タスクを右へ退避し、主タスクのルート遷移が反映されるまで分割描画を保留して同一タスクの一時的な重複を防ぐ。右側の `TaskView` は動的importし、ホーム等の初期バンドルを増やさない。
- 分割中の `TaskView` は内部の会話/Diffをコンパクトなタブ表示にし、画面幅ではなくペイン幅に適した構成にする。
- フォーカスまたはクリックしたペインだけがタブタイトル、コマンドパレット、アクティブ承認スコープを所有する。所有者IDを追加し、非アクティブ側のeffect cleanupがアクティブ側の状態を消さないようにした。
- 右ペイン内でタスクを削除・サイドバーからアーカイブした場合は、全画面遷移せず右ペインだけを閉じる。

### 検証

- Web全体Vitest: 272ファイル / 3268成功 / 1スキップ。
- `npm run typecheck`: 成功。
- 変更対象ESLint: 成功。
- `npm run test:encoding`: 7件成功。
- `git diff --check`: 成功。

---

## 日付

2026-08-11

## 背景

- 手動停止（`POST /session/{id}/abort`）で中断したターンは、assistantメッセージに `MessageAbortedError` が付いて赤いエラー行が出るだけで、UIから復帰する手段がなかった。ユーザーはプロンプトを手で打ち直す必要があった。
- Goal Loopには「再開」があり、サーバー側ハングwatchdogは「同じリクエストを1回だけ再送」して自動再開していたが、通常会話の手動中断にはどちらも効かない。

## 仕様（ユーザー確定）

- 再開の動作: 中断された**同じプロンプトを再送**する（watchdogと同じ考え方）。
- 表示場所: 中断された assistant メッセージの直下。
- 表示条件: 原因を問わず `MessageAbortedError` 全般（手動停止・watchdog停止のどちらでも出す）。

## 実装

- `web/src/lib/aborted-resume.ts` を追加。React/browser非依存の純関数で、
  - `isAbortedAssistantMessage()`: `info.error.name === "MessageAbortedError"` の assistant 判定。
  - `findAbortedResumeTarget()`: **会話末尾が中断ターンのときだけ**、直前のuserメッセージからプロンプト本文（synthetic除外、複数textは `\n\n` 連結）と添付file（`url`/`mime`/`filename` → `uri`/`mime`/`name`）を復元し、中断ターン自身の `agent` / `providerID`+`modelID` を引き継ぐ。
  - 末尾限定にしたのは、過去の中断ターンから再送すると現在の文脈と噛み合わない作業を重複実行させるため。間に完了済みassistantが挟まる場合もnullを返す。
- `web/src/components/task/TaskView.tsx`
  - `abortedResume` は `timeline` ではなく `stream.visibleMessages` から算出。出力前に中断され描画パートを持たないassistantメッセージでも再開できるようにするため。
  - 表示条件は `abortedResume && task.sessionId && !working && !goalLoopLive`。稼働中ループの再開はGoalLoopPanelの責務なので出さない。
  - `resumeAbortedTurn()` は `touchActivity` 後に `stream.sendPrompt(text, { agent, model, files, variant, sessionId })` を実行。agent/モデルは中断ターン由来なのでAuto解決やコンポーザーの選択状態に依存しない。失敗時は `role="alert"` でインライン表示し、ボタンは押せるまま残す。
  - 送信すると `working` になるので自動的に消え、ターン完了後は末尾が中断ターンでなくなるため再表示もされない（自己クリア）。セッション切替時は state をリセット。

## 実測データによる判定ロジック修正（初回実装が表示されなかった原因）

稼働中エンジン（`http://127.0.0.1:4096`）の直近30セッションから `MessageAbortedError` を持つメッセージを抽出して構造を確認した。

- `error` は `{"name":"MessageAbortedError","data":{"message":"Aborted"}}` で確定。検出条件自体は正しかった。
- **1ターンが複数の assistant メッセージに分割される**（`step-start,reasoning,tool,step-finish` 単位で別メッセージ）。実測5件のうち4件は中断メッセージの直前が assistant だった。初回実装は「直前が assistant なら再開対象外」と判定して `null` を返していたため、実運用でほぼ常に非表示になっていた。→ 間の assistant を読み飛ばし、そのターンを開始した直近 user プロンプトまで遡るよう修正。
- 中断メッセージは **parts が空**のケースが多い（送信直後の停止など）。`timeline` から算出していたら検出できないため、`visibleMessages` 基準かつボタンをメッセージ配列の外（末尾直後）に描画する設計が必要だった。
- 末尾に「parts も error も無い assistant メッセージ」が残ることがあるため、中断判定時はこれを読み飛ばす。中身のある assistant が後続する場合は従来どおり非表示。

## 無言終了への拡張（ユーザー指示）

エージェントが本文を返さずターンを終えた場合（無言終了）も再開対象にした。

- `findAbortedResumeTarget()` → `findResumableTurn()` に改名し、`reason: "aborted" | "silent"` を返すようにした。型も `AbortedResumeTarget` → `ResumableTurn`。
- 判定は**ターン単位**（直近 user プロンプト以降の assistant 群）。
  - `aborted`: ターン内に `MessageAbortedError` があり、その後に本文が出ていない。
  - `silent`: ターン内に本文（非空 text パート）・structured output・error のいずれも無く、走行中/保留中の tool も無い。基準は `hang-watchdog.ts` の `hasAssistantResponse()` に合わせた。
- 除外条件: 非 abort の error（`APIError` 等）はそのエラー自体を見せるべきなので再開を出さない。tool が `running`/`pending` の間はまだ進行中扱い。プロンプト以降に assistant が 1 通も無い場合は送信直後と区別できないので出さない。
- 判定は idle 前提なので UI 側で `!working` と `stream.loaded` を必須にしている。
- 表示: 中断は赤い Aborted 枠へ差し込み、無言終了は「応答がありませんでした」の**中立トーン**枠（`TurnNoticeBanner` の `tone="neutral"`）。aria-label も「中断したターンを再開」/「無言終了したターンを再開」で分ける。

## 配置（ユーザー指示による変更）

- 「再開」ボタンは Aborted 枠の**内側・右寄せ**に置く。`MessageErrorBanner`（TaskView.tsx のモジュールスコープ）でエラー文＋アクションを `justify-between` の1行に並べ、失敗表示はその下に出す。
- 中断メッセージが parts を持たず `timeline` から除外される場合は Aborted 枠自体が描画されないため、会話末尾に同じ枠を1つだけ補う（`abortedResumeInTimeline` で二重表示を防止）。

## 検証

- `npx vitest run`: 270ファイル / 3256成功 / 1スキップ
- `npx tsc --noEmit`: 成功
- 変更/追加4ファイルのESLint: 成功
- 追加テスト: `aborted-resume.test.ts` 27件、`TaskView.test.tsx` の「中断・無言終了ターンの再開」10件（同一プロンプト+agent/model再送、枠内右寄せ配置、ターン内に assistant ステップが挟まる場合、parts が無い中断、無言終了の中立枠と再送、走行中toolでの非表示、非abortエラーでの非表示、失敗表示、会話が先に進んだ場合の非表示、busy中の非表示、通常完了ターンでの非表示）

## 注意

- 反映には WebUI の本番ビルドが必要（`build.bat`）。エージェント側からはビルドしない運用。

---

# 作業ログ: 透過プロキシ /provider GET レスポンスキャッシュ追加

# 作業ログ: 自動メモリ抽出の通知バッジと履歴

## 日付

2026-08-11

## 実装内容

- `memory_extraction_runs` テーブルとCRUDを追加し、抽出トリガー、実行状態、保存・候補・拒否・重複件数、失敗理由、既読時刻を永続化するようにした。
- 通常会話、goal完了、idle、手動の各抽出経路からtriggerとassistant message IDを渡し、開始時に履歴を作成、成功/失敗時に更新するようにした。
- `insertExtractedMemories()` が保存・候補・拒否件数を返すようにし、抽出監査ログにも実件数を記録するようにした。
- `GET /api/memory/extractions` と `POST /api/memory/extractions/read` を追加した。どちらも認可ガードを通し、workspace単位で一覧・未読件数・既読化を扱う。
- MemorySettingsに未読通知バッジ、抽出履歴、保存/候補/拒否/失敗表示、明示的な「すべて既読」、15秒間隔の履歴更新を追加した。
- メモリ仕様書に履歴テーブル、API、UI、テスト方針を追記した。
- 全体テストで不足していたgoal-loopのDBモックexportを補い、メモリ件数テストを明示的な承認値と後片付けで隔離した。

## 検証

- Web全体テスト: 269ファイル / 3218成功 / 1スキップ
- `npm --prefix web run typecheck`: 成功
- 変更対象のESLint: 成功
- `git diff --check`: 成功

---

# タスク完了後のハングwatchdog再開誤判定を修正

## 日付

2026-08-11

## 根本原因

- `session_hang_watches` は通常の `prompt_async` 送信後も監視を続けるが、`/session/status` が完了後も `busy` のまま残る場合、履歴に完了済みassistant応答があってもbusy状態を優先してabort・同一要求の再送へ進んでいた。
- idleかつ本文を認識できないターンは、設定値（実環境では10分）を待たず `SILENT_RESPONSE_GRACE_MS` の30秒後に再送されていた。中間ステップや無言・ツール専用完了を誤って再開し得た。
- 同期型の`command`/`prompt`は成功レスポンス自体がターン完了を示すのに、成功後もwatchを残していた。
- Goal Loopは対象タスクに存在せず、`goal_loops`のRunnable状態にも該当しなかったため、今回の再開経路ではなかった。

## 修正

- ハング閾値超過時に履歴の完了済みassistant応答（active toolなし）を検出したら、残留busy状態より履歴を優先してwatchを解除する。
- idle無応答は設定された無活動閾値を超えてから短い確認graceへ進める。30秒だけで再送しない。
- BFF経由および新規タスク初回の同期`command`完了時にwatchを解除する。

## 回帰テスト

- stale busy + 完了済みassistant応答ではabort/replayしない。
- idle無応答は30秒では再送せず、閾値超過後の確認graceを経て初めて再送する。
- 同期command成功後にwatchを解除する。

## 検証

- `npx vitest run`: 267 files / 3190 passed / 1 skipped
- `npx tsc --noEmit`: 成功
- 対象6ファイルのESLint: 成功
- Goal Loop / Workflow / Session Stream関連79テスト: 成功

---

# 作業ログ: 保存済みモデル価格の設定画面表示

## 日付

2026-08-11

## 修正内容

- `provider-model-state.ts` の新規状態へ Ollama Cloud の代表価格をコピーし、既存の状態ファイルにも未設定価格だけを一度移行するようにした。
- 価格設定のクリア後にデフォルト価格が復活しないよう、適用バージョンを状態ファイルへ記録するようにした。
- `ProviderModelsSettings.tsx` でモデル一覧の再読み込み後も、価格設定フォームを開いた時に保存済みの input/output/cachedInput/cacheWrite を表示するようにした。
- 保存済み価格の表示、旧状態の移行、クリア維持の回帰テストを追加した。

## 検証

- Web全体テスト: 267ファイル、3189成功、1スキップ
- Web typecheck: 成功
- 対象ESLint: 成功
- `git diff --check`: 成功

---

## 日付

2026-08-11

## 症状

前回の provider-models キャッシュで `/api/extensions/provider-models` の2回目は短縮したが、Home 初回レンダを律速する `/api/opencode/provider`（透過プロキシ、0.99s）は未キャッシュで残っていた。

## 根本原因

`web/src/app/api/opencode/[...path]/route.ts` は `/provider` と `/agent` の GET を `cacheCapabilityMetadata` で**書き込み時の fail-closed 用**キャッシュには保存するが、GET レスポンス自体は毎回 OpenCode の `/provider` を `fetch()` していた。Home の `Promise.all` で `/api/opencode/provider` と `/api/extensions/provider-models` が同時に走り、両者とも OpenCode `/provider` を叩く。

## 修正

`route.ts` に GET レスポンス用の短いTTL（5秒）キャッシュを追加:

- キャッシュキー: `${directory ?? ""}\0${pathname}`（`directory` が `null` の Home 呼び出しも含む）
- 対象: GET `/provider` と GET `/agent` の JSON レスポンスのみ（SSE・非JSON・POST/PUT/DELETE は除外）
- 保存内容: **maskSecrets 済み**の JSON（`/provider`）または parsed JSON（`/agent`）+ hop-by-hop除外済みヘッダ
- TTL: 5秒（プロバイダの接続/切断が数秒で表面化するよう短めに設定）
- 上限: 32エントリ（LRU-ish で古いものから退避）
- キャッシュヒット時は `fetch()` をスキップし、キャッシュから `NextResponse.json()` を構築

`/provider` は `shouldMaskSecrets` ブロックで `maskSecrets(json)` を返す箇所でキャッシュ保存。`/agent` は非対象のため別途 parsed JSON をキャッシュ保存するブロックを新設。

- `web/src/app/api/opencode/[...path]/route.ts:240`（キャッシュ定義）、`:786`（ヒットチェック）、`:911`（`/provider` 保存）、`:939`（`/agent` 保存）
- テスト用に `__clearGetResponseCacheForTest()` を export

## 計測（修正後）

| API | 修正前 | 修正後（1回目） | 修正後（2回目・キャッシュヒット） |
| --- | --- | --- | --- |
| `/api/opencode/provider` | 0.99s | 0.83s | **0.56s**（OpenCode `/provider` 呼び出し分が消滅） |
| `/api/opencode/agent` | 0.015s | 0.013s | 0.016s（元々速い） |

Home 初回バーストの `/api/opencode/provider` と `/api/extensions/provider-models` は `Promise.all` で同時に走るため、先に完了した側がキャッシュを温め、後から完了する側がヒットする。最悪ケースでも OpenCode `/provider` 呼び出しは1回に圧縮される。

## 回帰テスト

`route.test.ts` に2件追加:

1. `serves GET /provider from the short-TTL response cache on the second hit and keeps secrets masked` — 2回連続 GET で `fetch` が1回だけ呼ばれ、両レスポンスの secret が masked されることを検証
2. `does not cache GET /provider across different directories` — 異なる `directory` で2回呼ぶと `fetch` が2回呼ばれる（per-directory 分離）ことを検証

`beforeEach` で `__clearGetResponseCacheForTest()` を呼び、テスト間でキャッシュが漏れないよう保証。

## 検証

- `npx tsc --noEmit`: 合格
- `npx eslint <変更ファイル>`: 合格
- `npx vitest run`: 267 ファイル 3170 passed / 1 skipped（2回連続合格）

## 残存リスク・制約

- キャッシュは5秒TTLのため、プロバイダ接続/切断後5秒間は古い一覧が返る可能性。Home の初回レンダでは許容範囲（ユーザーが設定を変えた直後に再読み込みすれば最新が取得される）。
- `/config` など他の `shouldMaskSecrets` 対象パスはキャッシュ対象外（`getResponseCacheKey` で `/provider` と `/agent` のみ許可）。`/config` は頻繁に変わる設定を含むため、キャッシュは意図的に回避。
- `ProviderModelsSettings.test.tsx` が全 vitest 実行時に1度だけ flaky に失敗したが、stash した状態（前回コミット時点）でも再現せず、再実行で2回連続合格。既存のタイミング依存の flaky テストで、今回の変更とは無関係。

---

# 作業ログ: 起動直後のフロント高速化（provider-models キャッシュ + tasks 空リスト早期return）

## 日付

2026-08-11

## 症状

トレイ host 起動直後の Home 画面が体感遅い。ブラウザで開いてから入力可能になるまでに1秒程度待つ。

## 計測（修正前）

`http://127.0.0.1:3000` の起動直後APIレイテンシ:

| API | レイテンシ | 原因 |
| --- | --- | --- |
| `/api/tasks` | 0.34s | `listTasks()` が各 workspace dir ごとに `/session`, `/session/status`, `dirStat` を並列コール |
| `/api/opencode/provider` | 0.99s | OpenCode の `/provider` への透過プロキシ（maskSecrets 済み） |
| `/api/extensions/provider-models` | 0.64s | **同じ OpenCode `/provider` を再取得** + WebUI state 読み込み + JSONC parse |

Home の `Promise.all` でこの3つが同時に走る。`/api/opencode/provider` と `/api/extensions/provider-models` は**同じ OpenCode `/provider` を2回コール**しており、これが最大の無駄。

## 根本原因

`web/src/lib/opencode-extensions/provider-models.ts` の `listProviderModels()` が毎回 `ocServer(null, "/provider", {timeoutMs: 3000})` を呼ぶ。Home の初回バーストで `/api/opencode/provider`（透過プロキシ）と `/api/extensions/provider-models` が同時に同じ OpenCode `/provider` を叩く。OpenCode の `/provider` は connected provider 全体の capability を列挙する重いエンドポイントで、1回あたり ~0.6-1.0s かかる。

`listTasks()` も空のワークスペース一覧に対しては無駄に `sessionStatusFor` / `sessionMetaFor` の Promise.all を組み、それぞれが `ocServer` を呼ぼうとする（実際は `dirs.length === 0` でマップされないが `globalEngineOk` は1回、ただし呼び出しパスが整理されていなかった）。

## 修正

### 1. `provider-models.ts` に5秒TTLキャッシュを追加

`fetchProviderResponse()` を新設。OpenCode `/provider` の生レスポンスをプロセス内で5秒キャッシュし、Home の初回バーストで2回目を in-memory ヒットに圧縮。`disabled` state はディスクから毎回再計算するため、ユーザーが設定を変えても即座に反映される。

- `web/src/lib/opencode-extensions/provider-models.ts:70`
- テスト用に `__clearProviderResponseCacheForTest()` を export

### 2. `task-service.ts` の `listTasks()` に空リスト早期returnを追加

`dirs.length === 0` のときは `sessionStatusFor` / `sessionMetaFor` / `dirStat` の Promise.all をスキップし、`globalEngineOk()` 1回だけ呼んで `{ tasks: [], engineOk }` を返す。新規インストール直後や全 workspace 削除後の Home 起動で、`/api/tasks` が ~340ms から ~10ms（`/global/health` 1回分）に短縮される。

- `web/src/lib/task-service.ts:316`

### 3. テスト更新

- `provider-models.test.ts`, `provider-models/route.test.ts`: `beforeEach` でキャッシュクリア
- `task-service.test.ts`: 空リスト時の `/global/health` 単一呼び出しを検証するテストを追加

## 計測（修正後）

| API | 修正前 | 修正後（1回目） | 修正後（2回目・キャッシュヒット） |
| --- | --- | --- | --- |
| `/api/extensions/provider-models` | 0.81s | 0.81s | **0.48s**（OpenCode `/provider` 呼び出し分が消滅） |

`/api/tasks` は空リスト時のみ高速化（今回はワークスペースが存在するため 0.38s で据え置き）。

## 検証

- `npx tsc --noEmit`: 合格
- `npx eslint <変更ファイル>`: 合格
- `npx vitest run`: 267 ファイル 3168 passed / 1 skipped（既存）

## 残存リスク・制約

- `/api/opencode/provider`（透過プロキシ）は独自に OpenCode `/provider` を叩いており、今回はキャッシュ対象外。透過プロキシ側に GET レスポンスキャッシュを入れると `maskSecrets` の一貫性や SSE 混入リスクがあり、別件として扱う。
- テスト実行時間全体（~39s、うち transform 35s）は Vitest の変換オーバーヘッドが支配的で、今回の趣旨（起動直後のフロント高速化）の対象外。
- Home の初回レンダリングは依然として `/api/opencode/provider`（0.99s）に律速される。これを削るには `HomeView` が `provider-models` の結果だけを使うようリファクタリングする必要があり、影響範囲が大きいため別件。

---

# 作業ログ: 選択中スキル説明のコントラスト強化

# 作業ログ: ローカルOllamaのVLモデルが画像非対応と判定される不具合の修正

## 日付

2026-08-11

## 症状

モデル選択に出るローカルOllamaのモデルが、`qwen2.5vl:7b` を含めて全て「画像非対応」（事前解析アイコン）として表示される。

## 原因

`opencode.jsonc` の `provider.ollama.models.*` に `attachment` / `modalities` が無かった。OpenCodeは provider 設定のこの2フィールドから `capabilities.attachment` / `capabilities.input.image` を組み立てるため、書かれていないモデルは全て画像非対応になる。実際に稼働中エンジンの `/provider` を確認したところ、同じ設定ファイル内で `attachment: true` を持つ `cursor::auto` だけ `attach=True image=True`、`ollama::*` は全て `False` だった。

既存の登録経路（プロバイダー/モデル設定の「ローカルOllamaを追加」プリセット）は汎用の手入力フォームへ流し込む実装で、フォームが `attachment` / `modalities` を表現できないため能力情報が落ちていた。

## 実装内容

- `ollama-cli.ts` に `fetchOllamaModelCapabilities()` を追加。Ollamaの `POST /api/show` が返す `capabilities`（`vision` / `tools`）を使い、モデル名の推測ではなく実申告で画像対応を判定する。デーモン停止・旧バージョン時は `null` を返し、名前ヒューリスティックへフォールバックする。
- `registerOllamaProvider()` は解決した能力に応じて `attachment` / `modalities` と `tool_call` を書き込むようにした（従来は `tool_call: true` 固定だった）。
- `POST /api/ollama/register` を追加（インストール・Pullなしの再登録）。プロバイダー/モデル設定のボタンを「ローカルOllamaを登録」に変更し、手入力フォームへの流し込みをやめてこのAPIへ委譲した。
- `providerConfigFromInput()` が既存モデル定義の `attachment` / `modalities` / `cost` / `limit` 等を引き継ぐようにした。UIからのプロバイダー編集で画像対応情報が消える問題（Cursor等の既存プロバイダーにも影響）を防ぐ。
- 稼働中環境の `~/.config/opencode/opencode.jsonc` も同じ内容へ更新済み（`.bak-<epoch>` を隣に作成）。`qwen2.5vl:7b` / `gemma3:4b` が画像対応、`dolphin3:8b` / `qwen2.5:3b` は非対応として登録した。**OpenCode再起動後に反映される。**

## ハマりどころ

- `beforeEach(() => mock.mockReset())` と式本体で書くと、`mockReset()` の戻り値（モック関数自身）を Vitest がテスト後のクリーンアップ関数として実行してしまう。モックが throw する実装だと、ファイル末尾のテストだけが「throwしたエラー」で不可解に落ちる。ブロック本体 `() => { mock.mockReset(); }` で書くこと。

## 検証結果

- 稼働中エンジンの `/provider` で `cursor::auto` が `attachment/image = true`、`ollama::*` が `false` であることを確認（原因特定の根拠）
- `POST /api/show` で `qwen2.5vl:7b` → `completion,vision` / `dolphin3:8b` → `completion` を確認
- `npm --prefix web run typecheck` ... 成功
- `npm --prefix web run lint` ... 成功
- `npx vitest run`（web ディレクトリ内で実行）... 267ファイル / 3167 tests 成功（1 skipped）
  - 注: リポジトリルートから `vitest --root web` で走らせると `opencode-events` / `opencode-schema-freshness` が cwd 依存で失敗する。必ず `web/` で実行する。

# 作業ログ: 画像解析のOpenCode登録モデル一本化 / Ollama自動セットアップのボタン化

## 日付

2026-08-11

## 実装内容

### 画像事前解析をOpenCode登録モデルへ一本化

- `QwenNativeSettings` から `source` / `baseUrl` / `model` / `apiKey` / `maxTokens` を削除し、`{ enabled, opencodeModel, timeoutMs }` のみにした。旧設定ファイルの endpoint 系フィールドは読み捨てる（`readQwenNativeSettings` が移行を吸収）。
- `qwen-native-vision.ts` からOpenAI互換 `/chat/completions` 直叩き経路と再試行ロジックを削除。解析は常に `providerID::modelID` のOpenCode登録モデルで、ツール無効の使い捨てセッション経由で実行する。
- `analyzeNativeImages(prompt, images, directory)` に簡約（`fetchImpl` 引数を削除）。呼び出し側 `api/tasks/route.ts` も更新。
- 環境変数は `OPENCODE_WEBUI_QWEN_NATIVE=1`（強制有効化）と新設 `OPENCODE_WEBUI_QWEN_MODEL=providerID::modelID`（解析モデル上書き）のみ。`OPENCODE_WEBUI_QWEN_LOCAL_BASE_URL` / `_MODEL` / `_API_KEY` は廃止。
- 有効化にはモデル選択が必須（`isQwenNativeVisionAvailable()` は `enabled && opencodeModel` で判定）。`PUT /api/qwen-native/settings` も `providerID::modelID` 形式を検証する。
- `GET /api/qwen-native/models` は `/provider` の画像対応モデルに加え、`opencode.jsonc` に直接定義された画像対応モデル（`attachment: true` / `modalities.input` に image）をマージして返す。エンジン再起動前の登録直後や、エンジン到達不可時でも候補を出せる。

### ローカルOllamaのOpenCodeプロバイダー登録

- `web/src/lib/ollama-provider.ts` を新設。`ollama` provider として `npm: @ai-sdk/openai-compatible` / `baseURL: http://127.0.0.1:11434/v1` / `apiKey: ollama` を `opencode.jsonc` へ書き込む。検出モデル名から画像対応を推定し（`vl` / `vision` / `llava` / `minicpm-v` / `moondream` / `pixtral` / `internvl` / `gemma3`、`gemma3:1b` は除外）、該当モデルに `attachment: true` と `modalities.input: [text, image]` を付与する。
- `provider-models.ts` に `upsertProviderEntry()`（衝突エラーにしない作成/上書き）と `listConfiguredImageModels()` を追加。設定ファイル生成処理は `ensureConfigFile()` へ共通化。
- モデルIDの許可文字に `:` を追加。`qwen2.5vl:7b` のようなタグ付きIDが登録できるようになり、既存の「ローカルOllamaを追加」プリセットの保存失敗も解消。

### 起動時自動セットアップの廃止とボタン化

- `scripts/start-webui.bat` から `:check_ollama`（winget自動インストール + 自動Pull）と呼び出しを削除。`OPENCODE_WEBUI_OLLAMA` / `OPENCODE_WEBUI_OLLAMA_MODEL` も廃止。
- `POST /api/ollama/setup` を新設。インストール（未導入時のみ）→ 指定モデルのPull（未取得時のみ）→ provider登録 を一括実行し、実行ステップと `modelValue`（`ollama::<model>`）を返す。
- `VisionSettings.tsx` を作り直し: endpoint入力欄（Base URL / モデル名 / APIキー / 最大トークン）を削除し、モデル選択＋タイムアウトのみに。「ローカルOllama」パネルに取得モデル名入力と「Ollamaをセットアップ」ボタンを配置し、成功時は解析モデルの選択を自動反映する。
- 単発の `POST /api/ollama/install` / `POST /api/ollama/pull` は `setup` へ統合したため削除（`GET /api/ollama/status` は維持）。
- 画像非対応モデルへの画像添付時のエラー文言を「Ollama画像解析を有効に」から「設定の『画像解析』タブで事前解析モデルを選んで有効化」へ更新（TaskView / HomeView / tasks route / opencodeプロキシ）。

## 検証結果

- `npm --prefix web run typecheck` ... 成功
- `npm --prefix web run lint` ... 成功
- `npx vitest run` ... 266ファイル / 3158 tests 成功（1 skipped）
- `npm run test:encoding` ... 7件成功（`start-webui.bat` のASCII+CRLF維持を確認）

## 注意点

- provider登録は `opencode.jsonc` への書き込みのため、OpenCodeエンジン再起動後に `/provider` へ反映される。UIにも再起動が必要な旨を表示している。
- 旧 endpoint 設定で有効化していた環境は、移行後にOpenCode登録モデルを選び直すまで事前解析が無効になる（`enabled` だけでは有効にならない）。

# 作業ログ: ハング自動再開通知の非表示化

## 日付

2026-08-11

### 実装内容

- ハング watchdog による同一処理の自動再開は維持し、TaskView の再開通知バナーだけを削除。
- 通知表示用のカウント、30秒タイマー、閉じる操作と不要な関連処理を削除。
- 自動再開メタデータがある場合も通知を表示しない回帰テストを追加。

### 検証

- `npm.cmd test -- --run src/components/task/TaskView.test.tsx` 成功（115 tests）
- `npm.cmd run typecheck` 成功
- 対象ファイルの ESLint 成功

## 実装内容

- 選択中のスキル候補にアクセント色の左ボーダーを追加し、候補の選択位置を明確化した。
- 選択中の説明文を本文色の70%で表示し、選択背景上でも説明が埋もれないようにした。

## 検証結果

- `npm.cmd test -- --run src/components/SlashSuggestMenu.test.tsx` ... 2 tests 成功
- `npm.cmd run typecheck` ... 成功
- 対象ファイルの ESLint ... 成功

# 作業ログ: スキル呼び出し候補の視認性改善
# 作業ログ: provider-models設定キャッシュとtask-serviceセッション推定の高速化
# 作業ログ: provider-models globalThisキャッシュの再評価耐性
# 作業ログ: client GET in-flight dedupによるHome初期化高速化

## 作業ログ: アーカイブタスク一覧のengine fan-out削減

## 作業ログ: provider-modelsの同時provider取得削減

## 作業ログ: provider-models ディスクキャッシュ（stale-while-revalidate）

## 日付

2026-08-11

## 修正内容

- `fetchProviderResponse` に `dataDir` 配下 `provider-response-cache.json` への読み書きを追加した。
- プロセス再起動後もディスクから即座に返し、バックグラウンドで再検証する stale-while-revalidate パターンを実装した。
- TTL: 5秒（fresh）、stale window: 5分（stale but usable）、超過時はネットワーク取得。
- バックグラウンド再検証は `__opencodeWebuiProviderRevalidating` フラグで重複防止。失敗時はstaleデータを維持。
- ディスク書き込みはatomic（temp+rename）。

## 検証結果

- `provider-models.test.ts`: 46 tests passed
- ディスクキャッシュ永続化・stale返却+バックグラウンド再検証・stale window超過時のネットワークフォールバックの回帰テストを追加した。
- `npm run typecheck`: 成功
- 対象2ファイルのESLint: 成功

## runtime計測（ディスクキャッシュ効果 2026-08-11）

- `/api/extensions/provider-models` 初回（コールド）: 改善前 ~900ms → 改善後 **49.2ms**（18.3x高速化）
- 2回目（TTL内）: 8.6ms
- 3回目（バックグラウンド再検証後）: 52.9ms
- ディスクキャッシュ `provider-response-cache.json` が正常に読み書きされ、バックグラウンド再検証も動作確認済み

## 作業ログ: dirStat のgitコマンド統合による初回レイテンシ削減

## 日付

2026-08-11

## 修正内容

- `dirStat` のgit3コマンド（`rev-parse` + `diff --shortstat` + `status --porcelain`）を `git status --porcelain --branch` 1コマンドに統合し、branch名と変更ファイル数を1回で取得するようにした。
- `git diff --shortstat` は別途実行し、失敗時は additions/deletions を0として返す（非ブロッキング）。
- これにより各ディレクトリのgit実行が3コマンド→1+1コマンドに削減され、初回レイテンシの最大要因だったdirStat fan-outを大幅に短縮。

## 計測（修正前）

- dirStat fan-out（4ディレクトリ並列）: ~788ms（各ディレクトリ261-787ms、3コマンド逐次）
- `/api/tasks` 初回: 274-480ms

## 検証結果

- `dirstat.test.ts`: 11 tests passed（branch解析、detached HEAD、ファイルカウント、メタデータフィルタリング、キャッシュ無効化）
- `task-service.test.ts`: 24 tests passed
- `npm run typecheck`: 成功
- 対象3ファイルのESLint: 成功

## 作業ログ: provider-models ディスクキャッシュ（stale-while-revalidate）

- `/api/extensions/provider-models` 初回（コールド）: 改善前 ~900ms → 改善後 **49.2ms**（18.3x高速化）
- 2回目（TTL内）: 8.6ms
- 3回目（バックグラウンド再検証後）: 52.9ms
- ディスクキャッシュ `provider-response-cache.json` が正常に読み書きされ、バックグラウンド再検証も動作確認済み

## 作業ログ: provider-modelsの同時provider取得削減

## 日付

2026-08-11

## 修正内容

- provider responseのTTLキャッシュにcache miss中のin-flight Promise共有を追加した。
- 同時に複数の `/api/extensions/provider-models` GET が発生しても、OpenCode `/provider` は1回だけ取得する。
- 成功時のみTTLキャッシュへ保存し、失敗時や完了後はpending状態を残さない。

## 検証結果

- `provider-models.test.ts`: 43 tests passed
- concurrent cache missで `ocServer` が1回だけ呼ばれる回帰テストを追加した。
- 失敗したpending取得後に次回呼び出しが再試行する回帰テストを追加した。
- module reload中の同時取得でもpending Promiseを共有する回帰テストを追加した。
- `npm run typecheck`: 成功
- 対象2ファイルのESLint: 成功

## runtime計測（mirror更新後 2026-08-11）

- `/api/tasks`: 初回148.203ms（archivedCount=180反映済み）、2回目94.399ms
- `/api/tasks/archived`: 初回227.041ms（engine fan-out削減済み）、2回目6.389ms
- `/api/extensions/provider-models`: 初回917.599ms、2回目10.157ms（TTLキャッシュヒット）
- 同時2本GET: provider-modelsは両者599ms台で同時完了し、in-flight共有でOpenCode /providerが1回だけ取得されることを確認
- 修正前mirror同時GET基準値: request1=715.486ms、request2=1042.483ms（2本それぞれが重い処理を実行）

## 作業ログ: Sidebarアーカイブ詳細取得の遅延

## 日付

2026-08-11

## 修正内容

- `/api/tasks` にDB由来の `archivedCount` を追加し、Sidebarの件数表示に利用するようにした。
- Sidebar初期refreshでは、アーカイブを折りたたんでいる場合に `/api/tasks/archived` を取得しないようにした。
- アーカイブを展開した時だけ詳細一覧を取得し、既存の復元・削除操作後のrefreshでも展開状態を維持する。

## 検証結果

- `task-service.test.ts`: 24 tests passed
- `Sidebar.test.tsx`: 40 tests passed
- `npm run typecheck`: 成功
- 対象4ファイルのESLint: 成功

## 日付

2026-08-11

## 修正内容

- `listArchivedTasks` はSidebar表示に必要なDB情報とローカルgit情報だけを取得するよう変更した。
- アーカイブ済みタスク一覧では不要な `/session/status`、`/session`、transcript取得を省略し、engineへのリモートfan-outをなくした。
- TaskViewへ遷移した場合は既存の個別タスク取得で詳細メタデータを再取得する。

## 検証結果

- `task-service.test.ts`: 24 tests passed
- アーカイブ一覧がengineを呼び出さない回帰アサーションを追加した。
- `git diff --check`: 成功

## 日付

2026-08-11

## 根本原因

HomeView、Sidebar、GlobalAttentionProvider、useAttentionQueueが初期化時に同じ `/api/tasks` を個別に `getJson` していた。`getJson` にリクエスト共有がなく、同時実行時に同じ `listTasks()` が重複していた。

## 修正

`web/src/lib/client.ts` の `getJson` に、URLとtimeoutをキーにしたin-flight Promise共有を追加。リクエスト完了・失敗時にMapから削除するため、stale responseを保持せず、完了後の次回GETは通常通り再取得する。

## 回帰テスト・検証

- `client.test.ts` に同時2回のGETがfetch 1回になり、完了後の3回目は再fetchするテストを追加。
- client単体25テスト、HomeView/Sidebar/GlobalAttentionProvider/useAttentionQueue計134テストが合格。
- `npx tsc --noEmit` とclient変更ファイルeslintが合格。
- コミット: `f3036af 同時GETリクエストを共有してHome初期化を高速化`

## 制約

稼働中port 3000はworkspaceではなく古いproduction mirrorを実行中のため、runtimeで重複GETが1回になることは未計測。AGENTS.mdの制約によりビルド・host再起動は実施しない。

---

## 日付

2026-08-11

## 変更

`web/src/lib/opencode-extensions/provider-models.ts` のOpenCode `/provider` 生レスポンスキャッシュをモジュール変数から `globalThis.__opencodeWebuiProviderResponseCache` へ移行。Next devのモジュール再評価後も5秒TTLのキャッシュを保持できるようにした。

## 検証

- `provider-models.test.ts` に動的再import後も `ocServer` が再呼び出しされない回帰テストを追加。
- provider-models/API route 43テスト、tsc、eslintが合格。
- コミット: `7560011` 実装、`4a41a23` 回帰テスト。
- 稼働中のport 3000はworkspaceではなく、2026-08-11 07:10生成の古いmirrorを実行中。runtime改善値は未検証。AGENTS.mdの制約によりビルド・再起動は実施しない。

---

## 日付

2026-08-11

## 根本原因

`listProviderModels()` はHome起動のたびにOpenCode `/provider` の結果だけでなく、`opencode.jsonc` の同期読み込み・JSONC parseも繰り返していた。`listTasks()` の `sessionMetaFor()` は、コスト0かつtokens/modelがある全セッションの `/message` をディレクトリ内で逐次awaitしており、OpenCodeWebUI 60件、Download 50件など最大119件の推定候補があった。

## 修正

- `provider-models.ts`: 設定ファイルをmtime+sizeで判定する parsed-root キャッシュを追加。設定変更時はmtime変化で再読込する。テスト用キャッシュクリアを追加。
- `task-service.ts`: transcript-based cost estimate をディレクトリごとに4件ずつ並列取得し、OpenCodeへの無制限なリクエストバーストを避けながら逐次待ちを排除。
- `task-service.test.ts`: 9セッションで最大同時 `/message` 数が4である回帰テストを追加。

## 計測

- `/api/tasks`: 修正前初回0.286s、修正後初回0.266s、ウォーム後0.075-0.087s。ただし既存のsession estimate cacheがウォーム済みで、並列化単独の効果は限定的な比較。
- 実セッション調査: 4ディレクトリ、推定候補119件。`/message` 単体は約8-804ms。

## 検証

- 関連テスト: 3ファイル66テスト合格。
- `npx tsc --noEmit`: 合格。
- 変更ファイルeslint: 合格。
- 全体テストでは変更対象外の `TaskView.test.tsx` が「コスト $0.2500」期待値で単体再現。`MessageMetaHeader.test.tsx` は単体8/8合格。

## コミット

`f85336b タスク一覧のセッション推定とプロバイダー設定読み込みを高速化`

---

## 日付

2026-08-11

## 実装内容

- スラッシュコマンド候補の選択状態を淡い背景色に変更し、濃いアクセント背景による説明文の低コントラストを解消した。
- スキル名を太字、説明を独立した2行目として表示し、説明は最大2行まで読めるようにした。
- 候補ポップアップの最大高さを拡大し、候補の視認性を改善した。
- 説明表示と選択状態の回帰テストを追加した。

## 検証結果

- `npm.cmd test -- --run src/components/SlashSuggestMenu.test.tsx` ... 2 tests 成功
- `npm.cmd run typecheck` ... 成功
- 対象ファイルの ESLint ... 成功
- `git diff --check` ... 成功（既存ファイルの改行コード警告のみ）

# 作業ログ: プロバイダー/モデルへのローカルOllama追加

## 日付

2026-08-11

## 実装内容

- `ProviderModelsSettings` にローカルOllama用の登録プリセットを追加。
- `http://127.0.0.1:11434/v1` をBase URLに設定し、OllamaステータスAPIから取得済みモデルを登録フォームへ自動入力する。
- Ollama未導入またはモデル未取得時は `qwen2.5vl:7b` を既定モデルとして提示する。

## 検証

- `npm run typecheck` 成功
- `ProviderModelsSettings.test.tsx` 33件成功
- 対象ファイルの ESLint 成功

# 作業ログ: ワークフロー機能の設定トグル追加（デフォルトOFF）

## 日付
2026-08-11

## 作業内容

設定画面からワークフロー機能（Workflow開始モード）の有効化/無効化を切り替えられるようにした。デフォルトはOFF。

### workflow-feature.ts
- `WORKFLOW_MODE_SETTING_KEY = "workflow-mode"` を追加。
- `resolveWorkflowModeServer()` を新設し、`settings` テーブル → env変数 → デフォルト(false) の順で解決。
- `isWorkflowModeEnabled()` をDB読み取りベースへ変更。即時反映（サーバープロセスは次回tickで新しいDB値を読む）。

### settings route
- `ALLOWED_KEYS` と `BOOLEAN_SETTING_KEYS` に `workflow-mode` を追加。`"1"` / `""` でON/OFF。

### /api/health
- レスポンスに `workflowModeEnabled: isWorkflowModeEnabled()` を追加。
- `HealthDto` に `workflowModeEnabled?: boolean` を追加。

### SettingsView
- 「実行」セクションに「ワークフロー機能を有効化」チェックボックスを追加。
- `PUT /api/settings/workflow-mode` へ反映。`/api/health` から状態を取得。

### HomeView
- `/api/health` から `workflowModeEnabled` を取得し、開始モードセレクトの「Workflowで開始」オプション表示と送信可否を制御。
- 無効時はセレクトをTask固定へ戻すeffectを追加。

## 検証結果

- `npx tsc --noEmit` (web) ... 成功
- `npx eslint` 対象ファイル ... 成功
- `npx vitest run` workflow-feature / workflow-graph-feature / settings route / HomeView / workflow API / workflow-scheduler ... 156 tests 成功

## 変更ファイル

- web/src/lib/workflow-feature.ts
- web/src/lib/workflow-feature.test.ts
- web/src/lib/workflow-graph-feature.test.ts
- web/src/lib/types.ts
- web/src/app/api/settings/[key]/route.ts
- web/src/app/api/settings/[key]/route.test.ts
- web/src/app/api/health/route.ts
- web/src/components/settings/SettingsView.tsx
- web/src/components/home/HomeView.tsx
- web/src/components/home/HomeView.test.tsx

---

# 作業ログ: プロジェクトの削除ボタンをアーカイブボタンへ変更

## 日付
2026-08-11

## 作業内容

タスクのアーカイブ機能と同様に、プロジェクトも「削除」→「アーカイブ」フローに変更した。

### DB
- `web/src/lib/db.ts`: `projects` テーブルに `archived INTEGER NOT NULL DEFAULT 0` 列を追加（新規テーブル定義＋既存DB向けALTER TABLE マイグレーション）。
- `ProjectRow` 型に `archived: number` を追加。
- `listProjects()` は `WHERE archived = 0` で未アーカイブのみ返すよう変更。
- 新規 `listArchivedProjects()` と `setProjectArchived(id, archived)` を追加。

### workspace-service
- `archiveProject(projectId)`: 全 active ワークスペースを archived に切替（ワークフロー停止含む）＋ プロジェクト行を archived=1。
- `restoreProject(projectId)`: プロジェクト行を archived=0（配下ワークスペースは個別復元）。
- `destroyProject(projectId)`: アーカイブ済みプロジェクトのみ完全削除可能に制約追加（未アーカイブなら 409）。
- `ProjectDto` 型に `archived: boolean` を追加。

### API
- `PATCH /api/projects/[id]/archive` 新設。
- `PATCH /api/projects/[id]/restore` 新設。
- `GET /api/projects/archived` 新設。
- `GET/PATCH/POST /api/projects` のレスポンスに `archived` フィールドを含めるよう更新。

### UI
- `Sidebar.tsx`: プロジェクト行の削除ボタンをアーカイブボタン（Archive アイコン）に置換。サイドバー下部に「アーカイブ済みプロジェクト」折りたたみセクションを新設し、復元（ArchiveRestore）と完全削除（Trash2）ボタンを配置。展開状態は localStorage に永続化。
- `SettingsView.tsx`: プロジェクトタブの削除ボタンをアーカイブボタンに置換。アーカイブ済みプロジェクト専用セクションを新設し、復元・完全削除（確認ダイアログ付き）を配置。`/api/projects/archived` を refresh で取得。

### テスト
- `SettingsView.test.tsx`: 削除確認テストをアーカイブテストに書き換え。各モックに `/api/projects/archived` を追加。
- `Sidebar.test.tsx`: beforeEach モックに `/api/projects/archived` を追加。

## 検証結果

- `npx tsc --noEmit` (web) ... 成功
- `npx eslint` 対象ファイル ... 成功
- `npx vitest run` SettingsView / Sidebar / projects route / workspace-service / db / task-service / HomeView / AddProjectButton ... すべて成功

## 変更ファイル

- web/src/lib/db.ts
- web/src/lib/workspace-service.ts
- web/src/lib/types.ts
- web/src/app/api/projects/route.ts
- web/src/app/api/projects/[id]/archive/route.ts (新規)
- web/src/app/api/projects/[id]/restore/route.ts (新規)
- web/src/app/api/projects/archived/route.ts (新規)
- web/src/components/shell/Sidebar.tsx
- web/src/components/shell/Sidebar.test.tsx
- web/src/components/settings/SettingsView.tsx
- web/src/components/settings/SettingsView.test.tsx

---

# 作業ログ: プロファイルリネームのEPERM対策

## 日付
2026-08-11

## 実装内容

- アクティブプロファイルのディレクトリをリネームする際、WindowsがジャンクションターゲットのリネームをEPERMで拒否する問題を修正。
- ジャンクションを先に削除してからディレクトリをリネームし、新パスへジャンクションを再作成するフローに変更。
- それでもEPERMが出る場合（プロセスがディレクトリを掴んでいる等）は `fs.cpSync` でコピー後に旧ディレクトリを削除するフォールバックを追加。
- EPERMフォールバックのテストを1件追加（計28件）。

## 検証結果

- `npx vitest run src/lib/profiles/service.test.ts` ... 28件成功
- `npx tsc --noEmit` ... 成功
- `npx eslint`（対象ファイル） ... 成功

---

# 作業ログ: プロファイル名変更で実ディレクトリもリネーム

## 日付
2026-08-11

## 実装内容

- `renameProfile` を拡張し、管理下プロファイル（`profilesRoot` 内）の名前変更時に実ディレクトリも slug ベースでリネームするようにした。
- アクティブプロファイルをリネームした場合は `swapLink` でジャンクションも新パスへ追従させる。外部プロファイルは従来通りラベルのみ変更。
- 重複slug衝突の防止、リネーム先既存ディレクトリの拒否、リネーム失敗時のエラー返却を実装。
- `service.test.ts` に管理下/非アクティブ/外部プロファイルのリネーム追従テストを3件追加。

## 検証結果

- `npx vitest run src/lib/profiles/service.test.ts` ... 27件成功
- `npx tsc --noEmit` ... 成功
- `npx eslint`（対象ファイル） ... 成功

---

# 作業ログ: EXE起動直後のHomeView/TaskView軽量化

## 作業ログ: プロジェクト設定のスキルタブ

## 日付

2026-08-11

## 実装内容

- プロジェクト設定に「スキル」タブを追加し、`.opencode/skills/<name>/SKILL.md` の一覧表示・新規作成・編集・削除に対応した。
- プロジェクトスキル用APIとして `GET/POST /api/projects/[id]/skills` と `GET/PUT/DELETE /api/projects/[id]/skills/[name]` を追加した。
- スキル名を安全な文字種に限定し、2MB上限、プロジェクトルート内判定、シンボリックリンク拒否を実装した。削除時はスキルの補助ファイルを含むディレクトリ全体を削除する。
- UIテストとファイル操作の単体テストを追加した。

## 検証結果

- `npm run typecheck`（web）... 成功
- 対象ファイルのESLint ... 成功
- `ProjectSettingsView.test.tsx` / `project-skills.test.ts` ... 5件成功、Windowsでシンボリックリンク作成権限に依存する1件はスキップ

## 日付

2026-08-10

## 調査

- `web/src/components/task/TaskView.tsx` は180k文字超・フック182個・useMemo/useCallback多数。初期レンダリング時にメッセージ配列の派生計算（timeline/planPaths/siblingTaskCallIds/sessionTouchedPaths/contextUsage/cumulativeCost等）が毎回全メッセージを走査している。
- `web/src/components/home/HomeView.tsx` も同様に、起動直後の `/provider` / `/config` / `/agent` / `/extensions/provider-models` / `/qwen-native/status` を一括並列取得し、モデルoptionのfilter/sort/mergeを実行している。
- `useSessionStream` はセッション切替時に前セッションの `messages` を一瞬返しうる構造だったが、実際には既に `visibleState` でガード済み。重たさの主因は派生計算の計算量と、即座にレンダリングされる右パネル/WorkflowPanel/PtyPanelの初期化・内部副作用である。

## 実装内容

- `web/src/components/task/TaskView.tsx`:
  - `WorkflowPanel` / `PtyPanel` を `React.lazy` + `Suspense` で遅延読み込み。初期表示時にこれらの重たいパネルを評価・マウントしないようにした。ターミナルパネルは開いたときだけ読み込まれる。
  - `workflowVisible` の三項演算子を `<>...</>` Fragmentで正しく閉じ、typecheckが通る形に修正。
- `web/src/components/task/TaskView.test.tsx`:
  - `PtyPanel` に加え `WorkflowPanel` のモックを追加し、lazy読み込み後もテストが `data-testid` を解決できるようにした。
  - ターミナルパネルの `data-testid` を親wrapperに移動し、lazy読み込みで実コンポーネントが即座に解決されない環境でもテストが通るようにした。
- `web/src/lib/useSessionStream.ts`:
  - セッション切替時のstateガードコメントを明確化。`visibleState` のみを返し、前セッションの `messages` が漏れる余地がないことを注記した（既存ロジックは変更なし）。

## 検証結果

- `npm run typecheck`（web）... 成功
- `npm run lint`（対象ファイル）... 成功
- `npm run test -- --run src/lib/useSessionStream.test.ts src/components/task/TaskView.test.tsx src/components/task/PtyPanel.test.tsx src/components/task/WorkflowPanel.test.tsx` ... 199 tests 成功

## 変更ファイル

- `web/src/components/task/TaskView.tsx`
- `web/src/components/task/TaskView.test.tsx`
- `web/src/lib/useSessionStream.ts`

# 作業ログ: Qwen-MM-Plugins MCP 初回接続タイムアウト修正

# 作業ログ: OpenCode登録済み画像モデルによる事前解析

## 日付

2026-08-10

## バグハント

- 画像解析の環境変数（`OPENCODE_WEBUI_QWEN_LOCAL_BASE_URL` / `MODEL` / `API_KEY`）を指定しても、永続設定の `source: opencode` が優先されてOpenCode登録モデルへ誤接続する不具合を修正。環境変数が指定された場合はendpoint経路を選択する。
- `scripts/start-webui.bat` はOllamaをwinget導入した直後、PATH未反映を理由にモデルPullをスキップしていた。WinGet Links / Program Filesの絶対パスを使って導入直後もPullするよう修正。
- `qwen-native-vision.test.ts` が開発環境の永続設定を読み、テスト結果が実ユーザー設定に依存していたため、設定をモック化。

## 検証結果

- 対象画像解析・OpenCodeプロキシテスト 57件 成功
- `npm run typecheck` / `npm run lint -- --quiet`（web） 成功
- `npm run test:encoding` 成功
- 全体テストで開発環境の永続画像解析設定に依存していた `/api/tasks` Auto画像解析テストを検出し、endpoint環境変数を明示して安定化。`src/app/api/tasks/route.test.ts` 単独88件成功。

## 実装内容

- 画像解析設定へ `source: endpoint | opencode` と `opencodeModel` を追加した。既存設定は `endpoint` として移行する。
- `GET /api/qwen-native/models` を追加し、OpenCode `/provider` の接続済みプロバイダーから画像/添付入力対応モデルだけを返すようにした。
- 設定画面に「OpenCode登録モデル」「OpenAI互換エンドポイント」の接続方式切替と、画像対応モデル選択欄を追加した。
- OpenCode方式はツール無効の一時セッションへ画像と解析指示を送り、同期応答を取得後にセッションを削除する。登録済み認証情報をOpenCode側で利用し、WebUIへAPIキーを複製しない。
- 初期タスクと継続プロンプトの両方で作業ディレクトリを解析処理へ渡す。
- 実環境の `/provider` から OpenCode Go、Anthropic、Ollama Cloud、OpenAI等の画像対応モデル候補を取得できることを確認した。

## 検証

- 関連181件、typecheck、Lint成功

# 作業ログ: Ollama画像解析の実接続確認

## 日付

2026-08-10

## 確認結果

- `http://127.0.0.1:11434/api/tags` でOllamaの稼働と `qwen2.5vl:7b` の導入を確認した。
- WebUIの画像解析設定は有効、Base URLは `http://127.0.0.1:11434/v1`、モデルは `qwen2.5vl:7b` であることを確認した。
- WebUIが使うOpenAI互換の `/v1/chat/completions` へ `web/public/icon-192.png` をdata URLで送信し、画像内の青い角丸四角形、白い矢印と矩形、文字なしという内容に沿った応答を取得した。
- Ollama画像事前解析の設定済み経路は正常に動作している。
- 同一画像を `max_tokens=256` で再計測した通常時レイテンシは約20.9秒（334文字の応答）。短文チャットには遅めだが、コード作業など応答自体が長いタスクの補助としては許容範囲。

# 作業ログ: 画像解析利用モデルの目印表示

## 日付

2026-08-10

## 実装内容

- `ModelSelect` に `imageAnalysisAvailable` を追加した。
- 画像解析が有効な場合、直接画像入力に非対応のモデルへ黄色の目アイコンを表示する。画像/添付対応モデルは既存の画像アイコンを表示する。
- HomeView / TaskView からネイティブ画像解析の有効状態を渡すようにした。
- `capabilities.attachment` が有効なモデルも、直接画像対応として扱うよう補正した。

## 検証

- ModelSelect / HomeView / TaskView の関連186件、typecheck、Lint成功

# 作業ログ: Ollamaセットアップ自動化

## 日付

2026-08-10

## 実装内容

- `web/src/lib/ollama-cli.ts` を新設: Ollama本体の導入検知・バージョン取得・モデル一覧・モデルPull・winget経由の自動インストールを提供。
- APIルートを新設:
  - `GET /api/ollama/status`: インストール有無・サービス起動状態・バージョン・取得済みモデル一覧を返す。
  - `POST /api/ollama/install`: winget経由でOllama本体をインストール（Windowsのみ）。
  - `POST /api/ollama/pull`: 指定モデルをPull。
- `VisionSettings.tsx` に「Ollama 導入状況」パネルを追加。インストール状態・サービス状態・取得済みモデルを表示し、未導入時は「Ollama を winget でインストール」ボタン、導入済み時は「設定中のモデルをPull」ボタンを提供。
- `scripts/start-webui.bat` に `:check_ollama` を追加（Caddyと同じくオプション扱い・起動ブロックしない）。`OPENCODE_WEBUI_QWEN_NATIVE=1` または `qwen-native-settings.json` 存在時に限り、winget経由でOllamaをインストールし `qwen2.5vl:7b` をPull。`OPENCODE_WEBUI_OLLAMA=0` でスキップ可能。モデルは `OPENCODE_WEBUI_OLLAMA_MODEL` で変更可。
- 既存テストの `isQwenNativeVisionAvailable` を環境変数のみ判定するようモック化し、開発者の実際の設定ファイルに依存しないよう隔離。

## 検証

- typecheck / Lint 成功
- 関連398件のテスト成功（ollama-cli.test.ts / qwen-native / SettingsView / opencode route / tasks route 等）
- `test:encoding` 7件成功 / `start-webui-bat.test.js` 20件成功

# 作業ログ: Qwen画像解析のWebUIネイティブ統合

# 作業ログ: 画像解析設定タブ新設

## 日付

2026-08-10

## 実装内容

- 設定画面に「画像解析」タブを新設し、ローカルOllama Qwen Visionの接続先・モデル・APIキー・タイムアウト・最大トークンをUIから変更できるようにした。
- `web/src/lib/profiles/settings.ts` に `QwenNativeSettings` 型と `readQwenNativeSettings` / `writeQwenNativeSettings` / `QWEN_NATIVE_DEFAULTS` を追加し、`%APPDATA%/opencode-webui/qwen-native-settings.json` へ永続化する。
- `web/src/lib/qwen-native-vision.ts` を更新し、環境変数を優先しつつファイル設定を読む `resolveSettings()` 経由で各種値を解決するようにした。
- `web/src/app/api/qwen-native/settings/route.ts` (GET/PUT) を新設し、設定の読み書きAPIを提供する。
- `web/src/components/settings/VisionSettings.tsx` を新設し、有効化切替・Base URL・モデル・APIキー・タイムアウト・最大トークンの編集と保存、利用状態表示を行う。
- `SettingsView.tsx` に `vision` タブを登録した。
- 既存の `OPENCODE_WEBUI_QWEN_NATIVE=1` 等の環境変数は引き続き最優先。ファイル設定はフォールバック。

## 更新: 事前解析モデルのリモート対応

- `VisionSettings.tsx` のラベル・説明・プレースホルダーを「ローカルOllama前提」から「OpenAI互換エンドポイント全般」へ汎用化した。
- Base URL・モデル名・APIキーの各欄にリモートプロバイダー（OpenAI・Gemini・DashScope等）の例を併記した。
- コア実装（`qwen-native-vision.ts`）は既にOpenAI互換 `/chat/completions` を呼ぶため変更不要。
- READMEの説明文も汎用化し、設定画面からのリモートエンドポイント指定が可能である旨を追記した。

## 検証

- typecheck / Lint 成功
- `settings.test.ts` / `qwen-native/settings/route.test.ts` / `qwen-native-vision.test.ts` / `SettingsView.test.tsx` など関連392件のテスト成功
- `test:encoding` 7件成功 / `start-webui-bat.test.js` 20件成功

# 作業ログ: Qwen-MM-Plugins MCPセットアップの削除

## 日付

2026-08-10

## 実装内容

- 新規プロファイル設定、プロファイル依存適用、初回起動バッチからQwen-MM-Plugins MCPの登録・uv導入を削除した。
- 専用MCPインストーラ、関連バッチ、テストを削除した。
- 実行時のMCP画像fallbackを削除し、画像非対応モデルの補助経路はローカルOllamaのQwen Visionだけにした。
- 既存のOpenCode設定にあるMCPエントリは、ユーザー設定を勝手に変更しないため自動削除していない。
- READMEとプロファイル設定UI/APIをローカルOllama前提へ更新した。

## 日付

2026-08-10

## 実装内容

- 画像非対応モデルへの画像送信時、WebUIのBFFがローカルOllama OpenAI互換APIを直接呼び、`qwen2.5vl:7b`の視覚解析結果を元の依頼へ内部コンテキストとして追加するようにした。
- 初期タスク、Autoモデル選択、継続プロンプトのv1 `parts` / v2 `prompt.files`へ統合した。画像対応モデルは従来どおり画像を直接受け取り、Qwen事前解析を行わない。
- `OPENCODE_WEBUI_QWEN_NATIVE=1`でMCP接続不要で利用可能。ネイティブ解析が無効または失敗した場合は、Qwen MCPが接続済みなら従来のMCPツール指示方式へ自動fallbackする。
- `GET /api/qwen-mm/status`を追加し、接続先やAPIキーを公開せず利用可否だけをHomeView / TaskViewへ返すようにした。
- 解析結果を画像由来の未信頼データとして明示し、画像内の命令を実行指示として扱わないよう境界文を追加した。
- `OPENCODE_WEBUI_QWEN_LOCAL_MODEL` / `OPENCODE_WEBUI_QWEN_LOCAL_BASE_URL`で解析モデル・接続先を変更可能。`OPENCODE_WEBUI_QWEN_NATIVE=0`でネイティブ統合を無効化できる。

## 検証結果

- Qwenネイティブクライアント、状態API、初期タスク、proxy、HomeView、TaskViewの関連テスト ... 327 tests 成功
- ネイティブ解析失敗から接続済みMCPへのfallbackテスト ... 成功
- `verifySession`が通常セッション検証時にも送る`trustedDeviceToken: null`へ既存テストの期待値を合わせ、全体テストをgreenへ戻した。
- Web全体テスト ... 257 files / 3041 tests 成功
- `npm.cmd run typecheck` / `npm.cmd run lint` / `git diff --check` ... 成功
- 現環境ではOllamaを起動していないため、実ローカルモデルによる画像回答は未確認。

# 作業ログ: 画像非対応モデル向け Qwen-MM-Plugins fallback

## 日付

2026-08-10

## 実装内容

- 初期タスク作成で、選択モデルが画像入力非対応でもQwen-MM-Plugins MCPが接続済みなら画像を受け付けるようにした。
- 画像のdata URLを `%APPDATA%/opencode-webui/qwen-mm-attachments/<sessionId>/` に保存し、text-onlyモデルへ `vision_chat` / `ocr` を使う指示と絶対パスを渡す。古い添付は7日後にbest effortで削除する。
- Auto＋画像では、Qwen MCP接続時に画像対応モデルだけへ絞らず、適切なtext-onlyモデルも候補にできるようにした。
- 継続プロンプトのv1 `parts` とv2 `prompt.files` も、画像非対応モデルの場合だけ同じfallbackへ変換し、画像対応モデルと非画像ファイルは従来どおり通す。
- HomeView / TaskView が `/api/extensions/mcp` の接続状態を確認し、Qwen MCP接続時は画像添付UIを有効化する。MCP未接続かつ画像非対応の場合だけ警告・送信拒否する。

## 検証結果

- fallback、初期タスク、proxy、HomeView、TaskViewの関連テスト ... 319 tests 成功
- `npm.cmd run typecheck` ... 成功
- `npm.cmd run lint` ... 成功
- Web全体テスト ... 3032/3033 成功。`src/lib/session.test.ts` の1件は既存の認証テスト不一致（実装が送る `trustedDeviceToken: null` を期待値が含まない）で、本変更とは無関係。
- 現環境の `DASHSCOPE_API_KEY` は未設定のため、実際のQwen `vision_chat` / OCR APIによる画像回答は未確認。

## 日付

2026-08-10

## 原因

- OpenCode のローカル MCP 接続タイムアウトは既定30秒。
- Qwen-MM-Plugins `core` は初回 `uvx` 起動時に Git リポジトリと Python 依存を取得・展開するため、初回接続が `Operation timed out after 30000ms` になった。
- `uvx` の同じコマンドを依存キャッシュ後に直接MCPクライアントから起動すると14ツールを正常列挙でき、パッケージコマンド自体の誤りではなかった。

## 修正内容

- `qwen-mm-plugins-core` のMCPエントリに `timeout: 300000`（5分）を追加。
- グローバル初回セットアップのQwen MCP登録を `--force` にし、旧エントリ（timeoutなし）も次回起動時に管理対象設定へ更新する。
- プロファイル新規作成・複製用のQwen MCPエントリにも同じ5分タイムアウトを追加。
- 実環境の `C:\Users\Daichi\.config\opencode\opencode.jsonc` を更新し、OpenCodeを再起動した。

## 実機検証

- `GET http://127.0.0.1:4096/mcp` ... `qwen-mm-plugins-core: connected`
- `GET http://127.0.0.1:3000/api/extensions/mcp` ... `runtime: connected`, `pendingRestart: false`

## テスト

- Qwen MCPインストーラ ... 14 tests 成功
- プロファイル依存/API/UI ... 34 tests 成功
- start-webui / bat encoding ... 31 tests 成功
- WebUI typecheck / 対象ESLint / `git diff --check` ... 成功

# 作業ログ: プロファイル新規作成時の Qwen-MM-Plugins セットアップ

## 日付

2026-08-10

## 実装内容

- プロファイル設定画面の「新規作成時のセットアップ」に `Qwen-MM-Plugins` チェックボックスを追加し、既定で有効化した。
- 新規プロファイル作成・複製・既存プロファイルへの依存適用で、`mcp.qwen-mm-plugins-core` を未設定時だけ追加する。
- MCP は `uvx --from "qwen-mm-plugins[core] @ git+https://github.com/QwenLM/Qwen-MM-Plugins.git@main" qwen-mm-plugins-core` を実行し、DashScope/Serper の環境変数を引き継ぐ。
- 保存済みの旧設定ファイルは `qwenMm` 欠落時に有効として読み、既存利用者にも既定値を適用する。

## 検証結果

- `npm.cmd test -- --run src/lib/profiles/webui-dependencies.test.ts src/app/api/profiles/settings/route.test.ts src/components/settings/ProfilesSettings.test.tsx` ... 34 tests 成功
- `npm.cmd run typecheck` ... 成功
- 対象 ESLint / `git diff --check` ... 成功

# 作業ログ: 手動モデル価格設定（コスト未返却モデル対応）

# 作業ログ: EXE起動時のブラウザ自動起動設定

## 日付

2026-08-10

## 実装内容

- EXE 起動時のブラウザ自動起動をデフォルト OFF に変更した。既存の `OPENCODE_WEBUI_NO_BROWSER=1` による抑止も維持。
- `%APPDATA%/opencode-webui/browser-config.json` に `autoOpenBrowser` を保存し、設定画面の「全般」から ON/OFF を切り替えられるようにした。
- ホスト制御 API と WebUI の BFF API を追加。トレイメニューの手動「Open browser」は従来どおり利用可能。

## 検証結果

- `host` の全テスト ... 379 tests 成功
- ブラウザ設定・制御サーバー対象テスト ... 90 tests 成功
- `npm run typecheck`（web）... 成功
- ESLint は既存依存の ESLint 10 と `eslint-config-next` の互換性エラーで実行不可

# 作業ログ: プロジェクト固有設定ファイルの編集画面

## 日付

2026-08-10

## 実装内容

- 各プロジェクト専用の設定画面 `/project/[id]/settings` を追加し、サイドバーと全体設定のプロジェクト一覧から移動できるようにした。
- `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`.github/copilot-instructions.md`、`opencode.json`、`opencode.jsonc` の内容を読み込み、新規作成・編集できるようにした。
- `GET/PATCH /api/projects/[id]/settings` を追加した。DBに登録されたプロジェクトルートと固定ファイルリストを使い、プロジェクト外のパスやシンボリックリンクへの書き込み、2MB超の内容を拒否する。

## 検証結果

- `npm run typecheck`（web）... 成功
- 対象ファイルのESLint ... 成功
- 新規APIテスト ... 4 tests 成功
- 新規設定画面テスト ... 1 test 成功
- `Sidebar.test.tsx` / `SettingsView.test.tsx` ... 70 tests 成功

# 作業ログ: プロジェクト固有サブエージェント編集機能

## 日付

2026-08-10

## 実装内容

- プロジェクト設定画面に「サブエージェント」タブを追加し、各プロジェクトの `.opencode/agent(s)/*.md` を作成・編集・削除できるようにした。
- `src/lib/project-agents.ts` を新設し、プロジェクトルート配下のエージェント定義ファイルを安全に列挙・読み書き・削除するヘルパーを提供。パストラバーサル・シンボリックリンク外部書き込み・2MB超を拒否。
- `GET/POST /api/projects/[id]/agents` で一覧・作成、`GET/PUT/DELETE /api/projects/[id]/agents/[name]` で個別読み書き削除を行うAPIを追加。
- 設定ファイル編集タブとサブエージェントタブを切り替えられるUIにリファクタリング。

## 検証結果

- `npm run typecheck`（web）... 成功
- 対象ファイルのESLint ... 成功
- 新規agents APIテスト ... 6 tests 成功
- 新規設定画面テスト（ファイル保存+サブエージェント作成・保存）... 2 tests 成功
- 既存テスト（Sidebar / SettingsView / settings route）... 74 tests 成功

# 調査ログ: デフォルトモデルが再起動後にリセットされたように見える原因

## 日付

2026-08-10

## 結論

- デフォルトモデルの保存値自体は再起動で消えていない。`web/src/lib/db.ts` は `%APPDATA%/opencode-webui/webui.db` の `settings` テーブルへ保存し、稼働中の SQLite と `/api/settings/default-model` はどちらも `openai::gpt-5.6-luna` を返した。
- 主因は、再起動後に Caddy/Tailscale の IP・ポート・HTTP/HTTPS が変わって別 origin になると、origin 単位の `localStorage` (`webui:default-model`) が空になること。
- `HomeView.tsx` と `TaskView.tsx` の DB 復元 effect は、サーバー値を取得した後に `writeDefaultModel(serverValue)` で localStorage へ書くだけで、既に実行済みのモデル選択処理へ `setModel` を行わない。特に `HomeView` は `DEFAULT_MODEL_EVENT` を購読していないため、先に provider/config 取得が完了すると fallback のモデル選択がそのまま残る。
- `ProviderModelsSettings.tsx` 自体は DB 値を再取得して表示するため、設定画面ではなく新規タスク composer の選択がリセットされたように見える。`TaskView` もイベント購読はあるが、モデル options 読み込み前のイベントは無視されるため同じ競合余地がある。

## 根拠

- `web/src/lib/default-model.ts`: サーバー読み込みは非同期で、失敗も `null` として握りつぶす。
- `web/src/components/home/HomeView.tsx`: DB 復元後は localStorage 書き込みのみ、モデル初期化は別 effect 内の `readDefaultModel()` 一回だけ。
- `web/src/app/api/settings/[key]/route.ts`: `default-model` は allowlist 対象で `setSetting` に保存される。起動時に値を空へ戻す処理はない。
- 実稼働確認: SQLite の `settings.default-model` と `GET /api/settings/default-model` は同値を返した。

## 検証

- `src/lib/default-model.test.ts`、`src/app/api/settings/[key]/route.test.ts`、`src/components/settings/ProviderModelsSettings.test.tsx`: 95 tests 成功。
- `src/components/home/HomeView.test.tsx`: 58 tests 成功。ただし DB 復元後の composer state 更新を検証する回帰テストは未実装。

## 修正

- `HomeView` / `TaskView` がサーバー復元値を state として保持し、provider options の読み込み後にも一度適用するよう変更。
- 手動モデル選択、Auto タスク、既存タスクの assistant モデル、Goal Loop の選択はサーバー復元で上書きしない。
- HomeView に hydration race の回帰テストを追加。
- `HomeView.test.tsx` / `TaskView.test.tsx` の関連 177 tests、typecheck、lint が成功。

## 日付

2026-08-10

### 依頼

使用コストが返ってこないモデルを、設定→プロバイダー/モデルから手動設定できるようにする。

### 実装内容

- `provider-model-state.ts` に `modelPricing`（`providerID::modelID` → USD/100万トークン）を追加し、読み書き・削除を実装。
- `ProviderModelDto` に `pricing` を追加し、`listProviderModels` が各モデルの手動価格を返すようにした。
- `PATCH /api/extensions/provider-models/[key]` に `{ pricing }` 分岐を追加（`null` でクリア、0以上の数値検証）。
- `openai-pricing.ts` の `estimateOpenAIApiCost` に手動価格引数を追加し、`catalogPrice` を分離。
- クライアント側レジストリ `model-pricing-registry.ts` を新設し、HomeView/TaskView がプロバイダー一覧取得時に手動価格を登録。MessageMetaHeader/TaskView の推定コストが手動価格を優先。
- サーバー側 `task-service.ts` は `readProviderModelState().modelPricing` を直接参照して推定。
- `ProviderModelsSettings.tsx` にモデル行の「価格設定」インラインエディタ（input/output/cachedInput/cacheWrite）を追加。

### 検証結果

- `npx tsc --noEmit`（web）... 成功
- `npx eslint`（対象ファイル）... 成功
- 関連テスト（openai-pricing / task-service / ProviderModelsSettings / provider-models route / provider-model-state）... 全件成功
- Web全体テスト ... 3010/3011 成功（`session.test.ts` の1件は本変更と無関係の既存未コミット認証作業由来）

# 作業ログ: 承認済み端末のログイン省略

## 日付

2026-08-10

### 実装内容

- ログイン画面に「この端末を承認し、次回からログインを省略する」選択肢を追加した。
- 承認時はランダムな端末トークンを HttpOnly/SameSite=Strict Cookie として発行し、サーバー側には SHA-256 ハッシュだけを90日保存する。
- 承認トークンは通常セッションと同じ API 認可・ログインゲートの検証経路で利用するため、承認済み端末は再ログイン不要となる。
- 明示的なログアウトでは当該端末トークンをサーバー側で失効し、Cookieも削除する。

### 検証結果

- Web認証関連テスト ... 3 files / 36 tests 成功
- Host認証関連テスト ... 90 tests 成功
- `npm.cmd run typecheck`（web）... 成功

# 作業ログ: バグハント完了

## 応答ごとのトークン消費表示

### 日付

2026-08-10

### 修正内容

- 応答メタ情報で、コンテキスト全体を含む `tokens.total` ではなく、その応答の `output + reasoning` トークンを表示するようにした。
- 累計トークンを個別応答のトークン数として誤認しないよう回帰テストを更新した。

### 検証結果

- `npm.cmd test -- --run src/components/task/MessageMetaHeader.test.tsx` ... 8 tests 成功
- `npm.cmd run typecheck` ... 成功
- `npx.cmd eslint src/components/task/MessageMetaHeader.tsx src/components/task/MessageMetaHeader.test.tsx` ... 成功

## 日付

2026-08-10

## 権限確認 UI の診断通信除去

### 修正内容

- 非フルアクセス時に表示される権限キューと質問カードから、ローカル診断サーバー (`127.0.0.1:52338`) への `fetch` を削除した。
- 承認・回答のクリック中に UI と無関係な通信、CORS エラー、コンソールノイズが発生しないようにした。
- 権限と質問の応答で診断通信を発生させない回帰テストを追加した。

### 検証結果

- `npm.cmd test -- --run src/components/task/QuestionCard.test.tsx src/components/shell/AttentionQueueModal.test.tsx src/components/task/PermissionCard.test.tsx src/lib/subagent-permission.test.ts` ... 34 tests 成功
- `npm.cmd run typecheck` ... 成功

## OpenAI公式価格による推定コスト表示

### 修正内容

- OpenAI公式API価格表（`https://platform.openai.com/docs/pricing`）の標準価格とFast mode価格を `web/src/lib/openai-pricing.ts` に追加した。
- OpenCodeの `cost` が0または未提供の場合、OpenAI公式価格と応答の入力・出力・推論・キャッシュトークンからUSDコストを推定する。
- 表示通貨とUSD/JPYレートは既存のコスト表示設定を使用し、実測値ではなく「推定」と明記する。
- 公式価格カタログにないモデルは推測せず、価格表示しない。

### 検証結果

- `npm run test -- --run src/components/task/MessageMetaHeader.test.tsx` ... 8 tests 成功
- `npm run typecheck` ... 成功
- `npx eslint src/components/task/MessageMetaHeader.tsx src/lib/openai-pricing.ts` ... 成功

## エージェント応答のトークン表示

### 日付

2026-08-10

### 修正内容

- 個別のエージェント応答メタ情報に `info.tokens.total` を「トークン」として追加した。
- 時刻の直後に表示し、トークンが0件の場合は表示しない。

### 検証結果

- `npm test -- --run src/components/task/MessageMetaHeader.test.tsx` ... 7 tests 成功

## 累計トークン表示

### 日付

2026-08-10

### 修正内容

- タスクヘッダーの累計金額と累計思考時間の間に、assistant 応答の `info.tokens.total` を合計した「累計トークン」を追加した。
- 既存の `formatTokens` を使用し、トークンが0件の場合は表示しない。

## 調査: OpenAI系モデルの価格表示

### 日付

2026-08-10

### 結論

- WebUIは応答の `info.cost` が正の数値である場合だけ価格を表示する。
- 実行中および直近の `gpt-5.6-luna` セッションでは、OpenCode APIがトークン数を返す一方で、各応答とセッション累計の `cost` はすべて `0` だった。
- そのため価格表示が消えた原因はWebUIの表示削除ではなく、上流のOpenCode/OpenAI連携が返すコスト値である。金額を推測して表示しない。

## リモート端末のプロジェクト追加

### 日付

2026-08-09

### 修正内容

- プロジェクト追加のアイコン版とラベル付き版は、どちらも同じ `AddProjectButton` を使用している。
- Windowsのリモートブラウザから追加すると接続先ホスト上のネイティブダイアログが開いて待機していたため、ネイティブ選択をloopback URLからの利用時だけに制限した。
- LAN/VPNなど非loopback URLでは、両方のボタンがネイティブAPIを呼ばず即座にWeb内フォルダ選択を開く。

### 検証結果

- `npm test -- --run src/components/AddProjectButton.test.tsx src/components/ui.test.ts` ... 25 tests 成功
- `npm run typecheck` ... 成功

## 日付

2026-08-10

## デバッグ: 相互認識修正後の全体回帰

### 検証結果

- Web全体の `npm run test -- --run` ... 248 files / 2959 tests 成功
- `npm run typecheck` ... 成功
- `npm run lint` ... 成功
- Goal Loop、Workflow Scheduler、OpenCodeプロキシの関連回帰テストも成功した。

### 結論

前ターンで修正した内部セッション送信への相互認識コンテキスト注入に、全体回帰はなかった。

## 日付

2026-08-10

## デバッグ: 内部セッションの相互認識漏れ修正

### 原因

- 相互認識コンテキストはWebUIの `/api/opencode` プロキシを通る手動送信だけに注入されていた。
- Goal LoopとWorkflow Schedulerはサーバー内から `ocServer` を直接呼ぶため、並行セッションの情報を受け取っていなかった。

### 修正内容

- 共通の `prependCollaborationContext` を追加した。
- Goal Loopの通常ターン・完了検証ターンへ相互認識コンテキストを注入した。
- Workflow Schedulerの内部プロンプト送信へ相互認識コンテキストを注入した。
- 既存のプロキシ経由送信も共通ヘルパーを使用するよう整理した。
- 内部送信の回帰テストモックと、コンテキスト付加ヘルパーのテストを追加した。

### 検証結果

- 関連4ファイルのテスト ... 92 tests 成功
- `npm run typecheck` ... 成功
- 対象ファイルの `npm run lint` ... 成功

## 日付

2026-08-10

## デバッグ: ホスト回帰確認

### 検証結果

- `host` の `npm test` ... 377 tests 成功
- `npm run test:encoding` ... 7 tests 成功
- バッチファイルのASCII/CRLF、セットアップメッセージ、配布アーカイブ検査を通過した。
- Web全体、ブラウザブリッジ、ホストの主要テストで失敗は確認されなかった。

### 結論

未確認だったホスト制御・起動・認証・エンコード領域にも再現するバグは見つからなかった。

## 日付

2026-08-10

## デバッグ: ブラウザブリッジ過去ログの再確認

### 調査結果

- `bb-broker.log` に過去の `already-paired extension origin` テスト後処理タイムアウト記録があった。
- `browser-bridge` で `npm test -- --test-name-pattern "already-paired"` を再実行した結果、対象ケースを含む88テストすべて成功した。
- 稼働中WebUIのヘルスチェックは正常だった。
- Browser Bridge の共有タブ一覧は拡張接続切れで取得できなかったが、これは現在の拡張接続状態であり、製品コードのテスト失敗ではない。

### 結論

過去ログのブラウザブリッジ失敗は現行コードでは再現しなかった。追加のコード修正は不要だった。

## 日付

2026-08-10

## デバッグ全体回帰確認

### 検証結果

- Web全体の `npm run test -- --run` ... 248 files / 2958 tests 成功
- Webの `npm run typecheck` ... 成功
- Webの `npm run lint` ... 成功
- 稼働中WebUIの `GET http://127.0.0.1:3000/api/health` ... WebUI/OpenCodeとも正常
- 並行セッション相互認識、メモリ、OpenCodeプロキシ、セッション状態競合の対象テストも全件成功

### 結論

このターンでは再現するバグや新たな失敗は確認できなかった。作業ツリーも検証前からクリーンだった。

## 日付

2026-08-09

## 修正内容

- `useSessionStream` が初期REST `idle` と実際のSSE完了イベントを区別し、初期接続時の `busy` を受け入れつつ、完了後の遅延 `busy` を抑止するようにした。
- `session.next.step.ended` をイベント登録へ追加した。
- TaskViewのモデル・エージェント取得エフェクトをタスクID変更時にも再実行するようにした。
- lintの未使用変数を削除した。

## 検証結果

- Web全体テスト: 248 files / 2957 tests 成功
- `npm run typecheck`: 成功
- `npm run lint`: エラー・警告なし

# 作業ログ: HomeViewのAuto選択をTaskViewへ引き継ぐ

# 作業ログ: バグハント

## 日付

2026-08-09

## 発見事項

- `web/src/lib/useSessionStream.stuck-busy.test.ts` は単独実行でも4件中2件が失敗した。SSEイベントが継続している場合と、送信後にセッションがstatus mapから消えた場合に、期待する `busy` ではなく `idle` になる。作業中表示または送信ロックが早く解除される可能性がある。
- `web/src/lib/opencode-events.test.ts` は単独実行でも `session.next.step.ended` の網羅性チェックに失敗した。`useSessionStream.ts` が分岐するイベントと `HANDLED_EVENT_TYPES` の登録が不一致で、イベント処理のドリフト検知が失敗している。
- `npm run lint` はエラーなしだが、`TaskView.tsx` の `useEffect` の `taskId` 依存漏れと、2つのテストファイルの未使用変数について警告が残っている。

## 検証

- `npm run typecheck` ... 成功
- `npm test -- --run` ... 248 files中246成功、2957 tests中2954成功
- 新機能の `collaboration-context.test.ts` と proxy route tests ... 成功
- 失敗した2テストファイルは単独実行でも再現

## 日付

2026-08-09

## 並行セッションの相互認識

### 方針

- 同じワークスペースのセッション同士へライブ状態を通知するが、ファイルロックや作業停止は行わない。
- 生成中のターンには割り込まず、各ユーザープロンプトの送信直前に最新スナップショットを更新する。

### 実装内容

- 同じワークスペースで `busy` / `retry` の他セッションを最大5件検出する `collaboration-context.ts` を追加した。
- 他セッションのタイトル、状態、edit/write/patch系ツールで観測したファイルを `<collaboration-context>` として自動注入するようにした。
- コンテキストで、他セッションの変更を巻き戻さず、ファイル重複時は両方の変更を保持してユーザーへ報告するよう指示した。
- 状態やトランスクリプトを取得できなくても通常の送信は止めないbest-effort動作にした。
- 内部コンテキストは履歴へ保存されるが、WebUIの会話表示からは除外するようにした。
- `docs/specs/collaboration-awareness.md` に挙動と介入方針を記録した。

### 検証結果

- 対象テスト ... 3 files / 62 tests 成功
- `npm run typecheck` ... 成功
- 対象ファイルの `npm run lint` ... 成功

## 日付

2026-08-09

## メモリ機能の説明改善と手動抽出エラー修正

### 原因

- OpenCode 1.18.14 のセッション作成APIはモデルIDのキーに `id` を要求するが、メモリ抽出だけが `modelID` を送信していたため 400 Bad Request になっていた。
- 画面上に「候補」「承認済み」の関係や、抽出対象・保存先・利用タイミングの説明がなかった。

### 修正内容

- 抽出用セッションを `model: { providerID, id, variant }` で作成するよう修正し、OpenCode実機で作成と後始末が成功することを確認した。
- セッション作成失敗時に、固定の英語エラーではなく日本語の説明と原因を表示するようにした。
- メモリ画面に「会話から候補を抽出し、承認後に今後の会話で利用する」という流れを表示した。
- ラベルを「保存先ワークスペース」「記憶を探す会話」「候補を抽出」「使用中」へ変更し、抽出時にモデル利用料が発生し得ることを明記した。

### 検証結果

- `npm run test -- --run src/lib/memory-extract.test.ts src/components/settings/MemorySettings.test.tsx` ... 13 tests 成功
- `npm run typecheck` ... 成功
- 対象4ファイルの `npm run lint` ... 成功

## 日付

2026-08-09

## 子リポジトリのGitグラフ表示

### 実装内容

- `GET /api/git/repositories` を追加し、許可済みの開いたフォルダ自身と直下の `.git` を持つ子フォルダを列挙するようにした。
- `GraphPanel` は親フォルダへ直接 `git log` を実行せず、列挙された最初のリポジトリを対象にするよう変更した。
- 複数リポジトリがある場合はグラフヘッダーにタブを表示し、選択中のリポジトリへログ、コミット詳細、差分の要求を切り替えるようにした。

### 検証結果

- `npm run test -- --run src/components/task/GraphPanel.test.tsx` ... 13 tests 成功
- `npm run typecheck` ... 成功
- `npm run lint -- src/components/task/GraphPanel.tsx src/components/task/GraphPanel.test.tsx src/app/api/git/repositories/route.ts` ... 成功

## 作業完了後も「作業中」が残る不具合

### 原因

`session.idle` の直後、同じSSEバースト内で遅れて届いた `session.status=busy/retry` が、Reactの再描画前に状態を再びbusyへ戻す可能性があった。

### 修正内容

- `useSessionStream` のイベント処理で idle 後の遅延busy/retryを無視する同期判定を追加。
- 新しい送信時は `pendingMutation` を先に立てるため、正規の次ターンは従来どおりbusyへ遷移する。
- idle/busyイベント受信時に `statusRef` も同期更新し、イベントバースト中の古い参照を防止。
- 遅延busyを抑止する回帰テストを追加。

### 検証結果

- `npm run test -- --run src/lib/useSessionStream.test.ts` ... 64 tests 成功
- `npm run typecheck` ... 成功

### 追加修正

v2の最終 `session.next.step.ended` では `session.idle` が別途届かない場合があるため、このイベント直後の再同期だけREST状態を優先するようにした。SSE接続中のidle抑止で完了判定が遅れる経路を解消する。

## 日付

2026-08-09

## 依頼

HomeViewでAutoを選んで開始したタスクのTaskViewコンポーザーが、Autoの解決先モデルへ切り替わらずAuto表示を維持するようにする。

## 実装内容

- `web/src/components/task/TaskView.tsx` で、HomeViewが保存したタスク単位のAuto選定レコードを初期モデル解決で最優先にした。
- ユーザー設定の具体的な既定モデルが存在しても、Autoで開始したタスクのドロップダウンはAutoを表示するようにした。
- `TaskView.test.tsx` に、具体的な既定モデルとAutoタスクレコードが共存する回帰テストを追加した。

## 検証結果

- `npm run test -- --run src/components/task/TaskView.test.tsx` ... 116 tests 成功
- `npm run typecheck` ... 成功

## 日付

2026-08-10

## Caddy公開URL確認

## プロジェクト読み込み遅延の原因

### 調査結果

- `/api/projects` 自体は実測約3msで、SQLiteのプロジェクト一覧取得は原因ではなかった。
- サイドバーは `/api/projects` の結果を `/api/tasks` と `/api/tasks/archived` の完了後に反映する。
- `77a94fa` で追加された推定コスト処理が、コスト0の全セッションについて `/session/:id/message` を最大1.5秒タイムアウト付きで直列取得していた。
- そのためセッション数に比例して初回タスク一覧が遅延し、プロジェクト一覧の表示も巻き込まれていた。実測では各タスクAPIが約5秒だった。

### 修正内容

- セッション履歴取得をディレクトリ内で並列化し、推定コスト表示を維持しながら待ち時間をセッション数に比例させないようにした。

### 検証結果

- `npm exec vitest run src/lib/task-service.test.ts` ... 14 tests 成功
- `npm exec tsc -- --noEmit` ... 成功

- `deploy/Caddyfile` は `100.98.131.68` を HTTPS site address として登録済み。
- Caddy は `https://100.98.131.68:8443` で稼働し、`curl -k -I` で `200 OK` と `Via: 1.1 Caddy` を確認した。
- `http://100.98.131.68:3000` は Next.js の直接入口であり、Caddy経由の入口は `https://100.98.131.68:8443`。同じ `:3000` はバックエンドが使用するため、Caddy入口にはできない。
- 追加のコード変更は不要。

## 変更ファイル

- `web/src/components/task/TaskView.tsx`
- `web/src/components/task/TaskView.test.tsx`

## 追加修正

- TaskViewの`model` stateをAutoタスクレコードから同期初期化し、プロバイダー取得中の空stateを経由して具体的な解決モデルへシードされる競合も防止した。

# 作業ログ: CodexBar 二列表示をデフォルト化

## 日付

2026-08-09

## 依頼

「CodexBarAddon 二列表示をデフォルト化」。

## 実装内容

- `addons/codexbar/CodexBarWidget.tsx`
  - `loadTwoColumn()`: localStorage 未保存時は `true`（二列）を既定とし、
    保存値 `"1"` が明示されている場合のみ一列へオプトアウトするよう変更。
    （従来は `"2"` 一致時のみ二列）
  - `twoColumn` の初期 state を `true` に変更（`useEffect` で保存値を反映）。
- `addons/codexbar/CodexBarWidget.test.tsx` の二列レイアウトテストを新デフォルトへ更新。

## 検証結果

- `npx vitest run addons/codexbar/CodexBarWidget.test.tsx` ... 6 tests 成功
- `npx tsc --noEmit`(web) ... 成功
- eslint: addons は web の base path 外のため既存どおり対象外

## 変更ファイル

- `addons/codexbar/CodexBarWidget.tsx`
- `addons/codexbar/CodexBarWidget.test.tsx`

# 作業ログ: 初回ユーザー追加時の admin session required 修正

## 日付

2026-08-09

## 実施内容

- ユーザー追加 API は既存ユーザーがある場合、従来どおり admin セッションを要求。
- ユーザー未登録の初回 POST だけは、管理者セッションを作成できないためホスト上で許可。
- 初回ユーザー作成時の監査ログで null セッションを参照しないよう修正。
- `host/src/control-server.test.js` に初回作成の回帰テストを追加。

## 検証結果

- host control-server tests: 88 passed
- Web `typecheck`: 成功
- Web `lint`: エラーなし（既存 warning 2件）

# 作業ログ: OpenCode API v2(Beta) 移行準備の実装(優先度順 P1〜P4)

## 日付

2026-08-09(Push準備)

## 実施内容

- `master` の未Pushコミットを確認した。
- リモート `origin` は `https://github.com/daihaya000/OpenCodeWebUI.git`。
- 作業ツリーはクリーンで、Push前にこの記録をコミットする。

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

# 作業ログ: 初回プロファイル作成時のグローバルリンク自動作成

## 日付

2026-08-09

## 原因

- `ensureRegistry()` は既存の `~/.config/opencode` リンクを登録するだけで、リンクが無い初回状態では作成しなかった。
- 空プロファイル作成もプロファイルを登録するだけで、初回プロファイルをアクティブ化していなかった。

## 修正

- グローバルリンクが `missing` かつプロファイルが0件のとき、空プロファイル作成後に junction を作成してアクティブ化するようにした。
- 既存の実体ディレクトリや外部プロファイルは置換しない。
- `~/.config` が未作成の環境でもリンク作成できるよう親ディレクトリを作成する。
- 作成失敗時は新規プロファイルの一時ディレクトリを削除する。

## 検証結果

- `npx vitest run src/lib/profiles/link.test.ts src/lib/profiles/service.test.ts` 成功（33 tests）。
- `npx tsc --noEmit` 成功。

## 変更ファイル

- `web/src/lib/profiles/link.ts`
- `web/src/lib/profiles/service.ts`
- `web/src/lib/profiles/service.test.ts`

---

# 作業ログ: 既存プロファイル移行の移動オプション

## 日付

2026-08-09

## 実装内容

- 既存プロファイル移行 API に `mode: "copy" | "move"` を追加した。
- `copy` は従来どおり元ディレクトリを移行前バックアップとして残す。
- `move` はコピー・ジャンクション切替成功後に元ディレクトリを削除し、レジストリからも旧エントリを除外する。
- 元ディレクトリの削除に失敗した場合は、移行自体を成功扱いにして旧プロファイルをバックアップとして残し、ジョブ注記で知らせる。
- プロファイル設定画面に「元のプロファイルを削除して移動する」チェックボックスを追加した。既定は `copy`。
- 仕様書の API と画面説明を更新した。

## 検証結果

- `npx vitest run src/lib/profiles/service.test.ts src/components/settings/ProfilesSettings.test.tsx` 成功（34 tests）。
- `npx tsc --noEmit` 成功。

## 変更ファイル

- `web/src/lib/profiles/service.ts`
- `web/src/lib/profiles/service.test.ts`
- `web/src/app/api/profiles/migrate/route.ts`
- `web/src/components/settings/ProfilesSettings.tsx`
- `web/src/components/settings/ProfilesSettings.test.tsx`
- `docs/specs/opencode-config-profiles.md`

---

# 作業ログ: 実体ディレクトリからのプロファイル移行導線

## 日付

2026-08-09

## 追加修正

- `~/.config/opencode` がまだ junction ではなく実体ディレクトリの場合も、プロファイル設定画面に移行カードを表示するようにした。
- 実体ディレクトリを `profiles/default` へ複製後、元のパスを一時バックアップ名へ退避して junction に置換する。
- `copy` は退避した元ディレクトリを外部バックアップとしてレジストリに残し、`move` は退避先を削除して旧エントリを除外する。
- junction 置換に失敗した場合は退避ディレクトリを元のパスへ戻す。

## 検証結果

- `npx vitest run src/lib/profiles/service.test.ts src/components/settings/ProfilesSettings.test.tsx` 成功（35 tests）。
- `npx tsc --noEmit` 成功。

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

# 修正記録: メモリ機能レビュー指摘への対応 (2026-08-09)

- Web API は `workspace_id` / `workspaceId` を必須化し、承認・更新・削除の
  DB操作を `(id, workspace_id)` で限定した。設定UIもworkspace IDを送る。
- MCP の更新・削除・取得も固定workspaceをSQL条件に加え、他workspaceのIDを
  拒否する統合テストを追加した。
- `memory_audit_log` をSQLiteに追加。Web APIとMCPの書き込み操作を永続記録し、
  workspace削除時にはメモリおよび監査記録を明示削除する。
- 抽出用の一時sessionを `finally` でbest-effort削除し、idle抽出ledgerは成功後に
  記録する形へ変更した。処理中重複はプロセス内Setで抑止し、失敗は次回sweepで再試行する。

検証: `npm --prefix web test -- src/lib/memory.test.ts src/lib/db.memory-migration.test.ts src/lib/memory-idle.test.ts src/app/api/memory/route.test.ts src/components/settings/MemorySettings.test.tsx` (28件成功)、
`npm --prefix browser-bridge test` (88件成功)、`npm --prefix web run typecheck`、
`npm --prefix web run lint -- src/lib/memory-extract.ts src/lib/memory.ts src/lib/memory-idle.ts src/app/api/memory src/components/settings/MemorySettings.tsx`。

# 修正記録: セッション横断メモリ共有と共同編集保護 (2026-08-09)

- 通常の `prompt_async` を通すBFFで、セッションが単一workspaceへ紐付く場合に
  承認済みworkspace memoryを注入するようにした。複数workspaceへ紐付く曖昧な
  sessionは注入せず、プロジェクト間の文脈漏洩を防ぐ。
- `memories.revision` を追加し、承認・更新・削除は期待revisionとの比較更新にした。
  UIとMCPはrevisionを送信し、別セッションの更新後に古い状態で操作した場合は
  変更されない。

検証: `npm --prefix web run typecheck`、
`npm --prefix web test -- src/lib/memory.test.ts src/lib/db.memory-migration.test.ts src/app/api/memory/route.test.ts` (18件成功)、
`npm --prefix browser-bridge test` (88件成功)。

# 検証・レビュー・デバッグ記録: セッション横断メモリ (2026-08-09)

## 発見して修正した問題

- stale revision の更新・削除・承認が `404 not found` になり、共同編集競合を
  正しく伝えられなかった。現在は同一workspaceに行が残っている場合 `409 Conflict`
  と現在値を返し、UIは一覧を再読み込みする。
- DELETEの `expected_revision` 未指定が `Number(null) === 0` によりrevision 0の行を
  削除できた。未指定を明示的に400で拒否するよう修正した。
- MCP起動がWebUIのDBマイグレーションより先になると、既存DBにrevision列がなく
  更新SQLが失敗した。MCP起動時にもrevision列を追加する。
- 通常セッションへのメモリ注入が毎ターン実行され、履歴とコンテキストを不必要に
  膨らませていた。`memory_session_injections` のworkspace/session一意claimで
  セッションごとに一度だけ注入する。
- session IDだけでworkspaceを解決していたため、ディレクトリが異なるリクエストに
  メモリを注入し得た。検証済みディレクトリとworkspaceのパスが一致する場合だけ
  注入し、複数workspaceに一致する場合はfail closedする。
- メモリ本文の改行や`<workspace-memory>`境界が注入ブロックを壊せた。出所を付与し、
  改行・山括弧をサニタイズし、内部ノートを命令として扱わない注意書きを追加した。
- `deleteProject` はworkspaceのFK cascadeを直接発火させるため、`deleteWorkspace`の
  明示cleanupを通らず、メモリ・監査ログが孤児化し得た。project削除側にもworkspace
  サブクエリによるcleanupを追加した。

## 検証

- `npm --prefix web test` ... 247 files / 2941 tests 成功
- `npm --prefix browser-bridge test` ... 88 tests 成功
- `npm --prefix web run typecheck` ... 成功
- 対象ESLint ... 成功

# 作業ログ: 長時間ツールの手動ハング判定ボタン (2026-08-09)

## 依頼

「5分以上経過しているものを手動でハング判定できるボタンを表示させる」。

## 実装内容

- `PartView` の既存長時間 shell ツール警告に「ハング判定」ボタンを追加した。
- ボタンは既存のハング判定時間（既定5分、設定変更時は設定値）を超えた場合だけ表示する。
- `TaskView` から現在セッションの `stream.abort()` を呼び出し、通常の停止処理と同じ再同期・busy制御を利用する。
- 閾値到達前の非表示と、到達後のクリック動作を `PartView.test.tsx` で検証した。

## 検証結果

- `npm --prefix web test` ... 247 files / 2942 tests 成功
- `npm --prefix web run typecheck` ... 成功
- `npx eslint src/components/task/PartView.tsx src/components/task/TaskView.tsx` ... 成功
- 本番ビルドはプロジェクト指示により未実行。
# 作業ログ: Tailscale等のVPN経由でホストPCを127.0.0.1へフォールバック

## 日付

2026-08-09

## 実施内容

- `web/src/lib/localhost-redirect.ts` が Tailscale 標準の `100.64.0.0/10` を同一ホスト判定対象として扱うようにした。
- ホストPC上で制御プレーンへ到達できる場合、VPNアドレスのWebUIを従来どおり `127.0.0.1` へリダイレクトする回帰テストを追加した。
- `web/src/lib/local-request.ts` のプライベートネットワーク判定にも同じVPN帯域を追加した。

## 検証結果

- `npm run test -- --run src/lib/localhost-redirect.test.ts src/lib/local-request.test.ts` ... 37 tests 成功
- `npm run typecheck` ... 成功
- `npm run lint -- src/lib/localhost-redirect.ts src/lib/local-request.ts` ... 成功

# 作業ログ: エラー詳細展開後のメッセージ追従

## 日付

2026-08-09

## 実施内容

- `TaskView` のメッセージコンテンツ用 `ResizeObserver` を、非同期のタスク読み込み後にも接続し直すようにした。
- 展開済みのエラーやツール詳細による高さ変化でも、最下部を追従中なら従来の再ピン処理が継続する。
- 子コンポーネントの初期エラー展開が監視登録より先に起きても取り逃がさないよう、登録直後に再ピン判定を1回実行する。

## 検証結果

- `npm test -- TaskView.test.tsx` ... 116 tests 成功
- `npm run typecheck` ... 成功
## 日付

2026-08-10

## HTTPS証明書表示の明文化

### 修正内容

- 接続設定の証明書欄を「HTTPS接続用の信頼証明書」と明記した。
- CaddyのHTTPS接続でブラウザ警告を消すため、接続端末へルートCA証明書をインストールする必要があることを説明するようにした。
- ダウンロードリンクを「VPN接続用ルートCAをダウンロード」のように、接続種別と用途が分かる表示へ変更した。

### 検証結果

- `npm run test -- --run src/components/settings/SettingsView.test.tsx` ... 29 tests 成功
- `npm run typecheck` ... 成功
## 日付

2026-08-10

## HTTPS証明書表示の追加明文化

### 修正内容

- 見出しを「Caddy HTTPS用ルートCA証明書」とし、証明書の種類を明記した。
- HTTPS接続する端末ごとにルートCA証明書をダウンロードしてインストールする必要があることを表示した。
- ダウンロードリンクを接続種別ごとの端末向けCA証明書として明記した。

### 検証結果

- `npm run test -- --run src/components/settings/SettingsView.test.tsx` ... 29 tests 成功
- `npm run typecheck` ... 成功
## 2026-08-10

## Current profile AGENTS.md editor

### Changes

- Added `GET/PATCH /api/profiles/agents-md` for reading and writing the active profile's AGENTS.md.
- Added an editor and save action to the profile settings AGENTS.md / Skills sync section.
- The API creates the config directory when saving a new AGENTS.md and limits content to 2 MB.

### Verification

- `npm run typecheck` passed.
- Profile settings and open-target tests passed: 18 tests.
- `git diff --check` passed.
## 表示指標の日本語統一

### 日付

2026-08-10

### 修正内容

- エージェント応答のメタ情報を `モデル・推論強度・時刻・コスト・トークン・思考時間` の順に統一した。
- ヘッダーの金額表示を「累計コスト」と明記し、応答側と同じ指標順にした。
- 応答の「トークン」は `MessageInfo.tokens` の定義どおり各 assistant ターンの使用量であり、累計ではない。ヘッダーの「累計トークン」のみ各 assistant ターンの `tokens.total` を合計する。

### 検証結果

- `npm test -- --run src/components/task/MessageMetaHeader.test.tsx src/components/task/NestedAgentPanel.test.tsx src/components/task/TaskView.test.tsx` ... 132 tests 成功
- `npx eslint src/components/task/MessageMetaHeader.tsx src/components/task/TaskView.tsx src/components/task/MessageMetaHeader.test.tsx src/components/task/NestedAgentPanel.test.tsx src/components/task/TaskView.test.tsx` ... 成功
- `npm run typecheck` ... 成功
## 推定累計コスト

### 日付

2026-08-10

### 修正内容

- タスクが実測の `task.cost` を返さない場合、assistant 応答ごとの実測コストまたはOpenAI API価格による推定コストを合計するようにした。
- 推定額を含む累計は「累計コスト（推定）」と明示し、実測のセッション累計がある場合は従来どおりそちらを優先する。

### 検証結果

- `npm test -- --run src/components/task/TaskView.test.tsx src/components/task/MessageMetaHeader.test.tsx` ... 125 tests 成功
- `npx eslint src/components/task/TaskView.tsx src/components/task/TaskView.test.tsx` ... 成功
- `npm run typecheck` ... 成功

## コスト表示の推定表記廃止

### 日付

2026-08-10

### 修正内容

- トークンから算出したコストも実測コストと同じ「コスト」として扱い、個別応答と累計ヘッダーの「推定」表記を削除した。
- タスクの実測累計がない場合は、従来どおり各応答のコストを合計して「累計コスト」として表示する。

### 検証結果

- `npm test -- --run src/components/task/TaskView.test.tsx src/components/task/MessageMetaHeader.test.tsx` ... 125 tests 成功
- `npx eslint src/components/task/TaskView.tsx src/components/task/MessageMetaHeader.tsx src/components/task/TaskView.test.tsx src/components/task/MessageMetaHeader.test.tsx` ... 成功
- `npm run typecheck` ... 成功

## サイドバーのコスト補完

### 日付

2026-08-10

### 修正内容

- タスク一覧APIがセッションの実測 `cost` を返さない場合、紐付くセッションの assistant 応答トークンからコストを合算して `TaskSummary.cost` を補完するようにした。
- サイドバーは既存の `TaskSummary.cost` 列を使うため、追加のクライアント側リクエストなしで個別タスクのコストを表示する。
- 実測コストがあるセッションのメッセージは読み込まず、従来の集計値を優先する。

### 検証結果

- `npm test -- --run src/lib/task-service.test.ts src/components/shell/Sidebar.test.tsx` ... 53 tests 成功
- `npx eslint src/lib/task-service.ts src/lib/task-service.test.ts` ... 成功
- `npm run typecheck` ... 成功
# メタ情報の推論強度・思考時間ラベル簡略化

## 日付

2026-08-10

## 修正内容

- 応答メタ情報の推論強度ラベルから「推論強度」を削除し、値だけを表示するようにした。
- 「思考時間」を「思考」に変更した。
- `MessageMetaHeader` の回帰テストを更新した。

## 検証結果

- `npm test -- --run src/components/task/MessageMetaHeader.test.tsx` ... 8 tests 成功
- `git diff --check` ... 成功
# コスト一覧取得の負荷削減

## 日付

2026-08-10

## 修正内容

- `/api/tasks` と単一タスク取得で、`Session.cost` が0のときにセッション履歴全件を取得してコストを再集計するフォールバックを削除した。
- 実行中の3秒ポーリングで同じ `/message` 履歴を繰り返し取得しないよう、OpenCodeの `Session.cost` を唯一の正規値として扱う。
- `Session.cost` 未提供時に履歴を取得しないことを回帰テストで固定した。

## 検証結果

- `npm.cmd test -- --run src/lib/task-service.test.ts src/components/task/TaskView.test.tsx src/components/shell/Sidebar.test.tsx` ... 3 files / 170 tests 成功
- `npm.cmd run typecheck` ... 成功
- `npx.cmd eslint src/lib/task-service.ts src/lib/task-service.test.ts` ... 成功

## 追加修正

- 3秒間隔のSidebar/TaskView更新を専用の `/api/tasks/:id/cost` に分離した。
- 通常のタスク一覧に含まれるGit統計・全セッション状態・全セッション一覧を、コスト更新のたびに再計算しないようにした。
- セッション詳細の `Session.cost` だけを取得し、失敗時は現在の表示を維持する。

## 追加検証

- 関連テスト ... 3 files / 171 tests 成功
- `npm.cmd run typecheck` ... 成功
- ESLint対象ファイル ... 成功

## 2026-08-10 本日コミット分の徹底デバッグ

### 対象

- 09:38から13:26までの23コミット（75d22e5からf938940）をレビューした。
- コスト・トークン表示、ライブコストポーリング、AGENTS.md編集API、共同認識コンテキストを重点確認した。

### 発見と修正

- Sidebar/TaskViewの3秒コスト更新が重なると、遅れて返った古い応答が新しい金額を巻き戻す問題を、リクエスト世代チェックで修正した。
- AGENTS.md PATCH APIでJSON本文が`null`のとき500になる入力検証漏れを修正し、400を返す回帰テストを追加した。
- `Session.cost`が0のOpenAIセッションで、負荷削減コミット後にサイドバーの推定コストが消える回帰を再現した。履歴全件取得を戻さず、`Session.tokens`と`Session.model`から定数時間で補完するようにした。
- 共同認識コンテキストの本文を非破壊コピーに変更し、DBや履歴形状の例外が内部送信を止めないようbest-effort退避を追加した。

### 検証

- Web: `npx vitest run` 249 files / 2973 tests 成功
- Web: `npx tsc --noEmit` 成功
- Web: `npx eslint src` 成功
- Host: `npm test` 377 tests 成功
- Browser Bridge: `npm test` 88 tests 成功
- 稼働中ヘルスチェック: WebUI/OpenCodeとも正常（OpenCode 1.18.14）

## 2026-08-10 Goal Loop turn 1: コスト推定境界監査

- 実機の `Session.tokens` で `input + cache.read + output + reasoning` が `total` と一致することを確認した。
- 標準価格、Fast価格、キャッシュ読取・書込、未知モデル、ゼロ使用量、異常なキャッシュ量を検証する `openai-pricing.test.ts` を追加した。
- 関連21テスト、TypeScript、ESLintが成功した。
- `Session.model` は現在モデルのみを返すため、1セッション内でモデルを切り替えた場合の集計推定は残余確認事項として次ターンへ引き継ぐ。

## 2026-08-10 Goal Loop turn 2: 混在モデル推定の実機再現

- 最近12セッションの履歴を調査し、11件は単一モデル、1件は`terra`と`luna`の混在だった。
- 混在セッションでは現在モデル`luna`の集計推定が`0.07587736`、assistantメッセージ別の価格合算が`0.36371764`となり、約4.8倍の過小表示を再現した。
- `Session.model`だけでは過去のモデル切替を復元できないため、次ターンで回帰テストと負荷を抑えた補正を実装する。
## デバッグ: 混在モデルセッションのコスト過小表示

### 日付

2026-08-10

### 再現結果

- `Session.cost=0` のセッションでは、セッション一覧の累計トークンを現在モデルだけで推定していたため、履歴中に別モデルがあると金額を過小表示していた。
- 実機の `ses_016a5c151ffeuffnI1tk0uCLP7` では、現在モデルが `openai/gpt-5.6-luna`、履歴に `openai/gpt-5.6-terra` と `openai/gpt-5.6-luna` が混在していた。
- 履歴別推定は `0.36371764000000006` USD、現在モデル一律の推定は `0.07587736` USD だった。

### 修正内容

- `listTasks` と `getTaskCost` のフォールバック推定で、assistantメッセージ履歴を取得し、各メッセージの `providerID` / `modelID` / トークンに対応する価格を合算するようにした。
- OpenCodeが報告した正の `message.info.cost` は推定値より優先し、履歴取得失敗時はセッション全体トークンによる推定へ戻す。
- 履歴推定結果をディレクトリ・セッションID・累計使用量のフィンガープリントで最大256件キャッシュし、同一内容のポーリングで履歴を再取得しないようにした。一時的な取得失敗はキャッシュせず、復旧後に再試行する。
- 未知モデルを含む履歴を既知モデル分だけ部分合算せず、安全にセッション全体推定へ戻す。

### 検証結果

- `npx vitest run src/lib/task-service.test.ts` ... 22 tests 成功
- `npx vitest run` ... 250 files / 2982 tests 成功
- `npx tsc --noEmit --pretty false` ... 成功
- 対象ファイルの `npx eslint` ... 成功

## デバッグ: AGENTS同期による既存スキルディレクトリの破壊防止

### 日付

2026-08-10

### 発見と修正

- AGENTS同期のスキルミラー先に通常のディレクトリが存在する場合、従来の`symlinkDir`は再帰削除してからシンボリックリンクへ置換していた。
- 既存ディレクトリを削除せず、`blocked`結果として同期を失敗させるように変更した。
- 同期エラーのラベルを`skills/<name>`から`claude/<name>`・`codex/<name>`・`agents/<name>`へ正確にした。
- 一時ホームディレクトリを使う実ファイルテストを追加し、AGENTS.md作成、3方向のスキルミラー、既存ディレクトリ保持を検証した。

### 検証結果

- `npx vitest run src/lib/profiles/agents-sync-engine.test.ts src/app/api/profiles/agents-md/route.test.ts src/components/settings/SettingsView.test.tsx src/components/settings/ProfilesSettings.test.tsx` ... 4 files / 47 tests 成功
- `npx tsc --noEmit --pretty false` ... 成功
- 対象ファイルの`npx eslint` ... 成功
## 設定画面の現在バージョン表示

### 日付

2026-08-10

### 修正内容

- 設定画面のアップデート欄に、更新の有無にかかわらず WebUI のコミット、OpenCode CLI、Next.js の現在バージョンを表示するようにした。
- 更新候補がある場合の既存の警告表示は維持した。
- 更新なしの場合も現在バージョンを表示する回帰テストを追加した。

### 検証結果

- `npm.cmd test -- --run src/components/settings/SettingsView.test.tsx src/app/api/updates/status/route.test.ts` ... 41 tests 成功
- `npm.cmd run typecheck` ... 成功
# 調査: Qwen-MM-Plugins の実装方式を参考にした画像非対応モデル対応の検討

## 日付
2026-08-10

## 目的
GitHub の QwenLM/Qwen-MM-Plugins を参考に、OpenCodeWebUI の画像非対応モデルでも画像を扱えるようにする仕組みの導入可能性を調査した。

## Qwen-MM-Plugins の実装方式
- 各capabilityは **skill**（モデルにツールの存在を知らせる）+ **MCP server**（ツール本体）の組。
- `install.sh` が Claude Code / Codex / Qoder / OpenClaw / Qwen Code / Gemini CLI / opencode など主要ハーネスへ横断インストール可能。
- opencode は「Register the skill + MCP yourself」で対応（インストーラ未カバー）。
- 画像・動画・文書の動的解像度読み取り、OCR、grounding、セグメンテーション、ASR、vision chat を MCP ツールとして提供。
- ネイティブの画像/動画/文書読み取りは API キー不要。vision_chat / OCR / grounding / ASR / 生成は DashScope API 必須。
- MCP サーバは `uvx` で Python 依存を自動インストール（uv 必須、手動 pip 不要）。
- Windows は WSL2 のみ対応、ネイティブ未検証。

## 現行コードの画像対応判定
- `web/src/components/task/TaskView.tsx:2496` の `imageSupported` 判定と `web/src/app/api/tasks/route.ts:127` / `web/src/app/api/opencode/[...path]/route.ts:342` の `supportsImageInput()` が OpenCode の `/provider` capabilities を参照。
- 画像非対応モデルでは UI の添付ボタンが無効化され、送信時に 400 で弾かれる。
- 現在は Browser Bridge MCP（`browser-bridge/scripts/install-mcp.mjs`）が `opencode.jsonc` の `mcp` エントリを jsonc-parser で非破壊編集する既存パターンあり。

## 結論: 対応可能
**技術的には対応可能**。最小構成は Qwen-MM-Plugins の core capability をローカル MCP として opencode に登録するだけ。

### 最小実装案
1. `opencode.jsonc` の `mcp` セクションへ `qwen-mm-plugins-core` エントリを追加（uvx command + env）。
2. 既存 `browser-bridge/scripts/install-mcp.mjs` と同様の jsonc-parser ベース非破壊編集インストーラを新設。
3. `web/src/components/settings/ExtensionsSettings.tsx` の MCP 一覧で表示・状態確認可能（既存機能）。
4. `supportsImageInput` の fail-closed ロジックは維持し、画像添付時は画像対応モデルを選ぶ案内を継続。MCP 経由で画像非対応モデルでも `vision_chat` / `ocr` ツールを呼べるため、ユーザーが意図的にツール経由で画像を処理可能。

### 制約・留意点
- **uv のインストールが前提**（uvx 依存）。Windows ネイティブは未検証で WSL2 推奨。
- DashScope API キー（`DASHSCOPE_API_KEY`）が必要なツールと不要なツールがある。
- 画像非対応モデルでも MCP ツール経由なら画像処理可能だが、`supportsImageInput` の UI 判定は OpenCode の `/provider` capabilities 依存のまま。MCP ツールの存在とは独立。
- OpenCodeWebUI 側は MCP エントリの追加・一覧表示のみ。ツール自体の実行は OpenCode 本体が担うため、WebUI 本体のフォーク不要。

### 検証
- 本調査は設計検討のみ。コード変更・テスト実行は未実施。
# 実装: Qwen-MM-Plugins MCP 対応（画像非対応モデルの画像利用）

## 日付
2026-08-10

## 目的
QwenLM/Qwen-MM-Plugins の core capability をローカル MCP として opencode に登録し、画像非対応モデルでも MCP ツール経由で画像/動画/文書読み取り・OCR・grounding・ASR・vision chat を利用可能にする。新規作成時のセットアップ（初回起動）にも対応する。

## 実装内容

### インストーラ (browser-bridge/scripts/install-qwen-mm-mcp.mjs 新設)
- 既存 `install-mcp.mjs` と同じ jsonc-parser ベースの非破壊編集。
- `mcp.qwen-mm-plugins-core` エントリを追加: `uvx --from "qwen-mm-plugins[core] @ git+https://github.com/QwenLM/Qwen-MM-Plugins.git@main" qwen-mm-plugins-core`
- `DASHSCOPE_API_KEY` / `SERPER_API_KEY` を `{env:...}` プレースホルダで注入。キー未設定でもエントリを書き、ネイティブ読み取りツールは利用可能。API キー必須ツールは実行時にエラー。
- `--scope` / `--path` / `--force` / `--uninstall` / `--dry-run` をサポート。

### 起動用バッチ (scripts/install-qwen-mm-mcp.bat 新設)
- `install-browser-bridge-mcp.bat` と同じ ASCII/CRLF/BOM なし形式。
- `node browser-bridge/scripts/install-qwen-mm-mcp.mjs` を呼び出し。

### start-webui.bat への組込み
- `:check_uv` ... `uv --version` を確認し、未導入なら winget で `astral-sh.uv` を導入。失敗時は警告のみで続行（Caddy と同じ非致命扱い）。
- `:install_qwen_mm_mcp` ... `node browser-bridge/scripts/install-qwen-mm-mcp.mjs` を実行。
- `OPENCODE_WEBUI_QWEN_MM=0` で両ステップをスキップ可能。
- 実行順序: browser-bridge deps → uv → qwen-mm MCP 登録 → host 起動。

### package.json
- ルート: `install:qwen-mm-mcp` スクリプト追加。
- browser-bridge: `install-qwen-mm-mcp` スクリプト追加。

### テスト
- `browser-bridge/test/install-qwen-mm-mcp.test.mjs` 新設 (14 tests): parseArgs / deepEqual / buildDesiredEntry / resolveConfigPath / install / idempotent / force / dry-run / uninstall / JSONCエラー / scope=project / path 上書き。
- `host/src/start-webui-bat.test.js` に uv と qwen-mm のモックを追加 (24 tests):
  - winget.cmd に `astral-sh.uv` ブランチ追加。
  - uv.cmd モック、node.cmd に qwen-mm インストーラ呼び出し追加。
  - fresh machine テストで uv インストール・実行順序・qwen-mm 登録を検証。
  - uv 既存時スキップ、uv 失敗時非致命、QWEN_MM=0 スキップ、winget 無し時スキップの専用テスト追加。

### README
- 機能表に MM 行追加、環境変数表に `OPENCODE_WEBUI_QWEN_MM=1` 追加、初回起動説明に uv を追記、ドキュメント表に Qwen-MM-Plugins リポジトリリンク追加。

## 設計判断
- **uv は winget で自動導入**: Node.js/OpenCode と同じパターン。失敗時は非致命。
- **API キーはオプション**: ネイティブ読み取りは不要、vision_chat/ocr/grounding/ASR/生成は DASHSCOPE_API_KEY 必須。エントリは常に書き、キー未設定時はツール実行時にエラー。
- **capability は core のみ**: 画像/動画/文書/3D読み取り + OCR/grounding/segmentation/ASR/vision chat/web search。
- **WebUI 本体はフォーク不要**: MCP エントリの追加・一覧表示のみ。ツール実行は OpenCode 本体が担う。

## 検証結果
- `browser-bridge` 全テスト ... 102 tests 成功（+14 新規）
- `host` 全テスト ... 385 tests 成功（+4 新規、start-webui-bat 24 tests）
- `bat-encoding` ... 7 tests 成功
- `web typecheck` ... 成功

---

# 作業ログ: バグハント特化スキルの作成・改善

## 日付

2026-08-11

## 実装内容

- `.opencode/skills/bug-hunt/SKILL.md` を追加。
- バグ、不具合、エラー、クラッシュ、回帰、flaky test、性能劣化などをトリガーに設定。
- 再現、証拠に基づく仮説検証、根本原因の確定、最小修正、回帰テスト、検証、報告の手順を定義。
- プロジェクト指示の優先、既存変更の保護、バグ種別ごとの調査観点、完了条件を明文化。

## レビュー改善

- 計測コードが必要な調査を妨げる「再現前にコードへ触れない」という断定を修正。
- 修正箇所を一律に呼び出し側へ寄せず、不変条件を所有する層で判断する方針へ変更。
- 修正前確認のために作業ツリーを巻き戻さないよう明記。
- 不足情報を即座に質問せず、リポジトリ内で取得可能な証拠を先に調べる手順へ変更。

## 修復

- スキル初回作成時に誤って上書きした既存 `MEMORY.md` 3,974行を履歴から復元し、本記録を末尾へ追記。

---

# 調査: WebUIのトークン節約機能

## 日付

2026-08-11

## 現状

- `context-usage.ts` は最新assistant応答のトークン数とモデルのcontext limitから現在使用率を算出し、`TaskView.tsx` がモバイル・デスクトップ双方に表示している。
- `SessionActions.tsx` には手動のコンテキスト圧縮ボタンがあり、OpenCodeの `POST /api/session/{sessionID}/compact` を呼ぶ。OpenCode自身の自動圧縮後に作られるsynthetic continuationもUIから除外済み。
- 通常セッションの承認済みworkspace memoryは最初の `prompt_async` に一度だけ注入される。ただし関連度ではなく `use_count` と更新日時の順で最大8件、各memoryは最大2000文字なので、最悪時は初回入力が大きくなる。
- 並行セッション情報はmanual `prompt_async` のたびに最大5セッション・各8ファイルをuser textへ前置する。過去のsnapshotも会話履歴へ残るため、並行作業中は同種情報が累積する。
- Goal Loopは各ターンで固定の長いルール、元のgoal、acceptance criteria、直近5件の進捗を再送する。ループ回数が多いほど入力トークンが増える。
- Autoモデル選択は既にコスト優先が既定であり、単純な安価モデル選択は実装済み。表示はコンテキスト使用率・累計トークン・コストまであるが、cache read/writeの内訳や圧縮による削減量は表示しない。

## 優先実装案

1. **重複しないcollaboration context**: sessionごとに最後に注入したpeer/file snapshotのhashを保持し、変化時だけ注入する。終了したpeerの通知も一度だけ送る。最小変更で毎ターンの累積を止められるため最優先。
2. **関連度と文字数予算付きmemory注入**: 初回prompt本文をqueryにFTS検索し、上位3から5件、合計2000から4000文字程度に制限する。現在の「頻繁に使われた8件固定」より不要な初回コンテキストを減らす。
3. **圧縮アシスト**: 使用率70%で非阻害の提案、80から85%で次回送信前の自動compactを選択可能にする。idle時のみ、sessionごとのcooldown付きとし、OpenCode標準の限界直前自動圧縮より早く巨大履歴の反復課金を止める。
4. **Goal Loop promptの差分化**: 1ターン目だけ完全な規約・goal・acceptanceを送り、以後は短いturn指示と最新進捗だけにする。安全規約はagent/system側へ固定できる場合はそちらへ移し、prompt prefix cacheを壊しにくくする。
5. **節約効果の可視化**: assistant messageの `tokens.input`, `cache.read`, `cache.write`, `output`, `reasoning` を使い、直近入力、cache hit率、compact前後差分を表示する。機能ごとのA/B計測なしに自動圧縮閾値を固定しない。

## 推奨順序と指標

- Phase 1: collaboration dedupeとmemory budget。品質劣化リスクが低く、WebUI側だけで完結する。
- Phase 2: cache内訳表示と、送信単位の入力トークン推移を計測する。
- Phase 3: 計測結果を基にauto compactとGoal Loop差分promptを段階導入する。
- 主要指標は「1完了タスク当たりinput tokens」「cache read率」「compact回数」「圧縮後にユーザーが再説明した回数」「Goal Loop完了率」とする。

## 検証

- 設計調査のみ。実装コードは変更しておらず、テストは未実施。

---

# 実装計画: トークン節約機能

## 日付

2026-08-11

## 方針

- 既存の手動 `compact` とOpenCode標準の自動圧縮は残し、WebUI独自の機能は送信前の入力コンテキスト削減に限定する。
- ユーザーのプロンプト、ファイル内容、メモリ本文を計測ログへ保存しない。
- いきなり自動圧縮を既定有効にせず、低リスクの注入削減、計測、ユーザー選択式の自動圧縮の順で導入する。
- OpenCodeへ直接送るGoal Loopは通常のBFF `prompt_async` と経路が異なるため、通常セッション用の実装をそのまま流用せず、別途適用範囲を確認する。

## Phase 0: 計測の基盤

### 変更対象

- `web/src/lib/token-usage.ts` を新設。assistant messageの `input` / `cache.read` / `cache.write` / `output` / `reasoning` / `total` を集計する純粋関数を置く。
- `web/src/lib/context-usage.ts` は既存の使用率計算を維持し、必要なら最新turnの内訳だけを返す関数を追加する。
- `web/src/components/task/TaskView.tsx` の既存ヘッダー表示に、最新入力トークンとcache read率をtooltipまたは詳細表示として追加する。

### 完了条件

- 「節約したトークン」と推測表示せず、実際にOpenCodeが返したusageだけを表示する。
- message本文やファイルパスを保存・送信しない。
- `token-usage.test.ts` と既存 `context-usage.test.ts` の回帰テストが通る。

## Phase 1: 注入コンテキストの予算化

### workspace memory

- `web/src/lib/memory.ts` の選択処理を共通化し、初回プロンプトのqueryに対するFTS上位結果を優先する。
- FTSヒットがない場合は現在の `use_count` / `updated_at` 順をフォールバックにする。
- 最大件数を5件、注入ブロックの合計文字数を4,000文字程度に制限する。既存の `sanitizeMemoryInjectionText` と未承認除外は維持する。
- `claimMemoryInjectionForSession` にqueryを渡せるようにし、選択・usage更新・session claimを同一SQLite transaction内で行う。
- `web/src/app/api/opencode/[...path]/route.ts` は最初のtext partをqueryとして通常のmanual `prompt_async`に渡す。
- `web/src/lib/goal-loop.ts` はGoal本文をqueryに使うが、memory注入は従来どおり初回turnだけにする。

### collaboration context

- `web/src/lib/db.ts` にworkspace/session単位のsnapshot表を追加する。保存するのはpeerのID・状態・ファイル一覧の正規化済みsnapshot、fingerprint、更新時刻だけとし、本文は保存しない。
- `web/src/lib/collaboration-context.ts` に正規化・安定fingerprint・差分生成を追加する。
- 直前snapshotと同一なら注入しない。変更時は全体blockではなく、追加・変更・終了したpeerだけの短いupdate blockを注入する。
- **compact後は必ずfull snapshotを再注入する**: OpenCodeのcompactは古いuserメッセージを残す場合があるため、差分のみ注入すると過去peer情報が欠落するリスクがある。`session.compacted` SSE受信時にsnapshot claimを無効化し、次回送信時はfull blockを注入する。これにより「前回差分→今回full」の順で履歴に残り、情報欠落を防ぐ。
- BFF routeの注入関数は `{ body, claim }` を返す形にし、明示的なupstream拒否時だけclaimを解放する。ネットワークタイムアウトは送信済みか判別できないため即時再注入せず、claimに短いTTLを設ける。
- snapshotは古い行をTTLでbest-effort削除し、workspace削除時はcascadeさせる。

### テスト

- `web/src/lib/memory.test.ts`: query優先、fallback、4,000文字上限、session二重claim。
- `web/src/lib/collaboration-context.test.ts`: 同一snapshotの空結果、peer追加・変更・終了のdelta、安定fingerprint、上限。
- `web/src/app/api/opencode/[...path]/route.test.ts`: 注入なし、明示的upstream拒否時のclaim解放、画像・command・非JSON経路への非干渉。

### 完了条件

- 同じpeer状態の連続送信ではcollaboration blockを二度送らない。
- memory blockは件数・文字数上限を超えない。
- upstreamが拒否した送信を成功扱いにして次回注入を永久に抑止しない。

## Phase 2: 自動compactの選択式導入

### 設定

- `web/src/lib/token-saving-settings.ts` を新設し、`off` / `suggest` / `auto` と閾値を管理する。
- 初期値は `off`、閾値は80%。閾値は70～95%にclampする。
- localStorageを即時読み取り元、既存のsettingsテーブルを他ブラウザ共有用のバックアップとする。
- `web/src/app/api/settings/[key]/route.ts` のallowlistとvalidationを追加する。
- `web/src/components/settings/SettingsView.tsx` の「全般」に「トークン節約」設定を追加する。

### 送信フロー

- `web/src/components/task/SessionActions.tsx` のcompact処理を再利用可能なPromise関数へ分離し、手動compactと自動compactで同じAPI・エラー処理を使う。
- `TaskView.tsx` の送信直前に、最新context usageが閾値以上、sessionがidle、permission/question待ちでない場合だけ判定する。
- `suggest` は既存compactボタンへ誘導する通知を出す。`auto` は一度だけcompactをawaitしてから送信する。
- sessionごとのin-flight lockとcooldownを設け、連続送信・複数タブで二重compactしない。
- compact失敗時はプロンプトを消失させず、入力を復元してエラーを表示する。OpenCode非対応・状態競合時は既存送信動作を壊さない。
- `useSessionStream.ts` の `session.compacted` 後のresyncを完了条件に利用し、圧縮前の古いusageを表示し続けない。
- **compact完了検知**: `session.compacted` SSEは`scheduleNextResync`のみを行い`pendingMutationRef`を更新しないため、compact完了を確実に待つには追加の完了検知が必要。compact開始時にフラグを立て、`session.compacted`受信またはresync後のusage低下で完了判定する。timeout fallback（例: 30秒）も設け、未検知時に送信を止めない。

### テスト

- `token-saving-settings.test.ts` とsettings route tests。
- `SessionActions.test.tsx`: 手動・自動で同じcompact呼び出し、in-flight重複抑止。
- `TaskView.test.tsx`: 閾値未満、suggest、auto、cooldown、permission待ち、compact失敗時の入力保持。
- 稼働中hostで、80%到達時にcompactが1回だけ発生し、その後promptが送信されることを短い手動確認。

## Phase 3: Goal Loopの固定prompt短縮

### 変更対象

- `web/src/lib/goal-loop.ts` の固定規約を短い共通blockへ分離する。
- turn 1は現行の完全prompt、turn 2以降は「次の最小作業・turn番号・goal・必要なacceptance・直近2件のprogress・JSON出力契約」だけを送る。
- 変化しない規約をprompt先頭、turn固有情報を末尾に置き、providerのprefix cacheを壊しにくくする。
- **verification promptは短縮しない**: 検証プロンプトは前回claimの`summary`/`evidence`に依存し、検証品質が完了判定に直結するため、現行の完全版を維持する。ただしclaim引き渡し部分は短縮後のprogress形式と整合させる。
- Goal LoopはBFFを通らず `ocServer` から送信されるため、Phase 2のclient自動compact対象外。必要ならこのphaseで、直前turnがidleのときだけserver側で同じ閾値判定を追加する。
- **Goal Loop自動compactの競合リスク**: Goal Loopの`prompt_async`はOpenCodeエンジンのstatusを直接操作しないため、compact中のターン送信が競合する。Goal Loopへcompactを組み込む場合は、ターン完了（idle）を確認してからcompact→次ターン送信の順を保証し、compact未完了時は次ターンを遅延させる。ただし初期実装ではGoal Loopにはcompactを組み込まず、client送信時のみ適用する。

### テスト・完了条件

- `goal-loop.test.ts` でturn 1とturn 2以降のprompt内容、marker、JSON契約、progress上限を固定する。
- 既存の自動継続、pause、verification、unreadable result判定を壊さない。
- 10turn相当のfixtureで固定prompt文字数を現行比40%以上削減し、Goal Loop完了率を維持する。

## Phase 4: 検証と段階展開

- 比較対象を「通常チャット」「並行sessionあり」「memory 8件」「Goal Loop 10turn」に固定する。
- `tokens.input`、cache read率、compact回数、compact前後のcontext使用量、再説明が必要になった回数を比較する。
- Phase 1は既定有効、Phase 2のautoは既定off、Phase 3はテスト後に段階有効化する。
- 検証は `npm --prefix web run typecheck`、`npm --prefix web run lint`、対象Vitest、必要に応じて全Vitestを使う。`next dev` / `next build` は実行しない。

## 実装しない範囲

- WebUI独自のLLM要約を追加しない。要約品質と追加コストが発生するため、compactはOpenCode標準APIを使う。
- 送信済みユーザーメッセージをWebUI側で削除・改変しない。
- 実行中のsessionを強制compactしない。
- Autoモデル選択の既存コスト優先ロジックを、トークン節約目的で重複実装しない。

## レビュー第2弾: 追加リスクと計画修正 (2026-08-11)

### compact後のmemory再注入欠落

- 現状の`memory_session_injections`はsessionごとに1回限りのclaimであり、compact完了後に続くユーザーpromptでもclaimが存在するとmemory注入がスキップされる。
- これは既存の挙動だが、Phase 2で自動compactを導入するとcompact後にmemory contextが失われたまま次ターンへ進むケースが頻発する。
- **対応案**: `session.compacted` SSE受信時に該当sessionの`memory_session_injections`行を削除し、次回prompt_asyncでmemory再注入を許可する。collaboration contextのfull snapshot再注入と同じタイミングで処理する。これによりcompactで失われたmemory contextが次ターンで復元される。
- **テスト**: compact後にmemory claimが解放され、次回送信で再注入されること、compact未発生時はclaimが維持されることを`memory.test.ts`と`useSessionStream`関連テストへ追加する。

### Phase 0→Phase 2の順序依存

- Phase 2の閾値判定はPhase 0の`context-usage.ts`と`token-usage.ts`に依存するが、現計画ではPhase 0→Phase 1→Phase 2の順で、Phase 0はPhase 1より前に完了する必要がある。
- **確認**: 計画のPhase番号は実装順序と一致しており、Phase 0が先に完了する前提で問題ない。ただしPhase 1の注入削減効果を計測するにはPhase 0の計測基盤が必要なため、Phase 0を先にリリースして効果測定してからPhase 1を評価できるよう、Phase 0は独立リリース可能にする。

### collaboration差分注入とcompactの相互作用

- compact後にfull snapshotを再注入する計画だが、compactが連続発生した場合、毎回full snapshotが注入され差分削減効果が相殺されるリスクがある。
- **対応**: compact後のfull snapshot再注入は1回限りとし、次回以降は再び差分注入へ戻す。snapshot claimに`compacted_at`時刻を記録し、compact未発生時のみ差分モードへ遷移する。
- compact連続発生時はcooldownでcompact間隔を制限するため、実運用では相殺リスクは低いが、テストで連続compact後の注入回数を固定する。

### Goal Loop短縮後の再測定

- Phase 3でGoal Loop promptを短縮した後、Phase 4の計測指標でGoal Loop完了率とinput tokensを再測定する必要がある。
- Goal LoopはPhase 2のclient自動compact対象外のため、Goal Loop単体でのトークン削減効果はprompt短縮のみに依存する。
- **確認**: Phase 4の比較対象に「Goal Loop 10turn」が含まれており、Phase 3前後で比較可能。Phase 3リリース前にbaseline計測をPhase 0基盤で取得しておく。

---

# 実装: トークン節約機能 Phase 0 + Phase 1

## 日付

2026-08-11

## Phase 0: 計測基盤

### 新設ファイル

- `web/src/lib/token-usage.ts`: assistant messageの `input` / `cache.read` / `cache.write` / `output` / `reasoning` / `total` を集計する純粋関数。`lastTurnTokenUsage`（最新turnの内訳）と `cumulativeTokenUsage`（session累計）を提供。ゼロ使用の末尾レコードはスキップし、負値は0へclamp。message本文は保存・送信しない。
- `web/src/lib/token-usage.test.ts`: 13テスト。空配列、ゼロ使用スキップ、最新turn選択、負値clamp、cache hit率計算、累計集計を検証。

### TaskView表示

- `web/src/components/task/TaskView.tsx`: `lastTurnTokenUsage` を `contextUsage` と並んで `useMemo` で計算。モバイル・デスクトップ双方のコンテキスト使用量tooltipへ「入力: X / cache読取: Y (Z%)」を追加。

## Phase 1: 注入コンテキストの予算化

### workspace memory

- `web/src/lib/memory.ts`:
  - `MEMORY_INJECTION_BUDGET_ITEMS = 5` / `MEMORY_INJECTION_BUDGET_CHARS = 4000` を追加。
  - `buildBudgetedMemoryInjectionBlock` を新設。件数・文字数上限を適用して `buildMemoryInjectionBlock` へ渡す。
  - `claimMemoryInjectionForSession` へ `query?: string` 引数を追加。FTS上位結果を優先し、ヒットなし時は `use_count` / `updated_at` 順へフォールバック。選択・usage bump・session claimを同一SQLite transaction内で実行。
- `web/src/app/api/opencode/[...path]/route.ts`: `injectWorkspaceMemory` が `firstText.text` をqueryとして `claimMemoryInjectionForSession` へ渡すよう変更。

### collaboration context

- `web/src/lib/db.ts`:
  - `collaboration_snapshots` 表を追加。workspace/session単位でfingerprint・snapshot・`compacted_at`を管理。workspace削除時はcascade。
  - `getCollaborationSnapshot` / `upsertCollaborationSnapshot` / `markCollaborationSnapshotCompacted` / `clearCollaborationSnapshotCompacted` を追加。
- `web/src/lib/collaboration-context.ts`:
  - `peerFingerprintLine` / `peersFingerprint` を追加。peer順序に依存しない安定fingerprintを生成。
  - `collaborationContextFor` を拡張: 直前snapshotと同一fingerprintなら空文字を返し注入をスキップ。compact後（`compacted_at`設定時）は次回必ずfull blockを注入。空peer時もsnapshotを更新し無駄な再fetchを防ぐ。

### テスト

- `web/src/lib/memory.test.ts`: `buildBudgetedMemoryInjectionBlock` の件数・文字数上限、FTS query優先、fallback、session二重claimを検証（+4件）。
- `web/src/lib/collaboration-context.test.ts`: `peersFingerprint` の順序非依存・files/status変更検出・空peerを検証（+4件）。

## 検証結果

- `npx vitest run src/lib/token-usage.test.ts` ... 13 tests 成功
- `npx vitest run src/lib/memory.test.ts` ... 16 tests 成功
- `npx vitest run src/lib/collaboration-context.test.ts` ... 8 tests 成功
- `npx tsc --noEmit --pretty false` ... 成功
- `npx eslint src` ... 成功
- `npx vitest run`（web全体）... 263 files / 3091 tests 成功 / 1 skipped

## 変更ファイル

- web/src/lib/token-usage.ts（新規）
- web/src/lib/token-usage.test.ts（新規）
- web/src/lib/memory.ts
- web/src/lib/memory.test.ts
- web/src/lib/db.ts
- web/src/lib/collaboration-context.ts
- web/src/lib/collaboration-context.test.ts
- web/src/app/api/opencode/[...path]/route.ts
- web/src/components/task/TaskView.tsx

---

# 実装: トークン節約機能 Phase 2

## 日付

2026-08-11

## 実装内容

- `web/src/lib/token-saving-settings.ts` を追加。`off` / `suggest` / `auto`、閾値70〜95%（既定80%）、localStorage保存、settings API同期、閾値判定関数 `shouldAutoCompact` を実装。
- `web/src/app/api/settings/[key]/route.ts` に `token-saving` / `token-saving-threshold` のallowlistとvalidationを追加。
- `SettingsView.tsx` の全般タブにトークン節約モードと閾値のselect/inputを追加。既存のコスト表示ボタンとrole検索が衝突しないよう、モードはselectとした。
- `SessionActions.tsx` のcompact API呼び出しを `compactSession` として共有化。
- `TaskView.tsx` の手動送信前に、autoモード・閾値超過・idle・permission/questionなしを確認してcompact→既存 `stream.resync()` →prompt送信を実行。suggestモードはwarning通知のみ。compact失敗時は送信を継続し、入力を失わない。
- session変更時にcompactのin-flight/cooldownをリセットする。同一TaskView内の連続compactは60秒cooldownで抑止する。
- compact成功時にBFF routeが `memory_session_injections` のclaimを解放し、`collaboration_snapshots.compacted_at`を記録する。次回promptでmemoryとcollaboration contextを再注入する。
- memory budgetを実ブロック全体で4,000文字以内に補正し、長いprompt向けの安全なOR型FTS query `toFtsAnyQuery`を追加。

## テスト・検証

- `token-saving-settings.test.ts` にモード、閾値、cooldown、pending input、auto判定のテストを追加。
- settings route、SettingsView、BFF compact resetの回帰テストを追加。
- `npx tsc --noEmit --pretty false` 成功。
- `npx eslint src` 成功。
- `npx vitest run` 成功: 264 files / 3120 tests passed / 1 skipped。

## 残余リスク

- compactのin-flight/cooldownはTaskViewインスタンス単位だが、複数ブラウザタブ間の原子的な二重compact防止は`session_compaction_locks`で実装済み（Phase 4補完）。
- compact完了は既存の`session.compacted`イベントに伴う`stream.resync()`で待つ。SSE欠落時はcompact POST成功後のresync結果に依存するため、将来は明示的なcompletion waiterとtimeoutを追加できる。

---

# 実装: トークン節約機能 Phase 3 Goal Loop prompt差分化

## 日付

2026-08-11

## 実装内容

- `web/src/lib/goal-loop.ts` のturn 1は従来の完全promptを維持し、turn 2以降は `buildGoalContinuationPrompt` を使うよう変更。
- continuation promptは固定Rulesを短縮し、turn番号、Goal、acceptance criteria、直近2件のprogressだけを保持する。
- progressのsummary / next / evidenceは維持し、次turnが前turnの実施内容と証拠を参照できるようにした。
- `buildVerificationPrompt` は変更せず、最新のcompletion claimのsummary/evidenceを従来どおり検証promptへ渡す。

## 回帰テスト

- turn 1だけmemory blockを注入し、turn 2以降はmemory blockを再注入しないことを確認。
- turn 2以降が完全promptより短く、固定Rulesを繰り返さないことを確認。
- verification promptが最新claimのsummary/evidenceを保持し、古いprogressのsummary/evidenceを混入させないことを確認。
- marker、JSON output contract、turn番号、既存のGoal Loop継続・検証経路を維持。

## 検証結果

- `npx vitest run` 成功: 264 files / 3121 tests passed / 1 skipped。
- `npx tsc --noEmit --pretty false` 成功。
- `npx eslint src/lib/goal-loop.ts src/lib/goal-loop.test.ts` 成功。

---

# 実装: session単位の二重compact防止ロック

## 日付

2026-08-11

## 実装内容

- `db.ts` に `session_compaction_locks` 表を追加。sessionごとにowner・取得時刻・期限を保持する。
- `tryAcquireSessionCompactionLock` は期限切れ行の削除とINSERTを同一transactionで実行し、複数タブ・複数WebUIプロセスでも1つだけ取得できる。
- `releaseSessionCompactionLock` はsession IDとowner IDの一致時だけ解放する。期限切れ後に別ownerが取得したロックを旧ownerが解放することはない。
- BFFのcompact経路でlockを取得し、upstreamのレスポンス受信後に解放する。ネットワーク例外時はcompactがupstreamへ届いた可能性があるため即時解放せず、TTL（60秒）で自然回収する。
- lock競合時は`session_compaction_locked`付きHTTP 409を返す。
- `compactSession`はこの409だけ最大10秒リトライし、解消しない場合はTaskViewがprompt送信を中止してcomposer内容を復元する。他のOpenCode 409はリトライしない。

## 回帰テスト

- DB: 同一sessionの排他、別sessionの独立取得、owner限定解放、期限切れ後の再取得。
- BFF: lock取得・解放、競合時のupstream未送信、compact成功後のcontext claim reset。
- client: lock競合だけリトライし、無関係な409は即時失敗すること。

## 検証結果

- `npx tsc --noEmit --pretty false` 成功。
- 対象eslint 成功。
- `npx vitest run` 成功: 264 files / 3128 tests passed / 1 skipped。

---

# 実装: Goal Loopのserver-side自動compact

## 日付

2026-08-11

## 実装内容

- `web/src/lib/goal-loop.ts` の `ocServer` 直送経路でも、token-saving設定が `auto` の場合だけcontext使用率を確認するよう変更。
- `/provider` のmodel context limitと最新assistant messageのtoken使用量から、既存の `computeContextUsage` で閾値判定する。
- 閾値到達時は既存のsession単位compact lockを取得し、`/api/session/{id}/compact` を実行する。
- compact後はsession statusとtranscriptをpollし、compact反映を確認してからGoal Loopの次promptを送信する。
- 別タブ・別プロセスがlockを保持している場合はGoal Loopをqueuedのまま送信せず、次回scheduler tickで再試行する。
- Goal turnだけでなくverification turnにも同じcompact判定を適用する。lockは成功・失敗を問わずfinallyでowner限定解放する。

## 回帰テスト

- `web/src/lib/goal-loop.integration.test.ts` に、lock競合中のprompt未送信、lock解放後のcompact実行とprompt再開を追加。

## 検証結果

- `npm exec tsc -- --noEmit` 成功。
- `npm exec eslint -- src/lib/goal-loop.ts src/lib/goal-loop.integration.test.ts` 成功。
- 関連5ファイルのVitest: 99 tests passed。

---

# 追加: compact完了待ちのタイムアウト・異常終了時にpromptを送信しない回帰テスト

## 日付

2026-08-11

## 実装内容

- 既存実装を確認したところ、`autoCompactGoalLoop` はcompact完了待ちのタイムアウト時に `OcError` を投げ、`/api/session/{id}/compact` 呼び出し自体が失敗した場合もそのまま例外を伝播する。呼び出し元の `processLoop` はこの例外を投げた地点より前でターンをclaimしていないため、いずれの場合もpromptは送信されない。実装コードの修正は不要と判断した。
- lockは `finally` で解放されるため、タイムアウト・異常終了時もowner限定解放が効くことを確認した。

## 回帰テスト

- `web/src/lib/goal-loop.integration.test.ts`:
  - `reachQueuedTurnTwoWithHighUsage` ヘルパーを追加。turn 1はauto-compact off（`createGoalLoop` が発火するfire-and-forgetなscheduler tickと競合しないようにするため）で正常完了させ、turn 2をqueuedのまま高使用率状態で待機させる。
  - 「compact完了待ちがタイムアウトした場合、prompt未送信・lock解放・ループはqueuedのまま」を検証（`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(31_000)` でCOMPACT_TIMEOUT_MS=30_000を実時間なしに越えさせる）。
  - 「`/api/session/{id}/compact` 呼び出し自体が失敗した場合、prompt未送信・lock解放・ループはqueuedのまま」を検証。
  - 「schedulerTickではcompactタイムアウト時にpause_reason='scheduler_error'で一時停止し、prompt未送信のまま保持する」を検証(`runGoalLoopSchedulerTick` 経由)。
  - 実装のtimeout throwを一時的に取り除いて上記2テストが実際に落ちることを確認済み(false positiveでないことのサニティチェック)。

## 検証結果

- `npm exec tsc -- --noEmit` 成功。
- `npm exec eslint -- src/lib/goal-loop.ts src/lib/goal-loop.integration.test.ts` 成功。
- `npx vitest run src/lib/goal-loop.integration.test.ts` ... 39 tests passed。
- `npx vitest run`(web全体) ... 264 files / 3132 tests passed / 1 skipped。
## メッセージメタデータの表示短縮

### 日付

2026-08-11

### 修正

`MessageMetaHeader` の応答メタデータから `コスト`、`トークン`、`思考` の表示ラベルを削除し、表示領域を節約した。トークン数には末尾に `tk` を付け、表示形式を `¥7.5 · 2.3Ktk · 1m 05s` のように変更した。

### 回帰テスト

- `MessageMetaHeader.test.tsx` でラベル非表示、`tok` 付与、表示順を検証
- `NestedAgentPanel.test.tsx` の共有メタデータ表示期待値を更新

### 検証

- `npm run test -- --run src/components/task/MessageMetaHeader.test.tsx src/components/task/NestedAgentPanel.test.tsx`: 16 tests passed
- `npm run typecheck`: 合格
- `npm run lint -- src/components/task/MessageMetaHeader.tsx src/components/task/MessageMetaHeader.test.tsx src/components/task/NestedAgentPanel.test.tsx`: 合格

---
## メッセージ日時の表示短縮

### 日付

2026-08-11

### 修正

`formatMessageTime` の日時表示を `8月11日 09:19` から `8/11火 09:19` の形式へ変更し、月名の文字列を短縮した。

### 検証

- `MessageMetaHeader.test.tsx` で曜日付き日時表示を検証
- `npm run test -- --run src/components/task/MessageMetaHeader.test.tsx`: 8 tests passed
- `npm run typecheck`: 合格
- `npm run lint -- src/components/ui.tsx src/components/task/MessageMetaHeader.test.tsx`: 合格

---
## 累計メタデータの表示短縮

### 日付

2026-08-11

### 修正

TaskView ヘッダーの `累計コスト`、`累計トークン`、`累計思考時間` ラベルを削除し、値と既存の単位のみを表示するよう変更した。

### 検証

- `TaskView.test.tsx` の累計コスト表示期待値を更新
- `npm run test -- --run src/components/task/TaskView.test.tsx`: 115 tests passed

---

# 調査ログ: メモリ自動抽出の承認ゲート

## 日付

2026-08-11

## 結論

現状の自動抽出メモリは、候補を作成するところまで自動で、承認しない限り通常会話へ注入されない。したがって、人間が承認しない運用では自動メモリとして実質利用されない。

## 根拠

- `web/src/lib/memory-extract.ts` は抽出結果を `approved: false` で保存する。
- `web/src/lib/memory.ts` の検索・注入は `approved = 1` の行だけを対象にする。
- `MemorySettings` も「候補」を承認すると利用される、と表示している。
- 自動抽出のトリガーは goal loop 完了またはアイドルであり、通常の手動抽出は画面操作が必要。
- 例外として、MCP の `memory_add` はエージェント由来の承認済み行を直接作る。

## 検証

- `npm --prefix web test -- --run src/lib/memory.test.ts src/lib/memory-extract.test.ts src/components/settings/MemorySettings.test.tsx` ... 3 files / 30 tests 成功

## 判断

これは実装上の偶発的な不具合ではなく、`docs/specs/memory-layer.md` が定めた承認先行設計による挙動。自動承認へ変更する場合は、候補を即時利用できる代わりに、モデル出力によるメモリ汚染を人間が止める機会を失うため、設定として選べる形が望ましい。

## Hermes Agent との比較

NousResearch の Hermes Agent 公式ドキュメント（2026-08-11確認）では、`memory.write_approval: false` がデフォルトで、通常ターンとバックグラウンドレビューのメモリ書き込みを自動で確定する。`true` にした場合だけ承認待ちへステージされる。したがって、現WebUIの「常に候補を作り、承認済みだけ注入」はHermesのデフォルトとは逆で、より安全側の設計である。

- https://hermes-agent.nousresearch.com/docs/user-guide/features/memory

## 改善計画

Hermes Agent と同様に「自動確定を既定、必要なら承認制」を選べるようにする。ただし、単に自動抽出を `approved: true` に変えるのではなく、次の順序で安全性と実効性を両立する。

1. 保存前防御を共通化する。Web抽出・手動抽出・MCP `memory_add` の全経路で、不可視Unicode、メモリ境界タグ、明白なプロンプト注入・資格情報持ち出し表現を拒否し、拒否理由を監査ログへ残す。既存の文字数制限、完全一致重複排除、注入時エスケープと「参照情報であり命令ではない」という境界は維持する。
2. `memory.write_approval` 設定を追加する。デフォルトは `false`（自動確定）、`true` の場合は全書き込み経路を未承認候補へ統一する。現在のMCPだけ常時承認済みになる例外も解消する。
3. 抽出ドライバは設定を実行開始時に解決し、`write_approval=false` なら承認済み、`true` なら候補として保存する。監査ログには自動確定か承認待ちかを記録する。
4. メモリ設定画面へ「保存前に確認する」トグルを追加する。OFFを推奨既定として説明し、ONでは候補タブから承認する。自動保存時も作成件数と内容への導線を通知し、誤記憶を削除・編集できる状態を維持する。
5. 通常会話の各完了ターン後にもバックグラウンド抽出を行う。ブラウザ依存ではなくサーバー側のassistant完了イベントを起点にし、`workspace_id + session_id + assistant_message_id` の永続台帳で一度だけ実行する。goal完了と60分idleは補完トリガーとして残し、同じ台帳で重複を防ぐ。
6. 既存の未承認候補は自動昇格させない。新設定は今後の書き込みだけへ適用し、候補タブの一括承認でユーザーが明示的に移行できるようにする。
7. 回帰テストでは、設定の既定値、全書き込み経路のゲート統一、脅威検査、通常ターン後の一度だけ抽出、トリガー間重複排除、未承認非注入、承認済み注入、既存候補維持を検証する。関連Vitest、typecheck、ESLintを通し、本番ビルドはプロジェクト指示に従い実行しない。

実装は「防御と共通ゲート」「設定/UIと自動確定」「ターン後レビュー」の3コミットに分け、各段階で独立してロールバック可能にする。

---

# 作業ログ: メモリ書き込み経路の脅威検査と共通承認ゲート（第1段階）

## 日付

2026-08-11

## 実装内容

改善計画の第1段階として、全メモリ書き込み経路に保存前の脅威検査と共通承認ゲートを実装した。

### 新規: `web/src/lib/memory-safety.ts`

保存前脅威検査モジュール。フレームワーク非依存（`./db` を import しない）で、MCP サーバが共有スキーマから同ロジックを参照できる。

- `inspectMemoryContent(content: string): MemorySafetyViolation | null`
- 検査対象: 不可視Unicode文字、`<workspace-memory>` 境界タグ、プロンプト注入パターン（`ignore previous instructions` / `disregard the above rules` / `you are now a` / `system:` / `do not follow the system prompt` / `reveal the system prompt` / `print the system prompt` / `<system>` ロールタグ）、資格情報持ち出し（`api_key=` / AWS `AKIA...` / `-----BEGIN RSA PRIVATE KEY-----` / `sk-...` / `send the .env`）、SSHバックドア（`authorized_keys` / `ssh-rsa AAA...` / `ssh-ed25519 AAA...` / `add your public ssh key`）。
- 拒否理由は `{ code, message }` で返し、`message` は日本語。

### 共有: `browser-bridge/shared/memory-schema.mjs`

同じ検査ロジックを `inspectMemoryContent` として追加。Web側の `memory-safety.ts` と同一パターン・同一メッセージ。MCPサーバは `memoryValidate` に加えて保存直前にこれを呼ぶ。

### `web/src/lib/memory.ts`

- `createMemory`: 文字数制限後に `memorySafetyError` を呼び、違反があれば `RangeError` を投げて書き込みを阻止。
- `updateMemory`: `patch.content` が渡された場合に同検査。
- `insertExtractedMemories`: 各 item ごとに同検査を行い、違反は `errors` 配列へ追加してスキップ（created には含めない）。
- 新規 `memorySafetyError(content)` と再エクスポート `inspectMemoryContent` / `MemorySafetyViolation`。

### `web/src/lib/goal-memory-hook.ts`

- 新規 `WRITE_APPROVAL_SETTING_KEY = "memory.write_approval"`。
- `isMemoryWriteApprovalEnabled()`: `settings` テーブルの値が `"1"` のとき true、それ以外は false（Hermes互換の自動確定が既定）。

### `web/src/lib/memory-extract.ts`

- `runMemoryExtraction` が `isMemoryWriteApprovalEnabled()` を参照し、`false` なら `approved: true`、`true` なら `approved: false` で挿入。
- 監査ログの `detail` に `approved=0|1` を追記。

### `browser-bridge/mcp/memory-server.mjs`

- `createMemoryStore` が `writeApproval` オプションを受け取り、`memory_add` の `approved` を `writeApproval ? 0 : 1` にする。従来は `approved=1` 固定だった例外を解消。
- `add` / `update` で `inspectMemoryContent` を呼び、違反時は `INVALID_REQUEST` を投げる。
- `createMemoryMcpServer` と `runStdio` が `writeApproval` を受け渡し、`OPENCODE_WEBUI_MEMORY_WRITE_APPROVAL=1` 環境変数で有効化。

## 回帰テスト

### 新規 `web/src/lib/memory-safety.test.ts`（7件）

- 通常ファクトは許可、不可視Unicode・境界タグ・プロンプト注入7種・資格情報5種・SSHバックドア3種を拒否、良性の言及は誤検知しない。

### `web/src/lib/memory.test.ts`（+4件、計21件）

- `memorySafetyError` の違反メッセージ。
- `createMemory` が脅威内容を `RangeError` で拒否し、DBへ残さない。
- `updateMemory` が脅威内容を拒否し、既存内容を維持。
- `insertExtractedMemories` が脅威 item を `errors` に記録し `created` から除外。

### `web/src/lib/goal-memory-hook.test.ts`（+2件、計7件）

- `isMemoryWriteApprovalEnabled` の既定値（false = 自動確定）。
- `WRITE_APPROVAL_SETTING_KEY` が `"1"` のとき true、`""` で false。

### `browser-bridge/test/memory-mcp-stdio.test.mjs`（+2テスト）

- `validation and not-found errors` に脅威内容の拒否（プロンプト注入・境界タグ）を追加。
- 新規 `write approval gate stages agent writes as candidates`: `OPENCODE_WEBUI_MEMORY_WRITE_APPROVAL=1` で `memory_add` が `approved=false` になり、検索に出ず、承認後に検索へ出ることを検証。

## 検証

- `npm --prefix web run typecheck` ... 成功
- `npx eslint`（対象7ファイル） ... 成功（0 error / 0 warning）
- `npm --prefix web test -- --run`（対象6ファイル） ... 54 tests 成功
- `cd browser-bridge && node --test test/memory-mcp-stdio.test.mjs` ... 5 tests 成功
- 本番ビルドはプロジェクト指示により実行しない

## 設計メモ

- 脅威検査は純粋関数で SQLite トランザクション内でも副作用がない。
- 共有スキーマ版と Web 版は同じパターン・同一メッセージ。パターン追加時は両方へ反映すること。
- 承認ゲートは書き込み時点で解決するため、トグル直後の抽出から即時反映される。
- 既存の未承認候補は自動昇格させず、ユーザーが一括承認で移行する（計画第6項）。

---

# 作業ログ: メモリ保存設定UIとDB共通承認ゲート（第2段階）

## 日付

2026-08-11

## 実装内容

改善計画の第2段階として、`memory.write_approval` を設定API・メモリ画面・Web/MCPの書き込み経路へ接続した。

- `web/src/lib/memory-settings.ts` に設定キーを切り出し、サーバー/クライアントで共有。
- `web/src/lib/memory-write-gate.ts` にDBから設定を読む共通関数を追加。抽出ドライバからgoal hookを逆参照する循環importを解消。
- `web/src/app/api/settings/[key]/route.ts` の許可リスト・boolean設定へ `memory.write_approval` を追加。`"1"` または空文字だけを受け付ける。
- `MemorySettings` に「保存前に確認する」トグルを追加。既定OFFは脅威検査通過後に自動保存、ONは候補として保存する。抽出ボタン、説明、完了通知、空状態もモードに応じて表示を変更。
- `createMemory` が設定を直接参照し、承認済み指定をゲートで上書き。`updateMemory` も承認制有効時は更新行を `approved=0` に戻す。
- MCPサーバーは環境変数を暫定フォールバックにしつつ、通常は共有DBの `settings` テーブルから `memory.write_approval` を毎回読む。MCP更新も承認制時に候補へ戻す。
- 脅威検査によるWeb/MCPの拒否理由を `memory_audit_log` の `reject` として記録。
- `docs/specs/memory-layer.md` の自動保存・設定可能な承認制・保存前脅威検査の記述を実装へ同期。

## 回帰テスト

- Web設定API: 設定のGET、`1`/空文字の保存、無効値拒否。
- MemorySettings: 自動保存モード表示、トグル保存、承認モード表示。
- Webメモリ: create/updateの共通ゲート、拒否監査ログ。
- MCP: DB設定による候補化、検索非表示、承認後検索可能。

## 検証

- `npm --prefix web test -- --run src/lib/memory.test.ts src/lib/goal-memory-hook.test.ts src/components/settings/MemorySettings.test.tsx src/app/api/settings/[key]/route.test.ts src/app/api/memory/route.test.ts` ... 5 files / 105 tests 成功
- `cd browser-bridge && node --test test/memory-mcp-stdio.test.mjs` ... 5 tests 成功
- `npm --prefix web run typecheck` ... 成功
- 対象ファイルの `npx eslint` ... 成功
- `git diff --check` ... 成功
- 本番ビルドはプロジェクト指示により実行しない

---

# 作業ログ: コスパランキングの価格設定済みモデル無料判定修正

## 日付

2026-08-11

## 根本原因

`rankModelUsage` が `MessageInfo.cost` のみを集計しており、設定画面で保存した `providerID::modelID` 別の価格を、OpenCodeが費用を0として返すモデルに適用していなかった。そのため、価格設定済みモデルがランキングで「無料」と判定されていた。

## 修正

- `rankModelUsage` に価格レジストリを渡せるようにし、正の報告費用を優先しつつ、0または未設定の場合は手動価格または組み込みOpenAI価格表から費用を推定するようにした。
- モデルランキングAPIで `readProviderModelState().modelPricing` を集計へ渡すようにした。
- 画面説明を、報告費用または設定価格による比較であることに更新した。

## 回帰テスト

- `model-ranking.test.ts` に、設定価格による推定と報告費用の優先を追加。
- `model-ranking/route.test.ts` に、API経由で保存価格が適用されることを追加。

## 検証

- `npx vitest run`: 271 files / 3259 passed / 1 skipped
- `npm run typecheck`: 成功
- 関連5ファイルのESLint: 成功
- `git diff --check`: 成功
- 本番ビルドはプロジェクト指示により実行しない

---

# 作業ログ: 通常会話のassistant完了後メモリ抽出（第3段階）

## 日付

2026-08-11

## 実装内容

改善計画の第3段階として、ブラウザが開いていない通常会話でもassistantターン完了後に自動抽出するサーバー監視と、goal/idleとの重複排除を実装した。

- `web/src/lib/memory-auto-extract.ts` を新設。Node runtime起動後にOpenCode `/global/event` SSEを購読し、`message.updated` の完了済みassistantだけを処理する。SSE切断時は1秒から最大15秒のバックオフで再接続する。
- `completedAssistantEvent` / `sseDataFromFrame` / `consumeMemoryEventStream` を純粋・注入可能な形で実装し、chunk境界・heartbeat・v1 global event envelopeに対応。
- eventのdirectoryとsession bindingの対応が一意な場合だけworkspaceへ紐付ける。曖昧な複数workspaceはスキップしてメモリ漏洩を防ぐ。
- `web/src/instrumentation.ts` から `startMemoryAutoExtractionMonitor()` をNode起動時に開始。ブラウザの`useSessionStream`には依存しない。
- `web/src/lib/db.ts` に `memory_assistant_extracts` 台帳を追加。`(workspace_id, session_id, assistant_message_id)` を主キーに、`in_flight` claim、10分TTLのstale claim回収、`completed`、失敗時releaseを提供する。
- event監視とgoal完了フックは同じclaimを共有するため、goalターンを二重抽出しない。抽出成功時は既存のidle台帳も完了扱いにして、同一sessionのidle抽出重複も抑止する。
- assistant完了イベントで `session_bindings.updated_at` も更新し、通常会話のactivityをidle検出へ反映する。
- workspace/project削除時にassistant抽出台帳も明示削除する。
- `docs/specs/memory-layer.md` の通常assistant完了トリガー、global event監視、台帳、goal/idle重複排除を実装へ同期。

## 回帰テスト

- 新規 `web/src/lib/memory-auto-extract.test.ts`（5件）: 完了assistantイベントの抽出、user/incomplete/無関係イベントの無視、SSE chunk分割、heartbeat、同一messageの一度だけclaim。
- `web/src/lib/db.test.ts`（11件）: assistant抽出台帳の排他、completed後の再claim拒否、release後の再試行、stale claim回収。
- Goal Loop / idle既存テストを再実行し、既存トリガーへの回帰がないことを確認。

## 検証

- `npm --prefix web test -- --run src/lib/memory-auto-extract.test.ts src/lib/db.test.ts src/lib/goal-memory-hook.test.ts src/lib/goal-loop.test.ts src/lib/memory-idle.test.ts` ... 5 files / 63 tests 成功
- `npm --prefix web run typecheck` ... 成功
- 対象ファイルの `npx eslint` ... 成功
- 本番ビルドはプロジェクト指示により実行しない
## Goal Loop: 一時的なOpenCode通信障害で停止する不具合を修正

### 日付

2026-08-11

### 根本原因

- `goal-loop.ts` の `processLoop()` は `/session/status` の読み取りを短時間リトライした後、`fetch failed`・5xx・タイムアウトを例外としてスケジューラへ返していた。
- `runGoalLoopSchedulerTick()` の catch-all がその一時障害を `scheduler_error` + `paused` に確定していたため、最初のプロンプトを送る前でもループが `0/100` で停止した。
- `token-saving=auto` ではターン送信前の `/provider` メタデータ取得も同じ影響を受けていた。
- 実環境のループ行は `turn_count=0`、`pause_reason=scheduler_error`、`error=fetch failed` で、直前のhostログにも対象セッションのstatus timeoutと`fetch failed`が記録されていた。

### 修正

- 読み取り専用の `/session/status` が一時的に失敗した場合は状態を変更せず、次のスケジューラtickで再試行するようにした。
- 自動コンパクション用 `/provider` メタデータ取得の一時障害も `retry` としてキュー状態を維持するようにした。
- `prompt_async` の送達不明やコンパクション自体・完了確認の失敗は、重複送信防止のため従来どおり停止経路に残した。

### 回帰テスト

- statusの一時障害3回後も`queued`を維持し、次tickでpromptを1回だけ送信する統合テストを追加。
- auto-compactのproviderメタデータ一時障害3回後も`queued`を維持し、復旧後の次tickでpromptを送信する統合テストを追加。

### 検証

- Goal Loop関連: 3ファイル / 118 tests passed
- Web全体: 271 files / 3263 tests passed / 1 skipped
- `npm run typecheck`: 成功
- `npm run lint -- src/lib/goal-loop.ts src/lib/goal-loop.integration.test.ts`: 成功
- 本番ビルドは常駐WebUIを停止させるため実行していない。

---

# 作業ログ: タグ付きモデルの価格設定がランキングで無料判定される不具合の修正

## 日付

2026-08-11

## 根本原因

保存価格が `ollama-cloud::gpt-oss` や `ollama-cloud::gemma4` のようなベースモデルIDで登録されている一方、OpenCodeの実モデルIDは `gpt-oss:120b` や `gemma4:31b` のタグ付きIDだった。価格参照が完全一致のみだったため、設定価格が存在してもランキングでは無料扱いになっていた。

## 修正

- 完全一致を優先し、該当しない場合は `base-model:variant` を最長一致する価格解決関数を追加。
- モデル一覧、タスク費用、コスパランキングの価格参照を共通解決へ統一。
- 実環境で確認したタグ付きモデルIDを回帰テストへ追加。

## 検証

- `npx vitest run`: 271 files / 3263 passed / 1 skipped
- 関連テスト: 84 tests passed
- `npm run typecheck`: 成功
- 関連ファイルのESLint: 成功
- 本番ビルドはプロジェクト指示により実行しない
# 作業ログ: スキル名の青文字表示とホバー概要

## 日付

2026-08-11

## 要望

UI 上のスキル名を青文字で表示し、ホバーでスキル概要を確認できるようにする。

## 変更

- `SlashSuggestMenu`: `source === "skill"` のコマンド名を `text-accent`（青）表示。候補全体の `title` に description を載せホバーで概要を表示。
- `ExtensionsSettings`: スキル行・ツリーの表示名を青文字。description / description_ja を `title` に使用。
- `ProjectSettingsView`: スキル一覧名を青文字。frontmatter の description_ja / description をホバー title に使用。

## 検証

- `npm.cmd test -- --run src/components/SlashSuggestMenu.test.tsx` ... 3 tests passed
- 本番ビルド・dev 起動は指示により未実行


## 追記: Composer 入力内ハイライト

- `slash-command.ts` に `findSkillTokens` / `segmentSkillHighlights` / `skillDescriptionAt` を追加。
- Composer で既知スキルの `/name` を mirror レイヤで青文字表示、`title` で概要。
- HomeView / TaskView から `commands={slashCommands}` を渡す。
- frontmatter パーサを client-safe な `skill-frontmatter.ts` へ分離。
- 検証: slash-command 18 / Composer 7 / ExtensionsSettings 24 tests passed。

