# グローバル OpenCode 設定プロファイル切替 実装計画

**仕様:** [`docs/specs/opencode-config-profiles.md`](../specs/opencode-config-profiles.md)（承認済み、`874fbc8`）

**ゴール:** `~/.config/opencode` の reparse point を差し替えることで、設定一式（`opencode.jsonc`・agents・skills・plugin・packages・node_modules）を丸ごと切り替えられるようにする。既存 `default` は明示操作で `%APPDATA%\opencode-webui\profiles\default` へ移行し、以後すべてのプロファイルを dataDir に集約する。

**技術:** Next.js 15 Route Handlers（BFF）、React 19、TypeScript、Vitest、Testing Library。Windows junction（`fs.symlink(..., 'junction')`）による切替。

## 全体制約

- 実装開始前に各タスクの対象ファイルを再読込し、他セッション差分を混ぜない。
- 各タスクは失敗テスト → 最小実装 → 対象テスト → `git status` / `git diff` 確認 → 即コミットで完結させる。
- **リンク削除は `fs.rmdirSync()` のみ。** `fs.rm(..., { recursive: true })` をリンクへ適用するコードを書かない。
- **実体ディレクトリを削除する経路を作らない。** `DELETE` はレジストリ除外のみ。
- 複製は同期 API（`fs.cpSync`）を使わない。BFF のイベントループを塞がないこと。
- `next dev` / `next build` / watch / 対話モードを bash で起動しない。検証は `tsc` / `eslint` / `vitest` のみ。
- クライアントから任意の絶対パスを受け取らない。操作対象は登録済みプロファイル ID に限定する。
- UI 実装前に ui-ux-designer、実装後に test-writer と ui-ux-reviewer を通し、mobile / tablet / desktop の 3 viewport を確認する。
- 3 ファイル以上・モジュール横断の実装単位は lead-programmer へ委任し、メインは契約・差分・検証を統合する。

## 仕様からの微修正（実装上の確定事項）

仕様の意図は変えず、次の 2 点を実装都合で確定する。

1. **`linkState` は `"link" | "realdir" | "missing"` の 3 値**とする。Node は junction と directory symlink をどちらも `lstat().isSymbolicLink() === true` として扱い、両者の区別には `fsutil` などの外部プロセス起動が必要になる。区別は機能に影響せず表示上の差でしかないため、`junction` / `symlink` を `link` に統合する。
2. **複製は `fs.promises.cp` ではなく自前の非同期再帰コピーを実装する。** `fs.cp` は進捗を報告せず、除外規則・symlink 方針・`EPERM` フォールバックを制御できない。仕様が求める「進捗表示」「`.git` の条件付き除外」「symlink 保持とフォールバック」を満たすため、`readdir` + `copyFile` + `symlink` による並行数制限付きの非同期コピーとする（同期 API は使わない点は仕様どおり）。

## ディレクトリ構成

```text
web/src/lib/profiles/
  paths.ts          globalConfigLinkPath / profilesRoot / profilesStatePath / slug
  link.ts           リンク状態判定・準アトミック差替・ロールバック・temp 掃除
  registry.ts       ProfilesState の atomic read/write・初期登録・active 解決
  copy.ts           非同期再帰コピー（除外・symlink 方針・進捗・EPERM フォールバック）
  jobs.ts           プロセス内ジョブストア + 単一実行ロック
  service.ts        list / create / duplicate / migrate / activate / rename / unregister
  types.ts
  *.test.ts
web/src/app/api/profiles/
  route.ts                    GET 一覧 / POST 作成・複製
  migrate/route.ts            POST 移行
  jobs/[jobId]/route.ts       GET 進捗
  [id]/route.ts               PATCH 改名 / DELETE 一覧除外
  [id]/activate/route.ts      POST 切替
  *.test.ts
web/src/components/settings/
  ProfilesSettings.tsx
  ProfilesSettings.test.tsx
web/src/components/settings/SettingsView.tsx   （タブ追加のみ）
```

---

## Task 1: パス解決・リンク操作・レジストリ

**Files**

- Create: `web/src/lib/profiles/types.ts`
- Create: `web/src/lib/profiles/paths.ts`
- Create: `web/src/lib/profiles/link.ts`
- Create: `web/src/lib/profiles/registry.ts`
- Create: `web/src/lib/profiles/link.test.ts`
- Create: `web/src/lib/profiles/registry.test.ts`
- Create: `web/src/lib/profiles/paths.test.ts`

**手順**

- [ ] `globalConfigLinkPath()` を `os.homedir()/.config/opencode` 固定で実装する。`OPENCODE_CONFIG_DIR` を参照しない（既存 `opencodeConfigDir()` と役割を分ける）。
- [ ] `profilesRoot()` = `dataDir()/profiles`、`profilesStatePath()` = `dataDir()/profiles.json`。
- [ ] `toSlug(name)`: 使用可能文字へ正規化し、`..` / パス区切り / Windows 予約名（CON, PRN, AUX, NUL, COM1-9, LPT1-9）を拒否。空になる場合は `profile` にフォールバック。`resolveSlug()` で衝突時に `-2`, `-3` を付す。
- [ ] `readLinkState()`: `lstat` で `"link" | "realdir" | "missing"` を返し、`link` のとき `readlink` の解決先（絶対パス）を併せて返す。
- [ ] `isValidProfileDir()`: `opencode.jsonc` / `opencode.json` / `agents/` / `agent/` / `skills/` のいずれかを含むこと。
- [ ] `swapLink(nextTarget)`: temp junction 作成 → `fs.rmdirSync` で旧リンク削除 → rename の準アトミック手順。失敗時は temp 掃除 + 旧ターゲットへ再リンクしてロールバック。
- [ ] `cleanupStaleLinks()`: `~/.config/` 直下の `opencode.swap-*` と `profilesRoot()` 直下の `.default-migrating-*` を掃除する。
- [ ] レジストリを atomic write（temp + rename）で読み書きし、壊れた JSON は初期状態へフォールバックする。
- [ ] `resolveActive()`: 実リンクの解決先と各 `path` を大文字小文字無視で比較し、実リンクを正とする。`activeId` はキャッシュ扱い。
- [ ] 初回 `ensureRegistry()`: 現在のリンク先を `default`（`external: true`）として登録する。実体は移動しない。
- [ ] テスト: tmpdir 上に**実 junction** を作り、`swapLink` 後に**切替元の中身が残る**こと（最重要）、リンクのみ削除されること、ロールバックが働くこと、`realdir` / `missing` の判定、slug 生成と不正名拒否、atomic write を検証する。

**完了コミット:** `プロファイルのパス解決・リンク差替・レジストリを追加`

---

## Task 2: 非同期コピーとジョブ

**Files**

- Create: `web/src/lib/profiles/copy.ts`
- Create: `web/src/lib/profiles/jobs.ts`
- Create: `web/src/lib/profiles/copy.test.ts`
- Create: `web/src/lib/profiles/jobs.test.ts`

**手順**

- [ ] `countEntries(src, exclude)`: 事前走査で総数を数える（進捗の分母）。
- [ ] `copyTree(src, dest, { exclude, onProgress, signal })`: `readdir(withFileTypes)` による非同期再帰コピー。並行数を上限 8 程度に制限し、イベントループを占有しない。
- [ ] symlink は `readlink` + `symlink` で**リンクのまま複製**する。`EPERM` の場合のみ実体コピー（dereference）へフォールバックし、`note` に記録する。
- [ ] 除外規則を引数で受ける。移行は除外なし、複製は `.git` のみ除外（`node_modules` は複製する）。
- [ ] `verifyCopy()`: コピー数と総数の一致、`opencode.jsonc` の存在を検証する。
- [ ] ジョブストア: `Map<string, Job>`。`{ id, kind, state, copied, total, note, error, startedAt }`。同時に 1 ジョブのみ許可するロックを持つ。
- [ ] テスト: `.git` 除外・`node_modules` 複製、symlink がリンクのまま複製されること、`EPERM` 時の dereference フォールバック、進捗コールバックの単調増加、ジョブの状態遷移とロック競合。

**完了コミット:** `プロファイル複製の非同期コピーとジョブ管理を追加`

---

## Task 3: サービス層（統合・ガード）

**Files**

- Create: `web/src/lib/profiles/service.ts`
- Create: `web/src/lib/profiles/service.test.ts`

**手順**

- [ ] `listProfiles()`: レジストリ + 実リンクから `ProfileDto[]`（`active` / `exists`）、`linkState`、`canSwitch`、`reason`、`migration`（`needed` / `sourcePath` / `estimatedBytes`）を返す。
- [ ] `activate(id)`: 409 条件を判定してから `swapLink` する。条件は「`realdir`」「`OPENCODE_CONFIG_DIR` 設定中」「切替先が不在または不正」「他ジョブ実行中」。理由は日本語。
- [ ] `createProfile({ name, from })`: `empty` は同期作成（ディレクトリ + `opencode.jsonc` に `$schema` を書き出す）。複製元指定時はジョブを起動して `jobId` を返す。
- [ ] `migrateDefault()`: 事前検証（reparse point であること・コピー元が妥当・空き容量がコピー元 + 20% 以上）→ `.default-migrating-<rand>` へ全複製 → `verifyCopy` → `profiles/default` へ rename → `swapLink` → 旧エントリを「移行前バックアップ」として `external: true` のまま残す。
- [ ] 失敗時はコピー先 temp を破棄し、リンクを元のまま維持する。**コピー元は決して削除しない。**
- [ ] `renameProfile(id, name)`: レジストリの `name` のみ更新。ディレクトリは触らない。
- [ ] `unregisterProfile(id)`: レジストリから除外するのみ。active は拒否。**fs 操作を行わない。**
- [ ] テスト: 409 の各条件、移行の成功・失敗ロールバック、移行後もコピー元が残ること、rename がパスを変えないこと、unregister が実体を消さないこと、空き容量不足の拒否。

**完了コミット:** `プロファイルのサービス層とガード条件を追加`

---

## Task 4: API ルート

**Files**

- Create: `web/src/app/api/profiles/route.ts`
- Create: `web/src/app/api/profiles/migrate/route.ts`
- Create: `web/src/app/api/profiles/jobs/[jobId]/route.ts`
- Create: `web/src/app/api/profiles/[id]/route.ts`
- Create: `web/src/app/api/profiles/[id]/activate/route.ts`
- Create: `web/src/app/api/profiles/route.test.ts`
- Create: `web/src/app/api/profiles/[id]/activate/route.test.ts`

**手順**

- [ ] 全ルートで `runtime = "nodejs"` / `dynamic = "force-dynamic"` を設定し、先頭で `rejectUnlessLocal(req)` を適用する。
- [ ] 入力検証: `name` は必須・長さ上限・不正文字を拒否。`from` は `"empty"` または既存 ID のみ。未知 ID は 404。
- [ ] `activate` は service の 409 を HTTP 409 として理由付きで返す。
- [ ] ジョブ起動系は `202` + `{ jobId }` を返し、`GET /api/profiles/jobs/[jobId]` は未知 ID を 404 とする。
- [ ] エラーは利用者向け日本語メッセージへ変換する。
- [ ] テスト: `rejectUnlessLocal` ガード（非ローカルで 403）、入力検証、409 / 404 応答、ジョブ応答形状。service はモックする。

**完了コミット:** `プロファイル管理 API を追加`

---

## Task 5: UI 設計（ui-ux-designer）

**成果物:** 実装用のコンポーネント設計メモ（コード生成前の合意）

**手順**

- [ ] 一覧（表示名・実パス・`active` バッジ・`dataDir 外` バッジ）のデスクトップ表 / モバイルカードの二段構えを設計する。
- [ ] 移行カード（容量・所要時間・コピー元が消えない旨・実行ボタン）の情報設計。
- [ ] 進捗表示（`copied / total`）と操作ロック中の見せ方。
- [ ] 切替確認ダイアログ（OpenCode 再起動と進行中タスク中断の明示）。
- [ ] 一覧除外の確認（実体は削除されない旨の明示）。
- [ ] 切替不可バナー（409 理由）とホスト不通時の案内。
- [ ] 空状態・読込中・エラーの各状態、44px タップ領域、`aria-busy` / `aria-live` の指定。
- [ ] トークン参照（`DESIGN.md`）に従い色・spacing をハードコードしない。

---

## Task 6: UI 実装

**Files**

- Create: `web/src/components/settings/ProfilesSettings.tsx`
- Create: `web/src/components/settings/ProfilesSettings.test.tsx`
- Create: `web/src/lib/opencode-restart.ts`
- Create: `web/src/lib/opencode-restart.test.ts`
- Modify: `web/src/components/settings/SettingsView.tsx`

**手順**

- [ ] `opencode-restart.ts` に `restartOpencodeAndWait()` を切り出す（`/api/host/restart` → `/api/health` ポーリング）。既存 `SettingsView` / `AgentsSettings` は今回変更しない。
- [ ] `ProfilesSettings` を Task 5 の設計どおりに実装する。切替は `activate` → `restartOpencodeAndWait()` の順。
- [ ] 移行・複製はジョブ開始後 `GET /api/profiles/jobs/[jobId]` をポーリングし、完了で一覧を再取得する。
- [ ] `SettingsView` は `SettingsTab` union・タブ配列・描画分岐へ `profiles` を足すだけに留める（差分を最小化）。
- [ ] テスト: 一覧描画、移行カードの表示条件、進捗表示、切替の確認ダイアログと再起動呼び出し、409 バナー、ホスト不通時の案内、除外確認。

**完了コミット:** `設定画面にプロファイルタブを追加`

---

## Task 7: レビューと統合検証

**手順**

- [ ] ui-ux-reviewer で mobile / tablet / desktop の 3 viewport と各状態を確認し、指摘を修正する。
- [ ] `npx tsc --noEmit`、`npx eslint`、`npx vitest run` を web で通す。
- [ ] `git status --short` が空になるまで意味単位でコミットする。
- [ ] **実機での切替検証はユーザーに委ねる**（OpenCode 再起動を伴い、稼働中の WebUI に影響するため）。手順を報告に添える。

**完了コミット:** 指摘修正がある場合のみ

---

## 実装順序と並列化

```
Task 1 ──> Task 2 ──> Task 3 ──> Task 4 ──┐
                                          ├──> Task 6 ──> Task 7
Task 5（設計・Task 1 と並列で開始可）─────┘
```

- Task 1 と Task 5 は依存が無いため同一メッセージで並列起動する。
- Task 1〜4 と Task 6 は lead-programmer へ委任する（複数ファイル・モジュール横断のため）。
- Task 5 は ui-ux-designer、Task 7 のレビューは ui-ux-reviewer が担当する。
- Task 2 以降は前段の契約が確定してから着手する（リンク操作の安全性が全体の前提のため逐次）。

## 完了判定

- 仕様の受入条件 1〜13 をすべて満たす。
- `tsc` / `eslint` / `vitest` が通る。
- 切替・移行・複製・改名・除外のいずれの経路でも、**プロファイル実体を削除するコードパスが存在しない**。
- 未コミットの変更が無い。
