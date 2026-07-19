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
