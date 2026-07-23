# Task 13 Report

## Changes

- `createTemporaryCopy` はコピー完了後、コピー root 外を指す symlink を除去する。内向き symlink は追跡せず、循環を防止する。
- コピー失敗時は、この呼び出しが新規作成した直接のコピー先だけをロールバックする。既存・兄弟コピーは削除しない。
- `removeTemporaryCopy` は copies root の直接の子との完全一致を要求し、root 自体や入れ子のパスを削除しない。
- `provisionWorkspace` の temporary copy allowlist 登録失敗時、作成済みコピーと同一パスの allowlist エントリをベストエフォートで削除する。

## TDD / Verification

- RED: `npx vitest run src/lib/copy.test.ts` — 外向き symlink 除去・部分コピーのロールバックが未実装で失敗。
- RED: `npx vitest run src/lib/workspace-service.test.ts` — allowlist 登録失敗時の cleanup が未実装で失敗。
- GREEN: `npx vitest run src/lib/copy.test.ts src/lib/workspace-service.test.ts` — PASS（2 files / 12 tests）。
- `npm run typecheck` — PASS。

## Notes

- Windows で symlink 作成可能な環境で、外向き symlink 除去テストを実行して PASS。

## Importantレビュー修正

- allowlist 登録失敗時は、allowlist エントリと作成済み temporary copy を独立してベストエフォート削除する。片方の cleanup が失敗してももう片方を実行する。
- temporary copy 削除は、正規化済みパスの basename が workspace/copy ID と完全一致する直接の子だけを許可する。manifest の `copy-a/../copy-b` のようなパスで別コピーを削除できない。
- symlink cleanup は `lstatSync` で no-follow 判定し、削除直前に再検査して `unlinkSync` を使う。atomic publish ではないため、copies root は当該プロセス/ユーザーだけが書き込める場所に限定する。

### TDD / Verification

- RED: `npm test -- src/lib/workspace-service.test.ts src/lib/copy.test.ts` — allowlist 失敗時の copy cleanup 未実施、および `copy-a/../copy-b` が sibling copy を削除することを確認。
- GREEN: `npm test -- src/lib/workspace-service.test.ts src/lib/copy.test.ts` — PASS（2 files / 13 tests）。
- `npm test -- src/app/api/workspaces/orphans/route.test.ts` — PASS（1 file / 5 tests）。
- `npm run typecheck` — PASS。
