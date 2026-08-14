# ループ 状態機械の定義と監査是正

> 実装ステータス: ✅ 実装済み（参照: `web/src/lib/goal-loop.ts` / `goal-loop.test.ts`）

## 背景

ループ（`web/src/lib/goal-loop.ts`、約1280行）は本リポジトリで最も複雑な状態機械だが、
仕様書が存在しない。存在するのは `docs/goal-loop-ui-redesign.md`（UI改修計画）のみで、
状態遷移・不変条件・ターン予算の意味はコード内コメントに散在している。

その結果、送達周りの実装を3コミット連続で追加修正（`39c81f0` → `5e0f1a4` → `80fed1e`）しても
取りこぼしが残った。監査（再現テストによる実測）で以下6件を確認した。既存テスト53件は全て通るため、
テストは是正の根拠にならない。

| ID | 深刻度 | 症状 | 実測結果 |
| --- | --- | --- | --- |
| A | 高 | `verifying_completed` 中に pause → resume すると、以後ループは完了に到達できない | resume 後 `queued`、次tickで goal プロンプト送信、その `completed` 応答が「検証棄却」と誤認され `progress = ["completed","completed"]` のまま無言で `queued` へ戻る |
| B | 高 | 送達不明 pause の2回目の resume が重複送信防止を自ら破る | resume#1 が error 本文を「送達を確認でき**ず**」に書き換え、判定述語 `includes("送達を確認できない")` に一致しなくなる。resume#2 で `queued`・境界再アンカー・error クリアとなり、次tickで二重送信 |
| C | 中 | 境界メッセージが履歴から消えると、ループ開始前の古い返信を今ターンの結果として取り込む | `finalAssistantAfter` の `findIndex` が `-1` を返し `-1 + 1 = 0` で全履歴を走査。`status = verifying_completed`, `summary = "result from before the loop"` |
| D | 中 | `pauseGoalLoopForManualSend` が本番から一度も呼ばれていないデッドコード | 参照はテストのみ。手動送信保護は `TaskView.tsx` のクライアント PATCH だけで、他クライアント・API直叩き・OpenCode TUI 経由は無防備 |
| E | 中 | `MAX_REJECTED_CLAIMS` は作業ターンを1回挟むと回避できる | `[C,R,C,R]` → 2（停止）だが `[C,R,P,C,R]` → 1（棄却2回でも停止しない） |
| F | 低 | `error` 状態が宣言のみで到達不能、かつ矛盾 | `status = 'error'` を書く箇所は存在しない。にもかかわらず `TERMINAL_STATUSES` に含まれ、同時に resume の対象（`status IN ('paused','error')`）でもある |

A・B・C・E は「状態遷移表を書けば自明に見つかる」種類の欠陥である。本仕様書はまず状態機械を確定させ、
そのうえで各是正内容を定義する。

## 目的

1. ループの状態・遷移・不変条件・ターン予算を、実装に先立つ正規の定義として確定する。
2. 監査で確認した A〜F を、その定義に沿って是正する。
3. 状態を自然言語のエラー本文や `progress` 配列の末尾から**推論する**設計を全廃し、
   すべて DB の明示的な列で表す。

## 対象と非対象

- 対象: `web/src/lib/goal-loop.ts` の状態機械、`goal_loops` テーブルのスキーマ、
  `api/tasks/[id]/goal-loop` のエンドポイント、手動送信検出のサーバー側配線、
  および `GoalLoopPanel` / `TaskView` のうち状態表示に関わる部分。
- 非対象: ループのUIデザイン刷新（`docs/goal-loop-ui-redesign.md` の範囲）。
  Auto モデル選定との連携（`docs/specs/auto-model-selection-taskview.md` §3 で確定済み。本仕様は
  `agent` / `providerID` / `modelID` / `variant` を受け取って保持・送信するだけで、選定はしない）。
- 非対象: 1ワークスペースに複数の同時ループを持たせること。`getGoalLoop` が
  「ワークスペースあたり最新1件」を返す現行モデルを維持する。
- 非対象: プロンプト本文（`buildGoalPrompt` / `buildVerificationPrompt`）の文面改善。
  ただしターン予算の表記が §「ターン予算」の定義と矛盾する場合は修正対象に含める。

## 状態機械

### 状態

| 状態 | 意味 | in-flight プロンプト | 終端 |
| --- | --- | --- | --- |
| `queued` | 次の goal ターンを送信できる。ターンは走っていない | なし | – |
| `running` | プロンプト送信済み。応答待ち。種別は `turn_kind` が持つ | あり | – |
| `verifying_completed` | 完了宣言を受理し、検証ターンの送信待ち | なし | – |
| `paused` | 停止中。理由は `pause_reason` が持つ。resume 可能 | 不明（あり得る） | – |
| `completed` | 検証済みで完了 | なし | ✓ |
| `blocked` | ユーザー介入が必要 | なし | ✓ |
| `stopped` | ユーザーが停止、または新ループ作成で置換された | なし | ✓ |

`error` 状態は**削除する**（F）。到達不能であり、かつ「終端かつ resume 可能」という矛盾を含む。
これを書き込むコードは存在しないため、移行対象の既存行もない。
スケジューラの catch-all は現行どおり `paused` + `pause_reason = 'scheduler_error'` とする。

### 遷移表

`R` は `WHERE id = ? AND revision = ?` の CAS 成功を指す。CAS 失敗時はいずれも無操作で、
他の書き手（pause / stop / 手動送信）が勝ったことを意味する。

| # | 現在 | 契機 | 次 | 副作用 |
| --- | --- | --- | --- | --- |
| 1 | – | `createGoalLoop`（履歴読取成功） | `queued` | 同ワークスペースの非終端ループを `stopped` に。`last_message_id` = 履歴末尾 |
| 2 | – | `createGoalLoop`（履歴読取失敗） | `paused` | `pause_reason = 'transcript_unreadable'` |
| 3 | `queued` | tick・履歴 idle・`turn_count < max_turns` | `running` | `turn_count + 1`、`turn_kind = 'goal'`、`last_message_id` = 履歴末尾、`last_prompt_at = now`、goal プロンプト送信 |
| 4 | `queued` | tick・`turn_count >= max_turns` | `paused` | `pause_reason = 'turn_limit'` |
| 5 | `verifying_completed` | tick・履歴 idle | `running` | `turn_kind = 'verification'`、`turn_count` は**変えない**、`last_message_id` = 履歴末尾、`last_prompt_at = now`、検証プロンプト送信 |
| 6 | `running` (`turn_kind='goal'`) | 境界後に構造化結果 `progress` | `queued` | `progress` 追記 |
| 7 | `running` (`turn_kind='goal'`) | 構造化結果 `completed` | `verifying_completed` | `progress` 追記 |
| 8 | `running` (`turn_kind='goal'`) | 構造化結果 `blocked` | `blocked` | `blocked_reason` 設定 |
| 9 | `running` (`turn_kind='verification'`) | 構造化結果 `verified_completed` | `completed` | `rejected_claims = 0` |
| 10 | `running` (`turn_kind='verification'`) | 構造化結果 `blocked` | `blocked` | `blocked_reason` 設定 |
| 11 | `running` (`turn_kind='verification'`) | それ以外の構造化結果（棄却） | `queued` または `paused` | `rejected_claims + 1`。`rejected_claims >= MAX_REJECTED_CLAIMS` なら `paused` + `pause_reason = 'verification_rejected'` |
| 12 | `running` | 6〜11 の遷移先が非終端かつ `turn_count >= max_turns` | `paused` | `pause_reason = 'turn_limit'`。`progress` は追記する |
| 13 | `running` | ターン終了が確定したのに構造化結果なし（`STRUCTURED_GRACE_MS` 沈黙） | `paused` | `pause_reason = 'unreadable_result'` |
| 14 | `running` | `last_prompt_at` から `TURN_TIMEOUT_MS` 経過 | `paused` | `pause_reason = 'turn_timeout'` |
| 15 | `running` | プロンプト POST が 4xx（409/429 を除く）で拒否 | `queued` / `verifying_completed` | goal は `turn_count - 1` して `queued` へ、検証は `verifying_completed` へ戻す。`last_prompt_at = NULL` |
| 16 | `running` | プロンプト POST がタイムアウト・ネットワーク断・5xx・409・429 | `paused` | `pause_reason = 'unknown_delivery'`。**再送もロールバックもしない** |
| 17 | `running` | 結果読取時に `last_message_id` が履歴に存在しない | `paused` | `pause_reason = 'boundary_lost'` |
| 18a | `queued` | `PATCH action=pause` | `paused` | in-flight ターンがないため即時停止。`pause_reason = 'user'` |
| 18b | `running` / `verifying_completed` | `PATCH action=pause` | `paused` | `pause_reason = 'user'`。実行中のOpenCodeリクエストをabortし、後着結果は破棄する |
| 18c | `running` (`pause_requested = 1`) | 旧形式の遅延停止結果 | `paused` | 既存データ互換のため残す。新規の一時停止では使用しない |
| 19 | `queued` / `running` / `verifying_completed` | 手動送信を検出 | `paused` | `pause_reason = 'manual_send'`、`last_message_id` = 履歴末尾（読めた場合） |
| 20 | `paused` (`pause_reason='unknown_delivery'`) | `PATCH action=resume`・マーカー付きプロンプトへの構造化応答を発見 | 6〜12 に従う | 失われた進捗を復元して適用する |
| 21 | `paused` (`pause_reason='unknown_delivery'`) | `PATCH action=resume`・応答未発見 | `paused` | `pause_reason` は**維持**。`error` 本文のみ更新。**再送しない** |
| 22 | `paused` (上記以外) | `PATCH action=resume`・履歴読取成功 | `verifying_completed` または `queued` | `turn_kind = 'verification'` または 停止時 `verifying_completed` なら `verifying_completed`、それ以外は `queued`。`last_message_id` = 履歴末尾、`pause_reason = ''`、`error = ''` |
| 23 | `paused` | `PATCH action=resume`・履歴読取失敗 | `paused` | `pause_reason` 維持。`error` に理由。**queued にしない** |
| 24 | 非終端すべて | `PATCH action=stop` | `stopped` | CAS 成功時のみ `/session/:id/abort` を送る |

遷移 22 が A の是正点である。停止前が検証フェーズだったかを `turn_kind` と停止時の状態から復元し、
検証を必ず再実行する。`running` からの resume は同じターンを再開できないため `queued`（または
`verifying_completed`）に戻し、`last_message_id` を履歴末尾へ再アンカーする。

### 不変条件

- **I1**: 1つのループについて in-flight なプロンプトは同時に最大1件。遷移 3 と 5 の CAS がこれを保証する。
- **I2**: `prompt_async` は非冪等である。送達が確認できない場合、再送してはならず、
  ターン主張のロールバックもしてはならない（遷移 16）。
- **I3**: すべての状態遷移は `revision` の CAS を通す。`revision` は遷移ごとに +1 する。
- **I4**: ターン結果は `last_message_id` 境界より後ろのメッセージからのみ読む。
  境界が履歴に存在しない場合、結果を読んではならない（遷移 17）。境界不明は「idle の証明がない」と同義。
- **I5**: 停止理由は `pause_reason` 列で表す。`error` 本文は人間向け表示専用であり、
  分岐条件に使ってはならない。
- **I6**: 応答が検証ターンのものかは `turn_kind` 列で表す。`progress` 配列の末尾から推論してはならない
  （`progress` は `slice(-50)` で切り詰められるため、そもそも信頼できない）。
- **I7**: `turn_count` は goal ターンのみを数える。検証ターンは数えない。
- **I8**: 履歴（`/session/:id/message`）の読取失敗を「空・idle」とみなしてはならない。
  読めない間は送信も結果適用もしない。
- **I9**: ループ自身のプロンプトは `ocServer` で OpenCode エンジンへ直送し、
  `/api/opencode/*` プロキシを経由しない。したがってプロキシに置く手動送信フックが
  ループ自身のプロンプトを誤検出することはない。

## ターン予算

現行実装ではプロンプト送信回数が `maxTurns` の約2倍に達しうるのに、その定義がどこにも書かれていない。
以下を正規の定義とする。

- `maxTurns` は **goal ターンの上限**であり、プロンプト送信回数の上限ではない。範囲は 1〜100、既定 10。
- `turn_count` は goal ターンのみを数える（I7）。検証ターンは消費しない。
- 検証ターンの回数は `rejected_claims` で制限する。上限は `MAX_REJECTED_CLAIMS`（= 2）。
  したがって検証ターンは最大 `MAX_REJECTED_CLAIMS + 1` = 3 回。
- **`prompt_async` の総回数の上限 = `maxTurns` + `MAX_REJECTED_CLAIMS` + 1**。
  既定値では 10 + 3 = 13 回。
- `GoalLoopPanel` のバッジは goal ターンの進捗（`turn_count / max_turns`）を示す。
  検証ターン中は状態ラベル「完了検証中」で区別され、バッジの分子は増えない。この意味を
  `aria-label` にも反映する。
- プロンプト本文の「This is turn N of at most M」は goal ターン基準であり、上記定義と一致する。
  検証プロンプトの「Only N loop turn(s) of at most M have actually been executed」も同様に
  goal ターン基準で、`turn_count` をそのまま渡す（現行の値の渡し方は正しい）。

## スキーマ変更

`goal_loops` に4列を追加する。既存の `revision` 列と同じ `PRAGMA table_info` による冪等マイグレーションを使う。

| 列 | 型 | 既定 | 用途 |
| --- | --- | --- | --- |
| `turn_kind` | TEXT NOT NULL | `'goal'` | `'goal'` \| `'verification'`。I6 |
| `pause_reason` | TEXT NOT NULL | `''` | 下表の enum。I5 |
| `rejected_claims` | INTEGER NOT NULL | `0` | 完了宣言が検証で棄却された累計。E |
| `pause_requested` | INTEGER NOT NULL | `0` | 旧形式の遅延停止要求。新規のユーザー一時停止では設定しない |

`pause_reason` の値:

| 値 | 意味 | 利用者向け文言の責務 |
| --- | --- | --- |
| `''` | `paused` ではない | – |
| `user` | ユーザーが明示的に一時停止 | 文言なし |
| `manual_send` | 手動送信を検出して自動停止 | 「手動送信が行われたため一時停止しました。」 |
| `turn_limit` | `maxTurns` 到達 | 「最大ターン数に到達したため一時停止しました。」 |
| `unreadable_result` | 結果JSONが読めなかった | 「ループの結果JSONを読めなかったため一時停止しました。」 |
| `turn_timeout` | 応答が確認できないまま時間切れ | 「応答が確認できないまま時間切れになったため一時停止しました。」 |
| `unknown_delivery` | プロンプト送達が不明 | 「プロンプトの送達を確認できないため、重複送信を防止して一時停止しました」＋詳細 |
| `transcript_unreadable` | 履歴が読めない | 「会話履歴を読めないため…」 |
| `boundary_lost` | `last_message_id` が履歴から消えた | 「会話履歴の基準メッセージが見つからないため、結果の誤読を防いで一時停止しました。」 |
| `verification_rejected` | 完了宣言が繰り返し棄却された | 「完了宣言が検証で複数回拒否されたため一時停止しました。ゴールか acceptance を見直してください。」 |
| `scheduler_error` | 想定外の例外 | 例外メッセージ（4000 grapheme で切り詰め） |

`GoalLoopDto` には `turnKind` / `pauseReason` / `rejectedClaims` / `pauseRequested` を追加する。
`error` は人間向け表示専用のまま残す（I5）。

## 是正仕様

### A. 現在ターンを即時中断して一時停止する

1. ユーザーによる `pause` は queued / running / verifying_completed のいずれでも即時に
   `paused` へ遷移し、running / verifying_completed の OpenCode 呼び出しは abort する。
2. abort と結果処理が競合しても、pause が先に revision を更新するため、後着した結果は保存しない。
3. `pause_requested` は旧形式の遅延停止データを読むために残すが、新規のユーザー一時停止では設定しない。
4. UI は停止要求後すぐに「一時停止」状態と再開ボタンを表示する。

### B. 検証フェーズを pause/resume で失わない

1. 遷移 3 / 5 のプロンプト主張時に `turn_kind` を設定する。
2. `applyAssistantResult` の検証判定を
   `loop.status === "running" && lastProgress?.status === "completed"` から
   `loop.turnKind === "verification"` に置き換える（I6）。
3. resume（遷移 22）の復帰先を次で決める。
   - 停止時の状態が `verifying_completed` → `verifying_completed`
   - 停止時の状態が `running` かつ `turn_kind === 'verification'` → `verifying_completed`
   - それ以外 → `queued`
   停止時の状態は pause が `status` を上書きしてしまうため、`turn_kind` と
   「`verifying_completed` から pause された」ことを区別できる必要がある。pause（遷移 18・19）は
   `verifying_completed` から停止する場合に `turn_kind = 'verification'` を設定することで
   両者を1列に畳み込む。
4. `verified_completed` 到達時（遷移 9）に `rejected_claims = 0` にする。

### C. 停止理由を列で持ち、文字列一致判定を全廃

1. `isUnknownPromptDeliveryPause` を
   `loop.pauseReason === 'unknown_delivery'` に置き換える。`error.includes(...)` を削除する。
2. 遷移 21（応答未発見）で `error` 本文を更新しても `pause_reason` は変えない。
   これにより2回目以降の resume も遷移 20 / 21 の判定に入り、`queued` へ落ちない。
3. 他の `error` 本文による分岐が無いことを確認し、あれば同様に列へ移す。

### D. 境界を失ったら結果を読まない

1. `finalAssistantAfter` は、`lastMessageId` が非 null かつ履歴に存在しない場合に
   「境界喪失」を呼び出し元へ伝える。`Math.max(0, -1 + 1)` による全履歴走査を廃止する。
   戻り値を `{ kind: 'found', message } | { kind: 'none' } | { kind: 'boundaryLost' }` とするか、
   別ヘルパ `boundaryPresent(messages, lastMessageId)` を `processLoop` の `running` 分岐の
   先頭で呼ぶ。いずれでもよいが、`null` に「見つからない」と「境界が消えた」を混在させない。
2. `processLoop` は境界喪失時に遷移 17（`paused` + `boundary_lost`）を行い、結果を適用しない。
3. `deliveredGoalResultAfterUnknownPrompt` も同様に、境界が見つからない場合は
   インデックス 0 から走査せず `null` を返す。
4. `queued` 分岐は結果を読まないため対象外。現行どおり履歴末尾へ再アンカーする。

### E. 手動送信検出をサーバー側に配線

1. `web/src/lib/db.ts` に逆引きヘルパを追加する。
   `findWorkspaceIdsBySession(sessionId: string): string[]`
   （`session_bindings` の PK は `(workspace_id, opencode_session_id)` なので複数あり得る。
   `updated_at DESC` 順で返す）
2. `web/src/app/api/opencode/[...path]/route.ts` の `proxy` に、
   `POST /session/{id}/prompt_async` および `POST /session/{id}/command` の**転送前**フックを追加する。
   - 該当セッションに紐づく各ワークスペースについて `pauseGoalLoopForManualSend` を呼ぶ。
   - 対象ループが非終端で、かつ pause が成立しなかった場合は転送せず `409` を返す。
     本文は `{ error: "ループを一時停止できないため手動送信を中止しました。…" }`。
   - 既存の画像ガード（`isImageGuardedWrite`）と同じ位置・同じ検証順で実装する。
3. I9 によりループ自身のプロンプトはこのフックを通らない。この理由をコードコメントに残す。
4. `TaskView` のクライアント側 PATCH pause は**残す**。UI を即座に更新するための先行操作であり、
   サーバー側フックが唯一の正となる。二重に pause されても CAS により冪等。

### F. 棄却回数をカウンタ列で数える

1. `countRecentRejectedClaims`（`progress` 末尾の2つ飛ばしペアリング）を削除する。
2. 遷移 11 で `rejected_claims` を +1 し、更新後の値が `MAX_REJECTED_CLAIMS` 以上なら
   `paused` + `verification_rejected` とする。作業ターンが間に挟まっても回数は失われない。
3. 遷移 9（検証通過）で `rejected_claims = 0` にリセットする。
4. `verification_rejected` からの resume は `rejected_claims = 0` にリセットする。
   ユーザーが状況を認識したうえで継続を選んだ操作であり、リセットしないと次の棄却で即再停止する。
5. `updateGoalLoopMaxTurns` は `rejected_claims` を変更しない（予算の変更と棄却履歴は independent）。

### G. `error` 状態の削除

1. `GoalLoopStatus` から `error` を削除する。
2. resume の対象を `status = 'paused'` のみにする（`IN ('paused','error')` を改める）。
3. `TERMINAL_STATUSES` から `error` を削除する。
4. `GoalLoopPanel` の `STATUS_LABEL` から `error` を削除する。
5. `status = 'error'` を書く箇所は存在しないため、データ移行は不要。

### 軽微な是正

- `PROMPT_TIMEOUT_MS` のコメントは「BFF の上限 290s まで許容する」と述べているのに値は `120_000`。
  値と根拠を一致させる。**値 120s を維持し、コメントを実態に合わせる**。290s は
  `api/opencode/[...path]/route.ts` の `LONG_RUNNING_UPSTREAM_TIMEOUT_MS`（プロキシ経由の
  長時間ミューテーション用の上限）であり、`ocServer` で直送する ループのプロンプト送信には
  適用されない。
- 遷移 24 の `/session/:id/abort` に `PROMPT_TIMEOUT_MS`（120s）を使っている。
  abort 用に `ABORT_TIMEOUT_MS = 10_000` を新設する。停止操作の PATCH が2分ブロックするのを防ぐ。
- `normalizeAcceptance` は1件が `MAX_ACCEPTANCE_CHARS` 超なら 400、11件目以降は無言で切り捨てと
  非対称。**`MAX_ACCEPTANCE_ITEMS` 超も 400 にそろえる**（利用者に伝わらない切り捨てをしない）。
- pause は in-flight ターンを abort しない。エージェントは走り続け、resume の再アンカーで
  その成果はループの会計から外れる。これは**意図した挙動として明文化**する（作業を殺さない）。
  `GoalLoopPanel` の一時停止ボタンにその旨を補助テキストで示す。

## 影響ファイル

- `web/src/lib/goal-loop.ts`（状態機械本体）
- `web/src/lib/db.ts`（スキーマ追加、`findWorkspaceIdsBySession`）
- `web/src/app/api/opencode/[...path]/route.ts`（手動送信フック）
- `web/src/components/task/GoalLoopPanel.tsx`（`error` ラベル削除、ターン表記、pause 補助テキスト）
- `web/src/components/task/TaskView.tsx`（DTO 追加フィールドの受け渡し、409 応答の扱い）

## テスト

監査で作成した4本の再現テストを回帰テストとして正式に組み込む。いずれも現行実装で fail し、
是正後に pass する。

1. running / verifying_completed 中に pause すると、現在ターンの構造化結果と進捗を保存してから
   `paused` になり、次のプロンプトが送られないこと。queued の pause は即時に `paused` になること。
2. `verifying_completed` 中に pause → resume → 次tickで**検証**プロンプトが送られ、
   `turn_count` が増えないこと（A）
3. `unknown_delivery` pause に対し resume を2回行っても `paused` を維持し、
   `prompt_async` が発行されないこと（B）
4. `finalAssistantAfter` が境界喪失時に全履歴を走査しないこと（単体）と、
   境界喪失時にループが `paused` + `boundary_lost` になり古い結果を取り込まないこと（統合）（C）
5. `rejected_claims` が作業ターンを挟んでも累積し、`MAX_REJECTED_CLAIMS` で停止すること（E）
6. （新規）`POST /api/opencode/session/:id/prompt_async` がライブなループを pause させ、
   pause 不能時に 409 を返すこと（D）
7. （新規）`pause_reason` の各値に対する resume の復帰先が遷移表 20〜23 と一致すること
8. （新規）プロンプト送信総数が `maxTurns + MAX_REJECTED_CLAIMS + 1` を超えないこと（ターン予算）
9. （新規）スキーママイグレーションが既存 DB（4列なし）に対して冪等に適用されること

1〜4 は監査で作成済みの再現テスト（現行実装で fail）、5〜8 は新規に書き起こすもの。

## 受入条件

1. running / verifying_completed 中の一時停止要求では現在ターンの結果を保存してから停止し、
   次のプロンプトを送信しない。queued 中の一時停止は即時に停止する。
2. `verifying_completed` 中に一時停止して再開すると検証ターンから再開し、
   完了宣言が `completed` に到達できる。
3. 送達不明で停止したループは、resume を何回行っても構造化応答を発見するまで `paused` を維持し、
   `prompt_async` を再送しない。
4. `last_message_id` が履歴から消えた場合、ループは古い返信を結果として取り込まず
   `paused` + `boundary_lost` になる。
5. `TaskView` 以外の経路（API 直叩き・他クライアント・OpenCode TUI）からの手動送信でも
   ループが自動的に一時停止し、停止できない場合は送信が 409 で拒否される。
6. 完了宣言の棄却が作業ターンを挟んで 2 回起きた時点でループが停止する。
7. `error` 状態がコード・型・UI から消えている。
8. `pause_reason` / `turn_kind` / `rejected_claims` / `pause_requested` が DTO と API 応答に含まれ、
   状態判定にエラー本文・`progress` 末尾を使う分岐が残っていない。
9. `GoalLoopPanel` のターン表示が goal ターン基準であることが表示と支援技術に伝わる。
10. 上記テスト1〜9が通り、既存の goal-loop テスト53件が回帰していない。
11. `npx tsc --noEmit` と `eslint` が通る。
