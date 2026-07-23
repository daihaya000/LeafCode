# TaskView ヘッダーツールバー操作のケバブメニュー集約 設計仕様書

## 背景

TaskView 右上ヘッダーツールバーには、Zone A（常時表示操作）として「作業パスをコピー」「再同期」「SessionSwitcher（セッション追加/切替）」「CompactButton」、Zone B（ブレークポイント依存のパネル切替）として「ファイルツリー」「グラフ」「ターミナル」「Diff パネル」、Zone C（ケバブメニュー）として「巻き戻し/取消」「パネル切替（Zone B 非表示時のみ）」「タスク削除」が配置されている。

このうち、常時表示されている Zone A の操作群が多く、特にスマートフォン幅では横スクロール領域が頻繁に発生する。また「ターミナル」は Zone B（md 以上で直接表示）と Zone C（md 未満でケバブ内）の二重定義になっており、一貫性を欠く。

本仕様は、以下の 4 操作をヘッダー直表示から削除し、既存の `HeaderKebabMenu` 内へ常時配置することで、ヘッダーを整理する。

## 目的

- ヘッダーツールバーの直表示操作を削減し、横スクロールの発生頻度を下げる
- 「ターミナル」の表示条件を二重定義から単一（常にケバブ内）に統一する
- 既存のアクセシビリティ（キーボード操作、ARIA）、レスポンシブ動作、全操作の機能を維持する
- ケバブ `role="menu"` 内の直接操作要素は標準 `menuitem` のみとし、select/button/dialog を menu 内部に描画しない ARIA 準拠を徹底する

## 対象と非対象

### 対象

- `web/src/components/task/TaskView.tsx` のヘッダーツールバー（Zone A / Zone B / Zone C）
- `web/src/components/task/HeaderKebabMenu.tsx` — 型・レンダリングロジックの変更は**行わない**（`renderContent` は追加しない）
- `web/src/components/task/SessionSwitcher.tsx` — 変更なし（コンポーネントはそのまま利用）
- `web/src/components/task/TaskView.test.tsx` — テストケースの更新
- セッション切替用アクセシブルダイアログ（新設: `SessionSwitcherDialog` または `TaskView` 内で `SessionSwitcher` をラップ）

### 非対象

- `HeaderKebabMenu` の開閉・キーボード・ARIA 実装そのもの
- `SessionSwitcher` の内部ロジック（セッション一覧取得、作成、切替）
- `CompactButton` の動作（ヘッダー直表示に残す）
- 停止ボタン（`working` 時のみ表示、ヘッダー直表示に残す）
- Zone B の「ファイルツリー」「グラフ」「Diff パネル」（ヘッダー直表示に残す）
- 色・トークン・z-index 体系
- サイドバー、AppShell、その他画面

## 移動対象操作の詳細

| # | 操作 | 現在の配置 | 移動先ケバブグループ | 備考 |
|---|------|-----------|---------------------|------|
| 1 | 作業パスをコピー | Zone A 常時表示 | `"task"`（新設） | `copyPath()` を呼ぶ。コピー成功時 1.5 秒間チェックアイコン表示（既存動作） |
| 2 | 再同期 | Zone A 常時表示 | `"task"`（新設） | `stream.resync()` + `setDiffKey(k+1)` を呼ぶ |
| 3 | セッション追加/切替 | Zone A（session 存在時） | `"session"`（既存グループ名を拡張） | 標準 `menuitem`「セッションを切り替え・追加」がアクセシブルダイアログを開く |
| 4 | ターミナル | Zone B（md 以上） + Zone C（md 未満） | `"panels"`（既存、常時表示） | 二重定義を解消し、常にケバブ内のみに表示 |

## ケバブメニュー構成（変更後）

### グループ構成

```
┌─────────────────────────────────┐
│ セッション操作                  │
│  巻き戻す (undo)                │
│  巻き戻しを取消す (redo)        │
├─────────────────────────────────┤
│ タスク操作          ← 新設      │
│  作業パスをコピー               │
│  再同期                         │
├─────────────────────────────────┤
│ セッション切替       ← 新設     │
│  セッションを切り替え・追加     │  ← 標準 menuitem、押下で dialog を開く
├─────────────────────────────────┤
│ パネル切替                      │
│  ファイルツリー                  │
│  グラフ                         │
│  ターミナル          ← 常時表示 │
│  Diff パネル                    │
├─────────────────────────────────┤
│ 危険操作                        │
│  タスクを削除                    │
└─────────────────────────────────┘
```

### 各グループの詳細

#### グループ `"session"`（セッション操作）— 既存、変更なし

| id | label | icon | 備考 |
|----|-------|------|------|
| `revert` | 巻き戻す (undo) | `RotateCcw` | session なし / busy 時 disabled |
| `unrevert` | 巻き戻しを取消す (redo) | `RotateCw` | session なし / busy 時 disabled |

#### グループ `"task"`（タスク操作）— 新設

| id | label | icon | 動作 | 備考 |
|----|-------|------|------|------|
| `copy-path` | 作業パスをコピー | `Copy`（通常時） / `Check`（copied 時） | `copyPath()` を呼ぶ | 成功後 1.5 秒間 `copied` 状態。ケバブ項目の `icon` を `copied` に応じて `Copy` / `Check` に切り替える。メニュー再開封時に `copied` が残っていればチェックアイコンが表示される（既存動作を保持） |
| `resync` | 再同期 | `RefreshCw` | `stream.resync()` + `setDiffKey(k+1)` | busy 時 disabled（`working` 状態のとき） |

**補足**: `copied` 状態は `TaskView` 側の state として保持され、`copyPath()` 内で 1.5 秒後に自動リセットされる。ケバブ項目の `icon` はこの state を参照して動的に切り替える。メニューが閉じている間も state は生存し、1.5 秒以内に再開封すればチェックアイコンが表示される。

#### グループ `"session-switcher"`（セッション切替）— 新設

| id | label | icon | 動作 | 備考 |
|----|-------|------|------|------|
| `open-session-switcher` | セッションを切り替え・追加 | `Layers` | アクセシブルダイアログを開く | 標準 `menuitem`。押下で `role="dialog"` + `aria-modal="true"` のダイアログを開く。session が存在しない場合、この項目自体を `headerKebabGroups` 配列に追加しない |

**ARIA 準拠の根拠**: `role="menu"` 内に配置できるのは `role="menuitem"`（または `menuitemcheckbox` / `menuitemradio`）のみである（WAI-ARIA 仕様）。select/button/dialog を menu 内に直接描画すると支援技術が正しく解釈できない。本設計では「セッションを切り替え・追加」は標準 `menuitem` として menu 内に配置し、その選択によって menu 外のアクセシブルダイアログを開く。

#### グループ `"panels"`（パネル切替）— 既存、条件変更

| id | label | icon | 表示条件（変更前） | 表示条件（変更後） |
|----|-------|------|-------------------|-------------------|
| `panel-files` | ファイルツリー | `FolderTree` | `!isLg` | 常時表示（変更なし） |
| `panel-graph` | グラフ | `GitGraph` | `!isLg` | 常時表示（変更なし） |
| `panel-terminal` | ターミナル | `Terminal` | `!isMd` | **常時表示** ← 変更 |
| `panel-diff` | Diff パネル | `PanelRight` | `!isLg` | 常時表示（変更なし） |

`panel-terminal` の表示条件を `!isMd` から常時表示に変更する。これにより、md 以上のブレークポイントで Zone B に直接表示されていたターミナルボタンが削除され、代わりにケバブ内の `panel-terminal` がすべての幅で利用可能になる。

#### グループ `"danger"`（危険操作）— 既存、変更なし

| id | label | icon | 備考 |
|----|-------|------|------|
| `delete` | タスクを削除 | `Trash2` | `danger: true`。確認ダイアログ後に削除 |

## ヘッダーツールバー（変更後）

### Zone A（常時表示）

```
[停止ボタン] (working 時のみ) [CompactButton] (session 存在時のみ)
```

### Zone B（ブレークポイント依存）

```
[ファイルツリー] [グラフ] [Diff パネル]  ← lg 以上で表示
```

### Zone C（ケバブメニュー）

```
[⋯]  ← 常時表示。上記グループ構成
```

### 削除される直表示ボタン

以下のボタンがヘッダー直表示から削除される：

| ボタン | 現在の位置 | 削除理由 |
|--------|-----------|---------|
| コピー（`Copy`） | Zone A | ケバブ `"task"` グループへ移動 |
| 再同期（`RefreshCw`） | Zone A | ケバブ `"task"` グループへ移動 |
| SessionSwitcher（`Layers` + select + `Plus`） | Zone A | ケバブ `"session-switcher"` グループの menuitem 経由で dialog を開く |
| ターミナル（`Terminal`） | Zone B（md 以上） | ケバブ `"panels"` グループへ常時移動。Zone B の該当 Button を削除 |

## アクセシビリティ

### ケバブメニュー（`role="menu"`）

- `HeaderKebabMenu` の既存 ARIA（`aria-haspopup`, `aria-expanded`, `role="menu"`, `aria-disabled`, `aria-current`）を維持する
- 新設グループ `"task"` の各項目は既存の `KebabItem` 型に従い、`role="menuitem"` としてレンダリングされる
- 新設グループ `"session-switcher"` の「セッションを切り替え・追加」も標準 `KebabItem` として `role="menuitem"` でレンダリングされる
- キーボード操作（ArrowUp/Down, Enter/Space, Escape, Tab）がそのまま動作する
- **`role="menu"` 内に select/button/dialog を描画しない**。直接操作要素は `menuitem` のみ

### セッション切替ダイアログ（`role="dialog"`）

「セッションを切り替え・追加」menuitem を押下すると、`TaskView` が管理するアクセシブルダイアログを開く。

#### 責務

| コンポーネント | 責務 |
|--------------|------|
| `TaskView` | ダイアログの開閉 state 管理、`HeaderKebabMenu` への `onOpenSessionSwitcher` コールバック提供、ダイアログ内 `SessionSwitcher` のレンダリング、成功時の refresh + close + フォーカス復帰 |
| `SessionSwitcher` | 既存コンポーネントをそのまま流用。セッション一覧表示、切替、追加の内部ロジック。変更なし |
| `HeaderKebabMenu` | 変更なし。`KebabItem.onSelect` 経由で親のコールバックを呼ぶのみ |

#### ダイアログの ARIA 属性

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-label="セッションを切り替え・追加"
  aria-describedby="session-switcher-desc"
>
  <p id="session-switcher-desc" className="sr-only">
    作業中のセッションを切り替えるか、新しいセッションを追加します
  </p>
  {/* SessionSwitcher コンポーネント */}
</div>
```

#### フォーカス管理

| 操作 | 動作 |
|------|------|
| ダイアログオープン | フォーカスをダイアログ内の最初のフォーカス可能要素（セッション一覧の先頭または「セッションを追加」ボタン）に移動する |
| Tab | ダイアログ内のフォーカス可能要素を順方向に循環する。**最終要素で Tab を押してもダイアログ外に出ない**（フォーカストラップ） |
| Shift+Tab | 逆方向に循環。**先頭要素で Shift+Tab を押してもダイアログ外に出ない** |
| Escape | ダイアログを閉じ、フォーカスを DOM 上の既存ケバブ trigger（`aria-label="メニューを開く"`）に復帰する |
| 背景クリック（オーバーレイクリック） | ダイアログ外のオーバーレイ（`role="presentation"` の backdrop）をクリックするとダイアログを閉じ、フォーカスを DOM 上の既存ケバブ trigger に復帰する |
| 成功時（セッション切替/追加完了） | ダイアログを閉じ、`refreshTask()` を呼び、フォーカスを DOM 上の既存ケバブ trigger に復帰する |

#### フォーカストラップ実装方針

`useEffect` でダイアログマウント時にフォーカス可能要素を収集し、Tab/Shift+Tab のハンドラで循環させる。`onKeyDown` で Escape を捕捉する。以下の擬似コードを参考に実装する：

```typescript
// ダイアログコンテナの ref
const dialogRef = useRef<HTMLDivElement>(null);

// マウント時: 最初のフォーカス可能要素にフォーカス
useEffect(() => {
  const el = dialogRef.current;
  if (!el) return;
  const focusable = el.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length > 0) focusable[0].focus();
}, []);

// Tab 循環
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Escape') {
    onClose();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = getFocusableElements(dialogRef.current!);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
};
```

#### オーバーレイクリック

```tsx
{/* オーバーレイ backdrop */}
<div
  className="fixed inset-0 bg-black/50 z-40"
  onClick={() => onClose()}
  role="presentation"
/>
```

#### 成功時 refresh + close + フォーカス復帰

`SessionSwitcher` の `onSwitch` コールバック内で以下を実行する：

```typescript
const handleSessionSwitch = async () => {
  await refreshTask();       // タスク一覧を再取得
  setSessionDialogOpen(false); // ダイアログを閉じる
  // フォーカス復帰: DOM 上の既存ケバブ trigger を aria-label で特定してフォーカス
  setTimeout(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="メニューを開く"]')?.focus();
  }, 0);
};
```

#### モバイル対応

- ダイアログはビューポート中央に配置（`fixed inset-0 flex items-center justify-center`）
- モバイル幅（`<640px`）ではダイアログを画面下部からスライドアップ（`bottom-sheet` スタイル）してもよいが、ARIA 属性（`role="dialog" aria-modal="true"`）は維持する
- タッチ操作: オーバーレイタップで閉じる。ダイアログ内のスクロールは `overflow-y-auto` で対応

#### 状態別仕様

`SessionSwitcher` の既存表示・状態管理をそのまま再利用する。ダイアログ自身が新たに約束するのは以下のみ：

| 状態 | 動作 |
|------|------|
| **ダイアログ開閉** | `sessionDialogOpen` state に基づき、`role="dialog"` の表示/非表示を切り替える |
| **オーバーレイ** | backdrop クリックで閉じる |
| **フォーカストラップ** | Tab/Shift+Tab でダイアログ内を循環。Escape で閉じる |
| **成功時（onSwitch）** | ダイアログを閉じ、`refreshTask()` を呼び、フォーカスをケバブ trigger に復帰する |

`SessionSwitcher` 内部の loading / error / empty / busy 表示は既存コンポーネントの実装に委ね、本仕様では新たに規定しない。

## レスポンシブ

| 幅 | Zone A | Zone B | Zone C（ケバブ） |
|----|--------|--------|-----------------|
| `<768px` | 停止(working時), Compact | なし | 全操作（undo/redo, コピー, 再同期, セッション切替, 全パネル切替, 削除） |
| `768-1023px` | 同上 | なし | 同上 |
| `>=1024px` | 同上 | ファイルツリー, グラフ, Diff | 同上（ターミナル含む） |

- ターミナルはすべての幅でケバブ内のみ。Zone B の `isMd` 条件レンダリングから削除する
- コピー・再同期・セッション切替はすべての幅でケバブ内のみ。Zone A から削除する
- ファイルツリー・グラフ・Diff は lg 以上で Zone B に直接表示、lg 未満でケバブ内（既存動作を維持）

## 実装範囲

### TaskView.tsx の変更

1. **Zone A からの削除**:
   - コピーボタン（`<Button variant="ghost" size="icon" title="作業パスをコピー"...>`）を削除
   - 再同期ボタン（`<Button variant="ghost" size="icon" title="再同期"...>`）を削除
   - `SessionSwitcher` のレンダリング（`<SessionSwitcher .../>`）を削除
   - 関連する `{task.sessionId && (<> ... </>)}` ブロックから SessionSwitcher のみ削除（CompactButton は残す）

2. **Zone B からの削除**:
   - ターミナルボタン（`{isMd && (<Button variant="ghost" size="icon" title="ターミナル"...>)}`）を削除

3. **`headerKebabGroups` への追加**:
   - `"task"` グループを新設:
     ```typescript
     {
       id: "task",
       label: "タスク操作",
       items: [
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
             setDiffKey((k) => k + 1);
           },
           disabled: working,
         },
       ],
     }
     ```
   - `"session-switcher"` グループを新設（session 存在時のみ配列に追加）:
     ```typescript
     ...(task?.sessionId ? [{
       id: "session-switcher",
       label: "セッション切替",
       items: [
         {
           id: "open-session-switcher",
           label: "セッションを切り替え・追加",
           icon: <Layers className="h-4 w-4" />,
           onSelect: () => setSessionDialogOpen(true),
         },
       ],
     }] : []),
     ```
   - `"panels"` グループの `panel-terminal` 条件を `!isMd` から常時表示に変更

4. **セッション切替ダイアログの state とレンダリング**:
   - `const [sessionDialogOpen, setSessionDialogOpen] = useState(false);` を追加
   - ダイアログコンポーネントを `TaskView` の return 内、`HeaderKebabMenu` の外に配置:
     ```tsx
     {sessionDialogOpen && (
       <SessionSwitcherDialog
         workspaceId={task.id}
         directory={task.directory}
         currentSessionId={task.sessionId}
         onSwitch={handleSessionSwitch}
         onClose={() => {
           setSessionDialogOpen(false);
           // フォーカス復帰: DOM 上の既存ケバブ trigger を aria-label で特定
           document.querySelector<HTMLButtonElement>('button[aria-label="メニューを開く"]')?.focus();
         }}
       />
     )}
     ```
   - フォーカス復帰は `document.querySelector` で DOM 上の既存ケバブ trigger（`aria-label="メニューを開く"`）を特定する。`HeaderKebabMenu` に ref をフォワードする変更は行わない

5. **`useMemo` の依存配列更新**:
   - `copyPath` を依存配列に追加
   - `working` を依存配列に追加
   - `refreshTask` を依存配列に追加
   - `copied` を依存配列に追加（`copy-path` の `icon` 動的切替のため）

### HeaderKebabMenu.tsx の変更

- **変更なし**。`KebabGroup` 型に変更は一切加えない。`renderContent` は追加しない。ref フォワードも行わない
- 既存の `KebabItem` 型のみで「セッションを切り替え・追加」を表現する

### SessionSwitcherDialog.tsx（新設）

`TaskView` と同じディレクトリに新規コンポーネントとして作成する。

```typescript
// SessionSwitcherDialog.tsx
interface Props {
  workspaceId: string;
  directory: string;
  currentSessionId: string;
  onSwitch: () => Promise<void>;
  onClose: () => void;
}
```

- `role="dialog"`, `aria-modal="true"`, `aria-label="セッションを切り替え・追加"` を設定
- フォーカストラップ（Tab 循環）
- Escape / オーバーレイクリックで閉じる
- 成功時: `onSwitch()` → `onClose()`（呼び出し元で refresh + close + フォーカス復帰を実行）
- `SessionSwitcher` を内部でレンダリング（既存コンポーネントの表示・状態管理をそのまま利用）

### TaskView.test.tsx の変更

1. 削除された直表示ボタンに関するテストを更新（コピー、再同期、SessionSwitcher、ターミナルのセレクタが変わる）
2. ケバブメニュー内の新規項目に関するテストを追加
3. セッション切替ダイアログの開閉・フォーカス管理・状態別テストを追加

## 受け入れ条件

1. ヘッダー直表示から「作業パスをコピー」「再同期」「SessionSwitcher」「ターミナル」の各ボタンが削除されている
2. ケバブメニュー「⋯」を開くと、上記 4 操作がメニュー内に存在する
3. ケバブ内の「作業パスをコピー」を選択すると、`copyText(task.directory)` が呼ばれ、`copied` state が 1.5 秒間 `true` になる
4. ケバブ内の「作業パスをコピー」のアイコンが、`copied` 状態に応じて `Copy`（通常時）と `Check`（コピー成功後 1.5 秒間）に切り替わる
5. ケバブ内の「再同期」を選択すると、`stream.resync()` + `setDiffKey(k+1)` が実行される
6. ケバブ内の「セッションを切り替え・追加」を選択すると、アクセシブルダイアログが開く
7. セッション切替ダイアログ内でセッションの切替と追加が動作する
8. セッション切替ダイアログのフォーカストラップが正しく動作する（Tab 循環、Escape で閉じる）
9. セッション切替ダイアログのオーバーレイクリックで閉じる
10. セッション切替/追加成功時にダイアログが閉じ、フォーカスが DOM 上の既存ケバブ trigger（`aria-label="メニューを開く"`）に復帰する
11. ケバブ内の「ターミナル」を選択すると、PTY パネルが開く
12. ターミナルがすべてのブレークポイントでケバブ内のみに存在し、Zone B に重複表示されない
13. 停止ボタン（working 時）と CompactButton（session 存在時）はヘッダー直表示に残る
14. ファイルツリー・グラフ・Diff パネルは lg 以上で Zone B に直接表示され、lg 未満でケバブ内に表示される（既存動作維持）
15. 既存のキーボード操作（ArrowUp/Down, Enter/Space, Escape, Tab）がケバブメニュー内で正常に動作する
16. `role="menu"` 内の直接操作要素が `menuitem` であり、select/button/dialog を menu 内部に描画しない（ARIA 準拠）
17. `cd web && npx tsc --noEmit` がパスする
18. `cd web && npx eslint src/components/task/` がパスする
19. `cd web && npx vitest run src/components/task/TaskView.test.tsx` がパスする

## 非機能要件

- 新たな外部依存を追加しない
- 既存の CSS 変数・トークン体系を変更しない
- `HeaderKebabMenu` の `z-30` を維持する
- パフォーマンス: `headerKebabGroups` の `useMemo` 依存配列が増えるが、再計算コストは無視できるレベル
- セッション切替ダイアログは `createPortal` を使用せず、`TaskView` の DOM ツリー内に配置する（z-index でオーバーレイを表現）

## 検証

```bash
# 型チェック
cd web && npx tsc --noEmit

# リント
cd web && npx eslint src/components/task/TaskView.tsx src/components/task/HeaderKebabMenu.tsx

# テスト
cd web && npx vitest run src/components/task/TaskView.test.tsx

# ブラウザ確認（ユーザー側）
# - ヘッダー直表示から上記 4 操作が消えていること
# - ケバブメニュー内に全操作が存在すること
# - 各操作が正しく機能すること
# - セッション切替ダイアログのフォーカストラップが動作すること
# - スマホ幅・タブレット幅・PC幅で表示が崩れないこと
```
