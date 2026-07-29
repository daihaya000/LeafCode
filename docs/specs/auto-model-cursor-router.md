# WebUI Auto モード: Cursor Router 相当への拡張

## 背景

現行の Auto（`docs/specs/auto-model-selection.md` および
`auto-model-selection-taskview.md`）はコスト最適固定・手動選択制・
選定結果を常時バナー表示する実装になっている。ユーザーから
「Cursor の Auto モードのような挙動が理想」との要望があった。

Cursor の Auto の実体は **Cursor Router**（一次情報:
https://cursor.com/docs/cursor-router ）で、要点は次のとおり。

- Auto の下に **Optimize For: Cost / Balance / Intelligence** の 3 モード
- **リクエストごと**に分類器が走り、タスク種別と複雑さでルーティング
- 「同等品質を出せる最も費用対効果の高いモデル」を選ぶ
- ルーティング先モデル名は **既定で非表示**（表示は任意設定。
  「モデル名ではなく結果で判断させるため」）
- **Impose Auto**: Soft = 新規チャットの既定を Auto にする（切替可）／
  Hard = 選択を Auto に固定
- ブロック中のモデルは自動で許可モデルへ迂回

現行実装との差分と、本仕様で埋める範囲:

| 項目 | Cursor | 現行 | 本仕様 |
|---|---|---|---|
| 最適化モード | 3 モード | コスト固定 | **3 モード追加・既定 Cost** |
| リクエスト毎ルーティング | ○ | ○ | 変更なし |
| 無効モデルの迂回 | ○ | ○ | 変更なし |
| モデル名表示 | 既定非表示 | 常時表示 | **既定非表示・設定で表示** |
| 既定モデル化 | Soft / Hard | 手動のみ | **Soft のみ設定で追加** |
| 分類器 | データ駆動 | 正規表現のみ | **シグナル追加でルール強化** |

## 目的

Auto を Cursor Router 相当の使用感にする。すなわち
「選べば黙って最適なモデルへ振り分け、必要なら最適化方針だけ切り替え、
モデル名は普段見せない」挙動を、追加トークンコストゼロで実現する。

## 用語

- **最適化モード（`AutoOptimizeMode`）**: `cost` | `balanced` | `intelligence`。
  Cursor の Optimize For に対応。既定は `cost`。
- **tier**: プロンプト分類結果（`light` / `standard` / `heavy`）。既存のまま。
- **cost tier**: モデルのコスト帯（`cheap` / `mid` / `premium`）。既存のまま。
- **シグナル（`AutoSignals`）**: 分類に使う入力一式。プロンプト本文以外の
  文脈（添付数・履歴長・直前の失敗）を含む。

## 要件

### 1. `web/src/lib/auto-model.ts`: 最適化モード

#### 1-1. 型

```ts
export type AutoOptimizeMode = "cost" | "balanced" | "intelligence";
export const AUTO_OPTIMIZE_MODES: readonly AutoOptimizeMode[] =
  ["cost", "balanced", "intelligence"];
export const DEFAULT_AUTO_OPTIMIZE_MODE: AutoOptimizeMode = "cost";
export function isAutoOptimizeMode(value: unknown): value is AutoOptimizeMode;
/** 日本語表示名: コスト優先 / バランス / 知能優先 */
export function autoOptimizeModeLabel(mode: AutoOptimizeMode): string;
```

`AutoDecision` に `mode: AutoOptimizeMode` を追加する（常に存在）。

#### 1-2. モード別のコスト帯順・variant 順

`TIER_COST_ORDER` / `TIER_VARIANT_ORDER` をモード別テーブルへ拡張する。
`cost` 列は現行値と**完全一致**させる（既存挙動の回帰を防ぐ）。

**コスト帯順**（`heavy` は全モードで「全候補中の最強」= コスト帯なし）

| tier | cost | balanced | intelligence |
|---|---|---|---|
| light | cheap → mid → premium | cheap → mid → premium | mid → cheap → premium |
| standard | mid → cheap → premium | mid → premium → cheap | premium → mid → cheap |
| heavy | 最強 | 最強 | 最強 |

**variant（reasoning effort）順**

| tier | cost | balanced | intelligence |
|---|---|---|---|
| light | minimal, none, low | low, minimal, none, medium | medium, low, high, minimal, none |
| standard | low, minimal, none, medium | medium, low, high, minimal, none | high, medium, max, low |
| heavy | medium, high, low | high, medium, max, low | max, high, medium |

`escalation` の variant 順（`high` → `max` → `medium`）は全モード共通で
現行のまま。

#### 1-3. reason テンプレート

モードを含む統一テンプレートへ変更する。

```
`${TIER_LABEL[tier]}のため${autoOptimizeModeLabel(mode)}で選択しました`
```

- `TIER_LABEL`: `light` = `短い質問タスク`、`standard` = `標準的なコーディングタスク`、
  `heavy` = `大規模・高難度タスク`
- 既存の付記は維持:
  画像時 `（画像対応モデルに限定）`、
  コスト帯フォールバック時 `（該当コスト帯に候補がなく上位帯へフォールバック）`
- 例: `短い質問タスクのためコスト優先で選択しました`

既存テスト・E2E の期待文字列はこの新形式へ更新する（reason は既定で
非表示になるため利用者影響は小さい）。

#### 1-4. `chooseAutoModel` の入力

`input` に `mode: AutoOptimizeMode` を追加する（必須）。それ以外の
引数・候補構築規則・`null` 返却条件は現行のまま。

### 2. `web/src/lib/auto-model.ts`: 分類シグナル強化

#### 2-1. 型

```ts
export type AutoSignals = {
  /** 画像添付の有無。tier は変えず候補フィルタにのみ使う（現行どおり）。 */
  hasImages: boolean;
  /** この送信の添付数。未指定は 0 扱い。 */
  attachmentCount?: number;
  /** セッション内の既存メッセージ数（follow-up の深さ）。未指定は 0。 */
  historyMessageCount?: number;
  /** 直前のターンが失敗している。未指定は false。 */
  recentFailure?: boolean;
};
```

`classifyPrompt(prompt: string, signals: AutoSignals): AutoTier` に変更する
（第 2 引数は現行の `{ hasImages }` と後方互換）。

#### 2-2. 判定手順

1. **本文から基準 tier を決める**（現行ロジック + 追加 2 条件）。
   優先順は現行どおり heavy → light → standard。
   - heavy の追加条件:
     - **相異なるファイルパス言及が 3 個以上**
       （`/[\w./\\-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs|cpp|c|h|md|json|jsonc|ya?ml|toml|css|scss|html|sql|sh|bat|ps1)\b/gi`
       のマッチを小文字化して重複排除した個数）
     - **番号付きリスト項目が 4 個以上**（行頭 `1.` / `1)` 形式）
   - light の条件は現行のまま（長さ < 200、コードフェンスなし、
     質問パターン一致、作業指示パターン不一致）
2. **文脈シグナルで最大 1 段だけ引き上げる**（`light` → `standard` →
   `heavy`。累積しない・`heavy` は据え置き）。次のいずれかが真なら 1 段:
   - `recentFailure === true`
   - `attachmentCount >= 3`
   - `historyMessageCount >= 20`

   1 段に固定するのは、複数条件が同時成立しても `light` から `heavy` へ
   飛ばさないため（予測可能性を優先）。

#### 2-3. 呼び出し側のシグナル供給

| 呼び出し元 | attachmentCount | historyMessageCount | recentFailure |
|---|---|---|---|
| BFF（新規タスク作成） | `files.length` | 0（新規セッション） | false |
| TaskView follow-up | `attachments.length` | `stream.messages.length` | `stream.sessionError !== null` |
| TaskView goal-loop 起動 | 0 | `stream.messages.length` | `stream.sessionError !== null` |

### 3. `web/src/lib/auto-settings.ts`（新規）: 設定の永続化

`default-model.ts` と同じ二層方式（localStorage を同期読み取りの正、
サーバー `settings` テーブルをブラウザ間共有のバックアップ）にする。

| 設定 | localStorage キー | サーバーキー | 値 | 既定 |
|---|---|---|---|---|
| 最適化モード | `webui:auto-optimize` | `auto-optimize` | `cost` / `balanced` / `intelligence` | `cost` |
| モデル名表示 | `webui:auto-show-model` | `auto-show-model` | `"1"` / `""` | `""`（非表示） |

公開 API（各設定につき read / write、および cross-tab 通知イベント）:

```ts
export const AUTO_OPTIMIZE_EVENT = "webui:auto-optimize";
export const AUTO_SHOW_MODEL_EVENT = "webui:auto-show-model";

export function readAutoOptimizeMode(): AutoOptimizeMode;      // 既定 cost
export function writeAutoOptimizeMode(mode: AutoOptimizeMode): void;
export function readAutoShowModel(): boolean;                  // 既定 false
export function writeAutoShowModel(enabled: boolean): void;
/** サーバー側コピーの読み書き（失敗は無視、localStorage が優先）。 */
export function readAutoSettingsFromServer(): Promise<Partial<...>>;
export function writeAutoSettingToServer(key, value): Promise<void>;
```

読み取りは `window` 不在時・不正値・例外時に既定値へフォールバックする
（`default-model.ts` と同じ fail-safe 方針）。

### 4. `web/src/app/api/settings/[key]/route.ts`

`ALLOWED_KEYS` に `auto-optimize` / `auto-show-model` を
追加し、`normalizeSettingValue` に検証を追加する。

- `auto-optimize`: `cost` / `balanced` / `intelligence` 以外は
  `400 { error: "auto-optimize must be cost, balanced or intelligence" }`
- `auto-show-model`: `"1"` 以外の非空文字列は
  `400 { error: "<key> must be 1 or empty" }`（空文字は既存どおり「未設定」）

### 5. `web/src/app/api/tasks/route.ts`

- body に `autoOptimize?: unknown` を追加する。
  - `undefined` → `DEFAULT_AUTO_OPTIMIZE_MODE`（`cost`）
  - `isAutoOptimizeMode` を満たさない値 → `400 { error: "invalid autoOptimize" }`
  - `auto !== true` のときに指定されていたら
    `400 { error: "autoOptimize requires auto" }`
  - 検証はすべて `provisionWorkspace` より前（既存方針を維持）
- `resolveAutoModel` に mode を渡し、`classifyPrompt` へ
  `{ hasImages, attachmentCount: files.length }` を渡す。
- レスポンスの `autoDecision` は `mode` を含む（型追加のみ、経路は不変）。

### 6. `web/src/components/AutoOptimizeSelect.tsx`（新規）

Cursor はモード選択をモデルピッカー配下に置く。本 WebUI では composer
ツールバーの **IntelligenceSelect と同じ位置**に、Auto 選択中のみ表示する
（Auto 選択中は IntelligenceSelect が非表示になるため排他）。

- `GhostSelect` ベース。`aria-label="Auto の最適化"`。
- 選択肢ラベル: `コスト優先` / `バランス` / `知能優先`。
- `value` / `onChange` / `disabled` を props で受ける制御コンポーネント。
- 変更時に `writeAutoOptimizeMode` で即永続化（HomeView / TaskView 共通）。

### 7. `web/src/components/home/HomeView.tsx`

1. **モード state**: 初期値 `readAutoOptimizeMode()`。マウント後に
   `readAutoSettingsFromServer()` で補正（localStorage 未設定時のみ）。
   `AUTO_OPTIMIZE_EVENT` を listen して他タブ/設定画面の変更へ追従する。
2. **モード UI**: `model === AUTO_MODEL_VALUE` のとき
   `AutoOptimizeSelect` を表示（IntelligenceSelect は既存条件で非表示）。
3. **送信**: Auto のとき body に `autoOptimize: <mode>` を追加する。
4. **Impose Auto (Soft)**: 初期モデル決定で、`readAutoImpose()` が true なら
   **最優先で `AUTO_MODEL_VALUE`** を採用する（last-used より前）。
   false のときは現行の優先順（last-used → default → config.model →
   provider default → options[0]）を一切変更しない。
   どちらの場合も Auto へ暗黙フォールバックしない。
5. **バナー/引き継ぎ**: `readAutoShowModel()` が false のときは
   `AutoTaskRecord` の `decision` を保存しても**チップを表示しない**
   （表示制御は TaskView 側。§8）。保存自体は再試行に必要なため継続する。

### 8. `web/src/components/task/TaskView.tsx`

1. **モード state / UI / 永続化**: HomeView と同一（§7-1, §7-2）。
2. **解決**: `resolveAutoSelection` に mode と §2-3 のシグナルを渡す。
3. **goal-loop**: 同上（`attachmentCount` は 0）。
4. **表示制御（Cursor 準拠）**: `readAutoShowModel()` を state で保持し、
   `AUTO_SHOW_MODEL_EVENT` に追従する。
   - **false（既定）**: 初回選定チップと follow-up 通知を**表示しない**。
   - **true**: 現行どおり単一バナーで表示する。
   - **自動再試行の通知は設定に関わらず常に表示する**。想定外の追加ターンが
     発生した事実の説明であり、モデル名を見せるための表示ではないため。
5. `dismissAutoBanner` の挙動は現行のまま。

### 9. `web/src/components/settings/ProviderModelsSettings.tsx`

「デフォルトモデル」セクションの直後に **「Auto モード」** セクションを
追加する（`aria-labelledby="auto-mode-heading"`）。

- 説明文: Auto の役割と、モード選択が composer 側にあることを 1 行で示す。
- 最適化モードの `GhostSelect`（`aria-label="Auto の最適化"`。
  composer と同じ値を読み書きし、双方向に同期する）
- チェックボックス `Auto が選んだモデルを表示`
  （補足: `既定では非表示です。モデル名ではなく結果で判断できます。`）
- チェックボックス `新規タスクの既定モデルを Auto にする`
  （補足: `各タスクで個別に他のモデルへ切り替えられます。`）

いずれも変更時に localStorage へ即書き込み、サーバーへは非同期ミラー
（失敗は無視）。

### 10. 変更しないもの

- `POST /api/tasks` 以外の送信経路、`useSessionStream`
- `auto-task-record.ts` の形状（`decision` に `mode` が増えるのみ。
  `parseDecision` は未知値を許容するため後方互換。ただし `mode` が
  不正/欠落の場合は `DEFAULT_AUTO_OPTIMIZE_MODE` で補完する）
- 自動再試行の発火条件（初回プロンプト限定・1 回のみ）
- Hard の Impose Auto（本仕様では非対応）
- DB スキーマ

## 検証・テスト

### `web/src/lib/auto-model.test.ts`

- `isAutoOptimizeMode` / `autoOptimizeModeLabel`
- **cost モードで既存の全期待値が不変**であること（回帰ガード）
- balanced / intelligence のコスト帯順・variant 順（tier × mode の代表組合せ）
- reason 文字列（tier × mode、画像付記、フォールバック付記）
- `AutoDecision.mode` が入力モードと一致する
- シグナル: ファイルパス 2 個 → heavy でない / 3 個 → heavy、
  番号付きリスト 3 個 → heavy でない / 4 個 → heavy
- 引き上げ: `recentFailure` / `attachmentCount>=3` / `historyMessageCount>=20`
  で 1 段のみ上がる、複数同時でも 1 段、`heavy` は据え置き、
  シグナル未指定は現行と同一結果

### `web/src/lib/auto-settings.test.ts`（新規）

- 既定値（未設定・不正値・例外時）
- 読み書きと `CustomEvent` 発火
- サーバー読み書きの失敗が握り潰されること

### `web/src/app/api/settings/[key]/route.test.ts`

- 3 キーの GET/PUT 正常系、不正値 400、空文字で未設定

### `web/src/app/api/tasks/route.test.ts`

- `autoOptimize` 未指定 → cost として解決
- `autoOptimize: "intelligence"` → 解決モデル/variant が変わる
- `autoOptimize: "bogus"` → 400、`provisionWorkspace` 未呼び出し
- `auto` なしで `autoOptimize` 指定 → 400
- レスポンス `autoDecision.mode` が反映される

### `web/src/components/home/HomeView.test.tsx`

- Auto 選択で `AutoOptimizeSelect` が表示され、IntelligenceSelect は非表示
- モード変更が永続化され、送信 body に `autoOptimize` が載る
- Impose Auto ON で初期モデルが Auto（last-used があっても Auto 優先）
- Impose Auto OFF で既存の優先順が不変

### `web/src/components/task/TaskView.test.tsx`

- Auto 選択で `AutoOptimizeSelect` 表示、モードが解決結果へ反映される
- 表示設定 OFF（既定）で選定チップ・follow-up 通知が出ない
- 表示設定 ON で従来どおり表示される
- 表示設定 OFF でも自動再試行の通知は出る
- 履歴 20 件以上／直前失敗で tier が 1 段上がる（解決モデルで観測）

### `web/src/components/settings/ProviderModelsSettings.test.tsx`

- 3 つのコントロールの表示・変更・永続化

### E2E

- `composer.spec.ts`: Auto 選択時に最適化セレクタが出る、モード変更が
  `POST /api/tasks` の `autoOptimize` に載る
- `task.spec.ts`: 既定でモデル名バナーが出ない、設定 ON 相当
  （localStorage 事前投入）で出る

### 実行

`npx tsc --noEmit` / `npx eslint src --max-warnings=0` /
`npx vitest run`（全体）/ `npm run e2e`（CI モード）。
常駐プロセスのフォアグラウンド起動は行わない。

## 影響範囲

| ファイル | 種別 |
|---|---|
| `web/src/lib/auto-model.ts` / `auto-model.test.ts` | 変更 |
| `web/src/lib/auto-settings.ts` / `auto-settings.test.ts` | 新規 |
| `web/src/lib/auto-task-record.ts` | 変更（`mode` 補完） |
| `web/src/components/AutoOptimizeSelect.tsx` / `.test.tsx` | 新規 |
| `web/src/app/api/settings/[key]/route.ts` / `route.test.ts` | 変更 |
| `web/src/app/api/tasks/route.ts` / `route.test.ts` | 変更 |
| `web/src/components/home/HomeView.tsx` / `.test.tsx` | 変更 |
| `web/src/components/task/TaskView.tsx` / `.test.tsx` | 変更 |
| `web/src/components/settings/ProviderModelsSettings.tsx` / `.test.tsx` | 変更 |
| `web/e2e/composer.spec.ts` / `task.spec.ts` | 変更 |

## 受け入れ条件

1. Auto を選ぶと composer に最適化セレクタ（コスト優先/バランス/知能優先）が
   現れ、既定は「コスト優先」である。
2. モードを変えると同一プロンプトでも選定モデル・effort が方針どおり変わる。
3. モード選択はリロード後・別画面でも保持され、設定画面と composer で同期する。
4. 既定ではモデル名バナーが出ず、設定 ON で従来どおり表示される。
5. 自動再試行の通知は表示設定に関わらず出る。
6. 「新規タスクの既定モデルを Auto にする」ON で、新規タスクの初期モデルが
   Auto になり、個別に他モデルへ切り替えられる。
7. ファイルパス多数言及・長い会話・直前の失敗で tier が上がる。
8. `autoOptimize` 未指定・不正時の API 挙動が仕様どおり（既定 cost / 400）。
9. cost モードの選定結果が本改修前と一致する（回帰なし）。
10. `tsc` / `eslint` / `vitest` / `npm run e2e` が全緑。

## 非対応（本仕様では扱わない）

- Hard の Impose Auto（モデルピッカーの固定）
- LLM による分類（追加トークンコストを避ける方針は維持）
- 実測レイテンシ・実価格 API に基づくルーティング（名前ヒューリスティクス継続）
- ルーティング統計の収集・学習
- TaskView で新規セッションを作成した場合の Impose Auto 適用
- follow-up 失敗時の自動再試行（初回プロンプト限定のまま）

## 既知の制約・リスク

| 項目 | 内容 | 緩和策 |
|---|---|---|
| モード別テーブルの主観性 | Cursor の内部ルーティングは非公開のため、3 モードの割当は本実装の設計判断 | テーブルを 1 箇所に集約し調整可能にする。cost は現行値固定で回帰なし |
| シグナルの閾値 | 3 件 / 4 項目 / 20 メッセージは経験則 | 定数として集約し、テストで境界を固定 |
| モデル名非表示 | どのモデルが動いたか即座に分からない | 設定 1 つで復帰できる。再試行通知は常時表示 |
| Impose Auto と last-used の競合 | ON のとき last-used が無視される | Cursor の Soft と同義（新規チャットは既定 Auto、個別切替可）と仕様に明記 |
| 設定キー増加 | localStorage / server 双方に 3 キー追加 | `auto-settings.ts` に集約し、検証をサーバー側 allowlist で強制 |
