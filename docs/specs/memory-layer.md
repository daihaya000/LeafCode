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
- 非対象: 埋め込みベクトル検索(v1はFTS5のみ。`embedding` 列はv1のスキーマに含めず、
  必要になった時点で `ALTER TABLE` で追加する)。
- 非対象: ワークスペース横断のグローバルメモリ(v2候補)。
- 非対象: OpenCode本体のフォーク。すべて外部から付加する。

## データモデル

`db.ts` はバージョン管理ランナーを持たず、`CREATE TABLE IF NOT EXISTS` と
guard付き `ALTER TABLE`(例: `db.ts:344`)の組み合わせで初期化する。本テーブルは新規のため
`CREATE TABLE IF NOT EXISTS` で追加し、FTS同期トリガは `DROP TRIGGER IF EXISTS` →
`CREATE TRIGGER` で冪等に作成する。テストは `db.goal-loop-migration.test.ts` と同型で行う。

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,                    -- opencode-id準拠(他テーブルと同じ規約)
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
CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, content);
```

`id TEXT PRIMARY KEY` を他テーブル(`goal_loops` 等)と揃えたまま FTS5 を使うため、
**外部コンテンツ表(`content_rowid`)は使わない**(TEXT PKはSQLiteのrowidと別物になり
噛み合わせが壊れやすい)。代わりに `id` を FTS5 の `UNINDEXED` 列として持たせ、
rowid には依存しないトリガ同期にする:

```sql
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(id, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
  UPDATE memories_fts SET content = new.content WHERE id = new.id;
END;
CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE id = old.id;
END;
```

検索は `SELECT id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank` で候補idを取り、
`memories` を `id IN (...)` で引く(join不要)。

将来のベクトル検索(v2)は `memories` に `embedding` 列を追記する形で対応する
(v1のCREATE文には含めない。追加時は `db.ts` の既存パターンである guard付き `ALTER TABLE`
で追加する)。

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
| `memory_add` | `kind`, `content` | `provenance='agent'` で追加(詳細は汚染対策参照) |
| `memory_update` | `id`, `content?`, `kind?` | 上書き。存在しないidはエラー |
| `memory_delete` | `id` | 削除。FTS同期削除 |

サーバーはホストのDBを直接開く(`better-sqlite3`)。

- DBパス: `web/src/lib/paths.ts` の `dbPath()` と同一。MCP起動時に env
  `OPENCODE_WEBUI_DATA_DIR` で絶対パスを渡す(エージェントの作業ディレクトリから相対解決しない)。
- 同時アクセス: WebサーバーとMCPが別プロセスで同じSQLiteを開く。接続時に
  `busy_timeout`(5000ms)と `journal_mode = WAL` を必ず設定する(web側 `db.ts:116` はWAL済み)。
  書込は memories 系テーブルのみに限定し、他テーブルには触れない。
- ワークスペース解決は起動時引数の `--workspace` で固定する(セッションごとに1プロセス)。
  **未検証**: OpenCode の MCP 設定が起動コマンドへの変数展開(ワークスペースパス等)を
  サポートするかは `docs/opencode/` に記述がなく確認できていない。サポートされない場合は、
  `opencode.json` を配置する側(プロファイル同期の仕組み、`sync-engine.ts` 系)で
  ワークスペースごとに固定引数を書き込む wrapper 方式にする。実装着手時に要確認。

### プロンプト汚染対策

`memory_add` で追加した行は `approved=1` になり、将来の注入文脈に任意の文を混入できる経路に
なる(プロンプトインジェクションで記憶を汚染される可能性)。

- `provenance='agent'` の全行は管理UIに常時一覧表示し、ワンクリックで削除・承認取消できる。
- 注入時は各行に出所(`provenance` と抽出元)を添える。
- `memory_add`/`memory_delete` はすべて監査ログに記録する。

## 自動抽出

トリガー: goal loop の `completed` 遷移(`goal-loop.md` 遷移表#9)および
ワークスペースのセッションが60分間idleになったことの検出。idle検出は既存に無いため
**新規実装**とする: agent-monitor.md が新設するサーバー内イベントエミッターから
セッション最終アクティビティ時刻を保持し、サーバー内タイマーで60分超過を判定する
(ブラウザ向けSSEの時刻流用やポーリングはしない)。

手順:

1. 対象セッションのトランスクリプト末尾(最大16k文字)を読む。
2. 軽量モデル(`auto-model.ts` の既存ルーティングで最安クラス)で抽出プロンプトを実行。
   出力は構造化JSONのみ許容:
   ```json
   { "memories": [ { "kind": "...", "content": "..." } ] }
   ```
3. 各行を `provenance='auto-extract'`, `approved=0` で挿入。重複判定はv1では**完全一致のみ**
   (FTS5のbm25スコアは正規化された0-1類似度ではないため、「類似度0.9以上」のような閾値は
   定義できない)。近似重複の排除は埋め込み導入後のv2に持ち越す。
4. WebUIに通知バッジを出す(`/settings/memory` へのリンク)。

抽出プロンプトには「コードやファイル内容の引用禁止。将来も有効な命題のみ」という制約を入れる。

## 注入

OpenCode の `message` API はシステム文脈の上書きを許さないため、先頭ユーザーメッセージに
プレフィックスを付与して注入する。送信は goal-loop が使用するものと同一のメッセージ送信経路
から行う。

```
<workspace-memory>
- (承認済み記憶を use_count 降順で最大8件、各1行)
</workspace-memory>
```

- 注入された行の `use_count` を+1する。
- **このプレフィックスは OpenCode が受信したメッセージとしてトランスクリプトに永続化される**
  (受信メッセージは保存されるため)。「履歴に残らない」という設計は成立しない。
  そのため UI 側はメッセージ表示時に `<workspace-memory>` ブロックを除外して描画する
  (表示前変換: `web/src/lib/message-parts.ts` 相当)。除外漏れ防止の単体テストを必須とする。

## API(Web側)

すべて `api-guard.ts` の `requireAuthorized` + CSRF防御(既存パターン)を通す。
新規 route は `api-guard-coverage.test.ts` の走査対象に入るため、実装後に `npm run test`
全体を実行してガード漏れを検出する。

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
- 注入は送信経路の単体テスト(プレフィックスが付く / トランスクリプトに永続化される /
  UI描画でブロックが除外される / 件数上限)。

## 実装順序

1. DBテーブル+FTS+テスト
2. API+監査
3. MCPサーバー+インストールスクリプト
4. 自動抽出(`goal-completed` トリガーのみ)+注入
5. UI
6. `idle` トリガー — **agent-monitor.md のサーバー内イベントエミッター(同spec実装順序#2)に
   依存**。エミッター未実装の間は `goal-completed` のみで運用し、`idle` は後追いで有効化する。
