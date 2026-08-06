# セキュリティ修正計画

作成: 2026-08-06 / 調査時コミット: `2b3dad5`

## 進捗

| Phase | 状態 | コミット |
|-------|------|----------|
| 1 default-deny 化 | **完了** | `ad953f8` |
| 2 CSRF 対策 | **完了** | `ad953f8` |
| 3 control server の Host 検証 | **完了** | `3aa757f` |
| 4 セッション失効・権限 | **完了** | `f85bac3` |
| 5 ファイル権限・監査・スロットリング | 未着手 | — |

Phase 1/2 完了後の実測: ガードなしのルートは **0**（公開 allowlist 4 本を除く）。
`web/src/lib/api-guard-coverage.test.ts` が漏れを検出するため、
新規ルートをガードなしで追加するとテストが失敗する。

## 現在の公開構成（実測）

| 項目 | 実測値 | 根拠 |
|------|--------|------|
| Next.js BFF の bind | `127.0.0.1:3000`（既定） | `host/src/index.js` `WEBUI_HOST` |
| LAN からの経路 | Caddy `https://192.168.0.102:8443` → `127.0.0.1:3000` | `deploy/Caddyfile` |
| Caddy の Basic Auth | **無効（コメントアウト）** | `deploy/Caddyfile` の `basicauth` 2 ブロック |
| API ルート総数 | 97 | `web/src/app/api/**/route.ts` |
| ガードあり | 31（`localOrAuth` 29 / `localOrPrivate` 1 / `sessionOnly` 1） | 静的走査 |
| **ガードなし** | **66（うち状態変更 43）** | 静的走査 |
| `Origin` を検証するルート | **0** | 静的走査 |

つまり **LAN からの外側ゲートが一切無い状態で、BFF の 2/3 のルートが無認証**である。

## 重大度順の課題一覧

### P0-1 LAN からの無認証 API アクセス → 任意コード実行

`/api/opencode/[...path]` は `GET/POST/PUT/PATCH/DELETE/OPTIONS` を export し、
**ガードが一切無い** OpenCode サーバーへの catch-all プロキシである。
`/api/tasks`（GET,POST）も同様に無認証。

LAN 上の任意の端末が認証なしにセッションを作成しプロンプトを送信でき、
エージェントがホストのシェルでコマンドを実行する。**実質的に無認証 RCE。**

他に無認証で到達できるもの（抜粋）:

- ホストのファイル読み取り: `/api/files/content`、`/api/files/search`、`/api/diff`、`/api/git/show`
- 状態変更: `/api/git/commit`、`/api/git/merge`、`/api/git/pr`、`/api/projects`(POST/PATCH/DELETE)、
  `/api/roots`(POST/DELETE ← 許可ルート改変)、`/api/settings/[key]`(PUT)、
  `/api/extensions/**`(PATCH/PUT/DELETE)、`/api/workspaces`(POST/DELETE/PATCH)

**注意**: ログイン UI は LAN アクセス時にログインを要求するため、保護されていると
誤認しやすい。ゲートは UI のみで、これらの API は保護していない。

### P0-2 CSRF: `Origin` 未検証 + loopback を無条件に信頼

`isLocalHostRequest` は資格情報を要求せず、`Host` が loopback で
`X-Forwarded-For` が無ければ許可する。ホストPC上でブラウザを使っている間、
**任意の Web サイト**が `http://127.0.0.1:3000/api/...` へ POST できる。

`Content-Type: text/plain` にすれば preflight を回避できる（単純リクエスト）。
レスポンスは CORS で読めないが、**副作用は発生する**。
`Origin` を検証しているルートは 0 件なので、全ての状態変更 API が対象。

P0-1 と組み合わせると、ホストPCで悪意あるページを開くだけで RCE に至る。

### P1-1 host control server の DNS リバインディング

`host/src/control-server.js`（`127.0.0.1:18765`）は `Host` / `Origin` を検証しない。
攻撃者が自ドメインを `127.0.0.1` に DNS リバインドすると same-origin になり
CORS では防げず、`POST /users` で任意アカウント作成 → WebUI へ外部からログイン可能。

### P1-2 セッションの失効手段が無い

ステートレス HMAC（7 日）。ログアウトは cookie 削除のみで、
token を取得済みの攻撃者には無効。実質的な失効は host 再起動のみ。

### P2-1 権限モデル不在

認証済みなら誰でも `/api/auth/users`（他ユーザー削除）と
`/api/auth/config`（Windows 認証の有効化）を操作できる。

### P2-2 資格情報ファイルの権限が Windows で無効

`users.json` / `auth-config.json` は `mode: 0o600` で書いているが
Windows では POSIX モードビットが効かない（Node は 0666 を報告）。
同一PCの別ユーザーがパスワードハッシュを読める。

### P2-3 監査ログ不在

### P2-4 Windows 認証スロットリングの穴

`createLoginThrottle` はプロセス内メモリのみ・ユーザー名キーのみ。
host 再起動でリセットされ、送信元 IP による制限が無い。

## 修正フェーズ

### Phase 1（P0-1）default-deny 化 — 完了

実施内容:

- `web/src/lib/api-guard.ts` に `requireAuthorized` / `requireHostMachine` を新設。
- 公開 allowlist は `PUBLIC_API_ROUTES`（`/api/health`、`/api/auth/session`、
  `/api/auth/login`、`/api/auth/logout`）の 4 本のみ。
- 残る全ルートにガードを適用。`req` 引数を持たなかった 19 ハンドラには引数を追加した。
- `/api/opencode/[...path]` は `export const GET = proxy` 形式のため `proxy` 内に 1 箇所追加し、
  `context.params` を読む前に判定させた。
- `/api/addons/codexbar/*` は `@addons/codexbar/api/*` の再エクスポートだったため、
  実装側（`addons/codexbar/api/{providers,tokens,usage}.ts`）にガードを追加した。
  走査テストは再エクスポート先も読むようにした。
- 旧 `rejectUnlessLocal*` の直接使用は route から排除した（CSRF 判定を通さないため）。
  `/api/browse/folder` のみ `isLocalHostRequest` を残しているが、これは認可ではなく
  ダイアログ待ち時間の切り替えに使っている。

以下は当初計画（記録として残す）。



1. `web/src/lib/api-guard.ts` を新設し `requireAuthorized(req)` を用意する。
   認可は既存の `rejectUnlessLocalOrAuthenticated` と同じ判定。
2. 公開ルートを**明示 allowlist** にする。候補は
   `/api/health`、`/api/auth/session`、`/api/auth/login`、`/api/auth/logout` のみ。
3. 残る 62 ルートにガードを追加する。SSE（`/api/tasks/[id]/workflow/events` 等）は
   ストリーム開始前に判定する。
4. **回帰防止テスト**: `web/src/app/api/**/route.ts` を走査し、
   allowlist 以外にガードが無いファイルがあれば fail するテストを追加する。
   これが無いと新規ルートで再発する。

実装方式の選択肢:

- **推奨**: 各ルートに 1 行追加 + 上記の走査テスト。
  明示的で、SSE や `maxDuration` の個別事情に対応しやすい。
- 代替: `middleware.ts` で一括。ただし `resolveHostControlUrl` が `fs` を使うため
  Edge runtime では動かず、Node runtime middleware（Next 15 で experimental）が必要。
  単一チョークポイントは魅力的だが、実験的機能への依存が増える。

### Phase 2（P0-2）CSRF 対策 — 完了

実施内容（`rejectCrossSite`）:

- `POST` / `PUT` / `PATCH` / `DELETE` で `Origin` を検証する。
  許可元は request の `Host` から導出（`http://` と `https://` の両方）＋
  `OPENCODE_WEBUI_ALLOWED_ORIGINS` による明示指定。
- `Sec-Fetch-Site: cross-site` は `Origin` に関係なく拒否する。
- 同一ホストで**ポートが異なる** origin は許可する（Caddy `:8443` → Next `:3000`）。
- `Origin` 欠落は許可する。ブラウザは状態変更リクエストに必ず付けるため、
  欠落は非ブラウザ client（curl、smoke script）を意味し、認可判定は別途通る。
  `Origin: null`（opaque origin）は拒否する。
- **loopback であっても CSRF 判定を先に通す。** これが本質で、
  `isLocalHostRequest` が資格情報なしで許可することの穴を閉じている。

以下は当初計画（記録として残す）。



1. `assertSameOrigin(req)` を追加し、`GET` / `HEAD` 以外で
   `Origin` が許可リスト（自身の origin 群）と一致することを要求する。
   `Origin` 欠落も拒否する（ブラウザは状態変更リクエストで必ず送る）。
2. 許可 origin の決定: `Host` ヘッダから自 origin を導出し、
   追加で環境変数による明示指定を許す（Caddy 経由の外部 origin 用）。
3. Phase 1 のガードに統合し、走査テストで漏れを検出する。

これで「loopback なら無条件許可」の穴が閉じる。
`SameSite=Strict` cookie と併せて二重防御になる。

### Phase 3（P1-1）control server の Host 検証 — 完了

実施内容:

- `isLoopbackHostHeader(hostHeader, expectedPort)` を `control-server.js` に追加。
  `127.0.0.1` / `localhost` / `::1`（ブラケット含む）と、待受ポートの一致を検証する。
- `createControlRequestHandler` の冒頭でルート照合より先に弾く。
  これにより `POST /users` 等のエンドポイント存在が漏れない。
- `index.js` から `controlPort: CONTROL_PORT` を渡す。
- テスト 13 件追加（loopback 受理 / リバインディング拒否 / ポート不一致 / Host 欠落 /
  `/users` が通らないこと 等）。

以下は当初計画（記録として残す）。


`createControlRequestHandler` の先頭で `Host` を検証し、
`127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>` 以外を 403 にする。
数行で塞げる。ローカル証明（到達性検証）を将来実装する場合の前提でもある。

### Phase 4（P1-2, P2-1）セッション失効と権限 — 完了

実施内容:

- session token のペイロードを `username:jti:ts` に変更（`signSessionToken` /
  `verifySessionToken`）。username・jti にコロンが含まれても `lastIndexOf` の
  二段分割で正しく復元できる。
- `createRevocationStore()` を追加。`jti -> revokedAt` の `Map` をメモリに保持し、
  `%APPDATA%\opencode-webui\revoked-sessions.json` に永続化する。
  `Set` ではなく `Map` にしたのは、新しい失効を書き込むたびに全エントリの
  タイムスタンプが書き込み時刻で上書きされ、古いエントリが二度と
  prune されなくなるバグを避けるため。
- `POST /auth/logout` が当該 `jti` を失効させる。`POST /auth/verify` は
  失効済み `jti` を拒否する。7 日間の有効期限が過ぎたエントリは読み込み時に
  自動で除外される。
- `host/src/auth-store.js` の `UserRecord` に `role: 'admin' | 'user'` を追加。
  既存ユーザー・`role` 欠落・不明な値はすべて `admin` にフォールバックする
  （さもないと移行直後に誰も管理操作できなくなる）。`isAdmin(username)` を追加。
- `/users` の `POST`/`DELETE`（ユーザー作成・削除）と `/auth/config` の `POST`
  （Windows 認証の有効化）を admin セッション限定にした。`GET` は変更なし。
- **副作用として見つけた不整合**: web 側の `/api/auth/users`・`/api/auth/config`
  は host へブラウザの session cookie を転送していなかった。admin チェック追加後は
  この2ルートの POST/DELETE が常に 403 になる状態だったため、
  `forwardToHost` に `req` を渡し `Cookie` ヘッダを転送するよう修正した。
- 設定画面のユーザー一覧に「管理者」「一般」バッジを追加。

### Phase 5（P2-2〜P2-4）残課題

1. `icacls` で `users.json` / `auth-config.json` を現在のユーザーのみに制限する。
2. 監査ログ: 既存の `host/src/log-buffer.js` / `log-file.js` を再利用し、
   認証成功・失敗・ユーザー管理操作を記録する（token とパスワードは記録しない）。
3. スロットリングを送信元 IP でも集計し、`%APPDATA%` に永続化する。

## 暫定緩和

Phase 1/2 が完了したため不要。ユーザー判断により実施しなかった。

なお `deploy/Caddyfile` の `basicauth` を有効化すれば多層防御になる（任意）。

## 検証

- 各 Phase で `npm run --prefix web typecheck` / `lint` / `test`、
  `npm run --prefix host test` を通す。
- Phase 1 の走査テストが「ガード漏れ 0 件」を保証する。
- 手動確認: LAN 端末から未ログインで `/api/tasks`、`/api/opencode/app`
  が 403 になること。ホストPCの loopback からは従来どおり動作すること。

## 見積り

| Phase | 規模 | 備考 |
|-------|------|------|
| 1 | 大（62 ルート + テスト） | 機械的置換が可能。SSE のみ個別対応 |
| 2 | 中 | ガードに統合するため Phase 1 と同時実施が効率的 |
| 3 | 小 | 数行 + テスト |
| 4 | 中 | データ移行あり（role 付与） |
| 5 | 中 | 独立して実施可能 |
