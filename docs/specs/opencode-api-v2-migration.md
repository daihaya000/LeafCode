# OpenCode エンジン API v2 (beta) への移行準備

## 背景

OpenCode エンジンは現在 **2 世代の API を同時に公開**している。

- **v1** — 元々のフラットな面。`/session`, `/session/{id}/message`,
  `/permission/{id}/reply` など。
- **v2 (beta)** — `/api/*` の面。`/api/session/{id}/prompt`,
  `/api/session/{id}/permission/{requestID}/reply` など。SSE も
  `session.next.*` という細粒度のストリーミングイベントを持つ。

WebUI は **どちらか一方ではなく両方を使っているハイブリッド**である。
「v1 のみを使っている」と読み違えると移行規模の見積もりを誤るため、
現状を表に固定しておく。

> 用語の注意: コード中の `permission.v2.asked` / `question.v2.asked` や
> `PermissionRequest.version: "v1" | "v2"` は、この API 世代と**同じもの**を
> 指す。一方 `SessionStatus.type` の `"busy"`/`"idle"` や `Part.type` の
> `"text"`/`"tool"` は世代とは無関係な別の列挙である。

## 現状の API サーフェス

| 領域 | 使用世代 | パス / イベント |
|------|----------|-----------------|
| セッション作成・一覧 | v1 | `POST` / `GET /session` |
| プロンプト送信 | v1 | `POST /session/{id}/prompt_async` |
| セッション状態 | v1 | `GET /session/status` |
| トランスクリプト / todo / diff / abort / command | v1 | `/session/{id}/{message,todo,diff,abort,command}` |
| パーミッション・質問の一覧 | v1 と v2 の**両方**を取得してマージ | `/permission`・`/question` + `/api/session/{id}/{permission,question}` |
| パーミッション・質問への応答 | 要求元の世代に追従 | v1: `/session/{id}/permissions/{id}`・`/question/{id}/reply`<br>v2: `/api/session/{id}/…/reply` |
| SSE ストリーム | v1 と v2 を**同一ストリーム**で処理 | `message.part.updated` 等 + `session.next.*`（`text.delta` / `tool.input.delta` / `tool.called` / `tool.success` …） |
| セッション単位の権限ルール | v1 | `PATCH /session/{id}` |

一覧・応答・SSE が既に v2 を扱えているのは、エンジンのバージョンによって
どちらの世代が有効かが変わるため。片方が 404 でも他方で機能するよう
フェイルセーフに書かれている。

## 移行に備えて導入した仕組み

| 仕組み | 実体 | 何を守るか |
|--------|------|-----------|
| パスレジストリ | `web/src/lib/opencode-paths.ts` | エンジンのパス文字列を 1 箇所に集約。v2 への切り替えはビルダー 1 行の変更で済む |
| REST のコンパイル時ドリフト検知 | 同ファイルの `OC_PATH_TEMPLATES ... satisfies Record<string, keyof OcPaths>` | 型再生成後、エンジンから消えた／改名されたエンドポイントが **`tsc` エラー**になる（実行時 404 で気付く事態を防ぐ）。TypeScript は正しい候補名まで提示する |
| SSE イベントレジストリ | `web/src/lib/opencode-events.ts` | 購読しているイベント型を宣言し、世代（v1/v2）を分類する |
| SSE のドリフト検知 | `web/src/lib/opencode-events.test.ts` | 宣言したイベントが生成スキーマから消えたらテストが落ちる。`useSessionStream.ts` が比較しているリテラルがレジストリ未登録の場合も落ちる |
| 生成物の鮮度チェック | `web/src/lib/opencode-schema-freshness.test.ts` | `opencode-schema.d.ts` のパス集合が `docs/opencode/openapi.json` と一致することを検証。上 2 つの保証が**古い生成物の上で空回りする**のを防ぐ |

## エンジンを上げるときの手順

1. `docs/opencode/openapi.json` を新しい `GET /doc` の出力で更新し、
   `docs/opencode/VERSION` を新しいバージョン文字列に書き換える。
2. `web/` で `npm run gen:types` を実行し、`opencode-schema.d.ts` を再生成する。
3. `npx tsc --noEmit`
   … 消えた REST パスがあれば `opencode-paths.ts` の該当行でエラーになる。
4. `npx vitest run src/lib/opencode-events.test.ts src/lib/opencode-schema-freshness.test.ts`
   … 消えた SSE イベントと、生成物の取り残しを検出する。
5. 検出された差分ごとに v2 の対応エンドポイントへ載せ替える。
   `opencode-paths.ts` にはすでに v2 用のビルダー命名規則
   （`...PathV2` / `v2...` テンプレート名）があるので、それに揃える。

## 意図的に未移行として残している箇所

`opencode-access-mode.ts` / `opencode-skill-permission.ts` /
`opencode-task-permission.ts` の `PATCH /session/{id}`
（セッション単位の権限ルール書き込み）はレジストリを経由していない。

理由:

- これらは他と異なり、**セッション id を厳格検証せず percent-encode のみ**で
  通す契約を既存テスト（`/session/ses%2Fweird%20id` を期待）が固定している。
  レジストリのビルダーは不正 id で throw するため、載せ替えると挙動が変わる。
- v2 側の等価物は単純なパス差し替えでは済まない。保存済みパーミッションの
  API 形状（`/api/permission/saved`）が v1 のセッション ruleset と異なるため、
  移行時に個別設計が必要になる。

## 見送った案

- **Capability detection / フィーチャーフラグ**: v2 の最低必要バージョンが
  未確定で、切り替え先の実装も存在しないため、現時点では消費者のいない
  死にコードになる。v2 GA 時に、`/api/health` への probe ではなく既存の
  `HealthDto.opencode.version` を使ったバージョン判定として実装するのが安い。

---

## Phase A 調査結果 (2026-08-12)

### エンジン更新

| 項目 | 旧 | 新 |
|------|----|----|
| `docs/opencode/VERSION` | `1.17.11` | `1.18.14` |
| `docs/opencode/openapi.json` | 1.17.11 仕様 | 1.18.14 仕様（稼働 host の `GET /doc` から取得） |
| `opencode-schema.d.ts` | 旧型 | `npm run gen:types` で再生成済み |

検証:
- `npx tsc --noEmit` … 成功（v1 パスは openapi.json に残存のため `satisfies` 通過）
- `npx vitest run opencode-events.test.ts opencode-schema-freshness.test.ts` … 10/10 合格

### v2 API サーフェスの全体像

1.18.14 は v1（111 パス）と v2（51 パス）を併存公開している。完全移行には v1 専用で v2 等価物のない操作をどう扱うかが鍵。

### `/session/status` の v2 等価物

**特定済み:** `GET /api/session/active`

- v1 `GET /session/status` — `directory` / `workspace` クエリで絞り込み可能な `sessionID -> SessionStatus` マップ
- v2 `GET /api/session/active` — アクティブセッション一覧。`SessionV2Info` 配列を返す
- **形状差**: v1 は `Record<sessionID, SessionStatus>`、v2 は `{ data: SessionV2Info[] }`。`SessionV2Info` は `Session` とほぼ同じだが `summary` フィールド（additions/deletions/files/diffs）を持たない
- **移行対応**: BFF の `GET /api/session/status` プロキシを `SessionV2Info[]` → `Record<sessionID, SessionStatus>` 形状変換レイヤー経由にする。`summary` は別途 `GET /api/session/{id}` または差分 API で補完する設計が必要

### `PATCH /session/{id}` に代わる権限ルール書き込み API

**特定済み。v2 に PATCH 等価物は存在しない。** 以下の組み合わせで代替する:

| v1 操作 | v2 代替 | 備考 |
|--------|---------|------|
| `PATCH /session/{id}` body `permission: PermissionRuleset` | **該当 API なし** | セッション単位の ruleset 一括書き込みは v2 に廃止 |
| 同上（代替） | `POST /api/session/{id}/permission` | 単一 permission request 作成。`action` / `resources` / `save` を指定し `effect: "allow" / "deny" / "ask"` を受け取る |
| 保存済み権限の一覧 | `GET /api/permission/saved` | `PermissionSavedInfo[]`。`projectID` クエリでプロジェクト絞り込み |
| 保存済み権限の削除 | `DELETE /api/permission/saved/{id}` | |
| 保存済み権限の作成（POST/PUT） | **該当 API なし** | `POST /api/session/{id}/permission` の `save` フィールド経由で間接保存のみ |

**移行対応（設計必要）:**

1. `opencode-access-mode.ts` / `opencode-skill-permission.ts` / `opencode-task-permission.ts` の `PATCH /session/{id}` は、セッション作成時に ruleset を一括注入する用途。v2 では:
   - `POST /api/session` でセッション作成後
   - `POST /api/session/{id}/permission` を ruleset の各ルールごとに呼び出す（N 回コール）
   - または `save` を指定して `PermissionSaved` へ永続化
2. レジストリ経由の v2 ビルダーを新設し、既存テストの `assertSafeOpenCodeSessionId` 厳格検証契約を v2 ビルダー経由に載せ替える
3. **形状互換性レイヤー**を BFF に設ける検討: クライアントは `PermissionRuleset` 形状のまま BFFへ送り、BFF が各ルールを `POST /api/session/{id}/permission` へ展開する。これによりクライアント側コード変更を最小化

### v1 専用で v2 に等価物のない全パス（1.18.14 時点）

完全移行前に個別対応が必要:

| v1 パス | 用途 | v2 等価 | 対応方針 |
|---------|------|---------|----------|
| `GET /session/{id}/todo` | セッション todo | なし | SSE `todo.updated` イベントで代替、または v2 に追加されるまで v1 残存 |
| `GET /session/{id}/diff` | 作業差分 | なし | `GET /api/session/{id}/context` がトランスクリプトを返すが diff ではない。BFF で `git diff` を実行し代替 |
| `POST /session/{id}/command` | slash コマンド | なし | v2 に追加されるまで v1 残存 |
| `POST /session/{id}/abort` | 中断 | `POST /api/session/{id}/interrupt` | 名称変更。セマンティクス差は要確認 |
| `GET /session/{id}/children` | 子セッション一覧 | なし | `GET /api/session/active` を `parentID` でクライアント側フィルタ |
| `POST /session/{id}/summarize` | 要約 | なし | |
| `POST /session/{id}/fork` | 分岐 | なし | |
| `POST/DELETE /session/{id}/share` | 共有リンク | なし | |
| `POST /session/{id}/init` | 初期化 | なし | BFF の `isBlockedOpencodeWrite` でブロック対象 |
| `POST /session/{id}/shell` | シェル | なし | ブロック対象 |
| `POST /session/{id}/revert` | リバート | `POST /api/session/{id}/revert/{stage,commit,clear}` | 3 エンドポイントに分割 |
| `POST /session/{id}/unrevert` | リバート取消 | なし | |
| `POST /session/{id}/permissions/{permissionID}` | 権限応答 | `POST /api/session/{id}/permission/{requestID}/reply` | レジストリ済み |
| `DELETE/PATCH /session/{id}/message/{msgID}/part/{partID}` | 部分編集 | なし | |
| `POST /session/{id}/prompt_async` | 非同期プロンプト | `POST /api/session/{id}/prompt` | body 形状が大きく異なる（v1: `{parts, model, agent, ...}` → v2: `{prompt: PromptInput, id, delivery, resume}`）。BFF 形状変換レイヤー必須 |

### 結論

1. **完全 v2 移行はブロッカーあり**: todo / diff / command / children / fork / share / init / summarize / part編集 に v2 等価物がない。1.18.14 時点では v2 は完全スーパーセットではない
2. **段階移行を推奨**:
   - Phase B: レジストリで v2 等価物が存在する操作（session/prompt/permission/question/abort→interrupt/revert）を切替
   - 残存 v1 操作は v1 パスのまま維持し、v2 に追加された時点で切替
3. **`PATCH /session/{id}` 代替**は `POST /api/session/{id}/permission` への N 回展開（または `save` 経由）で実装。BFF 形状変換レイヤーでクライアント非互換を吸収
4. **`/session/status` 代替**は `/api/session/active` + BFF 形状変換で対応。`summary` 補完は別途検討
5. 次の OpenCode バージョンアップで v2 が完全スーパーセットになるまで、v1+v2 ハイブリッド運用を継続
