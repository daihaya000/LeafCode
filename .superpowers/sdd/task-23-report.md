## Result

`PartView`で`status === "error"`のツール詳細を常に展開し、`state.error`（空の場合は`state.output`）を表示するようにした。回帰テストを追加した。

## Verification

- `cd web && npx vitest run src/components/task/PartView.test.tsx` — PASS（6 tests）
- `cd web && npm run typecheck` — PASS

## Concern

なし。
