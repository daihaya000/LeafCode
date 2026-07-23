# Task 12 report

## 実装

- SettingsView の allowlist root 一覧に root ごとの削除ボタンを追加。
- 削除時に `sendJson("DELETE", "/api/roots", undefined, { path })` を呼び出し、既存の `guard` による refresh で一覧を更新。
- 削除ボタンのアクセシブルな名称を `${root}を削除` とした。

## 検証

- TDD: 未実装状態で対象テストが失敗することを確認後、実装して成功。
- `npx vitest run src/components/settings/SettingsView.test.tsx -t "renders a delete button"`: PASS
- `npx vitest run src/components/settings/SettingsView.test.tsx`: PASS (8 tests)
- `npm run typecheck`: PASS
- `npm run lint -- src/components/settings/SettingsView.tsx src/components/settings/SettingsView.test.tsx`: PASS

## Task12レビュー対応（Important 5 / Minor 2）

### 実装

- root path を確認ダイアログに表示し、キャンセル時は DELETE を実行しないようにした。
- 404 時は `refresh()` で一覧を再取得し、「既に削除済みです」を alert で通知するようにした。
- エラー表示へ `role="alert"` / `aria-live="assertive"` を付与した。
- 削除中は全 root 削除ボタンを disabled にし、`削除中…` と `aria-busy` を表示して連打を防止した。
- 通常時のアイコン色を `text-muted` に変更し、`rounded-lg` と `focus-visible` のデザインシステム用スタイルを追加した。
- stateful GET mock による成功時の行消失、通常エラー、404 refresh、確認キャンセルのテストを追加した。

### 検証

- `npx vitest run src/components/settings/SettingsView.test.tsx`: PASS (11 tests)
- `npm run typecheck`: PASS
- `npm run lint -- src/components/settings/SettingsView.tsx src/components/settings/SettingsView.test.tsx`: PASS
- `dev-server.log` 確認済み。既存ログ末尾に compile 成功と EPIPE 記録あり（今回のテスト失敗ではない）。

## Task12再レビュー対応（Minor 3）

### 実装

- root 削除中の状態を共通 `busy` から分離し、対象 root のみ `aria-busy` と「削除中…」を表示するようにした。
- 削除ボタンに `min-h-6 min-w-6` を追加し、24px 以上のタッチターゲットを確保した。
- root path に `text-text`、エラー alert に `text-diff-del-text` を適用し、semantic token 経由でコントラストを改善した。
- 対象 root だけが busy になる RTL テストを追加した。
