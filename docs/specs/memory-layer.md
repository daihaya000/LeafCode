# メモリ層(セッション横断の永続記憶)

Hermes Agent 相当の「永続メモリ + 自動抽出 + 検索注入」を、既存のDB(SQLite)とMCP配線の上に載せる。

## 背景

OpenCode CLI 自体には長期メモリがない。セッションをまたぐ知識(プロジェクト固有の約束事、
失敗からの教訓、ユーザーの好み)は毎回プロンプトに書かない限り失われる。
本リポジトリでは人間が `MEMORY.md` を手運用で更新しているが、抽出・検索・注入は自動化されていない。

## 目的

1. プロジェクト単位の構造化記憶ストアをDBに置く。
2. OpenCodeセッションからMCPツール経由で検索・書き込みできるようにする。
3. セッション完了時に軽量モデルで事実を自動抽出し、既定は自動保存、必要に応じて承認制へ切り替える。
4. セッション冒頭に承認済み記憶を自動注入する。

## 記憶スコープ(v2で変更)

**記憶はプロジェクト(`projects.id`)に属する。ワークスペースには属さない。**

v1はスコープを `workspace_id` にしていたが、WebUIのワークスペースは「1タスク」の単位で
量産される(実測: 実パス7種に対してワークスペース306個)。結果として同じプロジェクトの
知識が68ワークスペースに分散し、新しいタスクを始めた瞬間に過去の記憶が一切見えなくなっていた
(注入実績は2,356件に対して12回)。これは「セッション横断の永続記憶」という本仕様の目的に
対する機能欠損である。

- 書き込み時に `resolveMemoryScope(workspaceId)` でスコープを解決し、`scope_kind='project'` /
  `scope_key=<project_id>` を行に記録する。プロジェクトに属さないワークスペース
  (legacy)だけが `scope_kind='workspace'` / `scope_key=<workspace_id>` になる。
- 読み出し条件は `(scope_key = :scope OR workspace_id = :workspaceId)`。後者は
  `scope_key` 未設定の旧行を取りこぼさないためのフォールバック。
- API・MCPの引数は互換のため `workspaceId` を維持し、スコープ解決はサーバー内部で行う。
- `deleteWorkspace` は `scope_kind IS NULL OR 'workspace'` の行だけ削除する。
  1タスクの終了でプロジェクトの学びを消してはならない。プロジェクト削除時のみ全削除する
  (`deleteProject`)。

## 対象と非対象

- 対象: DBスキーマ(`memories` テーブル)、MCPサーバー(`memory-mcp`)、
  自動抽出フック、注入フック、管理UI(`/settings/memory`)。
- 非対象: 埋め込みベクトル検索(v1はFTS5のみ。`embedding` 列はv1のスキーマに含めず、
  必要になった時点で `ALTER TABLE` で追加する)。近似重複の判定も埋め込みを使わず
  字句ベースで行う(「重複判定」節)。
- 非対象: プロジェクト横断のグローバルメモリ。
- 非対象: 自動的な既存行の統合。v2は「これ以上増やさない」ことを保証し、既存の重複整理は
  ユーザーが明示的に実行する操作としてのみ提供する(「既存重複の整理」節)。
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
  provenance TEXT NOT NULL,           -- 'agent' | 'auto-extract' | 'auto-extract-retrospective' | 'manual'
  approved INTEGER NOT NULL DEFAULT 0,    -- 0=候補 1=承認済み
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,         -- optimistic concurrency token
  -- v2: 検索スコープ(「記憶スコープ」節)。NULL は未解決の旧行
  scope_kind TEXT,                             -- 'project' | 'workspace'
  scope_key TEXT,
  -- v2: 重複判定用の正規化キー(「重複判定」節)
  norm_key TEXT
);
CREATE INDEX idx_memories_ws ON memories(workspace_id, approved);
CREATE INDEX idx_memories_scope ON memories(scope_key, approved);
CREATE INDEX idx_memories_norm ON memories(scope_key, norm_key);
CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, content);

CREATE TABLE memory_session_injections (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  injected_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, session_id)
);

-- v2: セッションごとの抽出カーソルとクールダウン台帳(「自動抽出」節)
CREATE TABLE memory_session_extract_state (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  last_message_id TEXT,
  last_extracted_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, session_id)
);
```

`scope_kind` / `scope_key` / `norm_key` は既存インストールへ guard付き `ALTER TABLE` で追加し、
初期化時に (a) ワークスペースが属するプロジェクトIDでスコープを、(b) `norm_key` を
backfillする。UNIQUE制約は張らない(既存2,356行に近似重複が含まれており、
制約追加はマイグレーション失敗を招くため)。重複防止は挿入前照合で行う。

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

抽出実行は `memory_extraction_runs` に永続化する。トリガー、実行状態、保存・候補化・
安全検査による拒否・重複スキップの件数、失敗理由、既読時刻を保持し、ワークスペース単位の
通知バッジと履歴表示に使う。履歴は抽出開始時に `running` で作成し、成功時は `completed`、
例外・タイムアウト時は `failed` に更新する。未読は画面を開いただけでは既読にせず、ユーザーの
明示操作で既読化する。

不変条件:

- 注入・エージェントツール検索の対象は `approved = 1` のみ。
- 同一スコープ内に同義の命題を2行作らない(「重複判定」節)。
- `memory.write_approval = '1'` のとき、全ての新規書き込みは `approved = 0` で候補として作成される。
- `memory.write_approval` が未設定または空のときは、脅威検査を通過した新規書き込みを `approved = 1` で保存する（Hermes Agent互換の既定）。
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
| `memory_update` | `id`, `expectedRevision`, `content?`, `kind?` | revision一致時だけ上書き。競合はエラー |
| `memory_delete` | `id`, `expectedRevision` | revision一致時だけ削除。FTS同期削除 |

サーバーはホストのDBを直接開く(`better-sqlite3`)。

- DBパス: `web/src/lib/paths.ts` の `dbPath()` と同一。MCP起動時に env
  `OPENCODE_WEBUI_DATA_DIR` で絶対パスを渡す(エージェントの作業ディレクトリから相対解決しない)。
- 同時アクセス: WebサーバーとMCPが別プロセスで同じSQLiteを開く。接続時に
  `busy_timeout`(5000ms)と `journal_mode = WAL` を必ず設定する(web側 `db.ts:116` はWAL済み)。
  書込は memories 系テーブルのみに限定し、他テーブルには触れない。
- ワークスペース解決は起動時引数の `--workspace` で固定する(セッションごとに1プロセス)。
  **env 変数展開(`{env:VAR}`)は `browser-bridge/scripts/install-mcp.mjs` が
  `{env:OPENCODE_WEBUI_BROWSER_BROKER}` 等で既に使っており、MCP 設定の `environment` 値では
  実績がある**。未検証なのは**コマンド引数への変数展開**のみ(`docs/opencode/` に記述なし)。
  サポートされない場合は、`opencode.json` を配置する側(プロファイル同期の仕組み、
  `sync-engine.ts` 系)でワークスペースごとに固定引数を書き込む wrapper 方式にする。
  実装着手時に要確認。

### プロンプト汚染対策

`memory_add` で追加した行は既定では `approved=1` になり、将来の注入文脈に任意の文を混入できる経路に
なる(プロンプトインジェクションで記憶を汚染される可能性)。`memory.write_approval='1'` の場合は
`memory_add` も `approved=0` の候補になる。

- `provenance='agent'` の全行は管理UIに常時一覧表示し、ワンクリックで削除・承認取消できる。
- 注入時は各行に出所(`provenance` と抽出元)を添える。内容の改行・`<`・`>`は
  プロンプト境界を壊さない形に変換し、メモリは「参照情報」であって命令ではないと
  明示する。
- `memory_add`/`memory_delete` はすべて監査ログに記録する。
- 全書き込み経路は保存前に不可視Unicode、メモリ境界タグ、明白なプロンプト注入、資格情報・SSH鍵の持ち出しを検査し、拒否理由を監査ログに記録する。

## 自動抽出

トリガーは、通常会話の完了済みassistantメッセージ、goal loop の `completed` 遷移
(`goal-loop.md` 遷移表#9)、およびワークスペースのセッションが60分間idleになったことの検出。
通常会話はブラウザ向けSSEに依存せず、Node runtime起動時にサーバーがOpenCodeの
`/global/event`を購読する。workspace/directoryの対応が一意な場合だけ対象にし、
`(workspace_id, session_id, assistant_message_id)` 台帳で重複を排除する。idle検出は既存に無いため
**新規実装**とし、サーバー内タイマーで60分超過を判定する（ブラウザの時刻流用やポーリングはしない）。

### 実行頻度(v2で変更)

v1は完了済みassistantメッセージごとに抽出し、毎回「トランスクリプト末尾16k文字」を
読み直していた。同じ会話の同じ範囲を繰り返し読ませたため、実測で1セッション358回の抽出から
634件が作られ、そのうち407件が言い換え重複だった。v2では次の2点で抑制する。

- **差分のみ抽出**: `memory_session_extract_state.last_message_id` 以降のメッセージだけを
  入力にする。差分が空なら抽出実行そのものを作らない(`memory_extraction_runs` にも
  記録しない)。カーソルは**成功時のみ**前進させる(失敗した回は同じ差分を再読する)。
- **セッション単位のクールダウン**: `assistant-completed` トリガーは
  `MEMORY_EXTRACT_COOLDOWN_MS`(10分)以内に同一セッションを再抽出しない。
  `manual` / `goal-completed` / `idle` はクールダウンを無視する(明示操作・終端イベント)。
  クールダウン判定はデバウンス発火時に行うため、待機中にクールダウンが切れた分は実行される。

手順:

1. `messagesAfter(messages, last_message_id)` で未抽出分だけを取り出し、末尾最大16k文字にする
   (差分0件なら終了)。
2. 同一スコープの既存メモリを `listMemoryHintsForExtraction()` で最大20件・各160字までに
   まとめ、プロンプトの `ALREADY STORED` 節として提示する。既知の命題を言い換えて
   再提出させないための最初の防波堤(モデルは既知だと知らなければ避けられない)。
3. 軽量モデル(`auto-model.ts` の既存ルーティングで最安クラス)で抽出プロンプトを実行。
   出力は構造化JSONのみ許容:
   ```json
   { "memories": [ { "kind": "...", "content": "..." } ] }
   ```
   1回あたりの採用は `MEMORY_EXTRACT_MAX_ITEMS_PER_RUN`(3件)までに切り詰める。
   通常の正解は0〜1件である旨をプロンプトに明記する。
4. 各行を `provenance='auto-extract'` で挿入し、`memory.write_approval` に応じて `approved` を
   決める。挿入前に「重複判定」を通し、同義の行は挿入せず既存行の `updated_at` を更新して
   `skipped` に数える。
5. 成功時のみ `memory_session_extract_state` を更新する(カーソル前進 + クールダウン開始)。
6. `memory_extraction_runs` に結果を記録し、WebUIのメモリ画面に未読件数バッジと履歴を出す。
   履歴には保存・候補化・拒否・失敗・重複スキップの状態を表示し、「すべて既読」で明示的に
   既読化する。

### 重複判定(v2で変更)

v1は完全一致(`content` の厳密比較)のみで、実測では**一件も**重複を検出できていなかった
(完全一致0件・言い換え重複407件)。v2は埋め込みを導入せず、`memory-key.ts` の
決定的な字句判定で近似重複を落とす。判定は**保守的**にする。誤マージ(別の命題を
同一視して捨てる)は重複残存より有害だからである。

1. **正規化キー(`norm_key`)**: NFKC・小文字化・空白と句読点の畳み込み・日本語の丁寧形/
   語尾の正規化を行い、書式だけの差を同一キーにする。インデックス付きの等値検索で
   拾える分はここで拾う。
2. **極性ガード**: 否定形(`〜しない` / `〜してはいけない` / `〜されません` 等)と肯定形は
   **常に別命題**として扱う。「MEMORY.md はコミットしない」と「〜コミットする」を
   マージしてはならない。
3. **識別子ゲート**: ファイル名・コマンド・設定キー等の識別子集合を抽出し、
   Jaccard係数で一致度を測る。識別子が十分重なる場合のみ低い閾値
   (`MEMORY_SIMILARITY_SAME_IDENTIFIERS = 0.6`)を使い、識別子が食い違う場合は
   高い閾値(`_DIFFERENT_IDENTIFIERS = 0.85`)、識別子が無い散文は `_NO_IDENTIFIERS = 0.75`
   を使う。これにより `MEMORY.md` と `LESSONS.md` のように文面がほぼ同じで対象が違う規則は
   分離される。
4. **文字trigramのJaccard類似度**で最終判定する。長さが極端に違う候補は先に落とす。
5. 走査は同一スコープの最大 `MEMORY_DUPLICATE_SCAN_LIMIT`(3,000)件まで。

実データ(1セッション634件)での検証では 634 → 363 件(271件マージ)となり、
目視サンプルで誤マージは0件だった。

`memory_add`(MCP)は重複を検出した場合、新規作成せず既存行を `duplicate: true` を付けて返す。

### 既存重複の整理

旧バージョンで書かれたDBには近似重複が残る(実測: 2,813行中1,104行=39.2%が統合可能)。
`consolidateDuplicateMemories({ workspaceId, dryRun })` がスコープ単位でこれを整理する。

- **自動実行しない**。記憶の削除は明示操作に限る。API は `dryRun` を既定 `true` とし、
  削除には `dryRun: false` の明示指定が必要。UI は「重複を整理」ボタンで
  ドライラン→件数提示→確認ダイアログ→削除の二段階にする。
- 残す行(survivor)は各クラスタの**最古**の行。ただし承認済みの行があればそれを優先する
  (ユーザーが承認した行を黙って消さない)。
- survivor は クラスタの `use_count` 合計と最新の `last_used_at` を引き継ぐ。
  使用実績を削除行と一緒に捨てない。
- 削除は1トランザクションで行い、各行に `detail='consolidate into=<id>'` の監査ログを残す。
- 判定は挿入時と同一の `memorySimilarityVerdict` を使う。したがって極性ガードにより
  否定形と肯定形は統合されない。

通常会話のassistant完了イベントとgoal完了が同じメッセージを指す場合は、同じ台帳のclaimを
共有して一度だけ抽出する。抽出成功後はidleの一回限りフォールバックも完了扱いにする。

抽出プロンプトには「コードやファイル内容の引用禁止。将来も有効な命題のみ」という制約を入れる。

## 注入

OpenCode の `message` API はシステム文脈の上書きを許さないため、先頭ユーザーメッセージに
プレフィックスを付与して注入する。送信は goal-loop が使用するものと同一のメッセージ送信経路
から行う。通常セッションの `prompt_async` では、検証済みディレクトリとworkspaceが
一意に対応する場合に限り、`(workspace_id, session_id)` ごとに一度だけ注入する。
複数workspaceに一致する、またはディレクトリが一致しないセッションは注入しない。

```
<workspace-memory>
- (承認済み記憶を最大8件、出所付きで各1行)
</workspace-memory>
```

選択は `memoryInjectionFor(workspaceId, query?)`。`query` があるときはFTSの関連度順で選び、
足りない分を最近更新順で埋める。`query` がないときのみ `use_count` 降順にフォールバックする。

`use_count` 降順のみで選ぶv1の方式は、一度注入された行が使用回数を増やし続けて
上位8枠を占有する rich-get-richer になっていた(実測: 2,356件中2,271件が `use_count = 0`)。
goal loop は `goal` テキストを `query` として渡す。

- 注入された行の `use_count` を+1する。
- **このプレフィックスは OpenCode が受信したメッセージとしてトランスクリプトに永続化される**
  (受信メッセージは保存されるため)。「履歴に残らない」という設計は成立しない。
  そのため UI 側はメッセージ表示時に `<workspace-memory>` ブロックを除外して描画する
  (表示前変換。既存の PartView 描画経路に新規フックとして追加する。
  `web/src/lib/message-parts.ts` は画像パーツ専用のため再利用しない)。
  除外漏れ防止の単体テストを必須とする。

## API(Web側)

すべて `api-guard.ts` の `requireAuthorized` + CSRF防御(既存パターン)を通す。
新規 route は `api-guard-coverage.test.ts` の走査対象に入るため、実装後に `npm run test`
全体を実行してガード漏れを検出する。

| メソッド / パス | 意味 |
| --- | --- |
| `GET /api/memory?workspace_id=&approved=&kind=` | `workspace_id` 必須。返るのは解決後スコープ(通常はプロジェクト)の一覧 |
| `POST /api/memory/:id/approve` | `workspaceId`, `expectedRevision`一致時に承認(`approved=1`) |
| `PATCH /api/memory/:id` | `workspaceId`, `expectedRevision`一致時に内容・種別編集 |
| `DELETE /api/memory/:id?workspace_id=&expected_revision=` | workspace/revision一致時に削除 |
| `POST /api/memory/extract` | 手動抽出(対象セッションid指定) |
| `GET /api/memory/extractions?workspace_id=&limit=&unread_only=` | 抽出履歴と未読件数 |
| `POST /api/memory/extractions/read` | 指定workspaceの抽出履歴を既読化 |
| `POST /api/memory/consolidate` | 既存の近似重複を整理。`dryRun` 既定true(件数のみ返す) |

revision不一致は `409 Conflict` として現在の行を返す。これにより複数セッションの
管理UI/MCPが古い表示内容で上書きしない。

承認・削除・抽出は `audit-log.js` 相当のWeb側監査(既存pattern)に記録する。

## UI

`/settings/memory` ページ(既存設定ビューのセクション追加):

- メモリがプロジェクト単位で共有される旨の明示(ワークスペース選択は対象プロジェクトの指定)。
- 「保存前に確認する」トグル(`memory.write_approval`)。既定OFFは脅威検査通過後に自動保存、ONは全書き込みを候補として保存。
- 一覧テーブル(種別・内容・出所・作成日・使用回数)。承認済み/候補のタブ切替。
- 候補タブ: 一括承認 / 個別承認 / 却下。却下は行削除(却下理由はv2)。
- 編集はインラインテキストエリア。種別はドロップダウン。
- 「今すぐ抽出」ボタン(`POST /api/memory/extract`)。
- 「重複を整理」ボタン。ドライラン件数を確認ダイアログで提示し、承諾後に削除する。
- 抽出履歴: 未読件数バッジ、トリガー・状態・件数・失敗理由を表示し、「すべて既読」で通知を消す。

## テスト

- `memory-layer.test.ts`(vitest): マイグレーション、CRUD、FTS同期、
  「未承認は検索に出ない」不変条件、重複スキップ。
- スコープ: 同一プロジェクトの別ワークスペースから見える / 別プロジェクトからは見えない・
  編集も削除もできない、`deleteWorkspace` でプロジェクトスコープの行が残る、
  旧行のスコープと `norm_key` がbackfillされる。
- 重複判定(`memory-key.test.ts`): 正規化キー、極性ガード(否定はマージしない)、
  識別子ゲート(対象ファイルが違う規則は分離)、閾値、長さ差による早期棄却。
- 差分抽出: `messagesAfter` / `lastMessageId` の境界、差分0で実行を作らない、
  `ALREADY STORED` 節の生成、1回あたり件数上限、クールダウン中はスキップし経過後は実行。
- 既存重複の整理: ドライランは書き込まない、`use_count` 引き継ぎ、承認済み優先の survivor 選択、
  否定形は統合しない、二回目の実行が no-op、UI の二段階確認(キャンセルで削除しない)。
- 抽出履歴: 実行状態・件数・未読件数・既読化、履歴API、設定画面の通知表示を検証する。
- MCPサーバーは `browser-bridge/test/mcp-stdio.test.mjs` と同型のstdio統合テスト。
- 注入は送信経路の単体テスト(プレフィックスが付く / トランスクリプトに永続化される /
  UI描画でブロックが除外される / 件数上限)。

## 実装順序

1. DBテーブル+FTS+テスト
2. API+監査
3. MCPサーバー+インストールスクリプト
4. 自動抽出（通常assistant完了イベント・`goal-completed`・注入）
5. UI
6. `idle` トリガー
7. v2: プロジェクトスコープ化・差分抽出+クールダウン・近似重複判定・関連度注入
