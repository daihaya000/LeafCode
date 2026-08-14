# Workflow Graph Editor 仕様

> 実装ステータス: ✅ 実装済み（参照: `web/src/lib/workflow-graph-react-flow.ts` / `workflow-graph-react-flow.test.ts`）

## 1. 文書の位置付け

本仕様は、既存の `docs/specs/node-workflow-mode.md` に定義されたWorkflow実行基盤へ、`@xyflow/react`を用いたノードベースUIと将来のNode追加機構を導入するための追加仕様である。

競合時の優先順位は次のとおりとする。

1. 本仕様のGraphデータモデル、Node Registry、編集制約、React Flow UI
2. `node-workflow-mode.md`の実行安全性、Session権限、Attempt、Prompt、Attention、artifact契約
3. 既存実装の互換動作

本仕様は既存3Node Workflowを破棄しない。初期移行では、既存の`implement_ui`、`code_review`、`visual_judge`を同じ意味・Session・Attempt履歴のままGraphへ投影する。

## 2. 背景

現行Workflow UIは、固定3Nodeの状態をカード一覧として表示する。実行基盤はCAS、Attempt、Prompt marker、workspace drift、Browser Bridge artifact、Gate差し戻しを備えるが、UIは空間的なNode／Edge表現ではなく、将来Nodeを追加するための編集モデルも持たない。

参照UIのようなノードキャンバスへ近づけつつ、自由編集がSchedulerの安全性を損なわないように、次を分離する必要がある。

- 編集可能なGraph draft
- 実行開始時に固定されるGraph snapshot
- 実行中のNode Run／Attempt
- React Flow固有の表示状態
- サーバーが許可するNode型とExecutor

## 3. 目的

1. Workflowタブを`@xyflow/react`ベースのNode／Edgeキャンバスへ変更する。
2. 既存3Node WorkflowとDB履歴を無損失で表示・実行する。
3. Node Registryへの定義追加だけで、将来のNode型を安全に拡張できるようにする。
4. 編集可能Graphと実行snapshotを分離し、実行中の意味変更や再起動時の解釈ずれを防ぐ。
5. Graph全体のCAS、Node設定のversion、Registry互換性を永続化する。
6. Desktop、tablet、mobileでNode、Attention、Inspector、Chat／Diff連携を利用可能にする。
7. 未知Node、不正Edge、権限昇格、暗黙の循環、複数書込みNode並列実行を安全側で拒否する。

## 4. 非目的

初回リリースでは次を対象外とする。

- ユーザーコード、任意JavaScript、任意shellをExecutorとして登録すること
- Registryに存在しないNodeをplaceholderのまま実行すること
- 複数の書込みNodeを同一Workspaceで並列実行すること
- 任意条件式言語、式評価エンジン、ユーザー定義スクリプト
- Marketplaceから未署名Node定義を導入すること
- 実行中snapshotのNode／Edgeを直接書き換えること
- React Flowの表示データを実行状態の正規ソースにすること

将来のNode追加を担保するが、初回UIで公開する追加操作はRegistryで`userAddable: true`かつ安全性が検証済みのNodeに限定する。

## 5. 用語

- **Graph Draft**: Taskに紐付く編集可能なWorkflow定義。次回Runの入力となる。
- **Graph Snapshot**: Run開始時にGraph Draftをcanonical化して保存した不変定義。
- **Graph Node**: Node型、設定、port、配置を持つ定義要素。
- **Graph Edge**: source／target port、Edge種別、制御意味を持つ定義要素。
- **Runtime Node**: OpenCode Sessionまたはserver-side Executorを持つ実行Node。
- **Control Node**: Gate、Join、Terminal等、通常はOpenCode Sessionを持たないNode。
- **Node Registry**: 利用可能なNode型、version、schema、権限上限、Executor、UI rendererの正規一覧。
- **Presentation State**: Node位置、viewport、選択状態等、実行意味を変えない表示情報。

## 6. 既存3Nodeとの互換性

### 6.1 互換対象

既存キーをstable IDとして維持する。

| 既存Node key | Registry type | Runtime | 互換方針 |
| --- | --- | --- | --- |
| `implement_ui` | `opencode.implement_ui` | OpenCode Session | primary Sessionと全Attemptを維持 |
| `code_review` | `opencode.code_review` | OpenCode Session | Reviewer Sessionとfindingを維持 |
| `visual_judge` | `opencode.visual_judge` | OpenCode Session | artifact／Browser Bridge契約を維持 |

既存の`evaluateReviewGate()`は`control.review_gate`のserver-side ExecutorとしてRegistryへ公開する。初回移行ではGateをGraph上に表示しても、過去Runへ新しいOpenCode Sessionや`workflow_node_run`を作らない。

### 6.2 既存Graphの合成

Graph Draftが存在しない既存Workflowは、次の互換Graphを決定的に合成する。

```text
implement_ui ──┬──> code_review ───┐
               │                   ├──> review_gate ──> completed
               └──> visual_judge ──┘         │
                                              └── feedback ──> implement_ui
```

既定位置:

```ts
{
  implement_ui: { x: 0, y: 180 },
  code_review: { x: 360, y: 40 },
  visual_judge: { x: 360, y: 320 },
  review_gate: { x: 720, y: 180 }
}
```

合成結果は同じ入力に対して同じNode ID、Edge ID、順序、hashを返す。初回保存時にGraph Draftへ昇格する。

### 6.3 API互換

- 既存の`GET /api/tasks/:id/workflow`は既存フィールドを削除しない。
- `workflow.nodes`は当面、既存3 Runtime Nodeを返し続ける。
- Graphは`workflow.graph`として追加する。
- `review_gate`はGraphには含めるが、Runtime Node一覧には必須としない。
- 既存Retry、Skip、Pause、Resume、artifact APIはNode stable IDを引き続き受け付ける。
- Graph Editor導入前のクライアントはGraph追加フィールドを無視して動作できる。

## 7. Graphデータモデル

### 7.1 論理モデル

```ts
type WorkflowGraphDraft = {
  id: string;
  workspaceId: string;
  schemaVersion: "workflow-graph-v1";
  graphRevision: number;
  registryVersion: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  viewport?: WorkflowViewport;
  createdAt: string;
  updatedAt: string;
};

type WorkflowGraphNode = {
  id: string;
  type: string;
  typeVersion: number;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  disabled: boolean;
  presentation?: {
    width?: number;
    collapsed?: boolean;
  };
};

type WorkflowGraphEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  kind: "dependency" | "success" | "feedback" | "control";
  label?: string;
  animated?: boolean;
};

type WorkflowViewport = {
  x: number;
  y: number;
  zoom: number;
};
```

React Flowの`Node`／`Edge`型は表示adapterであり、DB DTOには直接保存しない。`selected`、`dragging`、DOM measurement等の一時状態を永続化しない。

### 7.2 永続化

次のテーブルを追加する。

#### `workflow_graphs`

| column | type | 制約 |
| --- | --- | --- |
| `id` | TEXT | PK |
| `workspace_id` | TEXT | FK、Taskごとにactive draftは1件 |
| `schema_version` | TEXT | NOT NULL |
| `registry_version` | TEXT | NOT NULL |
| `graph_revision` | INTEGER | NOT NULL、CAS対象 |
| `viewport` | TEXT JSON | nullable |
| `created_at` | TEXT | NOT NULL |
| `updated_at` | TEXT | NOT NULL |

#### `workflow_graph_nodes`

| column | type | 制約 |
| --- | --- | --- |
| `id` | TEXT | PK、Graph内stable ID |
| `graph_id` | TEXT | FK |
| `node_type` | TEXT | NOT NULL |
| `node_type_version` | INTEGER | NOT NULL |
| `label` | TEXT | NOT NULL |
| `position_x`／`position_y` | REAL | finiteのみ |
| `config` | TEXT JSON | schema検証必須 |
| `disabled` | INTEGER | 0／1 |
| `presentation` | TEXT JSON | サイズ上限あり |
| `node_revision` | INTEGER | NOT NULL、個別CAS補助 |

#### `workflow_graph_edges`

| column | type | 制約 |
| --- | --- | --- |
| `id` | TEXT | PK |
| `graph_id` | TEXT | FK |
| `source_node_id`／`target_node_id` | TEXT | FK |
| `source_handle`／`target_handle` | TEXT | Registry portと一致 |
| `kind` | TEXT | allowlist |
| `label` | TEXT | nullable、長さ上限あり |
| `edge_revision` | INTEGER | NOT NULL |

### 7.3 実行snapshot

`workflow_runs.definition_snapshot`をGraph snapshotの正規保存先として拡張する。

```ts
type WorkflowExecutionSnapshot = {
  schemaVersion: "workflow-execution-v2";
  graphSchemaVersion: "workflow-graph-v1";
  registryVersion: string;
  sourceGraphId: string;
  sourceGraphRevision: number;
  nodes: Array<{
    id: string;
    type: string;
    typeVersion: number;
    config: Record<string, unknown>;
    resolvedPermissions: PermissionSnapshot;
    resolvedExecutor: string;
  }>;
  edges: WorkflowGraphEdge[];
  canonicalHash: string;
};
```

position、viewport、collapsed等のPresentation Stateは実行hashへ含めない。Node型、version、config、port、Edge意味、権限、Executorは含める。

## 8. Node Registry

### 8.1 Registry契約

Node Registryはclient componentだけで完結させず、共有metadataとserver executorを分離する。

```ts
type WorkflowNodeDefinition = {
  type: string;
  version: number;
  displayName: string;
  description: string;
  category: "implementation" | "review" | "control" | "test" | "approval";
  runtime: "opencode_session" | "server_control";
  userAddable: boolean;
  inputs: WorkflowPortDefinition[];
  outputs: WorkflowPortDefinition[];
  configSchema: JsonSchema;
  resultSchema: JsonSchema;
  permissionCeiling: {
    write: boolean;
    subagent: boolean;
    browser: boolean;
  };
  executorKey: string;
  rendererKey: string;
};
```

- `type + version`は不変識別子とする。
- schemaまたは実行意味を破壊的変更する場合は`version`を増やす。
- label、説明、見た目だけの変更ではversionを増やさない。
- clientは`rendererKey`を既知componentへmapする。
- serverは`executorKey`をimport済みallowlistへmapする。
- DBやAPIからモジュールpath、コード、任意関数を受け取らない。

### 8.2 初期Registry

| type | version | runtime | userAddable | write ceiling |
| --- | ---: | --- | --- | --- |
| `opencode.implement_ui` | 1 | `opencode_session` | true | true |
| `opencode.code_review` | 1 | `opencode_session` | true | false |
| `opencode.visual_judge` | 1 | `opencode_session` | true | false |
| `control.review_gate` | 1 | `server_control` | false | false |

初回公開では既存テンプレートのNode削除・Edge変更は高度な編集モードに置き、既定UIでは配置変更と設定閲覧を中心にする。

### 8.3 将来Node追加

新Node型の追加には次を必須とする。

1. Registry metadata
2. config／result schema
3. server executorまたはOpenCode Session adapter
4. permission ceiling
5. React Flow renderer
6. Prompt builderまたはcontrol evaluator
7. migration方針
8. unit test、Graph validation test、統合test

未知のNode型または未対応versionを含むGraphは閲覧可能な`unsupported`Nodeとして表示できるが、Run開始、Resume、Retryを拒否する。

## 9. Graph検証

Graph保存時とRun開始時の両方で検証する。

1. Node ID、Edge IDはGraph内で一意。
2. 全Node型／versionがRegistryに存在する。
3. configがNodeのschemaに適合する。
4. source／target Nodeとhandleが存在する。
5. portのデータ種別と多重接続制約が一致する。
6. self-edgeを拒否する。
7. 通常dependency Edgeによる循環を拒否する。
8. 循環はRegistryが許可する`feedback` EdgeとGate／Loop control Nodeの組合せに限定する。
9. required inputが未接続のNodeを拒否する。
10. 到達不能Nodeをwarningまたは設定によりerrorとする。
11. Terminalへの経路がないGraphを拒否する。
12. 同一並列区間にwrite可能Nodeが2つ以上存在するGraphを拒否する。
13. permission ceilingを超えるconfigを拒否する。
14. Node数、Edge数、config JSONサイズに上限を設ける。

初期上限:

- Node: 100
- Edge: 300
- Node config: 64 KiB
- Graph全体JSON: 2 MiB
- zoom: 0.25〜2.0
- position: 各軸`-100000`〜`100000`

## 10. CASと編集API

### 10.1 Graph CAS

全semantic mutationは`expectedGraphRevision`を必須とする。

```http
PATCH /api/tasks/:id/workflow/graph
{
  "expectedGraphRevision": 12,
  "operations": [
    { "op": "update_node_config", "nodeId": "code_review", "config": {} },
    { "op": "add_edge", "edge": {} }
  ]
}
```

- 全operationsを1 transactionで検証・適用する。
- 1件でも失敗した場合は全体をrollbackする。
- revision不一致は`409`と最新Graph summaryを返す。
- clientは自動でsemantic mutationを再送しない。
- layout保存だけは最新positionを再取得し、Node単位CASでユーザーへ再適用を提案できる。

### 10.2 操作分類

| 操作 | 実行中 | paused | 終端／未実行 |
| --- | --- | --- | --- |
| Node移動、viewport、collapse | 許可 | 許可 | 許可 |
| label等のpresentation変更 | 許可 | 許可 | 許可 |
| Node config変更 | 次回Run用Draftのみ許可 | 次回Run用Draftのみ許可 | 許可 |
| Node追加・削除 | Draftのみ。active Runへ不適用 | in-flightなしで許可 | 許可 |
| Edge追加・削除 | Draftのみ。active Runへ不適用 | in-flightなしで許可 | 許可 |
| 実行snapshot変更 | 禁止 | 禁止 | 禁止 |

編集後のDraftがactive Runと異なる場合、UIへ`次回実行から適用`を表示する。

### 10.3 Run開始CAS

Run開始は次を同一transactionで行う。

1. Workspace revision確認
2. Graph revision確認
3. Registry compatibility確認
4. Graph validation
5. canonical snapshot生成
6. snapshot hash保存
7. Workflow RunとNode Run作成
8. Workspace execution mode更新

途中失敗時に実行可能な部分Runを残さない。

## 11. 実行制約

- SchedulerはGraph Draftを参照せず、RunのGraph snapshotだけを読む。
- Run開始後にRegistryが更新されても、snapshotのtype／version／executor意味を維持する。
- 対応executorが削除された場合は安全側でPauseし、migrationなしに別executorへ置換しない。
- Nodeは依存inputが終端かつGate条件を満たした場合だけ`ready`になる。
- 並列Nodeは同tickのready snapshotからclaimできる。
- write ceilingがtrueのNodeでも、同一Workspaceでwrite Nodeは同時に1件だけ実行する。
- Control NodeはOpenCode Sessionを作成せず、決定と入力hashをAttempt相当の監査記録へ保存する。
- feedback Edgeはcycle countとmax cyclesを必ず増減・検査する。
- Graph編集によって既存Attempt、Prompt marker、artifact、usage snapshotを上書きしない。

## 12. React Flow UI

### 12.1 依存

`web`へ`@xyflow/react`を直接依存として追加する。React 19およびNext.js client componentとして利用し、Workflow canvasをdynamic importしてSSRでDOM APIを実行しない。

利用要素:

- `ReactFlow`
- `ReactFlowProvider`
- `Background`
- `Controls`
- `MiniMap`
- `Panel`
- `Handle`
- `BaseEdge`またはcustom edge
- `useNodesState`／`useEdgesState`は表示中のlocal stateに限定

### 12.2 画面構成

```text
┌ Chat | Workflow | Diff ────────────────────────────┐
│ Run status / cycle / progress / token / cost       │
├───────────────────────────────┬─────────────────────┤
│                               │ Node Inspector      │
│ React Flow Canvas             │ config / result     │
│                               │ prompt / artifact   │
│                               │ retry / attention   │
├───────────────────────────────┴─────────────────────┤
│ Timeline / Attention                               │
└─────────────────────────────────────────────────────┘
```

### 12.3 Node表示

全Nodeは最低限、次を表示する。

- icon、display name、Node type
- `ready`、`running`、`attention`、`passed`、`failed`、`skipped`、`unsupported`
- Attempt番号
- Agent／Executor
- duration、token、cost
- 最新結果summary
- 入出力Handle
- Attention件数

状態を色だけで表現しない。icon、text、border style、`aria-label`を併用する。

### 12.4 Edge表示

- dependency: 通常線
- active execution: animated edge
- success: success tone
- feedback: warning toneのloop-back edge
- blocked: danger tone
- 未接続候補: draft style

animationは`prefers-reduced-motion`で停止する。Edge labelはキーボード・スクリーンリーダー向けの同等テキストをInspectorまたはNode adjacency listでも提供する。

### 12.5 Inspector

Node選択時に次を表示する。

- Node configとRegistry metadata
- SessionをChatで開く操作
- Attempt履歴
- Prompt envelope／trace
- result、finding、artifact
- usage snapshot
- Retry、Skip、Pause、Attention回答
- Draftとactive snapshotの差分

実行中Attemptのconfig編集は無効化し、次回Run用Draft編集へ明確に切り替える。

### 12.6 編集UX

- Node paletteはRegistryの`userAddable`だけを列挙する。
- drag from handleでEdge候補を作る。
- 接続中に不正portをdisabled表示する。
- drop時にserver validationとCASを通す。
- optimistic layout移動は許可するが、semantic mutationはserver成功後に確定する。
- Deleteキーによる削除は確認を必要とし、input focus中は発火しない。
- Undo／Redoは未保存local operationに限定し、server commit済み変更は新しい逆operationとして保存する。

## 13. Chat／Diff／Attention連携

- Node選択はTaskViewの共有stateとして保持する。
- Chatタブは選択Runtime Nodeの最新Sessionを開く。
- Control Node選択時はChatを無効化し、監査結果を表示する。
- Diffタブは選択Attemptのstart／finish fingerprintと現在差分を区別する。
- Workflow Attention発生時は対象Nodeを強調し、`fitView({ nodes: [...] })`で見える位置へ移動する。
- Attention回答後もユーザーが移動したviewportを不必要に上書きしない。
- SSEはGraph revision、Run revision、Node status、Attention countを独立して通知する。

## 14. レスポンシブ

### 14.1 Desktop（1024px以上）

- 横方向Graphを既定とする。
- Inspectorは右側固定、幅320〜420px。
- MiniMap、zoom、Fit Viewを表示する。
- keyboard navigationとmulti-selectを提供する。

### 14.2 Tablet（768〜1023px）

- Canvasを全幅表示する。
- Inspectorは右Drawer。
- MiniMapは必要時のみ表示する。
- Node paletteはpopoverまたはDrawer。

### 14.3 Mobile（767px以下）

- Graphは縦方向auto-layoutを既定とする。
- Inspectorはbottom sheet。
- controlsは44px以上のtouch target。
- pinch zoom、one-finger pan、Fit Viewを提供する。
- Node dragとCanvas panの競合をdrag handleで分離する。
- 初回表示はGraph全体へFitし、文字が読めない縮尺の場合はactive Node中心へ寄せる。
- 390px幅でページ全体の横overflowを発生させない。Canvas内部のpanは許可する。

### 14.4 アクセシビリティ

- Canvas以外にNode一覧／接続一覧の代替ビューを用意する。
- TabでNodeを移動し、EnterでInspectorを開く。
- Node追加、Edge追加、削除、実行状態変化をlive regionで通知する。
- color contrastはWCAG 2.2 AAを満たす。
- zoomに依存せずInspectorで全情報へアクセスできる。

## 15. 移行手順

### Phase 1: 互換Graph読取

1. `@xyflow/react`を追加する。
2. Registry v1とGraph DTO／validatorを追加する。
3. 既存3Node定義から互換Graphを合成するread adapterを追加する。
4. 現行Schedulerは変更せず、React Flow canvasをread-onlyで導入する。
5. 既存Workflow API／テストを維持する。

### Phase 2: Graph永続化

1. Graph 3テーブルとmigrationを追加する。
2. 既存Taskはlazy migrationし、初回Graph保存時に互換Graphを作る。
3. layout／viewport保存APIとGraph CASを追加する。
4. 既存Runのdefinition snapshotは書換えない。

### Phase 3: InspectorとTaskView連携

1. Node選択をChat／Diffへ接続する。
2. Prompt、finding、artifact、usage、AttentionをInspectorへ統合する。
3. Desktop／tablet／mobile layoutを導入する。

### Phase 4: Semantic Graph編集

1. Registry paletteを追加する。
2. Node追加・削除、Edge編集、schema formを追加する。
3. Graph validatorとRun開始snapshot v2をSchedulerへ接続する。
4. 初期Registry Nodeだけをuser-addableにする。

### Phase 5: Scheduler汎用化

1. 固定Node key分岐をExecutor Registryへ置換する。
2. dependency、parallel join、feedbackをsnapshotから評価する。
3. Control Node監査記録を追加する。
4. 既存3Node統合E2Eを汎用Schedulerでも通す。

### Rollback

- React Flow UIはfeature flagで旧WorkflowPanelへ戻せる。
- Graph Draftを無効化しても既存Run snapshotと3Node実行を継続できる。
- migrationは既存Workflowテーブルを削除・renameしない。
- 未対応Graphを検出した場合はread-only表示し、旧固定Graphとして黙って実行しない。

## 16. Feature flag

段階導入用に次を追加する。

```text
LEAFCODE_WORKFLOW_GRAPH=true|false
LEAFCODE_WORKFLOW_GRAPH_EDIT=true|false
```

- `WORKFLOW_GRAPH=false`: 現行カードWorkflow UI。
- `WORKFLOW_GRAPH=true`, `GRAPH_EDIT=false`: React Flow read-only canvas。
- 両方true: 許可済みGraph編集。
- 親の`LEAFCODE_WORKFLOW_MODE=false`は両flagより優先する。
- EXE既定ではread-only canvasを段階導入し、semantic editは受入基準完了後に有効化する。

## 17. テスト戦略

### Unit

- Registry type／version解決
- config／result schema
- Graph canonicalizationとhash
- port接続、循環、write並列、size上限
- 既存3Nodeからの互換Graph合成
- React Flow adapterが実行フィールドを欠落させないこと

### Integration

- Graph CAS conflict
- Node／Edge一括transaction rollback
- Draft更新がactive snapshotへ影響しないこと
- Registry更新後も既存snapshotが同じexecutor意味を保つこと
- unsupported NodeがRun開始を拒否すること
- 既存3NodeのImplement→並列Reviewer→feedback→完了

### UI

- Node／Edge表示、選択、Inspector
- keyboard navigationと代替一覧
- Attention focus
- Chat／Diff切替
- reduced motion
- 390px、768px、1280pxでoverflowと操作性を検証

### E2E

- HomeViewからWorkflow作成
- 既存3Node Graph表示
- layout保存と再読込
- Reviewer並列実行中のanimated edge
- finding差し戻しEdge
- Browser Bridge artifactからVisual Judge完了
- Draft編集が次回Runだけへ適用されること
- feature flag rollback

## 18. 受入基準

### 18.1 互換性

- [ ] 既存Workflow Taskがmigration操作なしでGraph表示できる。
- [ ] 既存3NodeのSession、Attempt、result、artifact、usageがNodeへ正しく対応する。
- [ ] 既存APIクライアントと旧Workflow UIが動作する。
- [ ] 既存3Node統合E2EがGraph導入後も成功する。

### 18.2 Graphモデル／Registry

- [ ] Graph DraftとRun snapshotが別の永続データとして存在する。
- [ ] Snapshot hashがlayout変更では変化せず、semantic変更で変化する。
- [ ] Node型追加がRegistry、renderer、executor、schema、testの追加で完結する。
- [ ] 未知type／versionは閲覧可能だが実行不可になる。
- [ ] 不正Edge、暗黙循環、write並列、権限上限超過をserverが拒否する。

### 18.3 CAS／編集安全性

- [ ] semantic mutationはGraph revision CASを必須とする。
- [ ] 複数operationはtransactionでall-or-nothingになる。
- [ ] active RunがGraph Draft変更の影響を受けない。
- [ ] 実行中snapshotを変更するAPIが存在しない。
- [ ] layout conflictとsemantic conflictを区別してUI表示する。

### 18.4 React Flow UI

- [ ] Node、Edge、Gate、feedback loopがReact Flow canvasへ表示される。
- [ ] Node状態、Attempt、usage、Attentionが視覚・テキストの両方で判別できる。
- [ ] InspectorからSession、Prompt、result、finding、artifact、Retryへ到達できる。
- [ ] Chat／Workflow／Diff間でNode選択が維持される。
- [ ] reduced motionとkeyboard操作に対応する。
- [ ] Canvas以外のNode／接続代替一覧が利用できる。

### 18.5 レスポンシブ

- [ ] 1280pxでCanvas＋固定Inspectorを利用できる。
- [ ] 768pxでDrawer Inspectorを利用できる。
- [ ] 390pxで縦Graph、bottom sheet、44px controlsを利用できる。
- [ ] 3 viewportでページ全体の横overflowがない。
- [ ] touch pan／zoomとNode選択・dragが競合しない。

### 18.6 品質ゲート

- [ ] Graph unit／integration／UI／E2Eが成功する。
- [ ] 既存Workflow、TaskView、HomeView、Attention、Diffの回帰テストが成功する。
- [ ] `npm run typecheck`と対象lintが成功する。
- [ ] Browser Bridge artifact統合E2Eが成功する。
- [ ] feature flag OFFで旧UIへrollbackできる。
- [ ] 実画面をDesktop、tablet、mobileで検証する。

## 19. 未決事項

実装計画作成時に次を確定する。

1. JSON Schema validatorを既存手書きvalidatorで継続するか、依存を追加するか。
2. Graph auto-layoutを独自固定配置、Dagre、ELKのいずれにするか。
3. layoutをTask Draftだけへ保存するか、Runごとの閲覧layoutも保持するか。
4. Graph semantic editを初回公開に含める範囲。
5. Control Nodeの監査記録を`workflow_node_attempts`へ統合するか専用テーブルにするか。

未決事項は、既存3Node互換、安全側停止、snapshot不変、server-side Registry allowlistを変更してはならない。
