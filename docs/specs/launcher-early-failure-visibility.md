# exe早期失敗時の可視化と動作条件の明文化

## 背景・目的

別環境で `OpenCodeWebUI.exe` を実行すると「コンソールが一瞬表示されて閉じる・何も起きない」
という報告があった（詳細なエラーコード等の追加情報はユーザー側でも不明）。

`scripts/launcher/Launcher.cs`（コンソールサブシステムの薄いラッパー exe）の現行実装を
精査した結果、以下の設計が原因になり得ることを確認した:

- `Main()` は `scripts\start-webui.bat` が exe と同じディレクトリに存在しない場合、
  `Console.Error.WriteLine(...)` の後 **即 `return 1`** する。ダブルクリック起動では
  Explorer が新しいコンソールを生成し、プロセス終了と同時にそのコンソールも閉じるため、
  エラーメッセージは書き込まれても人間が読む前に画面が消える
  （`host/src/launcher-exe.test.js` の該当テストは `spawnSync` で stderr を直接検証しており、
  この「読めずに閉じる」UX上の欠陥は検出できていなかった）。
- `Process.Start(psi)` 呼び出し自体が例外を投げるケース（cmd.exe起動不可、権限不足等）を
  一切 catch していない。未処理例外はコンソールへスタックトレースを出して終了するが、
  これも同様に読む間もなく閉じる。
- `scripts\start-webui.bat` 側は `:fail` / `:pause_if_interactive` で
  `pause`（`OPENCODE_WEBUI_NONINTERACTIVE=1` 時のみ抑制）を持ち、bat自身が検知できる
  失敗（Node.js未導入、OpenCode未導入等、README記載のERROR 1〜10）は既にウィンドウを
  保持できる。**問題は bat に到達する前** の exe 側のみに限定される。

このため、"exeだけを別環境にコピーした"（`scripts/` 等を伴わない）、
"AV/ポリシーで `scripts\start-webui.bat` が削除・隔離された" 等、
**bat に処理が渡る前に exe 単体で失敗する** ケースで再現する可能性が高いと判断した。
本仕様はこの経路を可視化し、あわせて exe の動作条件（前提条件）をREADMEへ明文化する。

## スコープ

### 変更1: `scripts/launcher/Launcher.cs` — 早期失敗時のポーズ導入

- `Main()` 全体を `try/catch (Exception ex)` で包む。catch節では
  `Console.Error.WriteLine("OpenCodeWebUI.exe failed to start: " + ex.Message)` を出力し、
  失敗時共通のポーズ処理へ渡してから `return 1`。
- `scripts\start-webui.bat not found` の既存分岐にも同じポーズ処理を適用する。
- ポーズ処理: 環境変数 `OPENCODE_WEBUI_NONINTERACTIVE` が `"1"` でない場合のみ、
  `Console.Error.WriteLine("Press Enter to close this window...")` の後 `Console.ReadLine()`
  で待機する（`start-webui.bat` の `pause_if_interactive` と同じ変数名・同じ意味に揃える）。
  自動テスト（`spawnSync`、標準入力は既定でEOF済み）では `ReadLine()` が即 `null` を返し
  ブロックしないため、既存4テストの同期的な検証は無変更で通る。
- `scripts\start-webui.bat not found` メッセージに、**原因の当たりを付けやすい一文**を追記する:
  「この exe はリポジトリ直下に repo 全体（scripts/, host/, web/）と共に配置する必要があります。
  exe だけをコピーした場合はこのエラーになります。」（英語1行 + 日本語1行の二段、
  bat の `[OpenCode WebUI] ERROR n: ...` → `type` 詳細という既存方式に合わせる）。

### 変更2: `host/src/launcher-exe.test.js` — 回帰テスト追加

- 既存の「`scripts\start-webui.bat` が無い」テストに、ポーズ導線の追記文言
  （リポジトリ全体を配置する必要がある旨）が stderr に含まれることを追加検証する。
- 新規: `OPENCODE_WEBUI_NONINTERACTIVE=1` を設定した実行でも同じ exit code / stderr
  になること（ポーズテキスト自体は出しても出さなくてもよいが、ブロックしないことが本質）
  を検証するテストを追加する。
- 新規: 正常系（既存の「exit code 42 を転送する」テスト）が今回の変更後も無変更で
  通ることを確認する（既存テストの再実行で足りる。新規追加は不要）。

### 変更3: `scripts/launcher/Launcher.cs` の変更をリポジトリ直下の `OpenCodeWebUI.exe` へ反映

- `scripts\build-launcher.bat` で再ビルドし、`OpenCodeWebUI.exe` を再コミットする
  （README記載の「新規cloneでもダブルクリックで即起動できる」という前提を維持するため、
  ビルド成果物のコミットは必須。`start-webui.bat` 側の自動再ビルド機構に頼ると、
  今回のバグ自体でその機構に到達できないケースがあるため）。

### 変更4: `.gitattributes` — バイナリ明示（保険的措置）

- `*.exe binary` と `*.ico binary` を追記する。現状は git の内容ベース自動判定に
  依存しており通常は問題ないが、将来 contributor 側の `core.autocrlf` 設定次第で
  コミット済み `OpenCodeWebUI.exe` が意図せず改変されるリスクを明示的に閉じる
  （「別環境で動かない」の別経路をあらかじめ塞ぐ、影響範囲の小さい保険）。

### 変更5: `README.md` — exeの動作条件（前提条件）セクション新設

現状README各所に分散している前提を、起動手順の直前に集約したセクションとして追加する:

- OS: Windows 10 (1809以降) または Windows 11、x64
- **`OpenCodeWebUI.exe` は単体でコピーせず、`scripts/` `host/` `web/` を含む
  リポジトリ全体と同じ場所（直下）に置いたまま実行する**こと
  （exe単体をUSB/別PCへコピーすると起動時に即エラーになる — 今回追加するメッセージへの導線）
- 初回実行はインターネット接続必須（winget/npm/OpenCode CLIのダウンロード）
- `winget` が無い場合は Microsoft Store の「アプリ インストーラー」を先に導入
- 通常のダブルクリック実行で失敗した場合、**ウィンドウは自動では閉じず
  「Press Enter to close this window...」で待機する**（今回の変更点）。
  表示された英語1行のエラーコード/メッセージを読んでから対処する
- 未署名exeのため、環境によっては SmartScreen の警告が出ることがある。
  「詳細情報」→「実行」で先へ進める

## 受入条件

1. `host/src/launcher-exe.test.js` の既存4件 + 新規追加分がすべて PASS する
2. `scripts\start-webui.bat` が存在しない状態で exe を実行すると、stderr に
   「exeだけをコピーした場合はこのエラーになる」旨の追加メッセージが含まれる
3. `OPENCODE_WEBUI_NONINTERACTIVE=1` 環境下では上記と同じ exit code / メッセージのまま、
   テスト実行がハングしない
4. リポジトリ直下の `OpenCodeWebUI.exe` が変更後の `Launcher.cs` から再ビルドされている
   （`scripts\build-launcher.bat` 実行結果をコミット）
5. `.gitattributes` に `*.exe binary` / `*.ico binary` が追加されている
6. README に「exeの動作条件」セクションが追加されている
7. `npm run test:encoding` を含む既存の host テストスイートが全件 PASS する

## 非スコープ（今回やらないこと）

- SmartScreen/Defenderによる実行ブロックそのものへの対処（コード署名の導入等）は行わない。
  今回の再現症状（コンソールが一瞬表示されて閉じる）とは別系統の症状であり、
  README注記での案内に留める
- 長いパス（MAX_PATH）対応、プロキシ環境でのnpm/winget導入対応など、
  今回報告された症状の裏付けがない他の「新環境」失敗要因への先回り対応は行わない
  （再現しない仮説へ広くパッチを当てるより、実際に確認できた導線を先に塞ぐ）
