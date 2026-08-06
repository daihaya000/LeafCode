# 作業ログ: WebUI ユーザーログイン機能

## 日付

2026-08-06

## 目的

OpenCodeWebUI にユーザーログイン機能を追加し、設定画面からユーザー（追加・変更・削除）を管理できるようにする。
既存の「this endpoint is only available from the host machine」というローカルホスト限定のセマンティクスを維持する。

## 実装内容

### host 側（トレイホストのコントロールサーバー）

- `host/src/auth-store.js` を新規作成
  - `%APPDATA%\opencode-webui\users.json` への永続化
  - パスワードは sha256 + salt でハッシュ化
  - ユーザー一覧、検証、追加・更新、削除、存在確認を提供
- `host/src/control-server.js` に以下エンドポイントを追加
  - `GET /users` ... ユーザー一覧（パスワードハッシュ除く）
  - `POST /users` ... ユーザー追加・更新
  - `DELETE /users` ... ユーザー削除
  - `POST /auth/login` ... ログイン、セッションクッキー発行
  - `POST /auth/logout` ... ログアウト、クッキー破棄
- `host/src/index.js` に `authStore` と `sessionSecret` を `createControlServer` に接続

### web 側（Next.js BFF + UI）

- `web/src/lib/auth.ts` を新規作成
  - ブラウザ側から `/api/auth/*` を呼び出す認証 API
- `web/src/app/api/auth/login/route.ts`
- `web/src/app/api/auth/logout/route.ts`
- `web/src/app/api/auth/users/route.ts`
  - それぞれホストコントロールサーバーへの中継 API
- `web/src/components/auth/LoginGate.tsx` とテストを新規作成
  - 未ログイン時にログイン画面を表示
  - ユーザーが未作成の場合はゲートを表示しない（初期セットアップ）
- `web/src/app/(app)/layout.tsx` に `LoginGate` を組み込み
- `web/src/components/settings/SettingsView.tsx` に「ユーザー」タブを追加
  - ユーザー追加・変更・削除 UI
  - ユーザー未作成時の初期ユーザー作成 UI

## ログイン要求の判定ルール（127.0.0.1 は不要）

`GET /api/auth/session` がサーバ側で判定して `{ local, hasUsers, loginRequired }` を返す。
`loginRequired = !local && hasUsers`。

| アクセス元 | ユーザー未登録 | ユーザー登録済み |
| --- | --- | --- |
| 127.0.0.1 / localhost / ::1 | 不要 | **不要** |
| LAN / リモート | 不要 | 必要 |

- `local` の判定は既存の `web/src/lib/local-request.ts:isLocalHostRequest` を再利用。
  Host ヘッダがループバックかつ、X-Forwarded-For が無いか直近ホップもループバックの場合のみ true。
  Caddy が Host をループバックに書き換えても、XFF が LAN アドレスなら false（ヘッダ偽装対策）。
- ホストに繋がらない場合は fail-closed（`hasUsers = true` 扱い）。ただし `local` なら通す。
- ユーザー未登録時にゲートを出さないのは、ユーザー管理自体がホスト限定のため、
  出すと初回起動で誰も突破できずロックアウトするから。
- `/api/auth/users` は `rejectUnlessLocal` でホスト限定。
  これが無いと LAN クライアントが無認証で自分のアカウントを作成でき、ゲートが無意味になる。

## 検証結果

- `npm run --prefix web typecheck` ... 成功
- `npm run --prefix web lint` ... 成功
- `npm run --prefix web test` ... 222 test files, 2695 tests 成功
- `npm run --prefix host test` ... 230 tests 成功

## コミット

- `8005654` feat(auth): WebUIにユーザーログインとユーザー管理を追加
- `a218884` feat(auth): 127.0.0.1 からのアクセス時はログインを不要にする

## 次のステップ

- 起動中の WebUI とトレイホストを再起動し、新しい認証エンドポイントが有効になることを確認する。
  再起動しないと `/api/auth/*` は 404 のままになる。
- 本番ビルドは `AGENTS.md` の禁止事項によりエージェント側では行わない。ユーザーが明示的に実行する。
- 実機確認の観点:
  1. `http://127.0.0.1:3000` … ログイン画面が出ずそのまま使える
  2. 設定 → ユーザー でユーザーを作成
  3. LAN URL（`http://192.168.x.x:3000`）… ログイン画面が出る
  4. LAN から設定 → ユーザー … 403 になる（ホスト限定のため意図通り）

## 既知の未対応

- LAN から設定の「ユーザー」タブを開くと 403 で一覧が空になる。
  機能的には正しいが「ホストPCで操作してください」等の案内は未実装。
