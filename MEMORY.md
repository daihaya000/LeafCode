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

| アクセス元 | 認証手段なし | ユーザー登録済み or Windows認証ON |
| --- | --- | --- |
| 127.0.0.1 / localhost / ::1 | 不要 | **不要** |
| LAN / リモート | 不要 | 必要 |

`canAuthenticate = hasUsers || windowsAuth`、`loginRequired = !local && canAuthenticate`。

- `local` の判定は既存の `web/src/lib/local-request.ts:isLocalHostRequest` を再利用。
  Host ヘッダがループバックかつ、X-Forwarded-For が無いか直近ホップもループバックの場合のみ true。
  Caddy が Host をループバックに書き換えても、XFF が LAN アドレスなら false（ヘッダ偽装対策）。
- ホストに繋がらない場合は fail-closed（`hasUsers = true` 扱い）。ただし `local` なら通す。
- ユーザー未登録時にゲートを出さないのは、ユーザー管理自体がホスト限定のため、
  出すと初回起動で誰も突破できずロックアウトするから。
- `/api/auth/users` は `rejectUnlessLocal` でホスト限定。
  これが無いと LAN クライアントが無認証で自分のアカウントを作成でき、ゲートが無意味になる。

## Windows アカウントでのログイン

既定は**無効**。設定 → ユーザー のトグル（`/api/auth/config`、ホスト限定）で opt-in。
有効時、`POST /auth/login` は `users.json` を先に試し、外れた場合のみ Windows へフォールバックする。

### 実装方式: Win32 `LogonUser`（`scripts/validate-windows-credentials.ps1`）

`System.DirectoryServices.AccountManagement.ValidateCredentials` を最初に試したが、
このPCで実測したところ**存在しないローカルアカウントの否定に 14.4 秒**かかった
（内訳: `Add-Type` 9ms / コンテキスト生成 7ms / `ValidateCredentials` 14,437ms）。
`LogonUser` に変更して**約 0.5 秒**になった（`Add-Type` 158ms / `LogonUser` 15ms）。

- `LOGON32_LOGON_NETWORK` を使用。`1385 ERROR_LOGON_TYPE_NOT_GRANTED` の場合のみ
  `LOGON32_LOGON_INTERACTIVE` で再試行する（ネットワークログオンを拒否された正規ユーザー救済）。
- 資格情報エラー（1326/1327/1330/1331/1793/1907/1909）は `INVALID`、
  それ以外のコードは `ERROR:` としてホストログに出す。無効・ロック・期限切れは
  `LogonUser` が個別のコードを返すので AccountManagement は不要。
- **パスワードは argv に載せない**。`-File` でスクリプトを渡し、stdin の
  1行目=ユーザー名 / 2行目=パスワードで送る。argv は `wmic process get commandline`
  等でローカルの他ユーザーから読めるため。
- stdin/stdout は UTF-8 を明示（コンソールのコードページに依存させない）。
- ユーザー名・パスワードに改行/制御文字が含まれる場合は spawn 前に拒否する
  （stdin の行フレーミングを崩して認証を偽装されるのを防ぐ）。
- `powershell.exe`（5.1）を明示。`pwsh` では対象アセンブリ/挙動が異なる。
- 非 Windows・スクリプト不在・タイムアウト・PowerShell 異常は**すべて false**。
  検証できない状態をログイン成功と取り違えない。

### スロットリング

`createLoginThrottle`（既定 5 回 / 5 分、ユーザー名ごと）。
**Windows は失敗のたびに OS のアカウントロックアウトカウンタを進めるため**、
無制限だと LAN の端末から管理者を自分のPCから締め出せてしまう。
制限超過は `429` + `Retry-After` を返し、Windows へは問い合わせない。

## host-only API のリモート開放（ログイン済みなら変更可能に）

### 発覚した問題: ログインゲートが飾りだった

`verifySessionToken` / `getSessionCookie` / `setAuthCookie` は**定義のみでどこからも呼ばれておらず**、
`LoginGate` が localStorage を見て UI を隠すだけだった。API は一切保護されておらず、
LAN から `curl` で素通りできた。この状態で host-only ガードを「ログイン済みなら通す」にすると
検証されない Cookie を根拠にすることになり、逆に穴を開けることになる。
そのため先にセッション検証を実装した。

### 仕組み

1. host に `POST /auth/verify` を追設。BFF は `webui_session` cookie の token を
   転送し、host が HMAC 署名を検証して `{ ok, username }` を返す。
   署名 secret（`CONTROL_SECRET`）は host プロセスだけが持つため BFF 単独では検証できない。
2. `web/src/lib/session.ts` の `verifySession(req)` がこれを呼ぶ。
   cookie 無し・署名不正・期限切れ・host 到達不可はすべて null（fail closed）。
3. `rejectUnlessLocalOrAuthenticated`（loopback **または**検証済みセッション）を
   host-only ルート 29 ファイルに適用。

検証済みセッションは loopback 判定より**強い**根拠である。
`Host` / `X-Forwarded-For` は LAN の第三者が偽装できるが、token は HMAC 署名されている。

### 追記: `/api/browse/folder` も認証済みに開放（LAN IP 経由のホストPC対応）

ホストPC上のブラウザで `http://192.168.0.102:3000` を開くと `Host` が loopback で
ないため 403 になっていたが、ダイアログはホストの画面に出るので実際には使える。
`rejectUnlessLocalOrAuthenticated` に変更した。

判定について: `Host` ヘッダではスマホとホストPCを区別できない。堅牢な方法は
「ブラウザが `127.0.0.1:18765` に到達できるか」を検証すること（到達性の証明）だが、
control server への CORS 追加が必要で、その前提として後述の DNS リバインディング
対策が必要になる。**ユーザー判断により簡易版（クライアント検証なし）を採用**した。

そのため「ログイン済みなら誰でもホストPCの画面にダイアログを開ける」。緩和策:

- 非 loopback 呼び出しは待ち時間を 290 秒 → **60 秒**に短縮し、
  `504` + `reason=dialog_unattended` を返す（遠隔クライアントが worker を長時間占有しない）
- ダイアログの同時起動を防ぐ in-flight ロック。2 個目は `409` + `reason=picker_busy`
- クライアントは 409/504 を一覧フォールバック付きの通知として表示する

### 旧方針（参考）: `/api/browse/folder` を loopback 限定にしていた理由

ネイティブダイアログはホストPCのデスクトップに表示され、人間のクリックを待つ。
本当に遠隔のクライアント（スマホ等）からは見えないため、
`/api/browse/dirs` によるブラウザ内一覧＋手入力にフォールバックする。

### LoginGate をサーバー権威に変更

`/api/auth/session` が `authenticated` / `username` を返すようにし、
LoginGate は localStorage ではなくこれを見る。
`CONTROL_SECRET` は**host 起動ごとに再生成**されるため、host 再起動後は
cookie が無効になる。localStorage を信じていると「画面は出るが全 API が 403」に
なるので、サーバー判定に統一した。

### 併せて修正したトークンのバグ

- `payload.indexOf(':')` → `lastIndexOf(':')`。
  ユーザー名にコロンが含まれると ts のパースが壊れていた（fail closed なので無害だが不正確）。
- 未来日時のトークンを拒否（60 秒の skew 許容）。偽造 ts でセッション期限を伸ばせないようにする。

## 検証結果

- `npm run --prefix web typecheck` ... 成功
- `npm run --prefix web lint` ... 成功
- `npm run --prefix web test` ... 228 test files, 2774 tests 成功
- `npm run --prefix host test` ... 299 tests 成功

実機確認済み（`scripts/validate-windows-credentials.ps1`）:

- 存在しないアカウント + 誤パスワード → `INVALID` / 約 0.45 秒
- 実在アカウント（`Daichi` @ `X870`）+ 誤パスワード → `INVALID` / 0.51 秒、`ERROR:` なし
- `VALID` の経路のみ未確認（実パスワードが必要なためユーザー側で確認）

## コミット

- `8005654` feat(auth): WebUIにユーザーログインとユーザー管理を追加
- `a218884` feat(auth): 127.0.0.1 からのアクセス時はログインを不要にする
- `4d9b8af` feat(auth): Windows アカウントのユーザー名/パスワードでログインできるようにする
- `b7825ab` feat(auth): ログイン済みならリモートからも host-only 設定を変更できるようにする
- `34d1874` feat(browse): LAN IP 経由でもネイティブフォルダ選択を使えるようにする
- `1559245` docs: セキュリティ棚卸しと修正計画を追加
- `ad953f8` fix(security): API を default-deny 化し CSRF 対策を追加（Phase 1/2）
- `3aa757f` fix(security): control server に Host ヘッダ検証を追加（Phase 3）

## 次のステップ

- 起動中の WebUI とトレイホストを再起動し、新しい認証エンドポイントが有効になることを確認する。
  再起動しないと `/api/auth/*` は 404 のままになる。
- 本番ビルドは `AGENTS.md` の禁止事項によりエージェント側では行わない。ユーザーが明示的に実行する。
- 実機確認の観点:
  1. `http://127.0.0.1:3000` … ログイン画面が出ずそのまま使える
  2. 設定 → ユーザー でユーザーを作成
  3. LAN URL（`http://192.168.x.x:3000`）… ログイン画面が出る
  4. LAN から設定 → ユーザー … 403 になる（ホスト限定のため意図通り）

## 脆弱性修正: Phase 1/2 完了（`ad953f8`）

計画と進捗は `docs/specs/security-remediation-plan.md`。

### 修正前に判明していた状態

**P0-1**: API ルート 97 本のうち **66 本が無認証**。
`/api/opencode/[...path]`（全メソッド）と `/api/tasks` を含むため、
LAN 上の任意端末が認証なしにエージェントを起動でき、**実質的に無認証 RCE**。
`deploy/Caddyfile` の Basic Auth もコメントアウトで外側ゲート無し。
ログイン UI は LAN でログインを要求するため保護されていると誤認しやすかったが、
ゲートは UI のみで API は保護していなかった。

**P0-2**: `Origin` を検証するルートが 0 件。`isLocalHostRequest` は資格情報を
要求しないため、ホストPCで悪意あるページを開くと `http://127.0.0.1:3000/api/...` へ
`text/plain` で POST でき（preflight 回避）、全状態変更 API を叩けた。

### 修正内容

`web/src/lib/api-guard.ts` の `requireAuthorized` が **CSRF → 認可** の順に判定する。

1. `rejectCrossSite`: 状態変更メソッドで `Origin` の allowlist 一致を要求。
   `Sec-Fetch-Site: cross-site` も拒否。同一ホストの別ポートは許可（Caddy 経由）。
   `Origin` 欠落は非ブラウザ client とみなし通す（ブラウザは必ず付けるため）。
   `Origin: null` は拒否。**loopback でも必ずこの判定を通す**のが要点。
2. 認可: loopback または host が検証したセッション。

公開は `PUBLIC_API_ROUTES` の 4 本のみ（`/api/health`、`/api/auth/{session,login,logout}`）。
`/api/health` を公開に残したのは、トレイホストの supervisor と Caddy が
死活監視に使うため。

`web/src/lib/api-guard-coverage.test.ts` が全ルートを走査し、
ガードの無いルート・旧 `rejectUnlessLocal*` の残存・opencode プロキシの
ガード位置（`context.params` より前）を検証する。**再発するとテストが落ちる。**

### 実装上の注意点

- `req` 引数を持たないハンドラが 19 個あり、引数を追加した。
- `/api/addons/codexbar/*` は `@addons/codexbar/api/*` の**再エクスポート**で、
  実装は `web/src` 外にある。走査テストは再エクスポート先も読む。
- テスト側は `Host` ヘッダを付けないと 403 になる（33 ファイルが該当した）。
  **本番の fail-closed を維持するため、Host 欠落時に URL へフォールバックしない。**
  `0.0.0.0` バインド時、Host を省いた生の HTTP リクエストで Next が `localhost` を
  補完し loopback 扱いになる回避経路が生まれるため。

## 未修理の脆弱性: host control server の DNS リバインディング（P1-1）— 修正済み（`3aa757f`）

`isLoopbackHostHeader(host, port)` で `Host` が loopback かつ待受ポートと一致するかを
ルート照合より先に検証する。`evil.test` が `127.0.0.1` に解決されても
`Host: evil.test:18765` になるため 403 で弾かれる。

**未対応。ユーザー判断により今回は修正を見送った。**

`host/src/control-server.js` は `Host` / `Origin` を一切検証していない
（`req.headers` の参照は cookie のみ）。`127.0.0.1:18765` で待ち受けているため、
攻撃者が自ドメインを `127.0.0.1` に DNS リバインドすると、ブラウザから見て
**same-origin** になり CORS では防げない。ユーザーが悪意あるページを開いている間に:

- `POST /users` で任意アカウント作成 → WebUI に外部からログイン可能（完全侵害）
- `GET /users` でユーザー名列挙、`POST /auth/config` で Windows 認証を有効化
- `POST /restart/all` でホスト妨害

修正方法: control server で `Host` ヘッダを allowlist 検証する
（`127.0.0.1:<port>` / `localhost:<port>` のみ許可）。数行で塞げる。
ローカル証明（到達性検証）を実装する場合はこの修正が前提になる。

## 既知の未対応・制約

- ログアウトはサーバー側でトークンを失効させない（ステートレス HMAC）。
  cookie を消すだけなので、token を抜き取られていれば 7 日間有効。
  実質的な失効手段は host 再起動（`CONTROL_SECRET` 再生成）のみ。
- ログイン済みリモート主体は `/api/auth/users` と `/api/auth/config` も操作できる。
  つまり WebUI ユーザーが Windows 認証を有効化したり他ユーザーを削除できる。
  権限モデル（`remote-authz.md` の `project:read` 等）は未実装で、認可は
  「loopback または検証済みセッション」の 2 値のみ。
- CSRF 対策は未実装。`remote-authz.md` が要求する token 二重送信・Origin 検証は入っていない。
  session cookie は `SameSite=Strict` なので基本的なクロスサイト送信は防げるが、
  仕様が求める水準には達していない。
- 監査ログ未実装。
- `users.json` / `auth-config.json` は `mode: 0o600` で書いているが、
  **Windows では POSIX パーミッションは効かない**（Node は 0666 を報告する）。
  同一PCの別ユーザーからパスワードハッシュを読める。ACL 設定は未実装。
- Windows 認証の `VALID` 経路は実パスワードが必要なため未検証。
- `LogonUser` を1回呼ぶたびに Windows の失敗カウンタが進む。
  WebUI 側は 5 回で止めるが、OS 側のロックアウト閾値が 5 未満だと
  WebUI のスロットリングより先に OS がロックする。

---

# 作業ログ: 右メニューに Markdown ビューワーを追加

## 日付

2026-08-06

## 目的

TaskView の右サイドパネルに「Markdown ビューワー」を追加し、エージェントが提出した
`.md` ファイル（計画書やレポート）を一覧から選んで閲覧できるようにする。

## 実装内容

### `web/src/lib/side-panel-state.ts`

- `SidePanelKind` に `"markdown"` を追加
- `readSidePanel()` の復元対象に `markdown` を追加

### `web/src/components/task/MarkdownViewerPanel.tsx`（新規）

- セッションメッセージから assistant 発の `.md` ファイルパスを抽出する
  `collectMarkdownFiles()` をエクスポート
  - `part.type === "file"` の `filename` と `part.type === "text"` の本文が
    絶対パス形式の `.md` なら候補とする（`extractPlanMarkdownPath` の緩和版）
  - 画像添付（`isImageFilePart`）は除外
  - 重複パスは初出順で 1 件だけ表示
- 選択中のファイル内容は既存の `/api/files/content` で取得し、`Markdown` コンポーネントで描画
- 左リスト＋右本文の 2 ペイン構成（md 未満では縦積み）
- 読み込み中 / エラー / 再試行 UI を備える
- 空状態メッセージ: 「エージェントが提出した Markdown ファイルはありません」

### `web/src/components/task/TaskView.tsx`

- `FileText` アイコンと `MarkdownViewerPanel` をインポート
- ヘッダーツールバーに Markdown ビューワーボタンを追加（`isLg` のみ表示）
- ヘッダーのケバブメニュー「パネル切替」に `panel-markdown` を追加
- `sidePanel === "markdown"` のとき `MarkdownViewerPanel` をレンダリング
  - `directory={task.directory}` / `messages={stream.visibleMessages}` を渡す

### `web/src/components/task/MarkdownViewerPanel.test.tsx`（新規）

- `collectMarkdownFiles` の抽出・重複排除・画像除外
- パネルの空状態・自動選択・内容描画・切替・エラー時再試行
- 計 7 テスト

## 設計上のメモ

- `/api/files/content` はプロジェクトディレクトリ配下の `.md` のみ許可する
  （`assertAllowedDirectory` + 拡張子チェック済み）。プロジェクト外パスは 403。
- plan エージェント以外の提出も拾うため `extractPlanMarkdownPath` ではなく
  専用の `partMarkdownPath` を定義（`agent="plan"` / `completed` ゲートなし）。
- 画像添付ファイルはインラインプレビューが別途あるため除外。

## 検証結果

- `npx tsc --noEmit` ... 変更ファイルにエラーなし
  （無関係な既存テストファイルの構文エラーのみ存在）
- `npx eslint` ... 成功
- `npx vitest run src/components/task/MarkdownViewerPanel.test.tsx` ... 7 passed
- `npx vitest run src/components/task/TaskView.test.tsx` ... 113 passed
- `npx vitest run src/components/task/PlanDocumentCard.test.tsx` ... 3 passed

---

# 作業ログ: 脆弱性修正 Phase 4（セッション失効・role による権限分離）

## 日付

2026-08-06

## 目的

`docs/specs/security-remediation-plan.md` の Phase 4（P1-2 セッション失効 / P2-1 権限モデル）を実施する。

## 背景

- **P1-2**: session token は 7 日間有効なステートレス HMAC。ログアウトは cookie を
  消すだけで、token 自体は取得済みの攻撃者にとって期限まで有効なままだった。
- **P2-1**: 認証済みなら誰でも `/users` の作成・削除、`/auth/config`
  （Windows 認証の有効化）を操作できた。権限の区別が無かった。

## 実装内容

### host 側

- `host/src/control-server.js`
  - `signSessionToken` / `verifySessionToken` のペイロードを
    `username:jti:ts` に変更。jti にランダム 8byte を使い、
    username・jti にコロンを含んでいても `lastIndexOf` の二段分割で正しく復元する。
  - `createRevocationStore({ persist })` を新設・export。
    `jti -> revokedAt` の `Map` をメモリに保持し、
    `%APPDATA%\opencode-webui\revoked-sessions.json` に永続化する。
    **`Set` ではなく `Map` にした理由**: 新しい失効を書き込むたびに
    全エントリのタイムスタンプが書き込み時刻で上書きされると、
    古いエントリが二度と期限切れにならず prune されないバグになるため、
    エントリごとに個別のタイムスタンプを保持する。
  - `POST /auth/logout` が cookie の token から jti を復元し失効させる。
  - `POST /auth/verify` は失効済み jti を 401 で拒否し、
    `{ ok, username, jti, isAdmin }` を返す。
  - `Host` ヘッダ検証の直後に走る認可チェックとして、
    `resolveSession(req)` ヘルパーを追加。`/users`（POST/DELETE）と
    `/auth/config`（POST）は `authStore.isAdmin(username) === true` を要求し、
    満たさない場合は 403。`GET` は変更なし（引き続き無認証で一覧取得可）。
- `host/src/auth-store.js`
  - `UserRecord` に `role: 'admin' | 'user'` を追加。
  - 既存ユーザー・`role` 欠落・未知の値はすべて `admin` にフォールバック
    （さもないと移行直後に誰も管理操作できなくなる）。
  - `isAdmin(username)` を追加。`upsertUser` はパスワード変更時に既存の
    `role` を保持し、新規作成時は `admin` にする。
- `host/src/index.js`: `authStore.isAdmin` を接続。

### web 側

- **見つけた不整合**: `web/src/app/api/auth/users/route.ts` と
  `web/src/app/api/auth/config/route.ts` の `forwardToHost` は
  host へブラウザの `Cookie` ヘッダを転送していなかった。
  admin チェック追加後は、この2ルートの POST/DELETE が
  常に 403 になる状態だったため、`forwardToHost` に `req` を渡し
  `Cookie` ヘッダを転送するよう修正した。
- `web/src/lib/auth.ts`: `AuthUser` 型に `role` を追加。
- `web/src/components/settings/SettingsView.tsx`: ユーザー一覧に
  「管理者」「一般」バッジを追加。

## 検証結果

- `npm run --prefix host test` ... 319 tests 成功（+21）
- `npm run --prefix web typecheck` / `lint` ... エラーなし
- `npm run --prefix web test` ... 228 test files, 2780 tests 成功

## コミット

- `f85bac3` fix(security): セッション失効と role による権限分離を追加（Phase 4）

## 次のステップ

- **Phase 5（未着手）**: `icacls` による `users.json` / `auth-config.json` の
  ファイル権限、監査ログ、ログイン試行スロットリングの送信元 IP 集計と永続化。
- ログアウトの失効は jti 単位。同一ユーザーの他デバイスのセッションは
  ログアウトしても失効しない仕様（意図的、他デバイスの誤爆防止）。
  全デバイス強制ログアウトが必要になった場合は別途 API を追加する。
