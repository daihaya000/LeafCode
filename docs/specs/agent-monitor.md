# エージェント監視(並行実行の可視化と制御)

Hermes Agent の「並行サブエージェント群を一覧・操作する」機能を、
既存の goal loop / workflow ノード / セッションの監視面に統合する。

## 背景

本リポジトリには既に複数の自律実行系がある:

- goal loop(`web/src/lib/goal-loop.ts`): ワークスペース単位の自律ループ
- workflow ノード(`workflow-graph-runtime.ts` 等): DAG上のセッション/制御ノード
- セッション中のサブエージェント呼び出し(`subagent-permission.ts` 等)

しかし「いま何が動いているか」を横断して見る場所がない。
goal loop と workflow は別々のUIで、サブエージェントは親セッションの中に隠れる。
ストール検知も個別実装(`hang-watchdog.ts` / `hang-timeout.ts`)で統一されていない。

## 目的

1. 全自律実行を1つの `agent_runs` ビュー/テーブルに集約する。
2. kanban UI(`/agents`)で状態横断の一覧・絞り込み・個別操作を可能にする。
3. ストール判定を `agent_runs.last_heartbeat_at` に一本化し、
   既存の hang 系検知をその供給源として再利用する。
4. カードからの `stop` / `escalate` / `retry` を既存経路に委譲するだけで実現する。

## 対象と非対象

- 対象: `agent_runs` テーブル、集約ドライバー、SSEイベント拡張、kanban UI、
  カード操作の委譲配線。
- 非対象: 監視画面からの新規goal loop作成(既存TaskViewの導線を維持)。
- 非対象: エージェント同士の直接メッセージ交換(オーケストレーション本体は
  workflow scheduler の範囲)。
- 非対象: 新規ストール検知アルゴリズム。既存の閾値定義を再利用する。
- 非対象: `kind=adhoc` の自動検知。v1では「新規サブエージェント」ボタン等からの
  **手動作成のみ**(バスイベントからの自動生成はしない)。将来、分類先が無い
  実行を拾うための予約枠。

## データモデル

```sql
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- goal-loop | workflow-node | subagent | adhoc
  ref_id TEXT NOT NULL,               -- goal_loops.id / ノード実行id / セッションid
  session_id TEXT,                    -- OpenCodeセッションが対応すれば格納(kind=subagentは子セッションid)
  parent_ref_id TEXT,                 -- kind=subagentのみ: 呼び出し元(親)セッションid。Escalate宛先
  title TEXT NOT NULL,
  status TEXT NOT NULL,               -- queued | running | needs-review | blocked | done | failed | stopped
  current_tool TEXT,                  -- 直近ツール名(なければNULL)
  turn_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at INTEGER,          -- 直近の観測時刻(epoch ms)
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  stall_reason TEXT                   -- heartbeat_timeout | tool_timeout | verification_rejected ...
);
CREATE INDEX idx_agent_runs_ws ON agent_runs(workspace_id, status);
```

不変条件:

- 同一 `(kind, ref_id)` で非終端行は高々1つ。新規実行は旧行を終端化してから挿入
  (goal loop の「最新1件」ルールと同型)。
- `status` は自然言語パースで推論しない。元テーブルの明示列/状態から写像する
  (goal-loop.md「目的3」方針の踏襲)。
- `done` / `failed` / `stopped` は終端。以降の更新なし。

### 状態写像

| 集約種別 | 状態元 | 写像 |
| --- | --- | --- |
| goal-loop | `goal_loops.status` + `pause_reason` | 下記の詳細表 |
| workflow-node | ノード実行状態 | 実行中→running, attention要求→needs-review, 失敗→failed |
| subagent | 親セッションツール呼び出し | `opencode-schema.d.ts` の tool系 part で `task` ツールの開始/完了を検知 → running / done |

#### goal-loop の詳しい写像(`paused` は `pause_reason` で確定させる)

| `goal_loops.status` | `pause_reason` | `agent_runs.status` |
| --- | --- | --- |
| `queued` | – | `queued` |
| `running` / `verifying_completed` | – | `running` |
| `paused` | `turn_limit` | `needs-review`(再開可能) |
| `paused` | `scheduler_error` | `needs-review`(再開可能) |
| `paused` | `verification_rejected` | `needs-review`(再開可能) |
| `paused` | `transcript_unreadable` | `blocked`(自動再開不可) |
| `blocked` | – | `blocked` |
| `completed` | – | `done` |
| `stopped` | – | `stopped` |

#### subagent の検知

セッションイベント(`message.updated`)に含まれる tool part から `task`(サブエージェント)
ツールの呼び出しを検知する。開始(=running)と完了(=done)の遷移は tool part の状態
(`state`)で判定し、厳密な part 型は実装時に `opencode-schema.d.ts` で確認する。
検知時に**呼び出し元セッションid**を `parent_ref_id` に記録する(Escalateの宛先として使う)。
検知関数には単体テストを付ける。

## 集約ドライバー

`web/src/lib/agent-monitor.ts`(新規)。**サーバー側イベントエミッター**を新設して駆動する。

現状の前提を正す:

- `web/src/lib/events.ts` は**ブラウザ専用**(`window.dispatchEvent`)で、サーバー内バスではない。
- 既存の workflow SSE(`api/tasks/[id]/workflow/events/route.ts`)はイベントバスではなく
  **1秒ポーリング + revision差分**で実装されている(goal-loopの「状態はイベントで駆動」方針とは逆)。

そのため本仕様は、DB書込後に同期emitする**サーバー内イベントエミッター**
(例: `web/src/lib/agent-events.ts` の `EventEmitter` 互換)を新設し、集約はそれを購読する。
goal-loop や workflow の状態を書き換える関数群が、書き込み完了後にこのエミッターへ
`agent-relevant-change` を emit する。ポーリングは新規コードに持ち込まない。

供給源(すべてエミッター上のイベント):

- goal loop 状態変更(DB書込関数の呼び出し元で emit)
- workflow ノード状態変更(`workflow-events.ts` の更新箇所で emit)
- セッションイベント(`message.updated` 等)→ `current_tool` とハートビート更新
- `hang-watchdog.ts` のタイムアウト通報 → `stall_reason` 設定 + `needs-review`/`blocked` 化

集約ドライバーはエミッター購読時に `agent_runs` 行を upsert し、終端状態へ遷移した行は
`finished_at` を書き、`/agents` 向けSSEへ再配信する。

## SSE拡張

新規 `/api/agent-runs/events`(SSE)を設ける。配信は上記エミッター購読ベースで行い、
**1秒ポーリング(revision差分)方式は採用しない**(既存 workflow events の方式とは意図的に変える)。
`agent-run.updated`(ペイロード: `agent_runs` 行)を配信する。
ハートビートは既存 `web/src/lib/sse-health.ts` の `SSE_HEARTBEAT_MS`(15秒)を再利用し、
無通信時間の定義も `SSE_SILENCE_MS` に揃える(独自の値を新設しない)。
kanban UIは初回にREST一覧取得、以降はイベント差分のみで描画する。

## UI(/agents)

- kanban列: `queued` / `running` / `needs-review` / `blocked` / `done`(failed・stoppedはdone列に合流、バッジで区別)。
- カード表示: title、kindアイコン、経過時間、turn数、直近ツール名、
  ストール警告(経過時間・閾値超過で赤バッジ)、ワークスペース名。
- カードクリック → 対応する既存画面(goal loop パネル / TaskView / workflow ノード)へ遷移。
- カードメニュー(委譲のみ、新ロジックなし):
  - `Stop`: goal loopは`stopped`、workflowノードはノード停止、セッションはabort相当。
  - `Escalate`: **`kind=subagent` のカードにのみ表示する**(親を持つのはsubagentだけ)。
    要約を `parent_ref_id` のセッションへメッセージ送信する
    (`subagent-stall-recovery.md` の escalate 書式をそのまま使用)。
    `parent_ref_id` が無い(検知漏れ等の異常系)場合は送信せず、改善Inbox
    (`improvements` テーブル)へ要約を落として人間に委ねる。
    `goal-loop` / `workflow-node` のカードには表示しない(それぞれ Stop / Retry / 既存の
    attention 導線で扱う)。
  - `Retry`: needs-review/blocked の再開(既存 resume API)。
- ヘッダー: 「新規サブエージェント」ボタン → コンポーザの既存エージェント選択で
  `subagent` 定義を起動(新規 `.opencode/agents/subagent.md` を用意)。

## セキュリティ

- `/api/agent-runs` 系は `requireAuthorized` + CSRF。新規 route は
  `api-guard-coverage.test.ts` の走査対象に入るため、実装後に `npm run test` 全体を通す。
- Stop/Escalate/Retry は既存操作APIの委譲であり、認可は委譲先で判定される。
  集約API自体は新しい権限を設けない。

## テスト

- 状態写像表の全セル(vitest、テーブル駆動)。
- 不変条件: `(kind, ref_id)` 非終端1件のみ。
- ハートビート更新 → ストール判定 → SSE配信の一連(既存SSEテストパターン)。
- Escalate: `parent_ref_id` あり→送信、無し→改善Inboxへ落ちる、`kind`が subagent 以外では
  操作自体が出ないこと。
- kanbanは `@testing-library/react` で列ごとのレンダリング。
- e2e: シナリオ1本(smoke相当でkanban表示のみ)。

## 実装順序

1. `agent_runs` テーブル+写像+テスト
2. ドライバー+SSEイベント
3. REST API(一覧・操作委譲)
4. kanban UI
5. `subagent` エージェント定義+起動導線
