# Browser Bridge MCP セットアップ手順

# Browser Bridge MCP セットアップ

Chrome / Brave の現在のタブを OpenCode から安全に取得・操作するためのセットアップ手順です。

## 概要

Browser Bridge は次の 4 つの要素で構成されます。

| 要素 | 役割 |
|------|------|
| `browser-bridge/broker/` | トレイ host 内で起動する loopback HTTP/WebSocket サーバー。ペアリング・共有タブ・承認・監査を管理 |
| `browser-bridge/mcp/` | OpenCode へツールを公開する local stdio MCP サーバー。状態を持たず、Broker を経由して拡張と通信 |
| Chrome / Brave 拡張 | Manifest V3 の Service Worker + Popup。Broker へ outbound WebSocket 接続し、明示共有タブの snapshot / 操作を実行 |
| WebUI 管理画面 | 接続状態・ペアリング・承認・監査を表示（host-only BFF 経由） |

## 前提条件

- Windows 上の OpenCodeWebUI（`start-webui.bat` で起動済み）
- Chrome または Brave（最新安定版）
- 同一端末で動作（別 PC のブラウザは対象外）

## 1. 依存関係のインストール

`browser-bridge/` は独立した Node パッケージです。初回のみ依存関係を導入します。

```bat
cd browser-bridge
npm ci
```

MCP を有効化する前にこの手順を一度実行してください。

## 2. 拡張機能の読み込み（Chrome / Brave）

`browser-bridge/` ディレクトリ自体を unpacked 拡張として読み込みます。

### Chrome

1. `chrome://extensions` を開く
2. 右上の「デベロッパー モード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. リポジトリルートの `browser-bridge/` ディレクトリを選択
5. 拡張機能一覧に **OpenCode WebUI Browser Bridge** が追加される

### Brave

1. `brave://extensions` を開く
2. 右上の「デベロッパー モード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. リポジトリルートの `browser-bridge/` ディレクトリを選択

> **注意:** 拡張機能のアイコンはアドレスバー右のパズルピースアイコンからピン留めするとアクセスしやすくなります。

## 3. ペアリング

拡張機能とトレイ host の Broker を接続します。

1. トレイ host が起動していることを確認する（`start-webui.bat` 実行中）
2. ブラウザの拡張機能アイコン（パズルピース）→ **OpenCode WebUI Browser Bridge** をクリック
3. WebUI を開く（`http://127.0.0.1:3000`）
4. 設定 → 拡張機能にある **Browser Bridge 承認**カードで「ペアリングコードを生成」をクリック
5. 表示されたコードを拡張機能の popup 内「Pairing code」欄に入力
6. 「Pair extension」をクリック
7. popup のステータスが `Connected to local Broker` になれば成功

### ペアリングの仕組み

- ペアリングコードは 1 回限り・5 分で期限切れ
- 成功後、拡張機能は `chrome.storage.local` に device key を保存し、次回以降は自動再接続
- トレイ host 再起動ごとに新しい内部 credential が生成されるが、host はローカルにペアリング情報を保持するため再ペアリングは不要
- OpenCode の再起動、拡張 Service Worker の休止・再開、またはトレイ host の再起動後も自動再接続する
- ペアリング解除は拡張 popup の「Forget this connection」から

## 4. タブの共有

ペアリング後、操作したいタブを明示的に共有します。

1. 共有したいタブをアクティブにする
2. 拡張機能の popup を開く
3. 「Share active tab」をクリック
4. 初回はサイトの権限許可ダイアログが表示されるので「許可」をクリック
5. popup のリストに共有タブが追加される

### 共有の制限

- 既定では新規タブは自動共有されない。都度「Share active tab」が必要（下記「自動共有」を有効にした場合を除く）
- 既に共有したままのタブはhost再起動後に拡張が再通知する。タブを閉じた・originが変わった・明示解除した場合だけ再共有が必要
- タブを閉じる・ナビゲーションが発生すると自動で共有解除される
- 共有できるのは `https:` および loopback `http:`（localhost / 127.0.0.1）のページのみ
- `chrome://`、`chrome-extension://`、`file://`、`data:`、`javascript:` は共有不可

### 共有解除

- 拡張 popup の「Stop sharing」ボタンで個別解除
- 拡張 popup の「Forget this connection」で全タブ共有解除 + ペアリング解除
- タブを閉じる・ナビゲーションでも自動解除

### 自動共有（オプション・既定オフ）

毎回「Share active tab」をクリックする代わりに、閲覧中のタブを自動的に共有できます。

1. 拡張 popup の「Auto-share every active tab」チェックボックスを ON にする
2. 初回のみ、`https://*/*`・`http://localhost/*`・`http://127.0.0.1/*` への広範なサイト権限ダイアログが表示されるので「許可」をクリック
3. 以降、`https:` または loopback `http:` の対象タブをアクティブにする・読み込みが完了するたびに自動共有される（追加の承認ダイアログは出ない）

> **セキュリティ上の注意:** この機能は**既定で無効**です。有効化すると一度だけ広範なサイト権限を許可し、以後は閲覧するすべての対象タブがユーザーの再確認なしに共有されます。共有そのものは default-deny の操作承認フローに影響しません（`browser_type` / `browser_scroll` / `browser_navigate` / `browser_screenshot` は引き続き毎回承認が必要）が、`browser_snapshot` によるページ内容の取得は共有された時点で可能になります。信頼できない・機密情報を含むタブを開いたままにする場合は無効のままにしてください。チェックボックスを OFF にすればいつでも無効化できます（既に共有済みのタブの共有はそのまま維持され、新規の自動共有だけが止まります）。

### 自動共有の制限

- 手動共有と同じ scheme 制限（`https:` および loopback `http:` のみ）が適用される
- タブが `active: true` の間のみ対象。バックグラウンドタブは自動共有されない
- 既に共有済みのタブは重複共有されない

## 5. OpenCode MCP 設定

OpenCode の設定ファイル（`opencode.json` / `opencode.jsonc`）に Browser Bridge MCP を追加します。

### 自動インストール（推奨）

`browser-bridge/scripts/install-mcp.mjs` が、設定ファイル内の**既存コメントや他の設定を一切壊さずに** `mcp.browser-bridge` エントリだけを追加・更新・削除します（VS Code の設定編集と同じ仕組みの `jsonc-parser` を利用）。

```bat
scripts\install-browser-bridge-mcp.bat
```

または:

```bat
npm run install:browser-bridge-mcp
```

- 既定ではグローバル設定（`~/.config/opencode/opencode.jsonc`、無ければ新規作成）を対象にします
- 既に別内容の `browser-bridge` エントリがある場合は上書きせず終了します（`--force` を付けると上書き）
- 主なオプション: `--scope=project`（カレントディレクトリの `opencode.json`/`opencode.jsonc` を対象）、`--path=<file>`（対象ファイルを直接指定）、`--dry-run`（書き込まずに変更内容だけ表示）、`--uninstall`（エントリを削除）
- 対象ファイルの JSONC 構文が壊れている場合は何も書き込まずにエラー終了します
- 実行後は OpenCode の再起動が必要です（下記手順6）

### 手動設定

自動インストールを使わない場合は、設定例を手動で追記できます。

### 設定例

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browser-bridge": {
      "type": "local",
      "command": ["node", "<absolute-path>/browser-bridge/mcp/server.mjs"],
      "enabled": true,
      "environment": {
        "OPENCODE_WEBUI_BROWSER_BROKER": "{env:OPENCODE_WEBUI_BROWSER_BROKER}",
        "OPENCODE_WEBUI_BROWSER_BROKER_TOKEN": "{env:OPENCODE_WEBUI_BROWSER_BROKER_TOKEN}"
      }
    }
  }
}
```

### 記述ルール

- `command` は**文字列配列**（`"command": "node ..."` の文字列形式は不可）。OpenCode 公式 schema に従い配列で指定する
- `<absolute-path>` は実際の絶対パスに置き換える（例: `C:\Users\me\OpenCodeWebUI\browser-bridge\mcp\server.mjs`）
- `environment` の値は `{env:...}` 構文で環境変数を参照する。**実値（URL・token）を設定ファイルに直接書かない**
- Broker の URL と token はトレイ host が OpenCode 起動時に環境変数として設定する。host 再起動ごとに token はローテーションされる
- 設定変更後は OpenCode の再起動が必要

### 設定ファイルの場所

| スコープ | パス |
|----------|------|
| グローバル | `~/.config/opencode/opencode.jsonc`（Windows では `%USERPROFILE%\.config\opencode\opencode.jsonc`） |
| プロジェクト | リポジトリルートの `opencode.json` / `opencode.jsonc` |

> **注意:** 手動設定の場合、設定ファイルは自動変更されません。上記の設定例をコピーして手動で追加してください（自動インストールを使う場合は不要です）。

## 6. OpenCode 再起動

MCP 設定の変更を反映するには OpenCode の再起動が必要です。

- トレイアイコンを右クリック → 「Restart OpenCode」
- またはトレイアイコンを右クリック → 「Quit」してから `start-webui.bat` を再実行

再起動後、OpenCode の MCP 設定画面で `browser-bridge` の状態が `connected` になっていることを確認してください。

## 7. 動作確認

OpenCode から次のツールを呼び出して動作を確認します。

| ツール | 確認内容 |
|--------|----------|
| `browser_status` | Broker・拡張の接続状態とペアリング状態を返す |
| `browser_list_tabs` | 共有済みタブの opaque ID・title・origin を返す |
| `browser_snapshot` | 共有タブの可視テキストと操作可能要素を返す（秘密入力値は含まない） |
| `browser_screenshot` | 共有タブの可視領域を画像化（承認が必要） |
| `browser_type` | 入力欄へ文字列入力（毎回承認が必要） |
| `browser_scroll` | 上下左右にスクロール |
| `browser_navigate` | 許可された URL へ移動（origin 変更時は毎回承認） |

### 承認フロー

操作ツール（type / scroll / navigate / screenshot）は既定で承認が必要です。

1. OpenCode がツールを呼び出すと `APPROVAL_REQUIRED` が返る
2. WebUI の設定 → 拡張機能に承認カードが表示される
3. origin と操作種別を確認
4. 「許可」または「拒否」を選択
5. 許可された操作だけがブラウザで実行される

承認は単一操作だけに有効です。拒否・共有解除・拡張切断では保留中の承認は失効します。

### Chrome / Brave 実機スモークチェックリスト

Chrome stable と Brave stable の**それぞれ**で、テスト用の HTTPS ページまたは loopback HTTP ページを使って以下を確認します。実サイトの秘密情報を含むページは使用しません。

- [ ] unpacked 拡張を読み込み、ペアリングコードで接続できる
- [ ] 明示共有するまで `browser_list_tabs` にタブが表示されない
- [ ] 共有後に `browser_snapshot` で title、origin、可視テキスト、opaque ref を取得できる
- [ ] `browser_screenshot`、`browser_type`、`browser_scroll`、`browser_navigate` は承認カードを表示し、許可後に一度だけ実行される
- [ ] 承認カードで「拒否」を選ぶと、操作が実行されず `APPROVAL_DENIED` になる
- [ ] snapshot取得後にページを再読込し、古い ref の click/type が `STALE_REFERENCE` になる
- [ ] 共有解除、拡張無効化、またはタブを閉じた後、保留中の承認・commandが後から実行されない
- [ ] password/OTP/カード番号候補の入力、禁止 scheme、cross-origin iframe 操作が拒否される
- [ ] WebUI をLANアドレスから開いた場合、Browser Bridgeの承認・ペアリングAPIが403で拒否される
- [ ] 「Auto-share every active tab」を OFF のままにした場合、新規タブが自動共有されない
- [ ] 「Auto-share every active tab」を ON にすると初回のみ広範なサイト権限ダイアログが出て、以後は対象タブが確認なしに自動共有される

確認したブラウザの版数、実施日、失敗した項目はリリース記録に残してください。

## 8. Playwright MCP との使い分け

Browser Bridge は Playwright MCP の代替ではなく、目的が異なります。

| 観点 | Browser Bridge | Playwright MCP |
|------|---------------|----------------|
| ブラウザ | ユーザーが普段使っている Chrome / Brave | 独立した隔離ブラウザ（Chromium / Firefox / WebKit） |
| ログイン状態 | 既存プロファイルの Cookie / セッションをそのまま利用 | 別プロファイル。ログイン状態は引き継がない |
| タブ | ユーザーが明示共有したタブのみ | Playwright が開いたページすべて |
| 操作対象 | 現在のブラウザ画面 | ヘッドレスまたは独立ブラウザ |
| セキュリティ | 明示共有 + 承認 + default-deny | 隔離ブラウザ内で全操作可能 |
| 適した用途 | ログイン済みサイトの操作、現在見ているページの取得 | E2E テスト、スクレイピング、隔離環境での自動化 |

**隔離ブラウザが適する作業（E2E テスト・スクレイピング・CI）には Playwright MCP を使用してください。**

## 9. セキュリティと制限

### 既定で安全

- Broker は `127.0.0.1` のみで待ち受け。LAN/VPN からは到達不可
- 拡張の WebSocket 接続は `chrome-extension://<id>` Origin のみ許可
- 内部 API は host 生成の Bearer token で認証。token は host 再起動ごとにローテーション
- ペアリングコードは 1 回限り・5 分で失効
- 全操作は default-deny。明示的な共有と承認が必要

### データ最小化

- snapshot は可視・操作可能な DOM のみ。password / OTP / カード候補 / hidden 要素は除外
- 通常の入力欄も値は `hasValue`（値の有無）のみ返し、実値は返さない
- クロスオリジン iframe 内部は取得・操作しない
- iframe と Shadow DOM の内部は対象外
- 最大ノード数 100、最大テキスト長 8,000 文字、最大 payload 256 KB

### 禁止操作

- `chrome://`、`chrome-extension://`、`file://`、`data:`、`javascript:` へのナビゲーション
- password / OTP / カード番号候補への入力
- クロスオリジン iframe の操作
- Cookie / localStorage / sessionStorage の取得
- 任意 JavaScript の実行
- `chrome.debugger` / CDP の利用

### エラーコード

| コード | 意味 |
|--------|------|
| `BROKER_UNAVAILABLE` | host / Broker に接続できない |
| `EXTENSION_DISCONNECTED` | 拡張が未接続 |
| `NOT_PAIRED` | ペアリングされていない |
| `TAB_NOT_SHARED` | 対象タブが未共有または失効 |
| `STALE_REFERENCE` | snapshot 世代と ref が一致しない |
| `APPROVAL_REQUIRED` | 承認待ち |
| `APPROVAL_DENIED` | ユーザーが拒否または期限切れ |
| `POLICY_BLOCKED` | scheme / domain / 要素 / 操作ポリシーで拒否 |
| `COMMAND_TIMEOUT` | 規定時間内に完了しない |
| `PAYLOAD_TOO_LARGE` | 入出力上限超過 |

### リモート公開時の注意

WebUI をリモート公開している場合、Browser Bridge の管理 API は既定で host-only です。リモートからブラウザツールを利用するには、host 側の明示的な opt-in と拡張側の承認の両方が必要です。初期状態では無効です。

## 10. トラブルシューティング

| 症状 | 原因と対処 |
|------|-----------|
| popup に `Not paired` と表示される | ペアリングコードを入力して「Pair extension」をクリックする。コードは WebUI 設定 → ブラウザ セクションで生成 |
| popup に `Paired; reconnecting...` と表示される | Broker が起動しているか確認。`start-webui.bat` が実行中であることを確認 |
| `BROKER_UNAVAILABLE` が返る | トレイ host が起動しているか確認。host 再起動後に OpenCode も再起動する |
| `EXTENSION_DISCONNECTED` が返る | 拡張機能の popup を開き、接続状態を確認。`chrome://extensions` で拡張が有効か確認 |
| `STALE_REFERENCE` が返る | ページが変更された可能性がある。再度 `browser_snapshot` を呼び出して新しい ref を取得 |
| 拡張機能が読み込めない | `chrome://extensions` でデベロッパーモードが ON か確認。`browser-bridge/manifest.json` が存在するか確認 |
| サイト権限のダイアログが出ない | 拡張機能の popup を閉じて再度開く。`chrome://extensions` で拡張の詳細 →「サイトへのアクセス」を確認 |

## 参考

- [Browser Bridge MCP 仕様](./specs/browser-bridge-mcp.md)
- [OpenCode MCP 設定](https://opencode.ai/docs/mcp)
- [Playwright MCP](https://playwright.dev/mcp/)
