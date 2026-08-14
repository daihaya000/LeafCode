# ハング検知・自動再開のサーバー側監視化 仕様

> 実装ステータス: ✅ 実装済み（参照: `web/src/lib/hang-watchdog.ts` / `useSessionStream.ts`）

## 背景

「5分間応答がないセッションを自動的に停止し、同じ処理を1回だけ再開する」機能が
実装されているが、実運用でほぼ機能していない。原因は現在の実装が
**表示中タスクのブラウザ側タイマーだけ**で成立している点にある。

現状（`web/src/lib/useSessionStream.ts` L805-L851）:

- 監視タイマーは `useSessionStream` の `useEffect` として動く。このフックは
  **開いているタスク1件分しかマウントされない**ため、
  - 別タスクへ移動した / サイドバーからホームへ戻った / タブを閉じた
    → `useEffect` の cleanup で `window.clearTimeout` が走り、監視が消える。
  - 再送用リクエスト本文は `autoRetryRequestRef`（メモリ上の ref）に持つため、
    scope 変更時の reset（L780-L790）で `null` になり、再開できなくなる。
- さらに **新規タスクの初回送信は `useSessionStream` を通らない**。
  `POST /api/tasks`（`web/src/app/api/tasks/route.ts` L517）が
  サーバー側で `/session/{id}/prompt_async` を直接叩いて起動する。
  そのためタスク画面を開き続けていても `autoRetryRequestRef` は `null` のままで、
  5分後の分岐は「`request` が無いので停止のみ」（L830-L834）に落ちる。
  = **初回ターンは最初から「自動再開」できない。**

つまり現状で自動再開が成立するのは「同一タスク画面を開いたまま、
composer から2回目以降の送信をして、その送信がハングしたとき」だけである。

加えて、判定基準が「ターン開始からの経過時間」であるため、
仮に監視が常時動いていると **正常な長時間ターン（5分超）も無条件で停止**されてしまう。
現状はクライアント限定監視だったことでこの副作用が表面化していなかったが、
監視を常時化するなら判定基準も同時に直す必要がある。

## 目的

1. タスク画面を開いていなくても、WebUI が動いている限りハング検知・自動再開が働く。
2. 新規タスクの初回ターン（`POST /api/tasks` 発の `prompt_async`）も監視対象にする。
3. WebUI 再起動をまたいでも再送用リクエストが失われない。
4. 正常に進行している長時間ターンを誤って停止しない（経過時間ではなく**無活動**で判定）。
5. 自動再開が起きたことがユーザーに見える。

## 対象と非対象

- 対象:
  - 新規モジュール `web/src/lib/hang-watchdog.ts`（サーバー側 watchdog 本体）。
  - `web/src/lib/db.ts` に監視テーブル追加。
  - `web/src/instrumentation.ts` から watchdog 起動。
  - 登録経路2つ:
    - BFF プロキシ `web/src/app/api/opencode/[...path]/route.ts`
      （クライアントの `prompt_async` / `prompt` / `command` POST）。
    - `web/src/app/api/tasks/route.ts`（新規タスクの初回 `prompt_async`）。
  - `web/src/lib/useSessionStream.ts` からクライアント側の abort＋自動再開 effect を削除。
  - `web/src/components/task/TaskView.tsx` に自動再開の通知表示を追加。
- 非対象:
  - OpenCode engine 側の修正。
  - 新規の常駐 SSE 購読（`/global/event` の購読は導入しない。ポーリングで閉じる）。
  - goal-loop / workflow-scheduler がサーバー側から直接送るプロンプト
    （`goal-loop.ts` の `TURN_TIMEOUT_MS`、`workflow-scheduler.ts` の
    `recoverInterruptedAttempts` という独自の監督機構を既に持つため、
    二重に停止させない。watchdog は登録された watch のみを対象とする）。
  - `PartView.tsx` の shell ツール経過警告バナー（表示のみ。現状維持）。
  - ハング閾値設定 UI（`SettingsView.tsx` の既存 UI をそのまま使う）。

## 設計

### 1. 監視テーブル

`web/src/lib/db.ts` の `getDb()` 内 `db.exec` に追加する。

```sql
CREATE TABLE IF NOT EXISTS session_hang_watches (
  session_id       TEXT PRIMARY KEY,
  directory        TEXT NOT NULL,
  request_path     TEXT NOT NULL,
  request_body     TEXT NOT NULL,
  request_timeout_ms INTEGER NOT NULL,
  resume_allowed   INTEGER NOT NULL DEFAULT 1,
  started_at       INTEGER NOT NULL,
  last_progress_at INTEGER NOT NULL,
  retry_used       INTEGER NOT NULL DEFAULT 0,
  state            TEXT NOT NULL DEFAULT 'armed',
  updated_at       INTEGER NOT NULL
);
```

- `session_id` を PK にすることで「1セッション＝最新ターン1件」を保証する。
  新しい送信は `INSERT ... ON CONFLICT(session_id) DO UPDATE` で置き換え、
  `retry_used` を 0 に戻す（＝ユーザーの新規送信ごとに再開枠が1回復活する）。
- `state` は `'armed'`（監視中）/ `'resolving'`（停止・再開処理中）。
  完了した watch は行を削除する。
- `resume_allowed = 0` は「停止はするが再送はしない」watch。
  巨大な添付を含む本文を DB に保存しないための逃げ道（§4）。
- `directory` は allowlist 解決済みの絶対パスのみを入れる。

### 2. 登録経路

#### 2-1. BFF プロキシ（クライアント送信）

`app/api/opencode/[...path]/route.ts` には既に
`manualSendSessionId(method, pathname)` があり、
`POST /session/{id}/(prompt_async|prompt|command)` から sessionID を取り出している
（goal-loop の manual-send 一時停止フックで使用中）。同じ判定を再利用する。

- **upstream へ転送する前に登録する。**
  `session.command` / `session.prompt` は同期エンドポイントで最大290秒ブロックするため、
  レスポンス後に登録すると監視開始が遅れて意味を失う。
- upstream が非 2xx を返した / fetch が失敗した場合は登録した watch を削除する。
- 本文に hang-retry マーカー（`HANG_RETRY_METADATA_KEY`）が含まれる場合は
  `retry_used` を 0 に戻さない（watchdog 自身の再送はプロキシを通らないが、
  将来クライアント経由で再送された場合の保険）。

#### 2-2. `POST /api/tasks`（初回プロンプト）

`prompt_async` の `ocServer` 呼び出し直前に、
同じ `promptBody` / `session.id` / `workspace` の絶対パスで watch を登録する。
`prompt_async` が失敗してロールバックする経路では watch も削除する。

### 3. 判定ロジック（無活動ベース）

`startHangWatchdog()` を `instrumentation.ts` の `register()` から呼ぶ
（`startGoalLoopScheduler` / `startWorkflowScheduler` と同じ場所・同じ形）。

- `HANG_WATCHDOG_INTERVAL_MS = 15_000` の `setInterval`。
  `watchdogTicking` フラグで多重実行を防ぐ。`stopHangWatchdogForTests()` を用意する。
- 起動時 `recoverInterruptedWatches()`: `state = 'resolving'` の行を `'armed'` に戻す
  （再起動で処理が中断したケース）。

閾値は毎tickでサーバー側設定から読む:

```
clampHangTimeoutMs(Number(getSetting("hang-timeout"))) ?? DEFAULT_HANG_TIMEOUT_MS(5分)
```

1tick の処理:

1. `state = 'armed'` の watch を全件読む。0件なら即終了。
2. `directory` でグループ化し、ディレクトリごとに1回だけ
   `ocServer<Record<string, SessionStatus>>(dir, "/session/status", { timeoutMs: 5_000 })`。
   失敗したディレクトリはこのtickをスキップする（fail-open。engine 再起動中に
   誤って停止扱いしない）。
3. 各 watch について:
   - status map に無い / `type` が `busy` でも `retry` でもない
     → ターン終了。**行を削除**する。
   - `now - last_progress_at < timeout` → 何もしない。
   - `now - last_progress_at >= timeout` → **確認フェーズ**（4.）へ。

#### 確認フェーズ（誤停止の防止）

`/session/status` は最終活動時刻を返さないため、閾値を超えた watch に対してのみ
`ocServer(dir, "/session/{id}/message", { timeoutMs: 20_000 })` を1回だけ実行し、
実際の最終活動時刻を求める。

- 最終活動時刻 = 全 message / part から取れる時刻の最大値
  （`message.info.time.created` / `completed`、`part.time.start` / `end`、
  ツール part の `state.time.start` / `end`）。
- `latestActivityAt > last_progress_at` → 進行していた。
  `last_progress_at = latestActivityAt` に更新して再 arm（**停止しない**）。
- `now - latestActivityAt >= timeout` → 真のハングと判定して停止処理へ。

この二段構えにより、高コストな全履歴取得は
「busy な watch 1件につき最大 timeout に1回」に抑えられ、
かつ長時間だが進行しているターンを停止しない。

#### 停止と再開

1. `state = 'resolving'` に更新。
2. `POST /session/{id}/abort`（`timeoutMs: 10_000`）。失敗しても続行する。
3. `/session/status` を最大6回 × 1秒間隔でポーリングし、idle 化を待つ。
   idle にならなければこのtickは諦め、`state` を `'armed'` に戻す
   （`last_progress_at` は据え置き＝次tickで再試行）。
4. `retry_used = 1` または `resume_allowed = 0` → **再送せず行を削除**。
   （「1回だけ再開」の担保。2回目のハングは停止のみ）
5. それ以外 → `ocServer(dir, request_path, { method: "POST",
   body: markHangRetryBody(JSON.parse(request_body)),
   timeoutMs: request_timeout_ms })` で再送。
   成功したら `retry_used = 1`、`started_at = last_progress_at = now`、
   `state = 'armed'` で継続監視。失敗したら行を削除する。
6. 各アクションは `console.log("[hang-watchdog] ...", { sessionId, directory })` 形式で
   host.log に残す（秘密情報・プロンプト本文は出さない）。

`markHangRetryBody` / `HANG_RETRY_METADATA_KEY` は現在 `useSessionStream.ts`
（クライアント側モジュール）に定義されている。サーバー側から import すると
クライアント専用コードを引き込むため、**`web/src/lib/hang-retry.ts` へ切り出し**、
`useSessionStream.ts` は re-export で後方互換を保つ（既存テストの import を壊さない）。

### 4. 添付付き本文の扱い

`request_body` に画像 data URL が入ると、R28 上限（10枚 × 10MB）で最大約100MBの
行になり得る。SQLite に載せるのは不適切なため:

- 登録前に file part の data URL 長を合計し、
  `MAX_WATCH_BODY_BYTES = 2_000_000` を超える場合は
  `request_body = '{}'` / `resume_allowed = 0` で登録する。
- この watch は「ハング時に停止するが再送しない」挙動になる。

### 5. クライアント側の変更

- `useSessionStream.ts`: L805-L851 の abort＋自動再開 `useEffect` を削除する。
  併せて `autoRetryRequestRef` / `autoRetryUsedRef` / `hangTimeoutMs` state /
  `subscribeHangTimeout` 購読を削除する（`mutationStartedAtRef` は経過時間表示で
  使い続けるので残す）。`markHangRetryBody` / `HANG_RETRY_METADATA_KEY` /
  `SESSION_HANG_TIMEOUT_MS` は re-export として維持する。
- `filterCompactionContinueMessages` は現状どおり hang-retry マーカー付き
  user message を非表示にする（同じプロンプトが2回並ぶのを防ぐ）。
- `TaskView.tsx`: 生の `stream.messages` から hang-retry マーカー付き user message を
  数え、1件以上なら transcript 上部に控えめな通知を出す。
  文言: `応答が{N}分間止まったため自動的に停止し、同じ処理を再開しました`
  （`N` はサーバー側設定ではなくクライアントの `readHangTimeoutMs()` 表示値を使う）。
  複数回なら `（{count}回）` を付ける。
- `SettingsView.tsx`: マウント時にサーバー側 `hang-timeout` が未設定なら
  localStorage の値を `syncHangTimeoutToServer` で1回同期する
  （watchdog はサーバー側設定を見るため、UI 表示値とのズレを防ぐ）。

### 6. 不変条件

- I1: 1セッションにつき watch 行は最大1件。
- I2: 1つの watch から発生する自動再送は最大1回（`retry_used`）。
- I3: watchdog は watch 行が存在するセッションにしか `abort` を送らない
  （goal-loop / workflow / 外部 TUI のセッションには触らない）。
- I4: `/session/status` 取得失敗は fail-open（何もしない）。
- I5: `directory` は allowlist 解決済みパスのみ。
- I6: 判定は `last_progress_at`（無活動）基準。ターン総経過時間では停止しない。

## テスト

- 新規 `web/src/lib/hang-watchdog.test.ts`:
  1. busy かつ無活動が閾値超 → abort が呼ばれ、hang-retry マーカー付きで再送される。
  2. 再送後に再びハング → abort のみで再送されず、watch が削除される。
  3. 確認フェーズで最新活動が閾値内 → abort されず `last_progress_at` が更新される。
  4. `/session/status` に居ない（idle）→ watch が削除される。
  5. `/session/status` 取得失敗 → 何もしない（fail-open）。
  6. `resume_allowed = 0` → abort のみ。
  7. `recoverInterruptedWatches` が `'resolving'` を `'armed'` に戻す。
  8. 閾値は `getSetting("hang-timeout")` を反映し、範囲外は clamp される。
- 新規 `web/src/lib/hang-retry.test.ts`（切り出したモジュールの単体。既存の
  `useSessionStream.test.ts` 側の `markHangRetryBody` テストは re-export 経由で維持）。
- 既存 `web/src/app/api/opencode/[...path]/route.test.ts` に追加:
  `POST /session/{id}/prompt_async` 転送時に watch が登録され、
  upstream 4xx 時に削除されること。
- `web/src/app/api/tasks/route.test.ts`: 初回 `prompt_async` で watch が登録されること。
- `web/src/components/task/TaskView.test.tsx`: hang-retry マーカー付き message があると
  通知が表示され、無ければ表示されないこと。
- 既存 `useSessionStream.test.ts` / `useSessionStream.stuck-busy.test.ts` が緑のままであること
  （クライアント側 auto-retry effect を直接検証しているテストは無いため、
  影響は import の維持のみ）。

## 検証方法

- `cd web && npm run typecheck`（`tsc --noEmit`）
- `cd web && npm run lint`（`eslint`）
- `cd web && npx vitest run src/lib/hang-watchdog.test.ts src/lib/hang-retry.test.ts
  src/lib/useSessionStream.test.ts src/lib/useSessionStream.stuck-busy.test.ts
  src/app/api/tasks/route.test.ts "src/app/api/opencode/[...path]/route.test.ts"
  src/components/task/TaskView.test.tsx`
- 最後に `cd web && npm test`（`vitest run` 全体）
- 本番ビルド（`build.bat` / `next build`）は AGENTS.md に従いエージェントからは実行しない。
- 常駐プロセス（`next dev` / `next start`）はエージェントから起動しない。

## 受入基準

1. タスクA を送信した直後にタスクB へ移動しても、タスクA がハングすれば
   閾値経過後に自動停止・自動再開される。
2. 新規タスク作成（ホームから初回送信）でハングした場合も自動停止・自動再開される。
3. 送信後に WebUI を再起動しても、再起動後の watchdog が同じ watch を引き継ぐ。
4. 正常に進行している5分超のターンが停止されない。
5. 同一ターンで自動再開は1回のみ。2回目のハングは停止だけで終わる。
6. 自動再開が起きたことがタスク画面の通知でわかる。
7. `npm run typecheck` / `npm run lint` / `npm test` が全て通る。
