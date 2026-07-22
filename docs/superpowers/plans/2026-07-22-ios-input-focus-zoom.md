# iPhone入力フォーカス時の自動拡大対策 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iPhone Safariでフォーム要素にフォーカスしてもページが自動拡大しないようにする。

**Architecture:** アプリ全体で読み込まれる `globals.css` に、フォーム要素のフォントサイズを16pxへ統一する最小の共通CSSルールを置く。viewport制限やコンポーネント単位の変更は行わず、ユーザーの明示的なピンチズームを維持する。

**Tech Stack:** Next.js、React、Tailwind CSS、グローバルCSS、TypeScript。

## Global Constraints

- 対象は `input`、`textarea`、`select` の実効フォントサイズのみで、16pxに統一する。
- `user-scalable=no`、`maximum-scale`、その他のviewportズーム制限を追加しない。
- 入力要素以外の文字サイズ、レイアウト、色、状態、イベント処理を変更しない。
- 型チェックは `cd web && npx tsc --noEmit` で確認する。

---

## File Structure

- Modify: `web/src/app/globals.css:99-108` — フォーム要素のSafari自動ズーム回避用の共通フォントサイズを定義する。
- Modify: `MEMORY.md` — 実施内容、判断理由、検証時の教訓を追記する。

### Task 1: フォーム入力の共通フォントサイズを追加する

**Files:**
- Modify: `web/src/app/globals.css:104-108`
- Test: `web/src/app/globals.css` の構文検査と `web` の型チェック

**Interfaces:**
- Consumes: `web/src/app/layout.tsx` が読み込むグローバルスタイル。
- Produces: 全画面の `input`、`textarea`、`select` に適用される `font-size: 16px` のCSSルール。

- [ ] **Step 1: 変更直前に対象と作業ツリーを確認する**

Run: `git status --short && git diff -- web/src/app/globals.css && type web\src\app\globals.css`

Expected: `globals.css` に入力要素の共通 `font-size` ルールがなく、他者の未コミット差分をこの変更へ混在させない。

- [ ] **Step 2: グローバルフォームルールを追加する**

`body` ルールの直後に次を追加する。

```css
input,
textarea,
select {
  font-size: 16px;
}
```

- [ ] **Step 3: CSS差分と型チェックを実行する**

Run: `git diff --check && cd web && npx tsc --noEmit`

Expected: `git diff --check` は出力なし、`tsc --noEmit` は終了コード0。

- [ ] **Step 4: iOS Safariで手動確認する**

ホーム、タスク詳細、設定、コマンドパレットの各 `input`、`textarea`、`select` をフォーカスする。ページが自動拡大せず、ピンチズームは可能であり、既存の入力・選択・送信が動作することを確認する。

- [ ] **Step 5: 変更だけをコミットする**

Run:

```bash
git add -- web/src/app/globals.css
git commit -m "fix: iPhone入力時の自動拡大を防止"
git log --oneline -1
```

Expected: `globals.css` のみを含む新規コミットのハッシュが表示される。

### Task 2: 作業記録を残す

**Files:**
- Modify: `MEMORY.md` — iOS Safari向け共通フォームフォントサイズの判断と検証結果を追記する。

**Interfaces:**
- Consumes: Task 1で確定した実装と検証結果。
- Produces: 後続セッションが判断理由と手動確認項目を参照できる追記式の記録。

- [ ] **Step 1: MEMORY.mdの既存形式を確認する**

Run: `type MEMORY.md`

Expected: 過去の記録を保持した追記式の形式を確認できる。

- [ ] **Step 2: 実施内容・判断理由・教訓を追記する**

次の内容を既存エントリの末尾へ追加する。

```markdown
## 2026-07-22: iPhone入力フォーカス時の自動拡大対策

- やったこと: `input`、`textarea`、`select` の共通フォントサイズを16pxに統一した。
- 判断理由: iPhone Safariは16px未満のフォーム入力をフォーカスすると自動拡大するため、個別コンポーネントではなくグローバルCSSで漏れなく対処した。
- 教訓: viewportのズーム制限ではなくフォーム要素の文字サイズを補正し、ピンチズームのアクセシビリティを維持する。
```

- [ ] **Step 3: 記録を確認してコミットする**

Run:

```bash
git diff --check
git add -- MEMORY.md
git commit -m "docs: iPhone入力拡大対策の判断を記録"
git log --oneline -1
```

Expected: `MEMORY.md` だけを含む新規コミットのハッシュが表示される。

- [ ] **Step 4: 完了前の作業ツリー確認をする**

Run: `git status --short`

Expected: 自分の未コミット差分は残らない。他者の差分がある場合は内容を変更・混在させず、所有者へ確認する。
