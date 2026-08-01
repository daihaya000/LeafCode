# Claude Auth vendor

This directory contains the runtime files from `opencode-claude-auth` 2.1.5,
vendored so new OpenCode profiles do not depend on npm availability.

- `plugin/claude-auth.js`: OpenCode auto-load entry
- `packages/claude-auth/dist`: bundled plugin runtime

Credentials are read at runtime from the user's Claude Code credential store;
no credentials are included here.
