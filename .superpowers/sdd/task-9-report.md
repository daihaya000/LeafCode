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

---

## Critical review fix: 保護rootの完全一致をOR判定より先に拒否

### Changes

- `git.ts`: `repoRoot` または `worktreeBase` と完全一致する `worktreePath` を、配下許可のOR判定前に拒否。
- `project-session-sync.ts`: `rootPath` または `worktreeBase` と完全一致する manifest の `worktreePath` を同様に拒否。
- `git.test.ts` / `project-session-sync.test.ts`: repo root が `worktreeBase` 配下にある場合を含むレビュー再現ケースを回帰テスト化。

### Verification

- `cd web && npx vitest run src/lib/git.test.ts src/lib/project-session-sync.test.ts` — PASS（2 files / 12 tests）
- `cd web && npm run typecheck` — PASS
