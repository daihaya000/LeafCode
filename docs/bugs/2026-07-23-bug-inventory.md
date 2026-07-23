# バグインベントリ R1–R54（2026-07-23）

発見ループ R1–R54 から抽出。MEMORY.md の各エントリを優先度3段階に整理した。
修正は別エージェントが行う。本ファイルは発見記録の参照用であり、MEMORY.md の既存エントリは改変しない。

---

## 優先度判定基準

| 優先度 | 基準 |
|--------|------|
| **高** | セキュリティ侵害（秘密漏洩・認証バイパス・任意コード実行）／データ破壊（ファイル削除・隔離破り）／コア導線が完全に壊れる（送信不能・エンジン停止・初回セットアップ不能） |
| **中** | 実害があるが回避策あり／特定条件下でのみ発現／頻度限定／UI の誤表示・操作性低下 |
| **低** | 文言のズレ／仕様ギャップ／レア edge ケース／既に別件に包含／実装前の仕様のみ |

---

## 高（すぐ直す）

| ID | 要約 | 優先度理由 |
|----|------|-----------|
| R35#1 | `removeWorktree`/`restore` の `isInside` が根一致を許可 → repo／worktrees 根の再帰削除（P0） | データ破壊。細工された sessions.json でリポジトリ全体が削除される |
| R43#1 | `POST /api/projects`・`/api/roots` が任意パスを無検証で allowlist 拡張 | セキュリティ。LAN 無認証時、攻撃者が allowlist を `C:\` 等に広げられる |
| R52#1 | `GET /provider` が `maskSecrets` されず API キーが平文（directory 不要・UI 常用） | 秘密漏洩。UI 常用経路で provider の key が平文で読める |
| R49#1 | `GET /config/providers` が `maskSecrets` されず `providers[].key` が平文（実機確認） | 秘密漏洩。実機で API キー平文を確認済み |
| R48#1 | `GET /global/config` が `maskSecrets` されず秘密が平文で返りうる | 秘密漏洩。グローバル設定の key/token/secret が平文 |
| R50#1 | GUI 起動が headless ホストを劣化と誤認して `taskkill` する | コア導線破壊。正当な headless 運用を強制終了 |
| R46#1 | タイトル再生成が `tools: {}` でツール無効化になっていない（実行しうる） | 意図しないツール実行。タイトル生成中に bash/edit が動作しうる |
| R40#1 | PTY create/update/delete/connect-token の write ブロック漏れ（リモートシェル相当） | セキュリティ。LAN 公開時リモートシェル相当の操作が可能 |
| R38#1 | `POST /global/dispose`・`/instance/dispose` の write ブロック漏れ（エンジン落とせる） | セキュリティ。認証なしでエンジンを dispose 可能 |
| R39#1 | `POST /vcs/apply` の write ブロック漏れ（任意パッチ適用） | セキュリティ。認証なしで任意パッチを作業ツリーへ適用可能 |
| R36#1 | OpenCode 異常 exit 後に自動再起動なし（エンジン全滅・手動／ホスト再起動まで） | コア導線破壊。エンジンが落ちると全機能停止 |
| R27 | experimental worktree/workspace 書き込みブロック漏れ（git 破壊） | セキュリティ。git ツリー破壊につながる |
| R26 / R32#2 / R7#7 | move-session・console/switch・MCP OAuth DELETE の write ブロック漏れ | セキュリティ。`isBlockedOpencodeWrite` 一括強化が必要 |
| R16 / R14 / R8#2 | `initialCollapsed={!isMd}` — isMd 初期 false でデスクトップ恒久最小化 | コア導線破壊。デスクトップでプランが恒久最小化（master 投入済み） |
| R31 / R32#1 | `setup.bat` が start-webui 常駐で完了しない＋成功判定欠如 | 初回セットアップ不能。完了メッセージに到達しない |
| R15#1–2 / R12#1 / R23 | temporary_copy 復元 403・copies クロス削除・失敗時残骸／path ガード | データ破壊／隔離破り。temporary_copy の複数欠陥 |
| R19 / R30 | purgeGone allowlist 未解放＋roots 削除手段なし | セキュリティ。allowlist が肥大化し削除手段がない |
| R13#1 / R7#1–2 / R5#2 | Attention busy 固着・部分同期で pending 消失・404 を回答済み扱い | コア導線破壊。権限応答不能・未応答が消える |
| R11#1 | `timedFetch` ボディ無制限ハング | コア導線破壊。Settings の各種取得がハングしうる |
| R6#1 | 画像 capability fail-open | セキュリティ。非対応モデルへ画像付き送信が通る |
| R7#4 | SW が非 OK レスポンスをキャッシュ | コア導線破壊。壊れたチャンクを出し続ける |
| R3#2–5 | 再起動ポール早期成功／60回失敗でも成功／OpenCode 1.5s／health が opencode.ok 無視 | コア導線破壊。再起動検出が不正確 |
| R1#3–4 | composer が iOS 16px 対策を無効化・touchActivity が送信を最大30s ブロック | コア導線破壊。iOS でズーム再発・送信遅延 |
| R2#1 | SessionSwitcher controlled snap-back | コア導線破壊。セッション切替が強制 snap-back |
| R7#3 / R13#2 | NestedAgent 空 TL・PartView error 隠蔽 | コア導線破壊。エラーがユーザーに見えない |

---

## 中（次に直す）

| ID | 要約 | 優先度理由 |
|----|------|-----------|
| R20 / R6#2 | FileTree「上へ」root 超え＋browse/dirs 任意列挙 | セキュリティ。任意ディレクトリ列挙可能だが browse/dirs は LAN 公開時のみ |
| R18 | `children.length===1` 誤マッチ | 操作性低下。子セッションが誤って親と判定される |
| R21 / R11#2–3 | GraphPanel directory stale／スピナー・エラー残留 | UI 不具合。古いデータ・永久スピナー・エラー残留 |
| R17 | abort 直後再送信が idle に潰される・削除409で画面残留 | 操作性低下。abort 後の再送信が効かない・削除失敗で画面が残る |
| R24 | エージェント選択時 intelligence が手動モデル基準 | 操作性低下。agent と variant が不整合 |
| R9#1 | SSE 再接続中 stale idle ガード無効 | 操作性低下。再接続中に二重送信しうる |
| R3#1 / R4#2 | kebab z-index／busy 中も削除可 | UI 不具合。モーダル重なり・誤操作 |
| R1#1–2 | E2E 文字化け・巻き戻し E2E 乖離 | テスト不備。E2E が実 UI と乖離 |
| R28 | 画像サイズ・枚数上限なし | リソース。メモリ逼迫・リクエスト肥大 |
| R29 / R10#1 | favorite が last_opened を汚す／トグル失敗無言 | 操作性低下。並び順が乱れる・エラーが無言 |
| R33 | worktree defaultTarget が upstream 無視 | 操作性低下。意図しない分岐点から worktree が切られる |
| R22 | bindSession unsafe id 黙殺 | セキュリティ（低リスク）。不正 id を黙殺するが実害限定的 |
| R16#2 / R14#2 | orphan 掃除クロス削除・削除409画面残留 | 操作性低下。誤削除リスク・画面残留 |
| R12#2 | archived→「マージ済」ズレ | UI 不具合。未マージでも「マージ済」表示 |
| R7#5–6 | DiffPane archive 黙殺・diff/files 200+git:false | UI 不具合。archive 失敗が無視・エラーが非 git に見える |
| R9#2–3 | 為替 clamp UI ズレ・AddProject パス上書き | UI 不具合。プレビューと実表示がズレる・入力が上書き |
| R5#1 / R4#1 | Attention フォーカス破壊・SessionSwitcher 並び遅延 | 操作性低下。フォーカス復帰先が壊れる・並びが遅延 |
| R25 | compact 失敗でも「巻き戻し失敗」 | UI 不具合。誤ったエラーメッセージ |
| R15#4 | CodexBar 空 credits を last-good 扱い | UI 不具合。古い credits を表示し続ける |
| R13#3 | 死んだ systray へ更新継続 | リソース。無意味な IPC を送信し続ける |
| R2#2 | 再起動二重 202 no-op | 操作性低下。再起動が効かないように見える |
| R3#6–7 | isMd 初期 false の一瞬寄せ・グローバル16px デスクトップ副作用 | UI 不具合。一瞬のレイアウト崩れ・デスクトップ副作用 |
| R35#2 | Caddy 異常 exit 後に自動再起動なし（HTTPS/LAN 入口が死んだまま） | 可用性低下。HTTPS/LAN 入口が手動復帰まで死んだまま |
| R35#3 | DiffPane 自己マージ先（current＝defaultTarget） | UI 不具合。自己マージが可能に見える |
| R35#4 | slash 未取得／失敗時に command が通常 prompt へ落ちる | 操作性低下。slash が効かないように見える |
| R35#5 | host lock CreationDate 失敗時の緩い cmdline 誤認→taskkill | 可用性低下。誤ったプロセスを強制終了 |
| R36#2 | Attention モーダル「フルアクセス」が残キューを自動承認しない | UI 不具合。文言と動作が不一致 |
| R37#1 | `into=current` コンフリクト後に abort なし・DiffPane 未再読込 | 操作性低下。コンフリクト後に操作不能 |
| R38#2 | `POST /global/upgrade` の write ブロック漏れ | セキュリティ（低リスク）。upgrade は破壊的だが実害限定的 |
| R39#2–4 | `sync/steal`・`workspace/warp`・`project/git/init` の write ブロック漏れ | セキュリティ（低リスク）。write ブロック漏れだが実害限定的 |
| R40#2 | `session/{id}/share` POST/DELETE の write ブロック漏れ | セキュリティ（低リスク）。共有リンク作成が可能 |
| R41#1–4 | `PATCH /project/{id}`・`DELETE workspace/{id}`・`session/background`・`/tui/*` のブロック漏れ | セキュリティ（低リスク）。write ブロック漏れの残り |
| R42#1 | `/api/access` が Caddy HTTPS を無視して常に http://NIC:3000 | UI 不具合。Caddy HTTPS 運用時に誤った URL を案内 |
| R44#1 | temporary_copy が外向き symlink を保持し隔離を破れる | セキュリティ。隔離が symlink 先へ抜けられる |
| R45#1 | `invalidateDirStat` 未使用でコミット後も差分統計が最大15s古い | UI 不具合。コミット後も古い統計を表示 |
| R46#2 | temporary_copy の SKIP に `.opencode-webui` 欠落 | リソース。隔離コピーが肥大化 |
| R47#1 | `runGit`/`runGh` にタイムアウトなし（BFF 無期限ハング） | 可用性低下。git/gh がブロックされると BFF がハング |
| R49#2 | `writeCostDisplayPrefs(Partial)` が非マージで auto→manual 等を破壊しうる | データ破壊（限定的）。設定が部分更新で破壊される |
| R49#3 | `files/search` の同期フルツリー走査で BFF イベントループ塞ぎ | 可用性低下。巨大リポで BFF がブロック |
| R50#2 | `DELETE …/permission/saved/{id}` の write ブロック漏れ | セキュリティ（低リスク）。保存済み権限を削除可能 |
| R51#1–2 | 音声 `resultIndex` 無視で文言重複＋録音セッション跨ぎで transcript 残存 | UI 不具合。音声入力が重複・前回文言が残る |
| R53#1–2 | restart-all が reuse WebUI を殺さない＋`stopChildren` が `waitForPortFree` しない | 可用性低下。再起動が不完全・ポート競合 |
| R54#1 | 死んだ `POST /api/browse/folder` が無 timeout で BFF を塞ぎうる | 可用性低下。死んだ API がワーカーを占有 |

---

## 低（後でよい）

| ID | 要約 | 優先度理由 |
|----|------|-----------|
| R15#3 | difftint `&#39;` 誤認 | 文言の軽微な表示ズレ |
| R16#3 | PartView error 折りたたみプレビュー無し | エラー表示の細部欠落 |
| R8#3 | CommandPalette Esc 常時グローバル | 実害ほぼなし（閉時もリスナが動くだけ） |
| R10#2–3 | 音声／セットアップ「仕様のみ」（後者は R31 で実装済み・残は R31/32） | 実装前の仕様文書のみ |
| R8#1（旧） | プラン未配線 — R16 投入で上書き済み | 既に別件に包含 |
| R33 付記 | resolveLnkTargets 常に `[]` | Jumplist が空になるだけ |
| — | access-mode「このセッション」文言 vs グローバル、default-model コメントズレ 等 P3 | 文言の軽微な不一致 |

---

## 凡例

- **ID**: `R{番号}#{サブ番号}`（MEMORY.md のバグ発見ループ内番号）
- **P0**: データ破壊・致命的セキュリティ（高に含む）
- **P1**: 高優先度
- **P2**: 中優先度
- **P3**: 低優先度

## 出典

MEMORY.md の以下のセクションから抽出:
- 各 `## 2026-07-23 バグ発見ループ R{1–54}` エントリ
- `## 2026-07-23 発見バグの3段階優先度（R1–R54 統合）` のトリアージ表
