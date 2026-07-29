# Browser Bridge MCP 仕様

## 背景

OpenCodeWebUI から、ユーザーが普段使っている Chrome / Brave のタブ情報を取得し、
ユーザーの許可の下でクリック・入力・スクロール・移動などを実行したい。
Playwright MCP のように独立ブラウザを起動する方式では、既存プロファイルのログイン状態や
ユーザーが現在見ているタブを安全に共有しにくい。

ブラウザ拡張と MCP は代替関係ではない。拡張をブラウザ内の実行層、MCP を OpenCode へ
ツールを公開する境界、WebUI を接続・承認・監査の管理面として併用する。

## 目的

- Chrome / Brave 共通の Manifest V3 拡張から、明示的に接続したタブを取得・操作する。
- OpenCode にはローカル MCP サーバー経由で型付きの最小ツールを公開する。
- トレイ host に常駐 Broker を置き、OpenCode / MCP の再起動とブラウザ接続の寿命を分離する。
- WebUI で接続状態、対象タブ、許可範囲、保留中の承認、操作履歴を確認できるようにする。
- 誤操作、プロンプトインジェクション、秘密情報流出、LAN からの不正利用を既定で拒否する。

## 初期スコープ

- Windows 上の既存 OpenCodeWebUI host と同一端末で動く Chrome / Brave。
- 開発者モードで読み込む未パッケージ拡張。ストア配布・自動更新は後続フェーズ。
- Content Script と `chrome.tabs` / `chrome.scripting` / `activeTab` を使う DOM 操作。
- ユーザーが拡張 UI から明示的に共有したタブだけを対象にする。
- OpenCode の local stdio MCP と、WebUI のローカル管理画面。
- 1 host・1ブラウザプロファイル・1拡張接続を初期上限とする。

## 非目標

- `chrome.debugger` / CDP によるブラウザ全体のデバッグ、Cookie・認証ヘッダー・通信本文の取得。
- `chrome://`、Chrome Web Store、他の拡張ページ、OSネイティブダイアログの操作。
- CAPTCHA、決済、パスワード、二要素認証の自動突破。
- 任意 JavaScript、任意 CSS selector、任意 Chrome API のモデルへの公開。
- 別PC上のブラウザ操作、複数利用者共有、Chrome Web Store / Edge Add-ons への公開。
- Playwright MCP の置き換え。隔離ブラウザが適する作業には Playwright MCP を使う。

## 構成

```text
OpenCode
  -> local stdio MCP server
  -> 127.0.0.1 Browser Bridge Broker (tray host)
  -> authenticated WebSocket
  -> Chrome / Brave Manifest V3 extension
  -> content script
  -> explicitly shared tab

OpenCodeWebUI
  -> host-only Browser Bridge management API
  -> Broker status / approval / audit
```

### Browser Bridge Broker

- トレイ host と同じライフサイクルで起動・停止し、`127.0.0.1` のみで待ち受ける。
- 拡張接続、ペアリング、共有タブ、コマンドキュー、タイムアウト、承認、監査を管理する。
- MCP サーバーと WebUI は Broker の loopback API を利用し、拡張へ直接接続しない。
- host は起動ごとに内部クライアント用 bearer credential を生成し、子プロセスの OpenCode / WebUI
  だけへ環境変数で渡す。Broker は MCP / WebUI の全要求でこれを検証する。
- メモリ上の短期状態を正とし、秘密情報以外の設定だけを既存 host データ領域へ保存する。
- host 終了時は保留中コマンドを失敗にし、WebSocket と待機中リクエストを閉じる。

### Chrome / Brave 拡張

- Manifest V3 の Service Worker、Content Script、Popup または Side Panel で構成する。
- Broker へ outbound WebSocket 接続する。切断時は上限付き exponential backoff で再接続する。
- Service Worker 休止・再開後も `chrome.storage.local` のペアリング情報から再接続する。
- 対象タブは拡張 UI で共有開始・停止する。新しいタブを自動共有しない。
- DOM からアクセシビリティ指向のスナップショットを生成し、一時的な opaque `ref` を付ける。
- 操作は Broker が発行した command ID ごとに一度だけ実行し、重複要求を再実行しない。

### MCP サーバー

- MCP SDK を使う local stdio server とし、stdout には MCP フレーム以外を書かない。
- ログは stderr に出し、秘密情報・DOM本文・入力値を記録しない。
- Broker 未起動、拡張未接続、未共有、承認拒否、timeout を区別した構造化エラーを返す。
- MCP プロセスは状態を保持せず、再起動しても Broker の接続状態を利用できる。

### OpenCodeWebUI

- Browser Bridge アドオンまたは設定セクションに、接続状態、ブラウザ種別、共有タブ、
  許可ドメイン、承認要求、直近監査イベントを表示する。
- 管理 API は `rejectUnlessLocal` 相当で host-only とし、LAN/VPN へ公開しない。
- DOMスナップショット、フォーム入力値、スクリーンショットを管理 API の一覧レスポンスへ含めない。
- MCP 設定画面では既存の一覧・有効化 UI を利用する。初期実装はユーザー設定を自動書換えせず、
  正しい `mcp` shape の設定例とセットアップコマンドを提供する。

## MCP ツール契約

初期ツールは次に限定する。すべての入力を JSON Schema で検証し、未知フィールドを拒否する。

| ツール | 概要 | 承認 |
|---|---|---|
| `browser_status` | Broker・拡張・共有状態を取得 | 不要 |
| `browser_list_tabs` | 共有済みタブの opaque ID、title、origin を取得 | 不要 |
| `browser_snapshot` | 共有タブの可視テキストと操作可能要素を取得 | 読取ポリシー依存 |
| `browser_screenshot` | 共有タブの可視領域を画像化 | 毎回またはドメイン許可 |
| `browser_click` | snapshot の `ref` をクリック | 操作ポリシー依存 |
| `browser_type` | `ref` の入力欄へ文字列を入力 | 毎回 |
| `browser_scroll` | 規定方向・規定量でスクロール | 操作ポリシー依存 |
| `browser_navigate` | 許可 scheme / origin の URL へ移動 | origin変更時は毎回 |
| `browser_wait` | 時間上限またはDOM条件まで待機 | 不要 |

- `tabId` は Chrome の数値 tab ID を直接公開せず、接続世代に紐づく opaque ID とする。
- `ref` は snapshot 世代に紐づける。DOM変更・移動・再読込後の stale `ref` は失敗させる。
- `browser_type` は既定で既存値を置換し、追記は明示フラグで指定する。
- URL は `https:` と、設定で許可した loopback の `http:` だけを許可する。
- `javascript:`、`data:`、`file:`、`chrome:`、`chrome-extension:` は拒否する。
- screenshot はサイズ上限を設け、MCP image content または一時ファイル参照で返す。

## スナップショットとデータ最小化

- 可視・操作可能なDOMを中心に、role、accessible name、状態、短い可視テキストを返す。
- `input[type=password]`、クレジットカード候補、OTP候補、hidden要素、Cookie、localStorage、
  sessionStorage、ページ内 script、meta token は返さない。
- 通常の入力欄も値は既定で `hasValue` のみ返し、実値取得は初期スコープ外とする。
- 最大ノード数、最大テキスト長、最大応答byte数を設け、超過時は truncation を明示する。
- クロスオリジン iframe 内部は取得・操作しない。同一オリジン iframe は別 document path として識別する。
- Shadow DOM は open root のみ対象とし、closed root は対象外とする。

## ペアリングと認証

1. host が短寿命・一回限りのペアリングコードを生成し、ローカル WebUI に表示する。
2. ユーザーが拡張 UI にコードを入力する。
3. Broker は拡張ID、ブラウザプロファイル識別子、ランダムな端末鍵を紐づける。
4. 拡張は端末鍵を `chrome.storage.local` に、host は検証情報をユーザーデータ領域に保存する。
5. WebSocket 接続直後の認証メッセージを検証するまで、Broker はコマンドを配送しない。

- WebSocket は loopback bind とし、許可した `chrome-extension://<id>` Origin だけを受け付ける。
- 秘密をURL query、ログ、Git管理ファイル、WebUIレスポンスへ含めない。
- ペアリング解除時は鍵を失効し、共有タブと承認ルールを破棄する。
- 連続失敗、再送、巨大メッセージ、過剰接続にはrate limitとサイズ上限を適用する。

## 承認とポリシー

- 初期状態はタブ未共有、domain未許可、操作 default-deny とする。
- ページ内容は命令ではなく不信入力として扱い、ページ内の「承認不要」等をポリシーへ反映しない。
- 読取、低リスク操作、高リスク操作を分離する。
- パスワード、OTP、決済、送信、購入、削除、権限変更、ファイルアップロード候補は常に拒否または毎回承認とする。
- 承認には origin、操作種別、対象要素名、入力値のマスク済み要約、期限を表示する。
- 承認は単一操作、同一originの短時間セッション、恒久domain規則から選べるが、
  高リスク操作に恒久許可を適用しない。
- timeout、タブ移動、origin変更、対象ref変更、拡張切断時は承認を失効する。
- リモート公開を有効にしたWebUIからブラウザツールを利用する場合は初期状態で無効とし、
  host側の明示opt-inと拡張側承認の両方を要求する。

## 監査

- `timestamp`、command ID、tool名、origin、結果、承認方法、所要時間をリングバッファへ保存する。
- DOM本文、スクリーンショット、入力文字列、ペアリング鍵は監査ログへ保存しない。
- WebUIには直近イベントのみ表示し、初期実装ではディスクへの操作内容永続化を行わない。
- Broker・拡張切断、認証失敗、rate limit、拒否も監査対象にする。

## エラー契約

| code | 条件 |
|---|---|
| `BROKER_UNAVAILABLE` | host / Broker に接続できない |
| `EXTENSION_DISCONNECTED` | 拡張が未接続 |
| `NOT_PAIRED` | ペアリングされていない |
| `TAB_NOT_SHARED` | 対象タブが未共有または失効 |
| `STALE_REFERENCE` | snapshot世代とrefが一致しない |
| `APPROVAL_REQUIRED` | 承認待ち |
| `APPROVAL_DENIED` | ユーザーが拒否または期限切れ |
| `POLICY_BLOCKED` | scheme・domain・要素・操作ポリシーで拒否 |
| `COMMAND_TIMEOUT` | 規定時間内に完了しない |
| `PAYLOAD_TOO_LARGE` | 入出力上限超過 |

エラーには秘密情報、入力値、内部ポート、実ブラウザtab ID、スタックトレースを含めない。

## 設定

OpenCode の設定 shape は公式 schema に従い、local MCP の `command` は文字列配列とする。
概念例は次のとおりで、実パスはセットアップ時に解決する。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browser-bridge": {
      "type": "local",
      "command": ["node", "<absolute-path>/mcp/browser-bridge/index.mjs"],
      "enabled": true,
      "environment": {
        "OPENCODE_WEBUI_BROWSER_BROKER": "{env:OPENCODE_WEBUI_BROWSER_BROKER}",
        "OPENCODE_WEBUI_BROWSER_BROKER_TOKEN": "{env:OPENCODE_WEBUI_BROWSER_BROKER_TOKEN}"
      }
    }
  }
}
```

設定変更は OpenCode 再起動後に反映される。BrokerのURLと認証秘密の実値は設定へ書かず、
hostがOpenCode起動時に設定した環境変数をOpenCodeの `{env:...}` 展開でMCPへ引き渡す。
credentialはhost再起動ごとにローテーションする。

## フェーズ

1. Brokerのプロトコル、状態機械、認証、モック拡張を実装する。
2. MCPサーバーと読取ツールを実装し、モックBrokerとの契約テストを追加する。
3. Chrome / Brave拡張のペアリング、共有、snapshotを実装する。
4. click / type / scroll / navigate と stale ref 防止を実装する。
5. WebUIの状態・承認・監査UIを実装する。
6. セキュリティ回帰、Chrome / Brave実機、OpenCode統合E2Eを実施する。
7. 任意の後続としてストア配布、複数プロファイル、CDP読取専用機能を別仕様で検討する。

## 検証

- host: `npm --prefix host test`
- web: `npm --prefix web run typecheck`、関連Vitest、`npm --prefix web run lint`
- MCP: protocol契約、stdout汚染、timeout、再接続、Broker未起動の自動テスト
- extension: Manifest検証、Service Worker再起動、Content Script単体テスト
- 実機: 最新安定版Chrome / Braveでペアリング、共有解除、再接続、各ツール、拒否を確認
- セキュリティ: loopback以外のbind拒否、Origin偽装、鍵不正、replay、stale ref、巨大payload、
  禁止scheme、password/OTP候補、cross-origin iframe、未承認操作を確認
- 配布前に既存の `npm run test:encoding` も実行する。

## 受入条件

1. host再起動後、拡張が認証付きで再接続でき、未ペアリング拡張は接続できない。
2. ユーザーが共有したChrome / Braveタブだけが `browser_list_tabs` に現れる。
3. snapshotが秘密入力値を含まず、世代の古いrefによる操作が拒否される。
4. click、type、scroll、navigateが承認ポリシーに従い、重複配送で二重実行されない。
5. OpenCodeからMCPツールを呼べ、MCP再起動後も拡張を再ペアリングせず利用できる。
6. WebUIで接続、共有、承認、拒否、直近監査を確認できる。
7. Broker・管理APIはloopback外から利用できず、リモート利用は明示opt-inなしでは拒否される。
8. Chrome内部ページ、禁止scheme、password/OTP候補、cross-origin iframe操作が拒否される。
9. Broker・拡張切断、timeout、host終了時に処理が停止し、保留操作が後から実行されない。
10. host / web / MCP / extensionの自動テストとChrome / Brave実機スモークが通る。
