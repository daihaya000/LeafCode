## Scope

Task 9: `isInside` の根一致を拒否し、R35#1 のデータ破壊経路を防止。

## Changes

- `web/src/lib/git.ts`
  - `removeWorktree` の信頼済みベース判定で `path.relative(...) === ""` を拒否。
- `web/src/lib/project-session-sync.ts`
  - `restoreProjectFromManifest` の worktree パス検証で根一致を拒否。
- `web/src/lib/project-session-sync.test.ts`
  - worktree パスがプロジェクトルートと一致する場合に import しない回帰テストを追加。

## Verification

- RED: `npx vitest run src/lib/project-session-sync.test.ts -t "root coincidence"` — 失敗（根一致が import された）。
- GREEN: `npx vitest run src/lib/project-session-sync.test.ts -t "root coincidence"` — PASS。
- `npx vitest run src/lib/git.test.ts src/lib/project-session-sync.test.ts` — PASS（2 files / 8 tests）。
- `npm run typecheck` — PASS。

## Commit

- `fix: isInside が根一致を拒否するように変更（repo/worktree 根の再帰削除を防止）`
