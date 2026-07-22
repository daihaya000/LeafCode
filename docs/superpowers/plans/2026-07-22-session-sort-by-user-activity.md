# セッション一覧の最新ユーザー操作順 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存セッションへのユーザープロンプト・コマンド送信時刻を永続化し、所属プロジェクト内のセッションを最新操作順に即時表示する。

**Architecture:** `TaskView` が送信前にタスクIDとセッションIDを専用APIへ通知する。APIはworkspaceとbindingの一致を検証して `session_bindings.updated_at` を更新し、既存の `/api/tasks` とSidebarの降順ソートを再利用する。時刻更新はベストエフォートとし、失敗してもOpenCodeへの送信は継続する。

**Tech Stack:** Next.js App Router、React、TypeScript、better-sqlite3、Vitest。

## Global Constraints

- 通常プロンプト、再実行、コマンドなどユーザーがセッションへ送信する操作を対象にする。
- 指示送信直後にサイドバーへ反映する。
- 各プロジェクト内のセッション順だけを変更し、プロジェクト順は変更しない。
- OpenCodeの全メッセージ履歴を一覧表示のたびに取得しない。
- 時刻更新失敗で本来のOpenCode送信を失敗扱いにしない。
- 既存の未コミット変更（`web/src/components/task/SessionActions.tsx`、`TaskView.tsx`、`TaskView.test.tsx`、`HeaderKebabMenu.tsx`）を混在させない。
- 変更ごとに検証して即コミットし、コミット後に `git log --oneline -1` で確認する。

---

## ファイル構成

- Modify: `web/src/lib/db.ts` — 検証済みセッションバインディングの活動時刻更新関数を追加する。
- Create: `web/src/app/api/tasks/[id]/activity/route.ts` — タスクID・セッションIDを検証し、活動時刻更新を公開する。
- Modify: `web/src/components/task/TaskView.tsx` — 送信前の活動時刻通知とSidebar更新通知を共通化する。
- Modify: `web/src/lib/db.test.ts` — DB更新関数の正当な対象・不一致対象のテストを追加する。
- Create: `web/src/app/api/tasks/[id]/activity/route.test.ts` — APIの入力・検証・非致命エラー境界をテストする。
- Modify: `web/src/components/task/TaskView.test.tsx` — 通常プロンプト、スラッシュコマンド、承認プロンプトの通知をテストする。

### Task 1: DBの活動時刻更新関数

**Files:**
- Modify: `web/src/lib/db.ts`（`updateSessionTitle` の近く）
- Test: `web/src/lib/db.test.ts`

**Interfaces:**
- Produces: `touchSessionActivity(workspaceId: string, opencodeSessionId: string, updatedAt?: string): boolean`

- [ ] **Step 1: 既存のDBテスト構成を確認し、失敗テストを書く**

  `touchSessionActivity` が一致するworkspace/sessionだけを更新し、存在しない組み合わせには `false` を返すテストを追加する。テスト時刻を固定して、`updated_at` がその値になることも検証する。

  ```ts
  test("touchSessionActivity updates only the matching binding", () => {
    bindSession("ws-1", "ses-1", "Session", "2026-07-22T10:00:00.000Z");

    assert.equal(
      touchSessionActivity("ws-1", "ses-1", "2026-07-22T11:00:00.000Z"),
      true,
    );
    assert.equal(
      getDb()
        .prepare(
          "SELECT updated_at FROM session_bindings WHERE workspace_id = ? AND opencode_session_id = ?",
        )
        .get("ws-1", "ses-1").updated_at,
      "2026-07-22T11:00:00.000Z",
    );
    assert.equal(touchSessionActivity("ws-2", "ses-1", "t2"), false);
  });
  ```

- [ ] **Step 2: 対象テストだけ実行して失敗を確認する**

  Run: `npm --prefix web exec vitest run src/lib/db.test.ts -t "touchSessionActivity"`

  Expected: FAIL because `touchSessionActivity` is not exported or implemented.

- [ ] **Step 3: 最小実装を追加する**

  `db.ts` に次の関数を追加する。`updatedAt` 未指定時は `new Date().toISOString()` を使い、SQLの変更行数で結果を返す。セッションIDの安全性チェックは既存の `bindSession` と同じ方針で適用する。

  ```ts
  export function touchSessionActivity(
    workspaceId: string,
    opencodeSessionId: string,
    updatedAt = new Date().toISOString(),
  ): boolean {
    if (!isSafeOpenCodeSessionId(opencodeSessionId)) return false;
    const info = getDb()
      .prepare(
        `UPDATE session_bindings SET updated_at = ?
         WHERE workspace_id = ? AND opencode_session_id = ?`,
      )
      .run(updatedAt, workspaceId, opencodeSessionId);
    return info.changes > 0;
  }
  ```

- [ ] **Step 4: テストを再実行して通過を確認する**

  Run: `npm --prefix web exec vitest run src/lib/db.test.ts -t "touchSessionActivity"`

  Expected: PASS.

- [ ] **Step 5: コミットする**

  ```bash
  git add web/src/lib/db.ts web/src/lib/db.test.ts
  git commit -m "feat: セッション操作時刻を更新するDB処理を追加"
  git log --oneline -1
  ```

### Task 2: 活動時刻更新API

**Files:**
- Create: `web/src/app/api/tasks/[id]/activity/route.ts`
- Test: `web/src/app/api/tasks/[id]/activity/route.test.ts`

**Interfaces:**
- Consumes: `POST /api/tasks/{id}/activity` with JSON `{ sessionId: string }`.
- Produces: `200 { ok: true }`, `400` for malformed input, `404` for missing task or binding mismatch.

- [ ] **Step 1: APIの失敗・成功テストを書く**

  既存のApp Router route testのモック構成に合わせ、次を固定する。

  ```ts
  test("updates activity for the matching task session", async () => {
    getTaskMock.mockReturnValue({ id: "task-1" });
    touchSessionActivityMock.mockReturnValue(true);
    const response = await POST(
      new Request("http://localhost/api/tasks/task-1/activity", {
        method: "POST",
        body: JSON.stringify({ sessionId: "ses-1" }),
      }),
      { params: Promise.resolve({ id: "task-1" }) },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(touchSessionActivityMock.mock.calls[0], ["task-1", "ses-1"]);
  });

  test("returns 400 when sessionId is missing", async () => {
    const response = await POST(requestWithBody({}), contextFor("task-1"));
    assert.equal(response.status, 400);
  });

  test("returns 404 when the binding is not found", async () => {
    touchSessionActivityMock.mockReturnValue(false);
    const response = await POST(
      requestWithBody({ sessionId: "ses-other" }),
      contextFor("task-1"),
    );
    assert.equal(response.status, 404);
  });
  ```

- [ ] **Step 2: APIテストを実行して失敗を確認する**

  Run: `npm --prefix web exec vitest run src/app/api/tasks/[id]/activity/route.test.ts`

  Expected: FAIL because the route file and handler do not exist.

- [ ] **Step 3: 検証付きrouteを実装する**

  `getWorkspace(id)` でタスクの存在を確認し、`sessionId` の文字列と安全性を検証した後、`touchSessionActivity(id, sessionId)` を呼ぶ。戻り値が `false` の場合は `404` を返す。

  ```ts
  export async function POST(req: NextRequest, context: Ctx) {
    const { id } = await context.params;
    if (!getWorkspace(id)) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    const body = (await req.json().catch(() => null)) as { sessionId?: unknown } | null;
    if (typeof body?.sessionId !== "string" || !body.sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    try {
      assertSafeOpenCodeSessionId(body.sessionId);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "invalid sessionId" },
        { status: 400 },
      );
    }
    if (!touchSessionActivity(id, body.sessionId)) {
      return NextResponse.json({ error: "session binding not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }
  ```

- [ ] **Step 4: APIテストを再実行する**

  Run: `npm --prefix web exec vitest run src/app/api/tasks/[id]/activity/route.test.ts`

  Expected: PASS.

- [ ] **Step 5: コミットする**

  ```bash
  git add web/src/app/api/tasks/[id]/activity/route.ts web/src/app/api/tasks/[id]/activity/route.test.ts
  git commit -m "feat: セッション操作時刻更新APIを追加"
  git log --oneline -1
  ```

### Task 3: 送信前の即時反映

**Files:**
- Modify: `web/src/components/task/TaskView.tsx`（送信処理と `approvePlan`）
- Test: `web/src/components/task/TaskView.test.tsx`

**Interfaces:**
- Consumes: `POST /api/tasks/{taskId}/activity`.
- Produces: 共通の `touchActivity` callbackと、送信処理後の `notifyTasksChanged()` 通知。

- [ ] **Step 1: 通常プロンプト・コマンド・承認プロンプトの失敗テストを書く**

  `sendJson` のモックに活動時刻APIの呼び出しを記録させ、通常のテキスト、`/command`、プラン承認の各送信で、OpenCode送信前に活動時刻APIが呼ばれ、送信直後にタスク変更通知が発火するテストを追加する。活動時刻APIをrejectしても送信が継続するケースも追加する。

  ```ts
  expect(sendJsonMock).toHaveBeenCalledWith(
    "POST",
    "/api/tasks/task-1/activity",
    { sessionId: "ses-1" },
  );
  expect(notifyTasksChangedMock).toHaveBeenCalled();
  ```

- [ ] **Step 2: 対象テストを実行して失敗を確認する**

  Run: `npm --prefix web exec vitest run src/components/task/TaskView.test.tsx -t "activity"`

  Expected: FAIL because the activity request is not issued.

- [ ] **Step 3: TaskViewにベストエフォートの共通通知を実装する**

  `task?.id` と `task?.sessionId` がある場合に `sendJson("POST", \`/api/tasks/${task.id}/activity\`, { sessionId: task.sessionId })` を `try/catch` で囲む `touchActivity` callbackを追加する。通常送信の分岐前と `approvePlan` の `stream.sendPrompt` 前に呼び、送信処理の `finally` で `notifyTasksChanged()` を呼ぶ。活動時刻APIの失敗はログまたは無視し、送信処理の例外を置き換えない。

  ```ts
  const touchActivity = useCallback(async () => {
    const current = taskRef.current;
    if (!current?.sessionId) return;
    try {
      await sendJson("POST", `/api/tasks/${current.id}/activity`, {
        sessionId: current.sessionId,
      });
    } catch {
      // Activity ordering is best-effort and must not block the prompt.
    }
  }, []);
  ```

  送信開始後のSidebar再取得を確実にするため、通常送信と承認送信のどちらも `touchActivity()` と `notifyTasksChanged()` を通るようにする。APIを待つことで並び替え用時刻がサーバーに反映されてからSidebarが再取得する。

- [ ] **Step 4: TaskViewテストを再実行する**

  Run: `npm --prefix web exec vitest run src/components/task/TaskView.test.tsx -t "activity"`

  Expected: PASS.

- [ ] **Step 5: 型チェックと関連テストを実行する**

  Run: `npm --prefix web exec tsc -- --noEmit`

  Expected: TypeScript compilation succeeds.

  Run: `npm --prefix web exec vitest run src/lib/db.test.ts src/app/api/tasks/[id]/activity/route.test.ts src/components/task/TaskView.test.tsx`

  Expected: all selected tests PASS.

- [ ] **Step 6: コミットする**

  ```bash
  git add web/src/components/task/TaskView.tsx web/src/components/task/TaskView.test.tsx
  git commit -m "feat: ユーザー操作時にセッション一覧を更新"
  git log --oneline -1
  ```

### Task 4: 最終検証

**Files:**
- No source changes.

- [ ] **Step 1: 対象ファイルの差分と他者差分の混入を確認する**

  Run: `git status --short && git diff --check && git diff HEAD~1 -- web/src/lib/db.ts web/src/app/api/tasks/[id]/activity/route.ts web/src/components/task/TaskView.tsx`

  Expected: only this feature's committed files are present; unrelated pre-existing TaskView changes are not staged or committed by this work.

- [ ] **Step 2: Webアプリの型チェックと全関連テストを実行する**

  Run: `npm --prefix web exec tsc -- --noEmit`

  Expected: PASS.

  Run: `npm --prefix web exec vitest run src/lib/db.test.ts src/app/api/tasks/[id]/activity/route.test.ts src/components/task/TaskView.test.tsx src/components/shell/Sidebar.test.tsx src/lib/task-service.test.ts`

  Expected: PASS.

- [ ] **Step 3: 完了前の未コミット差分を確認する**

  Run: `git status --short`

  Expected: the feature's files are clean and only unrelated pre-existing changes remain for their owner; do not claim the repository is clean or commit unrelated files.
