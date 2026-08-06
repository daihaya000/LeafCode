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

## データモデル

```sql
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- goal-loop | workflow-node | subagent | adhoc
  ref_id TEXT NOT NULL,               -- goal_loops.id / ノード実行id / セッションid
  session_id TEXT,                    -- OpenCodeセッションが対応すれば格納
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
| goal-loop | `goal_loops.status` | queued→queued, running/verifying_completed→running, paused→`needs-review`(再開可能) or blocked, completed→done, stopped→stopped |
| workflow-node | ノード実行状態 | 実行中→running, attention要求→needs-review, 失敗→failed |
| subagent | 親セッションツール呼び出し | tool call 中→running, 完了→done |

## 集約ドライバー

`web/src/lib/agent-monitor.ts`(新規)。SSE/DBイベントを購読して写像し、
`agent_runs` を更新する。ポーリングは禁止(goal-loopの教訓: 状態はイベントで駆動)。

供給源:

- goal loop 状態変更(既存SSEイベント)
- workflow ノード状態変更(`workflow-events.ts`)
- セッションイベント(`message.updated` 等)→ `current_tool` とハートビート更新
- `hang-watchdog.ts` のタイムアウト通報 → `stall_reason` 設定 + `needs-review`/`blocked` 化

## SSE拡張

既存イベントストリームに `agent-run.updated`(ペイロード: `agent_runs` 行)を追加。
kanban UIは初回にREST一覧取得、以降はイベント差分のみで描画する。

## UI(/agents)

- kanban列: `queued` / `running` / `needs-review` / `blocked` / `done`(failed・stoppedはdone列に合流、バッジで区別)。
- カード表示: title、kindアイコン、経過時間、turn数、直近ツール名、
  ストール警告(経過時間・閾値超過で赤バッジ)、ワークスペース名。
- カードクリック → 対応する既存画面(goal loop パネル / TaskView / workflow ノード)へ遷移。
- カードメニュー(委譲のみ、新ロジックなし):
  - `Stop`: goal loopは`stopped`、workflowノードはノード停止、セッションはabort相当。
  - `Escalate`: サブエージェント/ノードの要約を親goal loopセッションへメッセージ送信
    (`subagent-stall-recovery.md` の escalate 書式をそのまま使用)。
  - `Retry`: needs-review/blocked の再開(既存 resume API)。
- ヘッダー: 「新規サブエージェント」ボタン → コンポーザの既存エージェント選択で
  `subagent` 定義を起動(新規 `.opencode/agents/subagent.md` を用意)。

## セキュリティ

- `/api/agent-runs` 系は `requireAuthorized` + CSRF。
- Stop/Escalate/Retry は既存操作APIの委譲であり、認可は委譲先で判定される。
  集約API自体は新しい権限を設けない。

## テスト

- 状態写像表の全セル(vitest、テーブル駆動)。
- 不変条件: `(kind, ref_id)` 非終端1件のみ。
- ハートビート更新 → ストール判定 → SSE配信の一連(既存SSEテストパターン)。
- kanbanは `@testing-library/react` で列ごとのレンダリング。
- e2e: シナリオ1本(smoke相当でkanban表示のみ)。

## 実装順序

1. `agent_runs` テーブル+写像+テスト
2. ドライバー+SSEイベント
3. REST API(一覧・操作委譲)
4. kanban UI
5. `subagent` エージェント定義+起動導線
