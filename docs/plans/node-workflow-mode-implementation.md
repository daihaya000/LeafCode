# ノードワークフローモード実装計画

**仕様:** [`docs/specs/node-workflow-mode.md`](../specs/node-workflow-mode.md)（承認済み、`38fabc4`）

**ゴール:** 通常Taskを安全に固定3Node Workflowへ変換し、Implement UI、Code Review、Visual Judgeを独立Session・Node別設定で実行、可視化、Pause／再開／再試行できるようにする。

**初期構成:** `implement_ui → code_review / visual_judge → implement_ui` の固定フローだけを対象とする。自由DAG、React Flow、Node別worktree、複数write Nodeは実装しない。

**技術:** Next.js 15、React 19、TypeScript、better-sqlite3、OpenCode HTTP/SSE、Vitest、Testing Library、Playwright CI mode。

## 全体制約

- 各Taskは失敗テスト → 最小実装 → 対象テスト → typecheck／lint → 差分確認 → 即コミットで完結させる。
- 編集直前に対象を再読込し、他セッションの差分を混ぜない。
- 3ファイル以上・モジュール横断の実装はlead-programmerへ委任し、メインは契約・差分・検証を統合する。
- UIはdesigner仕様を正とし、実装後にtest-writerとui-ux-reviewerを通す。
- `next dev`、`next start`、watch、`next build`、`npm run build`、Playwright `--debug`／`--ui`を実行しない。
- `.bat`／`.cmd`を変更する場合はASCII、CRLF、BOMなしを維持し、`npm run test:encoding`を通す。
- Workflow実装途中はサーバー側feature flagでAPI dispatchとUIを閉じる。最終ゲート通過後に既定有効へ切り替える。
- 既存Task、Goal Loop、Attention、Diff、Graph、Terminal、archive／mergeを各段階で回帰確認する。

## 依存順序

```text
Task 1 永続化・primary Session
  ├─ Task 2 ドメイン契約・権限
  └─ Task 3 変換API・排他
       └─ Task 4 Scheduler・復旧
            ├─ Task 5 Attention・SSE
            ├─ Task 6 Workflow UI（mock DTOで先行可能）
            └─ Task 7 Visual Judge artifact
                 └─ Task 8 回帰・E2E・有効化
```

`TaskView.tsx`、`Sidebar.tsx`、`task-service.ts`、`types.ts`は競合しやすいため、同時編集せずTask順に統合する。

---

## Task 1: 永続化基盤とprimary Session固定

**Files**

- Modify: `web/src/lib/db.ts`
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/task-service.ts`
- Modify: `web/src/lib/db.test.ts`
- Modify: `web/src/lib/task-service.test.ts`
- Create: `web/src/lib/db.workflow-migration.test.ts`
- Create: `web/src/lib/workflow-feature.ts`
- Create: `web/src/lib/workflow-feature.test.ts`

**実装**

- [ ] `workspaces`へ`execution_mode`、`primary_session_id`、`revision`を冪等migrationで追加する。
- [ ] `workflow_runs`、`workflow_node_runs`、`workflow_node_attempts`、`workflow_artifacts`を作成する。
- [ ] FK、CAS revision、active Run、Node key、Attempt番号に必要なUNIQUE／indexを追加する。
- [ ] `workflow_node_attempts`へ、`pending`／`ready`／`creating_session`／`dispatching`／`running`のactive状態をNodeごとに最大1件へ制限するpartial UNIQUE indexを追加する。
- [ ] 既存Workspaceのprimaryを現行`latestBindings()`結果からbackfillする。
- [ ] 新規Task作成、通常Sessionの初回bind、Project／Workspace import復元で`primary_session_id IS NULL`なら同一transaction内にprimaryを設定するhelperを追加する。
- [ ] `TaskSummary.sessionId`を最新bindingではなく`primary_session_id`から解決する。
- [ ] Reviewer bindingの作成・touchでprimaryが変わらないDB helperを追加する。
- [ ] `TaskExecutionMode`と最小Workflow summary型を追加する。
- [ ] `isWorkflowModeEnabled()`を`OPENCODE_WEBUI_WORKFLOW_MODE`から解決し、未設定時はTask 8までfalseとする。参照箇所はこのhelperへ集約する。

**テスト**

- [ ] 空DBと旧schemaの両方でmigrationが成功する。
- [ ] migrationを複数回実行してもschema／dataが壊れない。
- [ ] primary backfillが決定的である。
- [ ] 新規Task、通常Session初回bind、import復元でprimaryが必ず初期化される。
- [ ] Reviewer binding更新後もTaskのSessionがImplementのままである。
- [ ] FK cascade、active Run制約、Nodeごとのactive Attempt一意制約が機能する。
- [ ] feature flagの未設定／true／false／不正値を決定的に解決する。

**検証**

```bash
npm --prefix web run test -- src/lib/db.test.ts src/lib/db.workflow-migration.test.ts src/lib/task-service.test.ts
npm --prefix web run typecheck
git diff --check
```

**完了コミット:** `feat: Workflow実行モデルの永続化基盤を追加`

---

## Task 2: Node契約・設定解決・権限強制

**Files**

- Create: `web/src/lib/workflow-types.ts`
- Create: `web/src/lib/workflow.ts`
- Create: `web/src/lib/workflow-permission.ts`
- Create: `web/src/lib/workflow.test.ts`
- Create: `web/src/lib/workflow-permission.test.ts`
- Modify: `web/src/lib/opencode-task-permission.ts`
- Modify: `web/src/lib/opencode-skill-permission.ts`（共通化が必要な場合のみ）

**実装**

- [ ] 固定Node／Edge definition snapshotを生成する。
- [ ] `WorkflowNodeConfig`、`ImplementResult`、`ReviewResult`、kind別`WorkflowNodeOutcome`を定義する。
- [ ] explicit／Auto／Agent固定モデル、reasoning effort、fallbackの解決順を実装する。
- [ ] unknown field、未知Node、無効severity、画像非対応Visual Judgeを拒否する。
- [ ] Attempt開始時にresolved設定を不変snapshotとして保存する。
- [ ] Session作成後・最初のprompt前にsession-scoped permissionを適用する。
- [ ] Reviewerではedit／write／patch／Git mutation／bash／shell／terminal／taskをdenyする。
- [ ] `browser=false`ではOpenCodeのsession ruleで`browser_*`をdenyする。
- [ ] Node設定から上位Agent／共通policyを緩和できないようにする。
- [ ] Gate真理値、required override、optional skip、finding重複排除を純粋関数化する。

**テスト**

- [ ] 設定優先順位とresolved snapshot。
- [ ] Agent固定モデルと`ignored_by_agent`。
- [ ] Reviewer permission PATCHがpromptより先に実行される。
- [ ] shell／task／browser経由の迂回権限がdenyされる。
- [ ] Implement／Reviewの構造化結果validation。
- [ ] required／optional Gate全組合せ。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow.test.ts src/lib/workflow-permission.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-types.ts src/lib/workflow.ts src/lib/workflow-permission.ts
git diff --check
```

**完了コミット:** `feat: Workflow Node契約と権限制御を追加`

---

## Task 3: 通常Task変換APIと既存操作の排他

**Files**

- Create: `web/src/app/api/tasks/[id]/workflow/route.ts`
- Create: `web/src/app/api/tasks/[id]/workflow/route.test.ts`
- Create: `web/src/app/api/tasks/[id]/workflow/nodes/[nodeKey]/route.ts`
- Create: `web/src/app/api/tasks/[id]/workflow/nodes/[nodeKey]/route.test.ts`
- Create: `web/src/app/api/tasks/[id]/workflow/nodes/[nodeKey]/retry/route.ts`
- Create: `web/src/app/api/tasks/[id]/workflow/nodes/[nodeKey]/skip/route.ts`
- Modify: `web/src/app/api/tasks/[id]/route.ts`
- Modify: `web/src/app/api/tasks/[id]/goal-loop/route.ts`
- Modify: `web/src/lib/workflow.ts`
- Modify: `web/src/lib/workspace-service.ts`
- Modify: `web/src/app/api/tasks/[id]/archive/route.ts`
- Modify: `web/src/app/api/tasks/[id]/archive/route.test.ts`
- Modify: `web/src/app/api/tasks/[id]/route.ts`（delete／cleanup）
- Modify: `web/src/app/api/tasks/[id]/route.test.ts`
- Modify: `web/src/app/api/git/merge/route.ts`
- Modify: `web/src/app/api/git/merge/route.test.ts`
- Modify: restore／workspace cleanup関連test（排他条件を共有する場合のみ）

**実装**

- [ ] `GET /api/tasks/:id/workflow`でRun、Node、Attempt、Attention要約を返す。
- [ ] `POST`で通常Taskを`draft` Workflowへ変換する。
- [ ] `PATCH`でstart／pause／resume／stop／detach／reattach／override_gateを処理する。
- [ ] Node設定、Retry、optional Skip APIを実装する。
- [ ] `workspaceRevision`、`workflowRevision`、`nodeRevision`、`attemptRevision`を操作別に検証する。
- [ ] 409へ最新Workflow DTOを含める。
- [ ] 通常→Workflow変換を単一transactionにし、既存SessionをImplementへ紐付ける。
- [ ] Workflow→通常で選択Sessionをprimaryへ設定し、Runを`detached`にする。
- [ ] Workflow中のGoal Loop create／resumeを409で拒否する。
- [ ] active Workflow中のarchive／delete／merge／cleanupを拒否する。
- [ ] feature flag無効時は新規変換、start、resume、retry、reattach、dispatchを閉じる。既存RunのGET、scheduler安全Pause、stop、detach、Attention解決はロールバック経路として許可する。

**テスト**

- [ ] standard→workflow→standard→reattach。
- [ ] 変換失敗時にstandardのままで部分Runがrunnableにならない。
- [ ] primaryと全Session履歴を保持する。
- [ ] 各revision競合が409になる。
- [ ] Goal Loop、archive、delete、mergeとの相互排他。
- [ ] flag無効時に新規実行へ進まず、既存RunのGET／safe Pause／stop／detach／Attention解決だけが成功する。

**検証**

```bash
npm --prefix web run test -- "src/app/api/tasks/[id]/workflow/route.test.ts" "src/app/api/tasks/[id]/workflow/nodes/[nodeKey]/route.test.ts"
npm --prefix web run test -- "src/app/api/tasks/[id]/goal-loop/route.test.ts" "src/app/api/tasks/[id]/archive/route.test.ts" "src/app/api/tasks/[id]/route.test.ts"
npm --prefix web run test -- "src/app/api/git/merge/route.test.ts" src/lib/workspace-service.test.ts
npm --prefix web run typecheck
git diff --check
```

**完了コミット:** `feat: 通常Taskを固定Workflowへ変換可能にする`

---

## Task 4: Workflow Scheduler・非冪等安全性・再起動復旧

**Files**

- Create: `web/src/lib/workflow-scheduler.ts`
- Create: `web/src/lib/workflow-git.ts`
- Create: `web/src/lib/workflow-scheduler.test.ts`
- Create: `web/src/lib/workflow.integration.test.ts`
- Modify: `web/src/lib/workflow.ts`
- Modify: `web/src/instrumentation.ts`

**実装**

- [ ] `startWorkflowScheduler()`と重複起動guardを追加する。
- [ ] `ready` Attemptをrevision CASで個別claimする。
- [ ] Implement完了後、2 Reviewerを同時に`ready`化し、独立claimする。
- [ ] 一方のReviewer失敗で他方の結果を破棄しない。
- [ ] 両Reviewer終端後だけGateを評価する。
- [ ] blocking findingを集約し、同じImplement Sessionへ新Attemptを送る。
- [ ] 修正cycle既定3、Implement attempt既定10で安全Pauseする。
- [ ] Session作成前にmarkerをDBとtitleへ保存する。
- [ ] `creating_session`復旧時はdirectory／時刻／title markerで1件だけ照合する。
- [ ] 0件／複数件では自動作成せずPauseし、手動attach／孤立Session整理を待つ。
- [ ] prompt送達不明、408／409／429、timeout、5xxで自動再送しない。
- [ ] responseは`last_message_id`より後だけを読む。
- [ ] feature flag OFF時は新規dispatchを止め、非終端Runを`feature_disabled`でPauseする。
- [ ] Attempt完了時に対象Sessionと子Sessionのtoken、cost、durationをsnapshotし、Workflow合計を二重計上なしで集約する。

**Workspace drift**

- [ ] HEAD、tracked diff raw bytes、untracked path＋content hashからfingerprintを算出する。
- [ ] ignored fileを除外し、改行を正規化しない。
- [ ] Implement終了値を`review_subject`に固定する。
- [ ] Reviewer開始前、両Reviewer終了時、修正再投入前に同一subjectを検証する。
- [ ] drift時は`workspace_drift`でPauseする。

**テスト**

- [ ] 同時tickで二重dispatchしない。
- [ ] Session作成timeout／再起動で重複Sessionを作らない。
- [ ] prompt送達不明で重複送信しない。
- [ ] Reviewer部分成功を保持する。
- [ ] progress／completed／blocked、attempt／cycle上限。
- [ ] tracked／untracked／ignored／改行差分のfingerprint。
- [ ] 外部変更とImplement自身の正当な変更を区別する。
- [ ] Node／子Sessionのtoken、cost、durationを二重計上せず集約する。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-scheduler.test.ts src/lib/workflow.integration.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-scheduler.ts src/lib/workflow-git.ts
git diff --check
```

**完了コミット:** `feat: 固定Workflow Schedulerを実装`

---

## Task 5: 手動送信・Attention・Workflow SSE

**Files**

- Create: `web/src/app/api/tasks/[id]/workflow/events/route.ts`
- Create: `web/src/app/api/tasks/[id]/workflow/events/route.test.ts`
- Create: `web/src/lib/workflow-events.ts`
- Create: `web/src/lib/workflow-events.test.ts`
- Modify: `web/src/app/api/opencode/[...path]/route.ts`
- Modify: `web/src/lib/attention.ts`
- Modify: `web/src/components/shell/GlobalAttentionProvider.tsx`
- Modify: `web/src/lib/task-service.ts`
- Modify: `web/src/lib/types.ts`
- Modify: 関連tests

**実装**

- [ ] Workflow revision、Node状態、進捗をnamed SSE eventで配信する。
- [ ] heartbeat、接続stall、silence時REST fallbackを既存方針に合わせる。
- [ ] Attempt Session IDからNode／Taskへpermission／questionを集約する。
- [ ] child Session Attentionを親Implement Nodeへ集約する。
- [ ] `sessionID + requestID`でSSE／REST重複を除去する。
- [ ] Attention待ちはAttempt状態にせず、running Attemptの派生状態とする。
- [ ] Workflow管理Sessionへの手動prompt／commandをproxyで検出する。
- [ ] 手動送信を409で拒否し、CASで`manual_send` Pauseする。
- [ ] `TaskSummary.workflow`へ状態、完了数、active Node、集約Attention、token／cost／duration合計を追加する。

**テスト**

- [ ] SSE heartbeat、reconnect、REST fallback。
- [ ] Node／child Session Attention集約。
- [ ] SSE／REST重複排除。
- [ ] 手動prompt／command拒否とPause。
- [ ] 通常TaskとGoal Loopの既存proxy hook回帰。

**検証**

```bash
npm --prefix web run test -- src/lib/attention src/lib/workflow-events
npm --prefix web run test -- src/components/shell/GlobalAttentionProvider.test.tsx
npm --prefix web run typecheck
git diff --check
```

**完了コミット:** `feat: WorkflowのAttentionと状態配信を統合`

---

## Task 6: Workflow UI・TaskView・Sidebar統合

**事前ゲート:** ui-ux-designerが承認済み仕様と現行DESIGN tokenに沿う詳細UI handoffを確認する。

**Files**

- Create: `web/src/components/task/WorkflowPanel.tsx`
- Create: `web/src/components/task/WorkflowPanel.test.tsx`
- Create: `web/src/components/task/WorkflowNodeCard.tsx`
- Create: `web/src/components/task/WorkflowNodeCard.test.tsx`
- Create: `web/src/components/task/WorkflowNodeDetail.tsx`
- Create: `web/src/components/task/WorkflowNodeDetail.test.tsx`
- Create: `web/src/components/task/WorkflowConvertDialog.tsx`
- Create: `web/src/components/task/WorkflowConvertDialog.test.tsx`
- Create: `web/src/lib/useWorkflow.ts`
- Create: `web/src/lib/workflow-view-state.ts`
- Create: `web/src/lib/workflow-view-state.test.ts`
- Modify: `web/src/components/task/TaskView.tsx`
- Modify: `web/src/components/task/TaskView.test.tsx`
- Modify: `web/src/components/shell/Sidebar.tsx`
- Modify: `web/src/components/shell/Sidebar.test.tsx`
- Modify: `web/src/components/ui.tsx`（既存primitiveで不足する場合のみ）

**実装**

- [ ] Workflow Taskだけに`Chat / Workflow / Diff` tablistを表示する。
- [ ] Chatは選択Node Sessionを表示し、複数Node会話を混在させない。
- [ ] 固定CSS Grid＋SVG接続線で3Nodeフローを表示する。
- [ ] 視覚グラフと同内容の構造化step listを提供する。
- [ ] Nodeカードへ状態、Attention、処理要約、finding、token、時間、Diff、model、Attemptを表示する。
- [ ] Node詳細へAgent、model、effort、permission、指示、Attempt履歴、evidence、token／cost／durationを表示する。
- [ ] Node Attentionから既存GlobalAttentionProviderの回答／承認UIを開き、解決後に元Nodeへfocusを戻す。
- [ ] 実行済み設定の編集は`次回試行から適用`と明示する。
- [ ] Convert／detach／Retry／Skip／required override／Stopへ確認dialogを付ける。
- [ ] SidebarはProject→Taskを維持し、Node／Sessionを常設しない。
- [ ] Task行へWorkflow種別、進捗、active Node、集約Attentionを追加する。
- [ ] `workflow-view-state.ts`で前回のChat／Workflow／Diff表示とNode選択をTask ID単位に保存・復元し、別Taskへ漏らさない。
- [ ] feature flag無効時はstandard TaskのWorkflow CTAを隠す。既存Workflow Taskでは履歴、Attention、Stop、detachだけを使えるrecovery viewを表示する。

**Responsive／a11y**

- [ ] Desktopはフロー＋右詳細、tabletは開閉右パネル、mobileは縦step＋Drawer／Sheetにする。
- [ ] mobileで横グラフ操作を必須にしない。
- [ ] composer画面へfixed pluginを追加しない。
- [ ] tablist／tab／tabpanel semanticsを実装する。
- [ ] NodeはEnter／Space、roving tabindexのArrow／Home／Endに対応する。
- [ ] Drawer／DialogでEscape、focus trap、起点focus復帰を保証する。
- [ ] 状態を色だけで表さない。
- [ ] `aria-live=polite`は開始／Pause／Attention／失敗／完了だけ、mutation失敗はassertiveにする。
- [ ] 色、spacing、角丸は既存CSS変数／DESIGN tokenを使用し、ハードコード色を追加しない。

**テスト**

- [ ] standard Taskの表示回帰。
- [ ] 3 tab、Node Session切替、Node詳細、Attempt履歴。
- [ ] loading／draft／running／parallel／attention／paused／failed／completed。
- [ ] 確認dialog、keyboard、focus復帰。
- [ ] desktop／tablet／mobile viewport。

**検証**

```bash
npm --prefix web run test -- src/components/task/WorkflowPanel.test.tsx src/components/task/WorkflowNodeCard.test.tsx src/components/task/WorkflowNodeDetail.test.tsx src/components/task/WorkflowConvertDialog.test.tsx
npm --prefix web run test -- src/components/task/TaskView.test.tsx src/components/shell/Sidebar.test.tsx src/lib/workflow-view-state.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/components/task src/components/shell/Sidebar.tsx
git diff --check
```

**完了コミット:** `feat: TaskにWorkflow画面とNode詳細を追加`

---

## Task 7: Visual Judge artifactとBrowser Bridge連携

**Files**

- Create: `web/src/lib/workflow-artifacts.ts`
- Create: `web/src/lib/workflow-artifacts.test.ts`
- Modify: `web/src/lib/workflow.ts`
- Modify: `web/src/lib/workflow-scheduler.ts`
- Modify: Browser Bridge client／host API（既存契約で不足する場合のみ）
- Modify: `web/src/components/task/WorkflowNodeDetail.tsx`
- Create／Modify: integration tests

**実装**

- [ ] Task添付画像、承認済み共有タブscreenshot、明示画像をVisual Judge入力に限定する。
- [ ] screenshot本体、base64、DOM本文、入力値をWorkflow DB／監査ログへ保存しない。
- [ ] artifactにはopaque reference、origin metadata、期限だけを保存する。
- [ ] `APPROVAL_REQUIRED`を派生Attentionへ写像する。
- [ ] denied／unavailable／not paired／tab not shared／policy blocked／timeoutを`blocked`＋Pauseへ写像する。
- [ ] stale referenceはsnapshot再取得を1回だけ試し、再失敗でPauseする。
- [ ] payload too large／invalid requestをfailed、protocol mismatchをblockedへ写像する。
- [ ] required Visual Judgeは画像不足で自動pass／skipしない。
- [ ] optionalだけを明示skip可能にする。

**テスト**

- [ ] Browser Bridge全stable error codeの写像。
- [ ] approval回答後のrunning継続。
- [ ] screenshot／DOM／入力値の非永続化。
- [ ] required Node false pass防止。
- [ ] optional skipとrequired override監査。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-artifacts.test.ts src/lib/workflow-scheduler.test.ts
npm --prefix browser-bridge test
npm --prefix web run typecheck
git diff --check
```

**完了コミット:** `feat: Visual Judgeへ安全な画像入力を追加`

---

## Task 8: 全回帰・E2E・feature flag有効化

**事前ゲート:** test-writerが回帰マトリクスを補完し、ui-ux-reviewerが3 viewport、keyboard、状態網羅を確認する。

**Files**

- Create: `web/e2e/workflow.spec.ts`
- Modify: TaskView／Sidebar／Goal Loop／Attention／workspace／proxyの既存tests
- Modify: `web/src/lib/workflow-feature.ts`
- Modify: `web/src/lib/workflow-feature.test.ts`
- Modify: README／docs（`OPENCODE_WEBUI_WORKFLOW_MODE` overrideの説明）

**E2E**

- [ ] 通常Task作成、Chat、Diff、NestedAgent、Goal Loop、Terminalの回帰。
- [ ] 通常→Workflow変換。
- [ ] Implement→並列Reviewer→修正→Implement→完了。
- [ ] Pause／resume／stop／retry／optional skip／required override。
- [ ] detach／reattachとprimary Session保持。
- [ ] Attention回答、manual send拒否、Goal Loop排他。
- [ ] Session作成timeout、prompt送達不明、再起動復旧、drift。
- [ ] Reviewer permission deny。
- [ ] desktop／tablet／mobileとkeyboard操作。

**最終検証**

```bash
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run test
npm --prefix web run e2e
# .bat/.cmdを変更した場合のみ
npm run test:encoding
git diff --check
git status --short
```

既存hostが起動中の場合だけ、短い`/api/health`確認を追加する。本番buildはユーザーへ委ねる。

**有効化条件**

- [ ] 全受入条件と回帰テストがgreen。
- [ ] ui-ux-reviewerにBlocker／Majorなし。
- [ ] non-idempotent dispatch、Session作成、driftの安全テストがgreen。
- [ ] feature flag OFF時の既存UI回帰がgreen。
- [ ] `DEFAULT_WORKFLOW_MODE_ENABLED`をtrueへ変更し、環境変数falseで即時無効化できる。
- [ ] 既定ONへ変更後もstandard Task回帰がgreen。

**ロールバック**

1. feature flagをOFFにする。
2. 新規dispatchを停止する。
3. 非終端Workflowを`feature_disabled`でPauseする。
4. 必要なTaskをprimary Implement Sessionへdetachする。
5. DB tableと履歴は削除しない。

**完了コミット:** `test: Workflowモードの回帰範囲を固定`

## 完了定義

- 仕様書の受入条件16項目が自動テストまたは明示的な手動検証へ対応している。
- 各Taskが独立コミットで、コミット直後に`git log --oneline -1`で反映確認されている。
- 最終`git status --short`が空である。
- MEMORY.mdへ実装判断と教訓をローカル追記し、Gitへ追加しない。
