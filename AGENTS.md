# LeafCode プロジェクト指示

グローバル `~/.config/opencode/AGENTS.md` に追加して適用する。

## bash / 検証

- **禁止**: `next dev` / `next start` / `npx next dev` / `npm run dev` / watch 系など、終了しない常駐プロセスを bash でフォアグラウンド起動すること
  - 理由: bash ツールはプロセス終了待ちのため必ずタイムアウトする。複数 Next 並走は `.next` 破壊の原因にもなる
- トレイ host（`LeafCode.exe` ランチャー）が既に WebUI を起動している。エージェント側で追加起動しない
- 検証は `tsc` / `eslint` / `vitest`、または既存 host（例: `http://127.0.0.1:3000`）への短いヘルスチェックに限定する
- **禁止**: `build.bat` / `next build` / `npm run build`（web）をエージェントが勝手に起動すること
  - 理由: 本番ビルドは稼働中の WebUI を停止させ、ブラウザの SSE 接続を切断してクラッシュさせる。ビルドはユーザーが明示的に指示した時のみ実行する
  - 検証目的のコード正しさは `tsc` / `eslint` / `vitest` で確認し、本番ビルドの検証はユーザーに委ねる
- **禁止**: `npx playwright test --debug` / `--ui` / `codegen` / `--grep <存在しないパターン>` など、対話・常駐・終了しない実行形態を bash でフォアグラウンド起動すること
  - Playwright E2E は `npm run e2e` または wrapper スクリプト経由の CI モードのみ。テスト名絞り込みが必要なら `--grep` 使用前に `npx playwright test --list --grep <pattern>` で存在確認する
  - 理由: debug/ui モードは inspector 接続を待ち、bash ツールはプロセス終了待ちのためタイムアウトする。存在しない grep パターンでも `--debug` 付きでは worker が hung することがある
- **Windows の `playwright-cli`**: OpenCode bash から npm の `playwright-cli` / `npx playwright-cli` を直接実行しない。`node scripts/playwright-cli-wrap/cli.mjs <args>` を使う（LeafCode host がデーモンを引き受ける）。host 再起動後は PATH 先頭の `playwright-cli` も同じ shim。
  - 理由: `playwright-cli open` の常駐デーモンが Job Object に残り、bash が終わらない（OpenCode #24731）

## Windows バッチファイル / エンコード

- `.bat` / `.cmd` に非 ASCII 文字（日本語・全角記号）を一切書かない（`rem` コメント内も禁止。cmd.exe が読み取り位置を誤って行の途中から実行するため）
- README / docs の ` ```bat ` 例も同様に ASCII のみ（日本語説明はフェンス外へ）
- ユーザー向け日本語は `scripts/setup-messages/*.txt` に置き `type` で出力する
- 改行は CRLF、BOM なし（`.gitattributes` + `.editorconfig`）
- PowerShell から JSON/パスを読むときは stdout を UTF-8 にする（`[Console]::OutputEncoding`）。一時 `.ps1` を書く場合は UTF-8 **BOM 付き**
- 配布前: `npm run test:encoding`（`host/src/bat-encoding.test.js`）を通す
- `host/src/bat-encoding.test.js` がこれを検証する
- cmd.exe の挙動（`%VAR%` の展開タイミング・`errorlevel` の伝播・`goto` / `call` / `exit /b` の戻り値）は**脳内で追わない**。最小の probe `.bat` を書いて実行し、実際の出力で確認する。1 回で切り分かなければ probe を分割する
- probe スクリプトは検証用の一時ファイル。タスク終了時に削除する（`git status` で自分が作ったものだけを対象にする）

## ツール引数スキーマ

- tool call は実行前に required key を自己点検し、省略形・推測フィールド名・配列要素の必須キー欠落を出さない
- `question` tool は `questions` 配列の各要素に `question` / `header` / `options` / `multiple` を必ず入れる。`options` の各要素は `label` / `description` を必ず入れる
- `todowrite` tool は `todos` 配列の各要素に `content` / `status` / `priority` を必ず入れる。`status` は `pending` / `in_progress` / `completed` / `cancelled`、`priority` は `high` / `medium` / `low` のいずれか
- SchemaError / invalid arguments が出たら、エラーパスにある required key を補って再実行する
