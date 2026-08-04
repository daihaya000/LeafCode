# Claude CLI Proxy (fork)

This directory is a fork of `opencode-claude-auth` (originally vendored at
2.1.5), maintained in this repository so new OpenCode profiles do not depend
on npm availability.

- `plugin/claude-cli-proxy.js`: OpenCode auto-load entry
- `packages/claude-cli-proxy/dist`: bundled plugin runtime (unmodified upstream dist)

Credentials are read at runtime from the user's Claude Code credential store;
no credentials are included here.
