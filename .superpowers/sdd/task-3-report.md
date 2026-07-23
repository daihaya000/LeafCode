## Task 3 実施報告

### 結果

- R52: `GET /provider` の JSON 応答を `maskSecrets` に通過させた。
- R49: `GET /config/providers` の JSON 応答を `maskSecrets` に通過させた。
- R48: `GET /global/config` の JSON 応答を `maskSecrets` に通過させた。
- `/config/providers` は既存の directory 要件により 400 にならないよう、GET の directory 不要許可対象にも追加した。
- SSE、非 JSON 応答、上記以外の経路は既存のプロキシ処理を維持した。

### 変更ファイル

- `web/src/app/api/opencode/[...path]/route.ts`
  - マスキング対象を `/config`、`/provider`、`/config/providers`、`/global/config` に拡張。
  - `/config/providers` の GET を directory 不要許可対象に追加。
- `web/src/app/api/opencode/[...path]/route.test.ts`
  - 3 経路の secret マスキング回帰テストを追加。

### TDD 記録

1. RED: 実装前に回帰テストを追加し、以下を確認した。
   - `/provider`: 平文の `key` が返った。
   - `/config/providers`: directory 不足で 400 になった。
   - `/global/config`: `maskSecrets` 未適用で secret が平文だった。
2. GREEN: 対象パスの Set と directory 不要許可を最小追加し、3 ケースを含む route テスト 6 件が成功した。

### 検証

- `npx vitest run "src/app/api/opencode/[...path]/route.test.ts" --pool=threads --maxWorkers=1 --minWorkers=1`
  - PASS: 6 tests
- `npx vitest run "src/app/api/opencode/[...path]/route.test.ts" "src/lib/opencode.test.ts" "src/lib/opencode-id.test.ts" --pool=threads --maxWorkers=1 --minWorkers=1`
  - PASS: 2 files / 25 tests（存在する関連テストを実行）
- `npm run typecheck`
  - PASS: `tsc --noEmit`
- `npx eslint "src/app/api/opencode/[...path]/route.ts" "src/app/api/opencode/[...path]/route.test.ts"`
  - PASS: exit code 0
- `git diff --check`
  - PASS: whitespace エラーなし

### log / 差分確認

- RED/GREEN の Vitest 出力を確認した。
- `git status` / `git diff` で変更対象が route.ts、route.test.ts のみであることを確認した（レポート自身はコミット対象）。
- 検証途中に生成された不要な `$null` ファイルは削除した。
- テスト用のダミー secret は回帰テスト内だけに存在し、実装コードには追加していない。

### コミット

- 予定メッセージ: `feat: GET /provider・/config/providers・/global/config に maskSecrets を適用`
