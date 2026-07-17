# Task 1 作業報告: URLから対象プロジェクトを初期選択する

## 要件

`.superpowers/sdd/task-1-brief.md` に基づき、URL query `projectId` を `HomeView` へ渡し、有効なIDだけを初期選択、無効なIDは先頭プロジェクトへフォールバックする。

## 変更ファイル (3)

| File | 変更 |
| --- | --- |
| `web/src/app/(app)/page.tsx` | `searchParams` を await して `initialProjectId` を `HomeView` へ渡すよう修正 |
| `web/src/components/home/HomeView.tsx` | 関数引数 `initialProjectId?: string` を追加、`refreshProjects` で有効ID検証→フォールバックを実装 |
| `web/e2e/composer.spec.ts` | `selects the project requested by the URL` テストを追加 |

`.webui-worktrees/` は別ランタイム状態のため未追跡のまま放置（変更・追加・削除なし）。

## RED (Step 2)

コマンド:
```
cd web && npm run e2e -- e2e/composer.spec.ts -g "selects the project requested"
```

結果: 1 failed
```
Error: expect(locator).toHaveValue(expected) failed
Locator:  getByRole('combobox', { name: 'プロジェクト' })
Expected: "project-b"
Received: "project-a"
```
期待通り `project-a` と `project-b` の不一致で FAIL。

## GREEN (Step 3-4)

実装:
- `page.tsx`: `searchParams: Promise<{ projectId?: string | string[] }>` を await し、`string` の場合のみ `initialProjectId` として渡す。
- `HomeView.tsx`: `refreshProjects` 内で `setProjectId` を関数アップデータ化し、`cur` が既にあれば保持、`initialProjectId` が `nextProjects` に存在すれば採用、それ以外は先頭プロジェクトへフォールバック。

コマンド (E2E全件):
```
cd web && npm run e2e -- e2e/composer.spec.ts
```
結果: 6 passed (5.2s)
```
ok 1 › does not create page-level horizontal scroll at 375px
ok 2 › keeps the submit button disabled while the prompt is empty
ok 3 › waits for the selected project's base branch before submitting
ok 4 › native selects are keyboard focus targets
ok 5 › exposes engine-independent settings as native comboboxes
ok 6 › selects the project requested by the URL
```

コマンド (型検査):
```
cd web && npm run typecheck
```
結果: TypeScript error 0 (出力なし、exit 0)

ビルドも成功 (`npm run build` → ✓ Compiled successfully)。

## コミット (Step 5)

```
git add web/src/app/(app)/page.tsx web/src/components/home/HomeView.tsx web/e2e/composer.spec.ts
git commit -m "feat: preselect project from task creation URL"
git log --oneline -1
```

結果:
```
03b4f8c feat: preselect project from task creation URL
```

`git show --stat HEAD`:
```
 web/e2e/composer.spec.ts             | 28 ++++++++++++++++++++++++++++
 web/src/app/(app)/page.tsx           | 15 ++++++++++++---
 web/src/components/home/HomeView.tsx | 18 ++++++++++++++----
 3 files changed, 54 insertions(+), 7 deletions(-)
```

## Important finding 修正

修正:
- `page.tsx`: `projectId` query を `HomeView` の `key` と `initialProjectId` に渡し、query 変更時に remount するよう修正。
- `HomeView.tsx`: 現在の project ID が取得済みプロジェクトに存在する場合だけ保持し、存在しない場合は有効な `initialProjectId`、それもなければ先頭プロジェクトへフォールバックするよう修正。

コマンド (型検査):
```
cd web && npm run typecheck
```

結果: TypeScript error 0 (出力なし、exit 0)

コマンド (composer E2E):
```
cd web && npm run e2e -- e2e/composer.spec.ts
```

結果: 6 passed (5.4s)

懸念:
- なし。`.webui-worktrees/` と他セッションの変更は触れていない。

対象3ファイルのみコミット済み。`.webui-worktrees/` は未追跡のまま保持。

## 懸念

- なし。brief に指定された契約通りの実装で、E2E全件 PASS、型検査エラー0、対象3ファイルのみコミット済み。
