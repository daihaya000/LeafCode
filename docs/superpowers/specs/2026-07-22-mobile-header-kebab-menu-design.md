# モバイルヘッダーの kebab メニュークリップ解消

## 背景

TaskView のスマホ用ヘッダーでは、右側ツールバー全体が `overflow-x-auto` の横スクロール領域になっている。`…` ボタンの `HeaderKebabMenu` もその子要素であり、絶対配置するポップアップが親のオーバーフローでクリップされる。その結果、メニューがヘッダー内に埋もれ、項目を完全に読んだり選択したりできない。

## 目的

スマホの `…` ボタンを横スクロール領域の外に保ち、メニューをヘッダー右下に完全表示する。幅が不足する場合も、スクロール対象は Zone A / Zone B の操作群だけに限定する。

## 対象と非対象

- 対象: `web/src/components/task/TaskView.tsx` の右側ツールバーのDOM構造。
- 非対象: `HeaderKebabMenu` の開閉・キーボード・ARIA実装、AppShellモバイルヘッダー、既存のZone A/B/Cの操作内容、色・トークン・z-index体系。
- Portal、`position: fixed`、新規UIライブラリは導入しない。

## 設計

### DOM構造

現状はツールバー全体がスクロールコンテナであり、kebab popupもクリップ対象である。

```tsx
<div className="... overflow-x-auto ...">
  {/* Zone A / Zone B */}
  <HeaderKebabMenu />
</div>
```

以下の二層構造へ変更する。

```tsx
<div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
  <div className="flex max-w-[60vw] items-center gap-0.5 overflow-x-auto sm:max-w-none sm:overflow-visible ...">
    {/* Zone A / Zone B */}
  </div>
  <HeaderKebabMenu groups={headerKebabGroups} />
</div>
```

- 外側ラッパーは `overflow: visible` のままにし、kebabを縮小しない兄弟として配置する。
- 内側スクロールコンテナにはZone A（停止、コピー、再同期、セッション切替、compact）とZone B（ブレークポイントに応じたパネル切替）のみを置く。
- `HeaderKebabMenu` は内側コンテナの外へ移動するだけで、コンポーネント本体は変更しない。

### レスポンシブ

| 幅 | 内側操作群 | kebab |
| --- | --- | --- |
| `<640px` | `max-w-[60vw] overflow-x-auto`。幅超過時のみ横スクロール | 右端に固定。popupはクリップされない |
| `>=640px` | `sm:max-w-none sm:overflow-visible`。横スクロールなし | 同上 |
| `>=768px` | Zone Bのターミナルも内側に表示 | 同上 |
| `>=1024px` | Zone Bのファイル、グラフ、Diffも内側に表示 | 同上 |

Zone Bの `isMd` / `isLg` によるJS条件レンダリングと、kebab内の反対条件レンダリングは変更しない。各操作は直接ボタンかkebabのいずれか一方にのみ現れる。

### アクセシビリティと重なり順

- `HeaderKebabMenu` の `aria-haspopup`、`aria-expanded`、`role="menu"`、キーボード操作、outside click、Escapeによるフォーカス復帰を維持する。
- DOM順序は操作群の後にkebabとなり、視覚順序とTab順序が一致する。
- popupの `z-30` を維持する。既存のstickyヘッダー(`z-10`)とcomposer補助UI(`z-20`)より上、モーダル(`z-40+`)より下のままとする。

## 受け入れ条件

1. スマホ幅でZone Aが幅超過した場合、横スクロールするのはZone A/Bの内側領域だけである。
2. `…` ボタンは横スクロール領域の外にあり、常に到達可能である。
3. `…` を開くと、メニュー全項目がヘッダーの下・右寄りに切れずに表示される。
4. タブレット・PCでは既存のZone B表示条件、メニュー内容、ヘッダー高さが変わらない。
5. Escape、outside click、Tab、矢印キー、Enter/Spaceの既存メニュー操作が回帰しない。

## 検証

- `cd web && npx tsc --noEmit`
- `cd web && npx eslint src/components/task/TaskView.tsx`
- browser/Playwrightはユーザー指示により使用しない。ユーザー側でスマホ幅のポップアップ完全表示を確認する。
