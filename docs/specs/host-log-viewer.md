# 設定「全般」タブにホストログのライブ表示を追加

## 背景

トレイホスト（`host/src/index.js`）が起動する `node src/index.js` は OpenCode / WebUI(Next.js) / Caddy
の標準出力・標準エラーをプレフィックス付き（`[opencode]` `[webui]` `[caddy]` `[web-build]`）で自身の
console に tee している。しかし、これは cmd.exe の生ウィンドウ経由でしか確認できず、通常運用では
非表示（トレイのみ）にしていると、起動失敗やクラッシュループ（例: Caddy のポート衝突による
`restart budget exhausted (3/5min)`）に気づけない。

## 目的

WebUI の設定画面「全般」タブから、トレイホストの直近ログをライブ表示できるようにする。
生の cmd.exe コンソールを開かなくても診断できることがゴール。

## 対象と非対象

- 対象: host プロセス自身のログ（`log()`/`error()`）、および tee 済みの子プロセス出力
  （opencode / webui / web-build / caddy）。
- 非対象: ログの永続化（ディスク保存・ローテーション）。バッファは host プロセスのメモリ上のみで、
  host 再起動で消える。
- 非対象: ログレベルフィルタ・検索・ダウンロード機能（将来拡張）。

## 設計

### 1. host 側のリングバッファ（`host/src/index.js` 内、新規モジュール `host/src/log-buffer.js`）

- 各エントリ: `{ seq: number, ts: number, source: 'host' | 'opencode' | 'webui' | 'web-build' | 'caddy', level: 'log' | 'error', text: string }`
- `seq` はプロセス内で単調増加する連番（ポーリングの `since` カーソルに使う）。
- 容量上限: 最大 500 件 かつ 256KB（先に到達した方で古いエントリから破棄）。
- 1エントリのテキストは 4000 文字で切り詰める（巨大出力によるメモリ膨張防止）。
- 既存の `log()` / `error()`、および opencode/webui/web-build/caddy の
  `stdout`/`stderr` `data` ハンドラに **追記** する形でバッファへ push する
  （既存の `process.stdout.write` / `console.log` 出力はそのまま維持し、tee するだけ）。

### 2. control-server の新ルート（`host/src/control-server.js`）

- `GET /logs?since=<seq>`
  - `since` 省略時は末尾から直近 200 件を返す。指定時は `seq > since` のエントリのみ返す。
  - 応答: `{ entries: LogEntry[], nextSeq: number }`
  - 既存の `matchControlRoute` に `'logs'` を追加し、`createControlRequestHandler` に
    `onGetLogs: (since: number | null) => { entries, nextSeq }` ハンドラを追加する。
  - 他ルートと同様 127.0.0.1 バインドのみ（`listenControlServer` は既に loopback 固定）。

### 3. WebUI 側 API（`web/src/app/api/host/logs/route.ts`）

- `GET /api/host/logs?since=<seq>`
  - `rejectUnlessLocal` でホスト機外からのアクセスを拒否する（`restart` と同じ扱い。
    ログはディレクトリパス等を含み得るため `health` より慎重に扱う）。
  - `resolveHostControlUrl()` で control-server のベース URL を解決し、`/logs` へ中継する。
  - control-server に到達できない場合は `502` と日本語エラーメッセージ
    （例: `"ホストログを取得できません。トレイホスト（start-webui.bat）が起動しているか確認してください"`）。

### 4. 画面（`web/src/components/settings/SettingsView.tsx`）

- 「全般」タブに折りたたみ可能な「ホストログ」セクションを追加する（初期状態は折りたたみ）。
- 展開中のみ 2 秒間隔でポーリングし、`nextSeq` を次回 `since` に使う。折りたたみ・タブ非活性時は
  ポーリングを停止する（既存 `useMobileScrollTarget` 等の生存 effect と同様に unmount で確実に止める）。
- 表示は等幅フォントのスクロール可能なボックス。`level: 'error'` の行は警告色で強調する。
- 操作: 「コピー」（既存 `copyText` ユーティリティで全文コピー）、
  「表示をクリア」（クライアント側の表示配列のみリセット。サーバー側バッファは消さない。
  次回ポーリングからは新規分のみ積み上がる＝クリア後も過去分の再取得はしない）。
- ホスト未到達時は他の host 依存 UI と同様、取得失敗メッセージを表示し再試行ボタンを出す。

## 安全性

- ログはメモリ上のみで、ディスクにもリポジトリにも書かない。
- API はホスト機外からのアクセスを `rejectUnlessLocal` で拒否する。
- 秘密情報（APIキー等）は既存ログ出力の慣行としてそもそも出力しない前提を変えない
  （本機能は既存の console 出力を tee するだけで、新たな機密出力を増やさない）。

## 受入条件

1. 設定「全般」タブに「ホストログ」セクションが表示され、折りたたみ/展開できる。
2. 展開すると直近ログ（host / opencode / webui / web-build / caddy 由来を含む）が表示され、
   2秒間隔で新着が追記される。
3. Caddy のポート衝突クラッシュループのような繰り返しエラーが、生コンソールを開かなくても
   本パネルで確認できる。
4. 折りたたみ・他タブへ切替時にポーリングが止まる（ネットワークタブ等で確認可能）。
5. コピー・表示クリアが機能する。
6. トレイホスト未起動時はエラーメッセージが表示され、UIがクラッシュしない。
7. ホスト機外（LAN/VPN 経由の別端末）からは `/api/host/logs` が 403 を返す。
