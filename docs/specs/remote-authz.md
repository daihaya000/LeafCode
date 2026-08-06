# リモート認証・認可基盤

> **改訂（host-only API の方針変更）**
>
> 本仕様の当初版は「host-only API は認証済みリモート主体にも開かない」と定めていたが、
> ホスト側セッション（HMAC 署名 cookie）を BFF が検証する仕組みを実装したため、
> 次のとおり変更した。
>
> - **検証済みセッションを持つ呼び出し元は host-only API を利用できる。**
>   ガードは `rejectUnlessLocalOrAuthenticated`（loopback または検証済みセッション）。
>   検証済みセッションは loopback ヒューリスティクスより強い根拠である。
>   `Host` / `X-Forwarded-For` は LAN の第三者が偽装できるが、
>   セッション token はホストプロセスだけが持つ secret で HMAC 署名されている。
> - **例外: `/api/browse/folder`（ネイティブフォルダ選択）は loopback 限定を維持する。**
>   これは権限の問題ではなく、ダイアログがホストPCのデスクトップに表示され、
>   最大 290 秒間クリックを待つため、リモートからは原理的に利用できないからである。
>   リモートのフォルダ選択は `/api/browse/dirs` によるブラウザ内一覧を使う。
> - 本文中の「host-only API は認証済みリモート主体でも通さない」という記述、および
>   受入基準 11 は、上記例外を除き無効。`/api/browse/dirs` は認証済み主体に開放済み。
>
> 未実装のまま残る事項: JWT assertion / 認証プロキシ連携、`project:read` 等の
> 権限モデル、`/api/remote-projects/**`、CSRF token 発行、監査ログ。
> 現行の認可は「loopback または検証済みセッション」の 2 値のみである。

## 背景

[`remote-project-picker.md`](./remote-project-picker.md) は、リモート利用者向けに
サーバー上の許可済みディレクトリだけを列挙・追加する API を要求している。
現行の Caddy Basic Auth は任意の外側ゲートであり、BFF はリモート利用者の主体や
権限を検証しない。そのため、フォルダ列挙 API を LAN/VPN に開く前に、
プロバイダー非依存の認証・認可契約を固定する。

この仕様では、Next.js BFF は常に loopback に固定し、外部公開は同一ホスト上の
認証プロキシだけが担う。BFF は、認証プロキシが専用ヘッダーで付与し、BFF が検証する
JWT assertion だけを認証根拠にする。Basic Auth の通過、生の `X-User` 系ヘッダー、
`Authorization` や cookie から直接抽出した token は認可根拠にしない。

## 目的

- BFF が検証できる認証済み主体を定義する。
- `project:read` / `project:add` を含む権限モデルを定義する。
- 認証プロキシと BFF の信頼境界、JWT 検証条件、API default-deny を定義する。
- loopback 既存 UX と host-only API の制限を維持したまま、リモート専用 API を安全に追加できるようにする。
- 具体的な IdP、プロキシ製品、秘密情報、プロバイダー固有 claim 名を前提にしない。

## 非目標

- 特定プロバイダーのログイン手順、画面、Caddyfile 実装例の確定。
- BFF を LAN/VPN のインターフェースへ直接 bind する運用。
- Basic Auth のユーザー名を WebUI の主体として扱うこと。
- 既存 `/api/browse/dirs` や `/api/browse/folder` の host-only 制限を緩めること。
- 既存 `allowed_roots` をリモート公開範囲として流用すること。
- 既存 Projects / Sessions を複数リモート利用者向けに共有・分離する方針の確定。

## 用語

| 用語 | 意味 |
|------|------|
| BFF | Next.js Route Handlers / Server。OpenCode、SQLite、ファイルシステムへアクセスする唯一の WebUI サーバー。 |
| 認証プロキシ | ブラウザからの外部接続を受け、IdP 認証後に BFF の loopback URL へ中継する同一ホスト上のプロキシ。 |
| IdP | JWT の発行元または認証プロキシが参照する外部認証基盤。具体製品は未定。 |
| JWT assertion | 認証プロキシが BFF 専用に発行または再署名し、専用ヘッダーで渡す JWT。BFF はこれだけを認証根拠にする。 |
| 主体 | BFF が JWT assertion から導出する安定 ID。`sub` と `iss` の組を正規 ID とする。 |
| 権限 | API 操作を許可する最小単位。例: `project:read`、`project:add`。 |
| リモート API | LAN/VPN 利用者にも開くために新設する API。認証・認可・CSRF・レート制限・監査を必須にする。 |
| host-only API | ホスト PC の loopback からだけ利用できる既存 API。`rejectUnlessLocal` の制限を維持する。 |

## 配置と信頼境界

```
Browser
  → 認証プロキシ / TLS / IdP 連携
  → 127.0.0.1:<BFF port> の BFF
  → SQLite / filesystem / opencode serve(127.0.0.1)
```

- BFF は `127.0.0.1` / `::1` / `localhost` だけで待ち受ける。
  リモート公開は認証プロキシが外側の listener を持つ場合だけ許可する。
- 認証プロキシは BFF と同一ホストで稼働し、BFF へは loopback で接続する。
- BFF は `Host`、`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto` を
  認可根拠にしない。これらを信頼済み proxy 情報として扱わない。
- BFF が信頼する proxy 由来情報は、設定済み issuer / audience / 鍵で検証できる
  JWT assertion を運ぶ専用ヘッダーだけである。監査やレート制限で client IP が必要な場合も、
  認証プロキシが JWT assertion 内の検証済み claim として渡す。
- 認証プロキシはブラウザから届いた外来認証ヘッダーを必ず削除する。
  `Authorization`、`X-User`、`X-Email`、`X-Groups`、専用 assertion ヘッダーと同名の入力は、
  検証済み JWT assertion を再付与する前に破棄する。
- 同一ホスト上の別プロセスが BFF へ直接接続して専用ヘッダーを偽装できないよう、
  次のいずれかを必須設定にする。
  - 認証プロキシと BFF だけが持つランダム shared secret で JWT assertion を追加署名し、BFF が検証する。
  - 認証プロキシから BFF への loopback 接続で mTLS を使い、BFF がクライアント証明書を検証する。
- 認証プロキシを迂回した LAN/VPN からの BFF 直結経路は存在してはならない。
  起動時にも BFF の bind 先が loopback 以外ならリモート認証機能を無効化または起動失敗にする。

## 認証プロキシ / IdP 接続契約

BFF が token として読む入力は、設定済みの専用 assertion ヘッダー 1 つだけである。
`Authorization`、cookie、Basic Auth、生の利用者ヘッダーを BFF 側の token 入力として設定しない。

| 契約 | 認証プロキシの責務 | BFF が受け取るもの |
|------|--------------------|--------------------|
| Proxy assertion JWT | IdP やプロキシ内セッションを検証し、BFF 用 issuer / audience / subject / permissions を持つ JWT assertion を発行する。 | 設定済み専用ヘッダー（例: `X-OCW-Auth-Assertion`）上の JWT assertion。 |

Token 抽出は認証モードごとに一意にする。

- 認証プロキシは、各認証モードで外来 token の入力元を 1 つだけ設定する。
  例: `Authorization: Bearer`、IdP セッション cookie、プロキシ内セッションのいずれか 1 つ。
- 同一モードで複数の入力元を設定する構成は起動失敗にする。
- リクエストに複数の認証入力が提示された場合、または複数入力から異なる主体が導出される場合は、
  認証プロキシまたは BFF が `401` で拒否する。
- BFF は専用 assertion ヘッダーが欠落、重複、形式不正、追加署名不正、または mTLS 検証不成立なら `401` にする。

禁止事項:

- `X-User`、`X-Email`、`X-Groups` などの生ヘッダーだけで主体を確定しない。
- Basic Auth のユーザー名、パスワード、通過済み状態を主体・権限として扱わない。
- IdP / プロキシの共有秘密、クライアントシークレット、署名鍵をリポジトリやドキュメント例に書かない。

## JWT 検証条件

BFF はリモート API ごとに JWT assertion を検証し、失敗時は fail closed する。

| 項目 | 条件 |
|------|------|
| 署名 | `alg=none` は拒否。許可アルゴリズムは設定 allowlist に限定する。公開鍵系 JWKS を既定とし、対称鍵方式は別途明示設定がない限り無効。 |
| issuer | `iss` は設定済み issuer の完全一致。 |
| audience | `aud` は BFF 用 audience の完全一致。複数 audience は設定で許可されたものだけ。 |
| subject | `sub` は空でない安定 ID。BFF 内部の主体 ID は `iss + sub` から導出する。表示名やメールは識別子にしない。 |
| 時刻 | `exp` 必須、期限切れ拒否。`nbf` / `iat` がある場合は検証する。許容 clock skew は既定 60 秒以下で設定可能。 |
| 鍵 | `kid` に対応する鍵を JWKS から取得し、キャッシュする。鍵取得失敗時に未知鍵を受け入れない。 |
| claim 型 | groups / roles / permissions claim は配列または設定済み形式だけを受け入れ、文字列連結の曖昧な解釈をしない。 |
| token 用途 | remote WebUI 用 token であることを audience または用途 claim で区別する。別アプリ向け token は拒否する。 |

認証失敗は `401`、認証済みだが権限不足は `403` とする。拒否レスポンスには token、claim、
絶対パス、内部設定値を含めない。

## 主体と権限

### 主体

- 正規主体 ID は `iss` と `sub` の組で表す。
- `email`、`name`、`preferred_username` は表示と監査補助に限定し、変更可能な識別子として扱わない。
- グループ・ロール claim はプロバイダーごとに claim 名が異なるため、設定で指定する。
- 初期実装で有効な主体は、必須設定 `remoteAuth.initialAdminSubject` に完全一致する 1 主体だけとする。
  `remoteAuth.initialAdminSubject` は、BFF が JWT assertion の検証済み `iss` と `sub` から導出する
  正規 `iss + sub` 主体 ID と同じ表現で設定する。
- JWT assertion から導出した正規 `iss + sub` 主体 ID が `remoteAuth.initialAdminSubject` と完全一致しない場合、
  認証済みでもリモート API は `403` にする。
- `remoteAuth.initialAdminSubject` が空、形式不正、または起動時に正規 `iss + sub` 主体 ID として検証できない場合、
  リモート機能は無効化する。複数主体の設定や wildcard / prefix / group による管理主体拡張は、
  所有権と共有範囲の設計・実装が完了するまで禁止する。

### 権限

初期権限は次に限定する。

| 権限 | 許可する操作 |
|------|--------------|
| `project:read` | リモート専用 API で、割り当て済みルート一覧と配下ディレクトリを列挙する。 |
| `project:add` | `project:read` を含む。割り当て済みルート配下のディレクトリをプロジェクトとして追加する。 |

- 権限は JWT assertion 内の permissions claim、または JWT assertion の group / role から BFF 設定の role binding で導出する。
- API は要求権限を 1 つ以上宣言し、宣言がない API はリモート公開しない。
- `project:add` は `project:read` を含む。`project:add` を持つ主体は列挙と追加ができる。
  `project:read` のみを持つ主体は追加できない。
- 既存 `allowed_roots` はローカル作業境界であり、リモート列挙範囲として自動公開しない。
- ルート所属判定は `remote-project-picker.md` と同じく、`path.resolve` と realpath の両方で行う。
  シンボリックリンクが割り当て済みルート外へ出る場合は列挙・追加とも拒否する。

### Remote roots

- 許可ルートは主体またはロールごとに設定する。
- 実効許可ルートは、主体への allow と所属ロールへの allow の union とする。
- 主体またはロールに明示 deny がある root は、allow の union に含まれていても拒否する。
  deny は常に allow より優先する。
- `rootId` は設定内で一意な opaque ID とし、実パスを含めない。使用文字は ASCII の英数字、`-`、`_`、`.` に限定し、
  パス区切り、ドライブ名、UNC、`..`、制御文字を含めない。実パス変更時に同じ権限として扱えない場合は再利用しない。
- 表示名は管理者が指定する短い名称とし、制御文字、パス区切り、絶対パス断片を含めない。
  表示名は識別子に使わず、重複時の判定は `rootId` で行う。

## ローカル互換

- loopback で開いた既存 UI は、従来どおりネイティブフォルダ選択と host-only API を使える。
- `/api/browse/folder` は loopback 限定を維持する（ダイアログがホストの画面に出るため）。
  `/api/browse/dirs` は検証済みセッションを持つ主体に開放する（冒頭の改訂を参照）。
- リモートプロジェクト選択は新設のリモート専用 API だけを使う。
- リモート認証が未設定、設定不正、または起動検証に失敗した場合、リモート専用 API は無効化する。
  loopback の既存機能は可能な限り維持するが、BFF を外部 bind して代替しない。

## データ所有権と初期スコープ

現行の Projects / Workspaces / Sessions は利用者所有権を持たないグローバルデータであり、
既存 `/api/projects` や session API は他者可視性を前提に分離されていない。
この状態で複数リモート利用者に機能を開くと、他者の Project / Session が見える可能性がある。

- リモート機能の初期実装は、`remoteAuth.initialAdminSubject` に完全一致する単一管理主体だけを対象にする。
- 複数主体、複数管理者、group / role による管理主体の追加、`iss` または `sub` の片方だけによる照合、
  wildcard / prefix / suffix 照合は許可しない。
- 複数利用者への有効化は、Project / Workspace / Session / Goal Loop の所有者、共有範囲、監査表示、削除権限を
  設計・実装した後に限る。
- 既存データの他者可視性が残る状態は、複数利用者向けリモート機能有効化のブロッカーとする。

## リモートプロジェクト API 契約

リモートプロジェクト選択は次の API だけを使う。既存 `/api/browse/**` や `/api/projects` を
リモート picker の列挙契約として流用しない。

| API | 権限 | 入力 | レスポンス |
|-----|------|------|------------|
| `GET /api/remote-projects/roots` | `project:read` | なし | `{ roots: [{ rootId, name }] }` |
| `GET /api/remote-projects/browse?rootId=&path=` | `project:read` | `rootId`、root 相対の論理パス | `{ rootId, path, parentPath, children: [{ name }] }` |
| `POST /api/remote-projects` | `project:add` | JSON `{ rootId, path }` | `{ rootId, path, name }` |

- `path` は root 相対の論理パスであり、空文字は root 自身を表す。区切りは `/` に正規化する。
- 絶対パス、ドライブ名、UNC、`..` で root 外へ出る入力、NUL、制御文字は拒否する。
- レスポンスには `rootId`、論理相対パス、表示名、子名だけを含める。絶対パス、realpath、親の実パス、
  他 root の存在、内部設定値を返さない。
- エラーレスポンスも絶対パスを開示しない。`path_escape`、`not_found`、`permission_denied` などの一般化した理由に留める。
- `GET /api/remote-projects/browse` の子要素は直下ディレクトリの `name` だけを返し、子の full path は返さない。
- `POST /api/remote-projects` は追加直前に `path.resolve` と realpath を再実行し、列挙済みであることを信頼しない。
- 追加後に Project を利用する各 API でも、保存済みパスの realpath が同じ `rootId` の許可範囲内に残っているか再検証する。
  TOCTOU は完全排除できないため、拒否・逸脱・再検証失敗を監査ログに残す。

## CSRF

認証プロキシが cookie ベースのログインを使う可能性があるため、リモート API は CSRF を前提に設計する。

- `GET` / `HEAD` は副作用なしにする。ただし `GET /api/remote-auth/csrf` は CSRF token 発行だけを行える。
- `GET /api/remote-auth/csrf` は認証済み主体に対して CSRF token を発行し、JSON `{ csrfToken }` を返す。
  同時に `Secure`、`SameSite=Lax` または `SameSite=Strict`、`Path=/` の CSRF cookie を設定する。
- 状態変更 API は、header（例: `X-OCW-CSRF`）の token と same-site cookie を必須にし、
  BFF が期限・署名・主体・ブラウザセッションへの紐付きを検証する。
- CSRF token の有効期限は既定 30 分、設定可能な上限 2 時間とする。
- token はログイン主体の変更、JWT assertion の期限切れ、明示 logout、BFF 再起動時の secret rotation、
  または管理者による失効操作で失効する。期限延長や rotation を行う場合は、新しい GET 発行を要求する。
- `POST` / `PUT` / `PATCH` / `DELETE` は、次をすべて満たす場合だけ受け付ける。
  - `Origin` が設定済み external origin と一致する。
  - BFF 発行の CSRF token が header と same-site cookie の二重送信で一致し、期限内である。
  - `Content-Type` は JSON など許可型に限定し、単純フォーム投稿を受け付けない。
- Bearer token だけを JavaScript header で送る構成でも、状態変更 API は同じ CSRF 検証を通す。
  将来の cookie 化で保護が抜けないようにするためである。
- CSRF 失敗は `403` とし、監査ログに理由コードを残す。

## レート制限

リモート API は、BFF 単体の個人利用構成でも DoS と総当たりを抑制する。

| 対象 | キー | 方針 |
|------|------|------|
| 認証失敗 | JWT assertion の issuer と assertion 内の検証済み client IP claim | 短時間の連続失敗を `429`。JWT 検証や JWKS 取得を過剰に発生させない。 |
| ディレクトリ列挙 | 主体 ID + 許可ルート ID | 連続移動・自動スキャンを制限する。 |
| プロジェクト追加 | 主体 ID | 低めの上限にし、重複作成や大量追加を抑制する。 |
| SSE / 長寿命接続 | 主体 ID + ブラウザセッション | 同時接続数に上限を設ける。 |

既定値は安全側に置き、設定で緩和可能にする。制限値、残数、リセット時刻をレスポンスに出す場合も、
内部パスや他主体の情報は含めない。

## 監査ログ

リモート API は成功・拒否の双方を監査する。

| フィールド | 内容 |
|------------|------|
| `timestamp` | ISO 8601 UTC。 |
| `requestId` | リクエスト単位の相関 ID。 |
| `subjectId` | `iss + sub` から導出した ID。未認証時は空または `anonymous`。 |
| `authIssuer` / `authAudience` | 検証済み JWT assertion の issuer / audience。 |
| `action` | `remote_project.list_roots`、`remote_project.list_children`、`remote_project.add` など。 |
| `permission` | 要求した権限。 |
| `rootId` | 許可ルート ID。拒否時に判定前なら空。 |
| `target` | root 内相対パスまたはハッシュ。絶対パスは記録しない。 |
| `result` | `allow` / `deny` / `error`。 |
| `reason` | `auth_missing`、`jwt_invalid`、`permission_denied`、`path_escape`、`csrf_failed`、`rate_limited`、`audit_failed` など。 |
| `clientIp` | JWT assertion 内の検証済み claim から導出する。claim がなければ空。認可には使わない。 |

- token、cookie、Authorization header、秘密情報、OpenCode API key は記録しない。
- 保持期間、保存先、ローテーションは設定可能にし、未設定時はリモート API の有効化を拒否するか、安全な既定を使う。
- リモート API は次の順序で処理する。
  1. `requestId` を生成する。
  2. 認証、`remoteAuth.initialAdminSubject` との完全一致を含む認可、入力 schema、CSRF、レート制限を検証する。
  3. 監査予約を作成する。予約を書き込めない場合は即時 fail closed し、filesystem 列挙・追加を実行しない。
  4. 許可済みの列挙・追加だけ、filesystem 操作前に `path.resolve` と realpath で許可ルート内に残ることを再検証する。
  5. 結果監査を `allow` / `deny` / `error` と理由コードで確定する。
- 検証で拒否が確定した場合は filesystem 操作を実行せず、監査予約と結果監査確定の後に拒否応答を返す。
- 監査予約または結果監査確定に失敗した場合、クライアントには一般化した `503` または `403` を返す。
  結果監査確定が失敗した場合も、列挙結果や追加済み Project などの副作用を成功レスポンスとして返さない。
- `POST /api/remote-projects` の追加処理は、結果監査確定前の Project を後続 API から参照不能な隔離状態に置くか、
  同一トランザクションでロールバックできる設計にする。結果監査確定に失敗した追加は、後続アクセス不能にする。

## API default-deny

リモート公開 API は明示登録制にする。

- すべての `/api/**` は既定でリモート公開不可。
- リモート公開する API は、次を route 定義または近接メタデータで宣言する。
  - 必要権限
  - CSRF 要否
  - レート制限 bucket
  - 監査 action
  - 入力 schema
- 宣言のない API、未知の proxy path、OpenCode への任意パス中継は `403` または `404` で拒否する。
- host-only API は `rejectUnlessLocalOrAuthenticated` により、loopback または検証済み
  セッションを要求する。ホストの画面を操作する API（`/api/browse/folder`）だけは
  `rejectUnlessLocal` で loopback 限定を維持する（冒頭の改訂を参照）。
- リモートプロジェクト API は `remote-project-picker.md` の制約を再実行する。
  列挙済みであること、UI から来たこと、`Host` や `X-Forwarded-For` は認可根拠にしない。

## 設定と起動検証

設定項目名は実装時に確定するが、少なくとも次の情報を表現できること。

| 分類 | 設定内容 |
|------|----------|
| BFF bind | loopback 固定。リモート認証有効時に loopback 以外なら起動失敗。 |
| external origin | 認証プロキシが公開する `https://...` origin。CSRF / callback / 監査表示に使う。 |
| assertion header | BFF が読む専用ヘッダー名。`Authorization`、cookie、生の利用者ヘッダーは指定不可。 |
| proxy-BFF 偽装対策 | shared secret による追加署名、または mTLS。どちらか必須。 |
| 認証モード入力 | 認証プロキシが外来 token を読む一意の入力元。モードごとに 1 つだけ。 |
| JWT 検証 | issuer、audience、JWKS URI、許可 alg、clock skew、claim 名。 |
| initial admin subject | 必須の `remoteAuth.initialAdminSubject`。検証済み `iss` と `sub` から導出する正規 `iss + sub` 主体 ID と完全一致させる。 |
| role binding | group / role / permissions claim から WebUI 権限への mapping。 |
| remote roots | 主体またはロールごとの allow / deny、許可ルート ID、表示名、実パス。 |
| rate limit | bucket ごとの期間、上限、同時接続上限。 |
| CSRF | token 署名 secret、cookie 名、header 名、有効期限、rotation / 失効設定。 |
| audit | 保存先、保持期間、ローテーション、失敗時の fail closed。 |

起動時検証:

1. BFF bind 先が loopback であること。
2. リモート認証有効時、external origin が `https://` であり、localhost 以外の HTTP を拒否すること。
3. 専用 assertion ヘッダーが 1 つだけ設定され、禁止ヘッダーや cookie が token 入力に含まれていないこと。
4. 認証モードごとの外来 token 入力が 1 つだけであり、複数入力構成がないこと。
5. shared secret 追加署名または mTLS のどちらかが設定されていること。
6. issuer / audience / JWKS URI / alg allowlist / subject claim が設定されていること。
7. `remoteAuth.initialAdminSubject` が空でなく、検証済み `iss` と `sub` から導出する正規 `iss + sub` 主体 ID と
   同じ形式であり、複数主体、wildcard、prefix / suffix 条件を含まないこと。不正な場合はリモート機能を無効化すること。
8. JWKS が取得可能、または起動後の初回取得失敗時に remote API を fail closed できること。
9. role binding が未知権限を参照していないこと。
10. remote roots が存在し、`rootId` と表示名の規則を満たし、realpath 解決でき、禁止領域・UNC・ドライブルート・システム領域を含まないこと。
11. allow / deny の設定が解決でき、明示 deny 優先を適用できること。
12. audit 保存先が書き込み可能で、書き込み失敗時に remote API を fail closed でき、秘密情報をログ出力しないこと。
13. CSRF secret や JWT 秘密鍵などが必要な構成では、環境変数や OS secret store から取得し、リポジトリ内設定に含めないこと。
14. 複数利用者向けに有効化する場合、既存 Projects / Sessions の所有権・共有範囲設計が実装済みであること。

検証失敗時はリモート専用 API を無効化し、理由を管理者向けログにだけ出す。利用者向けレスポンスは
一般化した `503` または `403` とする。

## 移行

1. 現行運用では、VPN + Caddy Basic Auth は外側ゲートとして継続可能。ただし BFF は主体を識別しないため、
   リモートフォルダ列挙 API は実装・有効化しない。
2. BFF のリモート公開方針を loopback 固定へ寄せる。LAN/VPN へ直接 bind する運用は非推奨にし、
   認証プロキシ経由へ移行する。
3. 認証プロキシ / IdP 接続契約を設定し、JWT assertion 検証、proxy-BFF 偽装対策、role binding、
   remote roots、CSRF、監査保存先の起動検証を通す。
4. リモート専用 API を default-deny 登録し、`project:read` で列挙、`project:add` で列挙と追加を段階的に有効化する。
5. 既存 `allowed_roots` はローカル作業境界として維持し、必要なものだけ管理者が remote roots に明示登録する。
6. Basic Auth は併用してもよいが、認可判定・監査主体・許可ルート割当には使わない。
7. 初期実装は単一管理主体だけに提供する。複数利用者対応はデータ所有権と共有範囲を設計・実装した後に行う。

## 受入基準

1. BFF はリモート認証有効時に loopback だけで待ち受け、LAN/VPN から BFF へ直接接続できない。
2. 認証プロキシ経由でも、専用 assertion ヘッダーが欠落・重複・署名不正・issuer 不一致・audience 不一致・期限切れの場合は `401` になる。
3. 生の `X-User` 系ヘッダー、Basic Auth 通過、`Authorization` / cookie の直接提示だけでは、リモート API を呼べない。
4. 複数の認証入力が提示された場合、または入力同士の主体が一致しない場合は `401` になる。
5. `remoteAuth.initialAdminSubject` が空または不正な場合、リモート機能は起動時に無効化される。
6. JWT assertion から導出した正規 `iss + sub` 主体 ID が `remoteAuth.initialAdminSubject` と完全一致しない場合、
   認証済みでもリモート API は `403` になる。
7. `project:read` のみを持つ主体は許可ルートと配下を列挙できるが、プロジェクト追加は `403` になる。
8. `project:add` を持つ主体は `project:read` を含み、許可ルートと配下の列挙および追加ができる。
9. `project:add` を持つ主体でも、割り当て済み remote roots 外、明示 deny、UNC、ドライブルート、システム領域、
   シンボリックリンク逸脱先は列挙・追加できない。
10. `/api/remote-projects/**` は root 相対の論理パスだけを受け取り、レスポンスとエラーに絶対パスを含めない。
11. `/api/browse/folder` は認証済みリモート主体からも loopback 限定で拒否される。
    `/api/browse/dirs` は検証済みセッションを持つ主体には許可される（冒頭の改訂で変更）。
12. 状態変更 API は Origin と CSRF token が不正な場合に `403` になり、監査ログへ `csrf_failed` が残る。
13. CSRF token は `GET /api/remote-auth/csrf` で発行され、期限切れ、rotation 後、失効後は使えない。
14. レート制限超過時は `429` になり、以後の許可判定やファイル列挙を実行しない。
15. リモート API の成功・拒否・エラーは、token や秘密情報を含めず監査ログへ記録される。
16. 監査予約を書き込めない場合、リモート API は fail closed し、filesystem 列挙・追加などの副作用を実行しない。
17. 結果監査確定が失敗した場合、リモート API は成功レスポンスや追加済み Project を返さず、
    追加処理はロールバックまたは後続アクセス不能な隔離状態にされる。
18. リモート公開宣言のない `/api/**` は、認証済み主体でも default-deny で拒否される。
19. リモート認証設定が不完全な状態では、リモート専用 API は起動時または初回呼び出し時に fail closed する。
20. 既存 Projects / Sessions の他者可視性が残る状態では、複数利用者向けリモート機能を有効化できない。
21. loopback の既存ネイティブ選択とローカル利用 UX は回帰しない。

## 未決定事項

- 採用する認証プロキシ、IdP、JWT assertion 発行方式。
- claim 名、role binding の管理 UI、設定ファイルの正確な schema。
- 監査ログの保存先、保持期間、閲覧 UI、ローテーション方式。
- レート制限の具体的な既定値と永続化要否。
- リモート API の対象をプロジェクト選択以外へ拡張する場合の権限体系。
- JWT 検証に必要な JWKS が一時的に取得できない場合のキャッシュ許容期間。
- 複数利用者対応時の Project / Workspace / Session / Goal Loop の所有権、共有範囲、移行手順。
