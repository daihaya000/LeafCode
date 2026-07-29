# Browser Bridge MCP 実装計画

**仕様:** [`docs/specs/browser-bridge-mcp.md`](../specs/browser-bridge-mcp.md)（承認済み、`d696433`）

**ゴール:** Chrome / Brave の明示共有タブを、トレイhost常駐Brokerとlocal MCPを介して
OpenCodeから安全に取得・操作し、WebUIでペアリング・承認・監査を管理できるようにする。

**基本構成:** `browser-bridge/` を独立Nodeパッケージ兼unpacked extension rootとする。
Brokerはhostから起動されるloopback専用HTTP/WebSocketサーバー、MCPは状態を持たないstdio adapter、
拡張はoutbound WebSocket clientとする。WebUIはBrokerへ直接公開せずhost-only BFFを通す。

**技術:** Node.js 20 ESM、`@modelcontextprotocol/sdk`、`ws`、Manifest V3、Chrome Extension APIs、
Next.js 15、React 19、TypeScript、Vitest / Node test、Testing Library。

## 全体制約

- 実装開始前に各タスクの対象ファイルを再読込し、他セッション差分を混ぜない。
- 各タスクは失敗テスト → 最小実装 → 対象テスト → 差分確認 → 即コミットで完結させる。
- `.bat` / `.cmd` はコメントを含めASCIIのみ、CRLF・BOMなしを維持する。
- `next dev`、watch、対話モード、追加ブラウザの常駐起動をbashで実行しない。
- Brokerは`127.0.0.1`だけにbindし、拡張用device keyと内部MCP / WebUI用credentialを分離する。
- 任意JavaScript、任意selector、Cookie、storage、password/OTP値、cross-origin iframeは公開しない。
- UI実装前にui-ux-designer、実装後にtest-writerとui-ux-reviewerを通し、
  mobile / tablet / desktopの3 viewportを確認する。
- 3ファイル以上・モジュール横断の各実装単位はlead-programmerへ委任し、メインは契約・差分・検証を統合する。

## ディレクトリ構成

```text
browser-bridge/
  package.json
  package-lock.json
  manifest.json
  shared/
    protocol.mjs
    schemas.mjs
    errors.mjs
  broker/
    state.mjs
    policy.mjs
    audit.mjs
    server.mjs
  mcp/
    broker-client.mjs
    server.mjs
  extension/
    background.mjs
    content.js
    popup.html
    popup.mjs
    popup.css
  test/
    *.test.mjs
docs/
  browser-bridge-setup.md
web/src/app/api/host/browser-bridge/
  status/route.ts
  pairing/route.ts
  approvals/route.ts
  approvals/[id]/route.ts
  audit/route.ts
web/src/components/settings/
  BrowserBridgeSettings.tsx
  BrowserBridgeSettings.test.tsx
```

`browser-bridge/` 自体をChrome / Braveの「パッケージ化されていない拡張機能」として読み込む。
`web_accessible_resources` は必要最小限にし、MCP / Brokerソースはページへ公開しない。

---

## Task 1: 共通プロトコルとパッケージ骨格

**Files**

- Create: `browser-bridge/package.json`
- Create: `browser-bridge/package-lock.json`
- Create: `browser-bridge/shared/protocol.mjs`
- Create: `browser-bridge/shared/schemas.mjs`
- Create: `browser-bridge/shared/errors.mjs`
- Create: `browser-bridge/test/protocol.test.mjs`
- Modify: `.gitignore`

**手順**

- [ ] command / result envelope、command state、tool名、error code、上限値を定義する。
- [ ] `protocolVersion`、connection generation、command ID、snapshot generationを必須にする。
- [ ] 入力schemaは未知fieldを拒否し、URL scheme、文字数、payload byte数を境界値テストする。
- [ ] `@modelcontextprotocol/sdk` と `ws` を固定versionで追加し、`npm --prefix browser-bridge test` を定義する。
- [ ] `.gitignore` に `browser-bridge/node_modules/` と一時screenshotディレクトリを追加する。
- [ ] `npm --prefix browser-bridge test` と `git diff --check` を通す。

**完了コミット:** `Browser Bridge共通プロトコルを追加`

---

## Task 2: Brokerの状態機械・ポリシー・監査

**Files**

- Create: `browser-bridge/broker/state.mjs`
- Create: `browser-bridge/broker/policy.mjs`
- Create: `browser-bridge/broker/audit.mjs`
- Create: `browser-bridge/test/broker-state.test.mjs`
- Create: `browser-bridge/test/policy.test.mjs`
- Create: `browser-bridge/test/audit.test.mjs`

**手順**

- [ ] `queued -> awaiting_approval -> dispatched -> succeeded|failed|cancelled` の一方向遷移を実装する。
- [ ] timeout、origin変更、共有解除、connection generation変更で保留commandをcancelする。
- [ ] command IDのdedupe cacheを設け、同じIDを二度dispatchしない。
- [ ] read / low-risk / high-riskを分類し、未共有・未許可・禁止scheme・機密field候補をdefault-denyにする。
- [ ] 監査リングバッファへmetadataだけを保存し、DOM・入力値・画像・credentialを拒否するテストを書く。
- [ ] fake clockで承認期限、command timeout、古いgenerationを決定的に検証する。
- [ ] `npm --prefix browser-bridge test` を通す。

**完了コミット:** `Browser Bridgeの状態機械と安全ポリシーを実装`

---

## Task 3: Broker HTTP/WebSocketとhostライフサイクル

**Files**

- Create: `browser-bridge/broker/server.mjs`
- Create: `browser-bridge/test/broker-server.test.mjs`
- Modify: `host/src/index.js`
- Modify: `host/src/index.test.js`
- Modify: `start-webui.bat`
- Modify: `host/src/bat-encoding.test.js`
- Add: `scripts/setup-messages/` の既存規約に沿うエラー文（必要な場合のみ）

**契約**

- Broker既定URL: `http://127.0.0.1:18766`。`OPENCODE_WEBUI_BROWSER_BROKER_PORT` でportのみ変更可能。
- host起動ごとに内部Bearer tokenを生成し、OpenCode / WebUI子プロセスへ次を渡す。
  - `OPENCODE_WEBUI_BROWSER_BROKER`
  - `OPENCODE_WEBUI_BROWSER_BROKER_TOKEN`
- 拡張は別のdevice keyでWebSocket認証し、内部Bearer tokenを受け取らない。

**手順**

- [ ] Brokerをloopback固定でlistenし、非loopback指定を起動前に拒否する。
- [ ] `/internal/status`、commands、approvals、auditをBearer認証付きHTTPとして実装する。
- [ ] `/extension` WebSocketでpair / authenticate / heartbeat / tab / result messageを処理する。
- [ ] pre-authは短寿命pairing codeだけを受け、成功後はextension originとdevice keyをpinする。
- [ ] message size、接続数、認証試行、heartbeat無音時間、replay nonceを制限する。
- [ ] `startChildren()`より前にBrokerを開始し、終了時は保留commandをcancelしてからcloseする。
- [ ] Broker起動失敗はBrowser Bridgeだけを無効化してhost本体は継続し、秘密を含めずログに理由を出す。
- [ ] `start-webui.bat` にbrowser-bridge依存導入を追加し、既存error code体系を壊さない。
- [ ] `npm --prefix browser-bridge test`、`npm --prefix host test`、`npm run test:encoding` を通す。

**完了コミット:** `トレイhostにBrowser Bridge Brokerを統合`

---

## Task 4: 読取専用MCPツール

**Files**

- Create: `browser-bridge/mcp/broker-client.mjs`
- Create: `browser-bridge/mcp/server.mjs`
- Create: `browser-bridge/test/mcp-server.test.mjs`
- Create: `browser-bridge/test/mcp-stdio.test.mjs`

**手順**

- [ ] stdio MCP serverを作り、stdoutをprotocol frame専用、診断をstderr専用にする。
- [ ] 環境変数のBroker URLがloopbackであることを再検証し、Bearer token欠落時はfail closedにする。
- [ ] `browser_status`、`browser_list_tabs`、`browser_snapshot`、`browser_screenshot` を登録する。
- [ ] MCP schemaと共通schemaの差分を契約テストで検出する。
- [ ] Broker error codeをMCP structured contentへ写し、秘密・port・stackを返さない。
- [ ] Broker未起動、timeout、拡張切断、未共有、approval待ち・拒否をテストする。
- [ ] 承認待ちcommandはBrokerを期限付きpollし、承認後の同一command結果を返す。再tool callによる二重実行を要求しない。
- [ ] 子プロセスでinitialize / tools/list / tools/callを実行し、stdout汚染がないことを確認する。
- [ ] `npm --prefix browser-bridge test` を通す。

**完了コミット:** `Browser Bridgeの読取MCPツールを実装`

---

## Task 5: Manifest V3拡張のペアリングと共有タブ

**Files**

- Create: `browser-bridge/manifest.json`
- Create: `browser-bridge/extension/background.mjs`
- Create: `browser-bridge/extension/popup.html`
- Create: `browser-bridge/extension/popup.mjs`
- Create: `browser-bridge/extension/popup.css`
- Create: `browser-bridge/test/extension-background.test.mjs`
- Create: `browser-bridge/test/manifest.test.mjs`

**手順**

- [ ] 権限を`activeTab`、`scripting`、`storage`と必要なoptional host permissionsに限定する。
- [ ] popupのユーザー操作からpairing code入力、site permission要求、共有開始・停止を行う。
- [ ] device keyは`chrome.storage.local`に保存し、pairing解除時に削除する。
- [ ] Service Worker再開時に認証再接続し、上限付きexponential backoffとheartbeatを適用する。
- [ ] 新規タブを自動共有せず、navigation・tab close・permission revokeをBrokerへ通知する。
- [ ] popupはDESIGN.mdのaccent / surface / label / spacing token相当をCSS custom propertiesで定義し、
  320px幅でも接続・共有・解除が操作できるようにする。
- [ ] Chrome API mockで再接続、共有失効、重複message、storage復元をテストする。
- [ ] manifestに`debugger`、cookies、downloads、`<all_urls>`の必須権限がないことをテストする。

**完了コミット:** `Chrome Brave拡張のペアリングとタブ共有を実装`

---

## Task 6: 安全なDOMスナップショット

**Files**

- Create: `browser-bridge/extension/content.js`
- Create: `browser-bridge/test/snapshot.test.mjs`
- Modify: `browser-bridge/extension/background.mjs`
- Modify: `browser-bridge/shared/protocol.mjs`

**手順**

- [ ] visible / actionable nodeからrole、accessible name、状態、短いtextを抽出する。
- [ ] snapshot generationごとにopaque refを発行し、実selectorやDOM pathをMCPへ返さない。
- [ ] password、OTP、card候補、hidden、script、meta token、storage、通常inputの実値を除外する。
- [ ] node数、depth、text長、総byte数を制限し、truncated reasonを返す。
- [ ] same-origin iframeとopen Shadow DOMを明示pathで扱い、cross-origin / closed rootをskipする。
- [ ] DOM mutation、navigation、frame detachでgenerationを更新し、古いrefを失効する。
- [ ] jsdom fixtureでsecret exclusion、accessibility name、limit、iframe、shadow、stale generationを検証する。
- [ ] `npm --prefix browser-bridge test` を通す。

**完了コミット:** `共有タブの安全なDOMスナップショットを実装`

---

## Task 7: ブラウザ操作ツールと承認強制

**Files**

- Modify: `browser-bridge/extension/content.js`
- Modify: `browser-bridge/extension/background.mjs`
- Modify: `browser-bridge/broker/policy.mjs`
- Modify: `browser-bridge/mcp/server.mjs`
- Create: `browser-bridge/test/actions.test.mjs`
- Create: `browser-bridge/test/approval-flow.test.mjs`

**手順**

- [ ] `browser_click`、`browser_type`、`browser_scroll`、`browser_navigate`、`browser_wait` を追加する。
- [ ] 操作対象は現在generationのrefだけに限定し、実行直前にorigin・element分類・共有状態を再検証する。
- [ ] typeは既定置換、明示時だけ追記とし、password / OTP / card候補へは常に拒否する。
- [ ] navigateは`https:`と許可済みloopback `http:`だけに限定し、origin変更承認後に旧refを全失効する。
- [ ] click後にsubmit / purchase / delete / permission change候補となる要素は毎回承認にする。
- [ ] command IDを拡張側でもdedupeし、結果再送は許しても操作再実行はしない。
- [ ] disconnect / timeout / approval expiry後の遅延commandが実行されないことを統合テストする。
- [ ] `npm --prefix browser-bridge test` を通す。

**完了コミット:** `Browser Bridgeの承認付き操作ツールを実装`

---

## Task 8: host-only BFF管理API

**Files**

- Modify: `web/src/lib/host-control.ts`
- Create: `web/src/lib/browser-bridge.ts`
- Create: `web/src/app/api/host/browser-bridge/status/route.ts`
- Create: `web/src/app/api/host/browser-bridge/pairing/route.ts`
- Create: `web/src/app/api/host/browser-bridge/approvals/route.ts`
- Create: `web/src/app/api/host/browser-bridge/approvals/[id]/route.ts`
- Create: `web/src/app/api/host/browser-bridge/audit/route.ts`
- Create: corresponding `route.test.ts` files

**手順**

- [ ] 全routeで`rejectUnlessLocal`を最初に適用し、remote/private networkからの利用を403にする。
- [ ] Broker URLをenvから解決してloopbackを再検証し、tokenをserver-side Authorizationにだけ付ける。
- [ ] fetch timeout、JSON size、response shapeを制限し、Broker内部errorを一般化する。
- [ ] statusは接続metadataだけ、approvalsはmask済み要約だけ、auditはmetadataだけを返す。
- [ ] pairing codeの生成・失効、approve / deny / revokeをCSRF耐性のあるsame-origin JSON POSTに限定する。
- [ ] token、DOM、入力値、画像、内部stackがAPIレスポンスへ出ないことをテストする。
- [ ] 関連Vitestと`npm --prefix web run typecheck`を通す。

**完了コミット:** `Browser Bridgeのhost-only管理APIを追加`

---

## Task 9: WebUIの接続・承認・監査画面

**事前ルーティング:** ui-ux-designerが、既存設定ナビゲーションとDESIGN.mdに沿って
mobile / tablet / desktopの情報階層、承認カード、危険操作表示、空・切断・error状態を確定する。

**Files**

- Create: `web/src/components/settings/BrowserBridgeSettings.tsx`
- Create: `web/src/components/settings/BrowserBridgeSettings.test.tsx`
- Modify: `web/src/components/settings/SettingsView.tsx`
- Modify: `web/src/components/settings/SettingsView.test.tsx`

**手順**

- [ ] 設定に「ブラウザ」タブを追加し、未設定時も他の設定タブを阻害しないlazy loadにする。
- [ ] 接続状態、ブラウザ種別、共有origin/title、pairing開始・解除を表示する。
- [ ] 承認カードにorigin、tool、対象要約、mask済み入力要約、期限、許可 / 拒否を表示する。
- [ ] 高リスク操作には恒久許可を表示せず、危険色は既存`text-danger` tokenだけを使う。
- [ ] 監査一覧は時刻、tool、origin、結果だけを表示し、DOMや入力本文を描画しない。
- [ ] 画面表示中のみ2秒poll、非表示・unmount・tab background時は停止し、復帰時に即再同期する。
- [ ] loading / empty / disconnected / pending / denied / timeout / broker unavailableをテストする。
- [ ] 44px以上のtap target、keyboard操作、focus、`aria-live`、狭幅での折返しを確認する。
- [ ] test-writerの追加ケース、ui-ux-reviewerの3 viewportレビューを反映する。
- [ ] 関連Vitest、typecheck、lintを通す。

**完了コミット:** `Browser Bridgeの管理と承認UIを追加`

---

## Task 10: OpenCode MCP設定とセットアップ導線

**Files**

- Create: `docs/browser-bridge-setup.md`
- Modify: `README.md`
- Modify: `web/src/components/settings/BrowserBridgeSettings.tsx`
- Modify: `web/src/components/settings/ExtensionsSettings.tsx`（必要な案内リンクのみ）
- Modify: setup関連テスト

**手順**

- [ ] `browser-bridge/` の依存導入、Chrome / Braveでのunpacked load、pairing、共有解除を文書化する。
- [ ] 公式schema準拠のlocal MCP設定を、`command`配列と`{env:...}`参照で提示する。
- [ ] グローバル`opencode.jsonc`を自動変更せず、コピー可能な設定例と再起動必須表示を提供する。
- [ ] OpenCode再起動後、既存MCP設定画面で`browser-bridge`の接続状態を確認する手順を書く。
- [ ] Playwright MCPとの使い分け、禁止ページ、権限、秘密情報、remote利用が既定無効であることを明記する。
- [ ] READMEの`.bat`コードフェンス内とsetup batchに非ASCIIがないことを検証する。
- [ ] `npm run test:encoding`、関連UIテスト、`git diff --check`を通す。

**完了コミット:** `Browser Bridge MCPのセットアップ手順を追加`

---

## Task 11: 統合・セキュリティ・実機検証

**Files**

- Create: `browser-bridge/test/integration.test.mjs`
- Create: `scripts/smoke-browser-bridge.mjs`
- Modify: `package.json`
- Modify: `README.md`（検証コマンド追記のみ）

**手順**

- [ ] mock extension -> Broker -> MCPのinitialize / list / snapshot / action / resultを一連で検証する。
- [ ] forged Origin、wrong token/device key、replay、巨大payload、禁止scheme、stale ref、late resultを拒否する。
- [ ] host / OpenCode / MCPの各再起動、拡張Service Worker休止・再開、tab closeで安全停止することを確認する。
- [ ] Chrome stableとBrave stableでpair、share、snapshot、screenshot、click、type、scroll、navigate、denyを手動確認する。
- [ ] 既存hostを利用してWebUIのmobile / tablet / desktopを確認し、追加サーバーは起動しない。
- [ ] `npm --prefix browser-bridge test`
- [ ] `npm --prefix host test`
- [ ] `npm --prefix web run typecheck`
- [ ] `npm --prefix web run lint`
- [ ] 関連Vitestまたは`npm --prefix web test -- --run <files>`
- [ ] `npm run test:encoding`
- [ ] `node scripts/smoke-browser-bridge.mjs`（既存host接続時のみ）
- [ ] code-reviewerとsecurity-auditor（条件付き承認後）で境界をレビューし、指摘を個別コミットする。

**完了コミット:** `Browser Bridge MCPの統合検証を追加`

## 実装順序と並列化

```text
Task 1
  -> Task 2
  -> Task 3
      -> Task 4
      -> Task 5 -> Task 6 -> Task 7
  -> Task 8
  -> Task 9
  -> Task 10
  -> Task 11
```

- Task 4とTask 5はTask 3のtransport契約確定後に並列化できる。
- Task 8はTask 3のinternal API確定後、Task 6〜7と並列化できる。
- Task 9はTask 8とui-ux-designer成果に依存する。
- test-writerはTask 4 / 7 / 9の境界ごとに投入し、最後へテスト作成を集中させない。

## 完了判定

- 承認済み仕様の受入条件10項目をすべて証跡付きで満たす。
- OpenCode設定schema、MCP protocol、Broker protocol、extension manifestの検証が通る。
- Brokerと管理APIがloopback外から利用できず、全操作が共有タブ・origin・generationへ拘束される。
- password / OTP / card / cross-origin iframe / 禁止scheme / stale commandの負ケースが自動テストされる。
- Chrome / Brave実機とWebUI 3 viewportの確認結果を最終報告へ含める。
- 各変更が意味単位でコミットされ、最終`git status --short`が空である。
