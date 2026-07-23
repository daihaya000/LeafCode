# Task 18 report

- `timedFetch` のレスポンス JSON 読了までタイムアウトを維持する処理を追加。
- `getJson` / `sendJson` / `ocJson` の JSON 読了を同一タイムアウトで監視し、タイムアウト時は status 408 の `ApiError` を送出。
- ボディ読了ハングの失敗テストを先に追加し、実装後に成功を確認。

## Verification

- `npx vitest run src/lib/client.test.ts` — 5 passed
- `npm run typecheck` — passed
- `npx eslint src/lib/client.ts src/lib/client.test.ts` — passed

## Review fix

- brief の仕様は `res.json()` 読了までのタイムアウト保証だったが、公開 API の安全性を優先し、`timedFetch` では `json` / `text` / `arrayBuffer` / `blob` / `formData` と直接の `body` stream を同じタイムアウトで wrap。
- `getJson` / `sendJson` / `ocJson` のボディ読了ハング、`timedFetch().json()` monkey patch、`ApiError.status === 408` を検証するテストを追加。
