# WebUI アドオン

OpenCode 本体の plugin とは別の、**WebUI 専用拡張**を置く場所です。

## 追加手順

1. `addons/<name>/` を作成する
2. 少なくとも次を用意する:
   - `index.ts` … `WebUIAddon` 互換オブジェクトを export（例: `codexbarAddon`）
   - ウィジェット / ロジック / 必要なら `api/`・`public/`
3. `web/src/lib/addons/registry.ts` に 1 行登録する
4. API がある場合は `web/src/app/api/addons/<name>/…/route.ts` で薄い re-export
5. 静的ファイルは `addons/<name>/public/` に置き、`npm run sync:addons` で `web/public/addons/<name>/` へ同期

## 現状

| アドオン | パス |
|---------|------|
| CodexBar 利用状況 | [`codexbar/`](./codexbar/) |

共有ホスト（`AddonHost` / 設定トグル / localStorage）は `web/src/lib/addons` と `web/src/components/addons` に残しています。

## パス解決と外部ディレクトリの制約（IMPROVEMENT 7-1）

アドオンは `web/` の外（repo-root `addons/`）にあるため、次が必須です。

- **`@addons/*` のエイリアス**: `web/tsconfig.json` の `paths` で `"@addons/*": ["../addons/*"]` に解決
- **`experimental.externalDir: true`**: `web/next.config.ts` で外部ディレクトリのソースをコンパイル（これがないと `next build` が addons をトランスパイルしない）
- **`outputFileTracingRoot: join(__dirname, "..")`**: ファイルトレーシングのルートを repo-root にピン（ユーザープロファイル上の無関係な lockfile をルート誤認して `next build` のスキャンが暴走する事故を防ぐ。`next.config.ts` のコメント参照）

### アドオンコード側の注意

- 依存は **web の `node_modules` を再利用**する。`addons/<name>/` に独自の `node_modules` を入れても配布・同期対象外（`npm run sync:addons` は `public/` と `api/` のみ扱う）
- `import { ... } from "@/components/ui"` のような `@/*`（web の src 配下）も解決されるが、アドオンは web の内部実装に依存しすぎないこと（スロット API と `lib/addons/types.ts` の `WebUIAddon` 契約に沿う）
- vitest（web 側）も tsconfig の paths 経由で `@addons/*` を解決するため、テストは `web` ディレクトリから実行する
