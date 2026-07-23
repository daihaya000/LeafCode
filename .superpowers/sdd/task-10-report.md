# Task 10 report

- Implemented shared allowlist path validation for `POST /api/projects` and `POST /api/roots`.
- Rejects missing paths, non-existent paths, files, drive roots, Windows, Program Files, Program Files (x86), ProgramData, and the user profile root with HTTP 400.
- Tests: `npx vitest run src/app/api/roots/route.test.ts src/app/api/projects/route.test.ts` (10 passed).
- Typecheck: `npm run typecheck` (passed).
- Concern: none.

## Task 10 review fix

- `fs.realpathSync.native()` now resolves the canonical path before checking drive roots, Windows, Program Files, Program Files (x86), ProgramData, the user profile root, and directory type.
- `POST /api/projects` and `POST /api/roots` register the validated canonical path directly; intermediate symlink/junction escapes are rejected before any DB write.
- Tests cover files, drive/system areas, user profile, valid temporary directories (200), protected targets through junctions (400), canonical DB values, and no DB writes on rejection.
- Tests: `npx vitest run src/app/api/roots/route.test.ts src/app/api/projects/route.test.ts` (19 passed).
- Typecheck: `npm run typecheck` (passed).
- Concern: none.
