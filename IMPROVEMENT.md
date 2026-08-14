# IMPROVEMENT — リファクタリング / 改善余地のインベントリ

> 対象リポジトリ: OpenCodeWebUI（`web/` + `host/` + `browser-bridge/` + `scripts/` + `addons/`）
> 作成日: 2026-08-13（git HEAD `82d4add`）
> 目的: 機能別にコードベースを走査し、バグではなく **リファクタリング / 改善余地** を優先度別に記録する。
> 実際の処置は本ファイルを参照して別途まとめて行う（本ファイルはインベントリのみ）。
>
> バグ修正の記録は [BUG.md](./BUG.md)、機能別仕様は `docs/specs/` を参照。本ファイルは
> 重複を避けるため「バグとして記録済みでない、構造上の改善」に絞る。

---

## 調査の要約（主要テーマ）

リポジトリ全体（`web/`・`host/`・`browser-bridge/`・`scripts/`・`addons/`）を
機能別に走査し、リファクタリング / 改善余地を **39 節（高 11 / 中 12 / 低 16）** に整理した
（サマリ表の低には「2-4 の一部」を重複掲載するため 17 行に見える）。
発見の主要テーマは次の 4 つ:

1. **巨大ファイル / コンポーネントの分割** — `TaskView.tsx`（5518 行・hooks 262 個）、
   `SettingsView.tsx`（2312 行）、`useSessionStream.ts`（2311 行）、`goal-loop.ts`（1830 行）、
   `db.ts`（1670 行）、`/api/opencode` プロキシ（1199 行）、`host/index.js`（3071 行）が
   単一ファイルに過剰な責務を抱える。分割のひな形は第 12 章の「良い実例」に集約。
2. **ロジックの二重実装（ドリフトの温床）** — `scripts/*.mjs` と `web/src/lib/profiles/*` の
   同期ロジック（14 関数が実質同一・web が進化版）、`resolveHostControlUrl` の loopback 検証
   非対称、`browser-bridge` のメモリ類似判定（web と別実装）、設定同期の 3 軸不揃い。
   いずれも「1 箇所で直した規則がもう片方に未反映」になり得る（BH-11 が実害例）。
3. **テスト・CI の穴** — web の lint / typecheck / vitest（3500+ テスト）が CI から消えている
   （`ci.yml` は `0fdb685` で削除）。component 20/81・route 61/133 がテスト無し。
4. **良い実装の維持** — workflow 系（44 モジュール）・`opencode-extensions`（18 モジュール）・
   broker（4 モジュール）・コスト計算（6 モジュール）などは分割が適切で、改善より「維持」に
   注力すべき。第 12 章で一覧化。

> 各節の詳細は本文を、対応する BUG.md の既知バグは該当節の参照で確認すること。

---

## 優先度基準

| 優先度 | 基準 |
|--------|------|
| **高** | 保守性を大きく損なう（巨大ファイル・論理重複）。リファクタ効果が広範囲に及ぶ。事故リスクが現実にある |
| **中** | 局所的だが明確な改善余地。対応コストと効果のバランスが良い |
| **低** | 軽微な整理・統一・ドキュメント化。リスクは低い |

---

## 1. web/ フロントエンド（UI 層）

### 1-1. 【高】巨大コンポーネントの分割（God Component）

| ファイル | 行数 | 内容 |
|---------|-----:|------|
| `web/src/components/task/TaskView.tsx` | 5518 | タスク詳細画面の全体像（SSE 反映・送信キュー・添付・分割ビュー・パネル群）。ロジックの大部分が 1 ファイルに集中 |
| `web/src/components/shell/Sidebar.tsx` | 1834 | タスク一覧・お気に入り・アーカイブ・プリフェッチ・ドラッグ |
| `web/src/components/home/HomeView.tsx` | 1681 | ホーム・composer・ループ/Workflow 切替・モデル選定 |
| `web/src/components/settings/ProviderModelsSettings.tsx` | 1674 | プロバイダ/モデル管理・価格エディタ・Auto 連携 |
| `web/src/components/settings/SettingsView.tsx` | 2312 | 設定画面の全タブ統合（ルーティング・状態共有） |
| `web/src/components/settings/ExtensionsSettings.tsx` | 1050 | エージェント/スキル/MCP/プラグインの一覧編集 |
| `web/src/components/settings/ProfilesSettings.tsx` | 1009 | プロファイル切替・同期 |
| `web/src/components/settings/AgentsSettings.tsx` | 943 | エージェント設定 |
| `web/src/components/task/DiffPane.tsx` | 1028 | 差分レビュー・コミット・フィルタ |

**改善方針**:
- `TaskView.tsx` は hooks への抽出が既に一部進んでいるが（`useSessionStream` / `useSessionActions`）、
  さらに「送信キュー」「添付前処理」「パネル状態」「タイムライン描画」を独立フック/コンポーネントへ分割する。
- `SettingsView.tsx` はタブごとの state を共有しすぎ。タブ = 独立ページ（`/settings/:tab`）にするか、
  Context をタブ単位に分離する。
- 分割は動作を変えない「移動のみ」から始め、各 PR を小さく保つ。

> **2026-08-13 実測（HomeView / SettingsView）**:
> - `HomeView.tsx`: useState 41 / hooks 97。モデル/エージェント選択系が 13 個で
>   TaskView の `useTaskModelConfig` クラスタ（9 個）と**同じ構造を別実装**。
>   composer 送信系 6 個も TaskView の `useComposerSend` と同型。→ モデル選択・composer 送信の
>   共通 hooks を `lib/hooks/` に置き、Home と Task の両方から使うのが有効。
> - `SettingsView.tsx`: useState 44 / hooks 81 だが、`activeTab` で全タブを分岐する一方、
>   **タブの分離が半端**。`engine` / `general` / `git` / `project` / `connectivity` の 5 タブは
>   SettingsView 本体に直書き（`activeTab === "engine" && (…` 等）、`agents` / `providers` /
>   `memory` / `vision` 等は独立コンポーネント化済み。→ 直書き 5 タブを
>   `EngineSettingsTab` / `GeneralSettingsTab` / `GitSettingsTab` / `ProjectSettingsTab` /
>   `ConnectivitySettingsTab` として切り出し、SettingsView はタブ一覧と activeTab の
>   配線のみにする。直書きタブ固有の state（`roots` / `stray` / `rateDraft` / `apiGenerationBusy` 等
>   の「その他 29 個」）がそのまま 5 コンポーネントへ分散して小さくなる。

> **2026-08-13 実測（TaskView.tsx）**: hooks が **262 個**（`useState` 77 / `useCallback` 56 /
> `useEffect` 56 / `useRef` 45 / `useMemo` 28）。`<Button>` 直使用 26 箇所、タイトル/状態/権限/
> パネル等の UI ブロックが同一コンポーネント内に散在。分割ビューの state は
> `TaskSplitContext.tsx`（194 行・単独動作確認済み）に分離済みで、TaskView 内は
> `useTaskSplit().splitActive` の条件分岐（約 8 箇所）のみ。→ 分割対象は「ビュー state そのもの」ではなく
> 「状態遷移ロジック」の側であり、`useState` 群を機能単位の hooks（`useTaskPanels` /
> `useComposerSend` / `useSessionBind` 等）へ括り出すのが有効。

> **2026-08-13 useState 74 個の機能クラスタ分類（抽出候補）**:
> | クラスタ | 代表 state | 抽出 hooks 案 |
> |---------|-----------|--------------|
> | パネル/表示 | `tab` / `viewTab` / `showDiff` / `sidePanel` / `sideWidth` / `sideResizing` / `focusFile` / `diffKey`（13 個） | `useTaskPanels` |
> | Composer 送信 | `input` / `sendError` / `queuedFollowUps` / `queuedAutoSend` / `sending` / `sendingScopeKey` / `attachments` / `taskActionBusy`（11 個） | `useComposerSend` |
> | モデル/エージェント | `model` / `agent` / `modelOptions` / `modelCapabilities` / `agents` / `agentModels` / `intelligence` / `serverDefaultModel` / `providerModelsMap`（9 個） | `useTaskModelConfig` |
> | Goal Loop | `goalLoop` / `goalLoopEnabled` / `goalLoopMaxTurns` / `goalLoopBusy` / `goalLoopError`（7 個） | `useGoalLoop` |
> | Auto 機能 | `autoRecord` / `autoOptimize` / `routeOverrides` / `autoShowModel` / `autoReplyFailedIds` / `autoRetryNotice` / `autoFollowUpNotice`（7 個） | `useAutoTask` |
> | 権限 | `accessMode` / `accessModeSaving` / `skillPermission` / `skillPermissionSaving` / `permissionTick`（5 個） | `useSessionPermissions` |
>
> 分類で 52 個（74 中）を占め、これらを機能 hooks 化すれば TaskView 本体の state は
> 22 個前後に減り、描画部分と hooks 呼び出しの対応が明確になる。各 hooks は
> `useSessionStream` の純粋関数パターン（1-2）を踏襲し、外部に公開する state と
> ハンドラを戻り値で型付けする。
>
> **2026-08-13 ExtensionsSettings.tsx（1050 行）の確認**: skills / mcp / plugins の一覧・切替は
> `useExtensionSection<T>`（ジェネリックフック、249 行）に抽象化済みで、SectionShell で共通描画。
> → **良い分割の実例**。残る分割余地は plugins フォーム固有の state
> （`pluginFormOpen` / `pluginFormBusy` / `pluginFormMessage` / `editingPluginId` /
> `deleteConfirmPlugin` / `newPlugin` 等、本体に 48 参照）で、`PluginFormDialog` として切り出せる。

### 1-2. 【高】巨大 hooks の分割

| ファイル | 行数 | 内容 |
|---------|-----:|------|
| `web/src/lib/useSessionStream.ts` | 2311 | SSE 購読・reducer・送信・revert・コンパクション・resync が 1 ファイル |

**改善方針**: SSE イベント処理（`message.part.updated` / `session.status` 等）と送信コマンド
（`sendPrompt` / `sendCommand` / abort / compact）を分離する。reducer の純粋関数部分は
`lib/` 配下へ移動して単体テスト可能にする（現状は hook 内部に混在）。

> **2026-08-13 実態確認（修正）**: 上記の「reducer が hook 内部に混在」は**既に解消済み**。
> 2311 行のうち 1–797 行が純粋関数・型（`StreamState` / `StreamAction` / `sessionStreamReducer` /
> `filterRevertedMessages` / `stripGoalLoopJsonBlock` 等、export 済み）で、
> `useSessionStream.test.ts`（826 行・13 describe / 51 it）が reducer を直接テストしている。
> 残る分割余地は **798 行以降の hook 本体（約 1500 行）** にある:
> SSE ハンドラ登録 / permission・question の行取得とキュー / reconcile スケジューラ /
> 送信コマンド群。ここを `lib/session-sse.ts`（イベント→アクション変換）と
> `lib/session-actions.ts`（送信・abort・compact）に分離し、hook は配線のみにするのが有効。

> **2026-08-13 調査（分割計画の確定）**:
> hook 本体（798–2301 行）の内部構造を調査した結果、**状態（reducer + 20 個超の ref）と
> ロジックが密結合**で、関数の「移動のみ」による切り出しは不可能と判明:
> - SSE 購読（`connect` 1776 行 / `handleEvent` 1259 行・約 500 行 / `runReconcile` 1859 行）は
>   dispatch + 多数の ref（`pendingMutationRef` / `idleStreakRef` / `sessionActivityAtRef` 等）に依存
> - 送信コマンド（`sendPrompt` 1925 / `sendCommand` 2012 / `abort` 2118 / `replyPermission` 2168 等）も
>   同一の ref 群と `resync` / `abortRef` に依存
> → 分割には **`useSessionSse` / `useSessionActions` の 2 フック化**（共通の ref コンテキストを
> 親フックが生成し子フックへ渡す）が必要で、作業量は大きい。実施は 1-1（TaskView 分割）より後。
> テスト 65 件が保護網として存在するため、着手時は「移動のみ」の段階から進められる。
> 2026-08-13 実施済み: hook 内の `normalizeList` 重複（×2）を `unwrapOcData` に統一
> （コミット `8a2daf1`）。

### 1-3. 【中】OAuth / CLI プロキシ認証コンポーネントの重複

| ファイル | 行数 | 内容 |
|---------|-----:|------|
| `ClaudeSubscriptionAuth.tsx` | 199 | Anthropic OAuth フロー |
| `OpenAISubscriptionAuth.tsx` | 284 | OpenAI OAuth フロー |
| `CursorCliProxyAuth.tsx` | 58 | Cursor CLI プロキシ認証 |
| `CommandCodeCliProxyAuth.tsx` | 69 | Command Code CLI プロキシ認証 |

Claude / OpenAI の 2 つは「OAuth popup → ポーリング → 接続状態表示」の流れがほぼ同一で、
設定値（endpoint・providerID・ラベル）が違うだけ。共通の `OAuthSubscriptionCard` 化が可能。

### 1-3b. 【中】GhostSelect ラッパー系の小型選択コンポーネントの同型重複

`AccessModeSelect.tsx`（45 行）・`SkillPermissionSelect.tsx`（46 行）・
`SubagentPermissionSelect.tsx`（48 行）は**構造が完全に同型**（2026-08-13 確認）。

- 差異は `*_OPTIONS` 定数・`aria-label`・icon・`tone` 判定（`value === "deny"` / `value === "full"`）のみ
- 全 3 つが `GhostSelect`（`ui.tsx`）を包むラッパーで、`valueLabel` / `title` / `onChange` の
  つなぎ込みも同一パターン

**改善方針**: 「OPTIONS と icon/tone のマッピング」を data 駆動の設定オブジェクトにし、
共通 `GhostPermissionSelect`（または `GhostSelect` への props 展開ヘルパー）1 つに集約する。
あわせて軽量テスト 1 本で 3 つを検証できる（8-3 の対象縮小）。

### 1-4. 【低】UI 部品の `ui.tsx` への集約状況の確認

`web/src/components/ui.tsx`（16KB）にボタン/ダイアログ等が集約されているが、
`useId()` 化（BU-9 対応）やテーマ連動が部品ごとにバラついている。部品の props 規約
（`variant` / `size` / `aria`）をドキュメント化し、新規部品は必ず `ui.tsx` を経由する
ルールを明文化する。

### 1-5. 【低】PTY / 音声入力 / UI 細部のテスト状況（棚卸し結果）

残りの UI 機能を確認した結果（2026-08-13）:

| 機能 | 実装 | 行数 | テスト |
|------|------|-----:|:---:|
| PTY セッション | `lib/pty-session.ts` + `lib/pty-relay.ts` | 398 + 226 | ✅ |
| 音声入力 | `lib/use-voice-input.ts`（`useVoiceInput` 1 フックに SpeechRecognition 状態集約） | 411 | ✅ |
| Markdown 描画 | `components/task/Markdown.tsx` | 14 | – |
| トークンハイライト | `components/task/MessageTokenHighlight.tsx` | 95 | – |
| 完了サウンド | `lib/session-complete-sound.ts` | 50 | – |

- `use-voice-input.ts` は 411 行だが `useVoiceInput` 1 フックに状態が集中する通常の
  hooks 構造で、分割対象ではない。
- テスト無しの 3 つ（Markdown 14 行 / MessageTokenHighlight 95 行 / session-complete-sound
  50 行）は軽量。`MessageTokenHighlight` はスキル/エージェント/スラッシュのハイライト
  正規表現（BU-6 修正済み）を持つため、回帰防止の観点で軽量テスト追加が有効。

---

## 2. web/ BFF（API Route Handlers）

### 2-1. 【高】`/api/opencode/[...path]` プロキシのモノリス化

`web/src/app/api/opencode/[...path]/route.ts`（**1199 行**）に以下が混在:

- 汎用プロキシ（`proxy()`）
- v1/v2 の世代判定・レスポンス unwrap（`maybeUnwrapV2Data`）
- 書込ブロック（`isBlockedOpencodeWrite` は `opencode.ts` に分離済み）
- 画像ガード・容量見積（`collectImageAttachments` 等）
- プロバイダ/エージェント/画像対応キャッシュ（`cachedProvidersByDir` 等）
- SSE の session id 抽出（`manualSendSessionId` / `hangWatchSessionId` 等）

**改善方針**:
- 中間処理を `web/src/lib/opencode-proxy/*` 配下の小さなモジュールへ分割
  （guard / unwrap / cache / image の各 concern を 1 ファイル 1 責務に）。
- `route.ts` は「リクエスト受付 → パイプライン適用 → upstream 転送」の薄い配線のみにする。
- プロキシ内の単純キャッシュ（`cachedProvidersByDir` / `cachedAgentsByDir`）は
  BH-8（BUG.md）で指摘済みの無制限成長問題を持つため、分割時に LRU/TTL 化を併せて行う。
- 分割粒度の参考: `web/src/lib/opencode-extensions/` は 18 モジュール（最大
  `provider-models.ts` 905 行）に整理されており、同種の「機能ごとの薄いハンドラ群」
  構成をひな形にできる。

### 2-2. 【中】設定レジストリの一元化

`web/src/app/api/settings/[key]/route.ts`（**324 行**）は `ALLOWED_KEYS` を Set で持ち、
キーごとのバリデーションを 1 関数に増殖させている。キー定義（型・制約・デフォルト）が
`lib/` 側の各 `*_KEY` 定数と分散している。

**改善方針**: 設定スキーマ（key / 型 / clamp / boolean 化）を `lib/settings-registry.ts` に
1 箇所で宣言し、route はそれを参照するだけにする。新キー追加が route 編集なしで済む。

> **2026-08-13 クライアント側の保存パターン（関連）**:
> `SettingsView.tsx` に **5 種類の busy state**（`browserConfigBusy` / `busy` /
> `apiGenerationBusy` / `workflowModeBusy` / `authBusy`）が存在し、すべて
> 「true → fetch → finally で false + エラー通知」の**同一 try/finally パターン**を
> 個別に実装している（VisionSettings の `ollamaBusy`、ProfileSync 系の `openBusy` も同型）。
> → 設定保存の状態遷移（idle / saving / saved / error）を共通フック
> `useSettingAction` に集約し、各タブは「実行関数 + 成功/失敗メッセージ」だけを渡す形に統一する。
> あわせて 1-1 の「直書き 5 タブ切り出し」時にこのパターンを組み込む。

> **2026-08-13 「localStorage 高速経路 + サーバミラー」同期パターンの重複**:
> `default-model.ts` に典型的な実装（localStorage 即時反映 + `xxxWriteQueue` で PUT を
> 直列化 + サーバ `settings` 表へミラー）があり、同じ write queue 直列化が
> `generation-model.ts` / `sidebar-settings.ts` の **3 箇所で同一実装**。
> さらに localStorage 同期自体は `access-mode` / `skill-permission` / `subagent-permission` /
> `auto-settings` / `currency` / `hang-timeout` / `token-saving-settings` /
> `opencode-generation` / `side-panel-state` / `addons/state` 等 **15 ファイル超**に分散。
> → パターン（`STORAGE_KEY` + `read*` + `write*` + write queue + サーバミラー）を
> `lib/setting-sync.ts` のヘルパー（`createSettingSync<T>(key, {serverPath, eventName})`）に
> 集約し、各設定は宣言的に定義する。ドリフト（片方だけ localStorage、もう片方はサーバのみ等）の
> 防止にもなる。`default-model.ts` を参考実装として再利用する。

> **2026-08-13 既存 9 ファイルの API 差（共通化対象の具体）**:
> 設定同期の実装が「サーバミラー有無」「write queue 有無」「同期/非同期 API」の **3 軸で不揃い**。
> | 実装 | サーバミラー | write queue | API 形式 |
> |------|:---:|:---:|------|
> | `default-model.ts` | ✅ | ✅ | 同期 read + async サーバ |
> | `generation-model.ts` | ✅ | ✅ | 同期 read + async サーバ |
> | `sidebar-settings.ts` | ✅ | ✅ | （JSON 束ね・別形式） |
> | `auto-settings.ts` | ✅ | ✅ | 同期 read + async サーバ |
> | `hang-timeout.ts` | ✅ | – | 同期 read + async サーバ |
> | `token-saving-settings.ts` | ✅ | – | 同期 read + async サーバ |
> | `access-mode.ts` | – | – | localStorage のみ |
> | `skill-permission.ts` | – | – | localStorage のみ |
> | `subagent-permission.ts` | – | – | localStorage のみ |
> | `side-panel-state.ts` | – | – | localStorage のみ |
>
> 「サーバミラーあり/なし」「queue あり/なし」が混在するため、利用者（SettingsView 各タブ /
> コンポーザー）が「どの層まで永続化されるか」をコードから読み取れない。→ 共通化時に
> 各設定の**永続化ポリシー**（local のみ / local + server / server 優先）を明示し、
> API を `read*`（同期）+ `write*(value, {syncToServer})` に統一する。

> **2026-08-13 対応済み（サーバ側レジストリ + 同型パターンの共通化）**:
> - `web/src/lib/settings-registry.ts` を新設: 許容キー / boolean 化 / キー別バリデーションを
>   1 箇所に集約。`/api/settings/[key]/route.ts` は 324 → 120 行（コミット `b810625`）。
> - `web/src/lib/setting-sync.ts` の `createSettingSync({storageKey, serverPath, eventName})`
>   を新設し、**同型パターンの 2 ファイル**を宣言的に書き換え:
>   `default-model.ts` 201 → 88 行（`1aa4990`）、`generation-model.ts` 114 → 66 行（`4f968cd`）。
>   永続化ポリシー（localStorage が同期正本・サーバは永続バックアップ）はヘルパーの
>   コメントに明記。
> - **対象外とした実装（意図的な違いとして記録）**: `auto-settings.ts` は 3 キーを
>   `Promise.all` で一括読む複数キー設計、`sidebar-settings.ts` は JSON 束ね（1 行に
>   複数フィールド）で、単一キー同期ヘルパーと混ぜると可読性が下がるため移行しない。
>   localStorage のみ（`access-mode` 等）はそもそも対象外。
> - 残: `useSettingAction`（busy state 共通化）は 1-1 の SettingsView タブ切り出し時に
>   組み込む（後述 5-c）。

### 2-3. 【中】Route Handler の認可パターン重複

133 の route のうち 127 が `requireAuthorized` / `isLocalHostRequest` 系ガードを
呼んでいるが、ガードの使い分け（loopback のみ / セッション可）が route ごとに
手書きで揺れている（例: BH-13 の `browse/dirs`）。ガードの適用規則を
`api-guard.ts` に「ポリシー」として集約し、route 側はポリシー名を指定する形に揃える。

> **2026-08-13 調査（対応判断: 現状のまま・改善不要）**:
> `api-guard.ts`（148 行）は既に「単一の認可ゲート」として整理されている:
> - `requireAuthorized`（CSRF + loopback/セッション認可）、`PUBLIC_API_ROUTES`（明示的公開）、
>   `api-guard-coverage.test.ts`（ガード漏れをビルドで検出）
> - 使用実態: 125 ファイル・304 箇所。呼び出しパターンはほぼ全て
>   `const denied = await requireAuthorized(req); if (denied) return denied;` で統一済み
>   （「揺れ」は確認されず、BH-13 の該当箇所は既にガード済み）
> - `requireHostMachine` は意図的に未使用で保持（コメント明記）
> → 2-3 はクローズ（さらなる「ポリシー名指定」化は過剰設計のリスク）。
> 設定同期（2-2）の調査・対応は別途。

### 2-4. 【低】route のテストカバレッジ

`web/src/app/api` 配下 **133 route 中 72 のみ**テストあり（54%）。特に以下はテストが無い:

- `git/branches` / `git/log` / `git/merge` / `git/pr` / `git/show` / `git/repositories`
- `memory/[id]` / `memory/consolidate` / `memory/extract` / `memory/extractions` / `memory/purge`
- `opencode/[...path]` の画像ガード経路
- `updates/opencode` / `updates/webui` の更新系

Git 操作系はパス保護・引数配列実行の検証が重要で、優先的にテストを追加する。

> **2026-08-13 メモリ系ルートの確認（2-4 補足）**: `app/api/memory` 配下 7 ルートは
> すべて薄い配線（29–112 行）で、実ロジックは `lib/memory.ts`（1099 行）に集約されており
> **良いレイヤリング**。ただし 7 ルート中 6 がテスト無し（`route.ts` のみ `route.test.ts` 有り）。
> 特に `[id]/route.ts`（112 行）は PATCH/DELETE のバリデーション（expectedRevision / kind /
> 409 コンフリクト）が集中しており、revision 付き楽観ロックの衝突テストが無い。
> → `[id]` / `purge`（confirm 必須の一括削除）を優先にテストを追加する。

### 2-5. 【低】profiles 系 open ルートのハンドラ骨格重複

`web/src/app/api/profiles/open-target/route.ts`（77 行）と
`web/src/app/api/profiles/[id]/open/route.ts`（97 行）は、「action 検証
（`open-file`/`open-folder`）→ 対象解決 → `openFileReveal`/`openFolder`（lib）→ エラー
応答」の骨格が共通（2026-08-13 実読）。違いは対象の解決方法のみ（前者は
`TARGET_RESOLVERS` の allowlist、後者はアクティブプロファイル + 設定ファイル探索）。

- lib 側 `profiles/open.ts`（openFolder / openFileReveal）はプラットフォーム分岐を
  集約した**良い抽象**で、ここはそのまま。
- ルート側の検証・エラー骨格が 2 箇所に重複。→ 共通ハンドラ
  `lib/profiles/open-route.ts`（`handleOpenAction(req, resolveTarget)`）へ括り出し、
  各ルートは「対象解決関数」だけを渡す形にする。
- profiles 系 API ルートは全 11 ファイルとも薄い（28–97 行）で、ロジックが lib に
  集約されているのは良いレイヤリング。この 2 ルートのみ骨格がやや大きい。

---

## 3. web/ lib（サーバー側ドメインロジック）

### 3-1. 【高】`goal-loop.ts` の分割

`web/src/lib/goal-loop.ts`（**1830 行**、DB 直書き・`ocServer` 呼び出し・スケジューラ・
検証ロジックが混在）。テストは `goal-loop.test.ts` + `goal-loop.integration.test.ts` と
肥大化しており、保守の主戦場。

**改善方針**: 「DB アクセス」「OpenCode API 呼び出し」「状態遷移の純粋関数」
「スケジューラ」を分離し、状態遷移を純粋関数化してテストを小さくする。
分割粒度の参考: 同機能の workflow 系は 44 モジュールに細分化済み（最大
`workflow-service.ts` 877 行 / `workflow-scheduler.ts` 705 行）で、goal-loop の
1 ファイル 1830 行との対比が顕著。workflow 系の「モジュールごとの責務」構成を
ひな形にできる。

> **2026-08-13 関数レベルの責務分布（3-1 分割案の具体化）**:
> goal-loop.ts の 30+ 関数は行位置で **4 ブロックに分かれており、分割しやすい**:
> 1. **プロンプト構築**（906–1110 行）: `buildGoalPrompt` / `buildGoalContinuationPrompt` /
>    `buildVerificationPrompt` / `buildGoalPromptWithMemory` → `goal-prompt.ts` へ
> 2. **状態遷移・検証の純粋関数**（1112–1454 行）: `normalizeStructured` / `extractGoalResult` /
>    `applyAssistantResult` / `expireStalledTurn` / `pauseAfterUnknownPromptDelivery` /
>    `pauseForLostBoundary` / `recoverAfterRejectedPrompt` → `goal-state.ts` へ（DB 依存は
>    `getGoalLoop` 等の注入で純化）
> 3. **DB アクセス**（524–905 行）: `getGoalLoop` / `createGoalLoop` / `updateGoalLoopStatus` /
>    `updateGoalLoopMaxTurns` / `pauseGoalLoopForManualSend` → `goal-db.ts` へ
> 4. **実行 + スケジューラ**（1491–1830 行）: `processLoop` / `runGoalLoopSchedulerTick` /
>    `startGoalLoopScheduler` → `goal-scheduler.ts` へ
>
> 89–511 行のヘルパー（`toPauseReason` / `isTransientOpenCodeError` / `retryTransientOpenCode` /
> `boundaryStartIndex` 等）は各ブロックから共有されるため、`goal-util.ts` に置く。
> この 4+1 分割で 1 ファイル 1830 行 → 各 300–450 行になり、テストも
> `goal-state.test.ts`（純関数中心）/ `goal-db.test.ts`（DB モック）へ分離できる。

> **2026-08-13 workflow-scheduler との共通パターン（3-1 関連）**:
> `workflow-scheduler.ts`（705 行）も同じ scheduler 構造（`runWorkflowSchedulerTick` /
> `startWorkflowScheduler` / `stopWorkflowSchedulerForTests`）を持ち、再試行・pause・
> 結果抽出のパターンが goal-loop と類似している（`messagesAfterBoundary` ↔
> `boundaryStartIndex`、`pauseWorkflowForAttempt` ↔ `pauseGoalLoopForManualSend` 等）。
> `instrumentation.ts` は **4 つのスケジューラ**（goal-loop / workflow / hang-watchdog /
> memory-auto-extract）を起動しており、起動・tick 直列化・停止の仕組みが各モジュールで
> 重複気味。
> → 3-1 の分割時に、共通の「scheduler 基盤」（`lib/scheduler.ts`: tick ロック / setInterval
> 管理 / テスト用 start-stop）を抽出することを検討。goal-loop と workflow の再試行・
> pause パターンは「完全共通化」まではせず、まず `goal-scheduler.ts` と
> `workflow-scheduler.ts` が同じ構造を踏襲する形に揃えるのが現実的（機能差異が大きいため）。

### 3-2. 【高】`db.ts` のマイグレーション管理

`web/src/lib/db.ts`（**1670 行**、CREATE TABLE 23 種）は `PRAGMA user_version` による
バージョン管理を**使わず**、`PRAGMA table_info()` + `ALTER TABLE ADD COLUMN` を
関数内に散在させている（17 箇所の ALTER TABLE）。新カラム追加ごとに既存 DB との
整合を手動で担保する形で、マイグレーションの履歴が追えない。

**改善方針**:
- `user_version` ベースの順序付きマイグレーションリスト（`migrations: Array<{version, sql}>`）
  へ移行し、既存の `table_info` チェックは移行に内包する。
- スキーマ定義を「最新形」1 箇所にし、`db.test.ts` で新規 DB と移行後 DB が同一スキーマに
  なることを検証する。

### 3-3. 【高】サーバー側 OpenCode 呼び出しの v2 形状吸収を一元化

BUG.md BH-9 で記録済みだが、構造的には「`ocServer()` 直呼びは `{data:[...]}` を
unwrap しない」点が複数機能（goal-loop / workflow-scheduler / collaboration-context /
memory-extract / task-service）で個別対応を強いている。

**改善方針**: `oc-server.ts` の共通取得ヘルパーに `normalizeMessageList` 相当の
unwrap を組み込み、各 consumer の個別対応を削除する。あわせてサーバー側テストに
v2 形状のフィクスチャを追加する（現状 v1 前提のモックのみ）。

> **2026-08-13 現状の対応状況（3-3 具体化）**:
> unwrap ヘルパーが **2 箇所に別実装**:
> - `hang-watchdog.ts` `normalizeMessageList`（335 行、非配列時 `null`）
> - `attention.ts` `normalizeOcList<T>`（非配列時 `[]`）
>
> 両者は同一ロジックだが戻り値の解釈が違う。**対応済み consumer**: goal-loop /
> workflow-scheduler / collaboration-context / memory-extract / task-service / attention
> （`normalizeOcList` を import して使用）。**未対応**: `qwen-native-vision.ts`
> （ocServer を使用するが normalize 参照なし — BH-9 で指摘した画像事前解析の POST 依存
> と併せて要修正）。`oc-server.ts` 自体は `data as T` で**ラップ解除なし**。
> → 修正ポイント: `oc-server.ts`（または共通ヘルパー `unwrapOcData<T>`）に unwrap を
> 1 箇所組み込み、各 consumer の `normalizeOcList` / `normalizeMessageList` 呼び出しを
> 置き換える。`qwen-native-vision` は normalize 追加 + v1 POST 依存（`activeSessionMessagePath`
> への POST）の両方を解消する。unwrap の戻り値規約（null vs []）も 1 つに統一する。

### 3-4. 【中】手書き型と生成型の二重管理

`web/src/lib/types.ts`（255 行・export 26）と生成型 `opencode-schema.d.ts`
（`npm run gen:types`）が並存。`opencode-api.ts` は生成型のエイリアスを提供しているが、
手書き型の置換は「段階的」のまま留まる（improvement-plan §9.3 の未達項目）。

**改善方針**: クライアントが消費する主要型（`Message` / `Part` / `SessionStatus` 等）を
`OcSchema` ベースに置き換え、`types.ts` を OpenCode 固有の加工型（UI 用 DTO）だけに縮小する。
`gen:types` を CI で回し鮮度を保つ（`opencode-schema-freshness.test.ts` は存在する）。

### 3-5. 【低】`any` / 型逸脱の集約

`as any` / 型逸脱は `auto-model.ts` / `goal-loop.ts` / `hang-watchdog.ts` の 3 ファイルに
限定されている。分割（3-1 等）の際に `any` を型付きへ置き換える。

### 3-6. 【低】トークン / コスト計算系の層分け（良い実例として記録）

トークン使用量・コスト表示は 6 モジュールに分割され、**ほぼ全てテスト済み**（2026-08-13 確認）:

| モジュール | 行数 | 責務 | テスト |
|-----------|-----:|------|:---:|
| `token-usage.ts` | 122 | セッションのトークン使用量集計 | ✅ |
| `context-usage.ts` | 53 | コンテキスト使用率 | ✅ |
| `model-pricing-registry.ts` | 38 | モデル価格レジストリ | – |
| `openai-pricing.ts` | 117 | OpenAI 価格表 | ✅ |
| `currency.ts` | 185 | 通貨表示・FX | ✅ |
| `model-ranking.ts` | 89 | モデルランキング | ✅ |

- 唯一テスト無しの `model-pricing-registry.ts`（38 行）は登録テーブルのみで、軽量テスト追加の対象。
- この層分け（集計 / 価格 / 表示を分離）は**良い分割の実例**として、goal-loop（3-1）や
  プロキシ（2-1）の分割ひな形にできる。

### 3-7. 【低】`task-service.ts` の複合性（コスト推定 + タスク一覧）

`web/src/lib/task-service.ts`（471 行）は 2 責務が混在:

1. **コスト推定**（61–177 行）: `estimateSessionCost` / `exactMessageCost` / `estimateSessionCostWithCache`
2. **タスク一覧・状態取得**（179–471 行）: `listTasks` / `listArchivedTasks` / `getTask` / `getTaskCost` / `sessionStatusFor`

`workflow-service.ts`（877 行）と `workflow.ts`（396 行）は「CRUD + 検証の純関数」に
分離されており、goal-loop ほどのモノリスではない（テストも workflow-service 322 行 /
workflow 158 行）。→ `task-service.ts` は「コスト推定」を `task-cost.ts` へ切り出す程度の
**小分割**で十分。優先度は低（テスト 476 行と充実しており、リファクタのリスクより
現状の可読性の問題の方が軽微）。

---

## 4. host/（トレイ常駐プロセス）

### 4-1. 【高】`index.js` のモノリス化

`host/src/index.js`（**3071 行**・トップレベル関数 97）に「起動シーケンス・プロセス監視・
再起動・状態管理・ログ・Caddy 連動・自己更新」が混在。

> **2026-08-13 関心ごと一覧（関数マーカー 137 件を分類）**:
> 1. 設定/ポート解決（`setOpencodePort` / `setWebuiPort` / `resolvePortPlan`）
> 2. ロック/二重起動（`readLock` / `writeLock` / `acquireLock` / `handleExistingInstance`）
> 3. ポート監視（`runNetstat` / `getListeningPids` / `isPortInUse` / `findFreePort`）
> 4. OpenCode 起動/監視/再起動（`spawnOpencode` / `restartOpencode` / `upgradeOpencodeCli`）
> 5. Web ビルド/起動/自己回復（`buildWebProduction` / `spawnWeb` / `checkWebHealth` / `startWebWatchdog`）
> 6. Caddy 連動（`spawnCaddy` / `stopStrayCaddy` / `syncCaddyfileAddresses`）
> 7. Browser Bridge Broker（`startBrowserBridgeBroker`）
> 8. トレイ/メニュー（`buildTrayMenu` / `startTray` / `refreshStatusMenu`）
> 9. Windows 統合（PowerShell / ファイアウォール / 音声入力）
> 10. 終了処理（`quit` / `stopChildren` / `onHostExit`）
>
> 1・3・4・5・8 の 5 グループだけで大半を占め、`index.js` が「プロセス管理 + 状態管理 +
> Windows 統合 + メニュー構築」をすべて担っている。

**改善方針**:
- `control-server.js`（929 行）との役割分担を明文化し、`index.js` は起動/終了の配線に絞る。
- 上記のグループごとにモジュール化: `port-manager.js`（1・3）、`opencode-manager.js`（4）、
  `web-manager.js`（5）、`caddy-manager.js`（6）、`tray-menu.js`（8）。
- プロセス監視（`process-stop.js` は分離済み）を拡張し、「子プロセス状態管理」を
  `child-manager.js` として切り出す。
- 各機能はテスト付き（host は `node --test`、395 テスト）なので、分割後も既存テストが
  そのまま通ることを確認しながら進める。

> **2026-08-13 再起動 / 停止シーケンスの実測（4-1 追記）**:
> - `restartOpencode()` / `restartServices()` / `stopChildren()` に再起動が分散し、
>   `restartingServices`（boolean）1 つで「進行中か」を直列化している。
> - シーケンスは「stop → sleep(500) → `resolveOccupiedPort`（ghost/unhealthy の退避）→
>   spawn → `waitUntilReady`（ポート可変時は WebUI も追随再起動）」の定型で、
>   `restartOpencode` と `restartWeb` で同一手順を別実装。port 変更時の
>   「OpenCode を直してから WebUI を張り替える」順序依存も暗黙。
> - kill 対象の決定（`restart-targets.js`: `resolveKillPids` / `resolveWebKillPids`）と
>   kill 実行（`process-stop.js`: `stopProcessTreeGracefully` / `stopWebTreeSync`）は
>   分離済みで、ここは良い層分け。
> → `child-manager.js` に「各子プロセスの状態（stopped / starting / ready / stopping）+
>   再起動リクエストの直列化キュー + port 変更時の依存再起動（WebUI は OpenCode 後）」
>   を集約し、`restartOpencode` / `restartWeb` / `restartServices` の 3 実装を
>   1 つの `restartServices([targets])` に統合する。`restartingServices` の boolean 直列化は
>   この状態機械へ置き換える。

### 4-2. 【中】`control-server.js` のルーティング整理

`host/src/control-server.js`（929 行）に HTTP 制御 API が直書きされている。
ルート定義（method / path / handler）を宣言テーブル化し、ハンドラを独立モジュールへ
分割する。ブラウザ側 `host-control.ts`（web）との API 契約も `docs/specs/` に固定する。

> **2026-08-13 実測（control-server.js / 4-2 具体化）**:
> - `matchControlRoute()`（32 行目）が **15 ルートを if 連鎖で判定**（`/health` `/logs` `/users` /
>   `/auth/config` `/browser/config` `/auth/login|logout|verify` `/restart/webui|opencode|all` /
>   `/stop/webui` `/voice-input` `/allow-firewall`）。restart 系は 856–858 行で `route === 'webui'`
>   三項式に結合され、`/restart/*` は 48–50 行で同値に解決される（判定が 2 段階）。
> - ハンドラは `route === 'xxx'` の if 分岐（400–858 行）で、`users` / `auth` / `browser-config` /
>   `auth-config` は 1 ルートに複数メソッド（GET/POST/DELETE 等）が混在。
> - 認証は `resolveSession()`（365 行）が cookie（HMAC session token）を検証し、
>   `/health` のみ無認証。トークン署名は `signSessionToken` / `verifySessionToken`（149–162 行）。
> → 宣言テーブル案: `{ method, path, name, auth: 'none'|'session', handler }` を 1 箇所に置き、
>   `matchControlRoute` の if 連鎖と `route ===` 分岐を置き換える。`/restart/*` の 2 段階解決も
>   `name: 'restart'` + `target: 'webui'|'opencode'|'all'` に整理。ハンドラは
>   `usersHandler` / `authHandler` / `logsHandler` 等の独立モジュールへ切り出す。
> - `host-control.ts`（web 側）との対応は `hostRestartPath()` / `hostLogsPath()` / `hostVoiceInputPath()` /
>   `hostAllowFirewallPath()`（host-control.ts のパス定数）と本テーブルの path が一致しているか、
>   片方向の契約テスト（web のパス定数 = host のルート定義）で保証する。

### 4-3. 【低】`service-status.js` の規模

`host/src/service-status.js` が **11 行**と極端に小さく、サービス状態の抽象が
`index.js` 側に実質残っている。`service-status` を状態遷移の正本として育て、
UI（トレイメニュー / `api/host`）が参照する一本化を目指す。

---

## 5. browser-bridge/

### 5-1. 【中】MCP サーバーと web のメモリ実装の重複

- `browser-bridge/mcp/memory-server.mjs`（406 行）: MCP 経由のメモリ読み書き。
  `webui.db` を web 側と共有し、`resolveDataDir` / `resolveMemoryScope` を
  `web/src/lib/paths.ts` / `web/src/lib/memory.ts` から**ミラー実装**している。
- `web/src/lib/memory.ts`（1099 行）: BFF 内メモリ層
- 共通スキーマ `browser-bridge/shared/memory-schema.mjs`（289 行）は分離済みだが、
  web 側（TS）はこれを**参照しておらず**、`web/src/lib/memory-key.ts` に
  同機能の類似判定（`memoryPolarity` / `normalizeMemoryKey` / `memoryIdentifiers` /
  `jaccard` / `memorySimilarityVerdict`）を**別実装で保持**している。

> **2026-08-13 検証**: `memorySimilarityVerdict` 等 5 関数を TS 版（memory-key.ts）と
> MJS 版（shared/memory-schema.mjs）で比較。ロジックは**実質同一**（型注釈の有無のみ）。
> `toFtsPhrase` は web 側は `memory.ts` 内、MJS 側は shared にあり、配置も分散している。
> 同一の重複排除・類似判定が二系統で維持されており、片方だけの修正がもう片方へ
> 反映されない構造（ドリフトの温床）。

> **2026-08-13 lib/memory.ts 内部（5-1 補足）**: `web/src/lib/memory.ts`（1099 行）は
> **web 内部では正しく一元化済み** — `memorySimilarityVerdict` / `normalizeMemoryKey` を
> `memory-key.ts` から import し、検証は `memory-safety.ts`（`inspectMemoryContent`）を参照。
> つまり重複は「web ↔ browser-bridge」の 2 系統であり、web 側の 3 分割
> （memory.ts / memory-key.ts / memory-safety.ts）自体は**良い層分け**。
> lib/memory.ts は 40+ の export を持つが、責務（DB 操作・検証・類似判定・インジェクション）が
> 関数単位で分かれており、goal-loop のような同一機能のモノリスではない。→ 優先分割対象
> ではなく、browser-bridge 側（shared/memory-schema.mjs）を web 正本へ同期する方針が主。

**改善方針**: スキーマと「抽出/検証/類似判定」の純粋関数を共有モジュールとして抽出し、
web 側（TS）から参照できる形にする（TS が `.mjs` を import できるようビルド/設定を
整備するか、`.ts` を正本にして `browser-bridge` 側へ同期する）。MCP サーバー側は
薄い配線に近づける。

> **2026-08-13 共有方式の調査（実現性）**:
> - 現状 web 側から `browser-bridge/shared/` への参照経路は**無い**（tsconfig `paths` に
>   マッピングなし・`shared/package.json` も無し・`externalDir` は addons 専用）。
>   TS が `.mjs` を型解決するには `.d.mts` 宣言の同梱が必要。
> - 非 win32 の dataDir 解決が web（`paths.ts`: `~/.opencode-webui`）と
>   MCP（`resolveDataDir`: `~/.local/share/opencode-webui`）で**不一致**。実運用では
>   `LEAFCODE_DATA_DIR` 注入で回避されるが、未注入フォールバックがずれている。
> - 選択肢 A: `shared/*.mjs` を正本とし web 側から import（tsconfig paths + vitest alias +
>   Turbopack resolveAlias の 3 箇所に設定追加 + `.d.mts` 同梱。browser-bridge は
>   `npm ci` 単体で動くため web の node_modules に依存できない制約は守れる）。
> - 選択肢 B: web の `memory-key.ts` / `memory.ts` を正本とし、`browser-bridge/shared` を
>   `scripts/` の同期スクリプト（既存 `sync-addon-assets.mjs` と同パターン）で生成する。
>   MCP 側の配布独立性は保たれる。**推奨: 関数ロジックを web（TS）正本にし、B 方式で
>   同期**（BH-11 の「web/CLI 非対称」と同じ轍を踏まないため、同期テストで一致検証を入れる）。
> - 決定時は `memorySimilarityVerdict` 等の一致検証テスト（TS 版 vs MJS 版の出力比較）を
>   追加し、ドリフトを CI で検出する。

### 5-2. 【低】ブラウザ拡張のテスト対象の明確化

`browser-bridge/extension/*`（content-runtime.js 等）はテストが `test/` にあるものの
実ブラウザ結合テストが無い。Playwright 拡張テスト（`web/e2e/` 枠）で、
content script のインジェクションと snapshot 送信を 1 シナリオ検証できると良い。

> **2026-08-13 確認（Phase 7）**: content script ロジックはユニット/統合テストでカバー済み
> （`browser-bridge/test/` 全 91 本パス。`snapshot.test.mjs` 5 本が collectSnapshot の収集・
> 秘匿制御・truncation、`extension-background.test.mjs` 11 本が注入後の runtime ハンドラを検証）。
> 実ブラウザ結合テスト（拡張ロード + 注入 + Broker 送信）は、拡張のペアリング（Broker URL/トークン）
> と host 稼働が必要で自動テストとして不安定なため**追加保留**。テスト対象の明確化は
> 上記 2 ファイルで達成済み。

### 5-3. 【低】Broker 系の層分け（良い実例として記録）

`browser-bridge/broker/` は 4 モジュールに分割され、構造は健全（2026-08-13 確認）:

| モジュール | 行数 | 責務 | テスト |
|-----------|-----:|------|:---:|
| `server.mjs` | 617 | Broker の WebSocket / MCP 受付（`createBrowserBridgeBroker`） | ✅ `broker-server.test.mjs` 654 行 |
| `state.mjs` | 156 | `BrowserBridgeState` クラス + `TRANSITIONS`（コマンド状態遷移） | ✅ `broker-state.test.mjs` 72 行 |
| `policy.mjs` | 63 | アクセス許可判定 | ✅ `policy.test.mjs` |
| `audit.mjs` | 51 | 監査ログ | ✅ `audit.test.mjs` |

- 状態遷移（QUEUED → AWAITING_APPROVAL → DISPATCHED 等）は `state.mjs` の 1 クラスに
  カプセル化され、`server.mjs` は配線に集中。`shared/` のプロトコル定数を参照。
- 全 4 モジュールがテスト済みで、**良い分割の実例**（5-1 の MCP 側をこの粒度へ揃える
  方向性の参考になる）。改善余地は現状見当たらない。

---

## 6. scripts/（セットアップ・CLI ツール）

### 6-1. 【高】web エンジンと CLI の同期ロジック重複

| CLI | 行数 | web 側の同等実装 | 行数 |
|-----|-----:|----------------|-----:|
| `scripts/sync-profiles.mjs` | 436 | `web/src/lib/profiles/sync-engine.ts` | 526 |
| `scripts/agents-sync.mjs` | 292 | `web/src/lib/profiles/agents-sync-engine.ts` | 463 |

`planSync` / `applySync` / `readJsonc` / `symlinkDir` 等の実装が **CLI と web で二重に
存在**し、すでに BH-11（BUG.md）で「CLI は実体を再帰削除、web は throw」という
**非対称の差分**が実際のバグになった実績がある。

> **2026-08-13 関数レベル照合（6-1 具体化）**:
> `scripts/sync-profiles.mjs` の 16 関数のうち **14 個**（`stripJsonc` / `readJsonc` /
> `tomlString` / `tomlArray` / `isEnvRef` / `envValueToCodex` / `envValueToClaude` /
> `filterEnv` / `opencodeMcpToCodex` / `opencodeMcpToClaude` / `replaceCodexMcpTables` /
> `buildTargets` / `planSync` / `applySync`）が `web/src/lib/profiles/sync-engine.ts` と
> **同名・実質同一**（`readJsonc` を実読: CLI は無型、web は `as OpendcodeConfig` の型注釈のみの差）。
> CLI 固有は `resolveActiveOpencodeConfigPath` / `readClaudeSettings` の 2 個のみで、
> 残りは web 側 `sync-engine.ts` の実装をそのまま利用できる。
> `agents-sync.mjs`（292 行）と `agents-sync-engine.ts`（463 行）も同様に
> `symlinkDir` / `plan` / `apply` が実質同一（BH-11 で既に差分が実害化）。
> → 重複は「コピペの同期」ではなく、**ロジックの単一ソース化**で解消可能な規模。
> `scripts/*.mjs` を web 側 TS の薄いラッパーにする際、この 14+ 関数が直接 import の対象になる。

> **2026-08-13 関数単位の差分（ドリフト方向の確認）**:
> `planSync` を実読比較: **ロジックは実質同一**だが、CLI はグローバル定数（`OPENCODE_CONFIG` /
> `CODEX_CONFIG`）を直接参照し、web は `profilePaths()`（lib 側）経由。さらに web 側のみ
> `cursorServers`（Cursor 連携）を追加済みで、`buildTargets` の戻り値が
> CLI `{codexBlocks, claudeServers, names}` → web `{..., cursorServers}` に**進化済み**。
> → **web 側が進化版・CLI が旧版**という非対称の方向が確定。BH-11（CLI だけ破壊的）と
> 同型の「CLI が遅れて取り残される」パターンで、CLI を web 実装へ統合すれば
> Cursor 連携の取り残しも同時に解消される。
> `stripJsonc` は web 側では `profiles/jsonc.ts` に分離され、`sync-engine.ts` はそれを import。
> CLI は自前実装のまま → 共有化で `jsonc.ts` を正本にできる。

**改善方針**: `scripts/*.mjs` は `web/src/lib/profiles/*.ts`（または共有 ESM モジュール）を
import する薄いラッパーに統一する。web の TypeScript から Node ESM スクリプトを直接
import できる形（`.mjs` ラッパー + ビルド不要）を整備し、**ロジックは 1 箇所**にする。


### 6-2. 【高】host-control URL 解決の web / scripts 重複（セキュリティ非対称）

`resolveHostControlUrl`（env → `%APPDATA%\opencode-webui\host-control.json` → 既定ポート）が
**2 箇所に別実装**:

| 実装 | ファイル | loopback 検証 |
|------|---------|--------------|
| web 側 | `web/src/lib/host-control.ts` | **あり**（`isLoopbackControlUrl` で env/JSON の URL を検証） |
| build guard | `scripts/production-webui-build-guard.mjs` | **なし**（env 値を無条件に採用） |

`production-webui-build-guard.mjs` は WebUI 停止を伴う重要な安全機構（`build.bat` 連携）のため、
URL 解決の非対称は「一方だけが loopback 外 URL を拒否する」状態。同一ロジックを
`host-control.ts`（または共有モジュール）へ一本化し、guard 側はそれを import する。

### 6-3. 【中】プロセス / ポート / OpenCode パス解決の重複

関数名ベースの横断照合（host/src × scripts × web/src/lib）で以下を確認:

| 機能 | 実装箇所 |
|------|---------|
| `parseListeningPids` | `host/src/port-plan.js` と `scripts/production-webui-build-guard.mjs` に**同型実装** |
| `dataDir` | `host/src/auth-store.js` / `index.js`（`ensureDataDir`）と `web/src/lib/paths.ts` |
| `isLoopbackHost` 系 | `host/src/caddy-sites.js` と `web/src/lib/localhost-redirect.ts` |
| OpenCode パス/winget 解決 | `scripts/preflight.mjs`（`findOnPath` / `wingetLinkPath` / `npmOpencodeBinary`）と `host/src/opencode-path.js`（`wingetOpencodeLink` / `npmOpencodeSiblingExe` / `pickOpencodePath`） |

`parseListeningPids` と OpenCode パス解決は「ビルド時ガード / セットアップ時」と
「host 実行時」で同じ決定ロジックを使うべき箇所で、二重実装により
「片方で直した規則がもう片方に未反映」になるリスクが残る（BH-11 と同じ構造）。

**改善方針**: 決定ロジック（ポート解析・OpenCode 探索・dataDir）を
`host/src/` の共有モジュール化し、`scripts/*.mjs` から import する。
`scripts/` は Node ESM のまま実行でき、host も `type: module` なので障壁は低い。

### 6-4. 【低】検証用 / 廃止スクリプトの整理

`scripts/` に `smoke-*.mjs`（API・browser-bridge）等の検証系が混在。実行に
「WebUI / host が起動済み」を前提とするものが多く、README との整合（前提条件の明記）を
`docs/` 側へ集約する。

---

## 7. addons/（WebUI アドオン）

### 7-1. 【低】アドオン基盤（registry / state / AddonHost）は健全、追加手続きを簡略化

- 現状 `codexbar` のみ。`web/src/lib/addons/registry.ts` がアドオン登録を担い、
  機能追加はスロット（`AddonHost` / `AddonSettings`）に沿う形で整備されている。
- アドオンの仕様（スロット・API・バージョン互換）を `addons/README.md` に
  記載済み。`@addons/*` パス解決（tsconfig + next.config `externalDir`）の制約を
  ドキュメントへ明記し、新規アドオン追加時の罠を減らす。

> **2026-08-13 実測（addons 構造）**:
> - `lib/addons/types.ts`（`WebUIAddon`）は id / name / description / defaultEnabled / Widget の
>   5 フィールドでスロット契約を定義。`registry.ts` は `ADDONS: WebUIAddon[]` の登録のみで薄い。
> - `lib/addons/state.ts` は**良い実装の実例**: localStorage 読書に read-modify-write の
>   `writeQueue` 直列化・`sanitizePrefs`（boolean のみ許容）・レガシー `webui:plugins` からの
>   マイグレーション・CustomEvent 配信を備える。2-2 の `createSettingSync` 設計の参考にできる。
> - `AddonHost.tsx` は「hydration 前は非表示 + `ADDONS_CHANGED_EVENT` 購読」で state 同期。
>   スロット契約は明確で、現時点で構造的な改善余地は小さい。
> - 課題は「アドオン追加時の 3 箇所編集」（`addons/<name>/` 実装 + `registry.ts` 登録 +
>   `web/scripts/sync-addon-assets.mjs` の対象追加）が手続きとして残ること。→ 追加チェック
>   リスト or 最小の `npm run addon:new` スキャフォルド（既存 addon を雛形に生成）を用意すると
>   敷居が下がる。

### 7-2. 【低】codexbar Widget の分割（集計は lib 分離済み）

> **2026-08-13 実測（codexbar 本体 / 7 章追記）**:
> - `CodexBarWidget.tsx` は **813 行・hooks 25 個**で、アドオン内で巨大化している
>   （プロバイダ一覧・トークン集計・使い方表示・エラー処理が 1 ファイル）。UI は
>   Widget 内に閉じており影響範囲は限定的だが、1-1 と同様に「表示部 + 集計フック」の
>   分割余地がある。
> - 一方で `lib/codex-tokens.ts`（純関数: `parseTokenCountLine` / `addUsage` / `sumUsage` 等）と
>   `lib/codex-tokens-server.ts`（`aggregateCodexTokens`）は**クライアント/サーバで分離済み**で、
>   サーバ API ルート（`app/api/addons/codexbar/*`）は薄い配線。良い層分けの実例。
> - 改善方針: CodexBarWidget を「プロバイダ選択（`useCodexProviders`）」「トークン集計
>   （`useCodexUsage`）」「表示」に分け、集計ロジックは `lib/` の純関数をそのまま利用する。

---

## 8. CI / テスト基盤

### 8-1. 【高】web の CI が失われている

`.github/workflows/` は **`encoding-check.yml` のみ**（host テスト + bat エンコード）。
過去に存在した `ci.yml`（web の lint / typecheck / vitest / build）はコミット `0fdb685`
で削除されている。web 側の 3500+ テスト・lint・typecheck は現在 **CI で実行されない**。

**改善方針**: web の `lint` / `typecheck` / `vitest`（`next build` は不要）を
`encoding-check.yml` に追加するか、`ci.yml` を復活させる。`next build` はローカル
本番 WebUI と競合するため CI では省略可（E2E は `webServer` 起動時のみ）。

> **対応済み（2026-08-13, コミット `eada365`）**: `.github/workflows/ci.yml` を復活
> （web の lint / typecheck / vitest、Node 24、Ubuntu）。`next build` と E2E は
> 除外（理由は ci.yml 内コメントに記載）。`.gitignore` に `!.github/` 例外を追加。
> 復活時の既存エラー状況（可視化結果）: typecheck クリーン / lint 0 error・
> 1 warning（`src/lib/opencode-generation.settings.test.ts:13` の unused `EVENT`）/
> vitest 298 ファイル・3693 passed・1 skipped・0 failed。warning 1 件は別途修正
> （対象: IMPROVEMENT.md 8-3 と併せて）。


### 8-2. 【中】vitest の並列化・所要時間の管理

vitest は現在 287 ファイル / 3561 テスト。`vitest.config.ts` に test shard や
`pool` 設定の記載がなく、実行時間が今後も伸びる。`--shard` 分割（CI 向け）と
遅いテストの特定（`--reporter` で計測）を手順化する。

### 8-3. 【中】component テスト不足（20/81 が未テスト）

`web/src/components/` 配下 **81 component 中 20 がテスト無し**（2026-08-13 機械集計）。
特に以下はロジック量が多く、回帰リスクが高い:

| component | 行数 | リスク |
|-----------|-----:|--------|
| `settings/AutoRouteOverridesEditor.tsx` | 561 | Auto ルーティング上書きの編集・保存ロジック |
| `settings/VisionSettings.tsx` | 494 | 画像解析（Ollama セットアップ含む）の状態遷移 |
| `settings/ProfileAgentsSyncSettings.tsx` | 473 | エージェント同期の設定 UI |
| `settings/ProfileSyncSettings.tsx` | 359 | プロファイル同期の設定 UI |
| `settings/ClaudeSubscriptionAuth.tsx` | 199 | OAuth popup フロー（他 OAuth はテスト有り・非対称） |
| `shell/TaskSplitContext.tsx` | 194 | 分割ビューの state 配布（TaskView の分割依存） |
| `task/workflow-graph/WorkflowGraphCanvas.tsx` | 205 | グラフ描画（BH-1 のデバッグ fetch 残骸が過去にあった領域） |

**改善方針**: 1-3 の OAuth 共通化と合わせて、`AutoRouteOverridesEditor` /
`VisionSettings` / `TaskSplitContext` を優先にテストを追加する。単純な選択肢
コンポーネント（`AccessModeSelect` 等）はレンダリング/呼び出しのみの軽量テストでよい。

### 8-4. 【低】E2E のスコープ拡大

`web/e2e/` は 8 スペック / 59 テスト（composer 17・task 15・sidebar 9・smoke 7・
workflow 系 7 等、2026-08-13 計測）で、production ビルドを起動して検証する設計。
ローカル WebUI との `.next` 競合は `NEXT_DIST_DIR` で回避済みだが、実行時間が長いため
CI 化は smoke のみに留め、頻度を決める。主要機能のカバレッジは適切。

### 8-5. 【低】仕様書の実装ステータス管理（仕様 ↔ 実装の対応が追えない）

`docs/specs/` は **28 ファイル**あるが、実装状況（実装済み / 一部 / 未実装）の記載が
**統一された形式で存在しない**（2026-08-13 確認）。一部のファイルは冒頭コメントで
対応機能が分かるが、どこまで実装されたかはコードを読まないと判断できない。
→ 各 spec の冒頭に「実装ステータス」（`✅ 実装済み / 🔶 一部 / ⬜ 未実装` + 参照コード）
を付与する運用を追加する。`opencode-api-v2-migration.md` のような移行系は特に
「どこまで進んだか」の追跡が重要で、実装と共に更新する。

---

## 9. 横断的な改善（複数機能に跨る）

### 9-1. 【中】キャッシュ層の重複と契約の整理

キャッシュが 4 系統存在する:

| 系統 | 実体 | 用途 |
|------|------|------|
| HTTP キャッシュ | `lib/http-cache.ts`（`withReadCache`） | BFF GET への Cache-Control |
| クライアント SWR | `lib/stale-cache.ts` | ブラウザ側 stale-while-revalidate |
| Service Worker | `public/sw.js`（v6） | オフラインシェル + `/_next/static/*` のキャッシュ（BH-2 で修正済み） |
| プロキシ内部キャッシュ | `opencode/[...path]/route.ts` 内 | provider/agent capability（無制限） |

`stale-cache.ts` の CACHE_POLICIES と route 側の `withReadCache` は「同じ端点を別々に
キャッシュ」しており、整合が手動維持になっている。端点ごとのキャッシュ方針を
1 箇所（レジストリ）で宣言し、両者がそれを参照する形へ統一する。

> **2026-08-13 実測（stale-cache.ts CACHE_POLICIES）**: 14 エントリが `stale-cache.ts` 内に
> ハードコードされている。freshMs / staleMs は端点ごとにバラバラ（`/api/health` は
> fresh 10s、`model-ranking` は fresh 300s 等）で、`withReadCache`（BFF 側 Cache-Control、
> 既定 `max-age=30 / swr=600`）と値が揃っていない。さらに `persist` 有無も混在し、
> 「どの端点が localStorage に永続化されるか」が CACHE_POLICIES を見ないと分からない。
> → 端点ごとのキャッシュ方針（freshMs / staleMs / persist / BFF の max-age / swr）を
> `lib/cache-policy-registry.ts` 1 箇所に宣言し、`stale-cache.ts` と `withReadCache` の両方が
> それを参照する。値の二重管理（クライアントとサーバで別々に書く）を解消する。

> **2026-08-13 実測（Service Worker v6 / 9-1 追記）**:
> - `public/sw.js`（134 行）は **BH-2 修正済み**: `CACHE = "opencode-webui-v6"`、`/_next/static/*` を
>   cache-first でキャッシュ、BUILD_ID 変更時に `wipeCache()` で全削除。オフラインシェルは成立している。
> - 責務境界は明確（`/api/*` は non-intervention、`_next` と静的アセットと navigate のみ処理）で、
>   SW は「HTTP/SWR レジストリ」とは別系統のまま**意図的に分離**してよい。
> - ただしキャッシュ対象の判定（`/\.(png|svg|ico|webmanifest|woff2?|css|js)$/`）と
>   `_next` の扱いは SW 内にハードコードされ、`next.config.ts` のアセット規則や
>   manifest と整合を保つ手続きがない。→ キャッシュ対象の拡張子一覧を共有定数化し、
>   SW のテスト（`sw.test.js`）で manifest / next.config との整合を検証する。
> - `ServiceWorkerRegister.tsx`（42 行）は登録 + BUILD_ID 通知のみで、コントローラ制御は
>   `controllerchange` で通知再送に対応。健全。

> **2026-08-13 既存の無効化経路 / withReadCache 適用状況（9-1 補足）**:
> - **無効化は確立済み**: `client.ts` の `sendJson` は書き込み成功時に
>   `invalidatePrefix(cacheInvalidationPrefix(path))` を呼び、最初の 2 URL セグメント
>   （例: `PATCH /api/projects/{id}` → `/api/projects` 一覧）を stale-cache から落とす
>   （`cacheInvalidationPrefix` = `/^(\/api\/[^/]+)/`）。→ 9-1 のレジストリ化はこの経路を
>   壊さず、`CACHE_POLICIES` の値だけを共有化すればよい。
> - **BFF 側 withReadCache は 24 route に適用済み**（projects / roots / workspaces / tasks/archived /
>   settings / profiles 系 / extensions 系 / qwen-native 系 / analytics / health / ollama 等）。
>   一方 CACHE_POLICIES（クライアント SWR）は 14 エントリで、**両者の適用端点が一致していない**
>   （例: BFF は `/api/health` に withReadCache 適用、SWR も `/api/health` 有り — 一致しているが、
>   `/api/workspaces` 等一部は BFF 有り + SWR 有り、`/api/access` 等は両方なし）。
> → レジストリ化で「BFF の Cache-Control 値」と「SWR の freshMs/staleMs」を端点ごとに
>   対にして 1 箇所に宣言し、`withReadCache` と `policyForPath` が同じ定数を参照する。
>   適用/不適用の端点リストの乖離も 1 箇所の diff で把握できる。

> **2026-08-13 端点対応表の機械生成（9-1 乖離の実測）**:
> SWR `CACHE_POLICIES` 14 prefix と BFF `withReadCache` 適用 23 route を prefix 一致で照合。
> **乖離は 1 件のみ**: `/api/opencode/provider` が「SWR のみ（BFF withReadCache なし）」。
> BFF のみの端点は 0 件で、**適用端点は概ね整合済み**（前回ターンの「乖離」推定は過大だった —
> `withReadCache` の `{maxAge}` 個別指定を持つ route は値のみ差）。
> - ただし「SWR にだけある」「BFF にだけある」の一致は prefix ベースであり、
>   `withReadCache` は `{key}` のような動的セグメントも含む（`/api/settings/{key}`）。
> - 実質的な課題は「端点の有無」ではなく「**値の二重管理**」: `withReadCache` の既定
>   `max-age=30 / swr=600` と、SWR 側の端点ごとの freshMs/staleMs が別々に書かれている。
> → レジストリ化の主目的は「値の一元化」に絞ってよく、端点リストの再整理は副次。
>   `/api/opencode/provider` には BFF 側に `withReadCache` を足す（または SWR から外す）判断を
>   レジストリ化の際に行う。

### 9-1b. 【低】localStorage キー命名の統一（現状は概ね整合）

`webui:` プレフィックスは **49 キーで統一済み**（`webui:access-mode` / `webui:default-model` /
`webui:hang-timeout` 等、2026-08-13 収集）。例外・気になる点は 2 つ:

- `webui:side-panel` / `webui:side-show` / `webui:side-tab`（`side-panel-state.ts`）のように
  1 機能が複数キーに分割されている → `webui:side-panel:<k>` への束ねが候補（sidebar-settings は JSON 束ね済み）。
- `webui:plugins` と `webui:addons`（`addons/state.ts`）の 2 系統が並存（レガシー `webui:plugins` からの
  移行痕跡）→ 移行完了後は旧キーの読み取りパスを削除。
- キャッシュ系は `webui.stale-cache.v1.` と `.` 区切りで別系統（意図的な分離）。

命名規則（`webui:` + ケバブケース、1 機能 1 キー）を `docs/` に明文化し、
2-2 の `createSettingSync` 導入時に統一する。

### 9-2. 【中】イベント通知の取り回し

`lib/events.ts`（456 B）が `window.dispatchEvent` ベースで、タスク変更通知を
Sidebar 等へ配信している。複数タブ（分割ビュー / 別ウィンドウ）での再同期が
手動（`visibilitychange` 時の再取得）で行われている。BroadcastChannel 化 or
Server-Sent イベントへの統一を検討する（低コストで複数タブ同期が強固になる）。

> **2026-08-13 注目（attention 系 / 9-2 補足）**:
> - `lib/attention.ts`（193 行）は SSE イベントの envelope 正規化（`normalizeEnvelope`）と
>   permission/question パース（`parseGlobalEvent` / `parseGlobalSessionCreated`）、パス解決
>   （`replyPath` / `rejectPath`）を担い、**良い責務分離**。`GlobalAttentionProvider.tsx`
>   （706 行）はこれを import 使用しており、パースの再実装は無い。
> - 一方 `GlobalAttentionProvider.tsx` は 706 行で、SSE 購読・キュー reconcile・自動応答
>   （`permissionAutoAction`）・`storage` 同期が混在。1-1 の巨大コンポーネントと同種の
>   分割余地がある（`useAttentionQueue` 235 行は別ファイルで分離済み）。
> - `lib/events.ts` の `dispatchEvent` 系は、`attention` / `default-model` / `addons` /
>   `currency` 等で同名イベント名を使い回している。BroadcastChannel 化する際は
>   イベント名の一覧を `lib/events.ts` に集約し、発行/購読をヘルパー化すると良い。

> **2026-08-13 イベント名の分散（9-2 集約対象）**:
> `webui:` プレフィックスのイベント名は **26 個が 17 ファイルに分散**（機械収集）。
> 大半（`webui:access-mode` / `webui:default-model` / `webui:hang-timeout` 等 21 個）は
> 発行・購読が同一 lib ファイル内で完結し、外部へ漏れない。一方、**複数ファイルが
> 跨るもの**は:
> - `webui:tasks-changed`（3 箇所: `lib/events.ts` 発行 + `useAttentionQueue` / `Sidebar` 購読）
> - `webui:attention-count-changed`（`lib/events.ts` 定義）
> - `webui:active-session-attention`（`lib/active-session-attention.ts` ↔ `Sidebar.tsx`）
>
> → BroadcastChannel 化の第一歩はこの 3 つを `lib/events.ts` の一覧へ集約し、他 21 個は
> 各 lib 内の private 定数でよい（外に漏らさない）。`lib/events.ts` は現状 456 B と小さく、
> イベント名定数 + 発行/購読ヘルパー（`emit(tasksChanged)` / `subscribe(name, fn)`）を置く
> 正本にする。`storage` イベントと併用して複数タブ同期を実現する。

> **2026-08-13 GlobalAttentionProvider の state 連携（9-2 具体化）**:
> - 注意キュー state（`items` / `tasks`）は `useAttentionQueue`（235 行）に委譲済みで、
>   `attentionQueueReducer` / `shouldQueueAttention` / `resolveAttentionSessionTitle` は
>   export された純関数。Provider は「SSE 購読 + reconcile + 自動応答 + 通知」の配線に集中。
> - 自動応答は `permissionAutoAction`（`lib/subagent-permission.ts`）等の lib 純関数を利用し、
>   再実装なし（良い層分け）。
> - **複数タブ同期は現在 `window` の `storage` イベント**（261 行）で実装。storage は
>   「別タブが localStorage を変えた」時にしか発火しないため、同一タブ内の変更は検知できない
>   （`webui:*` CustomEvent が同一タブを担当）。2 系統が併存している。
> → BroadcastChannel 化でこの 2 系統を統一できる: BroadcastChannel（`webui-sync`）へ
>   「localStorage 変更 + タスク変更 + attention 変更」をまとめてブロードキャストし、
>   購読側は memory/`storage` のフォールバックを残しつつ同一経路で受信する。
>   `GlobalAttentionProvider` 706 行の分割はこの統合と同時に行うと相乗効果が高い。

> **2026-08-13 events.ts / recently-replied.ts の現状（9-2 対象範囲の確定）**:
> - `lib/events.ts`（456 B）は `notifyTasksChanged` / `notifyAttentionCountChanged` の 2 発行
>   ヘルパーのみ。イベント名は文字列リテラルで直書きされ、定数化されていない。
>   → 9-2 の `lib/events.ts` 正本化（イベント名定数 + `emit` / `subscribe`）は現状と
>   整合が取れ、追加コストが小さい。
> - `lib/recently-replied.ts` は **モジュールスコープの `Map`（TTL 60s）**で、タブ内のみ有効。
>   複数タブ（分割ビュー / 別ウィンドウ）で同じ権限要求を処理した場合、もう一方のタブでは
>   `wasRecentlyReplied` が効かず、**同一要求が再度キューへ入り得る**。
>   → これも BroadcastChannel 化の対象（`rememberReplied` 時にブロードキャストし、
>   受信側で local Map に反映）。`storage` では Map のスナップショット共有が難しいため、
>   BroadcastChannel が自然に合う。

### 9-3. 【低】ログ・デバッグファイルの扱い

リポジトリ直下に `bb.log` / `bb-broker.log` / `build.log` / `typecheck.log` 等が
ローカルに残る（gitignore 済み）が、`.gitignore` の `*.log` はグローバルに効いており、
意図しないログ生成箇所の特定がしにくい。ログ出力先は `host` の `log-buffer` /
`log-file` に集約済みなので、その方針を README に明記する。

---

## 10. 優先度別サマリ

### 高（先に着手）

| ID | 項目 | 対象 |
|----|------|------|
| 1-1 | 巨大コンポーネントの分割 | TaskView / SettingsView / Sidebar / HomeView 等 |
| 1-2 | `useSessionStream.ts`（2311 行）の分割と純関数化 | web/lib |
| 2-1 | `/api/opencode` プロキシ（1199 行）のモジュール分割 + キャッシュの LRU/TTL 化 | BFF |
| 3-1 | `goal-loop.ts`（1830 行）の関心分離 | web/lib |
| 3-2 | `db.ts` の `user_version` ベースマイグレーション化 | web/lib |
| 3-3 | `ocServer` 直呼びの v2 unwrap 一元化（BH-9 の構造解消） | web/lib |
| 4-1 | `host/src/index.js`（3071 行）の分割 | host |
| 6-1 | sync ロジックの web/CLI 一元化（BH-11 再発防止） | scripts + web/lib |
| 6-2 | host-control URL 解決の web / scripts 重複（loopback 検証の非対称） | web/lib + scripts |
| 6-3 | プロセス/ポート/OpenCode パス解決の重複（parseListeningPids 等） | host + scripts |
| 8-1 | web の lint / typecheck / vitest を CI に復活 | CI |

### 中

| ID | 項目 |
|----|------|
| 1-3 | OAuth / CLI 認証カードの共通化 |
| 1-3b | GhostSelect ラッパー系の同型重複（AccessModeSelect 等 3 つ） |
| 2-2 | 設定レジストリ一元化 + 設定同期パターン（write queue / busy ガード）の共通化 |
| 2-3 | 認可ガードのポリシー集約 |
| 2-4 | Git 操作系・メモリ系 route のテスト追加 |
| 3-4 | 手書き型 → 生成型の置換完了 |
| 4-2 | `control-server.js` のルート宣言テーブル化 |
| 5-1 | メモリ実装の共有モジュール化 |
| 8-2 | vitest の shard 化・実行時間管理 |
| 8-3 | component テスト不足（20/81。AutoRouteOverridesEditor 等） |
| 9-1 | キャッシュ方針のレジストリ統一 |
| 9-2 | 複数タブ同期の BroadcastChannel 化 |

### 低

| ID | 項目 |
|----|------|
| 1-4 | `ui.tsx` 部品規約の明文化 |
| 1-5 | UI 細部の棚卸し（MessageTokenHighlight 等の軽量テスト追加） |
| 2-4 の一部 | 更新系 route のテスト |
| 2-5 | profiles open ルートのハンドラ骨格重複（`handleOpenAction` 化） |
| 3-5 | `any` の置き換え（3-1/3-3 と併せて） |
| 3-6 | トークン/コスト計算系の良い層分け維持（model-pricing-registry のみテスト追加） |
| 3-7 | `task-service.ts` の小分割（コスト推定 → task-cost.ts） |
| 4-3 | `service-status.js` を状態正本化 |
| 5-2 | ブラウザ拡張の Playwright 結合テスト |
| 5-3 | Broker 系の良い層分け維持（state/server/policy/audit） |
| 6-4 | scripts/ の検証系整理・前提条件の文書化 |
| 7-1 | addons の追加手続き簡略化（addon:new スキャフォルド） |
| 7-2 | CodexBarWidget（813 行）のフック分割 |
| 8-4 | E2E の CI 化スコープ確定 |
| 8-5 | 仕様書（docs/specs 28 本）への実装ステータス付与 |
| 9-1b | localStorage キー命名の統一（side-panel 束ね・plugins/addons 整理） |
| 9-3 | ログ出力方針の README 明記 |

### 着手推奨順（優先度だけでは見えない順序関係）

優先度は「重要度」だが、実施順は依存関係で決まる。推奨する着手順:

| 順 | 作業 | 理由 |
|----|------|------|
| 1 | **8-1（web の CI 復活）** | 他のリファクタの安全網。3500+ テストを CI で回せるようになるまで、大きな分割はリグレッション検知が手動になる |
| 2 | **6-1 / 6-2 / 6-3（CLI↔web / host↔scripts の重複一元化）** | 規模が小さく効果が明確（BH-11 の再発防止）。先に「ロジックの単一ソース化」の実績を作ると、後の分割作業の雛形になる |
| 3 | **3-2（db.ts のマイグレーション管理）** | 他の全機能が db.ts に依存。スキーマ変更の安全化は分割作業の前提 |
| 4 | **1-1 / 3-1（TaskView / goal-loop の分割）** | 最大の保守性改善。第 12 章のひな形（workflow 系等）を参照し、「移動のみ」から始める |
| 5 | **2-1（プロキシ分割 + キャッシュ LRU/TTL）** | BH-8 のメモリ無制限成長も同時に解消 |
| 6 | **4-1 / 4-2（host/index.js・control-server の分割）** | host はテスト 395 本があるため、分割の検証がしやすい |

中・低の項目は上記の合間 or 随時。特に 3-3（v2 unwrap 一元化）は BH-9 の修正と重なるため、
バグ修正のタイミングと併せて行うのが効率的。

---




## 11. 調査方法（記録）

- `git ls-files` で追跡対象のみ走査（ローカルログ・`node_modules`・`docs/improvement-plan.md` 等は除外）
- ファイル行数は `node` スクリプトで `src` 配下の `.ts` / `.tsx` / `.js` を計測
- 重複は「CLI ↔ web」同期ロジック（6-1）と「OAuth カード」（1-3）を中心に照合
- テストカバレッジは `route.test.ts` / `.test.tsx` / `.test.ts` の有無で機械的に集計
- CI 状態は `.github/workflows/` と `git log -- .github` で確認
- バグとの重複回避は BUG.md の ID（BH-* / BU-*）と突合して実施済み

### 計測対象の規模（2026-08-13 時点）

| 対象 | ファイル数 | テスト数（機械集計） |
|------|----------:|---------------------:|
| `web/src`（TS/TSX） | 712 ファイル / **173,070 行** | – |
| `web/src/app/api` route | 133 | 72（54%） |
| `web/src/components`（.tsx） | 90 | 60（`.test.tsx` のみ。`.test.ts` 形式を含めると本文 8-3 の 81/61 と一致） |
| `web/src/lib`（.ts） | 191 | 156 |
| `host/src` | 19（main .js） | 30（test .js） |
| `browser-bridge` | 16（main .mjs） | 15（test .mjs） |
| `web/e2e` | 8 spec | 59 テスト |

> 参考: BUG.md 記録の既存テスト実行結果（web vitest 287 ファイル / 3561 テスト、
> host 395 テスト、browser-bridge 91 テスト）は上記と別系統の「実行数」で、本ファイルの
> 「テスト有無の機械集計」とは集計方法が異なる（有無カウント vs 実行件数）。

---


---

## 12. 付録: 良い分割の実例一覧（分割作業の参照ガイド）

調査中に「良い層分け / 良い実装の実例」と判断した箇所を集約。巨大ファイルの分割
（1-1 / 2-1 / 3-1 / 4-1 等）や、重複の単一ソース化（5-1 / 6-1）の際に、
**ひな形として参照する**ための一覧。

| 領域 | 実例 | どこが良いか | 参照 |
|------|------|------------|------|
| ワークフロー | `web/src/lib/workflow-*`（44 モジュール・最大 877 行） | 機能を細かく分割し、責務ごとに 1 モジュール | 3-1 の分割ひな形 |
| OpenCode 拡張 | `web/src/lib/opencode-extensions/`（18 モジュール・最大 905 行） | 機能ごとの薄いハンドラ群 + 純関数 | 2-1 プロキシ分割のひな形 |
| コスト計算 | `token-usage` / `context-usage` / `openai-pricing` / `currency` / `model-ranking`（6 モジュール） | 集計 / 価格 / 表示の分離。ほぼ全てテスト済み | 3-6 |
| Broker | `browser-bridge/broker/`（server / state / policy / audit の 4 モジュール） | `BrowserBridgeState` + `TRANSITIONS` で状態遷移を 1 クラスにカプセル化。全テスト済み | 5-3 |
| メモリ層 | `lib/memory.ts` + `memory-key.ts` + `memory-safety.ts`（web 内部の 3 分割） | DB 操作 / 類似判定 / 検証を分離。web 内では一元化済み | 5-1 補足 |
| アドオン | `lib/addons/state.ts` | read-modify-write の write queue 直列化 + sanitize + レガシー移行 + CustomEvent 配信 | 7-1 / 2-2 の `createSettingSync` 参考 |
| SSE reducer | `useSessionStream.ts` の 1–797 行（純粋関数 + reducer） | 純粋関数を export し `useSessionStream.test.ts` で直接テスト | 1-2 |
| 設定同期 | `default-model.ts` | localStorage 即時 + write queue + サーバミラーの典型実装 | 2-2 の参考実装 |
| profiles open | `lib/profiles/open.ts` | プラットフォーム分岐（Windows/macOS/Linux）を 2 関数に集約 | 2-5 |
| profile ルート | `app/api/profiles/*`（11 ルート全て 28–97 行） | API ルートを薄い配線にし、ロジックを lib に集約 | 2-5 |
| memory ルート | `app/api/memory/*`（7 ルート全て 29–112 行） | 同上（薄い配線 + lib 集約） | 2-4 |

> **使い方**: 分割や共通化の作業を始める前に、対応する行の「実例」を開いて
> その構造（モジュール境界 / 純関数の切り出し位置 / テスト配置）を踏襲する。
> 特に 3-1（goal-loop 1830 行）はワークフロー系、2-1（プロキシ 1199 行）は
> opencode-extensions の構造をひな形にするのが推奨。
