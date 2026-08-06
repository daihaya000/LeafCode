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

## 検証結果

- `npm run --prefix web typecheck` ... 成功
- `npm run --prefix web lint` ... 成功
- `npm run --prefix web test` ... 220 test files, 2676 tests 成功
- `npm run --prefix host test` ... 230 tests 成功

## 未コミットファイル

- 変更: `host/src/control-server.js`, `host/src/control-server.test.js`, `host/src/index.js`, `web/src/app/(app)/layout.tsx`, `web/src/components/settings/SettingsView.tsx`
- 新規: `host/src/auth-store.js`, `host/src/auth-store.test.js`, `web/src/lib/auth.ts`, `web/src/app/api/auth/login/route.ts`, `web/src/app/api/auth/logout/route.ts`, `web/src/app/api/auth/users/route.ts`, `web/src/components/auth/LoginGate.tsx`, `web/src/components/auth/LoginGate.test.tsx`
- 一時ファイル: `tmp-user.json`（テストで生成された可能性あり）

## 次のステップ

- 起動中の WebUI とトレイホストを再起動し、新しい認証エンドポイントが有効になることを確認する。
- 本番ビルドは `AGENTS.md` の禁止事項によりエージェント側では行わない。ユーザーが明示的に実行する。
