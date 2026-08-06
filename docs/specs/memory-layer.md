# メモリ層(セッション横断の永続記憶)

Hermes Agent 相当の「永続メモリ + 自動抽出 + 検索注入」を、既存のDB(SQLite)とMCP配線の上に載せる。

## 背景

OpenCode CLI 自体には長期メモリがない。セッションをまたぐ知識(プロジェクト固有の約束事、
失敗からの教訓、ユーザーの好み)は毎回プロンプトに書かない限り失われる。
本リポジトリでは人間が `MEMORY.md` を手運用で更新しているが、抽出・検索・注入は自動化されていない。

## 目的

1. ワークスペース単位の構造化記憶ストアをDBに置く。
2. OpenCodeセッションからMCPツール経由で検索・書き込みできるようにする。
3. セッション完了時に軽量モデルで事実を自動抽出し、承認制で保存する。
4. セッション冒頭に承認済み記憶を自動注入する。

## 対象と非対象

- 対象: DBスキーマ(`memories` テーブル)、MCPサーバー(`memory-mcp`)、
  自動抽出フック、注入フック、管理UI(`/settings/memory`)。
- 非対象: 埋め込みベクトル検索(v1はFTS5のみ。`embedding` 列は将来用に確保)。
- 非対象: ワークスペース横断のグローバルメモリ(v2候補)。
- 非対象: OpenCode本体のフォーク。すべて外部から付加する。

## データモデル

既存 `db.ts` のマイグレーション機構(`db.goal-loop-migration.test.ts` と同型)に追加する。

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,                    -- opencode-id準拠
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- 'fact' | 'preference' | 'lesson' | 'reference'
  content TEXT NOT NULL,
  source_session_id TEXT,                 -- 抽出元セッション(自動抽出のみ)
  provenance TEXT NOT NULL,               -- 'agent' | 'auto-extract' | 'manual'
  approved INTEGER NOT NULL DEFAULT 0,    -- 0=候補 1=承認済み
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_memories_ws ON memories(workspace_id, approved);
CREATE VIRTUAL TABLE memories_fts USING fts5(content, content='memories', content_rowid='rowid');
```

不変条件:

- 注入・エージェントツール検索の対象は `approved = 1` のみ。
- `auto-extract` 生成行は必ず `approved = 0` で作成される。
- `content` は1件2,000字上限。超過は抽出側で分割する。

## MCPサーバー(memory-mcp)

`browser-bridge/mcp/` と同じ構成(stdioサーバー + sharedスキーマ)で新設する。
インストールは `browser-bridge/scripts/install-mcp.mjs` のパターンを踏襲し、
OpenCode の MCP 設定に `memory` エントリを追加する。

ツール定義:

| ツール | 入力 | 意味 |
| --- | --- | --- |
| `memory_search` | `query`, `kind?`, `limit?`(既定5) | FTS5検索 + `last_used_at` 更新。承認済み限定 |
| `memory_add` | `kind`, `content` | `provenance='agent'` で直接 `approved=1` 追加 |
| `memory_update` | `id`, `content?`, `kind?` | 上書き。存在しないidはエラー |
| `memory_delete` | `id` | 削除。FTS同期削除 |

サーバーはホストのDBを直接開く(`better-sqlite3`、読み書き)。
ワークスペース解決は起動時引数の `--workspace` で固定する(セッションごとに1プロセス、
`opencode.json` の `${OPENCODE_WORKSPACE}` 相当の変数で渡す。変数が使えない場合は
wrapperスクリプトが解決する)。

## 自動抽出

トリガー: goal loop の `completed` 遷移(`goal-loop.md` 遷移表#9)および
ワークスペースのセッションが60分間idleになったことの検出(既存SSEの最終イベント時刻を流用)。

手順:

1. 対象セッションのトランスクリプト末尾(最大16k文字)を読む。
2. 軽量モデル(`auto-model.ts` の既存ルーティングで最安クラス)で抽出プロンプトを実行。
   出力は構造化JSONのみ許容:
   ```json
   { "memories": [ { "kind": "...", "content": "..." } ] }
   ```
3. 各行を `provenance='auto-extract'`, `approved=0` で挿入。同一contentの既存行は重複スキップ(完全一致+FTS類似度0.9以上)。
4. WebUIに通知バッジを出す(`/settings/memory` へのリンク)。

抽出プロンプトには「コードやファイル内容の引用禁止。将来も有効な命題のみ」という制約を入れる。

## 注入

BFF の `POST /api/session/.../message` に相当する送信経路で、ユーザーメッセージ送信前に
以下のプレフィックスを付与する(OpenCodeの`message` APIがシステム文脈の上書きを許さないため、
先頭ユーザーメッセージへの注入とする):

```
<workspace-memory>
- (承認済み記憶を use_count 降順で最大8件、各1行)
</workspace-memory>
```

注入された行の `use_count` を+1する。プレフィックスはUIの履歴には表示しない
(送信直前にサーバー側で組み立てるため、表示トランスクリプトには残らない)。

## API(Web側)

すべて `api-guard.ts` の `requireAuthorized` + CSRF防御(既存パターン)を通す。

| メソッド / パス | 意味 |
| --- | --- |
| `GET /api/memory?workspace_id=&approved=&kind=` | 一覧 |
| `POST /api/memory/:id/approve` | 承認(`approved=1`) |
| `PATCH /api/memory/:id` | 内容・種別編集 |
| `DELETE /api/memory/:id` | 削除 |
| `POST /api/memory/extract` | 手動抽出(対象セッションid指定) |

承認・削除・抽出は `audit-log.js` 相当のWeb側監査(既存pattern)に記録する。

## UI

`/settings/memory` ページ(既存設定ビューのセクション追加):

- 一覧テーブル(種別・内容・出所・作成日・使用回数)。承認済み/候補のタブ切替。
- 候補タブ: 一括承認 / 個別承認 / 却下。却下は行削除(却下理由はv2)。
- 編集はインラインテキストエリア。種別はドロップダウン。
- 「今すぐ抽出」ボタン(`POST /api/memory/extract`)。

## テスト

- `memory-layer.test.ts`(vitest): マイグレーション、CRUD、FTS同期、
  「未承認は検索に出ない」不変条件、重複スキップ。
- MCPサーバーは `browser-bridge/test/mcp-stdio.test.mjs` と同型のstdio統合テスト。
- 注入は送信経路の単体テスト(プレフィックスが付く/履歴には出ない/件数上限)。

## 実装順序

1. DBテーブル+FTS+テスト
2. API+監査
3. MCPサーバー+インストールスクリプト
4. 自動抽出+注入
5. UI
