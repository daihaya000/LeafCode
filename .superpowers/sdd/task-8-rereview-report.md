# Task 8 再レビュー: Attention 回答 busy 解除

## Important 修正

`AttentionQueueModal.respond` は非 404 の送信失敗をモーダル内で表示して正常に return する。そのため `QuestionCard` / `PermissionCard` が `catch` のみで busy を解除していると、カード側の回答ボタンが disabled のまま固定される。

- 各返信経路の busy 解除を `finally` に移動。
- `PermissionCard` のフルアクセス経路も同じ invariant を適用。

## 回帰テスト

`AttentionQueueModal.test.tsx` で実カードを通し、各ケースの `disabled: false → true → false` を検証した。

| カード | 成功 | 404 | 非404失敗 |
| --- | --- | --- | --- |
| `QuestionCard` | 実送信完了後に再有効化 | 回答済み扱いで除去後に再有効化 | モーダルエラー表示後に再有効化・再試行可 |
| `PermissionCard` | 実送信完了後に再有効化 | 回答済み扱いで除去後に再有効化 | モーダルエラー表示後に再有効化・再試行可 |

## Verification

- `cd web && npx vitest run src/components/shell/AttentionQueueModal.test.tsx`
  - PASS: 1 file / 9 tests

## Important-only review

- 対象差分に Important 以上の未解決指摘なし。
