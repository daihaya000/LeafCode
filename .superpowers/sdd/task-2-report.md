# Task 2 実施報告

## 概要
`isBlockedOpencodeWrite` 関数に PTY/dispose/vcs/experimental/mcp-auth の denylist を追加。

## 変更ファイル
- `web/src/lib/opencode.ts` — denylist 28行追加
- `web/src/lib/opencode-id.test.ts` — テスト 43行追加

## TDD プロセス
1. **Red**: 新規テスト6件を追加し、全件 `expected false to be true` で失敗を確認
2. **Green**: `return false;` の前に denylist チェックを追加し、全9件パスを確認
3. **Refactor**: 不要（最小実装のため）

## テスト結果
```
✓ isBlockedOpencodeWrite (9 tests | 9 skipped)
  ✓ blocks PATCH /config and /global/config
  ✓ blocks auth DELETE on resolved pathnames
  ✓ blocks PTY create/update/delete/connect-token
  ✓ blocks global/instance dispose
  ✓ blocks vcs apply
  ✓ blocks experimental worktree/workspace mutating methods
  ✓ blocks experimental control-plane move-session and console switch
  ✓ blocks DELETE mcp auth
  ✓ still allows read-only endpoints
```

## コミット
```
638c5b8 feat: isBlockedOpencodeWrite に PTY/dispose/vcs/experimental/mcp-auth の denylist を追加
```

## Critical 修正 (2026-07-23)

### 問題
`isBlockedOpencodeWrite` は `/pty` 経路をブロックしていたが、OpenCode v2 API は `/api/pty` 経路（`/api/opencode/[...path]` プロキシ経由）を使用する。`/api/` プレフィックス付きの PTY 操作がブロックされていなかった。

### 修正内容
- `opencode.ts`: `/api/pty` の denylist 4行追加（POST /api/pty, PUT/DELETE /api/pty/{id}, POST /api/pty/{id}/connect-token）
- `opencode-id.test.ts`: `/api/pty` ブロックテスト1件 + read-only GET 確認2件追加

### テスト結果 (修正後)
```
✓ isBlockedOpencodeWrite (19 tests)
  ✓ blocks PATCH /config and /global/config
  ✓ blocks auth DELETE on resolved pathnames
  ✓ blocks PTY create/update/delete/connect-token
  ✓ blocks /api/pty create/update/delete/connect-token  ← 追加
  ✓ blocks global/instance dispose
  ✓ blocks vcs apply
  ✓ blocks experimental worktree/workspace mutating methods
  ✓ blocks experimental control-plane move-session and console switch
  ✓ blocks DELETE mcp auth
  ✓ still allows read-only endpoints (GET /api/pty, GET /api/pty/{id} 含む)
```

### コミット
```
<次コミット> fix: /api/pty 経路も isBlockedOpencodeWrite でブロックするよう修正
```

## 懸念事項
なし
