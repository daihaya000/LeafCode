# 設定のエージェントタブでエージェントの有効化/無効化

## 目的

設定画面の「エージェント」タブから、OpenCode の各エージェントを有効・無効に切り替えられるようにする。

## 対象と非対象

- 対象: OpenCode エンジンから `/api/opencode/agent` で返される全エージェント。
- 非対象: エージェントの追加・削除、モデル・プロンプト・権限などその他の属性編集。
- OpenCode プロキシ経由の設定書込みは引き続き禁止する。WebUI サーバー API が `opencode.jsonc` のみを操作する。

## 制御方法

- 有効/無効は OpenCode グローバル設定 `opencode.jsonc` のトップレベル `agent.<name>.disable` フラグで制御する。
  - `disable: true` → 無効
  - `disable: false` または未定義 → 有効
- 組み込みエージェントを無効化する場合、`opencode.jsonc` に `agent.<name>.disable: true` を追加する。
- 有効化時は `agent.<name>.disable: false` に変更する。エントリがこれだけの場合でも削除せず、明示的に false にしてJSONC編集の副作用を最小限に抑える。

## 一覧取得のマージ戦略

OpenCode エンジンの `/agent` 応答は無効化されたエージェントを返さない可能性がある。そのため WebUI は以下をマージして一覧を構成する。

1. **OpenCode `/agent` 応答**を `enabled: true` として採用する。
2. **WebUI ローカル状態ファイル**（`%APPDATA%/opencode-webui/agent-state.json`）に記録された無効化済みエージェント名を、メタデータが不明な `enabled: false` エントリとして追加する。
3. **設定ファイル** `opencode.jsonc` の `agent` オブジェクト内で `disable: true` のエージェントを、可能な範囲でメタデータを復元して追加する。

マージ順位: `/agent` 応答 > `opencode.jsonc` > WebUI ローカル状態。重複する場合 `/agent` 応答の情報を優先する。

## API

- `GET /api/extensions/agents?directory=<dir>`
  - 認可済みディレクトリのエージェント一覧を返す。
  - 応答: `{ agents: AgentDto[] }`
  - `AgentDto` は既存 `agent-utils.ts` の型を拡張し、`enabled: boolean` と `toggleable: boolean` を含む。
- `PATCH /api/extensions/agents/:name`
  - リクエスト本文: `{ enabled: boolean }`
  - `opencode.jsonc` の `agent.<name>.disable` を更新する。
  - 名前は `/agent` 応答または WebUI 状態に含まれる既知のエージェントに限定する。
  - 成功後は `GET` と同じ応答形式を返す（オプション）。

## 画面

- 既存のエージェント一覧テーブル/カードに「状態」列を追加し、各行に `ExtensionSwitch` と同形状のトグルスイッチを配置する。
- 状態バッジは「有効」「無効」のテキストを必ず表示する。
- 操作中は該当行だけを `aria-busy`・非活性にする。
- 変更成功後は「OpenCode を再起動」バナーを表示する。`ExtensionsSettings` と同じ再起動フローを使用する。
- ホストが利用できない場合は再起動ボタンを無効化し、トレイホスト経由で再起動する必要がある旨を表示する。
- 検索フィルタは名前・役割・提供元・モデル・説明・Mode に加えて有効/無効状態も対象とする。

## 安全性

- API はディレクトリ許可リストを検証し、クライアントから任意の設定ファイルパスを受け取らない。
- 設定ファイル更新は `jsonc-edit.ts` のロック付き read-modify-write を使用し、コメントと書式を保持する。
- WebUI ローカル状態ファイルは無効化エージェント名のみを保持し、秘密情報を含まない。
- エラーは利用者向け日本語メッセージに変換して返す。

## 受入条件

1. エージェントタブに各行のトグルスイッチが表示され、有効/無効を切り替えられる。
2. 無効化すると `opencode.jsonc` に `agent.<name>.disable: true` が追加される。
3. 有効化すると `agent.<name>.disable` が `false` に更新される。
4. 変更後に「OpenCode を再起動」バナーが表示される。
5. 無効化された組み込みエージェントも一覧に残り、再度有効化できる。
6. 操作中・エラー・空状態・再起動不可が画面と支援技術に明確に伝わる。
