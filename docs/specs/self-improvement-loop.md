# 自己改善ループ(振り返りエージェント + 改善Inbox)

> 実装ステータス: 🔶 一部実装（MEMORY.md 運用とメモリ層は実装済み・振り返りエージェントは未実装）

セッション完了・定時・手動の契機で「振り返りエージェント」が構造化提案を作り、
`memories` テーブルへの機械生成は自動反映、`AGENTS.md` / skills への変更は人間承認のみで
反映される仕組みを定義する(`MEMORY.md` には本機構から書き込まない)。

## 背景

本リポジトリの改善運用は「処理完了後に `MEMORY.md` を手動更新する」形であり、
教訓の抽出と反映が人手に依存している。Hermes Agent は完了後に自己評価して
スキルとメモリを更新するが、ファイルへの変更を無承認で自動適用することは
このプロジェクトの安全方針(AGENTS.md)と相容れない。

したがって本仕様は、**抽出は自動・適用は承認制**とし、
却下履歴を次回のプロンプトに反映させることで改善提案の精度を上げていく。

## 目的

1. 振り返りエージェント(`retrospective`)を定義し、構造化JSON提案のみを出させる。
2. 提案をDBに蓄積し、Webの「改善Inbox」で確認できるようにする。
3. 反映は二段階で確定する:
   - `memories` テーブルへの機械生成のみ**自動反映**でよい(1日上限付き)。
   - `AGENTS.md`・skills・権限設定への反映は**必ず人間承認**。
   - 機械生成の真実は `memories` テーブル。`MEMORY.md` は人間管理のままとし、
     本機構からは書き込まない(二重管理を避ける)。
4. 却下理由を蓄積し、振り返りプロンプトに否定例として注入する。

## 対象と非対象

- 対象: `retrospective` エージェント定義、実行ドライバー、提案DB、
  Inbox UI、ファイル反映、却下フィードバック。
- 非対象: `MEMORY.md`・`AGENTS.md`・skills への自動適用(ファイルはすべて人間管理か
  人間承認。本機構から自動で書き込まない)。
- 非対象: `memories` テーブルへの自動挿入以外の機械的なファイル変更。
- 非対象: OpenCode本体・`opencode.json` のpermissions自動変更(常に禁止)。
- 非対象: モデル自体のファインチューニングやプロンプト自動最適化。

## エージェント定義

`.opencode/agents/retrospective.md`(既存agent定義と同形式)を新設する。

- mode: 読み取り専用相当。`edit`/`write`/`bash` の書き込み系は権限で無効化。
- モデル: `auto-model.ts` はタスク種別ではなく prompt 分類でティア(`light` / `standard` /
  `heavy`)を決めるため、`retrospective` 用に新たなタスク種別を**追加しない**。
  `standard` ティア(中規模)を固定して `chooseAutoModel` で解決する。
  (自動抽出側 memory-layer.md は `light` ティア・最安コスト帯を使う)
- 出力契約: 最終メッセージは以下のJSONのみ。JSON以外はパース失敗として再実行1回まで。

```json
{
  "memory":   [ { "kind": "fact | preference | lesson | reference", "content": "..." } ],
  "agents_md": [ { "op": "add-rule", "section": "検証", "text": "..." } ],
  "skill":    { "name": "...", "description": "...", "draft": "..." } ,
  "rationale": "提案の根拠(引用はトランスクリプト行番号のみ)"
}
```

`memory` の各要素は `memory-layer.md` の `memories` テーブルスキーマ(`kind` 必須)に
そのまま対応させる。`op` は持たない(常に新規追加のみ)。

## 実行ドライバー

Web側 `lib/self-improvement.ts`(新規)に `runRetrospective(trigger, sessionId)` を置く。

トリガー:

| 契機 | 条件 |
| --- | --- |
| `goal-completed` | goal loop が `completed` に遷移したとき(遷移表#9の副作用) |
| `idle` | ワークスペースの全セッションが60分idle(memory-layer.md と同一の新規idle検出器を再利用) |
| `manual` | Inbox上のボタン |

手順:

1. 対象セッションのトランスクリプト(末尾24k字)+ `LESSONS.md` 末尾 +
   監査ログの失敗エントリ(該当ワークスペース・直近48時間)を集める。
2. `retrospective` エージェントを、goal-loop と同じ**メッセージ送信 + 構造化結果パース**
   の仕組みで実行する(独自の状態機械を作らない)。`goal-loop.ts` のプロンプト送信と
   構造化JSON解析のパターンを流用し、`retrospective` 専用のプロンプトとJSONスキーマを
   定義する。
3. JSONをパースし、`target` ごとに分岐する:
   - `memory`: `memories` テーブルへ `provenance='auto-extract-retrospective'`,
     `approved=1` で**直接挿入**(1日上限チェックは反映節参照)。合わせて `improvements` にも
     `status='applied'` で1行残す(Inboxでの表示・却下操作の対象にするため)。
   - `agents_md` / `skill`: `improvements` テーブルに `status='pending'` で挿入。
4. SSEイベント `improvement.created`(pending分)または `improvement.applied`(memory分)を配信する。

> **memory-layer.md の自動抽出との関係**: 自動抽出も同じ `goal-completed` 遷移で発火し、
> `memories` に `approved=0` 候補を書く。retrospective の `memory` 反映は `approved=1` で確定度が高く、
> 同一内容は既存の完全一致重複判定で吸収される。実装時は「自動抽出候補と retro applied 行の両立・
> 重複排除」をテストで固定する。

## データモデル

```sql
CREATE TABLE improvements (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  trigger TEXT NOT NULL,              -- goal-completed | idle | manual
  session_id TEXT,
  target TEXT NOT NULL,               -- memory | agents_md | skill
  op TEXT NOT NULL,                   -- insert(memory) | add-rule(agents_md) | create-skill(skill)
  payload TEXT NOT NULL,              -- 提案内容JSON
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | applied | rejected | dismissed
  rejection_reason TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX idx_improvements_ws ON improvements(workspace_id, status);
```

## 反映(副作用)

| target | 反映先 | 自動適用 |
| --- | --- | --- |
| `memory` | `memories` テーブル(承認済み)のみ。`MEMORY.md` には書き込まない | 可(1日10件上限) |
| `agents_md` | 対象リポジトリの `AGENTS.md` 該当セクション末尾 | 否(必ず人間承認) |
| `skill` | 対象リポジトリの `.opencode/skills/<name>/SKILL.md` 下書き作成 | 否(必ず人間承認) |

- `memory` の自動反映は `approve` 操作を経由しない(生成時に承認済みとして挿入)。
  ただし上限チェック・監査記録は行う。
- `agents_md` / `skill` の反映は人間の「承認して反映」操作を経由する。

- 反映はgit追跡下で実施し、反映後に diff 付き監査記録を残す(`memory` は
  `memories` への挿入記録を監査する)。
- `memories` テーブルへの自動挿入は1日10件が上限。超過提案は `pending` のまま持ち越し。
- `MEMORY.md` は人間管理のため本機構からは直接触れない。ユーザーが手動で
  `MEMORY.md` へ写す運用を継続する。
- `.opencode/` ディレクトリが対象リポジトリに無い場合は新設する。グローバル配置
  (`~/.config/opencode`)には書き込まない。

## フィードバック(却下理由の蓄積)

- 却下時は理由(自由記述・推奨タグ: `dup` / `wrong` / `too-specific` / `style`)を保存。
- 振り返り実行時、直近20件の却下(`reason` 付き)を
  「これらは却下された提案の例。同種を出すな」という否定例としてプロンプトに注入。

## UI(改善Inbox)

サイドバーにInboxエントリ(未処理件数バッジ)、ページは `/improvements`:

- カード一覧(種別アイコン・提案文・根拠リンク・作成日時)。
- カード展開で対象ファイルの diff プレビュー(既存diffコンポーネント再使用)。
- 操作は target で分岐する:
  - `agents_md` / `skill`(`status='pending'`): `承認して反映` / `却下`(理由入力) / `破棄`(理由不要)。
  - `memory`(`status='applied'`、既に反映済み): 「自動反映済み」バッジを表示し、
    操作は `取消(削除)`(理由入力、却下と同じ扱い)のみ。`MEMORY.md` への書込は
    行わない旨も表示する。

## フィードバックの適用範囲

`memory` の `取消(削除)` も「フィードバック(却下理由の蓄積)」の却下として扱う
(理由付きで保存し、直近20件の否定例プロンプトに含める)。自動反映は承認を経ないため、
誤った記憶が紛れ込んだ場合の主な訂正手段はこの取消操作になる。

## セキュリティ

- 反映対象パスは allowlist(`AGENTS.md` / `.opencode/skills/**`)に限る。
  `MEMORY.md` は本機構の書き込み対象外。既存 `allowlist.ts` に `improvement-apply`
  対象セットを追加。
- APIは `requireAuthorized` + CSRF(`api-guard.ts` 既存)。
- 振り返りエージェント自体は書き込み権限を持たない。すべて反映API経由。

## テスト

- JSONパース・リトライ・不適合出力の処理(vitest)。
- `memory` の自動反映(`memories` 挿入+`improvements`に`applied`行+1日上限+上限超過時の持ち越し)。
- `agents_md` / `skill` の反映(ファイル追記の冪等性・承認フロー)。
- 却下・取消の注入がプロンプトに載ること(`memory` の取消も含む)。
- 権限: 書き込み系ツールを持たないagent定義であることの静的検証。

## 実装順序

1. `improvements` テーブル+`retrospective` エージェント定義+JSONパース(テスト含む)
2. `goal-completed` トリガーのドライバー(`memory` 自動反映 / `agents_md`・`skill` の`pending`挿入)
3. 改善Inbox UI(承認・却下・取消)
4. 却下フィードバック注入
5. `idle` トリガー — memory-layer.md と同様、agent-monitor.md のサーバー内イベントエミッター
   に依存するため、それまでは `goal-completed` / `manual` のみで運用する。
