# BUG.md — Goal Loop バグ発見記録

> 発見のみ（修正は行わない）。再現は `web/src/lib/goal-loop.integration.test.ts` と同一の
> mock 構成で一時プローブテストを作成し、3 件とも実測 fail（= バグ再現）を確認済み。
> プローブは検証後に削除済み。既存テスト（goal-loop / goal-loop.integration / goal-state）は
> 全て PASS するため、本バグ群はテストに未カバーの経路に存在する。

## BR-1 [高] queued / verifying_completed のループが transcript 末尾が未完のまま永久停止する

**場所**
- `web/src/lib/goal-scheduler.ts:237`（queued 分岐の `if (!transcriptIdleFor(messages, TURN_QUIET_MS)) return;`）
- `web/src/lib/goal-scheduler.ts:151`（verifying_completed 分岐の同チェック）
- `web/src/lib/goal-util.ts` `transcriptIdleFor`（末尾が user メッセージ or `time.completed` なしの assistant なら常に false）

**症状**
turn の応答が永遠に着弾しない状態（abort・エンジンクラッシュ・プロンプト破棄）で
pause → resume すると、resume は `last_message_id` を transcript 末尾（= 応答のない
ループ自身のプロンプト、または途中で切れた assistant メッセージ）へ再アンカーし、
status を `queued`（または `verifying_completed`）に戻す。以降の tick は毎回
`transcriptIdleFor` が false のまま抜け出せず、**新しいプロンプトが一度も送られない**。
`expireStalledTurn`（`TURN_TIMEOUT_MS` 30 分）は `running` のみが対象で、
queued / verifying_completed には存在しないため、この状態にタイムアウトの脱出経路がない。

**発火経路（いずれも現実的）**
1. `running` 中に pause（abort 送信）→ resume。プロンプトは transcript に残り応答なし
2. `turn_timeout`（30 分待ち）で paused → resume。同じく応答なしのプロンプトが末尾
3. セッション末尾が「未応答の user メッセージ」（タスク初回プロンプトが失敗・中断）の
   セッション上に新規ループ作成 → 作成直後から永続停止
4. 検証ターンが中断された状態で resume → `verifying_completed` で永続停止

ユーザーは手動でメッセージを送ってターンを完了させるか、停止する以外に復帰手段がない。
パネルは「実行中」のまま動かず、resume を繰り返しても無意味。

**プローブ結果**（削除済み）
```
abort でプロンプトだけ残った turn を pause → resume しても次ターンが送信されない
→ expected 1 to be 2 // promptAsyncCount が増えない
```

**観察メモ**
- `transcriptIdleFor` 自体の単体セマンティクス（user 末尾 = false）は `goal-loop.test.ts:416` で
  意図どおりテスト済み。問題は呼び出し側に「エンジンが idle なら進めてよい」という
  代替判定やタイムアウトがなく、`queued`/`verifying_completed` が永久に待つ点。
- 直近のエンジン status（`statuses[sessionId]` が idle / 不在）が取得済みであるのに、
  transcript 判定だけがそれを無視して止めている（`goal-scheduler.ts:107` の直後）。

## BR-2 [中] 応答着弾〜適用前の pause → resume でターン結果が破棄される

**場所**
- `web/src/lib/goal-db.ts:274-286`（resume の復帰先決定と `last_message_id` 再アンカー）
- `web/src/lib/goal-db.ts:225-232`（結果復元は `unknown_delivery` pause 専用）
- `web/src/lib/goal-state.ts:291`（`applyAssistantResult` の CAS は「次の tick までに
  pause が revision を進めると結果を破棄する」）

**症状**
ターン応答が transcript に着弾してから、スケジューラが `applyAssistantResult` で適用するまでに
（最大 SCHEDULER_INTERVAL_MS = 2.5s のウィンドウ）pause（ユーザー操作 or 手動送信の
サーバー側フック `opencode-proxy/proxy.ts:341`）が入ると、resume は境界を transcript 末尾
（= 着弾済みの応答）へ無条件で再アンカーするため、**その応答は二度と適用されない**。
結果、次 tick で新しい goal ターンが送られ、失われた応答の progress 記録・完了宣言は
ループの会計から消える（チャット上には表示されているのに）。

さらに悪いケース: 失われた応答が `completed` 主張で、そのターンが最後の予算内
（`turn_count >= max_turns`）だった場合、次の tick が `turn_limit` で pause するため、
完了宣言は検証にも回らずユーザーは見かけ上の「上限到達」で停止する。

**プローブ結果**（削除済み）
```
goal ターン: 応答は transcript にあるのに resume 後は適用されず結果が消える
→ expected false to be true // progress に "first result" が記録されない
```

**観察メモ**
- `unknown_delivery` pause だけは `deliveredGoalResultAfterUnknownPrompt` で結果復元する
  （遷移 20）。`user` / `manual_send` pause にも同じ復元を適用すれば本バグは消える。
- 実行中ターンの末尾が user メッセージ（応答の後ろに新着 user メッセージ）の場合、
  `finalAssistantAfter` が null を返し、存在する応答を無視して 30 分後に
  `turn_timeout` になるケースも同系統（`goal-scheduler.ts:133-145`）。

## BR-3 [中] 検証応答の適用前に pause → resume すると検証プロンプトが二重送信され、検証結果が失われる

**場所**
- `web/src/lib/goal-db.ts:274-275`（resume が `turnKind === "verification"` を
  `verifying_completed` に復帰させる）
- `web/src/lib/goal-scheduler.ts:150-170`（`verifying_completed` 分岐が
  「検証プロンプトの送信」を再実行する）

**症状**
検証ターン中（`running` + `turn_kind='verification'`）に応答が着弾してから適用前に
pause → resume すると、resume は `verifying_completed` へ戻し、次 tick が**2 回目の
検証プロンプト**を送る（1 回目の検証応答は未適用のまま境界外へ消える）。
検証ターンは `turn_count` を消費しないため検出が難しく、検証プロンプト送信総数の
上限（`maxTurns + MAX_REJECTED_CLAIMS + 1`）を超過しうる。

**プローブ結果**（削除済み）
```
検証ターン: 応答着弾後に pause → resume すると検証プロンプトがもう一度送られる
→ expected 'running' to be 'completed' // verified_completed 応答が破棄され二重送信
```

## BR-4 [低] PAUSE_REASON_HINT の文言が resume の実際の挙動と不一致

**場所**
- `web/src/components/task/GoalLoopPanel.tsx:34-37`
  - `unreadable_result`: 「再開すると同じターンを送り直します。」
  - `turn_timeout`: 「再開すると同じターンを送り直します。」

**症状**
resume は「同じターンを送り直す」のではなく、境界を再アンカーして**新しいターン**
（`turn_count + 1`）を送る（または BR-1 のとおり送れない）。文言が事実と異なり、
`turn_timeout` からの resume は実際には同じターンを再実行できない（重複送信防止の
設計上、送達不明プロンプトの再送は一切しない）。

---

## 補足

- 本バグ群はすべて「pause/resume がターン境界の会計と競合する」経路に集中している。
  `docs/specs/goal-loop.md` の遷移 20〜23 は `unknown_delivery` の結果復元と
  検証フェーズの復帰のみを定義しており、`user`/`manual_send` pause での
  「未適用応答の復元」と「queued の idle 判定の脱出条件」が未定義のまま残っている。
- 修正時は `docs/specs/goal-loop.md` の遷移表・不変条件への追記と、以下のテスト追加が望ましい:
  1. abort 後の resume で次ターンが送信されること（BR-1）
  2. 応答着弾後の pause → resume で結果が適用されること（BR-2）
  3. 検証応答着弾後の pause → resume で検証プロンプトが再送されないこと（BR-3）
