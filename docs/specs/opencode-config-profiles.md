# グローバル OpenCode 設定のプロファイル切替

## 目的

`~/.config/opencode`（グローバル設定ディレクトリ）の実体を複数用意し、設定画面から切り替えられるようにする。エージェント・スキル・プラグイン・`opencode.jsonc` を丸ごと入れ替えた「用途別の設定一式」を、再セットアップなしで往復できる状態にする。

## 前提（調査で確認した事実）

- `~/.config/opencode` は既にディレクトリ symlink（`SYMLINKD`）で、実体は `C:\Users\Daichi\OneDrive\AI\OpenCode\opencode`（git 管理下）。
- OpenCode にはグローバル設定ディレクトリを環境変数で完全に差し替える手段が無い。`OPENCODE_CONFIG_DIR` はグローバル設定の**上に乗る加算レイヤー**であり（[Config docs](https://opencode.ai/docs/config/) の precedence order）、「切替」には使えない。
- WebUI BFF の `opencodeConfigDir()`（`web/src/lib/opencode-extensions/paths.ts`）も、host の `spawnOpencode()`（`host/src/index.js`）も既定で `~/.config/opencode` を参照する。したがってリンク先を差し替えれば、**エンジン・WebUI・ターミナルの `opencode` すべてに一律反映**される。

## 対象と非対象

- 対象: プロファイルの一覧・切替・新規作成・複製・表示名変更。
- 非対象:
  - プロファイルの**削除**（実体ディレクトリの破棄を伴うため今回は実装しない）。
  - 既存 `default` プロファイルの dataDir への**移行**（後述の「配置方針」参照）。
  - プロファイル内部の設定編集（既存のエージェント/スキル/プラグイン各タブが担当）。
  - リモート/複数マシン間のプロファイル同期。

## 方式

### リンク差し替え

切替は `~/.config/opencode` の **reparse point（junction）を差し替える**ことで行う。junction を採用する理由は、ディレクトリ symlink と異なり管理者権限・開発者モードを必要とせず、トレイ host が通常ユーザー権限のまま操作できるため。

既存の relative な `SYMLINKD` は、初回切替時に absolute な junction へ変わる。OpenCode・Node のどちらから見ても透過的で機能は等価。

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

- **新規作成・複製したプロファイル**: `%APPDATA%\opencode-webui\profiles\<slug>\`（`dataDir()/profiles`）。OneDrive 同期の競合を避けるため同期対象外に置く。
- **既存の `default`**: 現在のパス（OneDrive 配下の git リポジトリ）のまま**移動せず**レジストリに登録する。稼働中の設定リポジトリを移動する操作は不可逆性が高く、OneDrive 同期と git 運用を壊すため自動では行わない。結果として `default` のみ配置が異なるが、UI で各プロファイルの実パスを常に表示して補う。

## データモデル

レジストリを `%APPDATA%\opencode-webui\profiles.json` に置く（既存 `opencode-extensions.json` と同じ dataDir 方式、atomic write）。

```ts
type Profile = {
  id: string;    // 安定 ID（生成後不変）
  name: string;  // 表示ラベル（変更可能）
  path: string;  // 絶対パス（生成後不変）
};

type ProfilesState = {
  profiles: Profile[];
  activeId: string | null;
};
```

- **表示ラベルと実ディレクトリ名は分離する。** 名前変更は `name` のみを更新し、ディレクトリは移動・改名しない。稼働中プロファイルのディレクトリ改名によるリンク破壊を構造的に防ぐため。
- **active の判定はレジストリではなく実リンクを正とする。** `fs.readlink(~/.config/opencode)` の解決結果を各 `path` と正規化比較（Windows のため大文字小文字を無視）する。`activeId` はキャッシュに過ぎず、不一致時は実リンクを優先する。
- 初回起動時に `~/.config/opencode` の現在のターゲットを `default` として登録する（実体の移動なし）。
- 初期化時に `~/.config/` 直下の残留 `opencode.swap-*` を掃除する。

## API

すべて `rejectUnlessLocal`（ホストマシン専用）で保護する。グローバル設定リンクを操作する破壊的性質があるため、再起動 API より厳しくし LAN からは実行させない。

- `GET /api/profiles`
  - 応答: `{ profiles: ProfileDto[], activeId: string | null, linkState: "junction" | "symlink" | "realdir" | "missing", canSwitch: boolean, reason?: string }`
  - `ProfileDto` は `Profile` に `active: boolean` と `exists: boolean` を加えたもの。
- `POST /api/profiles`
  - 本文: `{ name: string, from: "empty" | <profileId> }`
  - `empty`: ディレクトリを作成し `opencode.jsonc`（`{ "$schema": "https://opencode.ai/config.json" }`）を書き出す。
  - `<profileId>`: 複製。`node_modules` と `.git` を除外してコピーする。`.git` を除外するのは、複製が元の設定リポジトリと同じ remote を持ち、誤って push される事故を防ぐため。
  - 生成先は常に `dataDir()/profiles/<slug>`。slug 衝突時は `-2`, `-3` を付す。
- `PATCH /api/profiles/[id]`
  - 本文: `{ name: string }` — 表示ラベルのみ変更。
- `POST /api/profiles/[id]/activate`
  - リンクを差し替える。OpenCode の再起動は行わず、呼び出し側（UI）が既存の `/api/host/restart` を続けて呼ぶ。

### 切替を拒否する条件

次の場合 `activate` は 409 を返し、理由を日本語で説明する。

- `~/.config/opencode` が reparse point ではなく**実体ディレクトリ**のとき。ユーザーデータの移動を伴うため自動変換しない。
- `OPENCODE_CONFIG_DIR` 環境変数が設定されているとき。リンクを差し替えても解決先が変わらず、切替が無効になるため。
- 切替先ディレクトリが存在しない、または設定ディレクトリとして妥当でないとき。
- 別の切替処理が進行中のとき（プロセス内ロック）。

## 画面

設定画面に「プロファイル」タブを追加する（`SettingsView` の `SettingsTab` union・タブ配列・描画分岐に追加）。

- プロファイルを一覧表示し、各行に表示名・実パス・`active` バッジを出す。デスクトップはテーブル、モバイルはカード（既存 `AgentsSettings` と同じ二段構え）。
- 「切替」操作は確認を挟む。確認ダイアログには、**OpenCode が再起動され進行中のタスクが中断されること**を明記する。
- 切替の流れ: `activate` → `/api/host/restart`（`target: "opencode"`）→ `/api/health` を `opencode.ok` になるまでポーリング。既存の再起動フローと同じ待機・タイムアウト表現を使う。
- 新規作成は「空」「既存の複製」を選択でき、複製時は `node_modules` と `.git` が除外される旨を明示する。
- 表示名の変更がディレクトリ名を変えないことを UI 上で示す（実パスを併記する）。
- 切替不可のとき（上記 409 条件）は理由バナーを表示し、切替ボタンを無効化する。
- ホストが利用できない場合は、切替後に手動で OpenCode を再起動する必要がある旨を表示する。
- 操作中の行は `aria-busy` と非活性にし、エラーは日本語で当該行に表示する。

## 安全性

- リンク削除は `fs.rmdirSync()` のみを使い、`recursive` 付き削除をリンクへ適用しない。実測でターゲット実体が保持されることを確認済み。
- 切替対象は**登録済みプロファイル ID** に限定し、クライアントから任意の絶対パスを受け取らない。
- 生成・複製先は必ず `dataDir()/profiles` 配下へ解決されることを検証する（`..` やパス区切りを含む名前、Windows 予約名を拒否）。
- 操作するリンクのパスは常に `~/.config/opencode` に固定する。`OPENCODE_CONFIG_DIR` を尊重する既存の `opencodeConfigDir()` とは別関数 `globalConfigLinkPath()` を用意し、env 上書き時に誤ったパスを差し替えないようにする。
- レジストリは秘密情報を持たない（表示名とパスのみ）。
- 切替は WebUI・エンジン・ターミナルの `opencode` すべてに影響する。UI でその旨を明記する。

## 受入条件

1. 設定画面に「プロファイル」タブがあり、現在の `default` が active として実パス付きで表示される。
2. 新規プロファイルを「空」から作成でき、`dataDir()/profiles/<slug>` に `opencode.jsonc` が生成される。
3. 既存プロファイルを複製でき、`node_modules` と `.git` が複製先に含まれない。
4. 切替を実行すると `~/.config/opencode` のリンク先が変わり、**切替元プロファイルの実体は一切失われない**。
5. 切替後に OpenCode が自動で再起動し、ヘルス確認の完了が UI に反映される。
6. 表示名を変更してもディレクトリのパスは変わらず、リンクも壊れない。
7. `~/.config/opencode` が実体ディレクトリの場合、または `OPENCODE_CONFIG_DIR` 設定時は、切替が拒否され理由が表示される。
8. 切替確認ダイアログで、OpenCode 再起動と進行中タスク中断が事前に伝わる。
9. 操作中・エラー・切替不可の各状態が画面と支援技術に明確に伝わる。

## テスト

- `web/src/lib/profiles.test.ts`（vitest, tmpdir 上の実 junction）
  - 差し替え後に**切替元ディレクトリの中身が残る**こと（データ損失の回帰防止。最重要）。
  - リンクのみ削除されること、ロールバックが働くこと。
  - 実体ディレクトリ・`OPENCODE_CONFIG_DIR` 設定時に拒否されること。
  - slug 生成・衝突回避・不正名の拒否、レジストリの atomic write。
  - 複製で `node_modules` / `.git` が除外されること。
- API route テスト: 入力検証、`rejectUnlessLocal` ガード、409 条件。
- `ProfilesSettings.test.tsx`: 一覧描画、切替の確認ダイアログ、再起動呼び出し、エラー・切替不可表示。

## 検証手順

`tsc` / `eslint` / `vitest`（web）で検証する。`next build`・dev サーバー・常駐プロセスの起動は行わない（`AGENTS.md` の禁止事項）。
