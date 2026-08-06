# セキュリティ修正計画

作成: 2026-08-06 / 対象コミット: `2b3dad5`

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

### Phase 1（P0-1）default-deny 化

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

### Phase 2（P0-2）CSRF 対策

1. `assertSameOrigin(req)` を追加し、`GET` / `HEAD` 以外で
   `Origin` が許可リスト（自身の origin 群）と一致することを要求する。
   `Origin` 欠落も拒否する（ブラウザは状態変更リクエストで必ず送る）。
2. 許可 origin の決定: `Host` ヘッダから自 origin を導出し、
   追加で環境変数による明示指定を許す（Caddy 経由の外部 origin 用）。
3. Phase 1 のガードに統合し、走査テストで漏れを検出する。

これで「loopback なら無条件許可」の穴が閉じる。
`SameSite=Strict` cookie と併せて二重防御になる。

### Phase 3（P1-1）control server の Host 検証

`createControlRequestHandler` の先頭で `Host` を検証し、
`127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>` 以外を 403 にする。
数行で塞げる。ローカル証明（到達性検証）を将来実装する場合の前提でもある。

### Phase 4（P1-2, P2-1）セッション失効と権限

1. token に `jti` を持たせ、host 側に失効リスト（メモリ + `%APPDATA%` 永続化）を持つ。
   `POST /auth/logout` で当該 `jti` を失効させる。
2. `users.json` に `role`（`admin` / `user`）を追加する。
   `/api/auth/users` と `/api/auth/config` は `admin` のみ許可する。
   既存ユーザーは移行時に `admin` とみなす。

### Phase 5（P2-2〜P2-4）残課題

1. `icacls` で `users.json` / `auth-config.json` を現在のユーザーのみに制限する。
2. 監査ログ: 既存の `host/src/log-buffer.js` / `log-file.js` を再利用し、
   認証成功・失敗・ユーザー管理操作を記録する（token とパスワードは記録しない）。
3. スロットリングを送信元 IP でも集計し、`%APPDATA%` に永続化する。

## 暫定緩和（コード変更なしで即実施可能）

Phase 1 を適用するまでの間、次のいずれかを推奨する。

1. **Caddy の Basic Auth を有効化する。** `deploy/Caddyfile` の `basicauth`
   ブロックのコメントを外し、`caddy hash-password` のハッシュを設定する。
   外側ゲートが復活し、P0-1 / P0-2 の LAN 経路を塞げる。
2. LAN 公開を止める（Caddy を停止、`OPENCODE_WEBUI_CADDY=0`）。

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
