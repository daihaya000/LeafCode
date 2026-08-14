# コマンド実行の経過時間表示とタイムアウト仕様

> 実装ステータス: ✅ 実装済み（参照: `web/src/app/api/opencode/[...path]/route.ts` / `useSessionStream.ts`）

## 背景

`bash` ツール等でコマンドを実行した際、OpenCode engine が `start /MIN ...` のような
detach するコマンドを受け取ると応答を返さず、WebUI 側の表示が 5 分以上「実行中」のまま
ハングする事例がある（添付画像）。
現状の仕組みは以下の通り。

- `session.command` は WebUI BFF (`web/src/app/api/opencode/[...path]/route.ts`) が長時間
  タイムアウト（290s）でプロキシしている。
- クライアントは `useSessionStream.ts` の `sendCommand` が 295s のタイムアウトで待つ。
- タスクヘッダー・composer 横では `working` 状態と `currentTool` は表示するが、
  経過時間は表示しない。
- 経過が長くなってもユーザーには「何秒経過」「あと何秒で打ち切られるか」が見えない。

## 目的

1. コマンド実行中に経過時間をリアルタイムに表示し、ユーザーが待ち時間を把握できるようにする。
2. 長時間応答がない場合、**セッション全体をハングさせない**打ち切り機構を提供する。
3. 打ち切り時は既存の abort/復帰フローと整合し、composer を再入力可能にする。

## 対象と非対象

- 対象:
  - `useSessionStream.ts` の `sendCommand` 経過時間追跡と打ち切りタイマー。
  - `TaskView.tsx` のヘッダー・composer 横の working 表示に経過時間を追加。
  - `PartView.tsx` の bash/shell ツールカードに経過時間を追加（既存 `state.time` を活用）。
  - BFF プロキシ `app/api/opencode/[...path]/route.ts` の同期 command/prompt タイムアウト値を
    短縮し、早期に日本語 408 を返す変更（必要に応じて）。
- 非対象:
  - 新規エンドポイントの追加。
  - engine 側の修正（WebUI BFF + クライアントだけで閉じる）。
  - goal-loop 専用のタイムアウト（既に `goal-loop.ts` に `TURN_TIMEOUT_MS` がある）。

## 設計

### 1. タイムアウト値

| レイヤー | 現在 | 変更後 | 根拠 |
|---|---|---|---|
| BFF `session.command` | 290s | 120s | engine 応答が 2 分を超えることは日常的にない。長すぎるとブラウザ・Vercel ともに不安定。 |
| クライアント `sendCommand` | 295s | 125s | BFF の 120s を超えるが、BFF 側で打ち切り後は 408 が返る。 |
| UI ハング警告表示 | – | 30s 経過で警告色、60s 経過で強調 | ユーザーが異常を素早く察知できるように。 |

※ 既存の `SESSION_MUTATION_TIMEOUT_MS`（60s）は `sendPrompt` 等に使うため変更しない。

### 2. 経過時間表示

- `useSessionStream` に `commandStartAt`（または汎用 `mutationStartedAt`）を state 化し、
  `sendCommand`/`sendPrompt` 送信時にセット、idle/error 遷移時にクリアする。
- `TaskView` の `working` 表示に `formatElapsed(seconds)` を追加する。
  - 例: `作業中… (12s)`、`リトライ中… (1m 02s)`
- `PartView` の bash/shell ツールカードで `state.time?.start` からの経過を表示。
  - `pending`/`running` 中は `(<経過>)` を summary 横に小さく表示。
  - `completed`/`error` 時は最終所要時間を表示（`state.time.end - state.time.start`）。

### 3. ハング検出と打ち切り

- `useSessionStream` は `sendCommand` 時に別途「UI ハング警告タイマー」を 30s でセットし、
  以降 30s ごとに `dispatch({ kind: "commandElapsed", elapsedMs })` 等を発行。
- 120s 時点でまだ `working` なら、自動で `abort()` を発行し、
  `sessionError` に `コマンドがタイムアウトしました（2分経過）` を設定。
- abort 後は既存の `preferRestStatus` + `resync()` により状態が復帰し、composer が再入力可能になる。

### 4. 既存テストとの整合

- `web/src/lib/useSessionStream.test.ts` の `SESSION_COMMAND_TIMEOUT_MS` 検証テストを更新。
- 新規テスト:
  - 30s 経過で警告イベントが発行されること。
  - 120s 経過で自動 abort が発行され `sessionError` にタイムアウトメッセージが入ること。
  - `sendCommand` の `timeoutMs` が 125s であること。
- `TaskView.test.tsx` / `PartView.test.tsx` で経過時間表示を検証。

## 依存

- `useSessionStream.ts` の `status` / `sessionError` / `abort` を流用する。
- `PartView.tsx` の `state.time`（`start`/`end`）を流用する。

## 验收基準

1. `start /MIN %TEMP%\run_tv_test.bat" echo launched` のような detach コマンドを送信しても、
   120s 後に自動的に「コマンドがタイムアウトしました」と表示され、composer が再入力可能になる。
2. コマンド実行中、ヘッダーに `(12s)` などの経過時間が 1 秒ごとに更新される。
3. bash/shell ツールカードの実行中にも経過時間が表示される。
4. 全テストが通る（`npm run test:unit` in `web/`）。
