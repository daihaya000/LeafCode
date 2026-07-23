## ステータス: DONE

## 実装
- `refresh-title` の一時セッションへのタイトル生成リクエスト前に `/experimental/tool/ids` を取得。
- 取得した全ツールIDをキーに、値をすべて `false` にした非空 `tools` マップを構築。
- ID取得失敗または空配列の場合は、既知の安全なツール集合または `bash: false` にフォールバック。
- 既存のタイトル生成・一時セッション削除・元セッション更新フローは変更なし。
- 既存の `refresh-title` テストに、全ツール無効化マップの検証を追加。

## 検証
- `npx vitest run "src/app/api/workspaces/[id]/sessions/[sessionId]/refresh-title/route.test.ts"`: 1 file / 5 tests PASS
- `npx tsc --noEmit`: PASS
- `npx eslint "src/app/api/workspaces/[id]/sessions/[sessionId]/refresh-title/route.ts" "src/app/api/workspaces/[id]/sessions/[sessionId]/refresh-title/route.test.ts"`: PASS
- `git diff --check`: PASS
- コミット後に `git status` と `git log` を確認予定。

## 懸念
- `/experimental/tool/ids` の取得に失敗した場合、フォールバック集合に含まれない動的ツールは列挙できない。ただし空の `tools` は送らず、既知ツールを明示的に無効化する fail-closed 寄りのフォールバックとしている。

## コミット
- `29607d2 fix: タイトル再生成の全ツールを無効化`

## Task 6レビュー Important 修正
- `/experimental/tool/ids` の取得失敗・空配列・非配列レスポンスでは既知リストへフォールバックせず、502エラーを返すように変更。
- fail-closed条件では一時セッションを削除し、タイトル生成用の `/session/{tempId}/message`、元セッション更新、DB・manifest更新を呼び出さないことを `route.test.ts` に追加。

## 追加検証
- `npx vitest run "src/app/api/workspaces/[id]/sessions/[sessionId]/refresh-title/route.test.ts"`: 1 file / 8 tests PASS
- `npx tsc --noEmit`: PASS

## Task 6 再レビュー（Important）
- tool IDs 取得時の `OcError` を含む全失敗、空配列、非配列レスポンスを 502 に正規化。
- fail-closed 時にタイトル生成用 `/session/{tempId}/message` が呼ばれないことを検証。
- `OcError(404)` が 404 ではなく 502 になる回帰テストを追加。
