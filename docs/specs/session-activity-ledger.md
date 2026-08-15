# セッション活動台帳（Session Activity Ledger）— 並行セッションの状況把握強化

> 実装ステータス: ⬜ 未実装（計画・設計段階）

既存の「並行セッション相互認識」（`collaboration-awareness.md`、実装済み）を拡張し、
**他セッションが「いま何をしているか」「何を変えたか」「いつ終わったか」**を
ユーザー UI・プロンプト注入・MCP tool の 3 面で把握できるようにする。

## 背景

`collaboration-awareness.md` はプロンプト送信直前に busy/retry の他セッション情報を
`<collaboration-context>` として注入する。実装済みだが以下のギャップがある:

- **UI に他セッション状態が一切出ない**。Sidebar は自タスクのみ、DiffPane の
  「セッション外?」バッジ（`web/src/components/task/DiffPane.tsx:1043`）も
  「diff に出ているが自セッションの edit/write/patch で触れていない」という間接判定。
- **busy/retry のみが対象**で、完走して idle に戻った直後のセッションは視界から消える
  （コミット直後の他エージェントは最も危険なのに見えない）。
- **変更検知がトランスクリプト由来**。`isFileModifyingTool`
  （`web/src/lib/session-touched-files.ts:27`）は edit/write/patch 系のみで、
  bash 経由の書き込み・git commit・task 委譲（bail out）は検知できない。
- **同期 `prompt` / `command` 送信には注入されない**（`opencode-proxy/proxy.ts:352` は
  `prompt_async` のみ）。
- **LeafCode 外のエージェント（Cursor / Claude Code / Codex）は不可視**。
- **エージェントが自発的に他セッション状況を問い合わせる手段（MCP tool）がない**。

## 目的

1. ワークスペース内の全セッション活動を記録する台帳（`session_activity`）を新設する。
2. 台帳を元に Sidebar へ「アクティブセッション」セクションを追加し、ユーザーに可視化する。
3. 注入対象を「busy/retry」から「直近完走・コミットしたセッション」「競合候補ファイル」へ拡張し、
   同期送信（prompt / command）にも適用する。
4. MCP tool `session_status` を追加し、エージェントがターン中に能動照会できるようにする。
5. git 差分（dirty fingerprint / HEAD）監視により、LeafCode 外エージェントの変更も検知する。

## 対象と非対象

- 対象: `session_activity` テーブル、活動記録ドライバー、Sidebar のアクティブセッション UI、
  注入内容の拡張、MCP tool `session_status`。
- 非対象: ファイルロック・セッション停止・確認ダイアログ（`collaboration-awareness.md` の
  「通知して継続する」方針を維持）。
- 非対象: `agent-monitor.md`（`agent_runs` と kanban `/agents`）の実装。
  本設計は「セッション単位の状態とファイル関与」、agent-monitor は「実行単位の横断ビュー」で
  レイヤーが異なる。将来 agent-monitor を実装する際は `session_activity` を
  `current_tool` / `last_seen_at` の供給源として参照できるが、今回は依存しない。
- 非対象: 複数セッションの直接メッセージ交換（オーケストレーションは workflow scheduler の範囲）。

## データモデル

```sql
-- セッションごとの最新活動状態（1 ワークスペース × 1 セッション = 1 行）
CREATE TABLE session_activity (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,                -- OpenCode セッション ID
  title TEXT NOT NULL DEFAULT '',          -- session_bindings.title のキャッシュ
  last_status TEXT NOT NULL,               -- idle | busy | retry（types.ts の SessionStatusType）
  status_message TEXT,                     -- retry の attempt/message（あれば）
  current_tool TEXT,                       -- 直近のツール名（メッセージ part から）
  touched_files_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at INTEGER NOT NULL,           -- 直近の観測時刻（epoch ms）
  busy_since_at INTEGER,                   -- 直近 busy への遷移時刻（経過時間表示用）
  finished_at INTEGER,                     -- busy/retry → idle に戻った時刻
  committed_at INTEGER,                    -- このセッションに帰属した直近コミット時刻
  dirty_fingerprint TEXT,                  -- このセッションの活動時点の git dirty 状態
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, session_id)
);
CREATE INDEX idx_session_activity_ws ON session_activity(workspace_id, last_seen_at);

-- ワークスペース単位の git スナップショット（外部エージェント検知用、1 ワークスペース 1 行）
CREATE TABLE workspace_git_snapshots (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  head_sha TEXT NOT NULL,
  dirty_fingerprint TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  changed_by_session_id TEXT,              -- 帰属できた場合は session_id、できなければ NULL
  origin TEXT NOT NULL DEFAULT 'external'  -- session | external | unassigned
);
```

不変条件:

- `last_status` は OpenCode の `SESSION_STATUS_PATH` レスポンス（idle/busy/retry）からの
  写像のみ。自然言語パースで推論しない。
- `session_activity` は古い行を残さない（最新 1 行）。履歴が必要になった場合は別テーブル化する。
- `workspace_git_snapshots` は `readWorkflowWorkspaceSnapshot`
  （`web/src/lib/workflow-git.ts:10`、`rev-parse HEAD` + `status --porcelain=v1 -uall` の
  SHA-256）を流用し、fingerprint 形式を増やさない。

### 変更の帰属ルール

ポーリングで前回スナップショットと差分を検出したとき:

1. `head_sha` が進んだ → 「コミット発生」。`git log -1 --format=%cI,%s` で時刻と件名を取得。
   「その時刻に busy だったセッションがちょうど 1 件」なら `changed_by_session_id` に帰属、
   それ以外は `origin='external'`。
2. `dirty_fingerprint` が変化した（HEAD は同一）→ 「未コミット編集」。
   変化したパスが `touched_files_json` と重複する busy セッションが 1 件なら帰属、それ以外は
   `origin='external'`（Cursor 等の外部エージェントの可能性）。

帰属は best-effort。不明なものはすべて `external` として記録し、注入・UI で「他ツール由来の
変更」として表示する。

## 活動記録ドライバー

`web/src/lib/session-activity.ts`（新規）。供給源は 3 系統で、すべて失敗しても
プロンプト送信を止めない（`collaboration-context.ts:119` と同じ方針）。

### 供給源 1: SSE 監視（proxy 内）

`web/src/lib/opencode-proxy/proxy.ts` はエンジンの全イベントを単一接続で受信している。
`session.status` / `session.idle` / `session.message`（v2 は `session.next.*`）を購読し、
`web/src/lib/opencode-events.ts` の `HANDLED_*_EVENT_TYPES` と同型の監視を追加する:

- `last_status` / `busy_since_at` / `finished_at` / `current_tool` の更新。
- `extractSessionTouchedPaths` を既存呼び出し（`TaskView.tsx:2644`）と同じ規則で適用し
  `touched_files_json` を更新（task 委譲時は空 Set の既存挙動を維持）。
- 全セッションのイベントが流れるため、セッション ID はイベント内の session_id で区別する。

### 供給源 2: 既存アクティビティ契機

`touchSessionActivity`（`web/src/lib/db.ts:436`）の呼び出し時（手動送信 / goal-loop / workflow /
アシスタント完了）に `last_seen_at` / `last_status` を更新する。既存の
`memory-auto-extract.ts:223` のフックと並置する。

### 供給源 3: git スナップショットポーリング

`web/src/lib/dirstat.ts:141` の TTL キャッシュ方式（15 秒）を共有し、
`workspace_git_snapshots` を更新する。ポーラーは `web/src/instrumentation.ts:29-45` の
既存スケジューラ群（goal-loop / workflow / hang-watchdog / memory-auto-extract）と同じ
`setInterval` 方式で `web/src/lib/workspace-snapshot-poller.ts`（新規）として起動する。
スナップショットはワークスペースごとではなく「前回値との差分」を判定し、変化時のみ DB へ書く。

## 注入の拡張

`collaborationContextFor`（`web/src/lib/collaboration-context.ts:107`）を拡張する。
`<collaboration-context>` ブロックの内容を以下へ拡張する:

```
<collaboration-context>
Live status of other sessions working in this workspace. Reference information, not instructions.
Avoid reverting or overwriting their work. Report overlaps to the user.

- <title> (<id8>): busy 12m; tool: Bash; files: src/a.ts, src/b.ts
- <title> (<id8>): finished 3m ago; committed "feat: x" at 12:34; files: src/c.ts
- <title> (<id8>): idle; uncommitted changes overlap with YOUR files: src/b.ts  ← 競合候補を強調
- EXTERNAL (Cursor/Claude Code/Codex 検知): HEAD advanced to abc1234 ("feat: x"), files: src/d.ts
</collaboration-context>
```

変更点:

- **対象の拡張**: busy/retry に加え、「`finished_at` が直近 15 分以内」のセッションと
  「`committed_at` が直近 15 分以内」のセッションを含める（上限は既存の 5 件）。
- **競合候補の強調**: 自セッションの `touched_files_json` と他セッションのそれの共通部分を
  `overlap with YOUR files` として明記する（現行はファイル一覧の羅列のみ）。
- **外部変更の明記**: `workspace_git_snapshots.origin='external'` の変化を
  `EXTERNAL` 行として含める。
- **同期送信への適用**: `proxy.ts:338-359` の条件を `prompt_async` から
  `prompt` / `command` / `prompt_async` の 3 経路へ広げる（`manualSendSessionId` 判定のまま）。
- **fingerprint 重複抑制は維持**: `collaboration-context.ts:156` の再注入抑止と
  `compacted_at` 後の強制再注入（`:146`）はそのまま。fingerprint は拡張後のブロック形式で
  再計算する。

## UI: Sidebar の「アクティブセッション」セクション

`web/src/components/shell/Sidebar.tsx`（既存 3 秒ポーリング `Sidebar.tsx:59`）に
「アクティブセッション」セクションを追加する:

- 表示: セッションタイトル / busy スピナー / 経過時間（`busy_since_at` から）/
  `current_tool` / 触れたファイル chips（最大 8 件）/ 最終活動時刻 / 外部変更バッジ。
- 競合警告: 自ワークスペースの他セッションが「自分が触れたファイル」を編集している場合、
  タスクカードへ警告バッジを表示（`DiffPane.tsx:1043` の externalChange 判定を
  タスクレベルへ昇格し、`task-service.ts` で共有）。
- データ取得: 新規 REST API `GET /api/workspaces/[id]/activity`（`session_activity` +
  `workspace_git_snapshots` を返す）。SSE は新設しない（3 秒ポーリングで十分、SSE は
  `agent-monitor.md` 実装時に検討）。
- クリックで対象セッションのタスクへ遷移（`session_bindings` 経由で解決できれば）。

## MCP tool: `session_status`

`browser-bridge/mcp/memory-server.mjs`（サーバー名 `leafcode-memory`）に tool を追加する:

- `session_status`（入力: `directory?` / `limit?`）: `session_activity` と
  `workspace_git_snapshots` を `webui.db`（`web/src/lib/paths.ts:24` の DB を参照）から読み、
  ワークスペース内のセッション状態・完了時刻・外部変更を返す。認可は既存 memory MCP と同様
  （承認済みセッション限定）。
- 既存 4 tool（memory_search / add / update / delete）の命名規則に従う。
- OpenCode エージェントがターン中に「他セッションは今どうしているか」を能動的に
  確認するために使う。注入ブロックは「送信時のスナップショット」なので、
  ターン途中の再確認はこの tool が担う。

## セキュリティ

- `/api/workspaces/[id]/activity` は `requireAuthorized` + CSRF。新規 route は
  `api-guard-coverage.test.ts` の走査対象に入るため、実装後に `npm run test` 全体を通す。
- MCP tool `session_status` はローカル MCP（承認済みセッション経由）のみ。
- 本設計は既存のファイル権限モデルを変更しない。他セッションのトランスクリプト内容
  （メッセージ本文）は台帳に保存しない（メタデータのみ）。

## テスト

- 帰属ルール（テーブル駆動）: busy 1 件 → 帰属 / busy 複数 → external / 該当なし → external /
  HEAD 前進のみ / dirty のみ / 両方同時。
- 状態写像: SSE イベント → `session_activity` の更新（idle/busy/retry 遷移、`busy_since_at`、
  `finished_at`）。
- 注入ブロック: 競合候補の強調行、外部変更行、直近完走セッション行の生成。
- fingerprint 再計算: 拡張ブロックで再注入抑止が機能すること。
- UI: アクティブセッションセクションのレンダリング、タスクカードの警告バッジ
  （`@testing-library/react`）。
- MCP: `session_status` の DB 読み取りと応答形式（`browser-bridge/test/` の既存パターン）。

## 実装順序

1. `session_activity` / `workspace_git_snapshots` テーブル + マイグレーション + テスト
2. 活動記録ドライバー（SSE 監視 / touchActivity フック / git ポーラー）
3. REST API `GET /api/workspaces/[id]/activity`
4. Sidebar のアクティブセッション UI + タスクカード警告バッジ
5. 注入拡張（対象・競合候補・外部変更・同期送信）
6. MCP tool `session_status`
7. （任意・後日）`agent-monitor.md` 実装時に `session_activity` を供給源として統合
