# 非 Latin-1 文字（日本語など）を含むワークスペースパスの対応

> 実装ステータス: ✅ 実装済み（参照: `web/src/lib/db.ts` / `web/src/app/api/opencode/[...path]/route.ts`）

## 背景・問題

ワークスペースの絶対パス（`directory`）を HTTP ヘッダー `x-opencode-directory` に生の文字列で設定している箇所があり、パスに Latin-1 (U+0000–U+00FF) 外の文字が含まれると `Headers.set()` / `fetch()` が例外を投げる。

```
Cannot convert argument to a ByteString because the character at index 22 has a value of 20250 which is greater than 255.
```

- HTTP ヘッダー値は WebIDL の `ByteString`。非 Latin-1 文字は仕様上格納できない。
- ブラウザの `fetch` でも Node (undici) の `fetch` / `Headers` でも同一の例外になることを実機確認済み。
- 許可ルートはユーザーが WebUI から自由に追加でき（`web/src/lib/db.ts` の `addAllowedRoot`）、文字種の制限は無い。`C:\Users\<name>\OneDrive\会議\project` のような日本語パスは実運用で普通に発生する。
- 結果として、日本語を含むパスのワークスペースでは WebUI の OpenCode 系 API 呼び出しが全滅する。

## 対象と非対象

- 対象: `web/` 配下で `directory` を HTTP ヘッダーへ載せている全経路（ブラウザ → BFF、BFF → OpenCode エンジン）と開発用スクリプト。
- 非対象:
  - OpenCode エンジン本体の変更。
  - `x-opencode-directory` ヘッダー方式の完全廃止（ASCII パスでは互換のため送信を維持する）。
  - パス正規化（NFC/NFD）やパス文字種のバリデーション追加。`path.resolve` / `path.relative` ベースの許可ルート判定は非 ASCII でも正しく動作するため変更しない。

## 方式

**`directory` の一次伝達手段をクエリパラメータ `?directory=` に統一し、`x-opencode-directory` ヘッダーは Latin-1 安全な値の場合のみ後方互換目的で併送する。**

根拠:

- `URL` / `URLSearchParams` は Unicode を自動で percent-encode するため、クエリ経路は非 ASCII に対して安全。
- OpenCode の OpenAPI 型定義（`web/src/lib/opencode-schema.d.ts`）は全エンドポイントで `directory` を `query` パラメータとして定義しており（`header?: never`）、クエリ渡しが正式な契約と整合する。
- BFF プロキシは既にヘッダー欠落時のフォールバックとしてクエリを読む（`web/src/app/api/opencode/[...path]/route.ts` の directory 解決）。ブラウザ側の主要 3 経路も既にクエリを併送しているため、変更は最小で済む。
- ヘッダーを ASCII パスで送り続けることで、既存の ASCII 環境に対する挙動変更（＝回帰リスク）をゼロにする。

### 共有ヘルパ

`web/src/lib/directory-header.ts` を新規追加し、ヘッダー生成とクエリ付与を一箇所に集約する。

- `isHeaderSafeValue(value: string): boolean`
  - すべての文字が U+0000–U+00FF の範囲内で、かつ CR / LF / NUL を含まない場合のみ `true`。
  - CR/LF 除外はヘッダーインジェクションに対する多層防御を兼ねる。
- `directoryHeaders(directory: string | null | undefined): Record<string, string>`
  - `directory` が空、または `isHeaderSafeValue` が `false` の場合は空オブジェクトを返す（**例外を投げない**）。
  - それ以外は `{ "x-opencode-directory": directory }` を返す。
- `withDirectoryQuery(url: URL, directory: string | null | undefined): URL`
  - `directory` が空でなければ `url.searchParams.set("directory", directory)` を実行して同じ `URL` を返す。

このモジュールはブラウザ / サーバ両方から import されるため、Node 専用 API・ブラウザ専用 API に依存しない。

### 変更箇所

| 経路 | ファイル | 変更内容 |
| --- | --- | --- |
| ブラウザ → BFF | `web/src/lib/client.ts`（`ocJson`） | ヘッダー直書きを `directoryHeaders(directory)` に置換。クエリは既存 `apiUrl(..., { directory })` を維持 |
| ブラウザ → BFF | `web/src/components/CommandPalette.tsx` | ヘッダー直書きを `directoryHeaders(directory)` に置換（クエリは既存のまま） |
| ブラウザ → BFF | `web/src/lib/useSlashCommands.ts` | ヘッダー直書きを `directoryHeaders(directory)` に置換。URL 組み立ても `withDirectoryQuery` に統一 |
| BFF → エンジン | `web/src/app/api/opencode/[...path]/route.ts` | ① 上流 URL へ **directory があれば常に** `withDirectoryQuery` でクエリを付与する（現状は呼び出し元が既に `?directory=` を持つ場合のみ上書き）。② 転送ヘッダーの設定を `directoryHeaders` 経由にし、非 Latin-1 の場合はヘッダーを付けない。③ 受信側で非 Latin-1 のヘッダーが来ることは構造上ありえないため、directory の解決順（ヘッダー優先 → クエリ）は変更しない |
| BFF → エンジン | `web/src/lib/oc-server.ts`（`ocServer`） | ヘッダー直書きを `directoryHeaders` に置換し、**新たに** `withDirectoryQuery` で上流 URL にクエリを付与する（現状はヘッダーのみで directory を渡している） |
| BFF → エンジン | `web/src/app/api/diff/route.ts` | ヘッダー直書きを `directoryHeaders(check.path)` に置換（クエリは既存のまま） |
| 開発用スクリプト | `web/scripts/purge-stale-opencode-sessions.mjs` | 同方針でヘッダーを条件付きにする。ヘルパを import できない場合は同等の inline 判定を用いる |

SSE（`/event`）経路も同じプロキシを通るため、上記 route.ts の変更で同時に修正される。

## 安全性

- `directory` は従来どおり `assertAllowedDirectory`（`web/src/lib/allowlist.ts`）で許可ルート検証を行う。検証位置・内容は変更しない。
- 上流 URL のクエリ `directory` は、検証済みの値で常に上書きする。呼び出し元が送った未検証の `?directory=` がそのまま上流へ届かない（既存の多層防御を維持・強化）。
- CR / LF / NUL を含む値はヘッダーに載せないため、ヘッダーインジェクションの余地を残さない。
- ヘルパは例外を投げない設計にし、不正値でリクエスト全体がクラッシュしないようにする。

## テスト

`web` の `npm test`（`vitest run`）で検証する。

1. `web/src/lib/directory-header.test.ts`（新規）
   - ASCII パス → ヘッダーが付く。
   - 日本語を含むパス → ヘッダーが空になり、例外を投げない。
   - Latin-1 範囲内の非 ASCII（例 `é`）→ ヘッダーが付く。
   - CR / LF / NUL を含む値 → ヘッダーが空になる。
   - `null` / `undefined` / 空文字 → ヘッダーが空、クエリも付かない。
   - `withDirectoryQuery` が日本語パスを percent-encode してクエリに載せる。
2. `web/src/app/api/opencode/[...path]/route.test.ts`（追記）
   - 日本語を含む許可ディレクトリを `?directory=` で渡したとき、上流 fetch が例外なく実行され、URL のクエリに正しい directory が入り、`x-opencode-directory` ヘッダーが**付かない**こと。
   - ASCII ディレクトリでは従来どおりヘッダーが付き、かつ上流 URL にクエリも付くこと（既存の回帰テスト `directory-scoped /provider fallback` を壊さない）。
3. 既存テスト（`route.test.ts`・`allowlist.test.ts` ほか）が全て通ること。

`tsc` / `eslint` も通すこと。常駐プロセス（`next dev` 等）による検証は行わない。

## 受入条件

1. 日本語を含むパスのワークスペースで、セッション一覧取得・プロンプト送信・ファイル検索（コマンドパレット）・スラッシュコマンド一覧・diff 表示が `ByteString` 例外なしに動作する。
2. ASCII パスのワークスペースの挙動が変わらない（`x-opencode-directory` ヘッダーは従来どおり送信される）。
3. `directory` をヘッダーへ生で書いている箇所が `web/` 配下に残っていない（共有ヘルパ経由に統一されている）。
4. BFF から上流 OpenCode への全リクエストで、directory が存在する場合はクエリ `?directory=` が必ず付与される。
5. `npm test` / `tsc` / `eslint` が通る。
