> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

# ARIA 準拠: TaskView ヘッダー操作を標準 kebab menu とセッション切替 dialog に分離する

**Goal:** TaskView ヘッダーからコピー・再同期・セッション切替・ターミナルの直表示をなくし、4 操作を kebab に集約する。`role="menu"` 内は標準 `menuitem` のみとし、セッション追加/切替は menuitem が開くアクセシブルな dialog で行う。

**Architecture:** `HeaderKebabMenu` を `KebabGroup.items` だけを描画する元の標準 menuitem 専用構造へ戻す。`TaskView` は既存のコピー・再同期・パネル切替を `KebabItem` として定義し、セッション用 item の選択で新規 `SessionSwitcherDialog` を開く。dialog が既存の `SessionSwitcher` を内包し、フォーカストラップ、Escape、backdrop、成功後の refresh/close/focus return を担当する。`SessionSwitcher` のセッション取得・追加・切替ロジックには手を加えない。

**Tech Stack:** Next.js 15、React 19、TypeScript 5、Vitest 3、React Testing Library、Tailwind CSS v4、lucide-react。

## 現状確認と変更範囲

現在は先行実装により `HeaderKebabMenu` が `renderContent?: () => ReactNode` を持ち、`TaskView` が menu 内へ `SessionSwitcher`（select/button）を直接描画している。この構造は `role="menu"` の子を標準 menuitem に限定する改訂仕様に反するため、次のファイルだけを変更する。

| 区分 | ファイル | 変更内容 |
|---|---|---|
| Modify | `web/src/components/task/HeaderKebabMenu.tsx` | `renderContent` の型・分岐・custom content 用フォーカス処理を削除し、標準 `KebabItem` のみを描画する |
| Modify | `web/src/components/task/HeaderKebabMenu.test.tsx` | custom group を前提とするテストを標準 menuitem 専用の回帰テストへ置換する |
| Create | `web/src/components/task/SessionSwitcherDialog.tsx` | dialog の ARIA、初期フォーカス、Tab trap、Escape/backdrop close を実装する |
| Create | `web/src/components/task/SessionSwitcherDialog.test.tsx` | dialog 単体のキーボード・backdrop・成功コールバックを TDD で固定する |
| Modify | `web/src/components/task/TaskView.tsx` | 4 操作の配置、dialog state、成功時 refresh/close/focus return を接続する |
| Modify | `web/src/components/task/TaskView.test.tsx` | 4 操作移動と dialog 連携の回帰テストを更新・追加する |
| Read-only | `web/src/components/task/SessionSwitcher.tsx` | 既存の `workspaceId`、`directory`、`currentSessionId`、`onSwitch: () => void` 契約および内部ロジックを変更しない |

`HeaderKebabMenu` の trigger の現行デフォルト名は「その他の操作」だが、改訂仕様の focus return は `button[aria-label="メニューを開く"]` を対象にする。`TaskView` 側で `triggerLabel="メニューを開く"` を明示して selector と実 DOM を一致させる。`HeaderKebabMenu` の ref forward や public API 追加はしない。

## 守る制約

- menu 内に `select`、ネイティブ `button`、`dialog`、custom content を描画しない。各操作は既存 `KebabItem` が描画する `role="menuitem"` のみとする。
- `HeaderKebabMenu` の既存 `aria-haspopup`、`aria-expanded`、`aria-controls`、`role="menu"`、`aria-disabled`、`aria-current`、ArrowUp/ArrowDown、Enter/Space、Escape、outside click、trigger 再クリックの回帰対策、`z-30` を保つ。
- `SessionSwitcher` は変更しない。追加/切替の成功時に呼ぶ既存の `onSwitch()` を、dialog 外の `TaskView` 処理へ接続するだけにする。
- `task.sessionId` がない場合は、`session-switcher` グループ自体を追加せず dialog も開けない。
- コピー成功の `copied` state と 1,500ms の reset、再同期の `stream.resync()` と `setDiffKey((key) => key + 1)` を維持する。
- Zone A は停止（working 時）と `CompactButton`（session 時）のみ。Zone B は `isLg` 時のファイルツリー・グラフ・Diff のみ。ターミナルは全幅で kebab 内だけにする。`isMd` はプランカード初期折りたたみ等の既存用途があるため削除しない。
- 新しい依存、CSS token、z-index 体系、`createPortal` は追加しない。dialog は `TaskView` の DOM ツリー内に置く。
- 作業開始前・各編集直前・コミット直前に `git status --short` を確認する。既存の `.superpowers/sdd/task-8-report.md`、`web/src/components/shell/Sidebar.tsx`、`web/src/components/shell/Sidebar.test.tsx`、`web/src/lib/path-validation.ts` と、以後に見つかった自分以外の未コミット差分には触れず、stage しない。

---

### Task 1: `HeaderKebabMenu` を標準 menuitem 専用へ戻す

**Files:**
- Modify: `web/src/components/task/HeaderKebabMenu.tsx`
- Modify: `web/src/components/task/HeaderKebabMenu.test.tsx`

**Interface after this task:**

```ts
export type KebabItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
  active?: boolean;
  danger?: boolean;
};

export type KebabGroup = {
  id: string;
  label?: string;
  items: KebabItem[];
};
```

- [ ] **Step 1: custom content を許容しない失敗テストへ置き換える**

`HeaderKebabMenu.test.tsx` の先頭にある `renderContent` を渡すテストを削除する。import を `HeaderKebabMenu, type KebabGroup` に更新し、代わりに複数 group の通常 items だけを渡して次を確認するテストを書く。

1. trigger を押すと `role="menu"` 内に全操作が `role="menuitem"` として描画され、group label が維持される。
2. popup 内に `combobox`、`button`、`dialog` が存在しない（trigger は menu の外なので `within(menu)` で検査する）。
3. opening 後の最初の有効な item への focus、ArrowDown/ArrowUp の wrap、disabled item の skip、Enter と Space による `onSelect` 呼び出しを確認する。
4. 現在ある trigger 再クリック時の reopen 防止、plain click、outside pointerdown のテストは残す。

さらに test file の型検査対象となる位置へ、次の compile-time regression を置く。現行 API では `@ts-expect-error` が未使用となるため型チェックが失敗し、`renderContent` 削除後だけ成立する。

```ts
const standardGroup: KebabGroup = {
  id: "standard",
  items: [],
  // @ts-expect-error HeaderKebabMenu accepts standard KebabItem groups only.
  renderContent: () => null,
};
void standardGroup;
```

テストは既存の `screen`、`fireEvent`、`waitFor`、`within` と Vitest の globals を使う。不要になった `createEvent`、custom select/button を削除する。

- [ ] **Step 2: 失敗を確認する**

Run: `cd web && npx tsc --noEmit`

Expected: FAIL。現在の `KebabGroup` は `renderContent` を許容するため、上記 `@ts-expect-error` が未使用という TypeScript error になる。

- [ ] **Step 3: `renderContent` に関する実装を削除する**

`HeaderKebabMenu.tsx` を以下のように限定する。

1. `KebabGroup` から `renderContent?: () => ReactNode` とそのコメントを削除する。`KebabItem.icon` が `ReactNode` を使うため、`type ReactNode` import は残す。
2. `flatItems` を `const flatItems = groups.flatMap((group) => group.items);` に戻し、全 group の非 disabled item で `focusableIds` を作る。
3. `visibleGroups` を `groups.filter((group) => group.items.length > 0)` に戻す。
4. popup 内の group 描画を `group.items.map(...)` のみとする。`group.renderContent ? ... : ...` の分岐を完全に削除する。
5. `onBlurCapture`、標準 menuitem の `Tab`（自然な focus 移動後に blur で閉じる）を含む既存の keyboard/blur 挙動は、custom content のためだけに追加した条件を除き保持する。

この時点で `HeaderKebabMenu` は `KebabItem` 以外の interactive content を受け取れず、実 DOM の `role="menu"` 内には標準 menuitem だけが残る。

- [ ] **Step 4: 対象テストを成功させる**

Run: `cd web && npx vitest run src/components/task/HeaderKebabMenu.test.tsx`

Expected: PASS。標準 items の roving focus と既存 close 挙動に回帰がなく、menu 内に custom interactive content がない。

---

### Task 2: `SessionSwitcherDialog` を TDD で追加する

**Files:**
- Create: `web/src/components/task/SessionSwitcherDialog.tsx`
- Create: `web/src/components/task/SessionSwitcherDialog.test.tsx`

**Component contract:**

```ts
type SessionSwitcherDialogProps = {
  workspaceId: string;
  directory: string;
  currentSessionId: string;
  onSwitch: () => Promise<void>;
  onClose: () => void;
};
```

`SessionSwitcher` 自身の `onSwitch: () => void` とは異なるため、dialog は `onSwitch={() => void onSwitch()}` を渡す。`SessionSwitcher` が成功時だけその callback を呼ぶ既存契約により、dialog はセッション操作の内部状態を複製しない。

- [ ] **Step 1: dialog の失敗テストを書く**

`SessionSwitcherDialog.test.tsx` で `./SessionSwitcher` を mock し、focusable な `<select aria-label="セッション切替" />` と `<button aria-label="新セッション" onClick={onSwitch}>` を同期的に描画する。以下を個別テストにする。

1. `role="dialog"`、`aria-modal="true"`、`aria-label="セッションを切り替え・追加"`、説明用の `aria-describedby` があり、dialog 内に mock switcher がある。
2. mount 後は先頭の focusable element（mock select）へ focus する。最終 button で Tab は select へ、先頭 select で Shift+Tab は button へ循環し、各 event が `defaultPrevented` になる。
3. Escape は `onClose` を一度だけ呼ぶ。
4. `role="presentation"` の backdrop click は `onClose` を呼ぶが、dialog 本体 click は backdrop close を発生させない。
5. mock の「新セッション」クリックは `onSwitch` を呼び、dialog コンポーネント単体では独自の refresh、close、focus 操作をしない。

- [ ] **Step 2: 失敗を確認する**

Run: `cd web && npx vitest run src/components/task/SessionSwitcherDialog.test.tsx`

Expected: FAIL。コンポーネントが未作成のため import を解決できない。

- [ ] **Step 3: dialog を最小実装する**

`SessionSwitcherDialog.tsx` を作る。実装は次の責務だけを持つ。

1. `useRef<HTMLDivElement>(null)` を dialog container に付ける。focusable selector は `button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])` とし、disabled 要素を除外する helper をローカルに作る。
2. mount 時の `useEffect` で最初の focusable element に `focus()` する。候補がないときは `tabIndex={-1}` を付けた dialog container に focus する。
3. dialog の `onKeyDown` で Escape は `preventDefault()` 後に `onClose()`、Tab/Shift+Tab は先頭・末尾で `preventDefault()` と focus wrap を行う。中間要素はブラウザの自然な Tab 移動に任せる。
4. `fixed inset-0 z-40 flex items-center justify-center p-4` の container 内に、dialog と sibling の backdrop を置く。backdrop は `role="presentation"`、`fixed inset-0 bg-black/50`、`onClick={onClose}` とする。dialog は backdrop の sibling にして、内部 click で close しない構造にする。
5. dialog に `role="dialog"`、`aria-modal="true"`、`aria-label="セッションを切り替え・追加"`、`aria-describedby="session-switcher-desc"` を付け、説明文を `<p id="session-switcher-desc" className="sr-only">` として置く。
6. dialog 内で既存 `SessionSwitcher` を props を変更せずに render する。`onSwitch` には `() => void onSwitch()` を渡す。

モバイルでは `max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto` を dialog panel に設定し、既存 token class だけを用いる。bottom-sheet の新規デザインは導入しない。

- [ ] **Step 4: dialog テストを成功させる**

Run: `cd web && npx vitest run src/components/task/SessionSwitcherDialog.test.tsx`

Expected: PASS。dialog が自律的に accessibility と close/trap を担い、セッション操作ロジックは mock/実 `SessionSwitcher` に残る。

---

### Task 3: `TaskView` の 4 操作移動と dialog 接続を TDD で完成する

**Files:**
- Modify: `web/src/components/task/TaskView.tsx`
- Modify: `web/src/components/task/TaskView.test.tsx`

- [ ] **Step 1: `TaskView` の失敗テストを ARIA 構造へ更新する**

既存の `moves copy, resync, session switching, and terminal into the kebab menu` テストを更新する。現在の `within(sessionGroup).getByRole("combobox")` と `getByRole("button", { name: "新セッション" })` は menu 内に `SessionSwitcher` を描画する旧仕様なので削除し、以下を確認する。

1. Zone A/Zone B に `title="作業パスをコピー"`、`title="再同期"`、`title="ターミナル"`、`data-testid="session-switcher"` がない。停止と `CompactButton` は残り、lg mock ではファイルツリー・グラフ・Diff は残る。
2. `aria-label="メニューを開く"` の trigger を開くと、menu に「作業パスをコピー」「再同期」「セッションを切り替え・追加」「ターミナル」が全て `menuitem` としてある。`within(menu).queryByRole("combobox")`、`queryByRole("button")`、`queryByRole("dialog")` はすべて null。
3. 「セッションを切り替え・追加」を click すると menu は閉じ、`role="dialog"` が開き、dialog 内に mock `SessionSwitcher` の combobox/button がある。初期 focus は select を `waitFor` で確認する。
4. dialog の最終 button で Tab、先頭 select で Shift+Tab を発火し、循環と `defaultPrevented` を検証する。Escape と backdrop click を別々に検証し、dialog が閉じて `aria-label="メニューを開く"` trigger に focus が戻ることを `waitFor` で確認する。
5. dialog 内の「新セッション」を click した成功ケースで `getJson` を事前 clear し、`refreshTask()` による `/api/tasks/ws1` 呼び出し、dialog close、trigger への focus return を `waitFor` で確認する。

既存 mock の `SessionSwitcher` は `onSwitch` をボタンから呼ぶ現在の形を維持できる。必要なら `SessionSwitcherDialog` を import する実装に追従して mock location は変えず、`TaskView` が callback を正しく接続する統合テストに限定する。

- [ ] **Step 2: 残る 3 操作とレスポンシブの失敗テストを具体化する**

既存のコピー/ターミナル/低幅テストを以下の粒度に分ける。

1. **コピー:** idle stream で kebab の「作業パスをコピー」を選択し、`copyText("/repo")` を検証する。再開した kebab item の `svg.lucide-check` を確認し、fake timer を 1,500ms 進めて同 item の `svg.lucide-copy` を確認する。
2. **再同期:** idle stream で「再同期」を選択し、`streamMock.resync` が一度呼ばれ、mock `DiffPane` が収集する `diffPaneRefreshKeys` に `1` が含まれることを検証する。working stream では item が `aria-disabled="true"` で click しても resync されないケースも追加する。
3. **ターミナル:** lg と lg 未満の両方で header に `title="ターミナル"` がなく、kebab に `menuitem` があることを確認する。その item の選択で `data-testid="pty-panel"` が表示されることを検証する。
4. **既存 Zone B:** lg 未満ではファイルツリー・グラフ・Diff が header に無く kebab にある、lg では header に残る、という既存回帰を保持する。

- [ ] **Step 3: `TaskView` テストの失敗を確認する**

Run: `cd web && npx vitest run src/components/task/TaskView.test.tsx`

Expected: FAIL。現行 `renderContent` 実装では menu 内に combobox/button があり、session item、dialog、focus return、disabled resync の期待を満たさない。

- [ ] **Step 4: `TaskView` の menu groups を標準 item と dialog state に置換する**

1. lucide import に `Layers`、component import に `SessionSwitcherDialog` を追加し、`TaskView` から `SessionSwitcher` の直接 import を削除する。
2. state 群に `const [sessionDialogOpen, setSessionDialogOpen] = useState(false);` を追加する。
3. `closeSessionDialog` を `useCallback` で定義する。`setSessionDialogOpen(false)` の直後、`window.setTimeout(..., 0)` で `document.querySelector<HTMLButtonElement>('button[aria-label="メニューを開く"]')?.focus()` を実行する。DOM unmount 後に focus するため timeout を使い、HeaderKebabMenu の ref/API は変更しない。
4. `handleSessionSwitch` を `useCallback(async () => { await refreshTask(); closeSessionDialog(); }, [refreshTask, closeSessionDialog])` として定義する。これが既存 `SessionSwitcher` の成功 callback から呼ばれる唯一の親処理である。
5. `headerKebabGroups` の現行 `{ id: "session-switcher", items: [], renderContent: ... }` を削除する。`task?.sessionId` がある場合だけ、次の標準 group を追加する。

```tsx
{
  id: "session-switcher",
  label: "セッション切替",
  items: [{
    id: "open-session-switcher",
    label: "セッションを切り替え・追加",
    icon: <Layers className="h-4 w-4" />,
    onSelect: () => setSessionDialogOpen(true),
  }],
}
```

6. 現在ある `task` group の copy/resync と `panel-terminal` の常時追加は維持する。`panel-files`、`panel-graph`、`panel-diff` の `!isLg` 条件も維持する。
7. dependencies に `setSessionDialogOpen` は不要だが、新しい callback を参照する場合は `headerKebabGroups` の `useMemo` に正確に追加する。既存の `copied`、`copyPath`、`working`、`stream` は保持する。
8. Header の `<HeaderKebabMenu>` に `triggerLabel="メニューを開く"` を渡す。
9. header の外、TaskView の return 内（portal は使わない）で、`sessionDialogOpen && task.sessionId` のときだけ `SessionSwitcherDialog` を render する。`workspaceId={task.id}`、`directory={task.directory}`、`currentSessionId={task.sessionId}`、`onSwitch={handleSessionSwitch}`、`onClose={closeSessionDialog}` を渡す。

- [ ] **Step 5: TaskView の対象テストを成功させる**

Run: `cd web && npx vitest run src/components/task/TaskView.test.tsx`

Expected: PASS。4 操作は重複せず、menu 内は `menuitem` だけで、dialog の open/trap/Escape/backdrop/成功 focus return と既存のコピー・再同期・PTY 動作が確認できる。

---

### Task 4: 型・lint・回帰を検証し、差分をレビューする

**Files:** Task 1–3 の6ファイルのみ（`SessionSwitcher.tsx` を含めない）。

- [ ] **Step 1: focused test suite を実行する**

Run:

```bash
cd web && npx vitest run src/components/task/HeaderKebabMenu.test.tsx src/components/task/SessionSwitcherDialog.test.tsx src/components/task/TaskView.test.tsx
```

Expected: PASS。

- [ ] **Step 2: 静的検証を実行する**

Run:

```bash
cd web && npx tsc --noEmit
cd web && npx eslint src/components/task/HeaderKebabMenu.tsx src/components/task/SessionSwitcherDialog.tsx src/components/task/TaskView.tsx src/components/task/HeaderKebabMenu.test.tsx src/components/task/SessionSwitcherDialog.test.tsx src/components/task/TaskView.test.tsx
```

Expected: いずれも exit code 0。常駐サーバーは起動しない。

- [ ] **Step 3: 実装差分を自己レビューする**

Run:

```bash
git diff --check
git diff -- web/src/components/task/HeaderKebabMenu.tsx web/src/components/task/HeaderKebabMenu.test.tsx web/src/components/task/SessionSwitcherDialog.tsx web/src/components/task/SessionSwitcherDialog.test.tsx web/src/components/task/TaskView.tsx web/src/components/task/TaskView.test.tsx
git status --short
```

Review checklist:

- `renderContent` の参照が `HeaderKebabMenu.tsx`、`TaskView.tsx`、テストから完全に消えている。
- `role="menu"` の子に `select`/button/dialog がなく、セッション item は通常の menuitem である。
- `SessionSwitcher.tsx` に差分がない。
- dialog は first focus、両方向 Tab trap、Escape、backdrop、成功時の `refreshTask → close → trigger focus` を全て満たす。
- copy/resync/terminal の action callback と `copied` 1.5秒表示が変更されていない。
- side effects や自分以外の未関係差分が stage 対象に混入していない。

- [ ] **Step 4: 手動ブラウザ確認を記録する**

エージェントは常駐サーバーを起動しない。既存 host で確認できる場合にのみ、以下を手動確認する。

1. 768px 未満、768–1023px、1024px 以上で直表示・kebab 配置が仕様表どおり。
2. dialog を開いた直後の focus、Tab/Shift+Tab、Escape、backdrop、成功後の trigger return。
3. コピー icon、再同期、ターミナルのパネル切替。

実施できなければ「手動確認は host 利用者へ委譲」と明記し、実施したと偽らない。

## 実装完了時の受け入れ条件

1. `HeaderKebabMenu` は `renderContent` を持たず、標準 `KebabItem` だけを `role="menuitem"` として描画する。
2. コピー、再同期、セッション追加/切替、ターミナルは header 直表示に存在せず、全幅で kebab から利用できる。
3. `SessionSwitcher` の内部コードを変えず、menuitem が開く `SessionSwitcherDialog` 内でのみ利用する。
4. dialog は `role="dialog"`、`aria-modal="true"`、説明、初期 focus、Tab/Shift+Tab trap、Escape、backdrop close を備える。
5. セッション追加/切替成功時は `refreshTask()` 完了後に dialog を閉じ、`aria-label="メニューを開く"` の kebab trigger へ focus を戻す。
6. copy の 1.5秒 Check 表示、resync の diff refresh、terminal の PTY 表示、Zone A/Zone B の既存動作を維持する。
7. focused Vitest、`tsc --noEmit`、対象 ESLint、`git diff --check` が成功する。
