# setup.bat を廃止して start-webui.bat へ統合する

> 実装ステータス: ✅ 実装済み（参照: `scripts/start-webui.bat` / `host/src/bat-encoding.test.js`）

## 背景・目的

現状は「初回のみ `setup.bat`」「2回目以降は `start-webui.bat`」という2ファイル・2ステップの
オンボーディングになっている。ユーザー指示によりこれを統合し、**`setup.bat` を削除して
その全ロジックを `start-webui.bat` 1本へ完全吸収する**（ユーザーが選択した3案中の
「setup.batを廃止しstart-webui.batへ完全吸収」案）。以後、利用者は常に `start-webui.bat`
（または `scripts/build-launcher.bat` が生成する `LeafCode.exe` 経由のデスクトップ
ショートカット）を実行するだけでよくなる。

前提として、`start-webui.bat` は前回のセッションで「直接実行してもネイティブ.exeランチャー
（`scripts/launcher/LeafCode.exe`）経由になり、未ビルドなら自動ビルドする」機能を
既に持つ（`LEAFCODE_LAUNCHER=1` でループを防止）。今回の統合はこの機能に影響しない
（ルーティング判定はファイル冒頭のまま維持し、その後段に吸収したセットアップ処理を続ける）。

## スコープ

### 削除

- `setup.bat` を削除する。

### `start-webui.bat` へ吸収するロジック（`setup.bat` から）

1. `winget` の有無チェック（無ければ ERROR 1）
2. Node.js メジャーバージョン確認（20未満なら `winget install --id OpenJS.NodeJS.LTS ...`。
   失敗なら ERROR 2、導入後もPATH未反映なら ERROR 3）
3. OpenCode 確認（無ければ `winget install --id SST.opencode ...`、失敗時は
   `npm install -g opencode-ai` にフォールバック。両方失敗、またはPATH未反映なら ERROR 4）
4. `web/` 依存関係インストール + production build
   （`node scripts/production-webui-build-guard.mjs --stop` で稼働中WebUIを保護してから
   `npm ci` → `npm run build` → `BUILD_ID` 確認。ci失敗はERROR 5、build失敗はERROR 6、
   guardが port を確保できない場合もERROR 6、`BUILD_ID` 不在はERROR 7）
5. `host/` 依存関係インストール（`npm ci`、失敗はERROR 8）
6. `[Setup] ERROR <code>: <english summary>` → `type scripts/setup-messages/error-*.txt`
   の二段出力方式、`SETUP_NONINTERACTIVE`（→ `LEAFCODE_NONINTERACTIVE` に改名。
   他の環境変数と命名規則を揃える）で `pause` を抑制する仕組み
7. 実行前後でコンソールのコードページを退避・復帰する仕組み（`scripts/setup-messages/*.txt`
   が UTF-8 のため、`type` 表示のために `chcp 65001` が必要になる）

### 冪等性のために「毎回強制」から「必要な時だけ」へ変更する点（重要な仕様変更）

`setup.bat` は初回専用だったため上記4〜5を**常に**実行していたが、`start-webui.bat` は
2回目以降の高速起動を担うため、**既存の一致条件を保った上でガードする**:

- `web/node_modules` が既に存在するなら `npm ci` はスキップ（現行 `start-webui.bat` と同じ）
- `web/.next/BUILD_ID` が既に存在するなら build（および そのための guard 呼び出し）はスキップし
  「host側が起動時に古ければ自動再ビルドする」という既存コメントの前提を維持する
- `host/node_modules` が既に存在するなら `npm ci` はスキップ
- winget/Node.js/OpenCode の確認自体は毎回行うが、既に条件を満たしていれば
  install コマンドは呼ばれない（`node -p`/`opencode --version` の軽い確認のみ）

これにより「常に `start-webui.bat` を実行するだけでよい」という統合の目的を保ちながら、
2回目以降の起動が `setup.bat` 相当の毎回 `npm ci`/`npm run build` で遅くなることを避ける。

### 削除される旧来の分岐（今回の統合で不要になる副作用）

- `setup.bat` が行っていた「`start "LeafCode" cmd /c call start-webui.bat` で
  **別コンソールを非同期起動**し、自身は `[Setup] Setup completed.` を出して即 `exit /b 0`
  する」という二重コンソール構成は廃止する。統合後は同一コンソール・同一プロセスの
  延長で `cd host && node src\index.js`（現行 `start-webui.bat` の末尾と同じ、フォアグラウンド）
  まで進む。**最終的な終了コードは host の終了コードそのもの**になる
  （ERROR 1〜8 は「準備フェーズ」限定で、host 実行後の終了コードとは体系が別のまま）。

### メッセージ文言の更新

- `scripts/setup-messages/*.txt` および ASCII 要約行のプレフィックスを `[Setup] ` から
  `[LeafCode] ` に統一する（`start-webui.bat` の既存 echo と揃える。「setup」という
  別工程が無くなるため）。
- `success.txt` の「トレイアイコンが表示されない場合は start-webui.bat を手動で実行して
  ください」、`guard-stopped.txt` の「セットアップ完了後にトレイまたは start-webui.bat から
  起動してください」は、統合後は同一スクリプトがそのまま起動まで継続するため文意が
  合わなくなる。前者は削除（別コンソールへの委譲が無くなり、成功後は同じ画面で起動が
  続くため無関係になる）。後者は「ビルドのため停止した」旨のみ残し、後段の案内文を除く。

## 変更ファイル一覧

- 削除: `setup.bat`
- 変更: `start-webui.bat`（goto/label ベースへ再構成し、上記ロジックを吸収）
- 変更: `scripts/setup-messages/*.txt`（`[Setup] ` → `[LeafCode] `、文言更新）
- 変更: `host/src/setup-bat.test.js` → `host/src/start-webui-bat.test.js` へ改名しつつ、
  新しい単一スクリプトの挙動（chcp/エラーコード/冪等スキップ/ホスト起動テール）を検証する
  内容に書き換え。既存の `start-webui-launcher-routing.test.js` とはテスト対象領域が
  重ならないよう、ホスト起動テールのモックは fake `node.cmd` で `src\index.js` 引数を
  処理する形にする。
- 変更: `host/src/bat-encoding.test.js`
  - メッセージキー相互参照テストの対象を `setup.bat` から `start-webui.bat` へ変更
  - `[Setup] ` プレフィックス検証を `[LeafCode] ` へ変更
- 変更: `README.md`（起動手順を「`start-webui.bat` を実行するだけ」の1ステップに書き換え、
  終了コード表の説明文言更新）
- 変更: `.github/workflows/encoding-check.yml`（コメント文言の setup.bat 言及を更新）
- 変更: `docs/specs/bat-encoding-safety.md`（歴史的記録として本文は書き換えず、冒頭付近に
  「本ファイルは削除され `start-webui.bat` へ統合された（本仕様書参照）」という追記のみ行う）

## 受入条件

1. `setup.bat` がリポジトリから削除されている
2. `start-webui.bat` を新規環境（Node.js/OpenCode/依存関係すべて未導入）相当のモックで実行すると、
   旧 `setup.bat` と同じ順序・同じ終了コード（1〜8）で分岐する
3. 既に `node_modules`/`BUILD_ID` が存在する状態で `start-webui.bat` を実行すると、
   該当する `npm ci`/`npm run build`/guard 呼び出しは行われず、現行同様に高速に
   host 起動テールへ進む
4. `host` の `npm test` が全件通る（新規テスト含む）
5. `npm run test:encoding` が全件通る（`[LeafCode] ` プレフィックス、CRLF/ASCII、
   README fence を含む）
6. README・`.github/workflows/encoding-check.yml` に `setup.bat` への言及が残っていない
   （`docs/specs/` 内の歴史的記録・過去バグ台帳を除く）
7. ネイティブ.exeランチャー経由の直接実行ルーティング（前回実装）は無変更で動作する
