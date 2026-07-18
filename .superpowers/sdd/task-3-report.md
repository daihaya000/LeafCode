# Task 3 UI Integration Report

## STATUS

PASS

## 変更

- `PlanDocumentCard` を追加し、Markdown本文、basename、loading/error/retry、承認失敗/retry、submitted を表示。
- `TaskView` で認識済み Plan の source part のみをカードへ置換し、最新の completed Plan だけを actionable にした。
- 承認時に同一 session へ `agent: "build"` と指定文言を送信し、composer の agent を build に更新した。
- E2E に本文表示、絶対パス非表示、最新 Plan、二重送信防止、取得/承認再試行、busy disabled、非 actionability を追加した。

## RED 証拠

`cd web && npx playwright test e2e/task.spec.ts --grep "Plan Markdown|failed Plan document|failed approval|task is busy|unfinished Plan"`

- 実装前: 6件中4件失敗。`Release Plan` 見出しおよび `承認して実装` が存在せず、Plan UI 未実装が原因。

## GREEN / 検証結果

- 同一 focused Playwright: 6 passed
- `npm run build`: passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `git diff --check`: passed

## commit

`feat: approve plan documents from task view`（hash は commit 後の `git log --oneline -1` で確認）

## 自己レビュー

- 絶対パスは API request の内部値に限定し、UI・aria label・エラーには basename または固定文言のみを使用。
- loading/submitted は polite status、失敗は alert、CTA は native disabled を使用。
- `approvingRef` と disabled の二重ガードで連続操作時の重複送信を防止。
- 既存の `Button`、`Spinner`、`Markdown`、semantic utility のみを使用。

## 懸念

- 375px の実機/スクリーンショットによる視覚確認は未実施。既存 timeline 幅内の responsive utility と focused browser E2E で確認した。
