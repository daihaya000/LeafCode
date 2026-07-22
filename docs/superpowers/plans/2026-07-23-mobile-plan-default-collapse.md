# Mobile Plan Default Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 768px未満ではすべてのプランカードを初期最小化し、ユーザーがアクセシブルなヘッダーボタンから展開して本文確認・承認できるようにする。

**Architecture:** `TaskView` が既存の `isMd` を画面幅の正として使い、`initialCollapsed={!isMd}` を各 `PlanDocumentCard` に渡す。カードはその値でローカルstateを一度だけ初期化し、以降の開閉操作をカードの生存中だけ保持する。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library、lucide-react

## Global Constraints

- 768px未満をスマホ表示とする。
- 承認待ちの最新プランと過去のプランを同じ規則で扱う。
- 768px以上の初期表示は現状どおり展開状態を維持する。
- 最小化中はMarkdown本文と承認ボタンを隠す。
- 開閉状態は永続化せず、カードコンポーネントの生存中だけ保持する。
- `PlanDocumentCard` 内で独自の `matchMedia` 判定を追加しない。
- 開閉操作にはネイティブの `button` と `aria-expanded` を使う。
- 常駐する開発サーバーやwatchコマンドを起動しない。

## File Structure

- Create: `web/src/components/task/PlanDocumentCard.test.tsx` — カード単体の初期状態、開閉、アクセシビリティ、承認導線を検証する。
- Modify: `web/src/components/task/PlanDocumentCard.tsx` — 初期最小化prop、カード固有state、開閉ボタン、本文表示制御を実装する。
- Modify: `web/src/components/task/TaskView.test.tsx` — 既存の画面幅判定から初期最小化propが渡ることを検証する。
- Modify: `web/src/components/task/TaskView.tsx` — `isMd` を `initialCollapsed` に変換してカードへ渡す。

---

### Task 1: PlanDocumentCardにアクセシブルな開閉機能を追加

**Files:**
- Create: `web/src/components/task/PlanDocumentCard.test.tsx`
- Modify: `web/src/components/task/PlanDocumentCard.tsx:1-128`

**Interfaces:**
- Consumes: 既存の `path`, `directory`, `actionable`, `working`, `approved`, `onApprove` props。
- Produces: 新しい任意prop `initialCollapsed?: boolean`。未指定時は `false` で、既存呼び出し元の初期展開を維持する。

- [ ] **Step 1: 初期状態・開閉・承認導線の失敗テストを書く**

`web/src/components/task/PlanDocumentCard.test.tsx` を次の内容で作成する。

```tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanDocumentCard } from "./PlanDocumentCard";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ getJson }));
vi.mock("./Markdown", () => ({
  Markdown: ({ text }: { text: string }) => <div data-testid="plan-markdown">{text}</div>,
}));

describe("PlanDocumentCard", () => {
  beforeEach(() => {
    getJson.mockResolvedValue({ name: "plan.md", content: "計画本文" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderCard(
    props: Partial<React.ComponentProps<typeof PlanDocumentCard>> = {},
  ) {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanDocumentCard
        path="/repo/plan.md"
        directory="/repo"
        actionable
        working={false}
        onApprove={onApprove}
        {...props}
      />,
    );
    return { onApprove };
  }

  it("starts collapsed when requested and expands from the header", async () => {
    renderCard({ initialCollapsed: true });
    const toggle = screen.getByRole("button", { name: /plan\.md/ });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("plan-markdown")).toBeNull();
    expect(screen.queryByRole("button", { name: "承認して実装" })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect((await screen.findByTestId("plan-markdown")).textContent).toBe("計画本文");
    expect(screen.getByRole("button", { name: "承認して実装" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("plan-markdown")).toBeNull();
  });

  it("stays expanded by default and preserves approval behavior", async () => {
    const { onApprove } = renderCard();

    const toggle = screen.getByRole("button", { name: /plan\.md/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByTestId("plan-markdown")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "承認して実装" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "実装を開始しました" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: テストが期待どおり失敗することを確認する**

Run:

```bash
cd web && npx vitest run src/components/task/PlanDocumentCard.test.tsx
```

Expected: FAIL。`initialCollapsed` がprops型に存在しないか、ヘッダーに `button` / `aria-expanded` がないため失敗する。

- [ ] **Step 3: 最小の開閉実装を追加する**

`web/src/components/task/PlanDocumentCard.tsx` のimportを次に変更する。

```tsx
import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
```

引数とprops型に `initialCollapsed` を追加する。

```tsx
export function PlanDocumentCard({
  path,
  directory,
  actionable,
  working,
  approved = false,
  initialCollapsed = false,
  onApprove,
}: {
  path: string;
  directory: string;
  actionable: boolean;
  working: boolean;
  /** Derived from session history: the plan was already approved (survives reload). */
  approved?: boolean;
  /** Initial card state only; later viewport changes do not override user interaction. */
  initialCollapsed?: boolean;
  onApprove: () => Promise<void>;
}) {
```

既存state群の先頭にカード固有stateを追加する。

```tsx
const [collapsed, setCollapsed] = useState(initialCollapsed);
```

既存のヘッダー`div`と本文`div`を、次のボタンと条件レンダーへ置き換える。

```tsx
<button
  type="button"
  aria-expanded={!collapsed}
  onClick={() => setCollapsed((value) => !value)}
  className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-muted ${
    collapsed ? "" : "border-b border-border"
  }`}
>
  <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
  <span className="min-w-0 flex-1 truncate font-medium">{fileName}</span>
  <ChevronDown
    aria-hidden="true"
    className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
  />
</button>
{!collapsed && (
  <div className="space-y-3 px-3 py-3">
    {loadState.status === "loading" && (
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
        <span aria-hidden="true">
          <Spinner />
        </span>
        計画書を読み込み中…
      </div>
    )}
    {loadState.status === "error" && (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-danger">
          計画書を読み込めませんでした
        </p>
        <Button variant="secondary" size="sm" onClick={() => setReload((v) => v + 1)}>
          再試行
        </Button>
      </div>
    )}
    {loadState.status === "ready" && <Markdown text={loadState.document.content} />}
    {loadState.status === "ready" && actionable && (
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {approvalError && (
          <p role="alert" className="text-sm text-danger">
            実装開始の送信に失敗しました
          </p>
        )}
        <Button
          variant="primary"
          disabled={working || approving || isSubmitted}
          busy={approving}
          onClick={() => void approve()}
        >
          {isSubmitted ? "実装を開始しました" : "承認して実装"}
        </Button>
        {isSubmitted && (
          <span role="status" aria-live="polite" className="sr-only">
            実装を開始しました
          </span>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: 単体テストと型チェックを通す**

Run:

```bash
cd web && npx vitest run src/components/task/PlanDocumentCard.test.tsx && npm run typecheck
```

Expected: 追加した2テストがPASSし、TypeScriptエラーが0件。

- [ ] **Step 5: 差分を確認して即コミットする**

Run:

```bash
git status --short
git diff -- web/src/components/task/PlanDocumentCard.tsx web/src/components/task/PlanDocumentCard.test.tsx
git add web/src/components/task/PlanDocumentCard.tsx web/src/components/task/PlanDocumentCard.test.tsx
git commit -m "feat: プランカードの開閉操作を追加"
git log --oneline -1
```

Expected: コミット出力と最新ログに新しいコミットハッシュが表示される。

---

### Task 2: TaskViewのスマホ判定を初期最小化へ接続

**Files:**
- Modify: `web/src/components/task/TaskView.test.tsx:9-84, 407-458`
- Modify: `web/src/components/task/TaskView.tsx:1877-1886`

**Interfaces:**
- Consumes: Task 1の `PlanDocumentCard` prop `initialCollapsed?: boolean` と、既存の `TaskView` state `isMd: boolean`。
- Produces: すべてのプランカードに対する `initialCollapsed={!isMd}` の伝播。

- [ ] **Step 1: PlanDocumentCardモックでpropを観測できるようにする**

`web/src/components/task/TaskView.test.tsx` のhoisted値へ記録配列を追加する。

```tsx
const {
  getJson,
  notifyTasksChanged,
  sendJson,
  useSessionStream,
  slashCommands,
  setExtras,
  setActiveScope,
  planCardProps,
} = vi.hoisted(() => ({
  getJson: vi.fn(),
  notifyTasksChanged: vi.fn(),
  sendJson: vi.fn(),
  useSessionStream: vi.fn(),
  slashCommands: [] as { name: string }[],
  setExtras: vi.fn(),
  setActiveScope: vi.fn(),
  planCardProps: [] as { initialCollapsed?: boolean }[],
}));
```

既存の `PlanDocumentCard` モックを次に置き換える。

```tsx
vi.mock("./PlanDocumentCard", () => ({
  PlanDocumentCard: ({
    onApprove,
    initialCollapsed,
  }: {
    onApprove?: () => void;
    initialCollapsed?: boolean;
  }) => {
    planCardProps.push({ initialCollapsed });
    return onApprove ? (
      <button onClick={() => void onApprove()}>計画を承認</button>
    ) : null;
  },
}));
```

`beforeEach` の先頭付近で記録をリセットする。

```tsx
planCardProps.length = 0;
```

- [ ] **Step 2: スマホ・デスクトップのprop伝播に対する失敗テストを書く**

既存の承認テストで使うplanメッセージ構造を再利用できるよう、同じ `visibleMessages` を各テストで設定する。`TaskView` のdescribe内へ次のテストを追加する。

```tsx
it.each([
  { matches: false, expected: true, label: "mobile" },
  { matches: true, expected: false, label: "desktop" },
])("sets the plan initial state from the $label breakpoint", async ({ matches, expected }) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  const streamMock = useSessionStream();
  useSessionStream.mockReturnValue({
    ...streamMock,
    visibleMessages: [{
      info: {
        id: "plan-1",
        role: "assistant",
        agent: "plan",
        time: { completed: 1 },
      },
      parts: [{ id: "plan-text", type: "text", text: "/repo/plan.md" }],
    }],
  });

  render(<TaskView taskId="ws1" />);
  await flushTaskLoad();

  expect(planCardProps.at(-1)?.initialCollapsed).toBe(expected);
});
```

- [ ] **Step 3: テストが期待どおり失敗することを確認する**

Run:

```bash
cd web && npx vitest run src/components/task/TaskView.test.tsx -t "sets the plan initial state"
```

Expected: FAIL。現行の `TaskView` は `initialCollapsed` を渡さないため、記録値が `undefined` になる。

- [ ] **Step 4: TaskViewから初期最小化指定を渡す**

`web/src/components/task/TaskView.tsx` の `PlanDocumentCard` 呼び出しに1行追加する。

```tsx
<PlanDocumentCard
  path={planPaths.get(m.info.id)!}
  directory={task.directory}
  actionable={m.info.id === actionablePlanMessageId}
  working={working}
  approved={approvedPlanIds.has(m.info.id)}
  initialCollapsed={!isMd}
  onApprove={approvePlan}
/>
```

- [ ] **Step 5: 関連テストと型チェックを通す**

Run:

```bash
cd web && npx vitest run src/components/task/PlanDocumentCard.test.tsx src/components/task/TaskView.test.tsx && npm run typecheck
```

Expected: 対象テストがすべてPASSし、TypeScriptエラーが0件。

- [ ] **Step 6: 既存hostで任意の短い手動確認を行う**

既存hostが応答する場合のみ、スマホ幅とデスクトップ幅でプランカードを確認する。追加サーバーは起動しない。

Manual checks:

```text
375px: 初期最小化、ヘッダーから展開、展開後に承認ボタンを操作可能
768px以上: 初期展開
両方: 開閉後も本文・承認状態が破損しない
```

Expected: 上記を満たす。既存hostに対象プランがなければ「Skipped: 対象データなし」と記録する。

- [ ] **Step 7: 差分を確認して即コミットする**

Run:

```bash
git status --short
git diff -- web/src/components/task/TaskView.tsx web/src/components/task/TaskView.test.tsx
git add web/src/components/task/TaskView.tsx web/src/components/task/TaskView.test.tsx
git commit -m "feat: スマホでプランを初期最小化"
git log --oneline -1
```

Expected: コミット出力と最新ログに新しいコミットハッシュが表示される。

---

### Task 3: MEMORY.mdへ判断と教訓を記録

**Files:**
- Modify: `MEMORY.md`

**Interfaces:**
- Consumes: Task 1とTask 2の実装結果、検証結果、手動確認の実施またはスキップ理由。
- Produces: 「やったこと・判断理由・教訓」を含む追記式の作業記録。

- [ ] **Step 1: 現在のMEMORY.md末尾を再読込して追記する**

既存エントリを変更せず、同じ書式に合わせて次の内容を追記する。日付見出しや箇条書き記号は既存書式を優先する。

```markdown
## 2026-07-23 スマホ向けプラン初期最小化

- やったこと: 768px未満では承認待ちを含むすべてのプランカードを初期最小化し、ヘッダーから展開・再最小化できるようにした。
- 判断理由: 既存の `TaskView.isMd` を画面幅判定の正として再利用し、カード内の重複した `matchMedia` と状態同期を避けた。デスクトップの初期展開は維持した。
- 教訓: レスポンシブな初期値とユーザー操作後の状態は分離し、画面幅変更でユーザーの開閉操作を上書きしない。
- 検証: `PlanDocumentCard.test.tsx`、`TaskView.test.tsx`、`npm run typecheck` の結果と、手動確認の実施またはスキップ理由を記録した。
```

- [ ] **Step 2: 差分と秘密情報がないことを確認する**

Run:

```bash
git status --short
git diff -- MEMORY.md
```

Expected: 今回の追記だけが表示され、APIキー、トークン、パスワードを含まない。

- [ ] **Step 3: MEMORY.mdをコミットして反映を確認する**

Run:

```bash
git add MEMORY.md
git commit -m "docs: スマホのプラン初期最小化判断を記録"
git log --oneline -1
```

Expected: コミット出力と最新ログに新しいコミットハッシュが表示される。

- [ ] **Step 4: 終了チェックを行う**

Run:

```bash
git status --short
```

Expected: 出力が空。出所不明の差分があれば破棄・混在せず、所有者を確認する。
