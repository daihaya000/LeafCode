# GoalループUI 見直し 仕様

## 背景

前回修正で `format` 送信をやめ fenced JSON 方式に切り替えた結果、以下がチャット欄に露出する:
1. ループプロンプト（数百文字のシステム指示）が user メッセージとして表示される
2. 最終 assistant メッセージの本文末尾にある ` ```json {...} ``` ` ブロックが表示される

加えて、進捗履歴・ステータス色分け・停止確認・maxTurns 実行中変更・aria 属性が未整備。

## 1. プロンプト / JSON 隠蔽

### プロンプト隠蔽
- `buildGoalPrompt` の出力先頭に HTMLコメント形式のマーカーを埋める:
  `<!-- webui-goal-loop-prompt -->\n\n{既存プロンプト本文}`
- TaskView の `timeline`/`visibleMessages` に渡す前に、user メッセージの最初の text part がこのマーカーで始まる場合そのメッセージを表示から除外する
- 既存の `filterRevertedMessages` と同じ純粋関数層（`useSessionStream.ts` または TaskView 側）に `filterGoalLoopMessages` を新設し、`visibleMessages` に合成
- **非表示条件**: user メッセージかつ `parts[0].type === "text"` かつ `parts[0].text.startsWith("<!-- webui-goal-loop-prompt -->")`
- 非表示メッセージは PartView で一切描画しない（メタヘッダーも含む）
- revert 対象からの除外は既存ロジックに任せる（revert messageID が非表示メッセージを指すことは実運用上ない）

### JSON ブロック隠蔽
- 最終 assistant メッセージの本文末尾にある ` ```json ... ``` ` ブロックを PartView の text 描画から取り除く
- 既存の markdown レンダリング前に行単位で除去: 終端の ` ```json ` 〜 ` ``` ` ブロックを正規表現で削除
- 対象: `m.info.role === "assistant"` の text part。`extractGoalResult` が成功したメッセージのみ（成功しない場合は通常エラー表示で止まるので、生テキストが出るのは許容）
- 判定: GoalLoopPanel から「現在ループ実行中」を PartView に伝えるのは prop drilling が深い。代替として、末尾の fenced json ブロックの内容が `{status,summary,...}` 形式なら常に隠す（一般会話で末尾にその形式の json ブロックが出る確率はほぼゼロ）

### 択: マーカー方式 vs 常時方式
- プロンプトは確実にマーカーで識別可能 → マーカー方式
- JSON ブロックは「Goal結果の形状に合致する末尾 fenced json」を常時隠す方式がシンプル。一般会話で `{status,summary,next,evidence}` を含む json ブロックが末尾にあることは稀で、仮に隠れてもユーザー影響は軽微

## 2. GoalLoopPanel リデザイン

### ステータス表示
- `queued` と `running` を統合して「実行中」と表示（両方ともユーザー視点では動いている）
- ただし内部ステータスは `${status}` badge で細分（実行中/一時停止/完了/ブロック/停止/エラー）
- ステータス色分け（DESIGN.md 原則: accent 1系統 + danger/success 系トークン）:
  - 実行中: `text-working`（既存の進行中表示色）
  - 一時停止: `text-muted`
  - 完了: `text-success`（DESIGN.md に success #1D7A3D あり）
  - ブロック: `text-warning`（既存トークン）
  - 停止: `text-muted`
  - エラー: `text-danger`
- バッジ背景も状態に応じて `bg-working/15` / `bg-success/15` / `bg-warning-bg` / `bg-danger-bg` など

### 進捗履歴
- `loop.progress` を新しい順（最新が上）で最大5件表示
- 各エントリ: タイムスタンプ + status アイコン + summary + next/evidence
- 折りたたみ可能（デフォルト展開、最新3件、残りは「履歴を表示」で展開）
- 空の場合は非表示

### レイアウト
- パネル全体: `rounded-xl border bg-surface p-3`（既存維持）
- ヘッダ: アイコン + 「Goalループ」+ ステータスバッジ + ターン数 + 操作ボタン
- goal テキスト: `line-clamp-2`（既存維持）
- 進捗履歴: ヘッダ下、最新3件、展開可
- error/blockedReason: 既存の警告/危険バンド（維持）

## 3. 開始フォーム（composer トグル方式）

TaskView / HomeView の Goal 開始 UI は `components/GoalLoopComposer.tsx` の
`GoalLoopToggle` / `GoalLoopOptions` を共有する。

- **goal はコンポーザーの本文**。専用の goal 入力欄は持たない
- **トグル**: コンポーザー下部ツールバーのピル（`aria-pressed` / `aria-label="Goalループで継続実行"`）。
  OFF の間は縦方向の場所を取らない
- **詳細設定**: トグル ON のときだけ acceptance（`aria-label="承認条件"`）と
  maxTurns（`aria-label="最大ターン数"`、1..100 にクランプ）を本文欄の下に出す

### TaskView（セッション側）
- 会話ペイン先頭の常設「Goalループを開始」カードは廃止（ループ未使用のセッションで
  冒頭を占有していたため）
- ON のとき送信ボタンは `aria-label="Goalループを開始"` になり、`send()` は
  プロンプト送信ではなく `POST /api/tasks/:id/goal-loop` を呼ぶ。失敗時は下書きを復元して
  トグル ON のまま保つ
- 稼働中ループ（queued / running / verifying_completed / paused）の間はトグルを隠す。
  操作は GoalLoopPanel が担う
- 開始失敗のエラーはコンポーザー上部に `role="alert"` で出す

### HomeView（Top）
- 既存のトグル + acceptance + maxTurns を共有コンポーネント化（見た目・aria は不変）

## 4. 停止確認ダイアログ

- `stop` アクション実行前に確認ダイアログを表示
- メッセージ: 「Goalループを停止しますか？セッションは中断され、進行中の作業は失われます。」
- 「停止する」（danger）/「キャンセル」
- 既存の confirm dialog パターンを調査して踏襲（TaskView 内の approval dialog などを参考）

## 5. error 状態からの再開

- 再開時に `error` メッセージをクリア（サーバー側 `updateGoalLoopStatus` の resume で既に `error = ''` にしていることを確認済み）
- UI 側で error バンドが残らないよう、resume 成功後に `setGoalLoopError(null)` を追加
- error 状態でも再開ボタンを表示（既存条件 `paused || error` で対応済み）

## 6. maxTurns 実行中変更

- `paused` 状態でのみ maxTurns 編集を許可（実行中は技術的に困難: スケジューラが別プロセス相当）
- 編集用 PATCH エンドポイント `/api/tasks/[id]/goal-loop` に `maxTurns` 更定アクションを追加、または既存 PATCH の body に `maxTurns` を追加
- UI: paused 時に GoalLoopPanel 内に maxTurns 編集 UI を表示
- **判断**: サーバー側変更が必要で範囲が広がる。今回は UI 整備が主目的なので、paused 時の編集 UI と PATCH 対応を含める

## 7. アクセシビリティ

- GoalLoopPanel: `role="region" aria-label="Goalループ"`
- ステータスバッジ: `aria-label` で状態をフルテキスト
- 操作ボタン: 既存の `aria-label` または可視テキスト
- 進捗履歴リスト: `role="list"`、各項目 `role="listitem"`
- 開始トグル: `aria-pressed` + `aria-label="Goalループで継続実行"`、ON 時の送信ボタンは
  `aria-label="Goalループを開始"`

## 8. テスト計画

- `filterGoalLoopMessages` の単体テスト（マーカーあり/なし混在）
- GoalLoopPanel の描画テスト（各ステータス・進捗履歴・操作ボタン）
- 停止確認ダイアログの表示・キャンセル・実行
- maxTurns 編集（paused 時のみ）
- TaskView.test.tsx に GoalLoop シナリオを追加（モック fetch で loop を返す）
- GoalLoopComposer.test.tsx（トグルの pressed 状態・disabled、maxTurns のクランプ）
- TaskView.test.tsx の「Goalループ composer」（常設フォーム不在・トグル開閉・
  goal として送信・失敗時の下書き復元・稼働中はトグル非表示）

## 9. 非対象
- ループの新機能（並列実行・スケジュール等）
- サーバー側ロジック（goal-loop.ts）の変更は maxTurns 更定のみ