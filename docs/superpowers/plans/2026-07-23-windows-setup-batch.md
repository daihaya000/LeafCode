# Windows Setup Batch Implementation Plan
# Windows Setup Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** clone直後のWindows環境で、`setup.bat` のダブルクリックだけで必要ツール、依存関係、production build、別プロセスのWebUI起動を完了できるようにする。

**Architecture:** リポジトリルートに独立した `setup.bat` を置き、既存の `start-webui.bat` は変更しない。バッチの判定と失敗処理はラベル付きサブルーチンに分離して括弧ブロック内の変数展開を避ける。Node組み込みテストは一時リポジトリとPATH先頭の`.cmd`モックでバッチを実行し、実インストールと常駐起動なしに各経路を検証する。

**Tech Stack:** Windows cmd/batch、Windows Package Manager (`winget`)、Node.js 20以上、npm、Node.js組み込みテストランナー

## Global Constraints

- 新規ファイルはリポジトリルートの `setup.bat` と `host/src/setup-bat.test.js` のみとし、既存ファイルは `README.md` だけを更新する。
- `start-webui.bat`、管理者権限、Firewallルール、Caddy設定、APIキー・トークン・パスワードは変更しない。
- `setup.bat` は必ず `cd /d "%~dp0"` でリポジトリルートへ移動する。
- `winget` 不在は1、Node導入失敗は2、Node導入後のPATH未反映は3、OpenCode導入不能またはPATH未反映は4、webの`npm ci`失敗は5、web build失敗は6、`BUILD_ID`不在は7、hostの`npm ci`失敗は8で `exit /b` する。
- Node.jsはメジャーバージョン20以上を要求し、存在しないか20未満なら `OpenJS.NodeJS.LTS` を導入する。
- すべてのwinget導入は `install --id <ID> --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity` を完全な引数で使う。
- OpenCodeは `SST.opencode` をwingetで試行し、winget失敗時だけ公式パッケージの `npm install -g opencode-ai` にフォールバックする。
- webでは `npm ci`、`npm run build`、`.next\BUILD_ID` の順に検証し、hostでは `npm ci` を実行する。
- 通常利用では全失敗経路で `pause` する。明示的な `SETUP_NONINTERACTIVE=1` のときだけpauseを省略し、これは自動テスト専用の安全な非対話契約とする。
- 成功時は `start` で `start-webui.bat` を別プロセス起動し、セットアップ自身は終了する。
- 自動テストは一時ディレクトリとPATH先頭のmock `.cmd` のみを使い、実際のインストール、実サーバー起動、常駐プロセスを行わない。
- 実装完了時は常駐開発サーバーを起動せず、lint、typecheck、unit、build、host testを実行する。

## File Structure

- Create: `setup.bat` — 初回セットアップ、ツール導入、依存関係導入、production build、既存ランチャーの非同期起動を担う。
- Create: `host/src/setup-bat.test.js` — 一時リポジトリとmockコマンドによるWindowsバッチの回帰テストを担う。
- Modify: `README.md` — 初回の`setup.bat`実行と通常の`start-webui.bat`起動を具体的に案内する。

---

### Task 1: Windows初回セットアップバッチをTDDで実装する

**Files:**
- Create: `host/src/setup-bat.test.js`
- Create: `setup.bat`

**Interfaces:**
- Consumes: `winget`、`node`、`npm`、`opencode`、`web/package-lock.json`、`host/package-lock.json`、既存の `start-webui.bat`。
- Produces: exit code 0（完了）または1〜8（復旧案内済みの失敗）。成功時には `start "OpenCode WebUI" "%ComSpec%" /d /c call "%~dp0start-webui.bat"` で既存ホストを別プロセスに委譲する。

- [ ] **Step 1: 成功経路と主要失敗を実行するredテストを書く**

`host/src/setup-bat.test.js` を次の内容で作成する。`SETUP_NONINTERACTIVE=1` を子プロセスだけに渡すため、失敗テストはキー入力を待たない。`winget.cmd` は実引数の `install --id <ID>` を `%~1`、`%~2`、`%~3` で検証し、OpenCodeのwinget成功時だけinstalled markerを作る。

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const setupSource = join(repoRoot, "setup.bat");
const isWindows = process.platform === "win32";

function writeBat(path, contents) {
  const normalized = contents.replace(/\r?\n/g, "\r\n");
  writeFileSync(path, `@echo off\r\n${normalized}\r\n`, "utf8");
}

function createSandbox(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "OpenCode WebUI setup-"));
  const bin = join(root, "mock-bin");
  const log = join(root, "commands.log");
  mkdirSync(bin);
  mkdirSync(join(root, "web"));
  mkdirSync(join(root, "host"));
  writeFileSync(join(root, "setup.bat"), readFileSync(setupSource));
  writeBat(join(root, "start-webui.bat"), 'type nul > "%~dp0started.txt"\nexit /b 0');
  writeBat(join(bin, "where.cmd"), [
    'if exist "%~dp0%~1.cmd" echo %~dp0%~1.cmd',
    'if exist "%~dp0%~1.cmd" exit /b 0',
    "exit /b 1",
  ].join("\n"));

  if (options.withWinget !== false) {
    writeBat(join(bin, "winget.cmd"), [
      'echo %*>>"%SETUP_TEST_LOG%"',
      'if not "%~1"=="install" exit /b 87',
      'if not "%~2"=="--id" exit /b 87',
      'if "%~3"=="OpenJS.NodeJS.LTS" goto :node',
      'if "%~3"=="SST.opencode" goto :opencode',
      "exit /b 87",
      ":node",
      'if not "%SETUP_TEST_WINGET_NODE_EXIT%"=="0" exit /b %SETUP_TEST_WINGET_NODE_EXIT%',
      'type nul > "%SETUP_TEST_ROOT%\\node-installed"',
      "exit /b 0",
      ":opencode",
      'if not "%SETUP_TEST_WINGET_OPENCODE_EXIT%"=="0" exit /b %SETUP_TEST_WINGET_OPENCODE_EXIT%',
      'if "%SETUP_TEST_OPENCODE_WINGET_MARKER%"=="1" type nul > "%SETUP_TEST_ROOT%\\opencode-winget-installed"',
      "exit /b 0",
    ].join("\n"));
  }

  if (options.withNode !== false) {
    writeBat(join(bin, "node.cmd"), [
      'if not "%~1"=="-p" exit /b 0',
      'if exist "%SETUP_TEST_ROOT%\\node-installed" echo %SETUP_TEST_NODE_MAJOR_AFTER_INSTALL%',
      'if exist "%SETUP_TEST_ROOT%\\node-installed" exit /b 0',
      "echo %SETUP_TEST_NODE_MAJOR%",
      "exit /b 0",
    ].join("\n"));
  }

  writeBat(join(bin, "opencode.cmd"), [
    'if exist "%SETUP_TEST_ROOT%\\opencode-winget-installed" exit /b 0',
    'if exist "%SETUP_TEST_ROOT%\\opencode-npm-installed" exit /b 0',
    "exit /b %SETUP_TEST_OPENCODE_EXIT%",
  ].join("\n"));
  writeBat(join(bin, "npm.cmd"), [
    'echo npm %CD% %*>>"%SETUP_TEST_LOG%"',
    'if "%~1"=="install" if "%~2"=="-g" goto :global',
    'if /i "%CD:~-4%"=="\\web" if "%~1"=="ci" exit /b %SETUP_TEST_NPM_WEB_CI_EXIT%',
    'if /i "%CD:~-4%"=="\\web" if "%~1"=="run" if "%~2"=="build" goto :build',
    'if /i "%CD:~-5%"=="\\host" if "%~1"=="ci" exit /b %SETUP_TEST_NPM_HOST_CI_EXIT%',
    "exit /b 0",
    ":global",
    'if not "%SETUP_TEST_NPM_GLOBAL_EXIT%"=="0" exit /b %SETUP_TEST_NPM_GLOBAL_EXIT%',
    'type nul > "%SETUP_TEST_ROOT%\\opencode-npm-installed"',
    "exit /b 0",
    ":build",
    'if not "%SETUP_TEST_NPM_WEB_BUILD_EXIT%"=="0" exit /b %SETUP_TEST_NPM_WEB_BUILD_EXIT%',
    'if "%SETUP_TEST_CREATE_BUILD_ID%"=="0" exit /b 0',
    "mkdir .next 2>nul",
    "> .next\\BUILD_ID echo setup-test-build",
    "exit /b 0",
  ].join("\n"));

  const env = {
    ...process.env,
    PATH: `${bin};${join(process.env.SystemRoot ?? "C:\\Windows", "System32")}`,
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    SETUP_NONINTERACTIVE: "1",
    SETUP_TEST_ROOT: root,
    SETUP_TEST_LOG: log,
    SETUP_TEST_NODE_MAJOR: String(options.nodeMajor ?? 22),
    SETUP_TEST_NODE_MAJOR_AFTER_INSTALL: String(options.nodeMajorAfterInstall ?? 22),
    SETUP_TEST_WINGET_NODE_EXIT: String(options.wingetNodeExit ?? 0),
    SETUP_TEST_WINGET_OPENCODE_EXIT: String(options.wingetOpenCodeExit ?? 0),
    SETUP_TEST_OPENCODE_WINGET_MARKER: options.opencodeWingetMarker === false ? "0" : "1",
    SETUP_TEST_OPENCODE_EXIT: String(options.opencodeExit ?? 0),
    SETUP_TEST_NPM_GLOBAL_EXIT: String(options.npmGlobalExit ?? 0),
    SETUP_TEST_NPM_WEB_CI_EXIT: String(options.npmWebCiExit ?? 0),
    SETUP_TEST_NPM_WEB_BUILD_EXIT: String(options.npmWebBuildExit ?? 0),
    SETUP_TEST_NPM_HOST_CI_EXIT: String(options.npmHostCiExit ?? 0),
    SETUP_TEST_CREATE_BUILD_ID: options.createBuildId === false ? "0" : "1",
  };
  return {
    root,
    log,
    run() {
      return spawnSync(process.env.ComSpec ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), ["/d", "/c", "call setup.bat"], {
        cwd: root,
        encoding: "utf8",
        env,
        timeout: 10_000,
        windowsHide: true,
      });
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

function assertCompleted(result, label) {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message ?? "spawn failed"}`);
  assert.equal(result.signal, null, `${label}: child was terminated by ${result.signal}`);
}

async function waitFor(path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`Timed out waiting for ${basename(path)}`);
}

test("setup.bat uses successful winget installs, builds, and starts separately", { skip: !isWindows }, async () => {
  const sandbox = createSandbox({ nodeMajor: 18, nodeMajorAfterInstall: 22, opencodeExit: 1 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "winget success");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(sandbox.root, "opencode-winget-installed")), true);
    assert.equal(existsSync(join(sandbox.root, "opencode-npm-installed")), false);
    assert.equal(existsSync(join(sandbox.root, "web", ".next", "BUILD_ID")), true);
    await waitFor(join(sandbox.root, "started.txt"));
    const log = readFileSync(sandbox.log, "utf8");
    assert.match(log, /install --id OpenJS\.NodeJS\.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity/);
    assert.match(log, /install --id SST\.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity/);
    assert.doesNotMatch(log, /npm .* install -g opencode-ai/);
  } finally { sandbox.cleanup(); }
});

test("setup.bat falls back to npm only after the OpenCode winget install fails", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ opencodeExit: 1, wingetOpenCodeExit: 1 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "npm fallback");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(sandbox.root, "opencode-winget-installed")), false);
    assert.equal(existsSync(join(sandbox.root, "opencode-npm-installed")), true);
    assert.match(readFileSync(sandbox.log, "utf8"), /npm .* install -g opencode-ai/);
  } finally { sandbox.cleanup(); }
});

test("setup.bat returns documented failures without starting a host", { skip: !isWindows }, () => {
  const cases = [
    ["winget is absent", { withWinget: false }, 1, "winget が見つかりません"],
    ["Node installation fails", { nodeMajor: 18, wingetNodeExit: 1 }, 2, "Node.js のインストールに失敗しました"],
    ["Node PATH is not refreshed", { withNode: false }, 3, "再ログインするか、PC を再起動"],
    ["OpenCode winget installation has no PATH", { opencodeExit: 1, opencodeWingetMarker: false }, 4, "このコマンドプロンプトでは認識されません"],
    ["OpenCode winget and npm both fail", { opencodeExit: 1, wingetOpenCodeExit: 1, npmGlobalExit: 1 }, 4, "OpenCode のインストールに失敗しました"],
    ["web npm ci fails", { npmWebCiExit: 1 }, 5, "web の依存関係インストールに失敗しました"],
    ["web build fails", { npmWebBuildExit: 1 }, 6, "web のビルドに失敗しました"],
    ["web build has no BUILD_ID", { createBuildId: false }, 7, "BUILD_ID が見つかりません"],
    ["host npm ci fails", { npmHostCiExit: 1 }, 8, "host の依存関係インストールに失敗しました"],
  ];
  for (const [name, options, expectedExit, expectedMessage] of cases) {
    const sandbox = createSandbox(options);
    try {
      const result = sandbox.run();
      assertCompleted(result, name);
      assert.equal(result.status, expectedExit, `${name}: ${result.stdout}\n${result.stderr}`);
      assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expectedMessage));
      assert.equal(existsSync(join(sandbox.root, "started.txt")), false, name);
    } finally { sandbox.cleanup(); }
  }
});
```

- [ ] **Step 2: テストが未実装を検出することを確認する**

Run:

```bat
cd host
node --test src\setup-bat.test.js
```

Expected: WindowsではFAIL。リポジトリルートの`setup.bat`が未作成のためコピー元を開けず `ENOENT` を報告する。Windows以外では3件ともSKIPとなる。

- [ ] **Step 3: `setup.bat` をサブルーチン構成で実装する**

`setup.bat` を次の内容で作成する。`SETUP_NONINTERACTIVE=1` 以外では `:pause_if_interactive` が必ず通常の `pause` を実行する。主処理は成功時に明示的に `:success` へ移動し、サブルーチン定義へfall-throughしない。

```bat
@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
echo [Setup] OpenCode WebUI の初回セットアップを開始します。

call :check_winget
if errorlevel 1 goto :failure
call :check_node
if errorlevel 1 goto :failure
call :check_opencode
if errorlevel 1 goto :failure
call :install_web
if errorlevel 1 goto :failure
call :install_host
if errorlevel 1 goto :failure
call :start_host
goto :success

:success
endlocal & exit /b 0

:failure
set "SETUP_EXIT=%ERRORLEVEL%"
endlocal & exit /b %SETUP_EXIT%

:check_winget
where winget >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 1 "winget が見つかりません。" "Windows 11 または Windows 10 20H1 以降が必要です。Microsoft Store から「アプリインストーラー」を入手するか、https://learn.microsoft.com/windows/package-manager/winget/ を参照してください。"
exit /b 1

:check_node
set "NODE_MAJOR=0"
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
call :node_major_is_supported
if not errorlevel 1 exit /b 0
echo [Setup] Node.js 20 以上が必要です。winget で最新 LTS をインストールします...
winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :node_install_failed
where node >nul 2>&1
if errorlevel 1 goto :node_path_not_refreshed
set "NODE_MAJOR=0"
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
call :node_major_is_supported
if not errorlevel 1 exit /b 0
goto :node_path_not_refreshed

:node_major_is_supported
if %NODE_MAJOR% GEQ 20 exit /b 0
exit /b 1

:node_install_failed
call :fail 2 "Node.js のインストールに失敗しました。" "https://nodejs.org/ から手動インストールしてください。"
exit /b 2

:node_path_not_refreshed
call :fail 3 "Node.js をインストールしましたが、このコマンドプロンプトでは認識されません。" "再ログインするか、PC を再起動してから setup.bat を再実行してください。"
exit /b 3

:check_opencode
opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
echo [Setup] OpenCode が見つかりません。winget でインストールします...
winget install --id SST.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :install_opencode_with_npm
opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCode を導入しましたが、このコマンドプロンプトでは認識されません。" "再ログイン後に setup.bat を再実行してください。"
exit /b 4

:install_opencode_with_npm
echo [Setup] winget でのインストールに失敗しました。npm でインストールします...
call npm install -g opencode-ai
if errorlevel 1 goto :opencode_install_failed
opencode --version >nul 2>&1
if not errorlevel 1 exit /b 0
call :fail 4 "OpenCode を導入しましたが、このコマンドプロンプトでは認識されません。" "再ログイン後に setup.bat を再実行してください。"
exit /b 4

:opencode_install_failed
call :fail 4 "OpenCode のインストールに失敗しました。" "https://opencode.ai/docs を参照して手動インストールしてください。"
exit /b 4

:install_web
pushd web
if errorlevel 1 goto :web_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :web_ci_failed
call npm run build
if errorlevel 1 goto :web_build_failed
if not exist ".next\BUILD_ID" goto :web_build_id_missing
popd
exit /b 0

:web_ci_failed_without_pushd
call :fail 5 "web の依存関係インストールに失敗しました。" "ネットワーク接続と web\package-lock.json の整合性を確認してください。"
exit /b 5

:web_ci_failed
popd
call :fail 5 "web の依存関係インストールに失敗しました。" "ネットワーク接続と web\package-lock.json の整合性を確認してください。"
exit /b 5

:web_build_failed
popd
call :fail 6 "web のビルドに失敗しました。" "上のエラー出力と Node.js のバージョンを確認してください。"
exit /b 6

:web_build_id_missing
popd
call :fail 7 "ビルドは完了しましたが BUILD_ID が見つかりません。" "ビルドログを確認してから setup.bat を再実行してください。"
exit /b 7

:install_host
pushd host
if errorlevel 1 goto :host_ci_failed_without_pushd
call npm ci
if errorlevel 1 goto :host_ci_failed
popd
exit /b 0

:host_ci_failed_without_pushd
call :fail 8 "host の依存関係インストールに失敗しました。" "ネットワーク接続と host\package-lock.json の整合性を確認してください。"
exit /b 8

:host_ci_failed
popd
call :fail 8 "host の依存関係インストールに失敗しました。" "ネットワーク接続と host\package-lock.json の整合性を確認してください。"
exit /b 8

:start_host
echo [Setup] 起動します...
start "OpenCode WebUI" "%ComSpec%" /d /c call "%~dp0start-webui.bat"
echo [Setup] セットアップ完了。ブラウザで http://127.0.0.1:3000 を開いてください。
echo [Setup] トレイアイコンが表示されない場合は start-webui.bat を手動で実行してください。
exit /b 0

:fail
echo [Setup] %~2
echo [Setup] %~3
call :pause_if_interactive
exit /b %~1

:pause_if_interactive
if "%SETUP_NONINTERACTIVE%"=="1" exit /b 0
pause
exit /b 0
```

- [ ] **Step 4: greenテストを実行する**

Run:

```bat
cd host
node --test src\setup-bat.test.js
```

Expected: Windowsでは3テストがPASSする。winget成功時はOpenCode markerが作られnpm fallbackは呼ばれない。winget失敗時はnpm fallback markerが作られる。Node/OpenCodeのPATH未反映と1〜8の失敗コードは`SETUP_NONINTERACTIVE=1`でpauseせず検証される。各`spawnSync`の`result.error`と`result.signal`も検証する。

- [ ] **Step 5: greenなバッチとテストを意味単位でコミットする**

Run:

```bat
git status --short
git diff --check
git diff -- setup.bat host/src/setup-bat.test.js
git add setup.bat host/src/setup-bat.test.js
git commit -m "feat: Windows初回セットアップを追加"
git log --oneline -1
```

Expected: 通過済みのテストと実装だけを含む日本語の意味単位コミットが作成され、他者の差分はステージしない。

---

### Task 2: Windows起動手順を初回・通常起動に分けて案内する

**Files:**
- Modify: `README.md:3-17`

**Interfaces:**
- Consumes: Task 1の `setup.bat` のダブルクリック導線、終了コード、起動URL。
- Produces: 初回は`setup.bat`、2回目以降は`start-webui.bat`という具体的なWindows利用手順。

- [ ] **Step 1: READMEのWindows起動セクションを具体文面へ置き換える**

`README.md` の先頭から「`ログに WebUI is ready / OpenCode is ready が出れば OK。`」までを次の内容に置き換える。

```markdown
OpenCode CLI（`opencode serve`）を実行エンジンにした Workspace Manager Web UI。本体はフォークしない。

## 起動（Windows）

1. **初回のみ**、リポジトリルートの `setup.bat` をダブルクリックします。`winget`、Node.js 20以上、OpenCode、web/hostの依存関係、production buildを確認・導入し、完了後にWebUIを起動します。
2. **2回目以降**は `start-webui.bat` をダブルクリックします。prodでは `.next` が欠落しているかソースより古い場合、起動・トレイ/WebUI再起動時に自動buildします。
3. トレイ常駐後、`http://127.0.0.1:3000` を開きます。

`setup.bat` は管理者権限、Firewallルール、Caddy設定を変更しません。通常は失敗時に画面を止めて案内を表示します。`winget` がない場合はMicrosoft Storeから「アプリインストーラー」を入手してください。Node.jsまたはOpenCodeを導入した直後に見つからない場合は、再ログインまたはPC再起動後に `setup.bat` を再実行してください。

セットアップの終了コード:

| コード | 意味 | 復旧方法 |
|---:|---|---|
| 1 | `winget` がない | 「アプリインストーラー」を導入する |
| 2 | Node.js導入失敗 | [nodejs.org](https://nodejs.org/) から手動導入する |
| 3 | Node.jsのPATHが未反映 | 再ログインまたはPC再起動後に再実行する |
| 4 | OpenCode導入失敗またはPATH未反映 | [OpenCode Docs](https://opencode.ai/docs) を参照し、必要なら再ログイン後に再実行する |
| 5 | webの依存関係導入失敗 | ネットワークと `web/package-lock.json` を確認する |
| 6 | web build失敗 | 表示されたビルドエラーとNode.jsバージョンを確認する |
| 7 | build後に`BUILD_ID`がない | ビルドログを確認して再実行する |
| 8 | hostの依存関係導入失敗 | ネットワークと `host/package-lock.json` を確認する |

トラブル時:

```bat
cd host
set OPENCODE_WEBUI_HEADLESS=1
set OPENCODE_WEBUI_NO_BROWSER=1
set OPENCODE_WEBUI_MODE=prod
node src\index.js
```

ログに `WebUI is ready` / `OpenCode is ready` が出れば OK。
```

- [ ] **Step 2: READMEのリンク、コマンド、終了コードの対応を確認する**

Run:

```bat
findstr /n /c:"setup.bat" /c:"Node.js 20" /c:"OpenCode Docs" /c:"| 1 |" /c:"| 8 |" README.md
findstr /n /c:"exit /b 1" /c:"exit /b 2" /c:"exit /b 3" /c:"exit /b 4" /c:"exit /b 5" /c:"exit /b 6" /c:"exit /b 7" /c:"exit /b 8" setup.bat
```

Expected: READMEに初回・通常起動、Node.js 20以上、具体的な復旧先、1〜8の終了コードがあり、`setup.bat`にも同じ1〜8が明示される。

- [ ] **Step 3: 全検証を常駐サーバーなしで実行する**

Run:

```bat
cd web
call npm ci
call npm run lint
call npm run typecheck
call npm test
call npm run build
if not exist .next\BUILD_ID exit /b 1
cd ..\host
call npm ci
call npm test
```

Expected: webのlint、typecheck、Vitest unit test、production build、`BUILD_ID`確認、およびhostのNode組み込みテストがすべて成功する。`npm run dev`、`next dev`、`next start`、`start-webui.bat`は起動しない。

- [ ] **Step 4: 最終差分を確認してREADMEを意味単位でコミットする**

Run:

```bat
cd ..
git status --short
git diff --check
git diff -- README.md setup.bat host/src/setup-bat.test.js
git add README.md
git commit -m "docs: Windows初回セットアップ手順を案内"
git status --short
git diff --check
git log --oneline -2
```

Expected: READMEだけを含む日本語の意味単位コミットが作成され、作業ツリーに意図しない差分がなく、バッチ・テスト・他者の差分は混在しない。

---

## 実装後の受入確認

- [ ] `setup.bat` はリポジトリルートにあり、ダブルクリック可能である。
- [ ] `where winget` が失敗すると日本語の導入案内を表示してコード1で終了する。
- [ ] Nodeが未導入またはメジャーバージョン20未満では、完全なwingetフラグで `OpenJS.NodeJS.LTS` を導入する。
- [ ] OpenCodeがない場合は完全なwingetフラグで `SST.opencode` を試し、winget失敗時だけ `npm install -g opencode-ai` を試す。
- [ ] `SETUP_NONINTERACTIVE=1` の自動テストだけがpauseを省略し、通常実行は失敗時にpauseする。
- [ ] webの`npm ci`、`npm run build`、`.next\BUILD_ID`、hostの`npm ci`を順に成功させた後だけ、既存`start-webui.bat`を`start`で別プロセス起動する。
- [ ] 失敗経路は実際のインストール・常駐起動なしのNodeテストでコード1〜8と復旧メッセージを検証する。
- [ ] READMEは初回の`setup.bat`、通常の`start-webui.bat`、URL、全終了コードと復旧方法を示す。
- [ ] `start-webui.bat`、Firewall、Caddy、管理者権限要求を変更しない。
