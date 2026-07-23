# TaskViewヘッダー操作のケバブメニュー集約 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `TaskView` ヘッダーからコピー・再同期・セッション切替・ターミナルの直表示をなくし、全幅で利用できる `HeaderKebabMenu` に集約する。

**Architecture:** `HeaderKebabMenu` の `KebabGroup` に任意の `renderContent` を加え、標準の `KebabItem` と異なるセッション切替UIをグループ内へ安全に描画できるようにする。標準項目だけを矢印キーのロービングフォーカス対象とし、カスタム領域は Tab の通常順序で通過させる。`TaskView` は既存の `copyPath`、`stream.resync`、`SessionSwitcher`、パネル状態更新コールバックをそのまま新しいグループ定義へ渡す。

**Tech Stack:** Next.js 15、React 19、TypeScript 5、Vitest 3、React Testing Library、Tailwind CSS v4、lucide-react。

## Global Constraints

- 変更対象は `web/src/components/task/HeaderKebabMenu.tsx`、`web/src/components/task/TaskView.tsx`、各対応テストだけとする。`web/src/components/task/SessionSwitcher.tsx:9-108` は読み取り専用で、既存の取得・作成・切替ロジックを変更しない。
- `KebabGroup` は `items: KebabItem[]` を維持し、`renderContent?: () => ReactNode` を追加する。`renderContent` があるグループでは `items` を描画・矢印フォーカス対象のどちらにも使わない。
- `HeaderKebabMenu` の `aria-haspopup`、`aria-expanded`、`role="menu"`、標準項目の `role="menuitem"` / `aria-disabled` / `aria-current`、Escape・outside click・Enter・Space を維持する。`z-30` は変更しない。
- カスタムのセッション切替領域は `SessionSwitcher` が既に提供する `aria-label="セッション切替"`、`aria-label="セッションを追加"` または `aria-label="新セッション"` をそのまま使う。ArrowUp / ArrowDown はその領域を飛ばし、Tab はメニューを閉じずに領域へ入り、最後の標準項目から外へ移ったときだけ閉じる。
- `task.sessionId` がないときは `session-switcher` グループを作らない。1件時の追加ボタン、複数時の select と追加ボタンは `SessionSwitcher` の既存分岐に委ねる。
- コピー成功時の `copied` state と 1,500ms のリセットは `TaskView` に維持する。メニューを閉じても state を破棄せず、再開時は `Check` アイコンを表示する。
- コピー、再同期、`SessionSwitcher`、ターミナルをヘッダー直表示から削除する。停止（working時）と `CompactButton`（session時）は直表示のままにする。ファイルツリー、グラフ、Diffは `isLg` 時のみ直表示、ターミナルは全幅でケバブ内だけにする。
- 新規依存、CSS変数・トークン、z-index、`isMd` state の他用途（プランカード初期折りたたみ）は変更しない。常駐サーバーを起動しない。
- 作業開始時と各コミット直前に `git status --short` を確認する。他者の未コミット差分、および `host/src/setup-bat.test.js` の差分が存在する場合は触れず、`git add` に含めない。

---

### Task 1: カスタムグループ描画とキーボード通過を `HeaderKebabMenu` に追加する

**Files:**
- Modify: `web/src/components/task/HeaderKebabMenu.tsx:1-197`（型、フォーカス対象の平坦化、可視グループ判定、ポップアップのフォーカス離脱、グループ描画）
- Create: `web/src/components/task/HeaderKebabMenu.test.tsx`

**Interfaces:**
- Consumes: `KebabItem` の `{ id: string; label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean; busy?: boolean; active?: boolean; danger?: boolean }`。
- Produces: `KebabGroup` の `{ id: string; label?: string; items: KebabItem[]; renderContent?: () => ReactNode }`。`renderContent` は指定時に標準 `items` を完全に置き換え、カスタムDOMを返す。
- Produces: `HeaderKebabMenu` は custom group を `items: []` でも表示し、ArrowUp / ArrowDown の対象から外し、Tab による custom control 間の自然な移動を維持する。

- [ ] **Step 1: カスタムグループとキーボード順序の失敗テストを書く**

`web/src/components/task/HeaderKebabMenu.test.tsx` を作成し、既存の `TaskView.test.tsx` と同じ Vitest + React Testing Library の書式で次を記述する。`items` にダミー項目を渡しても、`renderContent` が優先されてその項目が描画・矢印対象にならないことを検証する。

```tsx
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeaderKebabMenu } from "./HeaderKebabMenu";

describe("HeaderKebabMenu", () => {
  it("renders custom group content, skips it with arrows, and preserves Tab traversal", async () => {
    const onSelect = vi.fn();
    render(
      <>
        <HeaderKebabMenu
          groups={[
            {
              id: "first",
              label: "先頭",
              items: [{ id: "first-item", label: "先頭の操作", onSelect }],
            },
            {
              id: "session-switcher",
              label: "セッション切替",
              items: [{ id: "ignored", label: "描画されない操作", onSelect }],
              renderContent: () => (
                <div>
                  <select aria-label="セッション切替"><option>Session 1</option></select>
                  <button type="button" aria-label="新セッション">追加</button>
                </div>
              ),
            },
            {
              id: "last",
              label: "末尾",
              items: [{ id: "last-item", label: "末尾の操作", onSelect }],
            },
          ]}
        />
        <button type="button">メニュー外</button>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
    const first = await screen.findByRole("menuitem", { name: "先頭の操作" });
    const last = screen.getByRole("menuitem", { name: "末尾の操作" });
    const select = screen.getByRole("combobox", { name: "セッション切替" });

    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(screen.queryByRole("menuitem", { name: "描画されない操作" })).toBeNull();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    const tab = createEvent.keyDown(first, { key: "Tab" });
    fireEvent(first, tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(screen.getByRole("menu")).toBeTruthy();

    // JSDOM は Tab のブラウザ既定フォーカス移動を実行しないため、移動先だけを再現する。
    (select as HTMLSelectElement).focus();
    expect(document.activeElement).toBe(select);
    const add = screen.getByRole("button", { name: "新セッション" });
    const customTab = createEvent.keyDown(select, { key: "Tab" });
    fireEvent(select, customTab);
    expect(customTab.defaultPrevented).toBe(false);
    (add as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(add);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd web && npx vitest run src/components/task/HeaderKebabMenu.test.tsx`

Expected: FAIL — `KebabGroup` に `renderContent` がなく、`items: []` のカスタムグループが現在の `visibleGroups` フィルタで除外されるため、`セッション切替` の combobox を取得できない。

- [ ] **Step 3: 型・描画・フォーカス離脱を最小実装する**

`web/src/components/task/HeaderKebabMenu.tsx` の `KebabGroup` を次に置き換える。`ReactNode` は既に同ファイルで type import 済みである。

```tsx
export type KebabGroup = {
  id: string;
  label?: string;
  items: KebabItem[];
  /** 指定時は items ではなく、この内容をグループ内に描画する。 */
  renderContent?: () => ReactNode;
};
```

標準項目だけを平坦化し、custom group を可視とする。これにより、将来 `renderContent` と誤って非空 `items` を併用しても、存在しない標準DOMへフォーカスしない。

```tsx
const flatItems = groups.flatMap((group) =>
  group.renderContent ? [] : group.items,
);
const focusableIds = flatItems
  .filter((item) => !item.disabled)
  .map((item) => item.id);

const visibleGroups = groups.filter(
  (group) => group.items.length > 0 || group.renderContent !== undefined,
);
```

`role="menu"` のポップアップdivへ次を追加し、フォーカスが popup 外へ出た場合だけ閉じる。popup 内の標準項目、select、button 間の移動では `relatedTarget` が popup 内なので開いたままになる。

```tsx
onBlurCapture={(event) => {
  const next = event.relatedTarget as Node | null;
  if (!next || !popupRef.current?.contains(next)) close(false);
}}
```

標準項目の `onKeyDown` にある `Tab` 分岐を次に置換する。`preventDefault` も `close(false)` もせず、ブラウザに次の focusable element（custom group の select/button または次の標準項目）を選ばせる。

```tsx
if (e.key === "Tab") {
  return;
}
```

最後にグループ内容の map を次の完全な分岐に置換する。

```tsx
{group.renderContent ? (
  group.renderContent()
) : (
  group.items.map((item) => {
    const isDisabled = !!item.disabled;
    return (
      <div
        key={item.id}
        ref={(element) => {
          itemRefs.current.set(item.id, element);
        }}
        role="menuitem"
        aria-disabled={isDisabled ? "true" : undefined}
        aria-current={item.active ? "true" : undefined}
        tabIndex={isDisabled ? -1 : 0}
        title={item.label}
        onClick={() => {
          if (isDisabled) return;
          item.onSelect();
          close(true);
        }}
        onKeyDown={(event) => {
          if (isDisabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            item.onSelect();
            close(true);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1, item.id);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1, item.id);
            return;
          }
          if (event.key === "Tab") return;
        }}
        className={cx(
          "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs outline-none transition-colors",
          "focus:bg-surface-2 focus:text-text",
          item.danger
            ? "text-danger hover:bg-danger-bg"
            : "text-muted hover:bg-surface-2 hover:text-text",
          isDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
        )}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {item.busy ? <Spinner className="h-3.5 w-3.5" /> : item.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.active && (
          <span
            aria-hidden="true"
            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
          />
        )}
      </div>
    );
  })
)}
```

- [ ] **Step 4: 対象テストを成功させる**

Run: `cd web && npx vitest run src/components/task/HeaderKebabMenu.test.tsx`

Expected: PASS — custom content が `role="group"` 内に存在し、矢印キーは先頭・末尾の標準項目間だけを移動し、Tab の default が抑止されない。

- [ ] **Step 5: この意味単位だけをコミットする**

Run:

```bash
git status --short
git diff -- web/src/components/task/HeaderKebabMenu.tsx web/src/components/task/HeaderKebabMenu.test.tsx
git add web/src/components/task/HeaderKebabMenu.tsx web/src/components/task/HeaderKebabMenu.test.tsx
git commit -m "feat: ヘッダーkebabにカスタムグループを追加"
git log --oneline -1
```

Expected: `HeaderKebabMenu.tsx` と `HeaderKebabMenu.test.tsx` だけのコミットが作成される。表示されたハッシュと日本語コミットメッセージを確認し、他者差分と `host/src/setup-bat.test.js` は staged されていない。

### Task 2: 集約後のヘッダー操作を `TaskView` の失敗テストで固定する

**Files:**
- Modify: `web/src/components/task/TaskView.test.tsx:1-107`（hoisted mock と `SessionSwitcher` / `CompactButton` / `PtyPanel` のテスト用描画）
- Modify: `web/src/components/task/TaskView.test.tsx:667-727`（最初の `describe("TaskView")` の終了直前に回帰テストを追加）

**Interfaces:**
- Consumes: `TaskSummary` の `id: "ws1"`、`directory: "/repo"`、`sessionId: "sess1"`、`status`、および `useSessionStream()` の `resync(): void`。
- Consumes: `copyText(text: string): Promise<boolean>`（`@/lib/clipboard`）と `SessionSwitcher` の `workspaceId`、`directory`、`currentSessionId`、`onSwitch` props。
- Produces: 直表示を排除しつつ、ケバブの task/session-switcher/panels グループからコピー、再同期、セッション切替、ターミナルを操作できる `TaskView` の回帰テスト。

- [ ] **Step 1: テスト用モックを拡張する**

`vi.hoisted` の返却値に `copyText` と `diffPaneRefreshKeys` を加え、その直後に clipboard mock を追加する。

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
  copyText,
  diffPaneRefreshKeys,
} = vi.hoisted(() => ({
  getJson: vi.fn(),
  notifyTasksChanged: vi.fn(),
  sendJson: vi.fn(),
  useSessionStream: vi.fn(),
  slashCommands: [] as { name: string }[],
  setExtras: vi.fn(),
  setActiveScope: vi.fn(),
  planCardProps: [] as { initialCollapsed?: boolean }[],
  copyText: vi.fn(),
  diffPaneRefreshKeys: [] as number[],
}));

vi.mock("@/lib/clipboard", () => ({ copyText }));
```

既存の component mocks を次に置換する。これは実 `SessionSwitcher` の内部通信を再テストせず、`TaskView` がその既存アクセシブルUIを custom group に渡し、`onSwitch` を `refreshTask` へ接続することだけを検証する。

```tsx
vi.mock("./DiffPane", () => ({
  DiffPane: ({ refreshKey }: { refreshKey: number }) => {
    diffPaneRefreshKeys.push(refreshKey);
    return null;
  },
}));
vi.mock("./PtyPanel", () => ({ PtyPanel: () => <div data-testid="pty-panel" /> }));
vi.mock("./SessionActions", () => ({
  CompactButton: () => <button type="button" aria-label="コンパクト">コンパクト</button>,
  MessageRevertButton: () => null,
  useSessionActions: () => ({
    busy: null,
    error: null,
    compact: vi.fn(),
    revert: vi.fn(),
    unrevert: vi.fn(),
  }),
}));
vi.mock("./SessionSwitcher", () => ({
  SessionSwitcher: ({ onSwitch }: { onSwitch: () => void }) => (
    <div data-testid="session-switcher">
      <select aria-label="セッション切替"><option value="sess1">Session 1</option></select>
      <button type="button" aria-label="新セッション" onClick={onSwitch}>追加</button>
    </div>
  ),
}));
```

各 `beforeEach` で `copyText.mockResolvedValue(true)` と `diffPaneRefreshKeys.length = 0` を設定する。

- [ ] **Step 2: 直表示削除、全幅ターミナル、既存コールバックを検証する失敗テストを書く**

`TaskView` の最初の describe の末尾へ次を追加する。テスト中は idle stream にして再同期項目を有効化する。

```tsx
it("moves copy, resync, session switching, and terminal into the kebab menu", async () => {
  taskStatus = "idle";
  const streamMock = useSessionStream();
  useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
  render(<TaskView taskId="ws1" />);
  await flushTaskLoad();

  expect(screen.queryByTitle("作業パスをコピー")).toBeNull();
  expect(screen.queryByTitle("再同期")).toBeNull();
  expect(screen.queryByTitle("ターミナル")).toBeNull();
  expect(screen.queryByTestId("session-switcher")).toBeNull();
  expect(screen.getByRole("button", { name: "コンパクト" })).toBeTruthy();
  expect(screen.getByTitle("ファイルツリー")).toBeTruthy();
  expect(screen.getByTitle("グラフ")).toBeTruthy();
  expect(screen.getByTitle("Diff パネル")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
  const menu = screen.getByRole("menu", { name: "タスクその他操作" });
  expect(within(menu).getByRole("menuitem", { name: "作業パスをコピー" })).toBeTruthy();
  expect(within(menu).getByRole("menuitem", { name: "再同期" })).toBeTruthy();
  expect(within(menu).getByRole("menuitem", { name: "ターミナル" })).toBeTruthy();
  const sessionGroup = within(menu).getByRole("group", { name: "セッション切替" });
  expect(within(sessionGroup).getByRole("combobox", { name: "セッション切替" })).toBeTruthy();
  expect(within(sessionGroup).getByRole("button", { name: "新セッション" })).toBeTruthy();

  getJson.mockClear();
  fireEvent.click(within(sessionGroup).getByRole("button", { name: "新セッション" }));
  await waitFor(() => {
    expect(getJson).toHaveBeenCalledWith("/api/tasks/ws1");
  });

  fireEvent.click(within(menu).getByRole("menuitem", { name: "再同期" }));
  expect(streamMock.resync).toHaveBeenCalledTimes(1);
  expect(diffPaneRefreshKeys).toContain(1);

  fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "ターミナル" }));
  expect(screen.getByTestId("pty-panel")).toBeTruthy();
});

it("shows the copied check icon from the kebab for 1.5 seconds", async () => {
  taskStatus = "idle";
  vi.useFakeTimers();
  const streamMock = useSessionStream();
  useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
  render(<TaskView taskId="ws1" />);
  await flushTaskLoad();

  fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "作業パスをコピー" }));
  await act(async () => { await Promise.resolve(); });
  expect(copyText).toHaveBeenCalledWith("/repo");

  fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
  const copiedItem = screen.getByRole("menuitem", { name: "作業パスをコピー" });
  expect(copiedItem.querySelector('svg[data-lucide="check"]')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(copiedItem.querySelector('svg[data-lucide="copy"]')).toBeTruthy();
});

it("keeps stop and CompactButton in the header while moving the session switcher", async () => {
  render(<TaskView taskId="ws1" />);
  await flushTaskLoad();

  expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "コンパクト" })).toBeTruthy();
  expect(screen.queryByTestId("session-switcher")).toBeNull();
});

it("keeps files, graph, and diff in the kebab below lg while terminal stays there", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  taskStatus = "idle";
  const streamMock = useSessionStream();
  useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
  render(<TaskView taskId="ws1" />);
  await flushTaskLoad();

  expect(screen.queryByTitle("ファイルツリー")).toBeNull();
  expect(screen.queryByTitle("グラフ")).toBeNull();
  expect(screen.queryByTitle("Diff パネル")).toBeNull();
  expect(screen.queryByTitle("ターミナル")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
  const menu = screen.getByRole("menu", { name: "タスクその他操作" });
  expect(within(menu).getByRole("menuitem", { name: "ファイルツリー" })).toBeTruthy();
  expect(within(menu).getByRole("menuitem", { name: "グラフ" })).toBeTruthy();
  expect(within(menu).getByRole("menuitem", { name: "Diff パネル" })).toBeTruthy();
  expect(within(menu).getByRole("menuitem", { name: "ターミナル" })).toBeTruthy();
});
```

- [ ] **Step 3: 失敗を確認する**

Run: `cd web && npx vitest run src/components/task/TaskView.test.tsx -t "moves copy|shows the copied"`

Expected: FAIL — 現在はコピー・再同期・SessionSwitcher・ターミナルが直表示で、kebab 内に `タスク操作`、`セッション切替`、常時ターミナルがない。

### Task 3: `TaskView` のグループ定義とツールバーを集約後の構成に置き換える

**Files:**
- Modify: `web/src/components/task/TaskView.tsx:1117-1124`（既存 `copyPath` は変更しない）
- Modify: `web/src/components/task/TaskView.tsx:1297-1405`（task/session-switcher グループ、常時 terminal、依存配列）
- Modify: `web/src/components/task/TaskView.tsx:1600-1733`（Zone A/Bの4直表示操作を削除し、コメントを更新）
- Test: `web/src/components/task/TaskView.test.tsx:1-107,667-727`（Task 2で追加）

**Interfaces:**
- Consumes: `copyPath(): Promise<void>`、`copied: boolean`、`working: boolean`、`stream.resync(): void`、`setDiffKey((key: number) => number): void`、`refreshTask(): Promise<void>`。
- Consumes: `SessionSwitcher({ workspaceId: string; directory: string; currentSessionId: string | null; onSwitch: () => void })`。
- Produces: `headerKebabGroups: KebabGroup[]` に `task`、条件付き `session-switcher`、常時 `panel-terminal` を含め、直表示は停止・Compact・lg時の files/graph/diff・ケバブだけにする。

- [ ] **Step 1: `task` と条件付き `session-switcher` グループを追加する**

`headerKebabGroups` の `sessionItems` の直後に次を追加する。再同期の `disabled: working` は working 中に二重同期しない既存UI上の制約を保つ。

```tsx
const taskItems: KebabItem[] = [
  {
    id: "copy-path",
    label: "作業パスをコピー",
    icon: copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />,
    onSelect: () => void copyPath(),
  },
  {
    id: "resync",
    label: "再同期",
    icon: <RefreshCw className="h-4 w-4" />,
    onSelect: () => {
      void stream.resync();
      setDiffKey((key) => key + 1);
    },
    disabled: working,
  },
];
```

`groups` を組み立てる箇所で session 操作の直後、パネルの直前に次を挿入する。`items: []` は Task 1 の `renderContent` 契約により有効な custom group である。

```tsx
groups.push({ id: "task", label: "タスク操作", items: taskItems });
if (task?.sessionId) {
  groups.push({
    id: "session-switcher",
    label: "セッション切替",
    items: [],
    renderContent: () => (
      <div className="px-3 py-1.5">
        <SessionSwitcher
          workspaceId={task.id}
          directory={task.directory}
          currentSessionId={task.sessionId}
          onSwitch={() => void refreshTask()}
        />
      </div>
    ),
  });
}
```

- [ ] **Step 2: ターミナルを全幅ケバブ項目へ固定する**

`panelItems` 内の `panel-terminal` の `!isMd` 条件をなくし、次の無条件 push に置換する。ファイルツリー・グラフ・Diffの `!isLg` 分岐は変更しない。

```tsx
panelItems.push({
  id: "panel-terminal",
  label: "ターミナル",
  icon: <Terminal className="h-4 w-4" />,
  active: showDiff && sidePanel === "pty",
  onSelect: () => {
    changeShowDiff(true);
    changeTab("diff");
    changeSidePanel("pty");
  },
});
```

`useMemo` の依存配列に、既存依存を残したうえで次を加える。`isMd` はこの memo から削除するが、TaskViewのプランカード用途が残るため state/effect 自体は削除しない。

```tsx
task?.id,
task?.directory,
copied,
copyPath,
working,
stream.resync,
refreshTask,
```

- [ ] **Step 3: Zone A/Bの4つの直表示を削除する**

Zone Aから次の2つの Button JSX と、`task.sessionId` ブロック内の `SessionSwitcher` JSX だけを削除する。`CompactButton` は同じ `task.sessionId` ブロックに残す。

```tsx
<Button variant="ghost" size="icon" title={copied ? "コピーしました" : "作業パスをコピー"} onClick={() => void copyPath()}>
  {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
</Button>
<Button variant="ghost" size="icon" title="再同期" onClick={() => { void stream.resync(); setDiffKey((key) => key + 1); }}>
  <RefreshCw className="h-4 w-4" />
</Button>
<SessionSwitcher
  workspaceId={task.id}
  directory={task.directory}
  currentSessionId={task.sessionId}
  onSwitch={() => void refreshTask()}
/>
```

Zone Bから次の `isMd` 条件ブロックを削除する。`Terminal` icon import は Step 2 の kebab項目が使用するため残す。

```tsx
{isMd && (
  <Button variant="ghost" size="icon" title="ターミナル" className={cx(showDiff && sidePanel === "pty" && "bg-surface-2 text-text")} onClick={() => {
    changeShowDiff(true);
    changeTab("diff");
    changeSidePanel("pty");
  }}>
    <Terminal className="h-4 w-4" />
  </Button>
)}
```

Zone A/B/C のコメントを「Zone A: 停止・Compact」「Zone B: files/graph/diff は lg」「Zone C: session、task、session-switcher、panels（terminal常時）、danger」と実際の構成に更新する。古い `terminal at md (768px)` と「パネル項目は重複しない」の記述は削除する。

- [ ] **Step 4: TaskView 回帰テストを成功させる**

Run: `cd web && npx vitest run src/components/task/TaskView.test.tsx`

Expected: PASS — 新しい4ケースを含む `TaskView.test.tsx` の全テストが通過し、コピーは `/repo` をコピー、再同期は一度呼ばれ refresh key が 1 となり、custom session UI とケバブ専用ターミナルが確認できる。

- [ ] **Step 5: 型・lint・関連コンポーネントテストを実行する**

Run:

```bash
cd web && npx tsc --noEmit
cd web && npx eslint src/components/task/
cd web && npx vitest run src/components/task/HeaderKebabMenu.test.tsx src/components/task/TaskView.test.tsx
```

Expected: すべて exit code 0。特に `renderContent` の `ReactNode`、`KebabGroup` の必須 `items`、`SessionSwitcher` の props、`useMemo` 依存配列に型・lintエラーがない。

- [ ] **Step 6: この意味単位だけをコミットする**

Run:

```bash
git status --short
git diff -- web/src/components/task/TaskView.tsx web/src/components/task/TaskView.test.tsx
git add web/src/components/task/TaskView.tsx web/src/components/task/TaskView.test.tsx
git commit -m "feat: ヘッダー操作をkebabメニューへ集約"
git log --oneline -1
```

Expected: `TaskView.tsx` と `TaskView.test.tsx` だけのコミットが作成される。`host/src/setup-bat.test.js` と他者の変更は含めず、先頭コミットを確認する。

## Self-review

- **Spec coverage:** Task 1 は `renderContent` 型、空 `items` の custom group 表示、標準項目だけの矢印ナビゲーション、Tab による session select/button への進入・脱出、既存ARIAと `z-30` を扱う。Task 2/3 はコピー・再同期・SessionSwitcher・ターミナルの4直表示削除、task/session-switcher/panelsへの配置、コピーの1.5秒 `Check`、`resync` と diff key、PTY表示、停止/Compactの維持、lg時files/graph/diffの既存条件を扱う。全幅ターミナルは `!isMd` を無条件 push へ置換して保証する。
- **Placeholder scan:** 実装対象、型、テスト名、テストコード、失敗・成功コマンド、期待結果、コミット対象をすべて明記した。未決定事項、未完マーカー、後続実装への曖昧な委任はない。
- **Type consistency:** `KebabGroup.renderContent` は `() => ReactNode`、TaskViewの custom group は必須の `items: []` を渡す。`SessionSwitcher` には実型どおり string の `workspaceId` / `directory`、`string | null` の `currentSessionId`、`() => void` の `onSwitch` を渡す。`KebabItem.onSelect` は既存どおり `() => void` なので非同期コピーと再同期は `void` で起動する。
- **Scope review:** `SessionSwitcher.tsx` は変更せず既存挙動を利用する。新規依存・トークン・常駐プロセス・無関係なファイルは追加しない。各コミット前の status 確認と限定した `git add` により他者差分および `host/src/setup-bat.test.js` を含めない。
