---
name: bug-hunt
description: Use when the user asks to find, diagnose, reproduce, fix, or verify bugs, crashes, errors, exceptions, regressions, flaky tests, or unexpected behavior. Also use for investigating reports like "it doesn't work", "X is broken", "why does Y happen", stack traces, and error logs. Covers root-cause analysis, minimal reproduction, fix strategy, and regression test creation.
---

# Bug Hunt

A disciplined workflow for tracking down, fixing, and preventing bugs.
Apply this whenever the user reports broken behavior, a crash, an error log,
a regression, or a flaky test. Bias toward **evidence over assumption**:
every claim about the cause must be backed by code, a log, or a reproducible
test before it is acted on.

## Core principles

1. **Reproduce before fixing.** A bug you cannot reproduce is a bug you cannot
   verify. Get a failing test, a repro script, or a concrete sequence of
   steps before touching code. If reproduction is blocked, say so explicitly
   and enumerate what you need from the user (input, env, version, logs).
2. **Bisect, don't guess.** When the cause is unclear, narrow it with
   `git bisect`, build narrowing, comment-out, or log-diff. Form one
   hypothesis at a time and test it. Do not stack multiple unverified fixes.
3. **Fix the root cause, not the symptom.** Suppressing an error, adding a
   try/catch that swallows it, or patching output to match expectations is
   a fix only when the root cause is genuinely out of scope. Otherwise track
   the symptom back to its source.
4. **Smallest possible change.** Resist refactors "while you're in there."
   Each edit should be traceable to the bug. Bundled refactors hide which
   change actually fixed the issue and make review and revert harder.
5. **Add a regression test.** The reproduction you already built becomes the
   regression test. Without it, the bug will come back and you won't know.
6. **Verify, don't assert.** Run the test suite, the linter, the typechecker.
   "Should work" is not verification.

## Workflow

### 1. Triage the report

Extract the contract before investigating:

- **Expected behavior** — what the user/code intended.
- **Actual behavior** — what happened instead.
- **Inputs / preconditions** — what triggers it.
- **Environment** — version, OS, browser, config, relevant env vars.
- **Evidence** — stack trace, error message, log lines, screenshot, failing
  test output. Quote the exact text; do not paraphrase stack traces.

If the report is vague ("it crashes"), ask the user for specifics using the
`question` tool before diving into code. One focused question beats twenty
minutes of speculation.

Use `todowrite` to track multi-step hunts so progress is visible:

- Reproduce
- Locate root cause
- Implement fix
- Add regression test
- Verify (tests + lint + typecheck)

### 2. Reproduce

Pick the cheapest reliable reproduction, in this order:

1. **Existing test** — find a test that exercises the path and make it fail.
2. **New test** — write the smallest test that reproduces the bug. Use the
   project's existing test framework; never invent a new one. Check
   `package.json` scripts, `AGENTS.md`, or the repo's test directory.
3. **Script / one-shot command** — for non-testable paths (build, CLI,
   integration with an external system).
4. **Manual repro** — last resort; document exact steps so they can be
   scripted later.

Capture the reproduction's output verbatim. This becomes the "before" state
you compare the fix against.

If reproduction is environment-specific and you don't have access, say so
and request a trace, a minimal repro repo, or a remote session. Do not
attempt a blind fix.

### 3. Locate the root cause

Navigate the evidence, not your hunch:

- **Stack trace** — read top-to-bottom; the first frame in *project* code is
  usually the entry point to the bug, not necessarily the bug itself. Walk
  down to the frame that actually holds the bad value or logic.
- **Error message** — grep the codebase for the exact string. If it's a
  framework/library message, grep for the symbol it references.
- **Logs** — identify the last good line and the first bad line; the bug
  fires between them.
- **Diff** — `git log -p -- <path>`, `git blame`, `git bisect` on the
  reproducing test. Regressions are almost always recent.

Tools to lean on, in parallel where possible:

- `grep` / `rg` for the error string and related symbols.
- `glob` to locate the relevant module.
- `read` on the suspect function and its callers.
- `git log`, `git diff`, `git blame`, `git bisect` for regressions.

State the hypothesis explicitly in one sentence:

> "The crash happens because `parseConfig` is called before `cwd` is set, so
> `resolve()` throws on `undefined`."

Then test that single hypothesis. If it's wrong, say so and form a new one.
Do not silently carry a disproven hypothesis forward.

### 4. Design the fix

Before editing, decide:

- **Where** the fix lives. Prefer the layer where the bad data originates,
  not the layer where it finally explodes. Fixing the caller is usually
  better than hardening the callee.
- **What** changes. Describe the semantic change, not the textual one
  ("set `cwd` before parsing" vs "add a line").
- **What else** depends on the current (buggy) behavior. Grep for callers
  and tests that may rely on the broken path. A "bug" that other code
  depends on is a design conflict, not a one-line fix.
- **Risk**. Does the fix touch a hot path? A public API? A serialization
  format? Flag higher-risk changes to the user before applying.

If the fix requires a breaking change, a config migration, or coordination
with another system, **stop and surface the decision** with the `question`
tool rather than committing silently to a path.

### 5. Implement

Apply the smallest change that fixes the root cause:

- Use `edit` for targeted changes; reserve `write` for full-file rewrites.
- Match the surrounding code style. Do not introduce new dependencies,
  patterns, or conventions to fix a bug.
- Do **not** add comments explaining the bug unless the user asks.
- Do **not** refactor neighboring code. Save it for a dedicated change.
- If you touch a public API or persisted format, update the docs and
  changelog the project maintains.

### 6. Add a regression test

Turn the reproduction from step 2 into a permanent test:

- It must **fail before** the fix and **pass after**. If you can't show both
  transitions, you haven't proven the fix.
- Place it next to existing tests for the same module; follow their style.
- Name it after the bug, not the fix:
  `parses config when cwd is unset` > `fixes #1234`.
- Cover the edge case that caused the bug, not just the happy path that
  exposed it.

If the project has no test framework, ask the user whether to add one or
leave the reproduction as a documented script. Do not silently introduce a
test framework.

### 7. Verify

Run the project's actual verification commands, in this order, and report
results:

1. **Regression test** — the one you just wrote, isolated first, then the
   whole suite for the touched module.
2. **Typecheck** — `tsc --noEmit`, `vue-tsc`, `pyright`, etc.
3. **Lint** — `eslint`, `ruff`, `golangci-lint`, etc.
4. **Full test suite** — only if the change could affect other paths.
5. **Manual check** — reproduce the original scenario by hand when tests
   can't cover it (UI, external system, timing-dependent bug).

Find the exact commands in `package.json`, `AGENTS.md`, `Makefile`,
`tox.ini`, or the repo's docs. Never guess a command name; if you can't find
it, ask.

If anything fails, **do not declare done**. Fix it or report the blocker.

### 8. Summarize for the user

Close the loop with a tight report:

- **Root cause** — one sentence, with `file_path:line` reference.
- **Fix** — what changed and why, with `file_path:line`.
- **Regression test** — name and location.
- **Verification** — which commands ran and their results.
- **Follow-ups** — anything you noticed but intentionally did not touch
  (nearby code smell, missing test coverage, related latent bug). Leave
  these as suggestions, not silent edits.

## Anti-patterns to avoid

- **Shotgun debugging** — changing multiple things at once and hoping one
  works. One hypothesis, one change, one verification.
- **Fixing symptoms** — catching an exception, retrying, or defaulting a bad
  value when the upstream logic is wrong.
- **Blind fixes** — editing code based on a guess with no reproduction. You
  cannot know if you fixed it.
- **Silent refactors** — "cleaning up" while fixing. Bundled changes hide
  the actual fix and bloat the diff.
- **Asserting success** — claiming "fixed" without running tests. Run them.
- **Swallowing failures** — making a failing test pass by weakening its
  assertions. The test exists to fail; if it's wrong, fix the test, don't
  neuter it.
- **Ignoring flakiness** — a test that passes "eventually" is a bug. Treat
  flaky tests as real bugs: isolate the race, add determinism, then fix.

## When to stop and ask

- The reproduction needs access you don't have (DB, paid API, prod env).
- The fix requires a breaking change or a config migration.
- Two valid fixes exist with different tradeoffs (speed vs memory, safety
  vs ergonomics, fix-now vs fix-properly).
- The "bug" is actually intended behavior and the user's expectation is
  wrong — confirm before changing code.
- You've formed and disproven three hypotheses. Step back and request more
  evidence (logs, repro repo, pair session) rather than burning more
  guesses.

Use the `question` tool with concrete, bounded options so the user can
unblock you in one answer.