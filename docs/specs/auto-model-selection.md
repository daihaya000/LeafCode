# WebUI Auto モデル選択モード（コスト最適・コーディング特化）

> 実装ステータス: ✅ 実装済み（参照: `web/src/lib/auto-model.ts` / `auto-settings.ts`）

## 背景

HomeView の composer はユーザーが `${providerID}::${modelID}` 形式で
モデルを明示選択し、`POST /api/tasks` が `{ providerID, modelID }` と
`variant`（reasoning effort）を OpenCode へ転送する。OpenCode 本体には
モデル自動選択 API が存在しないため、タスクの難易度に関わらず常に
同一モデル・同一 effort が使われ、簡単なタスクでもトークンを浪費する。

ユーザー要件（パーソナライズ確定済み）:

| 項目 | 決定 |
|---|---|
| 優先 | コスト削減（積極的に節約） |
| 対象 | コーディング用途中心 |
| 起動 | ModelSelect で `Auto` を手動選択した時のみ（デフォルト化しない） |
| effort | 最低限を基本、複雑なタスクのみ昇格 |
| 品質不足時 | 高性能モデルで 1 回だけ自動再試行 |
| 表示 | 送信後に選定モデル・effort・理由を表示 |

## 目的

HomeView のモデル選択に `Auto` を追加し、選択時はサーバー側（BFF）が
ルールベース（LLM 分類なし・追加トークン消費ゼロ）でプロンプトを分類し、
接続済み・有効なモデルから最適な `{ providerID, modelID, variant }` を
決定して OpenCode へ転送する。OpenCode へは常に確定済みモデルを送る。

## 用語

- **Auto 値**: `AUTO_MODEL_VALUE = "auto"`。ModelSelect の option value。
  `::` を含まないため既存の `provider::model` 形式と衝突しない
  （`parseOptionValue` は `"auto"` を providerID=modelID="auto" として
  扱うが、Auto option はフィルタ/ソート後に先頭へ挿入するため
  既存関数を通らない。§4-1 参照）。
- **tier**: プロンプト分類結果。`light` | `standard` | `heavy`。
- **cost tier**: モデルのコスト帯。`cheap` | `mid` | `premium`。
- **AutoDecision**: サーバーが決定した選定結果。レスポンスで返す。

## 要件

### 1. コアライブラリ `web/src/lib/auto-model.ts`（新規・純関数のみ）

サーバー/クライアント両方から import 可能にする（`window` /
`node:fs` に依存しない）。`modelIntelligenceScore` は
`web/src/lib/model-options.ts` から、`getIntelligenceVariants` /
`IntelligenceVariant` は `web/src/lib/model-variants.ts` から import する。

#### 1-1. 型定義

```ts
export const AUTO_MODEL_VALUE = "auto";

export type AutoTier = "light" | "standard" | "heavy";

export type AutoDecision = {
  providerID: string;
  modelID: string;
  variant: IntelligenceVariant | "";
  tier: AutoTier;
  reason: string; // 表示用（日本語・機械生成テンプレート）
  escalation?: {
    providerID: string;
    modelID: string;
    variant: IntelligenceVariant | "";
  };
};

/** /provider 応答から選定に必要な最小構造（structural typing） */
export type AutoCandidateProvider = {
  id: string;
  models: Record<
    string,
    {
      name?: string;
      variants?: Record<string, { disabled?: boolean } | undefined>;
      capabilities?: {
        attachment?: boolean;
        input?: { image?: boolean };
      };
    }
  >;
};
```

#### 1-2. `classifyPrompt(prompt: string, opts: { hasImages: boolean }): AutoTier`

判定は正規表現ベース・決定的。優先順位は **heavy → light → standard**
（heavy 条件に 1 つでも該当すれば light 条件を見ない）。

- 前処理: `prompt.trim()` した文字列 `p` に対して判定する。
- **heavy**（いずれか該当）:
  - `p.length > 1500`
  - コードフェンス（```` ``` ````）が 2 組（= 4 個の ``` ）以上
  - heavy キーワードに一致:
    `/リファクタ|再設計|作り直|移行|マイグレ|アーキテクチャ|全面|全体的|複数ファイル|横断|パフォーマンス改善|最適化|デッドロック|競合状態|refactor|redesign|migrat|architect|multi-?file|cross-?cutting|deadlock|race condition|optimi[sz]e/i`
- **light**（すべて該当）:
  - `p.length < 200`
  - コードフェンスを含まない
  - 質問パターンに一致:
    `/なぜ|何が|どこ|どうやって|どういう|とは|教えて|説明|意味|why|what|where|how|explain|mean/i`
  - 作業指示パターンに**不一致**:
    `/実装|修正|追加|作成|変更|書いて|直して|消して|削除|テスト書|fix|implement|add|create|write|update|delete|remove/i`
- 上記以外は **standard**。
- `opts.hasImages` は tier を変えない（候補フィルタにのみ使用。§1-4）。
  画像付きでも短い質問は light のまま、画像対応の cheap モデルが
  選ばれ得る。

#### 1-3. `modelCostTier(modelID: string): "cheap" | "mid" | "premium"`

modelID を小文字化し `_` を `-` に正規化した文字列で判定する:

- **cheap**: `/flash|mini|nano|lite|haiku|\bfast\b/`
- **premium**: `/fable|opus|ultra|\bsol\b/`
- それ以外: **mid**

新モデル名での誤分類リスクを局所化するため、判定はこの 1 関数に
集約し、他所で名前判定を重複させない。

#### 1-4. `chooseAutoModel(...)`

```ts
export function chooseAutoModel(input: {
  providers: AutoCandidateProvider[];   // /provider 応答の all
  connected: string[];                  // /provider 応答の connected
  disabled: Record<string, true>;       // provider-model-state の disabled
  tier: AutoTier;
  hasImages: boolean;
}): AutoDecision | null;
```

**候補構築**（`listProviderModels` と同じ規則をミラーする）:

1. `connected` が空でない場合、`connected` に含まれる provider のみ。
2. `disabled[providerID]` が真の provider を除外。
3. `disabled[`${providerID}::${modelID}`]` が真のモデルを除外。
4. `hasImages === true` の場合、
   `capabilities.input.image === true || capabilities.attachment === true`
   のモデルのみ。
5. 候補が 0 件なら `null` を返す（呼び出し側が 400 を返す）。

**tier → モデル選定**（各グループ内は `modelIntelligenceScore` 最大値を
選ぶ。同点は `providerID::modelID` の辞書順で決定的にする）:

| tier | 第 1 候補 | フォールバック順 |
|---|---|---|
| light | cheap 内の最高スコア | mid → premium |
| standard | mid 内の最高スコア | cheap → premium |
| heavy | 全候補中の最高スコア | （フォールバック不要） |

**variant 選定**: 選定モデルの `getIntelligenceVariants()` の結果から、
以下の優先順で最初に存在するものを選ぶ。1 つも無ければ `""`
（OpenCode payload から省略 = モデルデフォルト）。

| tier | variant 優先順 |
|---|---|
| light | `minimal` → `none` → `low` |
| standard | `low` → `minimal` → `none` → `medium` |
| heavy | `medium` → `high` → `low` |

**escalation**（自動再試行用）: 全候補中の最高スコアモデル。
variant は同モデルの利用可能 variants から `high` → `max` → `medium`
→ `""` の順。**escalation が選定モデルと同一（providerID・modelID・
variant すべて一致）の場合は `escalation` を省略する**
（再試行しても結果が変わらないため）。

**reason テンプレート**（そのまま UI 表示する）:

- light: `短い質問タスクのため低コストモデルを選択しました`
- standard: `標準的なコーディングタスクのため中コストモデルを選択しました`
- heavy: `大規模・高難度タスクのため高性能モデルを選択しました`
- `hasImages` の場合は末尾に `（画像対応モデルに限定）` を付記。
- フォールバックが発生した場合（例: light だが cheap が 0 件）は
  末尾に `（該当コスト帯に候補がなく上位帯へフォールバック）` を付記。

### 2. API `web/src/app/api/tasks/route.ts`

#### 2-1. リクエスト拡張

body 型に `auto?: unknown` を追加。バリデーション（**すべて
`provisionWorkspace` より前**に実施し、orphan workspace を作らない。
既存の variant / 画像バリデーションと同じ位置関係）:

1. `auto` が `undefined` / `true` / `false` 以外 → `400 { error: "invalid auto" }`
2. `auto === true` かつ `body.model` が存在（`providerID` または
   `modelID` を持つ）→ `400 { error: "auto and model are mutually exclusive" }`
3. `auto === true` かつ `variant` が非空文字列 →
   `400 { error: "variant cannot be set with auto" }`
   （Auto が variant を決定するため。クライアントは送らない設計だが
   API 契約として明示的に拒否する）

#### 2-2. 選定フロー（`auto === true` のとき）

1. `body.agent` が指定されている場合、`GET /agent` で該当 agent の
   `model` を確認する。**agent に固定モデルがある場合、Auto 選定は
   行わない**（既存の agent 優先仕様と整合。route.ts の
   `supportsImageInput` と同じ precedence）。この場合:
   - OpenCode payload に `model` / `variant` を含めない
     （OpenCode が agent モデルを適用する）。
   - レスポンスの `autoDecision` は省略する。
   - 画像チェックは既存の `supportsImageInput(undefined, agent)` に
     委ねる（agent モデルの capability で判定される）。
2. agent 固定モデルが無い場合:
   - `GET /provider` と `readProviderModelState()`
     （`web/src/lib/provider-model-state.ts`）から
     `chooseAutoModel` の入力を構築する。
   - `classifyPrompt(prompt, { hasImages: files.length > 0 })` で tier を
     決定する。プロンプトがスラッシュコマンドであっても raw テキストで
     分類する（コマンド展開はしない）。
   - `chooseAutoModel` が `null` を返したら
     `400 { error: "Auto で選択可能なモデルがありません。プロバイダ接続とモデル有効化を確認してください。" }`
   - 解決後は **既存の手動選択と同一のコードパスに合流**する:
     解決値を `body.model` 相当のローカル変数
     `effectiveModel = { providerID, modelID }`・
     `variant = decision.variant` として扱い、以降の
     `supportsImageInput` 判定・`commandBody.model` /
     `promptBody.model` / `variant` 組み立ては既存ロジックを共用する
     （分岐の重複実装をしない。ここが最大のバグ混入点のため）。
     ※ `hasImages` 時は候補段階で画像対応に絞っているため
     `supportsImageInput` は必ず通るが、二重チェックとして残す。
3. `/provider` は Auto 選定と `supportsImageInput` で最大 2 回
   フェッチされ得る。許容する（既存挙動を変えないことを優先し、
   共有キャッシュの導入はしない）。

#### 2-3. レスポンス拡張

Auto 選定を実行した場合のみ、成功レスポンスに追加:

```ts
{ taskId, sessionId, directory, note, autoDecision: AutoDecision }
```

`auto !== true`、または agent 固定モデルで選定をスキップした場合は
`autoDecision` を含めない。

### 3. HomeView `web/src/components/home/HomeView.tsx`

#### 3-1. Auto option の挿入

- `AUTO_OPTION: ModelOption = { value: AUTO_MODEL_VALUE, label: "Auto（コスト最適）", group: "Auto" }` を定義する。
- `/api/opencode/provider` 応答から options を構築し
  `filterEnabledModelOptions` → `sortModelOptions` を通した**後**に
  `[AUTO_OPTION, ...sorted]` として `setModelOptions` する。
  - フィルタ/ソートを通さない理由: `providerSortKey("auto") = 100`
    （unknown provider 扱い）で末尾に沈むため。先頭固定を保証する。
  - `groupedOptions` は挿入順でグループ化されるため `Auto` グループが
    メニュー先頭に表示される。ModelSelect 本体は**変更しない**
    （アイコンは既存の `Cpu` フォールバック。
    `providerIconSrcForOpencodeId("auto")` は未定義で `onError` 経路にも
    入らない）。
- 初期モデル復元ロジック（last-used → default → config.model →
  provider default → options[0]）は変更不要。`"auto"` が
  `webui:last-used-model` に保存されていれば、options に AUTO_OPTION が
  含まれるため既存の「options に存在するか」検証を通過して復元される。

#### 3-2. 送信処理（`model === AUTO_MODEL_VALUE` のとき）

- `POST /api/tasks` の body: `auto: true` を追加し、`model` と
  `variant` を**送らない**（`providerID && modelID` の既存ガードで
  `model` は自然に省略される。`"auto".split("::")` は
  `["auto"]` となり `modelID` が `undefined` のため）。
  `variant` は `intelligence` state が常に `""` のため送られない
  （§3-3）。ただし明示性のため `auto` フラグ送信は
  `model === AUTO_MODEL_VALUE` の判定で行う。
- **画像ゲート緩和**: 既存の `sendingImageBlocked` 判定は
  `modelCapabilities["auto"]` が undefined のため常にブロックしてしまう。
  `sendingModelKey === AUTO_MODEL_VALUE` の場合は
  「`modelCapabilities` 中に image または attachment が true の
  エントリが 1 つでもあれば通す」に変更する（最終判定はサーバー）。
  1 つも無ければ既存と同じエラー文言でブロックする。
  - agent 選択時は `sendingModelKey` が agent モデルになるため
    この分岐に入らない（既存挙動維持）。
- **last-used**: 送信成功後の `writeLastUsedModel(sendingModelKey)` は
  そのまま `"auto"` を書く（次回 Home で Auto が初期選択される。
  「手動切替のみ」の原則は default-model を変更しないことで担保）。
- **goal-loop 連携**: `POST /api/tasks` 応答の `autoDecision` が存在する
  場合、goal-loop POST body に
  `model: { providerID, modelID }` と `variant`（非空時のみ）を
  `autoDecision` から渡す。`autoDecision` が無い場合（agent 固定
  モデル等）は既存どおり `model` / `variant` を省略する。
- **decision の引き継ぎ**: 応答に `autoDecision` があれば
  `sessionStorage` へ保存してから `router.push` する（§5-1 のキー仕様）。
  保存失敗（quota 等）は `try/catch` で無視する（表示・再試行が
  無効になるだけで送信自体は成功している）。

#### 3-3. IntelligenceSelect

変更不要（設計上の確認事項として記載）:
`effectiveModelKey === "auto"` のとき `providerModelsMap["auto"]` は
undefined → `intelligenceVariants` は `[]` → 既存の
`intelligenceVariants.length > 0` ガードで IntelligenceSelect は
非表示になり、既存 `useEffect` が `intelligence` を `""` に
リセットする。

### 4. 選定結果の表示・自動再試行（TaskView）

#### 4-1. sessionStorage キー仕様

- キー: `webui:auto-task:<taskId>`
- 値（JSON）:

```ts
type AutoTaskRecord = {
  decision: AutoDecision;
  /** 自動再試行用の原文。16,000 文字超は保存せず再試行を無効化 */
  prompt?: string;
  /** 再試行済みフラグ（再発火防止） */
  retried?: boolean;
};
```

- HomeView が保存する際:
  - `prompt` はタスク作成時の原文テキスト。16,000 文字を超える場合、
    または**画像添付があった場合**は `prompt` を保存しない
    （画像は再送経路で確実に再現できないため再試行対象外とする）。
- `sessionStorage`（タブ限定・非永続）を選ぶ理由: 選定結果は
  一過性の表示・単発再試行にのみ必要で、DB スキーマ変更を避ける。
  タブを閉じた後に TaskView を開き直した場合はチップ非表示・
  再試行なしとなる（許容する制約として明記）。

#### 4-2. 選定結果チップ

- TaskView マウント時に `webui:auto-task:<taskId>` を読み、存在すれば
  `stream.sessionError` バナーと同じ位置（タブ下・メッセージリスト上）
  に info スタイルのバナーを表示する:
  - `Auto: {providerID}/{modelID}{variant ? ` · effort {variant}` : ""} — {reason}`
- 閉じるボタン付き。閉じたら **`decision` の表示フラグのみ落とし、
  キー自体は削除しない**（`retried` フラグを保持するため、
  `AutoTaskRecord` に `dismissed?: boolean` を追加して更新する）。

#### 4-3. 自動再試行（1 回のみ・保守的トリガー）

発火条件（**すべて**満たす場合のみ）:

1. `stream.sessionError` が非 null に遷移した
2. `AutoTaskRecord` が存在し `retried !== true`
3. `record.prompt` が存在する（§4-1 の制約で無い場合は再試行しない）
4. `record.decision.escalation` が存在する
5. `stream.messages` に **完了済みテキストを持つ assistant メッセージが
   1 件も無く**、user メッセージが 1 件以下である
   （初回プロンプトの失敗のみを対象にし、follow-up 失敗や部分成功後の
   誤再送を防ぐ）

動作:

1. **送信前に** `retried: true` を sessionStorage へ書き込む
   （送信失敗・レース時も 1 回きりを保証。書き込み失敗時は
   再試行自体を中止する）。
2. `stream.sendPrompt(record.prompt, { model: escalation の
   { providerID, modelID }, ...(escalation.variant ? { variant } : {}),
   sessionId })` で同一セッションへ再送する
   （エンドポイントは既存の `/api/opencode/session/:id/prompt_async`
   プロキシ。新規 API は作らない）。
   - 既知のトレードオフ: 失敗した user メッセージと再送分で
     セッション内に同文が 2 回並ぶ。バナーで明示する（次項）。
3. バナー表示を更新:
   `低コストモデルでエラーが発生したため {providerID}/{modelID} で再試行しました`
4. `agent` は再送 opts に含めない（初回と同条件にするなら含めるべき
   だが、Auto 選定が走った時点で agent 固定モデルは無い。
   agent 自体の指定は… 初回 body に `agent` があり得る〔モデル未固定の
   agent〕ため、**HomeView は `AutoTaskRecord` に `agent?: string` も
   保存し、再送 opts に引き継ぐ**）。

スコープ外（明記）: tsc/テスト失敗などの意味的な品質不足検出、
`POST /api/tasks` 自体の失敗（タスク未作成のため既存エラー UI に委ねる）、
TaskView からの follow-up 送信への Auto 適用。

### 5. 変更しないもの

- `web/src/components/ModelSelect.tsx`（option 追加は呼び出し側で完結）
- `web/src/components/IntelligenceSelect.tsx`
- `web/src/lib/default-model.ts` / `web/src/app/api/settings/[key]/route.ts`
  （`default-model` の `provider::model` 検証は `"auto"` を拒否する =
  Auto をデフォルトモデルに設定できない。「手動切替のみ」の担保）
- `web/src/lib/goal-loop.ts`（クライアントが解決済みモデルを渡すため）
- `web/src/lib/useSessionStream.ts`（`sessionError` の既存伝搬を利用）
- DB スキーマ

### 6. 検証・テスト

#### 6-1. 単体テスト `web/src/lib/auto-model.test.ts`（新規）

- `classifyPrompt`:
  - 境界値: 199/200/1500/1501 文字
  - コードフェンス 1 組は heavy にならない、2 組で heavy
  - 質問パターン + 作業指示パターン混在（「なぜ壊れるか調べて修正して」）
    は light にならない
  - heavy キーワード各代表（日本語/英語）
  - 空文字・空白のみ → standard
- `modelCostTier`: cheap/premium/mid の代表 modelID、`_` 正規化
- `chooseAutoModel`:
  - connected フィルタ（空配列 = 全許可、非空 = 限定）
  - disabled（provider 単位 / model 単位）除外
  - hasImages で非対応モデル除外、全滅で null
  - tier ごとの選定とフォールバック（cheap 0 件の light → mid）
  - variant 優先順（モデルが `high` のみ宣言 → light でも `""` に
    ならず… ※light の優先順に `high` は無いため `""`。この期待値を
    テストで固定する）
  - escalation === 選定モデルのとき escalation 省略
  - 同点スコア時の辞書順決定性
  - reason 文字列（フォールバック付記・画像付記）

#### 6-2. `web/src/app/api/tasks/route.test.ts`（追加）

- `auto: true` で resolved model / variant が `prompt_async` payload に
  載る（`ocServer.mock.calls` 検証、既存パターン踏襲）
- `auto: true` + スラッシュコマンド → `/command` の `model` が
  `provider/modelID` 文字列で載る
- `auto: "yes"` → 400 invalid auto
- `auto: true` + `model` → 400 mutually exclusive
- `auto: true` + `variant: "high"` → 400
- 候補ゼロ → 400、**`provisionWorkspace` が呼ばれていない**こと
- agent 固定モデルあり → 選定スキップ、payload に model 無し、
  `autoDecision` 無し
- 画像あり → 画像対応モデルのみから選定
- 成功レスポンスに `autoDecision` が含まれる

#### 6-3. `web/src/components/home/HomeView.test.tsx`（追加）

- Auto option が options 先頭に表示される
- Auto 選択時: IntelligenceSelect 非表示、POST body に
  `auto: true` があり `model` / `variant` が無い
- Auto 選択 + 画像添付: 画像対応モデルが 1 つでもあれば送信可、
  ゼロならブロック
- 送信成功後 `webui:last-used-model` が `"auto"`、
  `webui:auto-task:<taskId>` に decision + prompt + agent が保存される
- last-used が `"auto"` のとき初期選択が Auto に復元される
- goal-loop 有効時、goal-loop POST に `autoDecision` 由来の
  model/variant が載る

#### 6-4. `web/src/components/task/TaskView.test.tsx`（追加）

- `AutoTaskRecord` 存在時にチップ表示、閉じると非表示 +
  `dismissed` 保存
- `sessionError` 遷移で escalation 再送が 1 回だけ発火
  （`sendPrompt` 呼び出し引数に escalation model/variant/agent）
- `retried: true` 済み / `prompt` 無し / escalation 無し /
  完了済み assistant あり → 発火しない
- 非 Auto タスク（キー無し）→ 発火しない

#### 6-5. E2E `web/e2e/composer.spec.ts`（追加・route intercept モック）

- Auto option がメニュー先頭グループに表示される
- Auto 選択で intelligence selector が消える
- 送信時の `/api/tasks` リクエスト body に `auto: true` が含まれる

#### 6-6. 実行

`npx tsc --noEmit` / `eslint` / `vitest run`（常駐プロセス起動なし）。
E2E は `npm run e2e`（CI モード）。

## 影響範囲

| ファイル | 種別 |
|---|---|
| `web/src/lib/auto-model.ts` / `auto-model.test.ts` | 新規 |
| `web/src/app/api/tasks/route.ts` / `route.test.ts` | 変更 |
| `web/src/components/home/HomeView.tsx` / `HomeView.test.tsx` | 変更 |
| `web/src/components/task/TaskView.tsx` / `TaskView.test.tsx` | 変更 |
| `web/e2e/composer.spec.ts` | 変更 |

## 受け入れ条件

1. ModelSelect の先頭に `Auto（コスト最適）` が表示され、選択・送信で
   タスクが作成される。
2. 短い質問プロンプトでは cheap tier のモデル + 最低限 variant が
   選ばれ、`prompt_async` payload で OpenCode へ渡る。
3. heavy 条件（長文・リファクタ語彙等）では最高スコアモデル +
   `medium` 以上の variant が選ばれる。
4. 画像添付時は画像対応モデルのみから選定され、対応モデルが無ければ
   クライアント/サーバー双方で既存と同等のエラーになる。
5. agent 固定モデル指定時は Auto 選定がスキップされ agent モデルが
   使われる。
6. タスク画面に選定モデル・effort・理由のチップが表示され、閉じられる。
7. 初回プロンプトが `session.error` で失敗した場合、escalation モデルで
   1 回だけ自動再送され、バナーで通知される。2 回目は発火しない。
8. `default-model` 設定に `"auto"` は保存できない（既存検証で拒否）。
9. `tsc` / `eslint` / `vitest` / `npm run e2e` が全件成功する。

## 非対応（本件では扱わない）

- LLM によるプロンプト分類（追加トークン消費を避ける）
- TaskView follow-up 送信への Auto 適用
- tsc/テスト失敗など意味的品質判定による再試行
- 料金メタデータに基づく厳密なコスト計算（名前ヒューリスティクスで代替）
- Auto のデフォルトモデル化・Settings UI
- 選定結果の DB 永続化（sessionStorage のみ）

## 既知の制約・リスク

| 項目 | 内容 | 緩和策 |
|---|---|---|
| 名前ヒューリスティクス | 新モデル名で cost tier 誤分類の可能性 | `modelCostTier` に判定を集約し 1 箇所で修正可能にする |
| 分類精度 | ルールベースのため境界ケースで tier 誤判定 | Auto は手動選択制。誤選定時はユーザーが通常選択に戻せる |
| 再試行の重複メッセージ | 同一プロンプトがセッションに 2 回並ぶ | バナーで明示。発火条件を初回失敗に限定 |
| sessionStorage 非永続 | タブを閉じるとチップ・再試行が無効 | 一過性機能として許容（仕様に明記） |
| `/provider` 二重フェッチ | Auto 選定と画像チェックで最大 2 回 | 既存コードパス共用を優先し許容 |
| last-used 上書き | TaskView follow-up 送信で `"auto"` が実モデルに上書きされる | last-used の意味（最後に使った実効値）として一貫。仕様に明記 |
