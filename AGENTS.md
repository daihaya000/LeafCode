# OpenCodeWebUI プロジェクト指示

グローバル `~/.config/opencode/AGENTS.md` に追加して適用する。

## bash / 検証

- **禁止**: `next dev` / `next start` / `npx next dev` / `npm run dev` / watch 系など、終了しない常駐プロセスを bash でフォアグラウンド起動すること
  - 理由: bash ツールはプロセス終了待ちのため必ずタイムアウトする。複数 Next 並走は `.next` 破壊の原因にもなる
- トレイ host（`start-webui.bat`）が既に WebUI を起動している。エージェント側で追加起動しない
- 検証は `tsc` / `eslint` / `vitest`、または既存 host（例: `http://127.0.0.1:3000`）への短いヘルスチェックに限定する

## Windows バッチファイル

- `.bat` / `.cmd` に非 ASCII 文字（日本語・全角記号）を一切書かない（`rem` コメント内も禁止。cmd.exe が読み取り位置を誤って行の途中から実行するため）
- ユーザー向け日本語は `scripts/setup-messages/*.txt` に置き `type` で出力する
- 改行は CRLF、BOM なし
- `host/src/bat-encoding.test.js` がこれを検証する
