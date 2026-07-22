# Windows 初回セットアップバッチ 仕様

## 目的

第三者が OpenCode WebUI リポジトリを clone した直後、`setup.bat` をダブルクリックするだけで、依存ツールの導入から production build、起動までを完了させる。

## 採用方式

単一の `setup.bat`（`start-webui.bat` とは別ファイル）をリポジトリルートに配置する。

| 方式 | 判定 |
|------|------|
| **setup.bat（採用）** | 単一ファイル完結。ユーザーはダブルクリックのみ。既存 `start-webui.bat` に手を加えず、初回専用の責務を分離できる |
| PowerShell `.ps1` 分離 | 不採用。実行ポリシー制限（`Restricted` 既定）により初回ユーザーが即実行できない。`powershell -ExecutionPolicy Bypass` の案内が増え、bat より複雑になる |
| 既存 `start-webui.bat` の拡張 | 不採用。`start-webui.bat` は「起動」に特化しており、winget 導入・再ログイン案内・初回 build 保証を混ぜると日常起動が遅くなる。初回と二回目以降で分岐が増え可読性が下がる |

## フロー

```
setup.bat ダブルクリック
  → cd /d "%~dp0"（自身の場所へ移動）
  → winget 確認（なければ案内して終了）
  → Node.js 確認（メジャーバージョン 20 以上）
    → 不足 or 20 未満 → winget install OpenJS.NodeJS.LTS
      → インストール後も node が見つからない → 「再ログインか再起動後に setup.bat を再実行」で終了
  → OpenCode 確認（opencode --version）
    → 不足 → winget install SST.opencode
      → winget 失敗 → npm install -g opencode-ai（公式 fallback）
  → web/ で npm ci
  → web/ で npm run build
  → BUILD_ID 確認（web\.next\BUILD_ID の存在）
  → host/ で npm ci
  → start-webui.bat を start で別プロセス起動
  → setup 終了メッセージを表示して exit /b 0
```

## 各ステップの詳細

### 1. 自身の場所へ cd

```bat
cd /d "%~dp0"
```

`start-webui.bat` と同一の慣行。どのディレクトリから実行されてもリポジトリルートをカレントにする。

### 2. winget 確認

```bat
where winget >nul 2>&1
if errorlevel 1 (
  echo [Setup] winget が見つかりません。
  echo Windows 11 または Windows 10 20H1 以降が必要です。
  echo Microsoft Store から「アプリインストーラー」を入手するか、
  echo https://learn.microsoft.com/windows/package-manager/winget/ を参照してください。
  pause
  exit /b 1
)
```

winget は Windows 11 および Windows 10 20H1 以降に標準搭載。不足時は Microsoft Store の「アプリインストーラー」を案内する。

### 3. Node.js 確認・導入

```bat
set "NODE_MAJOR=0"
set "INSTALL_NODE=0"
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 set "INSTALL_NODE=1"
if "%INSTALL_NODE%"=="1" (
  echo [Setup] Node.js 20 以上が必要です。winget で最新 LTS をインストールします...
  winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if errorlevel 1 (
    echo [Setup] Node.js のインストールに失敗しました。
    echo https://nodejs.org/ から手動インストールしてください。
    pause
    exit /b 2
  )
  rem インストール後、同一セッションでは PATH が反映されない
  where node >nul 2>&1
  if errorlevel 1 (
    echo [Setup] Node.js をインストールしましたが、このコマンドプロンプトでは認識されません。
    echo 再ログインするか、PC を再起動してから setup.bat を再実行してください。
    pause
    exit /b 3
  )
)
```

**Node バージョン判断**: CI は Node 20 で動作しているが、2026 年 7 月現在 Node 20 は EOL（2026-04-30 終了）。初回導入または Node 20 未満の環境には最新 LTS を入れ、互換性を実ビルドで検証する。既存環境に Node 20 以上が入っている場合は上書きしない。

### 4. OpenCode 確認・導入

```bat
opencode --version >nul 2>&1
if errorlevel 1 (
  echo [Setup] OpenCode が見つかりません。winget でインストールします...
  winget install --id SST.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if errorlevel 1 (
    echo [Setup] winget でのインストールに失敗しました。npm でインストールします...
    npm install -g opencode-ai
    if errorlevel 1 (
      echo [Setup] OpenCode のインストールに失敗しました。
      echo https://opencode.ai/docs を参照して手動インストールしてください。
      pause
      exit /b 4
    )
  )
)
opencode --version >nul 2>&1
if errorlevel 1 (
  echo [Setup] OpenCode を導入しましたが、このコマンドプロンプトでは認識されません。
  echo 再ログイン後に setup.bat を再実行してください。
  pause
  exit /b 4
)
```

**根拠**:
- `SST.opencode` は Microsoft Community winget マニフェストであり、OpenCode 公式ドキュメント（https://opencode.ai/docs）には winget インストールの記載がない。コミュニティ保守のため将来の欠番・遅延リスクがある。
- `npm install -g opencode-ai` は公式ドキュメントに記載された正規インストール手段。winget が失敗した場合の fallback として使用する。

### 5. npm ci + build

```bat
pushd web
call npm ci
if errorlevel 1 (
  echo [Setup] web の依存関係インストールに失敗しました。
  popd
  pause
  exit /b 5
)

call npm run build
if errorlevel 1 (
  echo [Setup] web のビルドに失敗しました。
  popd
  pause
  exit /b 6
)

if not exist ".next\BUILD_ID" (
  echo [Setup] ビルドは完了しましたが BUILD_ID が見つかりません。
  popd
  pause
  exit /b 7
)
popd

pushd host
call npm ci
if errorlevel 1 (
  echo [Setup] host の依存関係インストールに失敗しました。
  popd
  pause
  exit /b 8
)
popd
```

`npm ci` は `package-lock.json` を元にインストールするため、再現性が高く初回セットアップに適する。

### 6. 起動

```bat
echo [Setup] 起動します...
start "OpenCode WebUI" cmd /d /c call "%~dp0start-webui.bat"
echo [Setup] セットアップ完了。ブラウザで http://127.0.0.1:3000 を開いてください。
echo トレイアイコンが表示されない場合は start-webui.bat を手動で実行してください。
exit /b 0
```

`start` で別コンソールのプロセスとして起動し、setup.bat は終了する。`start-webui.bat` は既存の二重起動防止・自動ビルド stale 検出を持つため、setup 後の通常起動としてそのまま使える。

## errorlevel 別の失敗表示と復旧案内

| errorlevel | 意味 | 表示 | 復旧案内 |
|-----------|------|------|----------|
| 1 | winget 不在 | winget が見つかりません | アプリインストーラー入手 or 手動インストール案内 |
| 2 | Node.js 導入失敗 | Node.js インストール失敗 | https://nodejs.org/ から手動 |
| 3 | Node.js 導入後も PATH 未反映 | 再ログイン/再起動が必要 | 再ログイン後に再実行 |
| 4 | OpenCode winget + npm 両方失敗 | OpenCode インストール失敗 | https://opencode.ai/docs から手動 |
| 5 | web npm ci 失敗 | web 依存関係インストール失敗 | ネットワーク確認、package-lock.json の整合性確認 |
| 6 | web build 失敗 | web ビルド失敗 | エラー出力を確認、Node バージョンを確認 |
| 7 | BUILD_ID 不在 | ビルド後 BUILD_ID なし | ビルドログ確認、再実行 |
| 8 | host npm ci 失敗 | host 依存関係インストール失敗 | ネットワーク確認 |

実際の errorlevel は `exit /b <code>` で設定する。各分岐で `echo` による日本語メッセージと復旧案内を表示し、`pause` でユーザーが読む時間を確保する。

## 変更しないもの

| 項目 | 理由 |
|------|------|
| 管理者権限の要求 | winget のインストールはユーザー権限でも可能（システム全体へのインストールは UAC 昇格ダイアログが winget 側で出す）。setup.bat 自体は管理者実行を要求しない |
| Firewall ルールの追加 | 初回セットアップの責務を超える。起動後、必要に応じて `scripts/allow-firewall-*.bat` をユーザーが手動実行する |
| Caddy の導入・設定 | 任意機能。`OPENCODE_WEBUI_CADDY=1` は README の手順に委ねる |
| 既存 `start-webui.bat` の改変 | 本仕様書の対象外。setup.bat は独立ファイルとして新規作成する |

## README 更新範囲

`README.md` の「起動（Windows）」セクションを以下のように更新する：

- 手順 0 として `setup.bat` のダブルクリックを追加
- 既存の手順（start-webui.bat）は手順 1 として維持
- 前提条件（PATH に opencode）の記載を setup.bat が自動解決する旨に変更
- トラブル時セクションは維持

## テスト・受入基準

### 静的分岐確認（bat の構文チェック）

ラベル、括弧、引用符、`errorlevel` と `exit /b` の対応をレビューする。一時 PATH 上の mock コマンドを使い、実際のツール導入や常駐起動なしで主要な成功・失敗分岐と終了コードを確認する。

### 既存環境での検証（常駐プロセスを起動しない）

```bash
# web の依存関係とビルドが通ることの確認
cd web && npm ci && npm run build
# BUILD_ID の確認
test -f web/.next/BUILD_ID
# host の依存関係
cd host && npm ci
# lint / typecheck / unit test（既存 CI と同じ）
cd web && npm run lint && npm run typecheck && npm test
```

### 起動コマンドの安全な検証

```bash
# 一時 PATH 上の mock node/npm/opencode/winget を使い、失敗分岐と終了コードを確認
# 起動成功分岐では mock start-webui.bat を参照し、実ホストを起動しない
```

**テスト中に常駐プロセスをフォアグラウンド起動しない。** 検証は `npm ci` / `npm run build` / `npm run lint` / `npm run typecheck` / `npm test` に限定する。

### 受入条件

1. `setup.bat` が存在し、ダブルクリックで実行可能である
2. winget が存在しない環境ではエラーメッセージを表示して終了する
3. Node.js が存在しないかメジャーバージョン 20 未満の場合、winget で OpenJS.NodeJS.LTS を導入する
4. Node.js 導入後も PATH が通らない場合、再ログイン案内を表示して終了する
5. OpenCode が存在しない場合、winget → npm fallback の順で導入を試みる
6. 両方失敗した場合、手動インストール案内を表示して終了する
7. `web/` の `npm ci` → `npm run build` が成功し、`BUILD_ID` が存在する
8. `host/` の `npm ci` が成功する
9. 最後に `start-webui.bat` を別プロセス起動して終了する
10. 各エラー分岐で明確な日本語メッセージと復旧案内を表示する
11. 管理者権限・Firewall・Caddy を自動変更しない
12. 既存の `start-webui.bat` を改変しない

## セキュリティ

- 無断で外部公開（ポート開放・Caddy 自動設定・ドメイン登録）を行わない
- API キー・トークン・パスワードをログやファイルに記録しない
- `winget install` は `--accept-package-agreements` を明示し、サイレントインストールとする
- `npm install -g` は公式パッケージ `opencode-ai` のみ実行し、任意のパッケージをインストールしない
- ネットワーク通信は winget（Microsoft CDN / GitHub Releases）および npm registry のみ

## ファイル構成

```
opencode-webui/
├── setup.bat              # 新規作成（本仕様書の実装対象）
├── start-webui.bat        # 既存、変更しない
├── build.bat              # 既存、変更しない
├── README.md              # 起動手順を更新
└── docs/superpowers/specs/2026-07-23-windows-setup-batch-design.md  # 本仕様書
```
