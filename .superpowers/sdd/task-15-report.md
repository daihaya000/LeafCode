# Task 15 Report

## Result

- Added `isHeadless()` detection for `--headless`, `OPENCODE_HEADLESS=1`, and the existing `OPENCODE_WEBUI_HEADLESS=1` compatibility variable.
- Applied the detection to both existing-instance takeover and GUI/tray startup paths.
- Added focused Node tests and guarded `main()` so the module can be imported by tests.

## Verification

- `cd host && node --test src/index.test.js` — PASS (3 tests)
- `cd host && node --test src/*.test.js` — PASS (33 tests)
- `cd host && node --check src/index.js` — PASS
- `git diff --check` — PASS
