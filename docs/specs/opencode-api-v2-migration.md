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

---

## Phase B 詳細設計 (2026-08-12)

### B-1. 操作の分類

#### v2 移行対象（v2 等価物が存在する操作）

| 操作 | v1 パス（現状） | v2 パス（移行先） | 備考 |
|------|----------------|------------------|------|
| セッション一覧 | `GET /session` | `GET /api/session` | レスポンス形状差あり（B-4 で後述） |
| セッション作成 | `POST /session` | `POST /api/session` | body 形状差あり（B-5 で後述） |
| セッション取得 | `GET /session/{id}` | `GET /api/session/{id}` | レスポンス形状差あり |
| プロンプト送信 | `POST /session/{id}/prompt_async` | `POST /api/session/{id}/prompt` | body 形状が大きく異なる（B-5 で後述） |
| トランスクリプト | `GET /session/{id}/message` | `GET /api/session/{id}/message` | レスポンス形状差あり |
| 中断 | `POST /session/{id}/abort` | `POST /api/session/{id}/interrupt` | 名称変更、body なし |
| コンテキスト圧縮 | `POST /session/{id}/summarize` | `POST /api/session/{id}/compact` | body あり→なし、セマンティクス差あり |
| 権限要求一覧 | `GET /permission` | `GET /api/session/{id}/permission` + `GET /api/permission/request` | セッションスコープ化 |
| 権限応答 | `POST /session/{id}/permissions/{pid}` | `POST /api/session/{id}/permission/{rid}/reply` | レジストリ済み |
| 質問一覧 | `GET /question` | `GET /api/session/{id}/question` + `GET /api/question/request` | セッションスコープ化 |
| 質問応答 | `POST /question/{rid}/reply` | `POST /api/session/{id}/question/{rid}/reply` | レジストリ済み |
| 質問拒否 | `POST /question/{rid}/reject` | `POST /api/session/{id}/question/{rid}/reject` | レジストリ済み |
| リバート | `POST /session/{id}/revert` | `POST /api/session/{id}/revert/stage` + `/commit` + `/clear` | 3 エンドポイントに分割 |
| SSE ストリーム | `GET /event` | `GET /api/event` または `GET /api/session/{id}/event` | セッションスコープ版あり |
| エージェント切替 | （v1 になし） | `POST /api/session/{id}/agent` | v2 新設 |
| モデル切替 | （v1 になし） | `POST /api/session/{id}/model` | v2 新設 |
| 履歴 | （v1 になし） | `GET /api/session/{id}/history` | v2 新設 |

#### v1 維持（v2 等価物が存在しない操作）

| 操作 | v1 パス | 理由 | 将来対応 |
|------|---------|------|----------|
| セッション状態一覧 | `GET /session/status` | v2 `/api/session/active` は形状が異なる（`SessionStatus` マップではない） | BFF 形状変換で対応可能だが、`summary` フィールド欠如のため要検討 |
| todo | `GET /session/{id}/todo` | v2 に等価なし | SSE `todo.updated` で代替検討 |
| 差分 | `GET /session/{id}/diff` | v2 に等価なし | BFF の `git diff` で代替済み |
| コマンド | `POST /session/{id}/command` | v2 に等価なし | v2 追加待ち |
| 子セッション一覧 | `GET /session/{id}/children` | v2 に等価なし | `/api/session/active` の `parentID` フィルタで代替検討 |
| セッション削除 | `DELETE /session/{id}` | v2 `DELETE /api/session/{id}` なし | v2 追加待ち |
| 要約（旧） | `POST /session/{id}/summarize` | v2 `compact` は body 形状が異なる | `compact` へ移行 |
| フォーク | `POST /session/{id}/fork` | v2 に等価なし | v2 追加待ち |
| 共有 | `POST/DELETE /session/{id}/share` | v2 に等価なし | v2 追加待ち |
| 初期化 | `POST /session/{id}/init` | v2 に等価なし | ブロック対象 |
| シェル | `POST /session/{id}/shell` | v2 に等価なし | ブロック対象 |
| リバート取消 | `POST /session/{id}/unrevert` | v2 に等価なし | `revert/clear` で代替可能か検討 |
| メッセージ部分編集 | `DELETE/PATCH /session/{id}/message/{mid}/part/{pid}` | v2 に等価なし | v2 追加待ち |
| 権限ルール書き込み | `PATCH /session/{id}` | v2 に PATCH なし | `POST /api/session/{id}/permission` で代替（B-6 で後述） |

### B-2. `opencode-paths.ts` の拡張設計

#### 追加する v2 パステンプレート

```ts
export const OC_PATH_TEMPLATES = {
  // --- v1: sessions（既存・維持） -----------------------------------------
  sessionList: "/session",
  sessionStatus: "/session/status",
  session: "/session/{sessionID}",
  sessionMessage: "/session/{sessionID}/message",
  sessionTodo: "/session/{sessionID}/todo",          // v1 維持
  sessionDiff: "/session/{sessionID}/diff",           // v1 維持
  sessionAbort: "/session/{sessionID}/abort",         // v1 維持（interrupt と分離）
  sessionPromptAsync: "/session/{sessionID}/prompt_async", // v1 維持（prompt と分離）
  sessionCommand: "/session/{sessionID}/command",     // v1 維持
  sessionPermissionReply: "/session/{sessionID}/permissions/{permissionID}",
  sessionSummarize: "/session/{sessionID}/summarize", // v1 維持
  sessionChildren: "/session/{sessionID}/children",   // v1 維持
  sessionFork: "/session/{sessionID}/fork",            // v1 維持
  sessionShare: "/session/{sessionID}/share",          // v1 維持
  sessionInit: "/session/{sessionID}/init",            // v1 維持（ブロック対象）
  sessionShell: "/session/{sessionID}/shell",           // v1 維持（ブロック対象）
  sessionRevert: "/session/{sessionID}/revert",         // v1 維持
  sessionUnrevert: "/session/{sessionID}/unrevert",     // v1 維持
  sessionPartEdit: "/session/{sessionID}/message/{messageID}/part/{partID}", // v1 維持

  // --- v1: global permission / question（既存・維持） --------------------
  permissionList: "/permission",
  questionList: "/question",
  questionReply: "/question/{requestID}/reply",
  questionReject: "/question/{requestID}/reject",

  // --- v1: misc -----------------------------------------------------------
  event: "/event",

  // --- v2 (beta): session-scoped permission / question（既存） ------------
  v2SessionPermissionList: "/api/session/{sessionID}/permission",
  v2SessionPermissionReply: "/api/session/{sessionID}/permission/{requestID}/reply",
  v2SessionQuestionList: "/api/session/{sessionID}/question",
  v2SessionQuestionReply: "/api/session/{sessionID}/question/{requestID}/reply",
  v2SessionQuestionReject: "/api/session/{sessionID}/question/{requestID}/reject",

  // --- v2: 新規追加（Phase B 移行対象） -----------------------------------
  v2SessionList: "/api/session",
  v2Session: "/api/session/{sessionID}",
  v2SessionPrompt: "/api/session/{sessionID}/prompt",
  v2SessionMessage: "/api/session/{sessionID}/message",
  v2SessionInterrupt: "/api/session/{sessionID}/interrupt",
  v2SessionCompact: "/api/session/{sessionID}/compact",
  v2SessionEvent: "/api/session/{sessionID}/event",
  v2SessionHistory: "/api/session/{sessionID}/history",
  v2SessionContext: "/api/session/{sessionID}/context",
  v2SessionAgent: "/api/session/{sessionID}/agent",
  v2SessionModel: "/api/session/{sessionID}/model",
  v2SessionActive: "/api/session/active",
  v2Event: "/api/event",
  v2PermissionRequest: "/api/permission/request",
  v2PermissionSaved: "/api/permission/saved",
  v2PermissionSavedDelete: "/api/permission/saved/{id}",
  v2QuestionRequest: "/api/question/request",
  v2SessionRevertStage: "/api/session/{sessionID}/revert/stage",
  v2SessionRevertCommit: "/api/session/{sessionID}/revert/commit",
  v2SessionRevertClear: "/api/session/{sessionID}/revert/clear",
} as const satisfies Record<string, keyof OcPaths>;
```

#### 追加する v2 ビルダー関数

```ts
// --- v2: session -----------------------------------------------------------

/** v2: `GET` / `POST` to create or list sessions. */
export const SESSION_LIST_PATH_V2: string = OC_PATH_TEMPLATES.v2SessionList;

/** v2: list active sessions (replaces /session/status with shape transform). */
export const SESSION_ACTIVE_PATH_V2: string = OC_PATH_TEMPLATES.v2SessionActive;

/** v2: `GET` a single session. */
export function sessionPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}`;
}

/** v2: send a prompt (replaces prompt_async). */
export function sessionPromptPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/prompt`;
}

/** v2: get transcript (replaces /session/{id}/message). */
export function sessionMessagePathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/message`;
}

/** v2: interrupt (replaces /session/{id}/abort). */
export function sessionInterruptPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/interrupt`;
}

/** v2: compact context (replaces /session/{id}/summarize). */
export function sessionCompactPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/compact`;
}

/** v2: session-scoped SSE stream. */
export function sessionEventPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/event`;
}

/** v2: session history. */
export function sessionHistoryPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/history`;
}

/** v2: session context (transcript with parts). */
export function sessionContextPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/context`;
}

/** v2: switch agent. */
export function sessionAgentPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/agent`;
}

/** v2: switch model. */
export function sessionModelPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/model`;
}

// --- v2: revert（3 エンドポイント分割） ------------------------------------

export function sessionRevertStagePathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/revert/stage`;
}

export function sessionRevertCommitPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/revert/commit`;
}

export function sessionRevertClearPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/revert/clear`;
}

// --- v2: global permission / question queues -------------------------------

export const PERMISSION_REQUEST_PATH_V2: string = OC_PATH_TEMPLATES.v2PermissionRequest;
export const QUESTION_REQUEST_PATH_V2: string = OC_PATH_TEMPLATES.v2QuestionRequest;
export const PERMISSION_SAVED_PATH_V2: string = OC_PATH_TEMPLATES.v2PermissionSaved;

// --- v2: SSE stream --------------------------------------------------------

export const EVENT_PATH_V2: string = OC_PATH_TEMPLATES.v2Event;
```

#### 設計原則

1. **v1 と v2 のビルダーを明示的に分離**: `sessionPath` と `sessionPathV2` は別関数。暗黙の切替をしない。呼び出し側が明示的に v2 を選択する
2. **v1 ビルダーは残存**: v1 維持操作（todo/diff/command/children/fork/share/init/shell/revert/unrevert/partEdit）は v1 ビルダー経由のまま
3. **`...PathV2` 命名規則**: 既存の `permissionReplyPathV2` / `sessionPermissionListPathV2` に準拠。新しいビルダーも `...PathV2` サフィックスで統一
4. **`OC_PATH_TEMPLATES` の `satisfies` 検証**: 新規 v2 エントリも `keyof OcPaths` でコンパイル時検証。openapi.json に存在しないパスを追加すると tsc エラー
5. **`encodePathId` 共通利用**: v2 ビルダーも `assertSafeOpenCodeSessionId` 経由で id 検証。`openCodeSessionPath` の `/session/` プレフィックスを使わず、`/api/session/` プレフィックスを直接構築

### B-3. BFF `/api/opencode` プレフィックスと二重 `/api` 問題の解決方針

#### 問題

現在のブラウザ→BFF 経路:

```
Browser → /api/opencode/{enginePath} → BFF (app/api/opencode/[...path]/route.ts)
                                    → fetch(OPENCODE_BASE_URL + "/" + enginePath)
```

`client.ts:ocJson()` は `/api/opencode${path}` を構築。`path` が v2 の `/api/session/{id}/prompt` の場合:

```
Browser fetch: /api/opencode/api/session/{id}/prompt
BFF catch-all: pathname = "/api/session/{id}/prompt"
BFF upstream:  http://127.0.0.1:4096/api/session/{id}/prompt
```

#### 結論: 二重 `/api` は問題なし

Next.js の `[...path]` catch-all は URL パス全体をセグメント配列として受け取る。`/api/opencode/api/session/{id}/prompt` の場合:

1. Next.js ルータ: `/api/opencode` がマウントポイント、残り `api/session/{id}/prompt` が `path` パラメータ
2. `route.ts`: `const pathname = "/" + segments.join("/")` → `pathname = "/api/session/{id}/prompt"`
3. `fetch(target)`: `new URL(pathname + search, OPENCODE_BASE_URL)` → `http://127.0.0.1:4096/api/session/{id}/prompt`
4. OpenCode エンジンは `/api/session/{id}/prompt` で応答（v2 パス）

**問題なし。** `/api/opencode` は BFF のマウントポイントであり、エンジンの `/api` とは独立。`[...path]` が `/api/session/...` を正しく捕捉する。

#### 検証済み

`opencode.ts:isBlockedOpencodeWrite` は既に v2 パス（`/api/pty`, `/api/session/{id}/shell` 等）の正規表現を保持しており、`/api/opencode/api/...` 経由でも `resolvedOpenCodePathname` が `/api/...` に正規化されるためブロックリストが機能する。

#### 注意点

1. **`assertSafeOpenCodePath`**: `/api/session/...` の最初のセグメント `api` は `SAFE_OC_SESSION_ID` に一致しないが、`assertSafeOpenCodePath` はパス全体の走査安全性のみ検証し、セグメント名を制限しないため問題なし
2. **`manualSendSessionId` / `hangWatchSessionId` 等の正規表現**: 現在 `/session/([^/]+)/...` にマッチ。v2 パス `/api/session/([^/]+)/...` にはマッチしないため、Phase C で正規表現を `(?:\/api)?\/session\/...` 形式に拡張が必要
3. **`isImageGuardedWrite` / `isLongRunningSyncMutation`**: 同様に v2 パスを含めるよう正規表現拡張が必要（Phase C）

### B-4. レスポンス形状変換レイヤー

v2 はレスポンスを `{ data: T }` でラップする。v1 は `T` を直接返す。クライアントコードの大規模改修を避けるため、BFF プロキシで形状変換を行う。

#### 変換方針

```
v2 response:  { "data": SessionV2Info | SessionV2Info[] | ... }
                ↓ BFF unwrap
v1-compatible: SessionV2Info | SessionV2Info[] | ...
```

**実装箇所**: `app/api/opencode/[...path]/route.ts` の `proxy()` 関数。v2 パスからのレスポンスボディを JSON としてパースし、`data` フィールドを抽出してクライアントへ返す。

**条件判定**: `pathname.startsWith("/api/")` で v2 パスと判定。ただし SSE（`text/event-stream`）はボディ変換しない。

**リスク**: `data` フィールドの有無をエンジン側で保証しているか要確認。OpenAPI では v2 全レスポンスが `{ data: ... }` 形状だが、エラーレスポンス（400/401/404）は `{ error: ... }` 形状のため、ステータスコードで分岐が必要。

### B-5. リクエスト body 形状変換

#### プロンプト送信（最大の形状差）

| v1 `prompt_async` | v2 `prompt` |
|---------------------|-------------|
| `{ messageID, model: {providerID, modelID}, agent, parts: [{type:"text", text}...], variant, noReply, tools, format, system }` | `{ id: "msg_...", prompt: { text, files: [{uri, name, source}], agents: [{name, source}] }, delivery: "steer"\|"queue", resume: bool }` |

**変換方針**: BFF で v1 形状の body を受け取り、v2 形状に変換して upstream へ送信。

```ts
// BFF 内の変換例（概念）
function v1PromptToV2(v1Body: V1PromptBody): V2PromptBody {
  const textParts = v1Body.parts?.filter(p => p.type === "text") ?? [];
  const fileParts = v1Body.parts?.filter(p => p.type === "file") ?? [];
  const agentParts = v1Body.parts?.filter(p => p.type === "agent") ?? [];

  return {
    id: v1Body.messageID,
    prompt: {
      text: textParts.map(p => p.text).join("\n"),
      files: fileParts.map(p => ({ uri: p.url, name: p.filename, source: p.source })),
      agents: agentParts.map(p => ({ name: p.name, source: p.source })),
    },
    delivery: "steer",  // prompt_async は steer 相当
    // resume は省略（デフォルト false）
  };
}
```

**注意**: v1 の `model` / `variant` / `tools` / `format` / `system` / `noReply` は v2 `prompt` body に対応フィールドがない。これらは:
- `model` / `agent`: `POST /api/session/{id}/model` / `POST /api/session/{id}/agent` で事前切替
- `variant` / `tools` / `format` / `system` / `noReply`: **v2 に等価なし。** セッション作成時にエージェント設定で指定するか、v2 での追加を待つ

#### セッション作成

| v1 `POST /session` | v2 `POST /api/session` |
|---------------------|------------------------|
| `{ parentID, title, agent, model: {id, providerID, variant}, metadata, permission, workspaceID }` | `{ id?, agent, model, location: { path, projectID? } }` |

**変換方針**: BFF で v1 形状 → v2 形状に変換。

- `model: {id, providerID, variant}` → `model: { providerID, modelID: model.id }`（`ModelRef` 形状）
- `permission: PermissionRuleset` → セッション作成後に `POST /api/session/{id}/permission` で各ルールを注入（B-6 で後述）
- `title` / `metadata` / `workspaceID` → v2 に対応フィールドなし。**v2 追加待ち** または別 API で設定
- `location.path` は directory パラメータから設定

### B-6. `PATCH /session/{id}` 権限ルール書き込みの代替実装

#### 現状の用途

`opencode-access-mode.ts` / `opencode-skill-permission.ts` / `opencode-task-permission.ts` が `PATCH /session/{id}` で `PermissionRuleset`（`PermissionRule[]`）を一括書き込み。各ルールは:

```ts
type PermissionRule = {
  permission: string;  // tool 名等
  pattern: string;      // リソースパターン
  action: "allow" | "deny" | "ask";
}
```

#### v2 代替フロー

```
1. POST /api/session でセッション作成
2. PermissionRuleset の各 Rule ごとに:
   POST /api/session/{id}/permission {
     action: rule.action,       // "allow" | "deny" | "ask"
     resources: [rule.pattern],  // pattern を resources 配列へ
     save: [rule.permission],   // 永続化する場合は save へ
     metadata: { source: "webui-access-mode" }
   }
3. 応答の effect が期待通りであることを確認
```

#### BFF 形状互換性レイヤー

クライアント（`opencode-access-mode.ts` 等）は従来通り `PATCH /session/{id}` 形状で BFF へ送信。BFF が:

1. `PATCH /session/{id}` リクエストをインターセプト
2. body の `permission` フィールド（`PermissionRuleset`）を抽出
3. 各 `PermissionRule` を `POST /api/session/{id}/permission` へ展開（N 回呼び出し）
4. 全結果を集約してクライアントへレスポンス

**実装箇所**: `app/api/opencode/[...path]/route.ts` の `proxy()` 内。`isSessionPermissionWrite` 判定で `PATCH /session/{id}` を検出した場合、v2 展開ロジックへ分岐。

**エラーハンドリング**: N 回呼び出しの一部が失敗した場合、成功分は反映済みのため部分成功を返すか、全体をロールバックするか要設計。推奨: 部分成功を 207 Multi-Status で返す。

#### `assertSafeOpenCodeSessionId` 厳格検証の載せ替え

既存テスト（`/session/ses%2Fweird%20id` を期待）は percent-encode のみ通す契約。v2 ビルダーは `assertSafeOpenCodeSessionId` で throw するため、これを載せ替えると挙動が変わる。

**方針**: `PATCH /session/{id}` の代替ロジックは BFF 内で完結し、クライアントは従来通り v1 パスへ送るため、`assertSafeOpenCodeSessionId` 厳格検証の影響を受けない。v2 `POST /api/session/{id}/permission` の呼び出しは BFF 内部（`ocServer` 経由）で行い、id は BFF が管理するため安全。

### B-7. 実装ステップ（Phase B の実行順序）

1. **`opencode-paths.ts` 拡張**
   - v2 パステンプレート追加（`OC_PATH_TEMPLATES`）
   - v2 ビルダー関数追加（`...PathV2` シリーズ）
   - `opencode-paths.test.ts` に v2 ビルダーの期待値テスト追加

2. **`opencode-events.ts` 確認**
   - v1 廃止予定イベントが v2 で置換されているか確認
   - `session.next.*` の v2 ストリーミングイベントが `opencode-events.test.ts` で検証済みであることを確認

3. **型再生成・ドリフト検知**
   - `npm run gen:types` → `opencode-schema.d.ts` 再生成
   - `npx tsc --noEmit` → 新規 v2 テンプレートが `satisfies` を通過することを確認
   - `npx vitest run opencode-paths.test.ts opencode-events.test.ts opencode-schema-freshness.test.ts`

4. **BFF プロキシ拡張（Phase C へ引継ぎ）**
   - `route.ts` の正規表現を v2 パス対応へ拡張
   - レスポンス形状変換レイヤー追加
   - リクエスト body 形状変換レイヤー追加
   - `PATCH /session/{id}` → v2 権限展開ロジック追加

5. **クライアント側の切替（Phase C へ引継ぎ）**
   - `useSessionStream.ts` / `goal-loop.ts` / `hang-watchdog.ts` / `task-service.ts` / `memory-extract.ts` / `workflow-scheduler.ts` / `collaboration-context.ts` / `qwen-native-vision.ts` の v1 ビルダー呼び出しを v2 ビルダーへ切替
   - v1 維持操作（todo/diff/command/children 等）は v1 ビルダーのまま

### B-8. v1+v2 ハイブリッド運用の制約

1. **同一セッションで v1 と v2 を混用しない**: セッション作成を v2 で行った場合、以降の操作も v2 で統一。v1 で作成したセッションは v1 で統一。これはエンジン内部のセッション状態管理世代が一致することを保証するため
2. **SSE ストリームは混用可能**: `useSessionStream.ts` は既に v1+v2 イベントを同一ストリームで処理している。`/event` と `/api/event` は両方の世代のイベントを送出するため、移行期は現状 `/event` で両方受信し続ける
3. **`/session/status` は当面 v1 維持**: `SessionStatus` マップの形状互換性が BFF で保証できないため、v2 `/api/session/active` への切替は別途検討

---

## Phase D 実装状況と設定タブ (2026-08-12)

### 実装済み（Phase D）

`web/src/lib/opencode-generation.ts` の `OPENCODE_API_GENERATION` 定数と
`opencode-paths.ts` のアクティブセレクタ（`active*Path`）で、v2 移行対象操作の
クライアント呼び出しを一元化した。詳細は git ログ（コミット `b2f7aa7`）参照。

### 設定タブからの切替（本節）

エンジンタブ（`SettingsView.tsx` の `engine`）に「API 世代」カードを追加し、
v1 / v2 のラジオで切り替えられるようにした。

| 層 | 実体 | 役割 |
|----|------|------|
| localStorage | `webui:opencode-api-generation` | ブラウザの同期ソース。`isV2ApiGeneration()` がリアルタイム参照するため切替が即時反映 |
| サーバ settings 表 | `opencode-api-generation` | `/api/settings/opencode-api-generation` 経由の耐久コピー。他ブラウザで共有 |
| デフォルト | `DEFAULT_OPENCODE_API_GENERATION = "v1"` | サーバ側（`window` なし）と未設定時の値 |

設定 API は `web/src/app/api/settings/[key]/route.ts` の allowlist に
`opencode-api-generation` を追加し、`isOpenCodeApiGeneration` で `v1`/`v2` のみ許可。

### 既知の制約（要検討）

1. ~~**クライアントとサーバで世代がずれる**~~ **解決済み (2026-08-12)**:
   サーバ側コード（`goal-loop.ts` / `hang-watchdog.ts` 等の `ocServer` 呼び出し）
   の世代判定は、`instrumentation.ts` がサーバ起動時に登録するリゾルバ
   （`opencode-generation-server.ts` → `getSetting("opencode-api-generation")`）
   を経由して設定 DB を参照する。ブラウザが設定タブで v2 を選ぶと
   `/api/settings/opencode-api-generation` に保存され、サーバ側の自動ループ等も
   同じ v2 パスを使うため、**同一セッションでの v1/v2 混在は解消された**。
   - 実装: `opencode-generation.ts` の `registerServerOpenCodeApiGenerationResolver`
     にサーバリゾルバを注入。`readOpenCodeApiGeneration()` はサーバでリゾルバを
     呼び、設定 DB の値に追従する。
   - 注意: 設定 DB は同期参照のため、設定変更は即時にサーバ側へ反映される。
2. **`/session/status` と todo/diff/command は v1 のまま**: これらは v2 等価物が
   ないため、世代フラグに関係なく v1 パスを使う。v2 フラグ時も `/session/status`
   で状態取得する。
3. **revert の v2 は stage → commit 2 段階**: `SessionActions.revertMessage` は
   v2 フラグ時に `POST /api/session/{id}/revert/stage` → `/commit` を連続呼び出し。
   partID レベルの revert は v2 に等価物がないため v2 時は省略される。
