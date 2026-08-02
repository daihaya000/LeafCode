# Workflow Graph Editor 実装計画

**仕様:** [`docs/specs/workflow-graph-editor.md`](../specs/workflow-graph-editor.md)（承認済み、`d9f30f0`）

**ゴール:** 既存3Node Workflowを無損失で維持しながら、`@xyflow/react`によるGraph表示、Graph Draft永続化、Node Registry、CAS編集、Inspector、レスポンシブUI、汎用Schedulerを段階導入する。

**技術:** Next.js 15、React 19、TypeScript、better-sqlite3、`@xyflow/react`、`@dagrejs/dagre`、Ajv 8、Vitest、Testing Library、Playwright。

## 1. コードベース調査で確定した未決事項

### 1.1 JSON Schema validator

**決定:** server-side正規validatorとして`ajv` v8を追加する。初期段階では`ajv-formats`を追加しない。

**根拠:**

- 現在の`web/src/lib/workflow.ts`は固定3Node用の手書きvalidatorで、`WorkflowNodeConfig`の既知fieldを直接検査している。
- 将来NodeをRegistry追加だけで拡張するには、Nodeごとに異なるconfig／result schemaを共通処理で検証する必要がある。
- client validationを正規ソースにするとAPI迂回が可能になるため、Ajv compile／validateはserver共有層で行う。
- clientはform表示と即時feedbackに同じJSON Schema metadataを利用できるが、保存可否はserver Ajv結果だけで決める。
- `format` keywordは初期Registryで使用せず、必要になった時点で`ajv-formats`を別途導入する。

### 1.2 Graph auto-layout

**決定:** `@dagrejs/dagre`を採用する。

**根拠:**

- 現行`web/src/lib/graph-layout.ts`はGit commit lane専用で、Workflow port、Node寸法、LR／TB切替を扱えない。
- 初期GraphはDAGにfeedback Edgeを重ねる構造であり、通常dependency／control EdgeだけをDagreへ渡し、feedback Edgeをlayout計算から除外すれば安定配置できる。
- Desktopは`rankdir: "LR"`、mobileは`rankdir: "TB"`とする。
- ELKはcompound graph等に強いが、初期上限100Nodeに対してbundle／worker／設定コストが過大である。
- 保存済みpositionを優先し、Dagreは初回合成、Node追加後の「自動整列」、viewport変更時の未配置Nodeだけに使う。

### 1.3 layout保存先

**決定:** layout／viewportの書込み正規ソースはTask単位のGraph Draftとする。Run開始時にpresentation snapshotを`definition_snapshot`へコピーするが、semantic canonical hashには含めない。専用のRun layoutテーブルは追加しない。

**根拠:**

- 現行UIはactive Workflow中心で、過去Runごとの独立layout編集機能を持たない。
- Runごとのlayoutテーブルを追加すると、同じGraphの配置更新先が増えてCASと移行が複雑になる。
- 過去Run表示の安定性は、Run snapshotへ開始時layoutを非semantic metadataとしてコピーすれば確保できる。
- Node位置、viewport、collapsedは実行hashから除外し、配置変更で実行snapshotの意味を変えない。

### 1.4 Semantic Graph編集の公開範囲

**決定:** Phase 4で編集UIとAPIを実装するが、`OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT`はPhase 5の汎用Schedulerと全品質ゲートが完了するまで既定falseとする。

初回公開で追加可能な型:

- `opencode.implement_ui`
- `opencode.code_review`
- `opencode.visual_judge`

`control.review_gate`はserver管理で`userAddable: false`を維持する。Node／Edge追加はRegistry schema、port、循環、write並列制約を満たす場合だけ許可する。固定キー分岐の現行Schedulerが動くPhase 1〜4では、semantic edit結果をactive Runへ適用しない。

### 1.5 Control Node監査記録

**決定:** 新規Runでは既存`workflow_node_runs`／`workflow_node_attempts`を再利用する。Control Node Attemptは`opencode_session_id = NULL`、`kind = "control"`として保存する。専用監査テーブルは追加しない。

**根拠:**

- `workflow_node_attempts.opencode_session_id`は既にnullableである。
- Attemptにはinput、result、hash、status、revision、started／finished時刻があり、Gate決定監査に必要な項目を保持できる。
- 専用テーブルを作るとTimeline、SSE、usage／result DTOで分岐が増える。
- 既存RunはDB backfillせず、互換adapterが合成`review_gate`を表示する。execution snapshot v2で作る新規RunだけGate Node Run／Attemptを永続化する。

## 2. 全体制約

- 各Taskは、テスト追加または失敗確認 → 最小実装 → 対象テスト → typecheck／lint → 差分確認 → 即コミットで区切る。
- `next dev`、`next start`、`next build`、`npm run build`、watch、Playwright `--debug`／`--ui`は禁止する。
- React Flow UIは既存hostへ反映された時だけ実画面確認し、エージェントが追加WebUIを起動しない。
- `WorkflowPanel.tsx`、`TaskView.tsx`、`workflow-service.ts`、`workflow-scheduler.ts`、`db.ts`は競合しやすいため、同時編集せずTask順に統合する。
- Graph Draftは実行の正規ソースにしない。Schedulerは常にRunのexecution snapshotだけを読む。
- 既存3Node API／Session／Attempt／artifact／Prompt markerを破壊しない。
- semantic mutationを自動再送しない。CAS競合はユーザーへ表示する。
- feature flag OFF時は旧`WorkflowPanel`と現行固定Schedulerへ確実に戻せる状態をPhase 5完了まで維持する。
- package追加後は`web/package-lock.json`を同じコミットへ含める。

## 3. 依存順序

```text
Phase 1 互換Graph読取
  Task 1 依存・feature flag・Graph型
    └─ Task 2 Node Registry・Ajv・Graph validator
         └─ Task 3 既存3Node互換adapter・Graph DTO
              └─ Task 4 React Flow read-only canvas

Phase 2 Graph永続化
  Task 5 DB migration・Graph repository
    └─ Task 6 Graph CAS API・layout保存

Phase 3 Inspector／TaskView連携
  Task 7 Node Inspector・Attempt情報
    ├─ Task 8 Chat／Diff／Attention共有選択
    └─ Task 9 responsive・a11y・visual verification

Phase 4 Semantic編集
  Task 10 operation validator・transaction API
    └─ Task 11 palette・Node／Edge編集UI
         └─ Task 12 execution snapshot v2・開始CAS

Phase 5 Scheduler汎用化
  Task 13 Executor Registry・control Attempt
    └─ Task 14 dependency／join／feedback Scheduler
         └─ Task 15 migration／統合E2E／flag rollout
```

---

# Phase 1: 互換Graph読取

## Task 1: 依存、feature flag、Graph基本型

**Files**

- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Modify: `web/src/lib/workflow-feature.ts`
- Modify: `web/src/lib/workflow-feature.test.ts`
- Create: `web/src/lib/workflow-graph-types.ts`
- Create: `web/src/lib/workflow-graph-feature.test.ts`

**実装**

- [ ] `npm --prefix web install @xyflow/react @dagrejs/dagre ajv`で直接依存を追加する。
- [ ] `WorkflowGraphDraft`、Graph Node／Edge、port、viewport、execution snapshot v2の型を追加する。
- [ ] Graph型はReact Flow型をexportせず、純粋なJSON DTOとする。
- [ ] `isWorkflowGraphEnabled()`と`isWorkflowGraphEditEnabled()`を追加する。
- [ ] 親`OPENCODE_WEBUI_WORKFLOW_MODE=false`時はGraph／Graph Editを必ずfalseにする。
- [ ] 初期既定はGraph=false、Graph Edit=falseとし、旧UIへrollback可能にする。

**テスト**

- [ ] flag未設定、true、false、1、0、不正値、親flag OFFを検証する。
- [ ] Graph DTOがJSON round-trip可能で、React／DOM値を含まないことを型・unit testで固定する。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-feature.test.ts src/lib/workflow-graph-feature.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-feature.ts src/lib/workflow-graph-types.ts
git diff --check
```

**完了コミット:** `Workflow Graphの依存と基本型を追加`

## Task 2: Node Registry、Ajv、Graph validator

**Files**

- Create: `web/src/lib/workflow-node-registry.ts`
- Create: `web/src/lib/workflow-node-registry.test.ts`
- Create: `web/src/lib/workflow-graph-validation.ts`
- Create: `web/src/lib/workflow-graph-validation.test.ts`
- Modify: `web/src/lib/workflow-types.ts`
- Modify: `web/src/lib/workflow.ts`
- Modify: `web/src/lib/workflow.test.ts`

**実装**

- [ ] shared metadata Registryとserver executor keyのallowlist境界を定義する。
- [ ] 初期4型を登録する。既存3型は既存default config／result parserを参照し、二重定義を避ける。
- [ ] Ajv instanceをserver共有層で1回生成し、type＋versionごとにschemaをcompile cacheする。
- [ ] `additionalProperties: false`を初期schemaで使用する。
- [ ] Graph validatorへID一意性、Registry存在、config schema、port、self-edge、dependency cycle、feedback、required input、到達性、Terminal経路、write並列、permission ceiling、size上限を実装する。
- [ ] feedback Edgeを除外したDAG検査と、許可されたGate feedback loop検査を分離する。
- [ ] errorはNode／Edge IDと安定したcodeを持つ構造化配列で返す。

**テスト**

- [ ] Registry key重複、type version不正、executor／renderer未登録を拒否する。
- [ ] config schema成功／失敗とpermission ceilingを検証する。
- [ ] 100 Node／300 Edge境界、JSON上限、position finite／範囲を検証する。
- [ ] 通常cycleを拒否し、既定Gate feedbackだけを許可する。
- [ ] 並列write Nodeを拒否する。
- [ ] 未知type／versionを`unsupported`として分類し、実行validationは失敗する。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-node-registry.test.ts src/lib/workflow-graph-validation.test.ts src/lib/workflow.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-node-registry.ts src/lib/workflow-graph-validation.ts
git diff --check
```

**完了コミット:** `Workflow Node RegistryとGraph検証を追加`

## Task 3: 既存3Node互換adapterとGraph DTO

**Files**

- Create: `web/src/lib/workflow-graph-compat.ts`
- Create: `web/src/lib/workflow-graph-compat.test.ts`
- Create: `web/src/lib/workflow-graph-layout.ts`
- Create: `web/src/lib/workflow-graph-layout.test.ts`
- Modify: `web/src/lib/workflow-service.ts`
- Modify: `web/src/lib/workflow-service.test.ts`
- Modify: `web/src/app/api/tasks/[id]/workflow/route.test.ts`

**実装**

- [ ] 既存`WorkflowDefinitionSnapshot`からstable 4Node／5Edgeの互換Graphを決定的に合成する。
- [ ] operational 3Nodeは既存`nodeKey`をGraph Node IDとして維持する。
- [ ] `review_gate`は合成Control Nodeとし、過去RunへDB rowを追加しない。
- [ ] Desktop LR／mobile TBのDagre layout helperを追加する。
- [ ] feedback EdgeをDagre入力から除外し、layout後にReact Flow adapterが描画できる形で戻す。
- [ ] `WorkflowView`へoptional `graph`、`graphSource: "compat" | "draft" | "snapshot"`を追加する。
- [ ] `GET /workflow`の既存fieldsと`workflow.nodes`を変更しない。
- [ ] semantic canonicalizationではposition、viewport、collapsed、animatedを除外する。

**テスト**

- [ ] 同じ既存Runから常に同じNode／Edge ID、順序、semantic hashを生成する。
- [ ] layout変更ではsemantic hashが変わらない。
- [ ] config、port、Edge kind変更でsemantic hashが変わる。
- [ ] 既存API fixtureが追加Graph fieldを無視して動作する。
- [ ] LR／TB layoutがfinite positionを返し、feedback Edgeを維持する。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-graph-compat.test.ts src/lib/workflow-graph-layout.test.ts src/lib/workflow-service.test.ts src/app/api/tasks/[id]/workflow/route.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-graph-compat.ts src/lib/workflow-graph-layout.ts src/lib/workflow-service.ts
git diff --check
```

**完了コミット:** `既存3Node WorkflowのGraph互換adapterを追加`

## Task 4: React Flow read-only canvas

**Files**

- Create: `web/src/components/task/workflow-graph/WorkflowGraphPanel.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowGraphCanvas.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowGraphNode.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowGraphEdge.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowGraphList.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowGraphPanel.test.tsx`
- Modify: `web/src/components/task/WorkflowPanel.tsx`
- Modify: `web/src/components/task/WorkflowPanel.test.tsx`
- Modify: `web/src/app/globals.css`

**実装**

- [ ] `WorkflowGraphCanvas`をclient-only dynamic importし、React FlowのDOM依存をSSR境界外へ置く。
- [ ] `@xyflow/react/dist/style.css`をglobal CSS import規約に沿って追加し、色・border・backgroundは既存tokenでoverrideする。
- [ ] custom Node／Edge rendererをRegistry `rendererKey`から解決する。
- [ ] Node状態、Attempt、Agent、duration、token、cost、Attentionを表示する。
- [ ] dependency、active、success、feedback、blocked Edgeを状態別に描画する。
- [ ] `Background`、`Controls`、`MiniMap`、Fit Viewを追加する。
- [ ] `prefers-reduced-motion`時はEdge animationを停止する。
- [ ] Canvasと同情報を持つNode／接続の代替一覧を追加する。
- [ ] Graph flag ON時だけ新Panelを表示し、OFF時は現行カードUIを維持する。

**テスト**

- [ ] 4Node／5Edge、Gate、feedback loopを表示する。
- [ ] active Edgeだけanimatedになる。
- [ ] reduced motionでanimationが無効になる。
- [ ] unsupported Nodeを明示し、実行操作を表示しない。
- [ ] 代替一覧からNode選択ができる。
- [ ] flag OFFで旧UIが描画される。

**検証**

```bash
npm --prefix web run test -- src/components/task/WorkflowPanel.test.tsx src/components/task/workflow-graph/WorkflowGraphPanel.test.tsx
npm --prefix web run typecheck
npm --prefix web run lint -- src/components/task/WorkflowPanel.tsx src/components/task/workflow-graph
git diff --check
```

**完了コミット:** `WorkflowをReact Flow canvasで表示`

---

# Phase 2: Graph永続化

## Task 5: DB migrationとGraph repository

**Files**

- Modify: `web/src/lib/db.ts`
- Modify: `web/src/lib/db.workflow-migration.test.ts`
- Create: `web/src/lib/workflow-graph-repository.ts`
- Create: `web/src/lib/workflow-graph-repository.test.ts`

**実装**

- [ ] `workflow_graphs`、`workflow_graph_nodes`、`workflow_graph_edges`を冪等作成する。
- [ ] WorkspaceごとのGraph Draft一意制約、FK cascade、Node／Edge graph内一意制約、revision indexを追加する。
- [ ] Graph aggregateのread、transactional insert、layout update、semantic operation用repositoryを追加する。
- [ ] Graph未作成Taskは互換adapterをreadし、初回保存時だけGraph 3テーブルへmaterializeするlazy migrationを実装する。
- [ ] 既存Runの`definition_snapshot`をmigrationで更新しない。
- [ ] viewport／presentation JSONのparse失敗時は安全な既定値へ戻し、semantic dataの破損はエラーにする。

**テスト**

- [ ] 空DB、旧Workflow DB、migration再実行で成功する。
- [ ] FK cascadeとWorkspace一意制約が機能する。
- [ ] lazy migrationが1回だけmaterializeし、ID／hashを変えない。
- [ ] Graph一括保存中の失敗でNode／Edgeが部分保存されない。

**検証**

```bash
npm --prefix web run test -- src/lib/db.workflow-migration.test.ts src/lib/workflow-graph-repository.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/db.ts src/lib/workflow-graph-repository.ts
git diff --check
```

**完了コミット:** `Workflow Graph Draftの永続化を追加`

## Task 6: Graph CAS APIとlayout保存

**Files**

- Create: `web/src/lib/workflow-graph-service.ts`
- Create: `web/src/lib/workflow-graph-service.test.ts`
- Create: `web/src/app/api/tasks/[id]/workflow/graph/route.ts`
- Create: `web/src/app/api/tasks/[id]/workflow/graph/route.test.ts`
- Modify: `web/src/lib/workflow-events.ts`
- Modify: `web/src/lib/workflow-events.test.ts`
- Modify: `web/src/app/api/tasks/[id]/workflow/events/route.ts`

**実装**

- [ ] `GET /workflow/graph`でDraftまたは互換Graphを返す。
- [ ] `PATCH /workflow/graph`へ`expectedGraphRevision`とoperation配列を必須化する。
- [ ] Phase 2では`move_nodes`、`set_viewport`、`set_collapsed`だけを許可する。
- [ ] Node移動はpointer-up時のbatch operationとして保存する。
- [ ] graph revision不一致を409で返し、最新revisionと対象Node positionを含める。
- [ ] layout conflictはclientが最新値を表示し、ユーザー操作なしに自動上書きしない。
- [ ] SSE payloadへ`graphRevision`を追加する。
- [ ] layout mutationはsemantic hashを変更しない。

**テスト**

- [ ] layout CAS成功／競合、複数Node batch、rollbackを検証する。
- [ ] position範囲、viewport zoom範囲、存在しないNodeを拒否する。
- [ ] semantic operationをPhase 2 APIが拒否する。
- [ ] SSEがRun revisionとGraph revisionを独立して通知する。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-graph-service.test.ts src/app/api/tasks/[id]/workflow/graph/route.test.ts src/lib/workflow-events.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-graph-service.ts src/app/api/tasks/[id]/workflow/graph/route.ts src/lib/workflow-events.ts
git diff --check
```

**完了コミット:** `Workflow GraphのCASとlayout保存APIを追加`

---

# Phase 3: InspectorとTaskView連携

## Task 7: Node InspectorとAttempt詳細

**Files**

- Create: `web/src/components/task/workflow-graph/WorkflowNodeInspector.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowNodeInspector.test.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowAttemptTimeline.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowAttemptTimeline.test.tsx`
- Modify: `web/src/components/task/workflow-graph/WorkflowGraphPanel.tsx`
- Modify: `web/src/lib/workflow-service.ts`
- Modify: `web/src/lib/workflow-service.test.ts`

**実装**

- [ ] 選択NodeのRegistry metadata、config、最新状態、Attempt履歴をInspectorへ表示する。
- [ ] Prompt marker／version／hash、result、finding、artifact、usage snapshot、workspace fingerprintをread-only表示する。
- [ ] OpenCode Sessionを持たないControl Nodeは監査結果を表示し、Chat操作を無効化する。
- [ ] Retry、Skip、Pauseは既存APIを再利用し、revisionを必須とする。
- [ ] Draft configとactive snapshot configの差を表示するDTOを追加する。
- [ ] secret値やraw screenshot本体をInspector DTOへ含めない。

**テスト**

- [ ] Runtime／Control／unsupported NodeのInspector状態を検証する。
- [ ] Attempt切替で過去resultとusageが表示される。
- [ ] 実行中configが編集不可である。
- [ ] Retry／SkipのCAS競合を表示する。

**検証**

```bash
npm --prefix web run test -- src/components/task/workflow-graph/WorkflowNodeInspector.test.tsx src/components/task/workflow-graph/WorkflowAttemptTimeline.test.tsx src/lib/workflow-service.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/components/task/workflow-graph src/lib/workflow-service.ts
git diff --check
```

**完了コミット:** `Workflow Node InspectorとAttempt履歴を追加`

## Task 8: Chat、Diff、AttentionのNode選択連携

**Files**

- Modify: `web/src/components/task/TaskView.tsx`
- Modify: `web/src/components/task/TaskView.test.tsx`
- Modify: `web/src/components/task/workflow-graph/WorkflowGraphPanel.tsx`
- Create: `web/src/lib/workflow-selection.ts`
- Create: `web/src/lib/workflow-selection.test.ts`
- Modify: `web/src/lib/useAttentionQueue.ts`
- Modify: `web/src/lib/attention.ts`

**実装**

- [ ] TaskViewへ`selectedWorkflowNodeId`／`selectedAttemptId`をliftする。
- [ ] Node選択後のChatタブは最新Runtime Sessionへ切り替える。primary Session自体は変更しない。
- [ ] Control Node／Session未作成NodeではChat不可理由を表示する。
- [ ] DiffタブへAttemptのstart／finish fingerprintを渡し、現在差分との違いを明示する。
- [ ] AttentionをNode IDへ集約し、対象Node選択とFit Viewを行う。
- [ ] Attentionによるauto focusは1イベント1回に限定し、その後のユーザーviewportを上書きしない。
- [ ] Task切替時にNode選択をresetし、別TaskのSession／Attemptを参照しない。

**テスト**

- [ ] Node→Chat、Node→Diff、Attention→Node focusを検証する。
- [ ] Task切替、Session遅延応答、SSE再接続でstale選択が混入しない。
- [ ] Control NodeでChatが無効になる。
- [ ] primary SessionがReviewer選択で変わらない。

**検証**

```bash
npm --prefix web run test -- src/components/task/TaskView.test.tsx src/lib/workflow-selection.test.ts src/lib/attention.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/components/task/TaskView.tsx src/lib/workflow-selection.ts src/lib/attention.ts
git diff --check
```

**完了コミット:** `Workflow Node選択をChatとDiffへ連携`

## Task 9: responsive、アクセシビリティ、実画面検証

**Files**

- Modify: `web/src/components/task/workflow-graph/WorkflowGraphPanel.tsx`
- Modify: `web/src/components/task/workflow-graph/WorkflowGraphCanvas.tsx`
- Modify: `web/src/components/task/workflow-graph/WorkflowNodeInspector.tsx`
- Modify: `web/src/components/task/workflow-graph/WorkflowGraphList.tsx`
- Create: `web/e2e/workflow-graph-responsive.spec.ts`

**実装**

- [ ] DesktopはCanvas＋320〜420px固定Inspectorにする。
- [ ] TabletはCanvas＋右Drawerにする。
- [ ] MobileはTB layout＋bottom sheetにし、controlsを44px以上にする。
- [ ] mobileのNode drag handleとCanvas pan領域を分離する。
- [ ] keyboardでNode移動、EnterでInspector、EscapeでDrawer／sheet closeを実装する。
- [ ] Node／Edge変化をlive regionへ通知する。
- [ ] Node一覧／接続一覧をCanvasの代替操作面として完成させる。
- [ ] 390、768、1280pxでページ全体のhorizontal overflowを防ぐ。

**テスト／検証**

```bash
npm --prefix web run test -- src/components/task/workflow-graph
npm --prefix web run typecheck
npm --prefix web run lint -- src/components/task/workflow-graph
npm --prefix web run e2e -- workflow-graph-responsive.spec.ts --project=chromium
```

- [ ] 既存host上で390x844、768x1024、1280x720を確認する。
- [ ] Node選択、pan、zoom、Fit View、Inspector開閉のスクリーンショットまたはsnapshot証跡を残す。
- [ ] `prefers-reduced-motion`とkeyboard-only操作を確認する。

**完了コミット:** `Workflow Graph UIをレスポンシブ対応`

---

# Phase 4: Semantic Graph編集

## Task 10: Semantic operation validatorとtransaction API

**Files**

- Modify: `web/src/lib/workflow-graph-service.ts`
- Modify: `web/src/lib/workflow-graph-service.test.ts`
- Modify: `web/src/lib/workflow-graph-repository.ts`
- Modify: `web/src/app/api/tasks/[id]/workflow/graph/route.ts`
- Modify: `web/src/app/api/tasks/[id]/workflow/graph/route.test.ts`

**実装**

- [ ] `add_node`、`remove_node`、`update_node_config`、`add_edge`、`remove_edge` operationを追加する。
- [ ] 全operationをclone Graphへ適用し、Ajv／Graph validator成功後だけtransaction commitする。
- [ ] semantic operationはGraph Edit flagと`expectedGraphRevision`を必須とする。
- [ ] active Run中の編集はDraftだけを変更し、responseへ`appliesTo: "next_run"`を返す。
- [ ] in-flight中のNode削除、active snapshot変更、Control Node削除を拒否する。
- [ ] 409 responseへ最新Graph summaryとconflicting IDsを含める。

**テスト**

- [ ] operationごとの成功／失敗、複合operation rollbackを検証する。
- [ ] Node削除時のdangling Edgeを明示削除operationなしでは拒否する。
- [ ] unknown Node、invalid config、cycle、write並列を拒否する。
- [ ] active Run snapshotがDraft編集で変化しない。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-graph-service.test.ts src/app/api/tasks/[id]/workflow/graph/route.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-graph-service.ts src/app/api/tasks/[id]/workflow/graph/route.ts
git diff --check
```

**完了コミット:** `Workflow Graphのsemantic編集APIを追加`

## Task 11: Node paletteとNode／Edge編集UI

**Files**

- Create: `web/src/components/task/workflow-graph/WorkflowNodePalette.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowNodePalette.test.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowNodeConfigForm.tsx`
- Create: `web/src/components/task/workflow-graph/WorkflowNodeConfigForm.test.tsx`
- Modify: `web/src/components/task/workflow-graph/WorkflowGraphCanvas.tsx`
- Modify: `web/src/components/task/workflow-graph/WorkflowNodeInspector.tsx`
- Modify: `web/src/components/task/workflow-graph/WorkflowGraphPanel.tsx`

**実装**

- [ ] Registry `userAddable` Nodeだけをpaletteへ表示する。
- [ ] paletteからdropした位置へNodeを追加し、Dagre自動整列を任意操作として提供する。
- [ ] Handle接続中に互換portだけを接続候補にする。
- [ ] Node／Edge削除は確認し、input focus中のDelete keyを無視する。
- [ ] JSON Schemaから初期3Node config formを生成する。複雑schema用の汎用form libraryは追加しない。
- [ ] optimistic layoutとserver確定semantic stateを分離する。
- [ ] CAS conflict時はlocal semantic operationを自動再送せず、再読込／差分確認を提示する。
- [ ] active Runとの差を`次回実行から適用`badgeで表示する。

**テスト**

- [ ] palette filter、Node drop、Edge接続、削除確認を検証する。
- [ ] 不正port、cycle、write並列のserver errorをNode／Edgeへ表示する。
- [ ] CAS conflictで自動再送しない。
- [ ] Graph Edit flag OFFで全semantic controlsが非表示になる。

**検証**

```bash
npm --prefix web run test -- src/components/task/workflow-graph/WorkflowNodePalette.test.tsx src/components/task/workflow-graph/WorkflowNodeConfigForm.test.tsx src/components/task/workflow-graph/WorkflowGraphPanel.test.tsx
npm --prefix web run typecheck
npm --prefix web run lint -- src/components/task/workflow-graph
git diff --check
```

**完了コミット:** `Workflow GraphのNodeとEdge編集UIを追加`

## Task 12: Execution snapshot v2とRun開始CAS

**Files**

- Create: `web/src/lib/workflow-execution-snapshot.ts`
- Create: `web/src/lib/workflow-execution-snapshot.test.ts`
- Modify: `web/src/lib/workflow-service.ts`
- Modify: `web/src/lib/workflow-service.test.ts`
- Modify: `web/src/lib/workflow-types.ts`
- Modify: `web/src/app/api/tasks/[id]/workflow/route.ts`
- Modify: `web/src/app/api/tasks/[id]/workflow/route.test.ts`

**実装**

- [ ] Graph DraftをRegistry解決し、permission ceiling、executor key、type versionを含むsnapshot v2へ変換する。
- [ ] semantic canonical hashとpresentation snapshotを分離する。
- [ ] Run開始transactionでWorkspace revision、Graph revision、Registry compatibility、Graph validationを再確認する。
- [ ] snapshot保存、Workflow Run、全Node Run、初期ready Attempt、Workspace mode更新をall-or-nothingにする。
- [ ] 新規v2 Runでは`review_gate` Node Runを`kind="control"`で作る。
- [ ] 既存snapshot v1のread adapterを維持する。
- [ ] active Run中のDraft更新はsnapshotへ反映しない。

**テスト**

- [ ] 同じsemantic Graphから同じhashを生成する。
- [ ] layoutだけの差でhashが変わらない。
- [ ] Graph CAS／Workspace CAS／Registry mismatchで部分Runが残らない。
- [ ] v1既存Runとv2新規Runを同じAPIで読める。
- [ ] Gate Node RunがSessionなしで作成される。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-execution-snapshot.test.ts src/lib/workflow-service.test.ts src/app/api/tasks/[id]/workflow/route.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-execution-snapshot.ts src/lib/workflow-service.ts
git diff --check
```

**完了コミット:** `Workflow Run開始時のGraph snapshotをv2化`

---

# Phase 5: Scheduler汎用化と有効化

## Task 13: Executor RegistryとControl Node Attempt

**Files**

- Create: `web/src/lib/workflow-executor-registry.ts`
- Create: `web/src/lib/workflow-executor-registry.test.ts`
- Create: `web/src/lib/workflow-control-executor.ts`
- Create: `web/src/lib/workflow-control-executor.test.ts`
- Modify: `web/src/lib/workflow-scheduler.ts`
- Modify: `web/src/lib/workflow-scheduler.test.ts`

**実装**

- [ ] 固定`nodeKey`分岐をRegistryの`executorKey`解決へ移行する。
- [ ] OpenCode Session executor interfaceをclaim、permission、Prompt、result parseまで共通化する。
- [ ] `control.review_gate` executorへ既存`evaluateReviewGate()`を移す。
- [ ] Gate入力、決定、input hash、開始／終了時刻をSessionなしAttemptへ保存する。
- [ ] 未知executor、削除済みexecutor、type version mismatchでRunをPauseする。
- [ ] v1 Runは既存adapterを介し、現行3Node意味を維持する。

**テスト**

- [ ] 3 OpenCode NodeとGate control executorを解決できる。
- [ ] Control AttemptがSessionなしで監査情報を保存する。
- [ ] 未知executorで暗黙fallbackしない。
- [ ] 既存Prompt marker、last message境界、usage snapshotを維持する。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-executor-registry.test.ts src/lib/workflow-control-executor.test.ts src/lib/workflow-scheduler.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-executor-registry.ts src/lib/workflow-control-executor.ts src/lib/workflow-scheduler.ts
git diff --check
```

**完了コミット:** `Workflow SchedulerをExecutor Registryへ移行`

## Task 14: Graph dependency、parallel join、feedback実行

**Files**

- Create: `web/src/lib/workflow-graph-runtime.ts`
- Create: `web/src/lib/workflow-graph-runtime.test.ts`
- Modify: `web/src/lib/workflow-scheduler.ts`
- Modify: `web/src/lib/workflow-scheduler.test.ts`
- Modify: `web/src/lib/workflow-prompt.ts`
- Modify: `web/src/lib/workflow-prompt.test.ts`

**実装**

- [ ] snapshot Edgeからready Nodeを決定するpure evaluatorを追加する。
- [ ] required input、並列fan-out、join、success、feedbackを評価する。
- [ ] 同一tickでready集合をsnapshotし、CAS claim後に独立dispatchする。
- [ ] write NodeはWorkspaceごとに1件だけclaimする。
- [ ] feedback通過時にcycle count／max cyclesとNode attempt上限を検査する。
- [ ] downstream Promptへport単位の検証済みresult／finding／artifactだけを渡す。
- [ ] Control Node完了後にsuccess／feedback Edgeを選択する。
- [ ] Graph Draft変更をSchedulerが参照しないことをassertする。

**テスト**

- [ ] fan-out並列、join待機、success完了、feedback再実行をpure testで検証する。
- [ ] failed／blocked／unsupported依存で安全Pauseする。
- [ ] write並列がruntimeでも発生しない。
- [ ] max cycles、Attempt上限、workspace drift、restart recoveryを維持する。
- [ ] v1固定3Node統合テストとv2 Graph統合テストを両方通す。

**検証**

```bash
npm --prefix web run test -- src/lib/workflow-graph-runtime.test.ts src/lib/workflow-scheduler.test.ts src/lib/workflow-prompt.test.ts src/lib/workflow.integration.test.ts
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-graph-runtime.ts src/lib/workflow-scheduler.ts src/lib/workflow-prompt.ts
git diff --check
```

**完了コミット:** `Workflow SchedulerをGraph実行へ対応`

## Task 15: Migration、全回帰、E2E、feature flag rollout

**Files**

- Modify: `web/src/lib/workflow.integration.test.ts`
- Create: `web/src/lib/workflow-graph.integration.test.ts`
- Create: `web/e2e/workflow-graph.spec.ts`
- Modify: `web/e2e/workflow.spec.ts`
- Modify: `web/playwright.config.ts`
- Modify: `host/src/index.js`
- Modify: `host/src/index.test.js`
- Modify: `README.md`
- Modify: `docs/specs/workflow-graph-editor.md`（実装結果との差分がある場合のみ）

**実装**

- [ ] 既存3Node Taskのlazy migration、read-only Graph、layout保存、v1 Run継続を統合検証する。
- [ ] v2 GraphでImplement→並列Reviewer→Gate→feedback→再Implement→完了を実DBで検証する。
- [ ] Browser Bridge shared tab／ownership artifactをVisual Judgeへ接続する。
- [ ] HomeView Workflow作成からCanvas表示までE2Eで検証する。
- [ ] semantic editが次回Runだけへ適用されることをE2Eで検証する。
- [ ] Graph flag OFFで旧WorkflowPanelへ戻り、実行中Runを継続できることを検証する。
- [ ] read-only Graph flagをEXE既定trueへ変更する。
- [ ] Graph Edit flagは全受入基準成功後にだけEXE既定trueへ変更する。失敗時はfalseを維持する。
- [ ] READMEへflag、移行、rollback、既存Task互換を追記する。

**全検証**

```bash
npm --prefix web run test -- src/lib/workflow src/components/task/workflow-graph src/components/task/TaskView.test.tsx src/components/home/HomeView.test.tsx
npm --prefix web run typecheck
npm --prefix web run lint -- src/lib/workflow-graph-types.ts src/lib/workflow-node-registry.ts src/lib/workflow-graph-validation.ts src/lib/workflow-graph-service.ts src/lib/workflow-executor-registry.ts src/lib/workflow-graph-runtime.ts src/components/task/workflow-graph src/components/task/TaskView.tsx
npm --prefix web run e2e -- workflow-graph.spec.ts workflow-graph-responsive.spec.ts workflow.spec.ts --project=chromium
npm --prefix host test
git diff --check
```

追加確認:

- [ ] Desktop 1280x720、tablet 768x1024、mobile 390x844で実画面確認。
- [ ] page-level horizontal overflowなし。
- [ ] keyboard-only、reduced motion、Attention focus、Drawer／bottom sheet focus returnを確認。
- [ ] 既存WorkflowのSession／Attempt／artifact／usage件数がmigration前後で一致する。
- [ ] unsupported Node、Registry version mismatch、CAS conflict、Browser Bridge未承認で安全Pauseする。
- [ ] `OPENCODE_WEBUI_WORKFLOW_GRAPH=false`で旧UIへ即時rollbackできる。

**完了コミット:** `Workflow Graph Editorを有効化`

## 4. 完了判定

全Task完了後、次を満たした場合だけGraph Editor実装完了とする。

- 仕様18章の全受入基準を満たす。
- 既存3Nodeの実DB統合E2Eと新v2 Graph統合E2Eが成功する。
- Graph Draftとactive snapshotの分離がDB・API・Scheduler testで証明される。
- Node Registry追加手順が1つのtest fixture Node追加で検証される。
- Graph Edit flag OFFでread-only canvas、Graph flag OFFで旧カードUIへ戻せる。
- 変更ファイル、migration、依存、flag、rollbackがREADMEとMEMORYへ記録される。
