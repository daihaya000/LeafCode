# WebUI Auto モデル選択: TaskView follow-up 対応（追補）

## 背景

`docs/specs/auto-model-selection.md`（承認済み）は TaskView follow-up
送信への Auto 適用を非対応としていた。ユーザーから「TaskView で Auto が
選べない」との要望があり、本追補でスコープに追加する。

TaskView の follow-up は `POST /api/tasks` を通らず、
`stream.sendPrompt` / `stream.sendCommand`（`useSessionStream`）経由で
`/api/opencode/session/:id/prompt_async`（または `/command`）プロキシへ
直接送信される。サーバー側（BFF）に解決ポイントが無いため、
**クライアント側で解決**する。`classifyPrompt` / `chooseAutoModel` は
本体仕様 §1 で「サーバー/クライアント両方から import 可能な純関数」
として実装済みであり、これを TaskView から直接呼ぶ。

## 目的

TaskView の ModelSelect に `Auto（コスト最適）` を追加し、選択時は
送信直前にクライアント側でモデル・variant を解決して、確定済み値を
OpenCode へ送る。判定基準・選定規則・文言は本体仕様 §1 と完全に
同一とする（実装も同一関数を共有）。

## 要件

### 1. 共有定数の移設（HomeView リファクタ含む）

- `web/src/lib/auto-model.ts` に
  `export const AUTO_MODEL_OPTION: ModelOption =
  { value: AUTO_MODEL_VALUE, label: "Auto（コスト最適）", group: "Auto" }`
  を追加する（`ModelOption` 型は `./model-options` から import。
  model-options → auto-model の逆依存は無いため循環しない）。
- HomeView のローカル定数 `AUTO_OPTION` を削除し
  `AUTO_MODEL_OPTION` に置き換える（挙動変更なし）。

### 2. TaskView: Auto option の挿入

- provider 応答から options を構築し `filterEnabledModelOptions` →
  `sortModelOptions` を通した**後**に
  `[AUTO_MODEL_OPTION, ...sorted]` として `setModelOptions` する
  （本体仕様 §3-1 と同じ理由: `providerSortKey("auto")` は
  unknown 扱いで末尾に沈むため）。
- 初期モデル選択（default → config.model → provider default）は
  **変更しない**。Auto へフォールバックしない（明示選択のみ）。
  既存の seeded model（メッセージ履歴からの復元）は実モデルのみを
  返すため影響なし。

### 3. TaskView: Auto 解決用入力の保持

provider fetch 時（options / caps / map を構築する既存ループ）に
以下を state へ追加保存する:

- `autoProviders: AutoCandidateProvider[]`
  （`/api/opencode/provider` 応答の `all[]` から
  `{ id, models }` を構築。models には `name` / `variants` /
  `capabilities` をそのまま渡す）
- `autoConnected: string[]`（同応答の `connected ?? []`）
- `autoDisabled: Record<string, true>`
  （`/api/extensions/provider-models` 応答から導出:
  `provider.enabled === false` → `disabled[id] = true`、
  `model.enabled === false` → `disabled["id::mid"] = true`。
  DTO 取得失敗・provider 不在時は空 = 全許可。
  `filterEnabledModelOptions` と同じ fail-open 方針）

### 4. TaskView: 送信時の解決（`model === AUTO_MODEL_VALUE`）

送信処理（`sendPrompt` / `sendCommand` 共通の opts 構築部）を拡張する:

1. **agent 固定モデル優先**: `agent` が選択され `agentModels[agent]` が
   存在する場合、Auto 解決は行わず opts に `model` / `variant` を
   含めない（OpenCode が agent モデルを適用。本体仕様 §2-2 と同じ
   precedence。既存 `sendingModelKey` はこのとき agent モデルを
   指すため画像ゲート・last-used も既存挙動のまま）。
2. それ以外の場合:
   - `classifyPrompt(text, { hasImages: attachments に画像あり })` で
     tier を決定（スラッシュコマンドも raw テキストで分類）。
   - `chooseAutoModel({ providers: autoProviders,
     connected: autoConnected, disabled: autoDisabled, tier,
     hasImages })` で解決する。
   - `null` の場合、
     `setSendError("Auto で選択可能なモデルがありません。プロバイダ接続とモデル有効化を確認してください。")`
     を表示して**送信を中止**する。中止は draft クリア
     （`setInput("")` / `rememberComposerDraft`）より**前**に行い、
     入力を消さない（既存の画像ブロック early-return 群と同じ位置）。
   - 解決成功時、opts に
     `model: { providerID, modelID }` と
     `variant`（`decision.variant` 非空時のみ）を設定する。
     `intelligence` は Auto 選択中 `""` のため既存コードで送られない。
3. goal-loop 起動（`startGoalLoop`）でも同様に解決し、goal-loop POST
   body へ解決済み `model` / `variant`（非空時のみ）を渡す。解決不能時は
   `setGoalLoopError` に同文言を表示して中止する。分類対象は goal
   テキスト。
4. 自動再試行（本体仕様 §4-3）は **follow-up に適用しない**
   （初回プロンプト限定のまま。`AutoTaskRecord` も書かない）。

### 5. TaskView: 画像ゲート緩和

Auto は自前の capability を持たないため、次の**2 箇所**を同じ規則で
緩和する（`modelCapabilities` 中に `image === true || attachment === true`
のエントリが 1 つでもあれば通す。1 つも無ければ既存文言でブロック）。
Auto 解決は `hasImages` で候補を画像対応に絞るため、通過後の実送信は
必ず画像対応モデルになる。

1. 送信時の `sendingImageSupported`（HomeView §3-2 と同一）
2. 添付コントロールの `imageSupported`（`effectiveModelKey` 由来。
   ここを緩和しないと Auto 選択中は添付ボタンと file input が
   disabled のままで、そもそも画像を添付できない）

### 6. TaskView: 選定結果の一時通知

- 新 state `autoFollowUpNotice: string | null` を追加し、送信成功後に
  `Auto: {providerID}/{modelID}{variant ? ` · effort {variant}` : ""} — {reason}`
  を設定する。
- 表示位置・スタイルは既存 Auto チップと同一（タブ下バナー・
  `bg-surface-2` 系・閉じるボタン）。閉じると null に戻す。
  次の Auto 送信で上書きする。**sessionStorage には保存しない**
  （一過性通知。タスク再訪時に残さない）。
- 既存 Auto チップ（初回選定・`AutoTaskRecord` 由来）と両方存在する
  場合は follow-up 通知を優先表示する（バナーは 1 本のみ）。

### 7. last-used

既存の `writeLastUsedModel(sendingModelKey)` は変更しない。
Auto 選択中は `"auto"` が書かれ、次回 HomeView / 本 TaskView の
選択状態と一貫する（本体仕様の既知制約「follow-up が last-used を
実モデルで上書きする」は Auto 選択継続時には発生しなくなる）。

### 8. 変更しないもの

- `web/src/app/api/tasks/route.ts` / `useSessionStream.ts` /
  `auto-model.ts` の選定ロジック / `auto-task-record.ts` の形状
- IntelligenceSelect（`providerModelsMap["auto"]` が undefined のため
  Auto 選択中は自動的に非表示。既存 useEffect が `intelligence` を
  `""` にリセットする — HomeView §3-3 と同構造）
- 初回タスク作成の Auto フロー（本体仕様のまま）

## 検証・テスト

### `web/src/components/task/TaskView.test.tsx`（追加）

- Auto option が TaskView の options 先頭に表示される
- Auto 選択で `sendPrompt` の opts に解決済み `model` と decision 由来の
  `variant` が入る（`variant: ""` のモデルでは variant キー不在）
- スラッシュコマンド送信（`sendCommand`）でも同様に解決される
- agent 固定モデルあり → opts に `model` / `variant` 不在
- 候補ゼロ → `sendError` 表示・`sendPrompt` 未呼び出し・入力が残る
- Auto + 画像: 画像対応モデルが 1 つでもあれば送信可、選定候補が
  画像対応モデルに絞られる
- 送信成功後に follow-up 通知バナーが表示され、閉じると消える
- `startGoalLoop` で解決済み model/variant が goal-loop POST に載る、
  解決不能時は `goalLoopError` 表示で POST されない
- Auto 選択中も画像を添付できる（添付コントロールが有効）
- 送信成功後 `webui:last-used-model` が `"auto"`
- IntelligenceSelect が Auto 選択中に非表示

### `web/src/components/home/HomeView.test.tsx`

- `AUTO_MODEL_OPTION` 移設後も既存テストが全緑（リファクタ検証）

### E2E `web/e2e/task.spec.ts`（追加・既存モックパターン踏襲）

- TaskView の ModelSelect 先頭グループに Auto が表示され選択できる
  （送信 payload の検証は unit テストに委ねる）

### 実行

`npx tsc --noEmit` / eslint / `npx vitest run`（全体）/
`npm run e2e`（CI モード・常駐プロセス起動禁止）。

## 影響範囲

| ファイル | 種別 |
|---|---|
| `web/src/lib/auto-model.ts` | 変更（`AUTO_MODEL_OPTION` 追加） |
| `web/src/components/home/HomeView.tsx` | 変更（定数移設のみ） |
| `web/src/components/task/TaskView.tsx` / `TaskView.test.tsx` | 変更 |
| `web/e2e/task.spec.ts` | 変更 |

## 受け入れ条件

1. TaskView の ModelSelect 先頭に `Auto（コスト最適）` が表示・選択できる。
2. Auto 選択で follow-up を送ると、解決済みモデル・variant が
   `prompt_async` / `command` payload に載る。
3. agent 固定モデル選択時は agent モデルが優先され Auto 解決されない。
4. 候補ゼロ時はエラー表示され、入力は消えない。
5. 送信後に選定モデル・effort・理由の一時通知が表示され、閉じられる。
6. HomeView の既存 Auto 挙動（本体仕様の受け入れ条件）に回帰がない。
7. `tsc` / `eslint` / `vitest` / `npm run e2e`（Auto 関連）が全緑。

## 非対応（本追補では扱わない）

- follow-up 失敗時の自動再試行（初回プロンプト限定のまま）
- follow-up 選定結果の永続化（一時通知のみ）
- TaskView 初期モデルの Auto フォールバック
- サーバー側解決への統一（follow-up 送信経路の BFF 化）

## 既知の制約・リスク

| 項目 | 内容 | 緩和策 |
|---|---|---|
| クライアント/サーバー二重実装 | 解決ロジック自体は共有純関数だが、入力（disabled）の導出元が異なる（BFF: state ファイル直読 / TaskView: DTO の enabled フラグ） | 導出規則を §3 に固定し、DTO は同じ state ファイルから生成されるため実質同値 |
| provider 情報の鮮度 | TaskView 滞在中に接続状態が変わっても解決入力は fetch 時点のまま | 既存の modelOptions と同じ鮮度であり、選定失敗時はエラー表示で再操作可能 |
| goal-loop の分類対象 | goal テキストのみで tier 判定 | 本体仕様の classifyPrompt と同一規則。誤判定時はユーザーが実モデルを明示選択できる |
