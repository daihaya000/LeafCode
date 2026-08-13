# UI 部品規約（IMPROVEMENT 1-4）

`web/src/components/ui.tsx` を**共通 UI 部品の正本**とする。新規にボタン・ダイアログ・
バッジ等の部品を作るときは、独自実装せず必ず `ui.tsx` の部品を使う（または `ui.tsx` に
追加する）。

## 部品一覧（2026-08-13 時点）

| 部品 | 用途 | 主な props |
|------|------|-----------|
| `Button` | ボタン（forwardRef・`type="button"` 固定） | `variant` / `size` / `busy` |
| `GhostSelect` | カスタム select（アイコン・トーン付き） | `value` / `onChange` / `icon` / `tone` |
| `Badge` | 状態バッジ | `tone`（success / warning / danger / neutral 等） |
| `DiffStat` | 差分の +/- 統計表示 | 加減行数 |
| `Spinner` | ローディング表示 | `className` |
| `ThemeToggle` | テーマ切替 | — |
| `formatMessageTime` / `timeAgo` | 時刻表示のフォーマッタ | ISO / timestamp |

## Button の規約

- `variant`: `"primary" | "secondary" | "ghost" | "danger" | "outline"`（既定 `secondary`）
- `size`: `"sm" | "md" | "lg" | "icon"`（既定 `md`）
- `busy`: 処理中は `disabled` になりスピナーを表示（`aria-busy` も設定）
- 既定で `type="button"`。`<form>` 内で submit させる場合のみ `type="submit"` を明示

## アクセシビリティ規約

- アイコンだけのボタンには `aria-label` を必ず付ける
- `busy` の状態は `aria-busy` で表現される（追加の aria は不要）
- 選択状態を持つボタンは `aria-pressed` を使う

## 利用例

```tsx
import { Button, Badge } from "@/components/ui";

<Button variant="primary" size="sm" busy={saving} onClick={() => void save()}>
  保存
</Button>
<Badge tone={connected ? "success" : "neutral"}>
  {connected ? "接続済み" : "未接続"}
</Badge>
```
