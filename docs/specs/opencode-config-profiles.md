# グローバル OpenCode 設定のプロファイル切替

> 実装ステータス: ✅ 実装済み（参照: `web/src/lib/profiles/` / `web/src/components/settings/ProfilesSettings.tsx`）

## 目的

`~/.config/opencode`（グローバル設定ディレクトリ）の実体を複数用意し、設定画面から切り替えられるようにする。エージェント・スキル・プラグイン・`opencode.jsonc` を丸ごと入れ替えた「用途別の設定一式」を、再セットアップなしで往復できる状態にする。

## 前提（実測で確認した事実）

- `~/.config/opencode` は既にディレクトリ symlink（`SYMLINKD`）で、実体は `C:\Users\Daichi\OneDrive\AI\OpenCode\opencode`（git 管理下）。
- OpenCode にはグローバル設定ディレクトリを環境変数で完全に差し替える手段が無い。`OPENCODE_CONFIG_DIR` はグローバル設定の**上に乗る加算レイヤー**であり（[Config docs](https://opencode.ai/docs/config/) の precedence order）、「切替」には使えない。
- WebUI BFF の `opencodeConfigDir()`（`web/src/lib/opencode-extensions/paths.ts`）も、host の `spawnOpencode()`（`host/src/index.js`）も既定で `~/.config/opencode` を参照する。したがってリンク先を差し替えれば、**エンジン・WebUI・ターミナルの `opencode` すべてに一律反映**される。

### 現行設定ディレクトリの実測値

| 項目 | 値 |
| --- | --- |
| 合計 | 249.8 MB / 17,731 ファイル |
| `node_modules` | 116.1 MB / 10,860 ファイル |
| `.git` | 23.7 MB / 5,110 ファイル |
| `skills` | 35.5 MB / 809 ファイル |
| OneDrive のクラウド専用（未実体化）ファイル | 0 件 |
| C ドライブ空き | 約 1,428 GB |

- 全ファイルがローカル実体化済みのため、コピー時に OneDrive のダウンロードは発生しない。
- OneDrive のクラウド placeholder は reparse tag を持つが、Node の `lstat().isSymbolicLink()` は false を返す（実測）。したがって reparse point 判定ロジックは誤検出しない。

### `node_modules` の内部リンク（重要）

`package.json` は `@opencode-ai/plugin` / `jsonc-parser` / `yaml` などの実行時依存と、`file:` 参照のローカルパッケージ 4 件（`model-fallback`・`subagent-guard`・`cursor-acp`・`aa-cursor-model-guard`）を持つ。

- **新規プロファイル作成時は `package.json` / `node_modules` を配置しない設計**（完全自立フォーク）。3つの vendor プラグイン（cursor-cli-proxy / claude-cli-proxy / commandcode-cli-proxy）は全て npm 依存をインライン化済みで、Node.js 標準モジュールのみで動作する。
- 既存プロファイルの `node_modules` 内部リンクは **symlink** で、ターゲットは実体パスではなく **`C:\Users\Daichi\.config\opencode\packages\<name>`**、すなわち**切替リンク経由の絶対パス**。
- このため各プロファイルの `node_modules` 内リンクは、**常にその時点でアクティブなプロファイルの `packages/` へ解決される**。コピーしても壊れず、切替に対して自己修復的に働く。
- プラグインはこれらの依存を読み込むため、**`node_modules` を除外したプロファイルはプラグインが動作しない**。コピー対象に含める。
- 本機は Developer Mode 有効・管理者権限なしで `dir` / `file` / `junction` すべての symlink 作成に成功する（実測）。

## 対象と非対象

- 対象: プロファイルの一覧・切替・新規作成・複製・表示名変更、および既存 `default` の dataDir への移行。
- 非対象:
  - プロファイル実体ディレクトリの**削除**（一覧からの除外は行うが、ファイルは消さない）。
  - プロファイル内部の設定編集（既存のエージェント/スキル/プラグイン各タブが担当）。
  - リモート/複数マシン間のプロファイル同期。

## 方式

### リンク差し替え

切替は `~/.config/opencode` の **reparse point（junction）を差し替える**ことで行う。junction を採用する理由は、ディレクトリ symlink と異なり管理者権限・開発者モードを必要とせず、トレイ host が通常ユーザー権限のまま操作できるため。

既存の relative な `SYMLINKD` は、初回切替時に absolute な junction へ変わる。OpenCode・Node のどちらから見ても透過的で機能は等価。`node_modules` 内の `~/.config/opencode/packages/*` 参照も junction 経由で従来どおり解決される。

### 差し替え手順（準アトミック）

1. 切替先ディレクトリの存在と妥当性を検証する（`opencode.jsonc` / `opencode.json` / `agents/` / `agent/` / `skills/` のいずれかを含むこと）。
2. `~/.config/opencode.swap-<rand>` を切替先へ junction として作成する。
3. 既存リンクを `fs.rmdirSync()` で削除する（**リンクのみ**を消す。`fs.rmSync(..., { recursive: true })` は使用禁止）。
4. temp junction を `~/.config/opencode` へ `fs.renameSync()` する。
5. 途中で失敗した場合は temp を掃除し、直前のターゲットへ junction を再作成してロールバックする。

この手順は temp dir 上の実測スパイクで次を確認済み。

| 検証項目 | 結果 |
| --- | --- |
| 管理者権限なしで junction 作成 | 可 |
| `readlink` でターゲット解決 | 可 |
| `rmdirSync(link)` がリンクのみ削除しターゲット実体は無傷 | 確認 |
| temp junction → rmdir → rename の差替と旧ターゲットの無傷性 | 確認 |
| 実体ディレクトリと reparse point の判別（`lstat().isSymbolicLink()`） | 可 |
| `statSync` が junction を辿る | 可 |

### 配置方針

**すべてのプロファイルを `%APPDATA%\leafcode\profiles\<slug>\`（`dataDir()/profiles`）に集約する。** OneDrive 同期下は競合・上書きの温床であり、設定一式の実体を同期対象外へ置く。

既存 `default`（OneDrive 配下）は後述の移行機能で dataDir へ複製し、リンクを新しい実体へ向け替える。

### `default` の dataDir 移行

移行はユーザーが明示的に実行する操作とし、自動実行しない（250 MB / 17,731 ファイルの複製を伴うため）。

1. 事前検証: リンクが reparse point であること、コピー元が妥当な設定ディレクトリであること、空き容量がコピー元サイズ + 20% 以上あること。
2. `dataDir()/profiles/.default-migrating-<rand>` へ**全内容を複製**する（`.git`・`node_modules` を含む完全複製）。
   - `.git` を保持するのは、これが同一リポジトリの**移設**であり履歴を失わせないため。
   - `node_modules` を保持するのはプラグインの実行時依存を壊さないため。
3. 複製の完全性を検証する（ファイル数の一致、`opencode.jsonc` と `packages/` の存在）。
4. `profiles/default` へ rename する。
5. リンクを `profiles/default` へ差し替える（前節の準アトミック手順）。
6. **コピー元（OneDrive 配下）は削除しない。** レジストリ上は「移行前バックアップ」として残し、切替による即時ロールバックを可能にする。動作確認後にユーザーが一覧から除外でき、その時点で全プロファイルが dataDir に揃う。

### コピーの symlink 方針

複製は `fs.promises.cp` に `dereference: false` を指定し、**symlink を symlink のまま複製**する。`node_modules` の `file:` 依存リンクが持つ自己修復性（アクティブなプロファイルの `packages/` を指す）を維持するため。

symlink 作成が `EPERM` で失敗する環境では `dereference: true` へフォールバックし、実体を複製したうえでジョブ結果にその旨を記録する。

### 非同期ジョブ

複製は 17,731 ファイル規模になり、同期実行すると BFF のイベントループを長時間占有して SSE・ヘルスチェックを巻き込んで停止させる。したがって複製を伴う操作（新規作成の複製元指定・移行）は**非同期ジョブ**として実行し、UI は進捗をポーリングする。

- ジョブはプロセス内メモリに保持する（`{ id, kind, state, copied, total, error, note }`）。
- `fs.promises.cp` を用い、同期版 `fs.cpSync` は使用しない。
- WebUI 再起動でジョブ情報は失われるが、ファイル操作自体は temp 名で行い rename で確定するため、中断しても不完全なプロファイルは公開されない。残存 temp は初期化時に掃除する。

## データモデル

レジストリを `%APPDATA%\leafcode\profiles.json` に置く（既存 `opencode-extensions.json` と同じ dataDir 方式、atomic write）。

```ts
type Profile = {
  id: string;        // 安定 ID（生成後不変）
  name: string;      // 表示ラベル（変更可能）
  path: string;      // 絶対パス（生成後不変）
  external?: true;   // dataDir/profiles の外にある（移行前バックアップ等）
};

type ProfilesState = {
  profiles: Profile[];
  activeId: string | null;
};
```

- **表示ラベルと実ディレクトリ名は分離する。** 名前変更は `name` のみを更新し、ディレクトリは移動・改名しない。稼働中プロファイルのディレクトリ改名によるリンク破壊を構造的に防ぐため。
- **active の判定はレジストリではなく実リンクを正とする。** `fs.readlink(~/.config/opencode)` の解決結果を各 `path` と正規化比較（Windows のため大文字小文字を無視）する。`activeId` はキャッシュに過ぎず、不一致時は実リンクを優先する。
- 初回起動時に `~/.config/opencode` の現在のターゲットを `default` として登録する（実体の移動なし。`external: true`）。
- 初期化時に `~/.config/` 直下の残留 `opencode.swap-*` と `profiles/.default-migrating-*` を掃除する。

## API

すべて `rejectUnlessLocal`（ホストマシン専用）で保護する。グローバル設定リンクを操作する破壊的性質があるため、再起動 API より厳しくし LAN からは実行させない。

- `GET /api/profiles`
  - 応答: `{ profiles: ProfileDto[], activeId: string | null, linkState: "junction" | "symlink" | "realdir" | "missing", canSwitch: boolean, reason?: string, migration?: { needed: boolean, sourcePath: string, estimatedBytes: number } }`
  - `ProfileDto` は `Profile` に `active: boolean` と `exists: boolean` を加えたもの。
- `POST /api/profiles`
  - 本文: `{ name: string, from: "empty" | <profileId> }`
  - `empty`: ディレクトリを作成し `opencode.jsonc`（`{ "$schema": "https://opencode.ai/config.json" }`）を書き出す。同期完了で応答。
  - `<profileId>`: 複製。`node_modules` は**含める**（プラグインの実行時依存）。`.git` は**除外する**（複製が元リポジトリと同じ remote を持ち誤って push される事故を防ぐため。移行と異なり複製は別リポジトリ扱い）。非同期ジョブとして実行し `{ jobId }` を返す。
  - 生成先は常に `dataDir()/profiles/<slug>`。slug 衝突時は `-2`, `-3` を付す。
- `POST /api/profiles/migrate`
  - 本文 `{ mode?: "copy" | "move" }`。`default` を dataDir へ移行する。既定の `copy` はコピー元をバックアップとして残し、`move` はリンク切替成功後にコピー元を削除する。リンクがまだ無い実体ディレクトリも移行対象とし、元のパスを退避または削除して junction に置換する。非同期ジョブとして `{ jobId }` を返す。
- `GET /api/profiles/jobs/[jobId]`
  - 応答: `{ state: "running" | "done" | "error", copied: number, total: number, note?: string, error?: string }`
- `PATCH /api/profiles/[id]`
  - 本文: `{ name: string }` — 表示ラベルのみ変更。
- `POST /api/profiles/[id]/activate`
  - リンクを差し替える。OpenCode の再起動は行わず、呼び出し側（UI）が既存の `/api/host/restart` を続けて呼ぶ。
- `DELETE /api/profiles/[id]`
  - **レジストリからの除外のみ**。実体ディレクトリは一切削除しない。アクティブなプロファイルは除外できない。

### 切替を拒否する条件

次の場合 `activate` は 409 を返し、理由を日本語で説明する。

- `~/.config/opencode` が reparse point ではなく**実体ディレクトリ**のとき。ユーザーデータの移動を伴うため自動変換しない。
- `OPENCODE_CONFIG_DIR` 環境変数が設定されているとき。リンクを差し替えても解決先が変わらず、切替が無効になるため。
- 切替先ディレクトリが存在しない、または設定ディレクトリとして妥当でないとき。
- 別の切替処理・ジョブが進行中のとき（プロセス内ロック）。

## 画面

設定画面に「プロファイル」タブを追加する（`SettingsView` の `SettingsTab` union・タブ配列・描画分岐に追加）。

- プロファイルを一覧表示し、各行に表示名・実パス・`active` バッジを出す。`external` なプロファイルには「dataDir 外」バッジを付ける。デスクトップはテーブル、モバイルはカード（既存 `AgentsSettings` と同じ二段構え）。
- `default` が dataDir 外にある間は上部に**移行カード**を表示する。コピー容量（約 250 MB）と所要時間、既定ではコピー元が削除されないことを明記し、「元のプロファイルを削除して移動する」オプションと実行ボタンを置く。
- 移行・複製の進行中は進捗（`copied / total`）を表示し、他の操作を無効化する。
- 「切替」操作は確認を挟む。確認ダイアログには、**OpenCode が再起動され進行中のタスクが中断されること**を明記する。
- 切替の流れ: `activate` → `/api/host/restart`（`target: "opencode"`）→ `/api/health` を `opencode.ok` になるまでポーリング。既存の再起動フローと同じ待機・タイムアウト表現を使う。
- 新規作成は「空」「既存の複製」を選択でき、複製時は `.git` が除外され `node_modules` は複製される旨を明示する。
- 一覧からの除外は「実体ファイルは削除されない」ことを明示したうえで確認を挟む。
- 表示名の変更がディレクトリ名を変えないことを UI 上で示す（実パスを併記する）。
- 切替不可のとき（上記 409 条件）は理由バナーを表示し、切替ボタンを無効化する。
- ホストが利用できない場合は、切替後に手動で OpenCode を再起動する必要がある旨を表示する。
- 操作中の行は `aria-busy` と非活性にし、エラーは日本語で当該行に表示する。

## 安全性

- リンク削除は `fs.rmdirSync()` のみを使い、`recursive` 付き削除をリンクへ適用しない。実測でターゲット実体が保持されることを確認済み。
- **実体ディレクトリを削除する API を持たない。** 一覧からの除外はレジストリ操作のみ。
- 切替対象は**登録済みプロファイル ID** に限定し、クライアントから任意の絶対パスを受け取らない。
- 生成・複製先は必ず `dataDir()/profiles` 配下へ解決されることを検証する（`..` やパス区切りを含む名前、Windows 予約名を拒否）。
- 操作するリンクのパスは常に `~/.config/opencode` に固定する。`OPENCODE_CONFIG_DIR` を尊重する既存の `opencodeConfigDir()` とは別関数 `globalConfigLinkPath()` を用意し、env 上書き時に誤ったパスを差し替えないようにする。
- 移行はコピー元を残す非破壊操作とし、失敗時は temp を破棄してリンクを元のまま維持する。
- 複製は temp 名で作成し、完全性検証後に rename で確定する。中断された複製が一覧へ現れない。
- レジストリは秘密情報を持たない（表示名とパスのみ）。
- 切替は WebUI・エンジン・ターミナルの `opencode` すべてに影響する。UI でその旨を明記する。

## 受入条件

1. 設定画面に「プロファイル」タブがあり、現在の `default` が active として実パス付きで表示される。
2. `default` が dataDir 外にある間は移行カードが表示され、実行すると `%APPDATA%\leafcode\profiles\default` へ全内容（`.git`・`node_modules` を含む）が複製され、リンクがそちらへ向く。
3. 移行後もコピー元（OneDrive 配下）は削除されず、「移行前バックアップ」として一覧に残り、切替で元に戻せる。
4. 移行前バックアップを一覧から除外でき、**実体ディレクトリは削除されない**。除外後は全プロファイルが dataDir 配下に揃う。
5. 新規プロファイルを「空」から作成でき、`dataDir()/profiles/<slug>` に `opencode.jsonc` が生成される。
6. 既存プロファイルを複製でき、`node_modules` は複製され `.git` は複製されない。
7. 切替を実行すると `~/.config/opencode` のリンク先が変わり、**切替元プロファイルの実体は一切失われない**。
8. 切替後に OpenCode が自動で再起動し、ヘルス確認の完了が UI に反映される。
9. 複製・移行の進行中は進捗が表示され、BFF のヘルスチェックが停止しない。
10. 表示名を変更してもディレクトリのパスは変わらず、リンクも壊れない。
11. `~/.config/opencode` が実体ディレクトリの場合、または `OPENCODE_CONFIG_DIR` 設定時は、切替が拒否され理由が表示される。
12. 切替確認ダイアログで、OpenCode 再起動と進行中タスク中断が事前に伝わる。
13. 操作中・エラー・切替不可の各状態が画面と支援技術に明確に伝わる。

## テスト

- `web/src/lib/profiles.test.ts`（vitest, tmpdir 上の実 junction）
  - 差し替え後に**切替元ディレクトリの中身が残る**こと（データ損失の回帰防止。最重要）。
  - リンクのみ削除されること、ロールバックが働くこと。
  - 実体ディレクトリ・`OPENCODE_CONFIG_DIR` 設定時に拒否されること。
  - slug 生成・衝突回避・不正名の拒否、レジストリの atomic write。
  - 複製で `node_modules` が複製され `.git` が除外されること。
  - 複製が symlink を symlink のまま保持すること、`EPERM` 時に dereference へフォールバックすること。
  - 中断された複製（temp 名）が一覧へ現れず、初期化時に掃除されること。
  - 一覧からの除外が実体ディレクトリを削除しないこと。
- API route テスト: 入力検証、`rejectUnlessLocal` ガード、409 条件、ジョブ応答形状。
- `ProfilesSettings.test.tsx`: 一覧描画、移行カード、進捗表示、切替の確認ダイアログ、再起動呼び出し、エラー・切替不可表示。

## 検証手順

`tsc` / `eslint` / `vitest`（web）で検証する。`next build`・dev サーバー・常駐プロセスの起動は行わない（`AGENTS.md` の禁止事項）。
