# TaskView ヘッダーツールバー操作のケバブメニュー集約 設計仕様書

## 背景

TaskView 右上ヘッダーツールバーには、Zone A（常時表示操作）として「作業パスをコピー」「再同期」「SessionSwitcher（セッション追加/切替）」「CompactButton」、Zone B（ブレークポイント依存のパネル切替）として「ファイルツリー」「グラフ」「ターミナル」「Diff パネル」、Zone C（ケバブメニュー）として「巻き戻し/取消」「パネル切替（Zone B 非表示時のみ）」「タスク削除」が配置されている。

このうち、常時表示されている Zone A の操作群が多く、特にスマートフォン幅では横スクロール領域が頻繁に発生する。また「ターミナル」は Zone B（md 以上で直接表示）と Zone C（md 未満でケバブ内）の二重定義になっており、一貫性を欠く。

本仕様は、以下の 4 操作をヘッダー直表示から削除し、既存の `HeaderKebabMenu` 内へ常時配置することで、ヘッダーを整理する。

## 目的

- ヘッダーツールバーの直表示操作を削減し、横スクロールの発生頻度を下げる
- 「ターミナル」の表示条件を二重定義から単一（常にケバブ内）に統一する
- 既存のアクセシビリティ（キーボード操作、ARIA）、レスポンシブ動作、全操作の機能を維持する

## 対象と非対象

### 対象

- `web/src/components/task/TaskView.tsx` のヘッダーツールバー（Zone A / Zone B / Zone C）
- `web/src/components/task/HeaderKebabMenu.tsx` — 変更なし（型・コンポーネントはそのまま）
- `web/src/components/task/SessionSwitcher.tsx` — 変更なし（コンポーネントはそのまま利用）
- `web/src/components/task/TaskView.test.tsx` — テストケースの更新

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
| 3 | セッション追加/切替 | Zone A（session 存在時） | `"session"`（既存グループ名を拡張） | SessionSwitcher 全体をケバブ内に配置。セッション一覧の select + 追加ボタンをメニュー内に表示 |
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
│  [セッション選択▼]  [+追加]     │
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
| `copy-path` | 作業パスをコピー | `Copy` | `copyPath()` を呼ぶ | 成功後 1.5 秒間 `copied` 状態。ケバブ内ではチェックアイコン表示不可のため、トースト等は行わず `copied` 状態は次回開封時にリセット |
| `resync` | 再同期 | `RefreshCw` | `stream.resync()` + `setDiffKey(k+1)` | busy 時 disabled（`working` 状態のとき） |

**補足**: ケバブメニューは選択後に自動クローズするため、`copied` 状態の視覚フィードバックは次回開封時まで持続しない。これは許容する。コピー成功のフィードバックは OS のクリップボード通知に委ねる。

#### グループ `"session-switcher"`（セッション切替）— 新設

`SessionSwitcher` コンポーネント全体をケバブ内にインライン表示する。既存の `SessionSwitcher` コンポーネントをそのまま流用し、ラッパーとして配置する。

- session が存在しない場合、このグループは非表示（`items.length === 0` により `HeaderKebabMenu` が自動的に空グループをスキップする）
- セッションが 1 件のみの場合: 「セッションを追加」ボタンのみ表示（既存の `SessionSwitcher` の振る舞いと同じ）
- セッションが 2 件以上の場合: `<select>` ドロップダウン + 「+」追加ボタンを表示

**実装方法**: `SessionSwitcher` をケバブ内にレンダリングするため、`KebabItem` の `icon` / `label` を使うのではなく、`KebabGroup` の `items` に特殊な `render` プロパティを追加するか、`HeaderKebabMenu` の children / render-prop 機構を拡張する。

→ **設計判断**: `HeaderKebabMenu` に `renderGroupContent` または `renderItem` のカスタムレンダリング対応を追加する。具体的には `KebabGroup` に `renderContent?: () => ReactNode` を追加し、これが指定されたグループは標準の `items` ループではなく `renderContent()` の結果を表示する。

```typescript
export type KebabGroup = {
  id: string;
  label?: string;
  items: KebabItem[];
  /** 指定された場合、items を無視してこの関数の結果をグループ内容として表示する */
  renderContent?: () => ReactNode;
};
```

`HeaderKebabMenu` のレンダリングロジック:

```tsx
{visibleGroups.map((group, gi) => (
  <div key={group.id} ...>
    {group.renderContent ? (
      group.renderContent()
    ) : (
      group.items.map((item) => ( /* 既存の menuitem レンダリング */ ))
    )}
  </div>
))}
```

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
| SessionSwitcher（`Layers` + select + `Plus`） | Zone A | ケバブ `"session-switcher"` グループへ移動 |
| ターミナル（`Terminal`） | Zone B（md 以上） | ケバブ `"panels"` グループへ常時移動。Zone B の該当 Button を削除 |

## アクセシビリティ

- `HeaderKebabMenu` の既存 ARIA（`aria-haspopup`, `aria-expanded`, `role="menu"`, `aria-disabled`, `aria-current`）を維持する
- 新設グループ `"task"` の各項目は既存の `KebabItem` 型に従い、キーボード操作（ArrowUp/Down, Enter/Space, Escape, Tab）がそのまま動作する
- `"session-switcher"` グループのカスタムレンダリング内では、`SessionSwitcher` が既に持つ `aria-label`（`"セッション切替"`, `"セッションを追加"`, `"新セッション"`）を維持する
- カスタムレンダリング領域内のフォーカス管理: `HeaderKebabMenu` のキーボードナビゲーション（ArrowUp/Down）はカスタムレンダリング領域をスキップする。ユーザーは Tab でカスタム領域に進入し、内部の select/button を操作後、再度 Tab で次のグループへ移動する
- カスタムレンダリング領域内の select と button には既存の `aria-label` が付与されている

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
           icon: <Copy className="h-4 w-4" />,
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
   - `"session-switcher"` グループを新設（カスタムレンダリング）:
     ```typescript
     {
       id: "session-switcher",
       label: "セッション切替",
       items: [], // renderContent を使用するため空
       renderContent: () => task?.sessionId ? (
         <div className="px-3 py-1.5">
           <SessionSwitcher
             workspaceId={task.id}
             directory={task.directory}
             currentSessionId={task.sessionId}
             onSwitch={() => void refreshTask()}
           />
         </div>
       ) : null,
     }
     ```
   - `"panels"` グループの `panel-terminal` 条件を `!isMd` から常時表示に変更

4. **`useMemo` の依存配列更新**:
   - `copyPath` を依存配列に追加
   - `working` を依存配列に追加
   - `refreshTask` を依存配列に追加

### HeaderKebabMenu.tsx の変更

1. `KebabGroup` 型に `renderContent?: () => ReactNode` を追加
2. レンダリングロジックに `group.renderContent` の分岐を追加
3. カスタムレンダリング領域内のフォーカス管理: キーボードナビゲーション（ArrowUp/Down）でカスタム領域をスキップする処理を追加

### TaskView.test.tsx の変更

1. 削除された直表示ボタンに関するテストを更新（コピー、再同期、SessionSwitcher、ターミナルのセレクタが変わる）
2. ケバブメニュー内の新規項目に関するテストを追加（必要に応じて）

## 受け入れ条件

1. ヘッダー直表示から「作業パスをコピー」「再同期」「SessionSwitcher」「ターミナル」の各ボタンが削除されている
2. ケバブメニュー「⋯」を開くと、上記 4 操作がメニュー内に存在する
3. ケバブ内の「作業パスをコピー」を選択すると、`copyText(task.directory)` が呼ばれる
4. ケバブ内の「再同期」を選択すると、`stream.resync()` + `setDiffKey(k+1)` が実行される
5. ケバブ内のセッション切替グループで、既存の SessionSwitcher と同一の UI（select + 追加ボタン）が表示され、セッションの切替と追加が動作する
6. ケバブ内の「ターミナル」を選択すると、PTY パネルが開く
7. ターミナルがすべてのブレークポイントでケバブ内のみに存在し、Zone B に重複表示されない
8. 停止ボタン（working 時）と CompactButton（session 存在時）はヘッダー直表示に残る
9. ファイルツリー・グラフ・Diff パネルは lg 以上で Zone B に直接表示され、lg 未満でケバブ内に表示される（既存動作維持）
10. 既存のキーボード操作（ArrowUp/Down, Enter/Space, Escape, Tab）がケバブメニュー内で正常に動作する
11. カスタムレンダリング領域（セッション切替）では ArrowUp/Down がスキップされ、Tab で進入/脱出できる
12. `cd web && npx tsc --noEmit` がパスする
13. `cd web && npx eslint src/components/task/` がパスする
14. `cd web && npx vitest run src/components/task/TaskView.test.tsx` がパスする

## 非機能要件

- 新たな外部依存を追加しない
- 既存の CSS 変数・トークン体系を変更しない
- `HeaderKebabMenu` の `z-30` を維持する
- パフォーマンス: `headerKebabGroups` の `useMemo` 依存配列が増えるが、再計算コストは無視できるレベル

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
# - スマホ幅・タブレット幅・PC幅で表示が崩れないこと
```
