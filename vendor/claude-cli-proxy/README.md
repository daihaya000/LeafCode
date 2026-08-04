# Claude CLI Proxy (fork)

This directory is a fork of `opencode-claude-auth` (originally vendored at
2.1.5), maintained in this repository so new OpenCode profiles do not depend
on npm availability.

- `plugin/claude-cli-proxy.js`: OpenCode auto-load entry
- `packages/claude-cli-proxy/dist`: bundled plugin runtime (unmodified upstream dist)

**Self-contained**: All dist files use only Node.js built-in modules (`node:crypto`,
`node:fs`, `node:os`, `node:path`, `node:child_process`) and relative imports.
No external npm packages are required at runtime.

Credentials are read at runtime from the user's Claude Code credential store;
no credentials are included here.
