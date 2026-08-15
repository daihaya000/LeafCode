# WebUI Auto モード: 候補リスト方式ルーティングへの刷新

> 実装ステータス: 未実装（仕様確定）

## 背景

現行 Auto は `docs/specs/auto-model-cursor-router.md` の
最適化モード（`cost` / `balanced` / `intelligence`）× tier
（`light` / `standard` / `heavy`）で、**コスト帯順**と**推論強度順**の
2 軸を独立に解決している（`web/src/lib/auto-model.ts` の
`MODE_COST_ORDER` / `MODE_VARIANT_ORDER`）。

この方式には次の制約がある。

1. **具体モデルを指名できない**。「light は `gemini-2.5-flash` の `minimal`」
   のような指定は、コスト帯ヒューリスティック（`modelCostTier`）経由の
   間接指定しかできない。
2. **モデルと effort をペアで指定できない**。`resolveCostOrder` →
   `pickBest` → `pickVariant` の直列解決なので、「モデル A なら `high`、
   モデル B なら `low`」が表現不可能。
3. **上書きがモード非依存に保存される**。`RouteOverrides` は tier キー直下に
   保存される一方、差分の基準はその時選択中モードのプリセット。モードを
   切り替えると意図しない上書きになる（`auto-settings.ts` の
   `readAutoRouteOverrides`）。
4. **プリセット表が二重管理**。`AutoRouteOverridesEditor.tsx` の
   `presetCostOrder` / `presetVariantOrder` が `auto-model.ts` の
   テーブルを再実装している。
5. **UI に「追加」の概念がない**。全項目固定のチェックボックス＋上下ボタン。

本仕様は `auto-model-cursor-router.md` の追補であり、ルーティング設定の
データモデル・解決手順・設定 UI について競合する場合は本仕様を優先する。
プロンプト分類（`classifyPrompt` / `AutoSignals`）と最適化モードの
3 値、tier の 3 値は変更しない。

## 目的

Auto のルーティング設定単位を「**モデル + effort のペアの優先順リスト**」に
変更し、モード × tier のセルごとにドロップダウンで候補を追加・並べ替え
できるようにする。抽象指定（コスト帯 / 最強候補）も候補の一種として残し、
既存設定を情報欠落なく移行する。

## 用語

- **候補（`AutoRouteCandidate`）**: 1 件のルーティング指定。
  「モデル指名」「コスト帯」「最強候補」の 3 種。
- **セル**: 最適化モード × tier の組。3 × 3 = 9 セル。
- **プリセット**: 組み込みの既定候補列。現行 `MODE_COST_ORDER` /
  `MODE_VARIANT_ORDER` と等価な内容を候補列で表現したもの。
- **v1 / v2**: 保存形式のバージョン。v1 = 現行 `RouteOverrides`、
  v2 = 本仕様の `AutoRouteConfig`。

## 決定事項（確認済み）

| 論点 | 決定 |
|---|---|
| 「各モード」の指す軸 | 既存 3 モード固定。モードの追加・リネームは非対応 |
| tier 軸 | 維持（モード × tier = 9 セル） |
| 指名モデルが未接続 / limited の時 | **次候補へフォールバック**（エラーにしない） |

## 要件

### 1. `web/src/lib/auto-model.ts`: 型

```ts
export const AUTO_ROUTE_CONFIG_VERSION = 2 as const;

/** 1 件のルーティング指定。 */
export type AutoRouteCandidate =
  | {
      kind: "model";
      providerID: string;
      modelID: string;
      variant?: IntelligenceVariant | "";
    }
  | { kind: "cost"; cost: ModelCostTier; variant?: IntelligenceVariant | "" }
  | { kind: "strongest"; variant?: IntelligenceVariant | "" };

/** 全候補が使えなかった時の挙動。既定 "preset"。 */
export type AutoTierFallback = "preset" | "strongest" | "error";

export type AutoTierRoute = {
  /** 優先順。空配列 = プリセットの候補列を使う */
  candidates: AutoRouteCandidate[];
  /** 候補の variant が使えない時の代替順。省略 = モードプリセット */
  variantFallbackOrder?: IntelligenceVariant[];
  /** 省略 = "preset" */
  fallback?: AutoTierFallback;
};

export type AutoModeRoute = Partial<Record<AutoTier, AutoTierRoute>>;

export type AutoRouteConfig = {
  version: typeof AUTO_ROUTE_CONFIG_VERSION;
  modes: Partial<Record<AutoOptimizeMode, AutoModeRoute>>;
};

/** 「未設定」の正典値。`modes` ごと freeze する（現行 EMPTY_ROUTE_OVERRIDES と同理由） */
export const EMPTY_AUTO_ROUTE_CONFIG: AutoRouteConfig = Object.freeze({
  version: AUTO_ROUTE_CONFIG_VERSION,
  modes: Object.freeze({}),
});

/** 1 セルあたりの候補数上限。 */
export const MAX_AUTO_ROUTE_CANDIDATES = 8;
```

`variant` の 3 状態を区別する。

| 値 | 意味 |
|---|---|
| キー無し（`undefined`） | 「自動」= `variantFallbackOrder` に委譲 |
| `""` | effort 指定なしを明示（プロバイダ既定を使う） |
| `"high"` 等 | 指定。モデルが未対応なら `variantFallbackOrder` へ |

`RouteOverrides` / `TierRouteOverride` / `EMPTY_ROUTE_OVERRIDES` /
`isRouteOverridesEmpty` / `normalizeRouteOverrides` は削除し、
呼び出し側を新型へ移す。DB / localStorage に残る v1 JSON は
読み取り時に移行されるため互換は保たれる（§4）。

### 2. プリセットの単一ソース化

```ts
/** モード × tier のプリセット候補列。差分保存と UI 表示の唯一のソース。 */
export function presetTierRoute(
  mode: AutoOptimizeMode,
  tier: AutoTier,
): AutoTierRoute;
```

- 実装は既存 `MODE_COST_ORDER` / `MODE_VARIANT_ORDER` を内部に保持し、
  `costOrder` が配列なら `candidates = costOrder.map(cost => ({ kind: "cost", cost }))`、
  `null` なら `candidates = [{ kind: "strongest" }]`、
  `variantFallbackOrder = MODE_VARIANT_ORDER[mode][tier]` を返す。
- 戻り値は freeze して返す（呼び出し側の in-place 変更事故を防ぐ）。
- `MODE_COST_ORDER` / `MODE_VARIANT_ORDER` は非 export のまま。
  `AutoRouteOverridesEditor.tsx` の `presetCostOrder` /
  `presetVariantOrder` は削除し、本関数を使う。

### 3. `chooseAutoModel` の候補解決

`chooseAutoModel` の入力から `overrides?: RouteOverrides` を外し、
`config?: AutoRouteConfig` を受ける。他の入力（`providers` / `connected` /
`disabled` / `tier` / `mode` / `hasImages` / `usage`）は変更しない。

#### 3-1. 実効ルート

```
route = config.modes[mode]?.[tier] ?? presetTierRoute(mode, tier)
candidates = route.candidates.length > 0
  ? route.candidates
  : presetTierRoute(mode, tier).candidates
variantFallbackOrder = route.variantFallbackOrder
  ?? presetTierRoute(mode, tier).variantFallbackOrder ?? []
fallback = route.fallback ?? "preset"
```

`candidates` が空でも `variantFallbackOrder` / `fallback` は
そのセルの設定を優先する。

#### 3-2. 候補プール

現行と同一。`connected` に含まれ、`disabled[providerID]` /
`disabled[providerID::modelID]` に無く、`hasImages` の時は
`supportsImages` を満たすモデルのみ。プールが空なら `null`。

#### 3-3. 候補評価（先頭から順に）

| kind | 採用条件 |
|---|---|
| `model` | プール内に同一 `providerID` / `modelID` が存在し、かつ `usage[providerID]?.limited !== true` |
| `cost` | `pickBest(pool.filter(x => x.cost === candidate.cost), usage)` が解決する |
| `strongest` | `pickBest(pool, usage)` が解決する |

- 採用できない候補は**スキップして次へ進む**（決定事項 3）。
- `usage` の 20% 迂回ロジック（`AUTO_USAGE_REROUTE_GAP`）は `cost` /
  `strongest` の `pickBest` 内でのみ働く。`kind: "model"` の指名は
  `limited` の時だけ次候補へ落ち、利用率差では勝手に迂回しない
  （明示指定を尊重する）。

#### 3-4. effort 決定

```ts
function resolveCandidateVariant(
  model: AutoCandidateModel,
  candidate: AutoRouteCandidate,
  fallbackOrder: IntelligenceVariant[],
): IntelligenceVariant | "" {
  if (candidate.variant === "") return "";
  const available = new Set(getIntelligenceVariants(model));
  if (candidate.variant && available.has(candidate.variant)) {
    return candidate.variant;
  }
  return pickVariant(model, fallbackOrder); // 既存関数
}
```

#### 3-5. 全候補が使えなかった時

| `fallback` | 挙動 |
|---|---|
| `"preset"`（既定） | `presetTierRoute(mode, tier).candidates` で 3-3 を再実行 → それでも駄目なら `pickBest(pool)` → 駄目なら `null` |
| `"strongest"` | `pickBest(pool)` → 駄目なら `null` |
| `"error"` | `null`（BFF が 400） |

#### 3-6. `AutoDecision` の追加フィールド

```ts
  /** 採用した候補の 0 始まりインデックス。プリセット由来は undefined */
  candidateIndex?: number;
  /** プリセットへフォールバックして解決したか */
  usedPreset?: boolean;
```

`reason` テンプレート（既存の画像 / コスト帯フォールバック接尾辞は据え置き）:

- 候補由来: `${TIER_LABEL[tier]}のため候補${index + 1}（${modelID}${variant ? " / " + variant : ""}）を採用しました`
- 先行候補をスキップした場合、上記に `（候補1〜${index}は利用不可）` を付加
- プリセット由来（`candidates` 未設定 / `fallback: "preset"` 経由）: 現行文
  `${TIER_LABEL[tier]}のため${autoOptimizeModeLabel(mode)}で選択しました`

#### 3-7. escalation

採用インデックス **+1 以降**の候補で 3-3 を再実行し、最初に解決したものを
`escalation` にする。解決しなければ現行ロジック（別 provider 優先の
`pickBest` + `ESCALATION_VARIANT_ORDER`）にフォールバック。採用結果と
`providerID` / `modelID` / `variant` が完全一致する場合は `escalation` を
付けない（現行踏襲）。

### 4. 正規化と v1 → v2 移行

```ts
export function normalizeAutoRouteConfig(raw: unknown): AutoRouteConfig;
export function isAutoRouteConfigEmpty(config: AutoRouteConfig): boolean;
```

- `raw` がオブジェクトでない → `EMPTY_AUTO_ROUTE_CONFIG`。
- `raw.version === 2` → v2 として正規化。
- それ以外のオブジェクト → v1（`RouteOverrides`）と見なして移行。
- **常に有効な v2 を返す**。壊れた入力は捨てられ、プリセット動作になる
  （現行 `normalizeRouteOverrides` の設計方針を踏襲）。

#### 4-1. v1 移行規則

各 tier について:

| v1 | v2 |
|---|---|
| `costOrder: X[]` | `candidates = X.map(cost => ({ kind: "cost", cost }))` |
| `costOrder: null` | `candidates = [{ kind: "strongest" }]` |
| `costOrder: undefined` | `candidates = []`（プリセット） |
| `variantOrder: V[]` | `variantFallbackOrder = V` |

v1 はモード非依存に保存されていたため、移行結果を **3 モード全部に複製**
して現挙動を維持する。移行後に初めて保存された時点でモード別に分化する。

#### 4-2. 正規化規則

- 未知の `kind` / 未知の `cost` / 未知の `variant` を持つ候補は破棄。
- `kind: "model"` で `providerID` または `modelID` が空文字、または
  `providerID` に `::` を含むものは破棄（キー衝突防止）。
- 重複候補は先勝ちで dedupe。キーは
  `model:${providerID}::${modelID}::${variant ?? "*"}` /
  `cost:${cost}::${variant ?? "*"}` / `strongest:${variant ?? "*"}`。
- 候補は先頭 `MAX_AUTO_ROUTE_CANDIDATES` 件で切り捨て。
- `variantFallbackOrder` は既存 `dedupeInOrder` で正規化。空になったら省略。
- `fallback` が 3 値以外 → 省略（`"preset"` 扱い）。
- 空の tier（`candidates` 空 かつ 他フィールド無し）はキーを削除。
  全 tier が消えたモードもキーを削除。保存サイズを最小に保つ。

### 5. `web/src/lib/auto-settings.ts`

- `readAutoRouteOverrides` / `writeAutoRouteOverrides` を
  `readAutoRouteConfig(): AutoRouteConfig` /
  `writeAutoRouteConfig(config: AutoRouteConfig): void` に置換。
- localStorage キーは既存 `webui:auto-route-overrides` を**変更しない**
  （v1 値は読み取り時に `normalizeAutoRouteConfig` が移行する）。
  `isAutoRouteConfigEmpty` が真なら値を削除。
- サーバ設定キーも既存 `auto-route-overrides` を維持。イベント名
  `AUTO_ROUTE_OVERRIDES_EVENT` / `AutoSettingKey` も変更しない。
- `AutoSettingsSnapshot.routeOverrides: RouteOverrides` を
  `routeConfig?: AutoRouteConfig` に変更。空 config は省略して返す
  （「未設定」と「空設定」の区別を保つ現行方針を踏襲）。

### 6. `web/src/lib/settings-registry.ts`

`auto-route-overrides` の分岐を `normalizeAutoRouteConfig` に差し替え、
`JSON.stringify` した結果を保存する。JSON パース失敗時のエラー文言は現行のまま。
`MAX_SETTING_VALUE_CHARS`（32,768）は 9 セル × 8 候補でも数 KB なので変更不要。

### 7. `web/src/app/api/tasks/route.ts`

- リクエストフィールド名 `autoRouteOverrides` は**変更しない**
  （旧クライアントとの互換）。値は v1 / v2 どちらも受理し、
  `normalizeAutoRouteConfig` を通す。
- `auto` 以外のモデル指定と併用した場合の 400
  （`"autoRouteOverrides requires auto"`）は現行のまま。
- `chooseAutoModel` 呼び出しを `config` 引数に変更。

### 8. `web/src/components/settings/AutoRouteOverridesEditor.tsx` の刷新

#### 8-1. props

```ts
{
  /** 実行中の最適化モード。タブの初期選択と「実行中」バッジに使う */
  mode: AutoOptimizeMode;
  config: AutoRouteConfig;
  /** effort 候補算出とプレビューに必要な最小構造 */
  providers: readonly {
    id: string;
    name: string;
    enabled: boolean;
    models: readonly {
      id: string;
      name: string;
      enabled: boolean;
      variants?: Record<string, { disabled?: boolean } | undefined>;
    }[];
  }[];
  onChange: (next: AutoRouteConfig) => void;
}
```

`providers` は `ProviderModelsSettings` が既に保持している
`ProviderDto[]` をそのまま渡せる構造型にする（型の再 export は行わない）。

#### 8-2. レイアウト

```
[コスト優先*] [バランス] [知能優先]     ← 編集対象モードのタブ（* = 実行中）
                                        [このモードをリセット] [全リセット]
┌ ライト（短い質問・雑談）                          [リセット] ┐
│ 候補（上が優先）                                            │
│ 1. [gemini-2.5-flash ▾][effort ▾]                ↑ ↓ ✕      │
│ [＋ 候補を追加]                                             │
│ 全候補が使えない時: [プリセットに従う ▾]                     │
│ 現在の解決結果: gemini-2.5-flash / minimal                   │
└─────────────────────────────────────────────────────────────┘
（標準 / ヘビーも同形式）
```

- **モードタブ**: 編集対象モードを実行中モードから独立して選べる。
  現行の「プリセット表示が実行中モードに引きずられる」問題を解消する。
- **候補行**: 種別は**モデル指定に一本化**（UI に種別ドロップダウンは無い）。
  保存済みの `コスト帯` / `最強候補` 行のみ、旧形式のまま編集・削除できる。
  - `モデル指定`: モデルドロップダウン + effort ドロップダウン
  - `コスト帯`（旧形式のみ）: コスト帯ドロップダウン（低 / 中 / 高）+ effort
  - `最強候補`（旧形式のみ）: effort のみ
- **モデルドロップダウン**: `ProviderModelsSettings` の既存
  `modelOptions` 生成（`sortModelOptions` + `formatModelLabel`、
  provider 名で group 化）を共通化して使う。`AUTO_MODEL_OPTION` は除外。
  **未接続 provider / 無効モデルは選択肢に出さない**（後で
  「モデルなし」表示になり、選び直せる）。
- **effort ドロップダウン**: Composer と同じ
  `IntelligenceSelect`（GhostSelect + `デフォルト` + バリアントキー）。
  選択値は `variant` にそのまま保存し、`""` = `variant` キー無し（自動）。
  `モデル指定` 行は選択モデルの `getIntelligenceVariants` 結果のみ出し、
  バリアント未宣言のモデルは Composer と同様にセレクタ自体を隠す。
  `コスト帯` / `最強候補` の行はモデルが未確定なので
  `ALL_INTELLIGENCE_VARIANTS` を出す。
- **並べ替え**: ↑ ↓ ボタン（現行踏襲。ドラッグ&ドロップは非対応）。
- **削除**: ✕。全削除すると候補 0 件 = プリセット使用となり、
  `プリセットを使用中` を明示表示する。
- **追加**: 末尾に追加。既定値はまだ候補に含まれていない接続済みモデル
  の先頭（常に `kind: "model"`）。追加可能なモデルが無いか
  `MAX_AUTO_ROUTE_CANDIDATES` に達したらボタンを disabled にする。
- **effort フォールバック順**: UI には出さない（非表示）。保存済みの
  `variantFallbackOrder` は保持したまま候補編集時に引き継がれ、
  解決ロジックは引き続き参照する。未編集セルはプリセット順。
- **現在の解決結果**: `providers` から `AutoCandidateProvider[]` と
  `disabled` を組み立て、`chooseAutoModel` を dry-run して表示する。
  `usage` は渡さない（素の結果を見せる）。解決不能なら
  `解決できません（候補が全て未接続です）` を赤字表示。設定ミスの即時検知用。
- **リセット**: tier 単位 / モード単位 / 全体の 3 段。該当セルまたはモードを
  `config.modes` から削除する。

#### 8-3. 保存の最小化

`onChange` 前に `normalizeAutoRouteConfig` を通し、プリセットと完全一致する
セルを削除する。現行の `withTierOverride` 相当だが、比較は
`presetTierRoute` との JSON 一致 1 箇所に集約する
（現行の `tierIsOverridden` の複雑な三項比較を廃止）。

### 9. 呼び出し側の追随

| ファイル | 変更 |
|---|---|
| `components/task/use-auto-task.ts` | `routeOverrides: RouteOverrides` → `routeConfig: AutoRouteConfig`、`readAutoRouteConfig()` |
| `components/task/TaskView.tsx` | 型・変数名の追随。follow-up 解決の `chooseAutoModel` 呼び出しを `config` に |
| `components/home/HomeView.tsx` | 同上。`POST /api/tasks` の `autoRouteOverrides` に v2 を送る |
| `components/settings/ProviderModelsSettings.tsx` | `AutoRouteOverridesEditor` に `providers` を渡す。`modelOptions` 生成を editor と共用できる形に切り出す |
| `lib/memory-extract.ts` | `chooseAutoModel` の引数変更に追随（`config` 未指定でプリセット動作） |

### 10. 変更しないもの

- `classifyPrompt` / `AutoSignals` / tier の 3 値・閾値定数
- `AutoOptimizeMode` の 3 値、`DEFAULT_AUTO_OPTIMIZE_MODE`
- `modelCostTier` / `modelIntelligenceScore` / `pickBest` の内部ロジック
- `AUTO_USAGE_REROUTE_GAP` と CodexBar 利用率迂回の仕組み
- `AUTO_MODEL_VALUE` / `AUTO_MODEL_OPTION`、`auto-show-model` の挙動
- localStorage キー / サーバ設定キー / イベント名 / API フィールド名

## 検証・テスト

### `web/src/lib/auto-model.test.ts`

- `presetTierRoute` が全 9 セルで現行 `MODE_COST_ORDER` /
  `MODE_VARIANT_ORDER` と等価な候補列を返す
- `kind: "model"` 指名が接続済みなら必ず採用される
- `kind: "model"` が未接続 / disabled / 画像非対応 / `limited` の各理由で
  スキップされ、次候補へ落ちる（決定事項 3）
- `kind: "model"` は利用率差 20% 以上でも迂回しない
- `kind: "cost"` / `"strongest"` は `pickBest` 経由で利用率迂回が働く
- effort: 指定が使える / 使えず `variantFallbackOrder` へ / `""` 明示 /
  `undefined`（自動）の 4 パターン
- `fallback` の `"preset"` / `"strongest"` / `"error"` それぞれの結果
- `escalation` が採用インデックス +1 以降から選ばれる
- `reason` に候補番号とスキップ注記が入る
- `normalizeAutoRouteConfig`: 未知 kind / 未知 cost / 未知 variant /
  空 providerID / `::` 入り providerID / 重複 / 上限超過 / 不正 fallback
- v1 → v2 移行が全 9 セルで**既存 v1 と同じ決定を返す**（等価性テスト）

### `web/src/lib/auto-settings.test.ts`

- `readAutoRouteConfig` / `writeAutoRouteConfig` のラウンドトリップ
- localStorage に v1 JSON が入っている状態で v2 に移行して読める
- 空 config の書き込みで localStorage から削除される
- `readAutoSettingsFromServer` が `routeConfig` を返す / 空なら省略する

### `web/src/lib/settings-registry.test.ts`

- `auto-route-overrides` に v1 / v2 / 壊れた JSON を渡した時の結果

### `web/src/app/api/tasks/route.test.ts`

- `autoRouteOverrides` に v1 / v2 を渡して 200 で解決される
- `auto` 以外のモデル指定との併用で 400
- 候補全滅 + `fallback: "error"` で 400

### `web/src/components/settings/AutoRouteOverridesEditor.test.tsx`

現行テストを新 UI 向けに書き直す。

- モードタブ切替で表示候補が変わる
- 候補の追加 / 削除 / 並べ替えが `onChange` に反映される（追加はモデル指定）
- 上限到達で追加ボタンが disabled
- 候補 0 件でプリセット表示になる
- 「現在の解決結果」が providers に応じて更新される
- tier / モード / 全体のリセット

### `web/src/components/task/TaskView.test.tsx` / `home/HomeView.test.tsx`

既存の Auto 送信テストが型変更後も通ること（挙動の回帰確認）。

### E2E

既存 Auto シナリオが壊れないことの確認のみ。新規シナリオは追加しない。

### 実行

```
cd web
npx tsc --noEmit
npx eslint .
npx vitest run
```

本番ビルド（`build.bat` / `next build`）はユーザー指示時のみ。

## 影響範囲

| ファイル | 種別 |
|---|---|
| `web/src/lib/auto-model.ts` | 型追加・`chooseAutoModel` 改修・旧型削除 |
| `web/src/lib/auto-settings.ts` | 関数改名・型変更 |
| `web/src/lib/settings-registry.ts` | normalize 差し替え |
| `web/src/app/api/tasks/route.ts` | 引数追随 |
| `web/src/components/settings/AutoRouteOverridesEditor.tsx` | 全面書き換え |
| `web/src/components/settings/ProviderModelsSettings.tsx` | props 追加・modelOptions 切り出し |
| `web/src/components/task/use-auto-task.ts` | 型・関数名追随 |
| `web/src/components/task/TaskView.tsx` | 型追随 |
| `web/src/components/home/HomeView.tsx` | 型追随 |
| `web/src/lib/memory-extract.ts` | 引数追随 |
| 各 `*.test.ts(x)` | 上記に対応 |

DB マイグレーションは不要（`settings` テーブルの値を読み取り時に移行）。

## 受け入れ条件

1. 設定 UI で「モード → tier → 候補行」を追加し、モデルとその effort を
   ペアで指定できる。指定した順に評価される。
2. 指名モデルが未接続 / 無効 / 利用上限の時は次候補へ落ち、
   全滅時は `fallback` 設定に従う。
3. 既存 v1 設定を持つユーザーが移行後も**同じモデル選定結果**を得る
   （等価性テストで保証）。
4. モードを切り替えても他モードの設定が変化しない。
5. プリセット表の実装が `auto-model.ts` の 1 箇所のみになる。
6. 「現在の解決結果」プレビューが各 tier の選定結果を表示する。
7. `tsc` / `eslint` / `vitest` が通る。

## 非対応（本仕様では扱わない）

- 最適化モードの追加・リネーム・ユーザー定義プロファイル化
- ドラッグ&ドロップによる候補並べ替え
- 候補ごとの適用条件（画像添付時のみ、特定 agent のみ 等）
- プロンプト分類ロジック（`classifyPrompt`）と tier 定義の変更
- agent / ワークフロー単位の個別ルーティング
- コスト実測値に基づく `modelCostTier` の置き換え

## 既知の制約・リスク

- **設定量**: 9 セル分の候補列を全部埋めると操作量が多い。プリセットからの
  差分のみ保存し、未編集セルは `presetTierRoute` に委ねることで緩和する。
- **モデル名の陳腐化**: `kind: "model"` 指名は provider / model の
  リネーム・削除で無効化される。「現在の解決結果」プレビューと
  候補行の `モデルなし` 表示で検知させる。自動削除はしない。
  未接続モデルは選択肢に出さないため、保存済み設定はその行を
  保持したまま別モデルを選び直す形になる。
- **効果の見えにくさ**: 候補 1 が常に採用されると tier 分類の意味が薄れる。
  `reason` に候補番号を出すことで、どの候補が効いたか追跡できるようにする。
- **保存サイズ**: `MAX_SETTING_VALUE_CHARS` は 32,768。9 セル × 8 候補でも
  数 KB に収まるが、上限定数を撤廃する場合は再検討が必要。
