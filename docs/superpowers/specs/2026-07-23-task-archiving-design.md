# タスクアーカイブ機能 設計仕様書

## 目的

通常一覧の削除操作をアーカイブに変更し、データ・worktree・OpenCodeセッションを保持したままタスクを非表示にする。アーカイブ済みタスクはサイドバー常設のアーカイブ一覧からのみ操作可能とし、復元と完全削除を提供する。

## 用語

| 用語 | 定義 |
|------|------|
| アーカイブ | workspace.status を `"archived"` に設定。DB行・worktree・セッションは保持 |
| 復元 | workspace.status を `"active"` に戻す。タスクは通常一覧に再表示 |
| 完全削除 | 既存の `destroyWorkspace()` を呼び出し、worktree/コピー削除 + DB行削除 + OpenCodeセッション削除を実行 |

## 関連ファイル

### DB層 (`web/src/lib/db.ts`)

| 関数 | 役割 |
|------|------|
| `setWorkspaceStatus(id, "archived")` | 既存。アーカイブに使用 |
| `setWorkspaceStatus(id, "active")` | 既存。復元に使用 |
| `listWorkspacesByStatus("archived")` | 既存。アーカイブ一覧取得に使用 |
| `deleteWorkspace(id)` | 既存。完全削除に使用（binding + workspace行削除） |

変更不要。既存の関数で対応可能。

### タスクサービス (`web/src/lib/task-service.ts`)

| 関数 | 変更 |
|------|------|
| `listTasks()` | `workspaceStatus !== "archived"` のworkspaceのみ返すようフィルタ追加 |
| `listArchivedTasks()` | **新規**。`listWorkspacesByStatus("archived")` でworkspace一覧を取得し、`toTask()` で `TaskSummary` に変換して返す |

### タスクステータス (`web/src/lib/task-status.ts`)

変更不要。`workspaceStatus === "archived"` → `"merged"` のマッピングは既存。

### ワークスペースサービス (`web/src/lib/workspace-service.ts`)

| 関数 | 変更 |
|------|------|
| `archiveWorkspace(id)` | **新規**。`setWorkspaceStatus(id, "archived")` を呼び出し、`persistProjectSessions()` を実行。worktree/セッションは保持 |
| `restoreWorkspace(id)` | **新規**。`setWorkspaceStatus(id, "active")` を呼び出し、`persistProjectSessions()` を実行 |
| `destroyWorkspace(id)` | 既存。完全削除としてそのまま使用 |

### APIルート

| ルート | メソッド | 役割 |
|--------|---------|------|
| `PATCH /api/tasks/[id]/archive` | PATCH | タスクをアーカイブ。body不要。`archiveWorkspace(id)` を呼ぶ |
| `PATCH /api/tasks/[id]/restore` | PATCH | タスクを復元。body不要。`restoreWorkspace(id)` を呼ぶ |
| `DELETE /api/tasks/[id]` | DELETE | 既存。完全削除として維持。確認ダイアログ必須（フロントエンド側） |
| `GET /api/tasks/archived` | GET | **新規**。`listArchivedTasks()` を呼び、`{ tasks: TaskSummary[] }` を返す |

### サイドバー (`web/src/components/shell/Sidebar.tsx`)

| 変更箇所 | 内容 |
|----------|------|
| `removeTask()` | 削除ボタンの動作をアーカイブに変更。`PATCH /api/tasks/[id]/archive` を呼ぶ。確認ダイアログは削除（アーカイブは非破壊のため） |
| アーカイブ一覧セクション | プロジェクト一覧の下に常設セクションとして追加。`GET /api/tasks/archived` で取得したタスクを表示 |
| アーカイブ行の操作 | 各行に「復元」ボタンと「完全削除」ボタンを配置 |
| 完全削除の確認 | `window.confirm()` で確認。文言は既存の `removeTask()` の確認文言を流用 |
| 復元後の動作 | `notifyTasksChanged()` 発火 + `refresh()` で通常一覧とアーカイブ一覧を再取得 |

### テストファイル

| ファイル | 追加テスト |
|----------|-----------|
| `web/src/lib/task-service.test.ts` | `listTasks()` が archived を除外する、`listArchivedTasks()` が archived のみ返す |
| `web/src/lib/workspace-service.test.ts` | `archiveWorkspace()` が status を変更し worktree を保持、`restoreWorkspace()` が status を戻す |
| `web/src/app/api/tasks/[id]/route.test.ts` | `PATCH archive` と `PATCH restore` の動作 |
| `web/src/app/api/tasks/archived/route.test.ts` | **新規ファイル**。`GET /api/tasks/archived` の動作 |
| `web/src/components/shell/Sidebar.test.tsx` | アーカイブ一覧の表示、復元ボタン、完全削除ボタンの動作 |

## 状態遷移

```
  ┌──────────┐  アーカイブ(PATCH)   ┌───────────┐
  │  active   │ ──────────────────→  │ archived  │
  │           │ ←──────────────────  │           │
  └──────────┘   復元(PATCH)        └───────────┘
       │                                  │
       │ 完全削除(DELETE)                  │ 完全削除(DELETE)
       ↓                                  ↓
    (削除完了)                         (削除完了)
```

- `"merging"` 状態のタスクはアーカイブ不可（フロントエンドでボタン非表示）
- `"orphaned"` 状態のタスクは既存の「要復旧」リンクで対応。アーカイブ一覧には表示しない
- アーカイブからの完全削除は既存の `destroyWorkspace()` と同じ処理パス

## API詳細

### PATCH /api/tasks/[id]/archive

**リクエスト**: body不要

**成功レスポンス** (200):
```json
{ "ok": true }
```

**エラーレスポンス**:
- 404: `{ "error": "task not found" }`
- 409: `{ "error": "cannot archive a merging task" }`（workspace.status が "merging" の場合）

**実装**:
```typescript
export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ws = getWorkspace(id);
  if (!ws) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  if (ws.status === "merging") {
    return NextResponse.json(
      { error: "cannot archive a merging task" },
      { status: 409 },
    );
  }
  await archiveWorkspace(id);
  return NextResponse.json({ ok: true });
}
```

### PATCH /api/tasks/[id]/restore

**リクエスト**: body不要

**成功レスポンス** (200):
```json
{ "ok": true }
```

**エラーレスポンス**:
- 404: `{ "error": "task not found" }`（archived 以外の workspace も含む）

**実装**:
```typescript
export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ws = getWorkspace(id);
  if (!ws || ws.status !== "archived") {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  await restoreWorkspace(id);
  return NextResponse.json({ ok: true });
}
```

### GET /api/tasks/archived

**成功レスポンス** (200):
```json
{
  "tasks": [
    {
      "id": "ws1",
      "projectId": "prj1",
      "projectName": "Repo",
      "title": "Task title",
      "directory": "/repo",
      "isolation": "git_worktree",
      "status": "merged",
      "sessionId": "sess1",
      "branch": "main",
      "additions": 0,
      "deletions": 0,
      "filesChanged": 0,
      "cost": 0.1234,
      "agent": "build",
      "providerID": "anthropic",
      "modelID": "claude-opus",
      "createdAt": "2026-07-18T00:00:00Z",
      "updatedAt": "2026-07-18T01:00:00Z"
    }
  ]
}
```

`status` は `deriveTaskStatus()` の結果（archived → "merged"）となる。

### DELETE /api/tasks/[id]

既存の実装をそのまま使用。変更不要。

## フロントエンド詳細

### サイドバーアーカイブセクション

プロジェクト一覧の下、`orphanCount` リンクの上に常設セクションとして追加。

```
┌─────────────────────────┐
│ プロジェクト1     3     │
│  タスクA                │
│  タスクB                │
│ プロジェクト2     1     │
│  タスクC                │
├─────────────────────────┤
│ 📦 アーカイブ     2     │  ← 常設。クリックで展開
│  タスクD  [復元][削除]  │
│  タスクE  [復元][削除]  │
├─────────────────────────┤
│ 要復旧 1件 → 設定       │  ← 既存
└─────────────────────────┘
```

**状態管理**:
- `archivedTasks: TaskSummary[]` — `GET /api/tasks/archived` の結果
- `archivedExpanded: boolean` — localStorage に `webui.sidebar.archived_expanded` で保存
- アーカイブ件数はプロジェクト一覧と同時に `refresh()` で取得

**アーカイブ行のUI**:
- タイトル・branch・cost 等の情報は通常行と同じ
- 復元ボタン: `ArchiveRestore` アイコン、`aria-label="タスクを復元"`
- 完全削除ボタン: `Trash2` アイコン（danger色）、`aria-label="タスクを完全に削除"`
- 完全削除の確認ダイアログ: 既存の `removeTask()` の文言を流用

**アーカイブ操作の流れ**:

1. アーカイブ（通常一覧の削除ボタン）:
   - 確認ダイアログなし
   - `PATCH /api/tasks/[id]/archive` を呼ぶ
   - `notifyTasksChanged()` 発火
   - `refresh()` で通常一覧 + アーカイブ一覧を再取得
   - 現在表示中のタスクがアーカイブ対象の場合、`router.push("/")` でホームへ遷移

2. 復元（アーカイブ一覧の復元ボタン）:
   - 確認ダイアログなし
   - `PATCH /api/tasks/[id]/restore` を呼ぶ
   - `notifyTasksChanged()` 発火
   - `refresh()` で再取得

3. 完全削除（アーカイブ一覧の削除ボタン）:
   - `window.confirm()` で確認
   - 文言: 既存の `removeTask()` と同じ（isolation に応じて分岐）
   - `DELETE /api/tasks/[id]` を呼ぶ
   - `notifyTasksChanged()` 発火
   - `refresh()` で再取得

## エラー処理

| シナリオ | 動作 |
|----------|------|
| アーカイブ対象のworkspaceが存在しない | 404。フロントエンドは `refresh()` で一覧を再取得 |
| merging状態のworkspaceをアーカイブしようとした | 409。フロントエンドはエラーメッセージを表示（`window.alert`） |
| 復元対象がarchived以外 | 404。フロントエンドは `refresh()` で一覧を再取得 |
| 完全削除のworktree削除失敗 | 既存の `destroyWorkspace()` のエラー処理（orphanedマーク + 409） |
| アーカイブ一覧の取得失敗 | エラー時は空配列でフォールバック。次回 `refresh()` で再試行 |
| エンジン未接続時のアーカイブ/復元 | DB操作のみで完結するため成功。完全削除はOpenCodeセッション削除がベストエフォートで失敗するが、既存のエラー処理で対応 |

## 受入基準

1. 通常一覧の削除ボタンを押すと、確認ダイアログなしでタスクがアーカイブされ、通常一覧から非表示になる。
2. アーカイブ後もworktree・OpenCodeセッション・DB行は保持される。
3. サイドバー下部に常設のアーカイブセクションがあり、アーカイブ済みタスクが一覧表示される。
4. アーカイブ一覧の復元ボタンでタスクが通常一覧に戻る。
5. アーカイブ一覧の削除ボタンで確認ダイアログが表示され、承諾後に完全削除される。
6. 完全削除は既存の `destroyWorkspace()` と同じ処理パスを通る。
7. merging状態のタスクはアーカイブ不可（ボタン非表示またはエラー表示）。
8. アーカイブ一覧の展開状態はlocalStorageに保存され、ページ再読み込み後も維持される。
9. アーカイブ一覧の件数がプロジェクト一覧と同時に更新される。
10. 既存のテストがすべて通過する。

## テスト計画

### 単体テスト

**task-service.test.ts**:
- `listTasks()` が `status === "archived"` のworkspaceを除外する
- `listArchivedTasks()` が `status === "archived"` のworkspaceのみ返す
- `listArchivedTasks()` が空の場合は空配列を返す

**workspace-service.test.ts**:
- `archiveWorkspace()` が `setWorkspaceStatus(id, "archived")` を呼ぶ
- `archiveWorkspace()` が `persistProjectSessions()` を呼ぶ
- `archiveWorkspace()` が存在しないworkspaceで404エラーを投げる
- `restoreWorkspace()` が `setWorkspaceStatus(id, "active")` を呼ぶ
- `restoreWorkspace()` が存在しないworkspaceで404エラーを投げる
- `destroyWorkspace()` がアーカイブ後も正常に動作する

**task-status.test.ts**:
- 変更不要（既存テストが `archived → merged` をカバー済み）

### APIルートテスト

**tasks/[id]/route.test.ts**:
- `PATCH archive` が200を返し、workspace.status が "archived" になる
- `PATCH archive` が存在しないidで404を返す
- `PATCH archive` がmerging状態のworkspaceで409を返す
- `PATCH restore` が200を返し、workspace.status が "active" になる
- `PATCH restore` が存在しないidで404を返す
- `PATCH restore` がarchived以外のworkspaceで404を返す

**tasks/archived/route.test.ts**（新規）:
- `GET` がarchivedタスクのみを含むレスポンスを返す
- `GET` がarchivedタスクがない場合、空配列を返す

### コンポーネントテスト

**Sidebar.test.tsx**:
- アーカイブセクションが常に表示される（タスク0件でもセクション見出しは表示）
- アーカイブタスクがセクション内に表示される
- 復元ボタンクリックで `PATCH /api/tasks/[id]/restore` が呼ばれる
- 完全削除ボタンクリックで確認ダイアログ → `DELETE /api/tasks/[id]` が呼ばれる
- アーカイブセクションの展開状態がlocalStorageに保存される
- アーカイブ後に通常一覧から該当タスクが消える
- mergingタスクのアーカイブボタンが非表示または無効化される
