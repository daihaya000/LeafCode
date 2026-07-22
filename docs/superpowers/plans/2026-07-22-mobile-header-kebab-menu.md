# モバイルヘッダー kebab メニュークリップ解消 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイルで `…` メニューが横スクロール親にクリップされず、全項目を表示・選択できるようにする。

**Architecture:** TaskView右側ツールバーを、overflow visibleな外側ラッパー、Zone A/Bだけを収める内側横スクロールコンテナ、固定兄弟の`HeaderKebabMenu`に分割する。メニューコンポーネントの配置・状態・ARIA・z-indexは変更しない。

**Tech Stack:** Next.js、React、TypeScript、Tailwind CSS v4、lucide-react、eslint。

## Global Constraints

- 対象は `web/src/components/task/TaskView.tsx` の右側ツールバーDOM構造のみ。
- `HeaderKebabMenu.tsx`、AppShellモバイルヘッダー、Zone A/B/Cの操作内容、既存の `isMd` / `isLg` 条件は変更しない。
- Portal、`position: fixed`、新規依存、新規デザイントークン、新規z-indexは導入しない。
- `HeaderKebabMenu` の `z-30`、ARIA、Escape/outside click/Tab/矢印キー/Enter/Space操作を維持する。
- Playwright/browser操作は禁止。`next dev` 等の常駐プロセスを起動しない。
- 変更後は `cd web && npx tsc --noEmit` と `npx eslint src/components/task/TaskView.tsx` を実行する。

---

### Task 1: ツールバーのスクロール領域とkebabを分離

**Files:**
- Modify: `web/src/components/task/TaskView.tsx:1553-1670`
- Test: 型検査・eslint（テストファイル追加なし）

**Interfaces:**
- Consumes: 既存の `headerKebabGroups: KebabGroup[]`、`HeaderKebabMenu`、Zone A/Bの各既存ボタン。
- Produces: Zone A/Bのみが横スクロールし、`HeaderKebabMenu`がoverflow visibleな外側ラッパーの直接の子となるDOM。

- [ ] **Step 1: 現在のツールバーを読み直し、クリップ原因を確認する**

`TaskView.tsx`の右側ツールバーで、下記の単一コンテナがZone A/Bと`HeaderKebabMenu`をすべて内包していることを確認する。

```tsx
<div className="flex max-w-[60vw] shrink-0 items-center gap-0.5 overflow-x-auto sm:max-w-none sm:gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
  {/* Zone A */}
  {/* Zone B */}
  <HeaderKebabMenu groups={headerKebabGroups} />
</div>
```

- [ ] **Step 2: 外側のoverflow visibleラッパーと内側のスクロールコンテナに分割する**

外側のコンテナを次に置換し、`HeaderKebabMenu`を内側コンテナの後の直接の子に移動する。Zone A/Bの既存JSX・イベントハンドラ・`isMd`/`isLg`条件は内側へそのまま移す。

```tsx
<div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
  <div className="flex max-w-[60vw] items-center gap-0.5 overflow-x-auto sm:max-w-none sm:overflow-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {/* 既存のZone A全体とZone B全体を変更せずに置く */}
  </div>
  <HeaderKebabMenu groups={headerKebabGroups} />
</div>
```

内側コンテナに`shrink-0`を追加しない。`max-w-[60vw]`の幅制限の中でZone A/Bが横スクロールし、外側のkebabは固定兄弟として残る必要がある。

- [ ] **Step 3: クリップ境界とkebabのDOM位置を静的に確認する**

次の条件をコードで確認する。

```text
TaskView右側の外側div: overflow-x-auto / overflow-hidden を持たない
TaskView右側の内側div: overflow-x-auto を持つ
HeaderKebabMenu: 内側divの外、外側divの直接の子
HeaderKebabMenu.tsx: relative shrink-0 と absolute right-0 top-full z-30 を変更していない
```

- [ ] **Step 4: 型検査を実行する**

Run: `cd web && npx tsc --noEmit`

Expected: exit code 0。

- [ ] **Step 5: eslintを実行する**

Run: `cd web && npx eslint src/components/task/TaskView.tsx`

Expected: exit code 0。

- [ ] **Step 6: 差分を確認しコミットする**

Run:

```bash
git status --short
git diff -- web/src/components/task/TaskView.tsx
git add web/src/components/task/TaskView.tsx
git commit -m "fix: モバイルkebabメニューのクリップを解消"
git log --oneline -1
```

Expected: `TaskView.tsx`だけを含むコミットが作成され、出力された先頭コミットハッシュを確認できる。

## Self-review

- Spec coverage: 内側スクロール化、kebab固定、既存レスポンシブ条件の維持、アクセシビリティ/z-index不変、型検査/lintをTask 1に含めた。
- Placeholder scan: 未決定事項・TODO・曖昧な手順はない。Zone A/Bの既存JSXは移動のみと明記した。
- Type consistency: 既存の`HeaderKebabMenu`と`headerKebabGroups`のインターフェースを変更しない。
