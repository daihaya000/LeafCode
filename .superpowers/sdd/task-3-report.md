# Task 3 実装レポート

## 変更

- `TaskView` に共通の `touchActivity` callback を追加した。
  - 現在の task に `sessionId` がある場合、`POST /api/tasks/{taskId}/activity` を送信する。
  - 活動時刻 API の失敗は握りつぶし、プロンプト送信を継続する。
- 通常プロンプト、slash command、plan approval の送信前に `touchActivity()` を実行するようにした。
- 通常送信と plan approval の `finally` で `notifyTasksChanged()` を実行するようにした。
- TaskView テストに、通常送信・slash command・plan approval の順序、activity 失敗時の送信継続を追加した。
- テストモックを実際の `sendJson` に接続し、slash command と plan approval を操作できるようにした。
- テスト実行時の無限再レンダーを修正した。`accessMode !== "full"` の effect が毎回新しい `Set` を state に設定していたため、空集合時は同じ state を返すようにした。
- 前担当のデバッグ用 render trace と、指定された `__scratch.test.tsx` / `vitest-*.txt` 一時ファイルを削除した。

## 原因

初回の対象テストは worker の JavaScript heap out of memory で終了した。render trace の調査で TaskView が大量再レンダーしていることを確認し、`autoReplyFailedIds` を空の `Set` へ毎回置換していた effect が原因と特定した。

また、activity の追加テストが API 呼び出しを検出できなかった原因は、`@/lib/client` の `sendJson` モックが hoisted mock ではなく別の `vi.fn()` になっていたことだった。

## RED / GREEN

- RED: 初回実行は worker OOM。無限再レンダーのため activity テストまで到達しなかった。
- RED: 再レンダー停止後、activity テストは `sendJson` が呼ばれず失敗した。
- GREEN: `sendJson` モック接続後、activity 対象 4 テストが成功した。
- GREEN: 最終の TaskView 全 14 テストが成功した。

## 実行コマンドと結果

すべて `web` を作業ディレクトリとして実行し、Windows のパス解釈を避けるため対象パスを引用した。

```text
npm exec -- vitest run "src/components/task/TaskView.test.tsx" -t activity --pool=threads --maxWorkers=1 --minWorkers=1 --reporter=verbose
PASS: 4 passed, 10 skipped

npm exec -- vitest run "src/components/task/TaskView.test.tsx" --pool=threads --maxWorkers=1 --minWorkers=1
PASS: 14 passed

npm --prefix web run typecheck
PASS: tsc --noEmit

npm exec -- vitest run "src/lib/db.test.ts" "src/app/api/tasks/[id]/activity/route.test.ts" --pool=threads --maxWorkers=1 --minWorkers=1
PASS: 6 passed in 2 test files
```

`--maxWorkers=1 --minWorkers=1` は、前担当の再現結果と同様に通常の worker 実行で OOM になったため、環境負荷を抑えて安定実行するために指定した。

## 懸念

- Vitest のデフォルト worker 数ではこの環境で TaskView テストが OOM になる。コード修正後は単一 worker で安定して成功したが、CI では worker 数または Node heap 上限の確認が必要。
- activity API は仕様どおり best-effort のため、失敗時は UI にエラー表示しない。

## Task 3レビュー対応

- `sendJson` を deferred promise に変更し、通常プロンプトと slash command で activity API の完了前に送信されないことを検証するようにした。
- plan approval でも同じ await 境界を検証するようにした。
- activity 失敗時に通常プロンプトの送信を継続するテストは維持した。

## レビュー対応後の検証

```text
npm exec -- vitest run "src/components/task/TaskView.test.tsx" --pool=threads --maxWorkers=1 --minWorkers=1
PASS: 14 passed

npm --prefix web run typecheck
PASS: tsc --noEmit
```

## Task 3レビュー対応（追加）

- parameterized テストで activity resolve 後に実際の `streamMock[method]` が1回呼ばれたことを検証するようにした。
- slash command は `sendCommand("review", "args", expect.any(Object))` と `sendPrompt` 未呼び出しを検証するようにした。
- 通常 prompt は `sendPrompt("hello", expect.any(Object))` と `sendCommand` 未呼び出しを検証するようにした。
- deferred await 境界および activity 失敗時の継続テストは維持した。
