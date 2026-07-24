# NextAction 実装計画

## 承認済み仕様

`docs/superpowers/specs/2026-07-24-next-action-design.md`（`6be4b97`）

## 実施手順

1. `next-action` pure helper を追加する。
   - 会話 part から安全にテキストを抽出する。
   - 直近優先で入力長を制限する。
   - モデル返答から1件の指示文を正規化・検証する。
   - helper の単体テストを作成する。

2. `POST /api/tasks/[id]/next-action` を追加する。
   - workspace/task/session の関連を検証する。
   - 元セッションから履歴を取得し、一時 session を作成する。
   - tools 無効の同期 prompt で提案を生成する。
   - `finally` で一時 session を削除し、本文をログ・エラーへ露出しない。
   - 成功、入力不正、OpenCode失敗、削除失敗の route test を追加する。

3. `NextAction` UI を追加する。
   - idle/生成中/成功/失敗を表示する。
   - 操作に aria 属性を付ける。
   - 提案適用は callback のみを呼び、送信しない。
   - component test を追加する。

4. TaskView に統合する。
   - idle・会話あり・注意要求なしのときだけ表示する。
   - API へ sessionId と選択済み agent/model を送る。
   - 既存 `restoreToComposer` を使って提案を反映する。
   - 会話・revert・タスク切替で提案状態を失効させる。
   - TaskView test に非送信・失効を追加する。

5. 検証する。
   - 対象 Vitest、`npm run typecheck`、`npm run lint` を実行する。
   - UI reviewer でアクセシビリティ、responsive、仕様準拠を確認する。
   - 指摘があれば修正し、再検証する。

## コミット方針

- helper/API とテスト、UI/TaskView とテスト、レビュー修正を意味単位に分ける。
- 各変更後に対応する検証を実行してからコミットし、`git log --oneline -1` で確認する。
