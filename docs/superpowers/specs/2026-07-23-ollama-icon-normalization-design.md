# Ollama ブランドアイコン正規化 仕様

## 現状

`addons/codexbar/public/ollama.png` は 181×256 px、RGBA 透過の縦長画像。同一ファイルが `web/public/addons/codexbar/ollama.png` にコピーされている。

他の CodexBar ブランドアイコンはすべて正方形（claude: 180×180, codex: 200×200, cursor: 180×180, opencode: 180×180, synthetic: 128×128）。Ollama のみ縦長であり、`ProviderIcon` コンポーネントで 14×14 や 12×12 に縮小表示した際に余白の偏りが生じる。

## 目的

Ollama ブランドアイコンを正方形キャンバスに統一し、全表示箇所で一貫した見た目を提供する。表示サイズ（14×14, 12×12）での視認性を改善する。

## 採用方針

| 項目 | 内容 |
|------|------|
| キャンバス | 180×180 px 正方形（他アイコンと同一） |
| 背景 | Ollama ブランド色（#DFE5E8 薄いグレー）で塗りつぶし。透過は持たない |
| ロゴ配置 | 中央揃え。元画像のアスペクト比を維持し、短辺がキャンバスにフィットするようスケール |
| ファイル形式 | PNG、他アイコンと同形式 |
| ファイル名 | `ollama.png`（変更なし） |
| 理由 | 透過のまま正方形にすると余白が透明になり、ダーク/ライト両テーマで浮いて見える。Ollama 公式サイトのヘッダー/ファビコンでも薄いグレー背景が使われており、ブランドらしさを損なわない |

## 対象資産

| パス | 役割 |
|------|------|
| `addons/codexbar/public/ollama.png` | ソース（一次） |
| `web/public/addons/codexbar/ollama.png` | ビルド成果物コピー（二次） |

両ファイルを同一内容に置き換える。`addons/codexbar/public/` をソースとし、`web/public/addons/codexbar/` は手動同期する。

## 非対象

- 他のブランドアイコン（claude, codex, cursor, opencode, synthetic）は変更しない
- `ProviderIcon.tsx` のレンダリングロジックは変更しない（`object-contain` によりアスペクト比維持で表示される）
- `Sidebar.tsx` の ProviderIcon も変更しない
- テストファイル（`ProviderIcon.test.tsx`, `codexbar.test.ts`）はアセットパスが変わらないため変更不要
- マッピングテーブル（`codexbar.ts` の `PROVIDER_ICONS`, `OPENCODE_TO_CODEXBAR`）は変更不要

## アクセシビリティ

- `alt=""`（decorative image）のまま変更しない
- 背景色が追加されることで、ダークテーマでも白いロゴ部分のコントラストが担保される
- 透過廃止により、`<img>` の背景がテーマ色と衝突するリスクがなくなる

## 検証

### ProviderIcon 対象テスト

```bash
cd web && npx vitest run src/components/task/ProviderIcon.test.tsx
```

既存テストはパスを検証しており、ファイル名不変のため修正不要。画像読み込み成功を確認するには、`fireEvent.error` が発火しないことを目視確認する（テストは onError 発火時の fallback を検証済み）。

### アセット同期後の typecheck / lint

```bash
cd web && npm run typecheck && npm run lint
```

アセット置き換えのみでコード変更がないため、既存の typecheck / lint がそのまま通る。

### 受入条件

1. `addons/codexbar/public/ollama.png` が 180×180 px、背景色 `#DFE5E8` で塗りつぶされた正方形 PNG である
2. `web/public/addons/codexbar/ollama.png` が上記と同一内容である
3. `npx vitest run src/components/task/ProviderIcon.test.tsx` がパスする
4. `npm run typecheck && npm run lint` がパスする
5. ブラウザで ProviderIcon（ollama-cloud）が正方形の枠内に中央配置されて表示される
6. 他のブランドアイコンに影響がない
