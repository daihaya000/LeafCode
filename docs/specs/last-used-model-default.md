# 新規セッションのアクティブモデルを最後に使用したモデルにする

## 背景

`HomeView`（新規タスク作成）と `TaskView`（既存タスク続き）の composer は、
初期モデルを次の優先順位で決定している。

1. `webui:default-model`（Settings でユーザーが明示設定した固定デフォルト）
2. OpenCode `config.model`（`provider/modelID` 形式）
3. 各プロバイダの default 一覧（接続順）
4. 最終フォールバックは `options[0]`

ユーザーが Settings で明示的に固定しない限り、新規セッションは常に
`config.model` またはプロバイダ default で決まり、前回の会話で使った
モデルは引き継がれない。直前に使ったモデルで次も続きを書きたいケースが
多く、毎回選び直す手間を省くことが求められている。

## 目的

新規セッション（HomeView）を開いたとき、アクティブモデルの初期値を
「最終的に直前のメッセージ送信で使用したモデル」にする。
既存の `default-model`（ユーザー固定設定）の意味は維持しつつ、
未設定時は最後に使ったモデルを再利用する。

## 要件

### 1. 最終使用モデルの記録（書き込み）

- 新しい localStorage キー `webui:last-used-model` を導入する。
  - 値は `HomeView` / `TaskView` 共通の形式 `${providerID}::${modelID}`
    （GhostSelect option value と同じ）。
- 送信してタスク作成 or 追加発言が成功したタイミングで書き込む。
  - 書き込む値は「その送信で実効的に使ったモデル」。
    - agent が agent モデルを持つ場合 → その agent の `agentModels[agent]`
      から導出した `${providerID}::${modelID}`。
    - それ以外 → composer の選択中 `model`。
  - 画像添付の capability 判定などに使う `sendingModelKey` と同一の計算結果を使用する。
- `HomeView` / `TaskView` 両方の送信成功パスで記録する。
  - `HomeView` は新規タスク生成（`POST /api/tasks`）の成功後。
  - `TaskView` はフォローアップ送信（`POST /api/tasks/{id}/messages` 相当）
    の成功後。
- 既存 `writeDefaultModel` と同様に、書き込み失敗は無視する（`try/catch`）。

### 2. 新規セッションの初期モデル選択（HomeView のみ）

- `HomeView` の初期モデル決定の優先順位を以下に変更する。

  1. `webui:last-used-model`（最後に使用したモデル）
  2. `webui:default-model`（従来のユーザー固定設定）
  3. `config.model`
  4. プロバイダ default
  5. `options[0]`

- いずれの候補も存在しない、または現在有効な `options` に含まれない場合は
  次の優先項目へフォールバックする（既存と同じ検証方式を維持）。

### 3. TaskView の初期モデル選択（変更なし）

- `TaskView` は既存タスク続きのため、初期モデルは「そのタスクが
  これまでに使っていたモデル」を保持する現状挙動のままにする。
  - すなわち `TaskView` の初期選択ロジックには `last-used-model` を
    追加しない。
- ただし `TaskView` から送信したときは `last-used-model` を書き込む
  （要件 1）。これにより次回 `HomeView` を開いたとき直前に使った
  モデルが選ばれる。

### 4. 設定画面（SettingsView）

- 変更しない。`default-model` 設定 UI はそのまま残し、
  `last-used-model` 編集 UI は追加しない。
  - `default-model` は `last-used-model` より下位のフォールバックになる。
  - `default-model` は `last-used-model` が無い初回起動時や、記録が
    無効化できない環境のフォールバックとして意味を保つ。

### 5. 実装場所

- `web/src/lib/default-model.ts` に以下を同居させる（既存 mock が
  1 ファイルで済むように）。
  - `LAST_USED_MODEL_EVENT = "webui:last-used-model"`（cross-tab 通知用 event）
  - `readLastUsedModel(): string | null`
  - `writeLastUsedModel(value: string | null): void`
- `HomeView` / `TaskView`:
  - 送信成功後に `writeLastUsedModel(sendingModelKey || model || null)` を呼ぶ。
  - `HomeView` は初期選択ロジックの冒頭へ `readLastUsedModel()` の候補を追加。
- `TaskView` は DEFAULT_MODEL_EVENT と同様に LAST_USED_MODEL_EVENT を
  listen する必要はない（タスク内選択は確定済のため）。ただし送信時の
  書き込みのみ追加する。

### 6. 検証

- 既存テスト `default-model.test.ts` が無ければ新規追加:
  - `readLastUsedModel` / `writeLastUsedModel` の localStorage 読み書き
  - `writeLastUsedModel(null)` はキー削除
  - `CustomEvent` が発火する（`LAST_USED_MODEL_EVENT`）
- `HomeView.test.tsx`:
  - mock に `readLastUsedModel: () => ""` を追加し、既存テストが
    通ることを確認（後方互換）。
  - last-used 値を返す mock で、`model` 初期値がその値になることを
    確認する新規テストを1件追加。
- `tsc` / `eslint` / `vitest` で検証。

## 影響範囲

- 変更ファイル
  - `web/src/lib/default-model.ts`（新規 API 追加）
  - `web/src/components/home/HomeView.tsx`（初期選択 + 送信時書き込み）
  - `web/src/components/task/TaskView.tsx`（送信時書き込みのみ）
  - `web/src/components/home/HomeView.test.tsx`（mock + 新規テスト）
- 変更しないファイル
  - `SettingsView.tsx`（`default-model` UI を維持）
- localStorage 追加キー: `webui:last-used-model`（`webui:default-model` は保持）

## 受け入れ条件

1. `HomeView` を開いたとき、`webui:last-used-model` が存在し、現在有効な
   model option に含まれていれば、それがアクティブモデルの初期値になる。
2. 存在しない場合は従来通り `default-model → config.model → providers → options[0]`
   の順で決まる。
3. `HomeView` で新規タスク送信に成功すると `webui:last-used-model` が
   送信時の実効モデルで上書きされる。
4. `TaskView` でフォローアップ送信に成功すると同じく上書きされる。
5. `TaskView` を開いたとき、`last-used-model` の有無で初期モデルは変わらない
   （現在の挙動と同じ）。
6. 既存の `default-model` 設定 UI、挙動、関連テストは従来互換で動く。
7. `tsc` / `eslint` / `vitest` が全件成功する。

## 非対応（本件では扱わない）

- `last-used-model` を Settings でクリアする UI
- `last-used-model` の無効化トグル
- 複数プロジェクト別の last-used 管理
- ユーザーが Settings で `default-model` を明示している時の優先制御
  （既定で `last-used-model` を最優先し、`default-model` はフォールバック扱い）