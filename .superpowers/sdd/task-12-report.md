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
