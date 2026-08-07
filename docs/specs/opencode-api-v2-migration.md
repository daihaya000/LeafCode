# OpenCode エンジン API v2 (beta) への移行準備

## 背景

OpenCode エンジンは現在 **2 世代の API を同時に公開**している。

- **v1** — 元々のフラットな面。`/session`, `/session/{id}/message`,
  `/permission/{id}/reply` など。
- **v2 (beta)** — `/api/*` の面。`/api/session/{id}/prompt`,
  `/api/session/{id}/permission/{requestID}/reply` など。SSE も
  `session.next.*` という細粒度のストリーミングイベントを持つ。

WebUI は **どちらか一方ではなく両方を使っているハイブリッド**である。
「v1 のみを使っている」と読み違えると移行規模の見積もりを誤るため、
現状を表に固定しておく。

> 用語の注意: コード中の `permission.v2.asked` / `question.v2.asked` や
> `PermissionRequest.version: "v1" | "v2"` は、この API 世代と**同じもの**を
> 指す。一方 `SessionStatus.type` の `"busy"`/`"idle"` や `Part.type` の
> `"text"`/`"tool"` は世代とは無関係な別の列挙である。

## 現状の API サーフェス

| 領域 | 使用世代 | パス / イベント |
|------|----------|-----------------|
| セッション作成・一覧 | v1 | `POST` / `GET /session` |
| プロンプト送信 | v1 | `POST /session/{id}/prompt_async` |
| セッション状態 | v1 | `GET /session/status` |
| トランスクリプト / todo / diff / abort / command | v1 | `/session/{id}/{message,todo,diff,abort,command}` |
| パーミッション・質問の一覧 | v1 と v2 の**両方**を取得してマージ | `/permission`・`/question` + `/api/session/{id}/{permission,question}` |
| パーミッション・質問への応答 | 要求元の世代に追従 | v1: `/session/{id}/permissions/{id}`・`/question/{id}/reply`<br>v2: `/api/session/{id}/…/reply` |
| SSE ストリーム | v1 と v2 を**同一ストリーム**で処理 | `message.part.updated` 等 + `session.next.*`（`text.delta` / `tool.input.delta` / `tool.called` / `tool.success` …） |
| セッション単位の権限ルール | v1 | `PATCH /session/{id}` |

一覧・応答・SSE が既に v2 を扱えているのは、エンジンのバージョンによって
どちらの世代が有効かが変わるため。片方が 404 でも他方で機能するよう
フェイルセーフに書かれている。

## 移行に備えて導入した仕組み

| 仕組み | 実体 | 何を守るか |
|--------|------|-----------|
| パスレジストリ | `web/src/lib/opencode-paths.ts` | エンジンのパス文字列を 1 箇所に集約。v2 への切り替えはビルダー 1 行の変更で済む |
| REST のコンパイル時ドリフト検知 | 同ファイルの `OC_PATH_TEMPLATES ... satisfies Record<string, keyof OcPaths>` | 型再生成後、エンジンから消えた／改名されたエンドポイントが **`tsc` エラー**になる（実行時 404 で気付く事態を防ぐ）。TypeScript は正しい候補名まで提示する |
| SSE イベントレジストリ | `web/src/lib/opencode-events.ts` | 購読しているイベント型を宣言し、世代（v1/v2）を分類する |
| SSE のドリフト検知 | `web/src/lib/opencode-events.test.ts` | 宣言したイベントが生成スキーマから消えたらテストが落ちる。`useSessionStream.ts` が比較しているリテラルがレジストリ未登録の場合も落ちる |
| 生成物の鮮度チェック | `web/src/lib/opencode-schema-freshness.test.ts` | `opencode-schema.d.ts` のパス集合が `docs/opencode/openapi.json` と一致することを検証。上 2 つの保証が**古い生成物の上で空回りする**のを防ぐ |

## エンジンを上げるときの手順

1. `docs/opencode/openapi.json` を新しい `GET /doc` の出力で更新し、
   `docs/opencode/VERSION` を新しいバージョン文字列に書き換える。
2. `web/` で `npm run gen:types` を実行し、`opencode-schema.d.ts` を再生成する。
3. `npx tsc --noEmit`
   … 消えた REST パスがあれば `opencode-paths.ts` の該当行でエラーになる。
4. `npx vitest run src/lib/opencode-events.test.ts src/lib/opencode-schema-freshness.test.ts`
   … 消えた SSE イベントと、生成物の取り残しを検出する。
5. 検出された差分ごとに v2 の対応エンドポイントへ載せ替える。
   `opencode-paths.ts` にはすでに v2 用のビルダー命名規則
   （`...PathV2` / `v2...` テンプレート名）があるので、それに揃える。

## 意図的に未移行として残している箇所

`opencode-access-mode.ts` / `opencode-skill-permission.ts` /
`opencode-task-permission.ts` の `PATCH /session/{id}`
（セッション単位の権限ルール書き込み）はレジストリを経由していない。

理由:

- これらは他と異なり、**セッション id を厳格検証せず percent-encode のみ**で
  通す契約を既存テスト（`/session/ses%2Fweird%20id` を期待）が固定している。
  レジストリのビルダーは不正 id で throw するため、載せ替えると挙動が変わる。
- v2 側の等価物は単純なパス差し替えでは済まない。保存済みパーミッションの
  API 形状（`/api/permission/saved`）が v1 のセッション ruleset と異なるため、
  移行時に個別設計が必要になる。

## 見送った案

- **Capability detection / フィーチャーフラグ**: v2 の最低必要バージョンが
  未確定で、切り替え先の実装も存在しないため、現時点では消費者のいない
  死にコードになる。v2 GA 時に、`/api/health` への probe ではなく既存の
  `HealthDto.opencode.version` を使ったバージョン判定として実装するのが安い。
