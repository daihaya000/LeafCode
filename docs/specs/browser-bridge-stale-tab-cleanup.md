# Browser Bridge 共有タブのクリーンアップ仕様

## 背景

Browser Bridge は、ユーザーが明示的に共有したブラウザタブを拡張機能が Broker に
通知し、Broker が WebUI からの操作（snapshot / screenshot / click / type / scroll /
navigate）を拡張機能へ中継する仕組み。共有状態は両端で保持される:

- 拡張機能側: `state.sharedTabs`（`chrome.storage.local` に永続化）。
  `browserTabId`（実際の Chrome タブ ID）を含む。
- Broker 側: `sharedTabs` Map（メモリのみ）。

ブラウザタブを閉じたときの正常経路は `chrome.tabs.onRemoved` → `unshare()` →
`tab_unshared` 送信 → Broker 側 `sharedTabs.delete()` であり、これは実装済み。

しかし **WebSocket 切断中 / ブラウザ再起動後** に閉じたタブが両端の共有状態に
残り続ける潜在ケースがある:

1. **ブラウザ再起動後のファントムタブ（主問題）**
   拡張機能は `chrome.storage.local` に `sharedTabs` を永続化する。
   ブラウザを再起動すると、起動前に共有していたタブの `browserTabId` は
   存在しなくなっている（タブは復元されない、または別の ID で復元される）。
   拡張機能が Broker に再接続し `authenticated` を受けると、現在のコードは
   `for (const tab of Object.values(state.sharedTabs)) send({ type: 'tab_shared', tab });`
   を無条件で実行し、**存在しない `browserTabId` を持つタブを再送してしまう**。
   Broker はこれを `sharedTabs` に載せるが、以降 snapshot / screenshot /
   click 等の操作は全て `chromeApi.tabs.sendMessage(shared.browserTabId, ...)`
   で失敗する。`tab_unshared` は送られないため、Broker 側にも WebUI にも
   操作不能なファントムタブが永遠に残り続ける。

2. **WebSocket 切断中の close（副次）**
   拡張機能のソケットが切断中にブラウザタブが閉じられた場合、`onRemoved` は
   発火して `unshare()` が `state.sharedTabs` から削除・永続化するが、
   `send({ type: 'tab_unshared', tabId })` は `socket?.readyState === OPEN` で
   ないため黙って捨てられる。その後再接続すると `authenticated` 受信時の
   再送からは除外される（state から削除済み）ため、結果的に解決する。
   ただし Broker 側は close ハンドラで `sharedTabs.clear()` するため、
   切断中はそもそも Broker 側にも残っていない。**この経路は現状で自己解決する。**

したがって修正すべきは **ケース1（ブラウザ再起動後のファントムタブ）** のみ。

## 目的

1. 拡張機能が Broker に再接続し `authenticated` を受け取った際、
   永続化された `sharedTabs` の各 `browserTabId` が実際に存在するか検証する。
2. 存在しない `browserTabId` を持つ共有タブを、`tab_shared` 再送の前に
   `tab_unshared` で削除する。`tab_shared` 再送は有効なタブのみ行う。
3. 検証・削除に既存の `unshare()` 経路を使い、新しい削除ロジックを作らない。

## 対象と非対象

- 対象:
  - `browser-bridge/extension/background.mjs`
    - `authenticated` メッセージハンドラ（`tab_shared` 再送の前に検証を挿入）。
    - 新規 `pruneStaleSharedTabs()` 関数。
  - `browser-bridge/test/extension-background.test.mjs`
    - 既存「resyncs shared tabs...」テストのモックに `tabs.get` を追加
      （検証で使うため。タブが存在することを返す）。
    - 新規テスト: 存在しない `browserTabId` が `tab_unshared` で削除され、
      存在するものは `tab_shared` で再送されること。
- 非対象:
  - Broker 側（`browser-bridge/broker/server.mjs`）。
    close ハンドラで `sharedTabs.clear()` しており、再送される
    `tab_shared` は有効なもののみになるため変更不要。
  - 定期健全性チェック（`setInterval` による `browserTabId` 検証）。
    Manifest V3 の service worker はアイドルで停止するため `setInterval` は
    停止中に動かず、起動時（= `authenticated` 時）の検証で十分。
  - `chrome.tabs.onRemoved` / `onUpdated` リスナー（現状維持）。
  - WebUI 側（`BrowserBridgeSettings.tsx` / `BrowserBridgeApprovals.tsx`）。

## 設計

### `pruneStaleSharedTabs()`

新規関数。`authenticated` 受信時に `tab_shared` 再送の前に呼ぶ。

```js
async function pruneStaleSharedTabs() {
  if (typeof chromeApi.tabs.get !== 'function') return;
  const stale = [];
  for (const [tabId, shared] of Object.entries(state.sharedTabs)) {
    try {
      const tab = await chromeApi.tabs.get(shared.browserTabId);
      if (!tab?.id) throw new Error('tab gone');
    } catch {
      stale.push(tabId);
    }
  }
  for (const tabId of stale) await unshare(tabId);
}
```

- `chromeApi.tabs.get` が無い場合はスキップ（旧テスト互換のフォールバック。
  本番の Chrome API には常に存在する）。
- `tabs.get` が reject / `tab?.id` が falsy の場合は stale と判定。
- 既存の `unshare(tabId)` を呼ぶ。`unshare` は:
  - `state.sharedTabs[tabId]` を削除。
  - `chrome.storage.local` へ永続化。
  - `send({ type: 'tab_unshared', tabId })` を送信
    （この時点でソケットは OPEN なので確実に届く）。
- 新しい削除経路を作らず、既存の `unshare` に委ねることで
  永続化・送信・ログの一貫性を保つ。

### `authenticated` ハンドラの修正

現在:

```js
if (message.type === 'authenticated') {
  connectionGeneration = message.connectionGeneration;
  handledCommandIds = new Set();
  reconnectDelay = 500;
  pairingRequested = false;
  for (const tab of Object.values(state.sharedTabs)) send({ type: 'tab_shared', tab });
}
```

修正後:

```js
if (message.type === 'authenticated') {
  connectionGeneration = message.connectionGeneration;
  handledCommandIds = new Set();
  reconnectDelay = 500;
  pairingRequested = false;
  // Re-validate persisted shared tabs before re-announcing them. A tab
  // closed while the extension socket was disconnected (service worker
  // idle, browser restart, crash, etc.) leaves a stale browserTabId in
  // chrome.storage.local. Re-announcing it would register a phantom tab
  // on the Broker that can never be snapshotted or controlled, and never
  // be unshared (no onRemoved fires for an already-closed tab).
  await pruneStaleSharedTabs();
  for (const tab of Object.values(state.sharedTabs)) send({ type: 'tab_shared', tab });
}
```

- `await pruneStaleSharedTabs()` が完了した後に `tab_shared` を再送する。
  これにより、無効なタブが `tab_shared` で再送されることはない。
- `pruneStaleSharedTabs` 内の `unshare` が送信する `tab_unshared` は
  `tab_shared` より先に送信される。Broker 側は `tab_unshared` を受けて
  `sharedTabs.delete()` した後に `tab_shared` を受けて `sharedTabs.set()` する
  可能性があるが、順序は「無効タブ削除 → 有効タブ再送」なので、
  無効タブが再登録されることはない（`pruneStaleSharedTabs` が `state.sharedTabs`
  から削除したものは `tab_shared` ループの対象外）。

## 不変条件

- I1: `authenticated` 受信後の `tab_shared` 再送は、実際に存在する
  ブラウザタブ（`chromeApi.tabs.get` で `tab?.id` が取れるもの）のみを含む。
- I2: `pruneStaleSharedTabs` は既存の `unshare()` を使い、新しい削除経路を
  作らない。永続化・`tab_unshared` 送信・`publicState` の一貫性は `unshare` に
  委ねる。
- I3: `chromeApi.tabs.get` が未定義の場合は検証をスキップし、既存動作
  （全 `tab_shared` 再送）を維持する。本番 Chrome API には常に存在する。
- I4: `pruneStaleSharedTabs` は `authenticated` ハンドラ内でのみ呼ばれる。
  定期実行 / `onRemoved` / `onUpdated` からは呼ばない（service worker 休止で
  動かない定期実行は導入せず、`onRemoved` は既に `unshare` を直接呼ぶ）。

## テスト

### 新規テスト（`extension-background.test.mjs`）

```
test('prunes stale persisted shared tabs on authenticate before re-announcing', async () => {
  // 永続化された sharedTabs に2つのタブ:
  //   tab_alive  -> browserTabId 42 (tabs.get 成功)
  //   tab_dead   -> browserTabId 99 (tabs.get reject)
  // authenticated 受信後:
  //   - tab_unshared が tab_dead について1回送信される。
  //   - tab_shared  が tab_alive について1回送信される。
  //   - publicState().sharedTabs は tab_alive のみ。
  //   - state.sharedTabs から tab_dead が削除され永続化される。
});
```

### 既存テストの更新

「resyncs shared tabs and resets command dedupe on a new connection generation」
の `chromeApi` モックに `tabs.get` を追加する。`browserTabId: 42` が存在することを
返す（`{ id: 42, active: true }`）。これにより `pruneStaleSharedTabs` が
タブを stale と判定せず、既存の `tab_shared` 再送・コマンド重複排除の検証が
そのまま通る。

他の既存テスト（`shareActiveTab` / `enableAutoShare` / `disableAutoShare` /
`forgetPairing` / `revoke` 等）は `tabs.get` を使わない、または `authenticated`
を経由しないため影響なし。`tabs.get` を持つモックは既に `createAutoShareChromeApi`
等で定義されているため、追加なしで動くものもある。

## 検証方法

- `cd browser-bridge && node --test test/extension-background.test.mjs`
- `cd browser-bridge && node --test`（browser-bridge 全体）
- `web` 配下のファイルは変更しないため `tsc` / `eslint` / `vitest` は対象外。
- 常駐プロセス（`next dev` 等）は起動しない。本番ビルドもユーザーに委ねる。

## 受入基準

1. ブラウザ再起動後、拡張機能が Broker に再接続し `authenticated` を受けた際、
   `chrome.storage.local` に残っていた存在しない `browserTabId` を持つ共有タブが
   `tab_unshared` 送信で削除される。
2. 存在するブラウザタブ（`tabs.get` で `tab?.id` が取れるもの）は `tab_shared`
   で再送され、そのまま snapshot / screenshot / click 等の操作が可能。
3. `pruneStaleSharedTabs` は既存の `unshare()` を使い、新しい削除経路を作らない。
4. `node --test test/extension-background.test.mjs` および
   `node --test`（browser-bridge 全体）が全て通る。