# REFACTORING PLAN — IMPROVEMENT.md の実行計画

> 立案日: 2026-08-13（git HEAD `82d4add`）
> 入力: [IMPROVEMENT.md](./IMPROVEMENT.md)（39 節 / 高 11・中 12・低 16）
> 関連: [BUG.md](./BUG.md)（BH-1〜13 / BU-1〜10 は修正済み。**構造要因は未解消**）
>
> 本ファイルは **どの順で・どう安全に実施するか** の計画。何を直すかの根拠は IMPROVEMENT.md 側にある。
> **現在の状態: 計画確定・実装未着手**（決定 D5）。方針の確定事項は [§3 決定事項](#3-決定事項2026-08-13-確定) にある。
> 2026-07 の [`docs/improvement-plan.md`](./docs/improvement-plan.md)（UI/UX を Codex に寄せる計画・ローカル専用）とは別物。

---

## 0. 計画の前提

### 0.1 実施原則

| # | 原則 | 理由 |
|---|------|------|
| P1 | **安全網を最初に作る** | CI が無い状態（8-1）で巨大分割を始めると、リグレッション検知が全て手動になる |
| P2 | **1 PR = 1 関心** | 分割 PR に振る舞い変更を混ぜない。レビューと revert の単位を小さく保つ |
| P3 | **「移動のみ」から始める** | 巨大ファイルの分割は、まず import 経路だけ変える無変更移動 → その後に内部整理 |
| P4 | **characterization test 先行** | 分割前に「現在の振る舞い」を固定するテストを足す。特にテスト無しの領域（route 61/133・component 20/81） |
| P5 | **振る舞い変更は別コミット** | 例: 2-1 の分割と LRU/TTL 化は同 PR でも**別コミット**にする |
| P6 | **コミット間隔を最小化** | 並列セッション（Cursor 等）と OneDrive 同期下のため。変更 → 検証 → 即コミット |

### 0.2 各ステップで使う検証コマンド

```
npm --prefix web run typecheck     # tsc --noEmit
npm --prefix web run lint          # eslint
npm --prefix web run test          # vitest run（3500+ テスト）
npm --prefix host test             # host 395 テスト
npm run test:encoding              # .bat エンコード検証
```

- **禁止**: `next dev` / `next start` / `next build` / `npm run build`（AGENTS.md）。
  稼働中の WebUI を落とすため、本番ビルド検証はユーザーに委ねる。
- E2E（`npm run e2e`）は CI モードのみ。Phase 7 まで必須にしない。

### 0.3 やらないこと（スコープ外）

- 機能追加・UI デザイン変更（本計画は構造改善のみ）
- 「良い実装」の作り直し（IMPROVEMENT.md 第 12 章の 11 件は**維持**が方針）。
  特に 3-6（コスト計算 6 モジュール）・5-3（Broker 4 モジュール）は**触らない**
- 全ファイルの一括整形・自動リファクタツールの一斉適用

---

## 1. フェーズ概観

| Phase | 主題 | 対象節 | 規模 | 依存 |
|-------|------|--------|------|------|
| **0** | 安全網（CI 復活） | 8-1, 8-2 | 小 | なし |
| **1** | ロジックの単一ソース化 | 6-2, 6-1, 6-3, 5-1 | 中 | P0 |
| **2** | データ層の安全化 | 3-2 | 中 | P0 |
| **3** | サーバー側ドメインの分割 | 3-3, 3-1, 3-7 | 大 | P0, P2 |
| **4** | BFF の分割 | 2-1, 2-2, 2-3, 9-1 | 大 | P0 |
| **5** | UI 層の分割 | 1-2, 1-1, 1-3, 1-3b, 9-2 | 大 | P0 |
| **6** | host の分割 | 4-1, 4-2, 4-3 | 中 | P0, P1 |
| **7** | 仕上げ（テスト・ドキュメント） | 2-4, 8-3, 8-4, 8-5, 低優先 | 中 | 随時 |

**Phase 1〜2 は独立して並行可能**。Phase 3〜6 は互いに独立だが、一度に 1 つずつ進める
（同時進行させるとテスト失敗の原因切り分けが困難になる）。

---

## Phase 0 — 安全網（CI 復活）

**目的**: 以降の全フェーズのリグレッション検知を自動化する。**最初に必ず実施**。

> **状態: 実施済み（2026-08-13, コミット `eada365`）**
> - `.github/workflows/ci.yml` を復活: web の lint / typecheck / vitest（Node 24 / Ubuntu）
> - `next build`・E2E は除外（ci.yml 内コメントに理由記載。E2E の CI 化は 8-4 / Phase 7 で確定）
> - `.gitignore` に `!.github/` 例外を追加（`.*/` パターンが ci.yml を無視するため）
> - 可視化結果（既存エラー）: typecheck クリーン / lint 0 error・1 warning
>   （`src/lib/opencode-generation.settings.test.ts:13` unused `EVENT`）/ vitest
>   298 ファイル・3693 passed・1 skipped・0 failed
> - 残作業: lint warning 1 件の修正（別 PR。D3 に従い CI 復活 PR では直さない）

### 作業単位

| # | 作業 | 対象 | 完了条件 |
|---|------|------|---------|
| P0-a | `ci.yml` の復活（`0fdb685` で削除された内容を参照） | `.github/workflows/ci.yml` | PR / push で web の lint・typecheck・vitest が走る |
| P0-b | `next build` を CI から除外することの明記 | 同上（コメント） | ローカル本番 WebUI と競合しない |
| P0-c | host テスト（395）と encoding-check の維持確認 | `encoding-check.yml` | 既存ジョブが壊れていない |
| P0-d | 実行時間が長い場合のみ shard 化（8-2） | `vitest.config.ts` / workflow matrix | CI が実用的な時間で完了 |

### 検証

- workflow YAML の構文チェック（`node -e` で js-yaml パース、または GitHub 上の初回実行）
- ローカルで `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web run test` が緑

### リスク

| リスク | 緩和 |
|--------|------|
| CI 復活直後に既存の lint/型エラーが露見して赤になる | **決定 D3**: 復活 PR では**エラーを直すのではなく可視化**が目的。赤が出ても同 PR では直さず、**別 PR で修正**し、Phase 1 開始前に緑にする（`continue-on-error` での糊塗もしない） |
| 3500+ テストで CI 時間が伸びる | P0-d の shard 化（8-2）を同 PR 内で追加してよい |

---

## Phase 1 — ロジックの単一ソース化

**目的**: 「片方で直した規則がもう片方に未反映」の構造（BH-11 の実害パターン）を消す。
規模が小さく効果が明確なので、Phase 3 以降の大きな分割の**予行演習**にもなる。

### 実施順（小 → 大）

#### P1-a. `resolveHostControlUrl` の一本化（6-2）— 最小・セキュリティ効果あり

- 現状: `web/src/lib/host-control.ts`（loopback 検証**あり**）と
  `scripts/production-webui-build-guard.mjs`（検証**なし**）で非対称
- 作業: 共有 ESM モジュール（例 `scripts/lib/host-control.mjs` or `host/src/host-control.js`）に
  URL 解決 + `isLoopbackControlUrl` を置き、web / guard の双方が参照する
- 完了条件: guard 側でも loopback 外 URL が拒否される。等価テストを追加
- 検証: `npm --prefix host test` + 新規テスト（env / JSON / 既定ポートの 3 経路 × loopback 内外）

#### P1-b. sync ロジックの一本化（6-1）— 効果最大

- 現状: `scripts/sync-profiles.mjs`（436 行）の **16 関数中 14 個**が
  `web/src/lib/profiles/sync-engine.ts`（526 行）と同名・実質同一。**web が進化版**
  （`cursorServers` 対応済み）で CLI が旧版
- 作業手順:
  1. `stripJsonc` を `web/src/lib/profiles/jsonc.ts` に正本化し、CLI から参照
  2. `planSync` / `applySync` / `buildTargets` 等を CLI から削除し、web 実装を import
  3. CLI 固有の `resolveActiveOpencodeConfigPath` / `readClaudeSettings` のみ残す
  4. `agents-sync.mjs`（292 行）↔ `agents-sync-engine.ts`（463 行）も同様
- **共有方式（決定 D1）**: **`.mjs` 共有モジュール方式**を採用する。
  - ロジックの実体を `.mjs`（Node ESM）に置き、**web 側 TS からも CLI からも import** する
  - 型は `.d.ts` を手書きで併置し、web 側の型安全性を維持する
  - 依存追加なし・ビルド不要のため、CLI 単独実行（`node scripts/sync-profiles.mjs`）が保てる
  - 不採用: `tsx` / `esbuild-register`（devDependency 増 + CLI 起動が重い）、
    ビルド成果物経由（`web/.next` 依存になる）
  - **移動先の置き場所は着手時に決める**（`scripts/lib/` か `shared/` か。
    既存の `browser-bridge/shared/*.mjs` が同種の前例）
- 完了条件: `npm run sync:profiles:check` / `sync:agents:check` が従来と同一結果。
  CLI 経由でも `cursorServers` が反映される（旧版の取り残しが解消）
- 検証: 既存の `sync-engine.test.ts` に加え、CLI 実行の smoke（`--check` の差分出力比較）

#### P1-c. プロセス / パス解決の共有化（6-3）

- 対象: `parseListeningPids`（`host/src/port-plan.js` ↔ guard）、`dataDir`、
  OpenCode パス解決（`scripts/preflight.mjs` ↔ `host/src/opencode-path.js`）
- 作業: `host/src/` 側を正本にし、`scripts/*.mjs` から import（host は `type: module`）
- 完了条件: 同型実装が 1 箇所になる。host テストで両経路をカバー

#### P1-d. メモリ実装の共有化（5-1）

- 対象: `browser-bridge/shared/memory-schema.mjs`（289 行）↔ `web/src/lib/memory-key.ts` の 5 関数
- 共有方式は D1（`.mjs` 共有）に揃える
- **`dataDir` の非 win32 パス不一致（決定 D2）**:
  | 実装 | 非 win32 | win32 |
  |------|---------|-------|
  | `web/src/lib/paths.ts:10` | `~/.opencode-webui` | `%APPDATA%\opencode-webui` |
  | `browser-bridge/mcp/memory-server.mjs:54` | `~/.local/share/opencode-webui` | `%APPDATA%\opencode-webui`（一致） |

  → **`~/.opencode-webui` に統一**（web 側を正本とし、`memory-server.mjs` を変更）。
  win32 は両者一致のため **Windows での挙動は変わらない**。
  非 win32 の既存利用者がいる場合のみ、旧パス（`~/.local/share/opencode-webui`）に
  DB が存在すれば読み替える互換処理を検討する（着手時に実在確認）
- 完了条件: 類似判定・キー正規化のロジックが 1 箇所。`dataDir` の分岐が 1 実装

### Phase 1 全体のリスク

| リスク | 緩和 |
|--------|------|
| CLI と web の**微妙な差が意図的**だった可能性 | 統合前に差分を 1 関数ずつ実読（6-1 は照合済み: 差は型注釈と `cursorServers` のみ） |
| P1-d の dataDir 差が既存ユーザーのデータ参照先を変える | パス変更は**行わず**、まず不一致の事実だけ文書化 → ユーザー判断後に対応 |

---

## Phase 2 — データ層の安全化（3-2 `db.ts`）

**目的**: 全機能が依存する `db.ts`（1670 行 / CREATE TABLE 23 種 / ALTER TABLE 17 箇所）の
スキーマ変更を追跡可能にする。**Phase 3 以降の分割の前提**。

> **決定 D4**: 本フェーズは**実施する**。ただし条件付きで、
> ①移行は**追加のみ**（DROP / 破壊的 ALTER を作らない）
> ②**起動時に DB のバックアップコピー**を取る
> ③**P2-d のスキーマ一致テストを最初に書く**（P2-a の次・移行機構より先）
> の 3 点を満たさない限り移行機構は投入しない。

### 作業単位（実施順）

| # | 作業 | 完了条件 |
|---|------|---------|
| P2-a | 現行スキーマの棚卸し（23 テーブル × 全カラムの最新形を 1 箇所に列挙） | スキーマ定義が読める形で 1 箇所に存在 |
| P2-b | **スキーマ一致テストを先に用意**（新規 DB vs 旧 DB からの移行後） | `db.test.ts` で両者の `table_info` が一致することを検証できる（この時点では現行実装で緑） |
| P2-c | DB バックアップ（起動時のコピー）の実装 | 移行前の DB ファイルが復旧可能な形で残る |
| P2-d | `PRAGMA user_version` の導入と、既存 DB を version N と見なす初期化 | 既存 DB が壊れない（**冪等**） |
| P2-e | 散在する `table_info` + `ALTER TABLE`（17 箇所）を順序付き `migrations[]` へ移行 | 関数内のスキーマ変更が 0 になり、P2-b のテストが緑のまま |

### リスク（本計画で最も高い）

| リスク | 緩和 |
|--------|------|
| 既存ユーザーの DB 破損 | D4 の 3 条件（追加のみ / バックアップ / テスト先行）。P2-b・P2-c を P2-d より**先**に置いているのはこのため |
| 移行順序の誤りで一部カラムが欠落 | P2-b が「新規作成 DB」と「旧 DB からの移行」の両方を比較するので機械的に検出できる |
| 分割（`db.ts` のファイル分割）を同時にやると原因切り分け不能 | **本フェーズでは分割しない**。マイグレーション機構のみ |

---

## Phase 3 — サーバー側ドメインの分割

### P3-a. v2 unwrap の一元化（3-3）— 先に実施（小さい・BH-9 の構造解消）

- 現状: unwrap ヘルパーが 2 実装（`hang-watchdog.ts` の `normalizeMessageList`（非配列→`null`）と
  `attention.ts` の `normalizeOcList<T>`（非配列→`[]`））で**戻り値規約が不一致**
- 作業:
  1. `unwrapOcData<T>` を 1 箇所（`oc-server.ts` 近傍）に作り、**戻り値規約を統一**（`[]` 推奨）
  2. 既存 consumer（goal-loop / workflow-scheduler / collaboration-context / memory-extract /
     task-service / attention）の呼び出しを置換
  3. **未対応の `qwen-native-vision.ts`** に適用（BH-9 で残った v1 POST 依存も併せて解消）
  4. サーバー側テストに **v2 形状のフィクスチャ**を追加（現状 v1 前提のモックのみ）
- 完了条件: `ocServer` 経由の一覧取得で `{data:[...]}` 吸収が 1 箇所に集約
- 規模: 小〜中

### P3-b. `goal-loop.ts`（1830 行）の分割（3-1）— 本フェーズの主作業

IMPROVEMENT.md が**行位置まで特定済み**なので、そのまま作業単位にできる:

| 手順 | 切り出し先 | 元の行域 | 内容 |
|------|-----------|---------:|------|
| 1 | `goal-util.ts` | 89–511 | `toPauseReason` / `isTransientOpenCodeError` / `retryTransientOpenCode` / `boundaryStartIndex` |
| 2 | `goal-prompt.ts` | 906–1110 | `buildGoalPrompt` 系 4 関数 |
| 3 | `goal-db.ts` | 524–905 | `getGoalLoop` / `createGoalLoop` / `updateGoalLoopStatus` 等 |
| 4 | `goal-state.ts` | 1112–1454 | 状態遷移・検証の純粋関数（DB 依存は注入で純化） |
| 5 | `goal-scheduler.ts` | 1491–1830 | `processLoop` / `runGoalLoopSchedulerTick` / `startGoalLoopScheduler` |

- **各手順を 1 コミット**にし、手順ごとに `typecheck` + `goal-loop.test.ts` / `goal-loop.integration.test.ts` を実行
- 手順 1〜3 は**移動のみ**（P3）。手順 4 の「DB 依存の注入による純化」だけが構造変更なので、
  移動 → 純化を**別コミット**に分ける
- 完了後: 各 300–450 行。テストを `goal-state.test.ts`（純関数）/ `goal-db.test.ts`（DB モック）へ分離
- **保留判断**: 共通 scheduler 基盤（`lib/scheduler.ts`）の抽出は、
  goal-loop と workflow の機能差が大きいため**この時点では行わない**。
  まず `goal-scheduler.ts` が `workflow-scheduler.ts` と同じ構造を踏襲する形に揃え、
  4 スケジューラ（goal / workflow / hang-watchdog / memory-auto-extract）の共通化は Phase 7 で再評価

### P3-c. `task-service.ts` の小分割（3-7）— 付随作業

- コスト推定（61–177 行）を `task-cost.ts` へ。テスト 476 行があるため低リスク

---

## Phase 4 — BFF の分割（2-1 中心）

### P4-a. プロキシ（1199 行）の分割

- 切り出し先: `web/src/lib/opencode-proxy/` 配下に 1 ファイル 1 責務
  （guard / unwrap / cache / image の各 concern）
- `route.ts` は「受付 → パイプライン適用 → upstream 転送」の薄い配線のみ
- ひな形: `web/src/lib/opencode-extensions/`（18 モジュール構成）
- **前提作業**: route テストが 133 中 72 しかないため、**分割前に対象 route の
  characterization test を追加**（P4）

### P4-b. キャッシュの LRU/TTL 化（BH-8 の構造解消）

- 現状: BH-8 対応で 64 エントリ上限の LRU 風 eviction は入ったが、**TTL は無い**
- P4-a の分割**後**に、別コミットで TTL を追加（P5）

### P4-c. キャッシュ方針のレジストリ統一（9-1）

- 4 系統（`http-cache` / `stale-cache` 14 policy / `sw.js` v6 / プロキシ内部）の
  **値の二重管理**を解消。乖離は `/api/opencode/provider` 1 件のみなので、
  作業は「値を 1 箇所に集約」が主

### P4-d. 設定レジストリ + 認可ガード（2-2 / 2-3）

- 設定同期パターン（busy 5 種 / write queue 3 箇所 / localStorage 15+ ファイル）の共通化
- 認可ガードのポリシー集約
- **規模が大きいため、P4-a〜P4-c が完了してから着手**

---

## Phase 5 — UI 層の分割

### P5-a. `useSessionStream.ts`（2311 行）の残り分割（1-2）

- **重要**: 1–797 行は既に純関数 export + `useSessionStream.test.ts`（826 行 / 51 it）で
  テスト済み。**分割対象は 798 行以降の約 1500 行**
- 切り出し: `session-sse.ts`（SSE イベント処理）/ `session-actions.ts`（送信・revert・コンパクション・resync）

### P5-b. `TaskView.tsx`（5518 行 / hooks 262）の hooks 抽出（1-1）

IMPROVEMENT.md のクラスタ分類をそのまま作業単位にする（useState 74 中 52 をカバー）:

| 順 | 抽出 hooks | state 数 | 備考 |
|----|-----------|---------:|------|
| 1 | `useTaskPanels` | 13 | 表示状態のみで副作用が少なく最も安全 |
| 2 | `useSessionPermissions` | 5 | 小さい |
| 3 | `useGoalLoop` | 7 | Phase 3 の goal-loop 分割後だと参照が安定 |
| 4 | `useAutoTask` | 7 | |
| 5 | `useTaskModelConfig` | 9 | **HomeView の同型 13 state と共通化候補**（`lib/hooks/` へ） |
| 6 | `useComposerSend` | 11 | 送信キューは事故りやすい。最後・単独 PR |

- 各 hooks は `useSessionStream` の純関数パターンを踏襲し、公開 state / ハンドラを型付け
- 完了後: TaskView 本体の state は 22 個前後

### P5-c. `SettingsView.tsx`（2312 行）のタブ分離（1-1）

- 直書き 5 タブ（`engine` / `general` / `git` / `project` / `connectivity`）を
  `*SettingsTab` コンポーネントへ切り出し、SettingsView はタブ配線のみに
- 既に独立済みのタブ（agents / providers / memory / vision）が**参考実装**

### P5-d. 同型重複の共通化（1-3 / 1-3b）

- OAuth / CLI 認証カードの共通化
- GhostSelect ラッパー 3 コンポーネント（`AccessModeSelect` 等・完全同型）

### P5-e. 複数タブ同期の BroadcastChannel 化（9-2）

- `webui:` イベント 26 個 / 17 ファイル、うちタブ跨ぎは 3 つのみ
- `recently-replied.ts` はタブ内 Map のみ → `webui-sync` チャネルへ

### Phase 5 のリスク

| リスク | 緩和 |
|--------|------|
| component テストが 20/81 欠けており、分割の破壊を検知できない | 8-3 のテスト追加を**分割の直前**に該当コンポーネントだけ実施（P4） |
| 送信キュー（`useComposerSend`）の抽出でメッセージ消失・二重送信 | 最後に単独 PR。既存 TaskView テスト（139）+ 送信系 E2E で確認 |

---

## Phase 6 — host の分割

| # | 作業 | 対象 | 備考 |
|---|------|------|------|
| P6-a | `index.js`（3071 行）の 10 グループ分割（4-1） | `host/src/` | **再起動シーケンス**（`restartingServices` boolean での直列化）を `child-manager.js` の状態機械へ |
| P6-b | `control-server.js`（929 行）のルート宣言テーブル化（4-2） | 15 ルートの if 連鎖 / `/restart/*` 2 段階解決 / `resolveSession`（365 行） | |
| P6-c | `service-status.js`（11 行）を状態の正本に（4-3） | | 小 |

- host は**テスト 395 本**があるため、分割の検証がしやすい（Phase 3〜5 より安全）
- P1-c（プロセス/パス解決の共有化）を先に済ませておくと、分割時の依存が整理済みになる

---

## Phase 7 — 仕上げ

| 分類 | 項目 |
|------|------|
| テスト補完 | 2-4（Git / メモリ系 route）、8-3（component 20 件）、8-4（E2E の CI スコープ確定）、5-2（ブラウザ拡張の Playwright 結合テスト）、3-6（`model-pricing-registry`）、1-5（`MessageTokenHighlight`） |
| 小分割 | 2-5（`handleOpenAction` 化）、7-2（CodexBarWidget 813 行）、7-1（addon スキャフォルド） |
| 型・整理 | 3-4（手書き型 → 生成型）、3-5（`any` 置換）、9-1b（localStorage キー整理） |
| ドキュメント | 8-5（docs/specs 28 本に実装ステータス）、9-3（ログ方針）、1-4（`ui.tsx` 部品規約）、6-4（scripts 前提条件） |
| 再評価 | 共通 scheduler 基盤（`lib/scheduler.ts`）の要否を Phase 3 の結果から判断 |

---

## 2. 進捗管理

- 各 Phase の完了時に IMPROVEMENT.md の該当節へ「対応済み（コミット hash）」を追記する
- 1 Phase = 複数 PR。PR タイトルに節 ID を含める（例: `refactor(6-1): sync ロジックを web 実装へ一本化`）
- 未着手のまま状況が変わった節（コードが先に変わった等）は、着手前に IMPROVEMENT.md の記述を再検証する

## 3. 決定事項（2026-08-13 確定）

| # | 事項 | 決定 | 反映先 |
|---|------|------|--------|
| **D1** | TS↔ESM の共有方式 | **`.mjs` 共有モジュール**（依存追加なし・CLI 単独実行を維持・型は `.d.ts` 手書き） | P1-b, P1-d |
| **D2** | `dataDir` 非 win32 パスの不一致 | **`~/.opencode-webui` に統一**（web が正本 / `memory-server.mjs` を変更）。win32 は変化なし | P1-d |
| **D3** | CI 復活時に露見する既存エラー | **可視化のみ**。同 PR では直さず別 PR で修正し、Phase 1 開始前に緑にする（`continue-on-error` も使わない） | Phase 0 |
| **D4** | db マイグレーション（Phase 2） | **実施する**。ただし「追加のみ / 起動時バックアップ / スキーマ一致テスト先行」の 3 条件必須 | Phase 2 |
| **D5** | 着手タイミング | **計画確定のみで一旦停止**。実装は未着手。再開時は Phase 0 から | 全体 |

### 未決（着手時に判断）

| # | 事項 |
|---|------|
| U1 | D1 の共有モジュールの置き場所（`scripts/lib/` か `shared/` か。前例は `browser-bridge/shared/*.mjs`） |
| U2 | D2 で旧パス（`~/.local/share/opencode-webui`）に既存 DB がある場合の互換読み替えの要否（非 win32 利用の実在確認が先） |
