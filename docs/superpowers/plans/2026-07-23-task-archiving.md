# タスクアーカイブ機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通常一覧の削除操作をアーカイブ（非破壊・非表示）に変更し、サイドバー常設のアーカイブ一覧から復元・完全削除を可能にする。

**Architecture:** DB層の既存関数（`setWorkspaceStatus`・`listWorkspacesByStatus`）をそのまま利用。workspace-service に `archiveWorkspace`・`restoreWorkspace` を追加し、task-service に `listArchivedTasks` を追加。APIルートは `[id]/archive/route.ts`（PATCH）、`[id]/restore/route.ts`（PATCH）、`archived/route.ts`（GET）の3つを新規作成。Sidebar は `removeTask` の動作をアーカイブに変更し、アーカイブセクションを常設する。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Vitest、React Testing Library、Lucide React

## Global Constraints

- 既存の他者未コミット差分（`web/src/app/api/opencode/[...path]/route.test.ts`・`web/src/app/api/opencode/[...path]/route.ts`・`web/src/app/api/tasks/route.test.ts`・`web/src/components/task/TaskView.test.tsx`）には一切触れない。
- DB層（`web/src/lib/db.ts`）は変更不要。既存の `setWorkspaceStatus`・`listWorkspacesByStatus`・`deleteWorkspace` をそのまま使う。
- `task-status.ts` の `deriveTaskStatus` は変更不要。既に `archived → "merged"` のマッピングが存在する。
- アーカイブは非破壊操作。確認ダイアログ不要。worktree・OpenCodeセッション・DB行は保持。
- 完全削除は既存の `destroyWorkspace()` を呼び出す。確認ダイアログ必須。
- merging状態のworkspaceはアーカイブ不可（409エラー）。
- アーカイブ一覧の展開状態はlocalStorageに保存（キー: `webui.sidebar.archived_expanded`）。
- アーカイブ一覧はプロジェクト一覧の下、orphanCountリンクの上に常設セクションとして追加。
- 既存トークンだけを使い、色やspacing値を新規に直書きしない。
- 各ボタンに明確な `aria-label` を付ける。
- 実装完了時は `tsc`・`vitest` で検証し、常駐開発サーバーは起動しない。

---

### Task 1: workspace-service に archiveWorkspace / restoreWorkspace を追加する

**Files:**
- Modify: `web/src/lib/workspace-service.ts`（`archiveWorkspace`・`restoreWorkspace` を追加）
- Test: `web/src/lib/workspace-service.test.ts`

**Interfaces:**
- Consumes: `setWorkspaceStatus(id: string, status: "active" | "archived" | "merging" | "orphaned"): void`（`web/src/lib/db.ts`）、`persistProjectSessions(projectId: string): void`（`web/src/lib/project-session-sync.ts`）、`getWorkspace(id: string): WorkspaceRow | undefined`（`web/src/lib/db.ts`）
- Produces: `archiveWorkspace(id: string): Promise<void>` — workspace.status を "archived" に変更し、`persistProjectSessions` を実行。存在しないidの場合は `ServiceError(404)` を投げる。`restoreWorkspace(id: string): Promise<void>` — workspace.status を "active" に戻し、`persistProjectSessions` を実行。存在しないidの場合は `ServiceError(404)` を投げる。

- [ ] **Step 1: 失敗テストを書く**

`web/src/lib/workspace-service.test.ts` の末尾に以下を追加する:

```typescript
describe("archiveWorkspace", () => {
  it("sets workspace status to archived and persists sessions", async () => {
    getWorkspace.mockReturnValue(gitWorktreeRow());
    setWorkspaceStatus.mockClear();
    persistProjectSessions.mockClear();

    const { archiveWorkspace } = await import("./workspace-service");
    await archiveWorkspace("ws1");

    expect(setWorkspaceStatus).toHaveBeenCalledWith("ws1", "archived");
    expect(persistProjectSessions).toHaveBeenCalledWith("p1");
  });

  it("throws 404 when workspace does not exist", async () => {
    getWorkspace.mockReturnValue(undefined);

    const { archiveWorkspace, ServiceError } = await import("./workspace-service");
    await expect(archiveWorkspace("missing")).rejects.toThrow(ServiceError);
    await expect(archiveWorkspace("missing")).rejects.toMatchObject({
      status: 404,
    });
    expect(setWorkspaceStatus).not.toHaveBeenCalled();
  });
});

describe("restoreWorkspace", () => {
  it("sets workspace status to active and persists sessions", async () => {
    getWorkspace.mockReturnValue(gitWorktreeRow({ status: "archived" }));
    setWorkspaceStatus.mockClear();
    persistProjectSessions.mockClear();

    const { restoreWorkspace } = await import("./workspace-service");
    await restoreWorkspace("ws1");

    expect(setWorkspaceStatus).toHaveBeenCalledWith("ws1", "active");
    expect(persistProjectSessions).toHaveBeenCalledWith("p1");
  });

  it("throws 404 when workspace does not exist", async () => {
    getWorkspace.mockReturnValue(undefined);

    const { restoreWorkspace, ServiceError } = await import("./workspace-service");
    await expect(restoreWorkspace("missing")).rejects.toThrow(ServiceError);
    await expect(restoreWorkspace("missing")).rejects.toMatchObject({
      status: 404,
    });
    expect(setWorkspaceStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd web && npx vitest run src/lib/workspace-service.test.ts -t "archiveWorkspace|restoreWorkspace"`
Expected: FAIL — `archiveWorkspace` / `restoreWorkspace` が未定義でエラー。

- [ ] **Step 3: 最小実装を書く**

`web/src/lib/workspace-service.ts` の `destroyWorkspace` の直前に以下を追加する:

```typescript
/** Set workspace status to "archived". Worktree/sessions are preserved. */
export async function archiveWorkspace(id: string): Promise<void> {
  const row = getWorkspace(id);
  if (!row) throw new ServiceError("workspace not found", 404);
  setWorkspaceStatus(id, "archived");
  persistProjectSessions(row.project_id);
}

/** Restore an archived workspace back to "active". */
export async function restoreWorkspace(id: string): Promise<void> {
  const row = getWorkspace(id);
  if (!row) throw new ServiceError("workspace not found", 404);
  setWorkspaceStatus(id, "active");
  persistProjectSessions(row.project_id);
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd web && npx vitest run src/lib/workspace-service.test.ts -t "archiveWorkspace|restoreWorkspace"`
Expected: PASS — 全ケースが通過する。

- [ ] **Step 5: コミットする**

```bash
git add web/src/lib/workspace-service.ts web/src/lib/workspace-service.test.ts
git commit -m "feat: workspace-service に archiveWorkspace / restoreWorkspace を追加"
git log --oneline -1
```

---

### Task 2: task-service に listArchivedTasks を追加し listTasks にフィルタを追加する

**Files:**
- Modify: `web/src/lib/task-service.ts`
- Test: `web/src/lib/task-service.test.ts`

**Interfaces:**
- Consumes: `listWorkspacesJoined(): WorkspaceJoinedRow[]`（`web/src/lib/db.ts`）、`toTask()`（既存の内部関数）
- Produces: `listArchivedTasks(): Promise<TaskSummary[]>` — `listWorkspacesJoined().filter((ws) => ws.status === "archived")` でworkspace一覧を取得し、`toTask()` で `TaskSummary` に変換して返す。`listTasks()` が `status === "archived"` のworkspaceを除外する。

- [ ] **Step 1: 失敗テストを書く**

`web/src/lib/task-service.test.ts` の末尾に以下を追加する:

```typescript
describe("listTasks archived filter", () => {
  it("excludes workspaces with status archived", async () => {
    h.workspaces = [
      { ...WS, id: "ws1", status: "active" },
      { ...WS, id: "ws2", status: "archived" },
    ];
    h.bindings = new Map();
    const { tasks } = await listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("ws1");
  });
});

describe("listArchivedTasks", () => {
  it("returns only archived workspaces as TaskSummary[]", async () => {
    // listArchivedTasks は listWorkspacesJoined を使うため、hoisted モックの
    // listWorkspacesJoined: () => h.workspaces で自動的にカバーされる。
    const { listArchivedTasks } = await import("./task-service");
    const tasks = await listArchivedTasks();
    // デフォルトモックでは archived の workspace がないので空配列
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd web && npx vitest run src/lib/task-service.test.ts -t "archived"`
Expected: FAIL — `listArchivedTasks` が未定義でエラー。

- [ ] **Step 3: テストを修正する（hoisted モックに listWorkspacesJoined のフィルタを追加）**

`web/src/lib/task-service.test.ts` の hoisted ブロックと `vi.mock("./db")` を更新する必要がある。現在のモックに `listWorkspacesByStatus` は不要（`listArchivedTasks` は `listWorkspacesJoined` を使うため）。

`vi.mock("./db")` のブロックは既に `listWorkspacesJoined: () => h.workspaces` を含んでいるため、変更不要。

- [ ] **Step 4: 最小実装を書く**

`web/src/lib/task-service.ts` の `listTasks` 関数内で、既存の `const workspaces = listWorkspacesJoined();` の行を以下のように置き換える:

```typescript
  const workspaces = listWorkspacesJoined().filter(
    (w) => w.status !== "archived",
  );
```

`listTasks` の直後に `listArchivedTasks` を追加:

```typescript
export async function listArchivedTasks(): Promise<TaskSummary[]> {
  const workspaces = listWorkspacesJoined().filter(
    (ws) => ws.status === "archived",
  );
  if (workspaces.length === 0) return [];
  const bindings = latestBindings();
  const dirs = [...new Set(workspaces.map((w) => w.absolute_path))];

  const [{ engineOk, statuses }, stats, metas] = await Promise.all([
    sessionStatusFor(dirs),
    Promise.all(dirs.map((d) => dirStat(d))),
    sessionMetaFor(dirs),
  ]);
  const statByDir = new Map(dirs.map((d, i) => [d, stats[i]]));

  const tasks = workspaces.map((ws) => {
    const binding = bindings.get(ws.id);
    return toTask(
      ws,
      binding,
      statByDir.get(ws.absolute_path) ?? EMPTY_STAT,
      binding ? statuses[binding.opencode_session_id] : undefined,
      engineOk,
      binding ? metas[binding.opencode_session_id] : undefined,
    );
  });

  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return tasks;
}
```

`web/src/lib/task-service.ts` の先頭の import に `listWorkspacesByStatus` は不要。既存の `listWorkspacesJoined` で十分。

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `cd web && npx vitest run src/lib/task-service.test.ts -t "archived"`
Expected: PASS — 全ケースが通過する。

- [ ] **Step 6: 既存テストが壊れていないことを確認する**

Run: `cd web && npx vitest run src/lib/task-service.test.ts`
Expected: PASS — 既存テストもすべて通過。

- [ ] **Step 7: コミットする**

```bash
git add web/src/lib/task-service.ts web/src/lib/task-service.test.ts
git commit -m "feat: task-service に listArchivedTasks を追加、listTasks に archived フィルタを追加"
git log --oneline -1
```

---

### Task 3: APIルート PATCH /api/tasks/[id]/archive を作成する

**Files:**
- Create: `web/src/app/api/tasks/[id]/archive/route.ts`
- Test: `web/src/app/api/tasks/[id]/archive/route.test.ts`

**Interfaces:**
- Consumes: `archiveWorkspace(id: string): Promise<void>`（Task 1）、`getWorkspace(id: string): WorkspaceRow | undefined`（`web/src/lib/db.ts`）
- Produces: `PATCH /api/tasks/[id]/archive` — body不要。200 `{ ok: true }`、404 `{ error: "task not found" }`、409 `{ error: "cannot archive a merging task" }`

- [ ] **Step 1: 失敗テストを書く**

`web/src/app/api/tasks/[id]/archive/route.test.ts` を新規作成:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getWorkspaceMock, archiveWorkspaceMock } = vi.hoisted(() => ({
  getWorkspaceMock: vi.fn(),
  archiveWorkspaceMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getWorkspace: getWorkspaceMock,
}));

vi.mock("@/lib/workspace-service", () => ({
  archiveWorkspace: archiveWorkspaceMock,
  ServiceError: class ServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { PATCH } from "./route";

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/tasks/[id]/archive", () => {
  it("archives an active workspace and returns 200", async () => {
    getWorkspaceMock.mockReturnValue({
      id: "ws1",
      status: "active",
    });
    archiveWorkspaceMock.mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/archive", {
        method: "PATCH",
      }),
      contextFor("ws1"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(archiveWorkspaceMock).toHaveBeenCalledWith("ws1");
  });

  it("returns 404 when workspace does not exist", async () => {
    getWorkspaceMock.mockReturnValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/missing/archive", {
        method: "PATCH",
      }),
      contextFor("missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task not found" });
    expect(archiveWorkspaceMock).not.toHaveBeenCalled();
  });

  it("returns 409 when workspace status is merging", async () => {
    getWorkspaceMock.mockReturnValue({
      id: "ws1",
      status: "merging",
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/archive", {
        method: "PATCH",
      }),
      contextFor("ws1"),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "cannot archive a merging task",
    });
    expect(archiveWorkspaceMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd web && npx vitest run src/app/api/tasks/\[id\]/archive/route.test.ts`
Expected: FAIL — route.ts が存在しないため。

- [ ] **Step 3: 最小実装を書く**

`web/src/app/api/tasks/[id]/archive/route.ts` を新規作成:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/db";
import { archiveWorkspace } from "@/lib/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd web && npx vitest run src/app/api/tasks/\[id\]/archive/route.test.ts`
Expected: PASS — 全ケースが通過する。

- [ ] **Step 5: コミットする**

```bash
git add web/src/app/api/tasks/\[id\]/archive/route.ts web/src/app/api/tasks/\[id\]/archive/route.test.ts
git commit -m "feat: PATCH /api/tasks/[id]/archive ルートを作成"
git log --oneline -1
```

---

### Task 4: APIルート PATCH /api/tasks/[id]/restore を作成する

**Files:**
- Create: `web/src/app/api/tasks/[id]/restore/route.ts`
- Test: `web/src/app/api/tasks/[id]/restore/route.test.ts`

**Interfaces:**
- Consumes: `restoreWorkspace(id: string): Promise<void>`（Task 1）、`getWorkspace(id: string): WorkspaceRow | undefined`（`web/src/lib/db.ts`）
- Produces: `PATCH /api/tasks/[id]/restore` — body不要。200 `{ ok: true }`、404 `{ error: "task not found" }`（archived 以外も含む）

- [ ] **Step 1: 失敗テストを書く**

`web/src/app/api/tasks/[id]/restore/route.test.ts` を新規作成:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getWorkspaceMock, restoreWorkspaceMock } = vi.hoisted(() => ({
  getWorkspaceMock: vi.fn(),
  restoreWorkspaceMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getWorkspace: getWorkspaceMock,
}));

vi.mock("@/lib/workspace-service", () => ({
  restoreWorkspace: restoreWorkspaceMock,
  ServiceError: class ServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { PATCH } from "./route";

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/tasks/[id]/restore", () => {
  it("restores an archived workspace and returns 200", async () => {
    getWorkspaceMock.mockReturnValue({
      id: "ws1",
      status: "archived",
    });
    restoreWorkspaceMock.mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/restore", {
        method: "PATCH",
      }),
      contextFor("ws1"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(restoreWorkspaceMock).toHaveBeenCalledWith("ws1");
  });

  it("returns 404 when workspace does not exist", async () => {
    getWorkspaceMock.mockReturnValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/missing/restore", {
        method: "PATCH",
      }),
      contextFor("missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task not found" });
    expect(restoreWorkspaceMock).not.toHaveBeenCalled();
  });

  it("returns 404 when workspace status is not archived", async () => {
    getWorkspaceMock.mockReturnValue({
      id: "ws1",
      status: "active",
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/restore", {
        method: "PATCH",
      }),
      contextFor("ws1"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task not found" });
    expect(restoreWorkspaceMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd web && npx vitest run src/app/api/tasks/\[id\]/restore/route.test.ts`
Expected: FAIL — route.ts が存在しないため。

- [ ] **Step 3: 最小実装を書く**

`web/src/app/api/tasks/[id]/restore/route.ts` を新規作成:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/db";
import { restoreWorkspace } from "@/lib/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd web && npx vitest run src/app/api/tasks/\[id\]/restore/route.test.ts`
Expected: PASS — 全ケースが通過する。

- [ ] **Step 5: コミットする**

```bash
git add web/src/app/api/tasks/\[id\]/restore/route.ts web/src/app/api/tasks/\[id\]/restore/route.test.ts
git commit -m "feat: PATCH /api/tasks/[id]/restore ルートを作成"
git log --oneline -1
```

---

### Task 5: APIルート GET /api/tasks/archived を作成する

**Files:**
- Create: `web/src/app/api/tasks/archived/route.ts`
- Test: `web/src/app/api/tasks/archived/route.test.ts`

**Interfaces:**
- Consumes: `listArchivedTasks(): Promise<TaskSummary[]>`（Task 2）
- Produces: `GET /api/tasks/archived` — 200 `{ tasks: TaskSummary[] }`

- [ ] **Step 1: 失敗テストを書く**

`web/src/app/api/tasks/archived/route.test.ts` を新規作成:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { listArchivedTasksMock } = vi.hoisted(() => ({
  listArchivedTasksMock: vi.fn(),
}));

vi.mock("@/lib/task-service", () => ({
  listArchivedTasks: listArchivedTasksMock,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tasks/archived", () => {
  it("returns archived tasks", async () => {
    const fakeTasks = [
      {
        id: "ws1",
        projectId: "prj1",
        projectName: "Repo",
        title: "Archived task",
        directory: "/repo",
        isolation: "current_folder",
        status: "merged",
        sessionId: null,
        branch: "main",
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        createdAt: "2026-07-18T00:00:00Z",
        updatedAt: "2026-07-18T01:00:00Z",
      },
    ];
    listArchivedTasksMock.mockResolvedValue(fakeTasks);

    const response = await GET(
      new NextRequest("http://localhost/api/tasks/archived"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ tasks: fakeTasks });
  });

  it("returns empty array when no archived tasks exist", async () => {
    listArchivedTasksMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest("http://localhost/api/tasks/archived"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ tasks: [] });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd web && npx vitest run src/app/api/tasks/archived/route.test.ts`
Expected: FAIL — route.ts が存在しないため。

- [ ] **Step 3: 最小実装を書く**

`web/src/app/api/tasks/archived/route.ts` を新規作成:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { listArchivedTasks } from "@/lib/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const tasks = await listArchivedTasks();
  return NextResponse.json({ tasks });
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd web && npx vitest run src/app/api/tasks/archived/route.test.ts`
Expected: PASS — 全ケースが通過する。

- [ ] **Step 5: コミットする**

```bash
git add web/src/app/api/tasks/archived/route.ts web/src/app/api/tasks/archived/route.test.ts
git commit -m "feat: GET /api/tasks/archived ルートを作成"
git log --oneline -1
```

---

### Task 6: Sidebar の removeTask をアーカイブに変更する

**Files:**
- Modify: `web/src/components/shell/Sidebar.tsx`（`removeTask` の動作をアーカイブに変更）
- Test: `web/src/components/shell/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `sendJson(method, url)`（`web/src/lib/client.ts`）、`notifyTasksChanged()`（`web/src/lib/events.ts`）、`router.push("/")`（`next/navigation`）
- Produces: `removeTask` が確認ダイアログなしで `PATCH /api/tasks/[id]/archive` を呼び、現在表示中のタスクがアーカイブ対象ならホームへ遷移する。エラー時は `window.alert` で表示。

- [ ] **Step 1: 失敗テストを書く**

`web/src/components/shell/Sidebar.test.tsx` の末尾に以下を追加:

```typescript
describe("Sidebar archive task", () => {
  it("archives a task without confirmation dialog", async () => {
    const { sendJson } = await import("@/lib/client");
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [{
            id: "ws1",
            projectId: "prj1",
            projectName: "Repo",
            title: "Task title",
            directory: "/repo",
            isolation: "current_folder",
            status: "idle",
            sessionId: "sess1",
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T00:00:00Z",
          }],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Task title");
    const archiveBtn = screen.getByLabelText("タスクをアーカイブ");
    archiveBtn.click();

    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith("PATCH", "/api/tasks/ws1/archive");
    });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd web && npx vitest run src/components/shell/Sidebar.test.tsx -t "archive task"`
Expected: FAIL — aria-label "タスクをアーカイブ" が存在しない。

- [ ] **Step 3: Sidebar の removeTask を変更する**

`web/src/components/shell/Sidebar.tsx` の `removeTask` 関数を以下のように置き換える:

```typescript
  const archiveTask = async (task: TaskSummary, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await sendJson("PATCH", `/api/tasks/${task.id}/archive`);
      if (activeTaskId === task.id) router.push("/");
      notifyTasksChanged();
      await refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "タスクのアーカイブに失敗しました";
      window.alert(msg);
      notifyTasksChanged();
      await refresh();
    }
  };
```

タスク行の削除ボタンの `aria-label` と `onClick` を変更する:

```tsx
                                  <button
                                    type="button"
                                    aria-label="タスクをアーカイブ"
                                    title="タスクをアーカイブ"
                                    onClick={(e) => void archiveTask(task, e)}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                                  >
                                    <Archive className="h-3 w-3" />
                                  </button>
```

`Archive` アイコンを import に追加:

```typescript
import {
  Archive,
  ChevronRight,
  Cpu,
  FolderGit2,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd web && npx vitest run src/components/shell/Sidebar.test.tsx -t "archive task"`
Expected: PASS — アーカイブテストが通過する。

- [ ] **Step 5: 既存テストが壊れていないことを確認する**

Run: `cd web && npx vitest run src/components/shell/Sidebar.test.tsx`
Expected: PASS — 既存テストもすべて通過。

- [ ] **Step 6: コミットする**

```bash
git add web/src/components/shell/Sidebar.tsx web/src/components/shell/Sidebar.test.tsx
git commit -m "feat: Sidebar の削除ボタンをアーカイブに変更"
git log --oneline -1
```

---

### Task 7: Sidebar にアーカイブ一覧セクションを追加する

**Files:**
- Modify: `web/src/components/shell/Sidebar.tsx`
- Test: `web/src/components/shell/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `GET /api/tasks/archived`（Task 5）、`sendJson("PATCH", "/api/tasks/[id]/restore")`（Task 4）、`sendJson("DELETE", "/api/tasks/[id]")`（既存）
- Produces: プロジェクト一覧の下に常設のアーカイブセクション。各アーカイブ行に復元ボタン（`ArchiveRestore` アイコン）と完全削除ボタン（`Trash2` アイコン、danger色）。展開状態はlocalStorageに保存。

- [ ] **Step 1: 失敗テストを書く**

`web/src/components/shell/Sidebar.test.tsx` の末尾に以下を追加:

```typescript
describe("Sidebar archived section", () => {
  it("shows archived section with archived tasks", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({ tasks: [], engineOk: true });
      }
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [{
            id: "ws-archived",
            projectId: "prj1",
            projectName: "Repo",
            title: "Archived task",
            directory: "/repo",
            isolation: "current_folder",
            status: "merged",
            sessionId: null,
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T01:00:00Z",
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    // アーカイブセクションは初期状態で折りたたまれているため、展開する
    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    archiveHeading.click();

    await screen.findByText("Archived task");
    expect(screen.getByLabelText("タスクを復元")).toBeTruthy();
    expect(screen.getByLabelText("タスクを完全に削除")).toBeTruthy();
  });

  it("restores an archived task", async () => {
    const { sendJson } = await import("@/lib/client");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({ projects: [] });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({ tasks: [], engineOk: true });
      }
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [{
            id: "ws-archived",
            projectId: "prj1",
            projectName: "Repo",
            title: "Archived task",
            directory: "/repo",
            isolation: "current_folder",
            status: "merged",
            sessionId: null,
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T01:00:00Z",
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    // アーカイブセクションを展開
    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    archiveHeading.click();

    await screen.findByText("Archived task");
    screen.getByLabelText("タスクを復元").click();

    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "PATCH",
        "/api/tasks/ws-archived/restore",
      );
    });
  });

  it("destroys an archived task after confirmation", async () => {
    const { sendJson } = await import("@/lib/client");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({ projects: [] });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({ tasks: [], engineOk: true });
      }
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [{
            id: "ws-archived",
            projectId: "prj1",
            projectName: "Repo",
            title: "Archived task",
            directory: "/repo",
            isolation: "current_folder",
            status: "merged",
            sessionId: null,
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T01:00:00Z",
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    // アーカイブセクションを展開
    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    archiveHeading.click();

    await screen.findByText("Archived task");
    screen.getByLabelText("タスクを完全に削除").click();

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(sendJson).toHaveBeenCalledWith(
        "DELETE",
        "/api/tasks/ws-archived",
      );
    });
    confirmSpy.mockRestore();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd web && npx vitest run src/components/shell/Sidebar.test.tsx -t "archived section"`
Expected: FAIL — アーカイブセクションが存在しない。

- [ ] **Step 3: Sidebar にアーカイブセクションを実装する**

`web/src/components/shell/Sidebar.tsx` に以下の state と関数を追加:

```typescript
  const [archivedTasks, setArchivedTasks] = useState<TaskSummary[]>([]);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
```

`refresh` 関数内でアーカイブ一覧も取得する:

```typescript
  const refresh = useCallback(async () => {
    const [projectsResult, tasksResult, archivedResult] = await Promise.allSettled([
      getJson<{ projects: ProjectDto[] }>("/api/projects"),
      getJson<{ tasks: TaskSummary[]; engineOk: boolean }>("/api/tasks"),
      getJson<{ tasks: TaskSummary[] }>("/api/tasks/archived"),
    ]);
    if (projectsResult.status === "fulfilled") {
      setProjects(projectsResult.value.projects ?? []);
      setProjectsLoaded(true);
      setProjectsLoadError(false);
    } else {
      setProjectsLoadError(true);
    }
    if (tasksResult.status === "fulfilled") {
      setTasks(tasksResult.value.tasks ?? []);
      setEngineOk(tasksResult.value.engineOk);
    }
    if (archivedResult.status === "fulfilled") {
      setArchivedTasks(archivedResult.value.tasks ?? []);
    }
  }, []);
```

`hydrated` の useEffect 内で archivedExpanded を localStorage から読み込む:

```typescript
  useEffect(() => {
    setExpanded(loadExpanded());
    setWidth(loadWidth());
    setArchivedExpanded(() => {
      try {
        return localStorage.getItem("webui.sidebar.archived_expanded") === "true";
      } catch {
        return false;
      }
    });
    setHydrated(true);
    void refresh();
    const onVisible = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (visible) void refresh();
    };
    const onChanged = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("webui:tasks-changed", onChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("webui:tasks-changed", onChanged);
    };
  }, [refresh]);
```

アーカイブセクションのトグル関数:

```typescript
  const toggleArchived = () => {
    setArchivedExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("webui.sidebar.archived_expanded", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
```

アーカイブタスクの復元関数:

```typescript
  const restoreArchivedTask = async (task: TaskSummary, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await sendJson("PATCH", `/api/tasks/${task.id}/restore`);
      notifyTasksChanged();
      await refresh();
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "タスクの復元に失敗しました",
      );
    }
  };
```

アーカイブタスクの完全削除関数:

```typescript
  const destroyArchivedTask = async (task: TaskSummary, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const label =
      task.isolation === "current_folder"
        ? `「${task.title}」を完全に削除しますか？（フォルダはそのまま残ります）`
        : `「${task.title}」を完全に削除しますか？ worktree/コピーも削除されます。`;
    if (!window.confirm(label)) return;
    try {
      await sendJson("DELETE", `/api/tasks/${task.id}`);
      notifyTasksChanged();
      await refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "タスクの削除に失敗しました";
      window.alert(
        msg.includes("orphaned") || msg.includes("worktree")
          ? `${msg}\n\n設定 → 「orphan を掃除」で残件を削除できます。`
          : msg,
      );
      notifyTasksChanged();
      await refresh();
    }
  };
```

プロジェクト一覧の `</ul>` 閉じタグの後、orphanCount リンクの前にアーカイブセクションを追加:

```tsx
        <div className="mt-2">
            <button
              type="button"
              aria-expanded={archivedExpanded}
              aria-label={`アーカイブ${archivedExpanded ? "を折りたたむ" : "を展開"}`}
              onClick={toggleArchived}
              className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted hover:bg-surface-2 hover:text-text"
            >
              <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">アーカイブ</span>
              <span className="tabular-nums text-[10px] text-muted">
                {archivedTasks.length}
              </span>
              <ChevronRight
                className={cx(
                  "h-3 w-3 shrink-0 transition-transform",
                  archivedExpanded && "rotate-90",
                )}
                aria-hidden="true"
              />
            </button>
            {archivedExpanded && (
              <ul className="mb-1 ml-2 space-y-0.5 border-l border-border pl-1.5">
                {archivedTasks.length === 0 ? (
                  <li className="px-2 py-1.5 text-[11px] text-muted">
                    アーカイブされたタスクはありません
                  </li>
                ) : (
                  archivedTasks.map((task) => (
                    <li key={task.id}>
                      <div className="flex items-start gap-0.5 rounded-lg text-muted hover:bg-surface-2 hover:text-text">
                        <button
                          type="button"
                          onClick={() => nav(`/task/${task.id}`)}
                          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                              <span
                                aria-label={`状態: ${task.status}`}
                                className="h-1.5 w-1.5 rounded-full bg-success"
                              />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                              {task.title}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted">
                              {timeAgo(task.updatedAt)}
                            </span>
                          </div>
                          <div className="flex min-w-0 items-center gap-1 pl-3 text-[10px] text-muted">
                            <GitBranch className="h-2.5 w-2.5 shrink-0 opacity-70" />
                            <span className="min-w-0 truncate font-mono">
                              {sidebarBranchLabel(task)}
                            </span>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center pt-0.5 pr-0.5">
                          <button
                            type="button"
                            aria-label="タスクを復元"
                            title="タスクを復元"
                            onClick={(e) => void restoreArchivedTask(task, e)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                          >
                            <ArchiveRestore className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label="タスクを完全に削除"
                            title="タスクを完全に削除"
                            onClick={(e) => void destroyArchivedTask(task, e)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
```

`Archive` と `ArchiveRestore` を lucide-react の import に追加:

```typescript
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Cpu,
  FolderGit2,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd web && npx vitest run src/components/shell/Sidebar.test.tsx -t "archived section"`
Expected: PASS — アーカイブセクションのテストが通過する。

- [ ] **Step 5: 既存テストが壊れていないことを確認する**

Run: `cd web && npx vitest run src/components/shell/Sidebar.test.tsx`
Expected: PASS — 既存テストもすべて通過。

- [ ] **Step 6: コミットする**

```bash
git add web/src/components/shell/Sidebar.tsx web/src/components/shell/Sidebar.test.tsx
git commit -m "feat: Sidebar にアーカイブ一覧セクションを追加"
git log --oneline -1
```

---

### Task 8: 全体回帰検証

**Files:**
- Verify only: `web/`

**Interfaces:**
- Consumes: Task 1〜7 の完成状態
- Produces: 全自動テスト・型検査・lint の通過確認

- [ ] **Step 1: 全自動検証を実行する**

Run: `cd web && npm run test && npm run typecheck && npm run lint`

Expected: Vitest 全件 PASS、TypeScript error 0、ESLint error 0。

- [ ] **Step 2: 失敗があれば根本原因を特定し該当タスクの手順で修正して再検証する**

`npm run test` が失敗した場合、失敗テスト名とエラーメッセージを確認し、以下の手順で原因を特定する:
  1. 失敗テストが期待する動作と実際の出力の差分を読む。
  2. 該当する実装ファイル（workspace-service.ts / task-service.ts / route.ts / Sidebar.tsx）の該当箇所を確認する。
  3. 型エラーがある場合は `tsc` のエラー行を確認し、不足import・型の不一致を特定する。
  4. 原因が特定できたら、該当タスクの「最小実装を書く」手順に戻り、コードを修正する。
  5. 修正後、同じコマンドを再実行する。全テストがPASSし型エラーが0になるまで繰り返す。

`npm run lint` が失敗した場合も同様に、ESLintのエラー箇所を確認し該当ファイルを修正して再実行する。

全検証通過後にコミットする:

```bash
git add -A
git commit -m "fix: アーカイブ機能の回帰修正"
git log --oneline -1
```

- [ ] **Step 3: 最終状態を確認する**

Run: `cd web && git status && npm run test && npm run typecheck`

Expected: ワーキングツリーがクリーン、全テスト PASS、型検査 OK。
