# 自己改善ループ(振り返りエージェント + 改善Inbox)

セッション完了・定時・手動の契機で「振り返りエージェント」が構造化提案を作り、
人間が承認した項目だけが `MEMORY.md` / `AGENTS.md` / skills に反映される仕組みを定義する。

## 背景

本リポジトリの改善運用は「処理完了後に `MEMORY.md` を手動更新する」形であり、
教訓の抽出と反映が人手に依存している。Hermes Agent は完了後に自己評価して
スキルとメモリを更新するが、ファイルへの変更を無承認で自動適用することは
このプロジェクトの安全方針(AGENTS.md)と相容れない。

したがって本仕様は、**抽出は自動・適用は承認制**とし、
却下履歴を次回のプロンプトに反映させることで改善提案の精度を上げていく。

## 目的

1. 振り返りエージェント(`retrospective`)を定義し、構造化JSON提案のみを出させる。
2. 提案をDBに蓄積し、Webの「改善Inbox」で承認/却下できるようにする。
3. 承認項目を対応ファイルに反映する。`MEMORY.md` 追記は自動でもよいが、
   `AGENTS.md`・skills・権限設定は必ず人間承認とする。
4. 却下理由を蓄積し、振り返りプロンプトに否定例として注入する。

## 対象と非対象

- 対象: `retrospective` エージェント定義、実行ドライバー、提案DB、
  Inbox UI、ファイル反映、却下フィードバック。
- 非対象: 提案の自動適用(`MEMORY.md` 追記を除いて一切しない)。
- 非対象: OpenCode本体・`opencode.json` のpermissions自動変更(常に禁止)。
- 非対象: モデル自体のファインチューニングやプロンプト自動最適化。

## エージェント定義

`.opencode/agents/retrospective.md`(既存agent定義と同形式)を新設する。

- mode: 読み取り専用相当。`edit`/`write`/`bash` の書き込み系は権限で無効化。
- モデル: `auto-model.ts` のルーティングに `retrospective` タスク種別を追加し、
  中規模クラスを選定(抽出は軽量モデル、振り返りは中規模)。
- 出力契約: 最終メッセージは以下のJSONのみ。JSON以外はパース失敗として再実行1回まで。

```json
{
  "memory":   [ { "op": "append", "content": "..." } ],
  "agents_md": [ { "op": "add-rule", "section": "検証", "text": "..." } ],
  "skill":    { "name": "...", "description": "...", "draft": "..." } ,
  "rationale": "提案の根拠(引用はトランスクリプト行番号のみ)"
}
```

## 実行ドライバー

Web側 `lib/self-improvement.ts`(新規)に `runRetrospective(trigger, sessionId)` を置く。

トリガー:

| 契機 | 条件 |
| --- | --- |
| `goal-completed` | goal loop が `completed` に遷移したとき(遷移表#9の副作用) |
| `idle` | ワークスペースの全セッションが60分idle |
| `manual` | Inbox上のボタン |

手順:

1. 対象セッションのトランスクリプト(末尾24k字)+ `LESSONS.md` 末尾 +
   監査ログの失敗エントリ(該当ワークスペース・直近48時間)を集める。
2. `retrospective` エージェントを `opencode run` 相当(APIセッション)で実行する。
3. JSONをパースし、提案行を `improvements` テーブルに `pending` で挿入。
4. SSEイベント `improvement.created` を配信する。

## データモデル

```sql
CREATE TABLE improvements (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  trigger TEXT NOT NULL,              -- goal-completed | idle | manual
  session_id TEXT,
  target TEXT NOT NULL,               -- memory | agents_md | skill
  op TEXT NOT NULL,                   -- append | add-rule | create-skill
  payload TEXT NOT NULL,              -- 提案内容JSON
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | applied | rejected | dismissed
  rejection_reason TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX idx_improvements_ws ON improvements(workspace_id, status);
```

## 反映(approve時の副作用)

| target | 反映先 | 自動適用 |
| --- | --- | --- |
| `memory` | `memories` テーブル(承認済み)`+ MEMORY.md` 末尾追記 | 可 |
| `agents_md` | 対象リポジトリの `AGENTS.md` 該当セクション末尾 | 要承認(不可の明示) |
| `skill` | `.opencode/skills/<name>/SKILL.md` 下書き作成 | 要承認 |

- 反映はgit追跡下で実施し、反映後に diff 付き監査記録を残す。
- `MEMORY.md` の自動追記は1日10件が上限。超過提案は `pending` のまま持ち越し。
- `MEMORY.md` が閾値(例: 400行)を超えたら `compaction` 振り返りを連鎖実行し、
  要約差し替え提案を1本 `pending` で作る(適用は人間)。

## フィードバック(却下理由の蓄積)

- 却下時は理由(自由記述・推奨タグ: `dup` / `wrong` / `too-specific` / `style`)を保存。
- 振り返り実行時、直近20件の却下(`reason` 付き)を
  「これらは却下された提案の例。同種を出すな」という否定例としてプロンプトに注入。

## UI(改善Inbox)

サイドバーにInboxエントリ(未処理件数バッジ)、ページは `/improvements`:

- カード一覧(種別アイコン・提案文・根拠リンク・作成日時)。
- カード展開で対象ファイルの diff プレビュー(既存diffコンポーネント再使用)。
- 操作: `承認して反映` / `却下`(理由入力) / `破棄`(理由不要)。
- `memory` 系は承認後に `MEMORY.md` と `memories` テーブルの双方へ反映した旨を表示。

## セキュリティ

- 反映対象パスは allowlist(`MEMORY.md` / `AGENTS.md` / `.opencode/skills/**`)に限る。
  既存 `allowlist.ts` に `improvement-apply` 対象セットを追加。
- APIは `requireAuthorized` + CSRF(`api-guard.ts` 既存)。
- 振り返りエージェント自体は書き込み権限を持たない。すべて反映API経由。

## テスト

- JSONパース・リトライ・不適合出力の処理(vitest)。
- 各targetの反映(ファイル追記の冪等性・行上限)。
- 却下注入がプロンプトに載ること。
- 権限: 書き込み系ツールを持たないagent定義であることの静的検証。
