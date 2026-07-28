# setup.bat が文字化け／エンコードで実行できない問題の恒久対策

> **追記（統合後）**: 本ファイルが対象としていた `setup.bat` は、`docs/specs/setup-start-webui-merge.md` に基づき
> `start-webui.bat` へ統合されて削除されました。本文中の `setup.bat` への言及は当時の事故記録・調査ログとして
> そのまま残しています。現在のASCII/CRLF制約や日本語メッセージ分離の方針は `start-webui.bat` にも同様に適用されており、
> 回帰は引き続き `host/src/bat-encoding.test.js` と `npm run test:encoding` が担保します。

## 背景・問題

`setup.bat` をダブルクリックしても正常に完走せず、「文字化けした行が `'...' は、内部コマンドまたは外部コマンド...として認識されていません。` と表示される」「メッセージが出ない」という報告が多発している。

原因は**`.bat` ファイル本体に非 ASCII バイト（日本語）が含まれていること**。cmd.exe はバッチファイルをコードページ変換しながら 1 行ずつ読み進めるが、読み取り位置の管理がバイト数と変換後の文字数でずれるため、**マルチバイト文字を含む行の直後から行の途中に飛び込んで実行する**。結果として意味のない断片がコマンドとして実行され、正しい行がスキップされる。

事故当時のファイル状態（計測値・修正前）:

| ファイル | 非 ASCII バイト数 | 備考 |
| --- | ---: | --- |
| `setup.bat` | 1842 | UTF-8 (BOM なし)。2 行目に `chcp 65001` |
| `start-webui.bat` | 105 | `rem` コメント内のみ。`chcp` なし |
| `build.bat` | 0 | 正常 |
| `scripts/*.bat` | 0 | 正常 |

**現状（修正後）:** 追跡対象の全 `*.bat` / `*.cmd` は非 ASCII 0・BOM なし・CRLF。日本語は `scripts/setup-messages/*.txt`。回帰は `host/src/bat-encoding.test.js` と `npm run test:encoding` が担保する。

### 実機再現結果

`setup.bat` と同じ構造（`chcp 65001` → ラベル → 日本語 `echo` → `call :fail 1 "日本語" "日本語"`）の再現用 bat を、起動時コードページを変えて実行した結果:

| 起動 CP | 結果 |
| --- | --- |
| 932 | 全面崩壊。`'�征E��受け' は、内部コマンドまたは...` 等が 6 回。`echo` の大半が消失 |
| 437 | `'1' is not recognized...`。前半の出力が消失 |
| 850 | 日本語行の一部が未認識コマンドとして実行される |
| 65001 | `'インストーラー」を導入してください。"' is not recognized...` 等が 6 回 |
| 1252 | 同様に 6 回の未認識コマンドエラー |

**どのコードページでも壊れる。** `chcp 65001` を先頭に置いても解決しない（むしろ 65001 でも読み取り位置がずれる）。

さらに `rem` コメントだけでも壊れることを確認した（`start-webui.bat` と同じパターン）:

| 起動 CP | 結果 |
| --- | --- |
| 932 | `rem` 行の断片が 2 回コマンド実行され、直前の `echo A` も消失 |
| 437 | `rem` 行の断片が 1 回コマンド実行される |
| 65001 | `rem` 行の断片が 2 回コマンド実行される |

つまり `start-webui.bat`（＝2 回目以降の通常起動経路、かつ `setup.bat` が最後に起動する対象）も同じ欠陥を持つ。

### 検証済みの解決パターン

**bat 本体を ASCII のみにし、日本語は別ファイルに置いて `type` で出力する。** `type` の対象ファイルは cmd.exe のパーサを通らないため崩れない。

ASCII のみの bat（`chcp 65001` → `type` で UTF-8 メッセージファイルを出力 → 元の CP へ復帰）を起動 CP 932 / 437 / 65001 / 1252 で実行したところ、**4 パターンすべてでバイト単位に同一（368 bytes）の正しい UTF-8 日本語出力**になり、未認識コマンドエラーは 0 件だった。

## 対象と非対象

- 対象:
  - `setup.bat` / `start-webui.bat` の非 ASCII 除去
  - 日本語メッセージの外部ファイル化と出力機構
  - 改行コード・エンコードの固定（`.gitattributes`）
  - 回帰防止テスト、README・AGENTS.md の追記
- 非対象:
  - `setup.bat` のインストール手順・終了コード体系（1〜8）の変更。**終了コードと分岐ロジックは現状維持**
  - PowerShell / Node への全面書き換え（初回セットアップ経路の回帰リスクが大きい）
  - `build.bat` / `scripts/*.bat` の文言変更（既に ASCII のため対象外。テストの検査対象には含める）
  - 英語 UI へのローカライズ機構の一般化（今回は日本語 1 言語のみ）

## 方式

### 1. すべての `.bat` を ASCII のみにする

追跡対象の `*.bat` / `*.cmd` は次を満たす。

- 全バイトが `0x00`–`0x7F`
- BOM なし
- 改行は CRLF のみ（LF 単独を含まない）
- 末尾に改行あり

### 2. 日本語メッセージを `scripts/setup-messages/*.txt` へ外部化

- エンコード: UTF-8 (BOM なし)、CRLF
- 1 ファイル 1 メッセージキー。原因と復旧案内を同一ファイルに収める
- 各行は `[Setup] ` 始まりにして bat の `echo` と同じ見た目にする

キー一覧:

| キー | 用途 |
| --- | --- |
| `success` | 完了メッセージ、トレイ未表示時の案内 |
| `failure` | 失敗時の締め（終了コードは ASCII 行で別途表示） |
| `guard-stopped` | ビルドのため稼働中 WebUI を停止した旨 |
| `error-1` | winget なし |
| `error-2` | Node.js 導入失敗 |
| `error-3` | Node.js の PATH 未反映 |
| `error-4-install` | OpenCode 導入失敗 |
| `error-4-path` | OpenCode の PATH 未反映 |
| `error-5` | web 依存関係の導入失敗 |
| `error-6` | web ビルド失敗 |
| `error-6-guard` | 稼働中 WebUI を停止できずビルド中止 |
| `error-7` | ビルド後に `BUILD_ID` がない |
| `error-8` | host 依存関係の導入失敗 |

### 3. `setup.bat` の出力方式

**英語 ASCII 行を必ず先に出し、その直後に日本語詳細を `type` で出す**二段構成にする。フォント・コードページ・メッセージファイル欠落のいずれで日本語が読めなくても、ASCII 行とエラーコードだけで原因が判別できる（graceful degradation）。

```bat
:say
if not exist "%~dp0scripts\setup-messages\%~1.txt" exit /b 0
type "%~dp0scripts\setup-messages\%~1.txt"
exit /b 0
```

- メッセージファイルが無い場合は黙って何もしない（英語行のみで継続。セットアップは失敗させない）
- `:fail` は従来どおり `code` を受け取り、`[Setup] ERROR <code>: <english summary>` を `echo` した後に `call :say error-<key>` する
- 失敗時の締めは `[Setup] FAILED (exit code: N)` を ASCII で出し、日本語は変数展開を含まない `failure.txt` を `type` する

### 4. コードページの扱い

- bat が ASCII のみになるため `chcp 65001` は安全になる。`type` の UTF-8 出力を正しく表示するために先頭で設定する
- 実行前のコードページを保存し、終了時（成功・失敗どちらも）に復帰させる。既存のコマンドプロンプトから実行された場合に利用者の環境を変えない

```bat
set "SETUP_CP_ORIGINAL="
for /f "tokens=2 delims=:" %%C in ('chcp 2^>nul') do for /f "tokens=1" %%D in ("%%C") do set "SETUP_CP_ORIGINAL=%%D"
```

- `chcp` の出力は日本語環境で「現在のコード ページ: 932」、英語環境で「Active code page: 65001」。いずれもコロン以降の第 1 トークンが数値になるため同じ解析で扱える
- 復帰は `chcp %SETUP_CP_ORIGINAL% >nul 2>&1` とし、失敗しても終了コードに影響させない（復帰前に終了コードを変数へ退避する）
- `chcp` 実行後に `%~dp0` を使うため、リポジトリパスに日本語が含まれていてもメッセージファイルのパス解決は失われない

### 5. `start-webui.bat`

`rem` コメント 2 行の日本語を英語に置き換えるのみ（出力文言は既に全て英語）。`chcp` は追加しない。

### 6. `.gitattributes` を追加

`.bat` が LF 単独でチェックアウトされるとラベル・`goto` が壊れるため、改行を固定する。

```
*.bat text eol=crlf
*.cmd text eol=crlf
scripts/setup-messages/*.txt text eol=crlf
```

既存ファイルへの一括正規化は行わない（上記パターン以外の差分を作らない）。

## テスト

`host` の `npm test`（`node --test src/*.test.js`）で検証する。

1. `host/src/bat-encoding.test.js`
   - tracked / on-disk の全 `*.bat` / `*.cmd` が「非 ASCII バイト 0 件・BOM なし・LF 単独なし・末尾 CRLF」を満たす
   - `scripts/setup-messages/*.txt` が「妥当な UTF-8・BOM なし・CRLF」を満たす
   - `setup.bat` の `call :say <key>` の全キーにファイルが存在し、逆に未参照のメッセージファイルが無い
   - README / 本仕様の ` ```bat ` フェンスが ASCII のみ
   - `git archive` 展開物でも bat / messages が同契約を満たす（GitHub ZIP 配布向け）
   - `quickaccess.ts` が PowerShell に UTF-8 stdout を強制している
2. `host/src/setup-bat.test.js`（既存を拡張）
   - サンドボックスへ `scripts/setup-messages/` をコピーする
   - `run()` に起動コードページ指定を追加し、**CP 932 / 437 / 65001 で成功パスを実行**して次を確認する
     - 標準出力に「セットアップが完了しました」が UTF-8 として正しく含まれる
     - `is not recognized` / `認識されていません` が出力に含まれない
     - 終了コード 0
   - メッセージファイルを削除した状態でも成功パスが終了コード 0 で完走し、ASCII 行が出ることを確認する
   - 既存の日本語文言アサーション（失敗ケース 9 種、guard 停止）は文言を維持したまま通ること
3. 既存の `host` テスト全件が通ること

常駐プロセス（`next dev` / `next start`）は起動しない。既存テストは `where` / `winget` / `node` / `npm` / `opencode` をモックした sandbox で完結する。

## 受入条件

1. 追跡対象の `*.bat` / `*.cmd` に非 ASCII バイトが 1 つも存在しない
2. `setup.bat` を CP 932 / 437 / 65001 で実行しても、未認識コマンドエラーが 0 件で、日本語メッセージが文字化けせずに表示される
3. `setup.bat` の終了コード 1〜8 の意味と分岐が変更前と同一である（既存テストが文言含めて通る）
4. `scripts/setup-messages/` が欠落・破損していても `setup.bat` は英語行のみで正常に完走・正常に失敗報告する
5. `setup.bat` 実行後、呼び出し元コンソールのコードページが実行前と同じ値に戻る
6. `start-webui.bat` に日本語コメントが残らず、挙動が変わらない
7. `host` の `npm test` が全て通る
8. README にエンコード方針（bat は ASCII のみ・日本語は `scripts/setup-messages/`）が記載され、`AGENTS.md` に「`.bat` へ非 ASCII を書かない」旨のルールが追記されている
