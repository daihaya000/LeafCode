# Task 10 report

- Implemented shared allowlist path validation for `POST /api/projects` and `POST /api/roots`.
- Rejects missing paths, non-existent paths, files, drive roots, Windows, Program Files, Program Files (x86), ProgramData, and the user profile root with HTTP 400.
- Tests: `npx vitest run src/app/api/roots/route.test.ts src/app/api/projects/route.test.ts` (10 passed).
- Typecheck: `npm run typecheck` (passed).
- Concern: none.

## Task 10 re-review fix

- Canonical path validation now rejects UNC paths (including `\\localhost\C$\Windows`) and `\\?\` / `\\.\` device namespaces before a write can occur.
- Protected locations are resolved from `SystemRoot`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432`, and `ProgramData`, then compared case-insensitively using canonical paths. User-profile roots are enumerated from `USERPROFILE`'s canonical parent so every profile root is rejected without blocking repositories below a profile.
- Every canonical Windows drive root is rejected. Junction traversal is checked after canonicalization; safe symlinks register the canonical target.
- Regression tests cover UNC/device aliases, arbitrary drive roots, all environment-derived protected locations, all profile roots, intermediate junction traversal, safe symlink target storage, and no `addAllowedRoot` / `setSetting` calls for every roots rejection case.
- Tests: `npx vitest run src/lib/path-validation.test.ts src/app/api/roots/route.test.ts src/app/api/projects/route.test.ts` (36 passed).
- Typecheck: `npm run typecheck` (passed).

## Task 10 review fix

- `fs.realpathSync.native()` now resolves the canonical path before checking drive roots, Windows, Program Files, Program Files (x86), ProgramData, the user profile root, and directory type.
- `POST /api/projects` and `POST /api/roots` register the validated canonical path directly; intermediate symlink/junction escapes are rejected before any DB write.
- Tests cover files, drive/system areas, user profile, valid temporary directories (200), protected targets through junctions (400), canonical DB values, and no DB writes on rejection.
- Tests: `npx vitest run src/app/api/roots/route.test.ts src/app/api/projects/route.test.ts` (19 passed).
- Typecheck: `npm run typecheck` (passed).
- Concern: none.
