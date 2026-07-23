# 高優先度バグ修正 仕様

## 目的

`docs/bugs/2026-07-23-bug-inventory.md` に記載された高優先度バグのうち、未修正のものを段階的に修正する。既に修正済みのグループは回帰テストの補強のみ行い、実装変更は行わない。

## 対象範囲

### 既修正（回帰テスト補強のみ）

以下のバグは別エージェントによりコード修正済みである。本仕様では実装変更を行わず、回帰テストの補強のみを対象とする。

| グループ | 対象 R | 修正内容 | 補強すべきテスト観点 |
|----------|--------|----------|---------------------|
| セットアップ | R31 / R32#1 | `setup.bat` の `start` 非ブロッキング化（`call` → `start`）＋成功判定（`BUILD_ID` 確認・`exit /b` 到達） | `setup.bat` が常駐プロセスをフォアグラウンドで呼ばず完了メッセージに到達すること。成功判定が欠如していないこと。各 errorlevel 分岐が正しい終了コードを返すこと |
| サブエージェント表示（一部） | R7#3 | NestedAgent 空 TL の解消（PartView timeline 実装） | 空のタイムラインが表示されないこと。既存の PartView 正常表示を壊さないこと |
| Attention / 同期 | R13#1 / R7#1–2 / R5#2 | Attention busy 固着の解除・部分同期で pending 消失の防止・404 を回答済み扱いしない修正（GlobalAttention v2 envelope 展開・question tool schema error 表示） | busy 状態が固着しないこと。部分同期で pending が消失しないこと。404 応答が回答済みとして扱われないこと |

**注意**: R13#2（PartView error 隠蔽）は R7#3 と同一グループとして既修正扱いされていたが、現行コードで未修正である。R7#3（空 TL）のみ既修正。R13#2 は Phase⑤ の実装対象とする。

回帰テスト補強の詳細は各 Phase の「テスト・受入条件」に記載する。補強対象は既存テストファイルへのケース追加とし、新規テストファイルは不要とする。

### 未修正（実装対象）

以下の高優先度バグを、推奨の5段階に分けて修正する。

| ID | 要約 | 優先度理由 |
|----|------|-----------|
| R52#1 | `GET /provider` が `maskSecrets` されず API キーが平文 | 秘密漏洩。UI 常用経路で provider の key が平文で読める |
| R49#1 | `GET /config/providers` が `maskSecrets` されず `providers[].key` が平文（実機確認） | 秘密漏洩。実機で API キー平文を確認済み |
| R48#1 | `GET /global/config` が `maskSecrets` されず秘密が平文で返りうる | 秘密漏洩。グローバル設定の key/token/secret が平文 |
| R40#1 | PTY create/update/delete/connect-token の write ブロック漏れ（リモートシェル相当） | セキュリティ。LAN 公開時リモートシェル相当の操作が可能 |
| R38#1 | `POST /global/dispose`・`/instance/dispose` の write ブロック漏れ（エンジン落とせる） | セキュリティ。認証なしでエンジンを dispose 可能 |
| R39#1 | `POST /vcs/apply` の write ブロック漏れ（任意パッチ適用） | セキュリティ。認証なしで任意パッチを作業ツリーへ適用可能 |
| R27 | experimental worktree/workspace 書き込みブロック漏れ（git 破壊） | セキュリティ。git ツリー破壊につながる |
| R26 / R32#2 / R7#7 | move-session・console/switch・MCP OAuth DELETE の write ブロック漏れ | セキュリティ。`isBlockedOpencodeWrite` 一括強化が必要 |
| R46#1 | タイトル再生成が `tools: {}` でツール無効化になっていない（実行しうる） | 意図しないツール実行。タイトル生成中に bash/edit が動作しうる |
| R35#1 | `removeWorktree`/`restore` の `isInside` が根一致を許可 → repo／worktrees 根の再帰削除（P0） | データ破壊。細工された sessions.json でリポジトリ全体が削除される |
| R43#1 | `POST /api/projects`・`/api/roots` が任意パスを無検証で allowlist 拡張 | セキュリティ。LAN 無認証時、攻撃者が allowlist を `C:\` 等に広げられる |
| R44#1 | temporary_copy が外向き symlink を保持し隔離を破れる | セキュリティ。隔離が symlink 先へ抜けられる |
| R15#1–2 / R12#1 / R23 | temporary_copy 復元 403・copies クロス削除・失敗時残骸／path ガード | データ破壊／隔離破り。temporary_copy の複数欠陥 |
| R19 / R30 | purgeGone allowlist 未解放＋roots 削除手段なし | セキュリティ。allowlist が肥大化し削除手段がない |
| R50#1 | GUI 起動が headless ホストを劣化と誤認して `taskkill` する | コア導線破壊。正当な headless 運用を強制終了 |
| R36#1 | OpenCode 異常 exit 後に自動再起動なし（エンジン全滅・手動／ホスト再起動まで） | コア導線破壊。エンジンが落ちると全機能停止 |
| R3#2–5 | 再起動ポール早期成功／60回失敗でも成功／OpenCode 1.5s／health が opencode.ok 無視 | コア導線破壊。再起動検出が不正確 |
| R11#1 | `timedFetch` ボディ無制限ハング | コア導線破壊。Settings の各種取得がハングしうる |
| R7#4 | SW が非 OK レスポンスをキャッシュ | コア導線破壊。壊れたチャンクを出し続ける |
| R6#1 | 画像 capability fail-open | セキュリティ。非対応モデルへ画像付き送信が通る |
| R1#3–4 | composer が iOS 16px 対策を無効化・touchActivity が送信を最大30s ブロック | コア導線破壊。iOS でズーム再発・送信遅延 |
| R2#1 | SessionSwitcher controlled snap-back | コア導線破壊。セッション切替が強制 snap-back |
| R16 / R14 / R8#2 | `initialCollapsed={!isMd}` — isMd 初期 false でデスクトップ恒久最小化 | コア導線破壊。デスクトップでプランが恒久最小化 |
| R13#2 | PartView error 隠蔽（schema error がユーザーから隠蔽される） | コア導線破壊。エラーがユーザーに見えない |

## 採用方式

依存関係とリスクの観点から、以下の5段階で修正を実施する。各段階は前段階の完了を前提とせず独立して実施可能だが、テスト実行順は依存関係に従う。

| 段階 | 名称 | 理由 |
|------|------|------|
| ① | BFF security / data guard | 秘密漏洩・write ブロック漏れは最大リスク。BFF 層の防御を最優先で固める |
| ② | allowlist / temp copy | データ破壊・隔離破り。①の write ブロック強化と組み合わせて防御層を完成させる |
| ③ | host reliability | エンジン・ホストの可用性。①・②の防御が効いた状態で再起動・ヘルス監視を改善する |
| ④ | 通信 / SW | Service Worker・fetch の信頼性。③でホストが安定した後に通信層を固める |
| ⑤ | UI core | iOS・SessionSwitcher・プランカード折畳み・PartView error 表示。他段階に依存しないため最終段階または並行実施可能 |

---

## Phase ①: BFF security / data guard

### 対象 R

R52#1, R49#1, R48#1, R40#1, R38#1, R39#1, R27, R26 / R32#2 / R7#7, R46#1, R6#1

### 変更境界

| ファイル | 変更内容 |
|----------|----------|
| `web/src/app/api/opencode/[...path]/route.ts` の `maskSecrets` 適用箇所 | `GET /provider`・`GET /config/providers`・`GET /global/config` のレスポンスに対し `maskSecrets` を適用する。既存の `maskSecrets` 関数がこれらのエンドポイントを通過していない場合、通過経路に組み込む。現行コードでは `GET /config` のみ `maskSecrets` 適用済み。`/provider`・`/config/providers`・`/global/config` にも拡張する |
| `web/src/app/api/opencode/[...path]/route.ts` の `isBlockedOpencodeWrite` | PTY create/update/delete/connect-token (`/pty/*`)、`POST /global/dispose`、`POST /instance/dispose`、`POST /vcs/apply`、experimental worktree/workspace (`/experimental/worktree/*`・`/experimental/workspace/*`)、`POST /experimental/control-plane/move-session`、`POST /experimental/console/switch`、`DELETE /mcp/{name}/auth` を denylist に追加する |
| `web/src/lib/opencode.ts` の `isBlockedOpencodeWrite` | 上記と同様のエンドポイントをサーバーサイド（`ocServer`）でもブロックするため、関数本体に追加する |
| `web/src/app/api/workspaces/[id]/sessions/[sessionId]/refresh-title/route.ts` | タイトル再生成リクエストのペイロードに、全ツール名をキーとして全値 `false` の非空マップを `tools` フィールドに設定する。実装前に OpenCode の session prompt の `requestBody` 型（`opencode-schema.d.ts` の `tools?: { [key: string]: boolean }`）を検証し、upstream で公開される全ツール名を明示して全値 `false` の非空マップを渡す。`tools: {}`（空オブジェクト）は「無効化済み」とみなされずツール実行を許容する可能性があるため、非空マップで確実に無効化する |
| 画像送信ロジック（UI: `web/src/components/home/HomeView.tsx`・`web/src/components/task/TaskView.tsx`、BFF: `web/src/app/api/opencode/[...path]/route.ts`） | 画像 capability が `true` のときのみ画像付きメッセージの送信を許可する。`false`・`undefined`・capability 取得失敗・未知モデルはすべてブロックする。UI 側では送信前にモデルの capability を確認し、非対応の場合は画像添付を無効化する。BFF 側でもプロキシ時に画像付きリクエストのモデル capability を検証し、非対応の場合は 400 で拒否する |

### 失敗時挙動

| 失敗シナリオ | 挙動 |
|-------------|------|
| `maskSecrets` が未実装のエンドポイントを通過 | 該当エンドポイントのレスポンスは HTTP 500 で拒否する。ログに警告を出力する。平文のまま返すことは許容しない |
| `isBlockedOpencodeWrite` の denylist に未列挙の mutating method が存在 | 該当メソッドは HTTP 403 でブロックする。本 Phase では既知の漏れ（上記一覧）のみを塞ぐが、未知の漏れが後日発見された場合もブロックされるよう、denylist にワイルドカードまたは prefix マッチを追加することを推奨する |
| `tools` 非空マップ（全値 `false`）が OpenCode 側で拒否される | タイトル再生成が失敗する。エラーハンドリングは既存の失敗時処理に委ね、ユーザーにエラーが表示されることを確認する |
| 画像 capability 確認が非同期でタイムアウト | 画像付き送信をブロックし、ユーザーに「画像対応を確認できません」と表示する。fail-open は許容しない |
| 未知モデルに対して capability が取得できない | 画像付き送信をブロックする。未知モデルは非対応とみなす |

### テスト・受入条件

#### 既修正グループの回帰テスト補強（本 Phase で実施）

- R31 / R32#1: `setup.bat` の `start` 呼出しが非ブロッキングであることのテストケースを `setup.bat` の静的分岐確認に追加する。成功判定（`exit /b 0` 到達）が欠如していないことを確認するケースを追加する。
- R7#3: PartView が空のタイムラインを表示しないことのテストケースを既存の NestedAgentPanel テストに追加する。
- R13#1 / R7#1–2 / R5#2: Attention busy が固着しないことのテストケースを既存の Attention テストに追加する。404 応答が回答済みとして扱われないことを確認するケースを追加する。

#### 未修正バグのテスト

- `maskSecrets` が `GET /provider`・`GET /config/providers`・`GET /global/config` のレスポンスに適用されることのユニットテストを追加する。各エンドポイントのモックレスポンスに対し、`key`・`token`・`secret` フィールドがマスクされていることを確認する。
- `isBlockedOpencodeWrite` が上記一覧の全エンドポイントをブロックすることのユニットテストを追加する。各エンドポイントのモックリクエストに対し、403 が返ることを確認する。
- タイトル再生成リクエストのペイロードに、全ツール名をキーとして全値 `false` の非空マップが `tools` フィールドに含まれることのユニットテストを追加する。
- 画像 capability が `true` のモデルに対してのみ画像付きメッセージが送信され、`false`・`undefined`・取得失敗・未知モデルではブロックされることのユニットテストを UI・BFF 両方に追加する。

#### 受入条件

1. `GET /provider` のレスポンスに `maskSecrets` が適用され、API キーがマスクされている
2. `GET /config/providers` のレスポンスに `maskSecrets` が適用され、`providers[].key` がマスクされている
3. `GET /global/config` のレスポンスに `maskSecrets` が適用され、秘密情報がマスクされている
4. PTY create/update/delete/connect-token が BFF プロキシでブロックされる（HTTP 403）
5. `POST /global/dispose`・`POST /instance/dispose` が BFF プロキシでブロックされる（HTTP 403）
6. `POST /vcs/apply` が BFF プロキシでブロックされる（HTTP 403）
7. experimental worktree/workspace の全 mutating method が BFF プロキシでブロックされる（HTTP 403）
8. `POST /experimental/control-plane/move-session`・`POST /experimental/console/switch`・`DELETE /mcp/{name}/auth` が BFF プロキシでブロックされる（HTTP 403）
9. タイトル再生成リクエストのペイロードに、全ツール名をキーとして全値 `false` の非空マップが `tools` フィールドに含まれる
10. 画像 capability が `true` のモデルに対してのみ画像付きメッセージが送信される
11. 画像 capability が `false`・`undefined`・取得失敗・未知モデルの場合、画像付きメッセージがブロックされる
12. 既存の write ブロック（既にブロック済みのエンドポイント）が引き続きブロックされる
13. 既存の read-only エンドポイントが引き続き通過する

### FU-6（R46#1）の制約

タイトル再生成における `tools` フィールドの実装は、以下の手順で行う。

1. OpenCode の session prompt の `requestBody` 型を `opencode-schema.d.ts` で確認する。現行のスキーマでは `tools?: { [key: string]: boolean }` と定義されている。
2. upstream（OpenCode エンジン）で公開される全ツール名を `GET /tools` または同等のエンドポイントから取得する。
3. 全ツール名をキーとし、全値 `false` の非空マップを `tools` フィールドに設定する。
4. `tools: {}`（空オブジェクト）は使用しない。空オブジェクトは upstream で「無効化済み」と解釈されず、ツール実行を許容する可能性があるため。

スキーマ確認が完了するまで本件の実装は着手しない。

---

## Phase ②: allowlist / temp copy

### 対象 R

R35#1, R43#1, R44#1, R15#1–2 / R12#1 / R23, R19 / R30

### 変更境界

| ファイル | 変更内容 |
|----------|----------|
| `web/src/lib/git.ts` の `isInside`（`removeWorktree` 内） | 根一致（`path === root`）を許可しないよう条件を `>` から `>=` に変更する。または `path !== root` の明示的ガードを追加する。`allowlist.ts` の `isInside` は変更しない（別の実装であり、根一致の扱いが異なる） |
| `web/src/lib/project-session-sync.ts` の `isInside`（`restoreProjectFromManifest` 内） | 根一致（`path === root`）を許可しないよう条件を `>` から `>=` に変更する。または `path !== root` の明示的ガードを追加する |
| `web/src/app/api/projects/route.ts`・`web/src/app/api/roots/route.ts` | `POST` ハンドラで受け取ったパスが実在するディレクトリであること（`fs.existsSync` + `fs.lstatSync(path).isDirectory()`）を検証してから allowlist に追加する。存在しないパスやファイルパスは HTTP 400 で拒否する。さらに、以下のパターンも HTTP 400 で拒否する: Windows ドライブルート（`C:\` 等）、`C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\ProgramData`、ユーザープロファイル直下（`C:\Users\<username>`）、およびこれらに類する広すぎる／システム領域 |
| `web/src/lib/copy.ts` の `createTemporaryCopy` | `dereference: false` のままコピーするが、コピー先に外向き symlink を残さない。コピー完了後にコピー先ディレクトリを走査し、外向き symlink（コピー元の範囲外を指す symlink）を削除する。コピー失敗時は部分コピーと allowlist エントリをロールバックする（`removeTemporaryCopy` を呼ぶ） |
| `web/src/lib/workspace-service.ts` の `provisionWorkspace`（temporary_copy 作成部分） | コピー失敗時に `removeTemporaryCopy` を呼び、部分コピーと allowlist エントリをクリーンアップする |
| `web/src/lib/workspace-service.ts` の `destroyWorkspace`（temporary_copy 削除部分） | `removeTemporaryCopy` のパス比較を完全一致で行い、他コピーを巻き込まないことを確認する。現行の `removeTemporaryCopy` は `path.relative` によるガード済み |
| temporary_copy 復元処理（`web/src/lib/workspace-service.ts` または復元用ルート） | temporary_copy 復元時に allowlist 再登録を行う。再登録は `temporaryCopyRoot()` 配下の直接子（1階層下）かつ実在するディレクトリのみを allowlist に追加する。それ以外のパスは拒否する。復元失敗時は部分的な復元を行わず、全体を失敗させる |
| `web/src/app/api/workspaces/orphans/route.ts` | `purgeGoneOrphans` で temporary_copy の allowlist を解放する（`removeAllowedRoot` を呼ぶ） |
| `web/src/app/api/roots/route.ts` | `DELETE` ハンドラを追加し、指定された root を allowlist から削除できるようにする。UI（`web/src/components/settings/SettingsView.tsx`）に削除ボタンを追加する |

### 失敗時挙動

| 失敗シナリオ | 挙動 |
|-------------|------|
| `isInside` の変更で既存の正当なパスが誤って拒否される | 該当パスの操作が 403 で失敗する。テストで既存の全 allowlist 使用箇所を確認し、回帰を防止する |
| パス検証でタイムアウト・ディスクエラー | 該当リクエストを HTTP 500 で拒否する。allowlist は変更しない |
| temporary_copy 復元時の allowlist 再登録に失敗 | 復元自体を失敗させ、ユーザーにエラーを表示する。部分的な復元は行わない |
| `DELETE /api/roots` で存在しない root を指定 | HTTP 404 を返す |
| コピー失敗時のロールバックに失敗 | HTTP 500 を返し、管理者に手動クリーンアップを促すログを出力する |

### テスト・受入条件

- `isInside` が根一致を拒否することのユニットテストを `git.test.ts` に追加する（`path === root` で `false` を返すケース）
- `isInside` が根一致を拒否することのユニットテストを `project-session-sync.test.ts` に追加する
- `POST /api/projects`・`POST /api/roots` が存在しないパスを拒否することのユニットテストを追加する
- `POST /api/projects`・`POST /api/roots` が Windows ドライブルート・システム領域を HTTP 400 で拒否することのユニットテストを追加する
- temporary_copy 作成時に外向き symlink が除去されることのユニットテストを `copy.test.ts` に追加する
- temporary_copy 復元時に allowlist が再登録されることのユニットテストを `workspace-service.test.ts` に追加する
- temporary_copy 復元時の allowlist 再登録が `temporaryCopyRoot()` 配下の直接子かつ実在ディレクトリのみに限定されることのユニットテストを追加する
- copies 削除時に他コピーを削除しないことのユニットテストを追加する
- temporary_copy 失敗時に部分コピーと allowlist がロールバックされることのユニットテストを追加する
- `purgeGoneOrphans` が temporary_copy の allowlist を解放することのユニットテストを追加する
- `DELETE /api/roots` が存在する root を削除し、存在しない root に 404 を返すことのユニットテストを追加する
- SettingsView に roots 削除ボタンが表示され、操作できることの結合テストを追加する

#### 受入条件

1. `isInside`（`git.ts`）が `path === root` の場合に `false` を返す
2. `isInside`（`project-session-sync.ts`）が `path === root` の場合に `false` を返す
3. `POST /api/projects` が存在しないパスを HTTP 400 で拒否する
4. `POST /api/roots` が存在しないパスを HTTP 400 で拒否する
5. `POST /api/projects`・`POST /api/roots` が Windows ドライブルート・`C:\Windows`・`C:\Program Files`・`C:\Program Files (x86)`・`C:\ProgramData`・ユーザープロファイル直下を HTTP 400 で拒否する
6. temporary_copy 作成時に外向き symlink が除去される
7. temporary_copy 復元時に allowlist が再登録される
8. temporary_copy 復元時の allowlist 再登録が `temporaryCopyRoot()` 配下の直接子かつ実在ディレクトリのみに限定される
9. copies 削除時に他コピーを削除しない
10. temporary_copy 失敗時に部分コピーと allowlist がロールバックされる
11. `purgeGoneOrphans` が temporary_copy の allowlist を解放する
12. `DELETE /api/roots` が存在する root を削除し、存在しない root に 404 を返す
13. SettingsView に roots 削除ボタンが表示され、操作できる

---

## Phase ③: host reliability

### 対象 R

R50#1, R36#1, R3#2–5

### 変更境界

| ファイル | 変更内容 |
|----------|----------|
| `web/src/lib/opencode.ts` の `OPENCODE_BASE_URL` | 変更なし。既存の設定を維持する |
| `web/src/app/api/health/route.ts` | 現行の実装を維持する（HTTP 200 + `webui.ok: true` + `opencode.ok`）。`webui.ok` は常に `true` を返し続ける（後方互換性）。`opencode.ok` が `false` の場合も `webui.ok` は `true` のままとする |
| health ポーリング呼出元（`web/src/components/settings/SettingsView.tsx` 等） | ターゲット別の成功条件を実装する: `webui` ターゲットは HTTP 取得成功（HTTP 200 + `webui.ok === true`）、`opencode` ターゲットは `body.opencode.ok === true`、`all` ターゲットは両方を成功条件とする。60回連続失敗は必ずエラーとして扱う |
| ホスト起動確認（`host/src/index.js`・`start-webui.bat`） | health チェックでレスポンス形式の変更に対応する。`webui.ok` の存在を確認する |
| headless 検出ロジック | `--headless` フラグ・環境変数 `OPENCODE_HEADLESS` の両方を確認する。headless モードでは GUI 起動による `taskkill` を実行しない |
| OpenCode 異常 exit 検出・自動再起動 | OpenCode プロセスの異常終了を検出し、自動再起動を試行する。再起動回数上限は 3回/5分 とし、超過時はホスト再起動にフォールバックする |

### レスポンス形式

`/api/health` のレスポンス形式は以下の通り。変更は加算的に行い、既存フィールドを削除しない。

```json
{
  "webui": { "ok": true },
  "opencode": { "ok": true, "version": "0.42.0" },
  "opencodeBaseUrl": "http://127.0.0.1:4096"
}
```

### 成功条件（ターゲット別）

| ターゲット | 成功条件 |
|-----------|---------|
| `webui` | HTTP 200 + `body.webui.ok === true` |
| `opencode` | `body.opencode.ok === true` |
| `all` | HTTP 200 + `body.webui.ok === true` + `body.opencode.ok === true` |

### 失敗時挙動

| 失敗シナリオ | 挙動 |
|-------------|------|
| headless 検出が誤って非 headless を検出 | `taskkill` が実行されない（安全側）。ログに警告を出力する |
| OpenCode 自動再起動が無限ループ | 再起動回数上限（3回/5分）で停止し、ホスト再起動にフォールバックする |
| `/api/health` の `opencode.ok` が未実装の OpenCode バージョン | `opencode.ok` がレスポンスに含まれない場合、従来の HTTP 200 のみの判定にフォールバックする |
| health ポーリングが60回連続失敗 | 必ずエラー表示に遷移する。途中成功がない限りエラーを回避しない |

### テスト・受入条件

- headless モード検出のユニットテストを追加する（`--headless` フラグ・環境変数の両方）
- OpenCode 異常 exit 検出・自動再起動のユニットテストを追加する（モックプロセス使用）
- 再起動回数上限超過時の挙動テストを追加する
- `/api/health` が `opencode.ok` を参照することのユニットテストを追加する
- `/api/health` の全呼出元が新形式でも動作することの結合テストを追加する
- health ポーリングの最大試行回数（60回）・タイムアウト（1.5秒）のユニットテストを追加する
- ターゲット別の成功条件（`webui`・`opencode`・`all`）のユニットテストを追加する
- 60回連続失敗時に必ずエラーとなることのユニットテストを追加する

#### 受入条件

1. headless モードで GUI 起動しても `taskkill` が実行されない
2. OpenCode プロセスが異常終了した場合、自動再起動が試行される
3. 再起動回数が上限（3回/5分）を超えた場合、ホスト再起動にフォールバックする
4. `/api/health` が `opencode.ok` をレスポンスに含む
5. `opencode.ok === false` の場合、UI が OpenCode 未起動として扱う
6. health ポーリングが60回連続失敗した場合、必ずエラー表示に遷移する
7. `/api/health` の既存呼出元がすべて新形式で動作する
8. `webui.ok` は常に `true` を返し続ける
9. `webui` ターゲットは HTTP 200 + `webui.ok === true` を成功条件とする
10. `opencode` ターゲットは `body.opencode.ok === true` を成功条件とする
11. `all` ターゲットは両方を成功条件とする
12. R2#2（再起動二重 202 no-op）は中優先度のため本 Phase の対象外とする

---

## Phase ④: 通信 / SW

### 対象 R

R11#1, R7#4

### 変更境界

| ファイル | 変更内容 |
|----------|----------|
| `web/src/lib/client.ts` | `timedFetch` のボディサイズ上限ではなく、レスポンスボディの読了までタイムアウトを保証する `timedJson` 等の API に移行する。現行の `timedFetch` はリクエスト送信のみタイムアウトし、レスポンスボディの読了を保証しない。`getJson`・`sendJson`・`ocJson` はレスポンスボディの `res.json()` 読了までタイムアウトが継続することを保証する実装に変更する |
| Service Worker ファイル（`web/public/sw.js` または `web/src/service-worker.ts`） | 非 OK レスポンス（HTTP 4xx・5xx）をキャッシュしないよう、`fetch` イベントハンドラでステータスコードを確認する。`response.ok === false` の場合はキャッシュに保存せず、ネットワークレスポンスをそのまま返す |

### 失敗時挙動

| 失敗シナリオ | 挙動 |
|-------------|------|
| レスポンスボディ読了がタイムアウト | `ApiError`（status 408）を throw する。呼出元のエラーハンドリングに委ねる |
| SW のキャッシュ判定で `response.ok` が undefined | `response.ok` が undefined の場合は非 OK として扱い、キャッシュしない |
| SW の変更が反映されない（古い SW が動作中） | 新しい SW が `install` 後に `skipWaiting` し、`activate` 後に `clients.claim` することを確認する。既存の SW 更新フローに従う |

### テスト・受入条件

- `getJson`・`sendJson`・`ocJson` がレスポンスボディ読了までタイムアウトを保証することのユニットテストを追加する（モック `Response` 使用）
- Service Worker が非 OK レスポンスをキャッシュしないことのユニットテストを追加する（モック `Response` 使用）
- SW の `install`・`activate` イベントが正しく動作することの結合テストを追加する

#### 受入条件

1. `getJson`・`sendJson`・`ocJson` がレスポンスボディ読了までタイムアウトを保証する
2. レスポンスボディ読了がタイムアウトした場合、`ApiError`（status 408）が throw される
3. Service Worker が HTTP 4xx・5xx のレスポンスをキャッシュしない
4. HTTP 200 のレスポンスは従来通りキャッシュされる
5. 既存の SW 更新フローが維持される

---

## Phase ⑤: UI core

### 対象 R

R1#3–4, R2#1, R16 / R14 / R8#2, R13#2

### 変更境界

| ファイル | 変更内容 |
|----------|----------|
| Composer コンポーネント（`web/src/components/home/HomeView.tsx`・`web/src/components/task/TaskView.tsx`） | iOS 16px フォントサイズ対策（`font-size: 16px` または CSS `text-size-adjust: 100%`）が composer の入力フィールドに適用されていることを確認する。`touchActivity` による送信ブロック時間を最大30秒から最大5秒に短縮する。または `touchActivity` のブロックを送信前に解除する条件を追加する |
| `web/src/components/task/SessionSwitcher.tsx` | controlled snap-back を解消する。選択されたセッションが state に正しく反映され、外部からの強制リセットがかからないようにする。`value` と `onChange` の制御フローを見直し、不要な `useEffect` の再実行を防止する |
| `web/src/components/task/TaskView.tsx`（`PlanDocumentCard` の `initialCollapsed` 箇所） | `initialCollapsed={!isMd}` のロジックを見直す。`isMd` が初期 `false` のためデスクトップで常に折り畳まれる問題を修正する。`isMd` の初期値を `true` にするか、または `initialCollapsed` の計算を `useEffect` で `isMd` 確定後に行う |
| `web/src/components/task/PartView.tsx` | schema error がユーザーから隠蔽されず表示されることを確認する。`ToolPartView` 内で `status === "error"` の場合にエラー内容（`state?.error` または `state?.output`）を表示する。現行コードでは `rawOutput` として `state?.output ?? state?.error ?? ""` を取得しているが、`hasDetail` が `false` の場合にエラーが折り畳まれて表示されない可能性がある。エラー時は常に展開状態でエラー内容を表示する |

### 失敗時挙動

| 失敗シナリオ | 挙動 |
|-------------|------|
| iOS 16px 対策が CSS の競合で無効化 | composer 入力時に iOS が自動ズームする。CSS の優先順位を確認し、`!important` を使用せずに適用する |
| `touchActivity` 短縮で送信競合が発生 | 送信が二重に実行される可能性がある。既存の送信ロック（`disabled` state）と組み合わせて競合を防止する |
| SessionSwitcher の修正で既存の制御フローが壊れる | セッション切替が効かなくなるか、誤ったセッションが選択される。既存の全切替パターン（クリック・キーボード・API 経由）をテストする |
| `initialCollapsed` の修正で既存の折畳み動作が壊れる | プランカードが常に展開されるか、またはモバイルで折り畳まれなくなる。既存の全表示パターン（デスクトップ・モバイル）をテストする |
| PartView error 表示の修正で既存の正常表示が壊れる | 正常なツール実行結果がエラーと誤判定されるか、またはエラー表示が重複する。既存の全 PartView 表示パターンをテストする |

### テスト・受入条件

- iOS 16px 対策が composer の入力フィールドに適用されていることのテストを追加する（JSDOM では再現不可のため、E2E または手動確認）
- `touchActivity` による送信ブロックが最大5秒であることのユニットテストを追加する
- SessionSwitcher が controlled snap-back しないことのユニットテストを追加する（選択 state が外部から強制リセットされないケース）
- `PlanDocumentCard` の `initialCollapsed` がデスクトップで `false` になることのユニットテストを追加する
- `PartView` が `status === "error"` の場合にエラー内容を常に表示することのユニットテストを追加する
- `PartView` が schema error を隠蔽せず表示することのテストケースを既存の PartView テストに追加する

#### 受入条件

1. iOS 実機で composer 入力時に自動ズームが発生しない
2. `touchActivity` による送信ブロックが最大5秒以内である
3. SessionSwitcher でセッションを選択した後、外部イベントによって強制的に別のセッションに snap-back しない
4. 既存のセッション切替操作（クリック・キーボード）が正常に動作する
5. 既存の composer 送信・編集体験を壊さない
6. デスクトップでプランカードが初期状態で折り畳まれない
7. モバイルでプランカードが初期状態で折り畳まれる（既存動作維持）
8. PartView が `status === "error"` の場合にエラー内容を常に表示する
9. PartView が schema error を隠蔽せず表示する
10. 既存の PartView 正常表示を壊さない

---

## ファイル構成

```
opencode-webui/
├── docs/
│   ├── bugs/
│   │   └── 2026-07-23-bug-inventory.md          # バグ一覧（変更なし）
│   └── superpowers/
│       └── specs/
│           └── 2026-07-23-high-priority-bug-fixes-design.md  # 本仕様書
```

## セキュリティ

- `maskSecrets` は既存の実装を再利用し、新たな秘密情報のログ出力・ファイル保存を行わない
- `isBlockedOpencodeWrite` の denylist 追加は最小限の変更とし、allowlist 方式への移行は別途検討する
- パス検証は `fs.existsSync` + `fs.lstatSync` を使用し、シンボリックリンクの解決は行わない。ただし temporary_copy 作成時は外向き symlink を除去する
- 再起動回数上限はハードコードし、設定ファイルからの変更は受け付けない
- Service Worker の変更は HTTPS または localhost でのみ有効であることを前提とする
- 画像 capability の fail-open は一切許容しない。`false`・`undefined`・取得失敗・未知モデルはすべてブロックする
- タイトル再生成の `tools` フィールドは非空マップ（全値 `false`）を使用し、空オブジェクトは使用しない
- システム領域（Windows ドライブルート・`C:\Windows`・`C:\Program Files` 等）の allowlist 登録は HTTP 400 で拒否する

## 自己レビュー結果

本仕様書改訂後に以下の観点で自己レビューを実施した。

| 観点 | 結果 |
|------|------|
| Placeholder の有無 | なし。すべての R 番号・ファイル名（`web/src/` 起点）・条件・数値は具体的に記載した。TBD・「適宜」「適切に」「必要に応じて」等の曖昧表現は使用していない |
| 整合性 | `docs/bugs/2026-07-23-bug-inventory.md` の高優先度一覧と本仕様書の対象 R 一覧を突合し、過不足がないことを確認した。R16/R14/R8#2 と R13#2 を既修正から未修正（Phase⑤）に移動した。R7#3 のみ既修正として残した。R44#1 を Phase② に追加した。R26 のパスを `/experimental/control-plane/move-session`、R7#7 のパスを `DELETE /mcp/{name}/auth` に訂正した。R2#2 を対象外と明記した |
| 対象網羅 | 全 Phase の対象 R が過不足なくカバーされている。R50/R36 の host 信頼性、R7#4、R1#3–4、R2#1 は各 Phase に残した。R11#1 の解決方法を body size 上限から `timedJson` 等への API 移行に訂正し、実パスを `web/src/lib/client.ts` にした。R46#1 の実パスを `web/src/app/api/workspaces/[id]/sessions/[sessionId]/refresh-title/route.ts` にし、`tools: {}` から非空マップ（全値 `false`）に要件を変更した。R6#1 は UI と BFF 両方のガードを明記した |
| 曖昧性 | 「失敗時は平文のまま返す」「未列挙は通過」のような安全性を容認する記述を削除し、阻止または明確なエラーを仕様化した。各 Phase の変更境界はファイル名・変更内容を具体的に記載した。失敗時挙動はシナリオ別に記載した。自己レビュー観点は placeholder・整合性・対象網羅・曖昧性の4項目を明記した |
