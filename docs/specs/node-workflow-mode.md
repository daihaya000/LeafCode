# ノードワークフローモード仕様

## 1. 背景

現行の OpenCodeWebUI は、`Project → Workspace（UI上のTask）→ OpenCode Session` を中心に、会話、差分、承認、質問、Goal Loop、子Session表示を提供している。

一方、UI実装を行った後に独立した Code Review と Visual Judge を並列実行し、指摘を実装担当へ戻す処理は、現在はメインAgentのプロンプトと `task` tool に委ねられている。この方法では、実行順、担当モデル、再試行、承認待ち、コスト、レビュー結果をTask全体として永続化・再開・可視化できない。

本仕様では、Agentより上位にWebUI管理のWorkflow制御層を置き、複数の独立Sessionを1つのTaskとして安全に実行・表示する。

参考にしたX投稿の動画は、汎用DAGエディターではなく、`Implement UI → Code Review / Visual Judge → 修正`という固定フィードバックフローの実行可視化である。初期リリースもこの固定テンプレートを対象とする。

## 2. 目的

1. 通常TaskとWorkflow Taskを相互に切り替えられるようにする。
2. WorkflowをTask／Workspace単位で保持し、各Nodeへ独立したOpenCode Sessionを紐付ける。
3. NodeごとにAgent、モデル、思考強度、権限、固有指示を設定できるようにする。
4. Implement完了後にCode ReviewとVisual Judgeを並列実行し、修正要求をImplementへ安全に戻す。
5. WorkflowとNodeの状態、試行、Attention、成果物、コストを永続化し、再起動後も安全に再開できるようにする。
6. 現行Sidebarの単純さと、Chat／Diff／承認フローを維持する。

## 3. 初期スコープ

### 3.1 対象

- 既定テンプレート `UI Implementation Review`
- 固定Node:
  - `implement_ui`
  - `code_review`
  - `visual_judge`
- 固定Edge:
  - `implement_ui → code_review`
  - `implement_ui → visual_judge`
  - blockingな修正要求時 `code_review / visual_judge → implement_ui`
- Node設定編集
- 通常Taskとの相互変換
- Node単位のChat、モデル、Agent、指示、実行履歴
- Workflow／Node状態のリアルタイム表示
- Pause、Resume、Stop、Retry
- Session単位AttentionのWorkflow／Node集約
- Desktop、tablet、mobile表示

### 3.2 非対象

- 初期リリースでの任意Node追加・削除・自由接続
- 任意の循環グラフ、条件式エディター、ユーザースクリプト実行
- 複数の書込みNodeによる同時ファイル編集
- Nodeごとの自動worktree作成・merge
- Workflowテンプレートの共有Marketplace
- 過去の通常Session履歴からNode境界を自動推定すること
- Browser Bridgeのスクリーンショット本体を監査ログへ永続化すること

Nodeカードと接続線を表示する画面を「Workflow」と呼ぶ。初期リリースは設定可能な固定フローであり、自由編集可能な汎用DAGエディターとは呼ばない。将来の自由編集に備え、定義スナップショットはNode／Edge形式で保存する。

## 4. 概念モデル

```text
Project
  └─ Workspace / Task
       ├─ primary OpenCode Session
       └─ Workflow Run（任意、同時にactiveは1件）
            ├─ Implement Node Run
            │    └─ Node Attempt → OpenCode Session
            ├─ Code Review Node Run
            │    └─ Node Attempt → OpenCode Session
            └─ Visual Judge Node Run
                 └─ Node Attempt → OpenCode Session
```

- **Workspace / Task**: 対象コード、Git差分、Sidebar上の1行。
- **Workflow Run**: Task全体の実行方式と進行状態。
- **Node Run**: Workflow内の役割と依存関係。
- **Node Attempt**: Nodeの1回の実行。使用設定と結果を不変スナップショットとして保持する。
- **OpenCode Session**: Nodeを実行するAgentの会話・Tool履歴。

OpenCodeの`parentID`は会話上の親子関係であり、Workflow Edgeの正規ソースにはしない。

## 5. 実行方式と表示方式

### 5.1 実行方式

Taskは次のいずれかを持つ。

```ts
type TaskExecutionMode = "standard" | "workflow";
```

- `standard`: 現行どおりprimary Sessionを直接操作する。
- `workflow`: active Workflow Runが実行を管理する。

### 5.2 表示方式

Workflow Taskでは、実行方式を変えずに次を切り替えられる。

- `Chat`: 選択NodeのSession会話
- `Workflow`: Node、Edge、状態、進捗
- `Diff`: Workspace全体の差分

表示タブの変更は実行状態へ影響しない。実行方式の変更は専用の変換操作と確認を必要とする。

## 6. 通常Taskとの相互変換

### 6.1 通常 → Workflow

前提:

- Workspaceが`active`である。
- primary Sessionが存在する。
- SessionとGoal Loopが実行中ではない。
- merge、archive、削除処理中ではない。

処理:

1. 変換確認画面に、作成するNode、Agent、モデル、権限、推定追加Session数を表示する。
2. Workspaceの`execution_mode`をCASで`workflow`へ変更する。
3. Workflow Runと固定Node／Edgeの定義スナップショットを作成する。
4. 既存primary SessionをImplement Nodeへ紐付ける。
5. Reviewer Sessionはこの時点では作らず、Nodeが`ready`になった時点で遅延作成する。
6. 現在のGit差分要約とHEADをWorkflow開始基準として保存する。

変換に失敗した場合は`standard`を維持し、部分作成したRunを実行可能にしない。

### 6.2 Workflow → 通常

前提:

- in-flight Node Attemptがない。
- Workflowが`paused`または終端状態である。

処理:

1. 通常Taskで継続するSessionを選ぶ。既定はImplement Session。
2. 選択Sessionをprimary Sessionとして保持する。
3. Workflow Runを`detached`にし、履歴・Node結果・Session bindingは削除しない。
4. Workspaceの`execution_mode`を`standard`へ変更する。

再度Workflowへ切り替える場合は、互換性のある最新`detached` Runを再接続するか、新しいRunを作成するかを選べる。再接続時も新しいAttemptとして再開し、過去結果を上書きしない。

## 7. Agent・モデル・指示

### 7.1 設定レイヤー

```text
システム安全制約
  → Workspaceで読み込まれる共通AGENTS.md
  → OpenCode Agent定義（agents/*.md）
  → Workflow Node固有指示
  → 今回のNode入力
```

Nodeごとに物理的な`AGENTS.md`を生成・書換えない。同一Workspaceを共有するAgentへ意図せず波及し、並列実行時に競合するためである。

Node設定は上位の禁止事項を緩和できず、制約の追加だけを許す。

### 7.2 Node設定

```ts
type WorkflowNodeConfig = {
  agentName: string;
  instructions: string;
  contextFiles: string[];
  reasoningEffort?:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";
  model:
    | {
        mode: "explicit";
        providerID: string;
        modelID: string;
        variant?: string;
      }
    | {
        mode: "auto";
        optimizeFor: "quality" | "cost" | "speed";
      };
  permissions: {
    write: boolean;
    subagent: boolean;
    browser: boolean;
  };
  gate: {
    blockingSeverities: Array<"critical" | "major" | "minor" | "nit">;
    optional: boolean;
  };
};
```

設定解決の優先順位:

```text
今回のAttempt override
  > Node設定
  > Workflowテンプレート設定
  > Task既定
  > アプリ既定
```

Agent定義がモデルを固定している場合はAgent指定を優先し、UIに`Agent指定`と表示する。Autoの選定結果とfallback結果はAttemptへ保存する。

Autoでは`reasoningEffort`を選定条件として扱い、resolved variantをAttemptへ保存する。Agent固定モデルがvariantを受け付けない場合は送信せず、UIとAttemptに`ignored_by_agent`を記録する。

実行中Attemptの設定は変更しない。変更は次回Attemptへ適用する。

### 7.3 初期推奨値

| Node | Agent | モデル方針 | write | subagent | browser |
| --- | --- | --- | --- | --- | --- | --- |
| Implement UI | `build` | quality | 許可 | 許可 | 必要時 |
| Code Review | code reviewer | costまたはquality | 不許可 | 不許可 | 不許可 |
| Visual Judge | UI/UX reviewer | 画像対応・quality | 不許可 | 不許可 | 許可 |

Workflowから見れば各Node AgentはWorkerだが、OpenCodeのAgent種別をsubagentへ強制変更しない。各Nodeは独立Sessionとして実行する。Implement Agent内の再委任は許可できるが、その子SessionはWorkflow NodeではなくImplement Nodeの実行詳細として表示する。

### 7.4 権限の強制

Node Session作成後、最初のpromptより前にサーバーがsession-scoped permissionを適用する。

- `write=false`: edit、write、patch、file mutation、Git mutationをserver-side denyする。要求が発生しても承認UIへ回さず拒否する。
- 初期リリースのReviewerでは`bash`、`shell`、terminalもdenyする。テスト結果はImplement artifactとして受け取り、shell経由の迂回書込みを許さない。将来read-only command allowlistを導入する場合は別仕様とする。
- `subagent=false`: 既存のTask／subagent permissionをdenyする。
- `browser=false`: OpenCodeのsession-scoped tool ruleで`browser_*`をdenyする。BrokerへNode contextを渡す方式には依存しない。
- `browser=true`: tool利用を許可しても、Browser Bridgeの共有タブ、origin、操作別approvalを省略しない。

prompt文の「書き込まないでください」は補助指示であり、権限制御の代替にしない。Node設定APIは現在のAgent／共通policyより強い権限を付与できない。

## 8. Node結果契約

Implementは次の構造化結果を返す。

```ts
type ImplementResult = {
  status: "completed" | "progress" | "blocked";
  summary: string;
  evidence: string[];
  changedFiles?: string[];
  next?: string;
  blockedReason?: string;
};
```

- `completed`だけがReviewerを`ready`にする。
- `progress`は同じImplement Sessionの新しいAttemptとして継続する。ただしcycle上限とは別のNode attempt上限を適用する。
- `blocked`または構造不正はWorkflowをPauseし、Attentionを作る。

Code ReviewとVisual Judgeは次の構造化結果を返す。

```ts
type ReviewResult = {
  verdict: "pass" | "needs_changes" | "blocked" | "skipped";
  summary: string;
  evidence: string[];
  findings: Array<{
    id: string;
    severity: "critical" | "major" | "minor" | "nit";
    title: string;
    detail: string;
    target?: string;
    suggestedFix?: string;
  }>;
};
```

- `pass`: blocking findingなし。
- `needs_changes`: Node設定の`blockingSeverities`に該当するfindingあり。
- `blocked`: 必要な入力、権限、共有タブ、画像、実行環境を取得できない。
- `skipped`: optional Nodeをユーザーが明示的にスキップした。

自然言語本文からverdictを推測しない。構造化結果が読めない場合はAttemptを`failed`にしてWorkflowを安全側でPauseする。

Visual Judgeの入力は、明示的に選択されたスクリーンショット、Browser Bridge共有タブの承認済みscreenshot、またはTask添付画像に限定する。取得できない場合に自動で`pass`にしない。

Gateの真理値は次のとおり。

| Node | outcome | Gate |
| --- | --- | --- |
| required | `pass` | 通過 |
| required | `needs_changes` | Implementへ戻す |
| required | `blocked`／`failed`／不明 | WorkflowをPause |
| required | `skipped` | 通常は拒否。明示override時だけ通過 |
| optional | `pass` | 通過 |
| optional | `needs_changes` | blocking severityがあればImplementへ戻す |
| optional | `blocked` | Pauseまたはユーザーの明示skip |
| optional | `skipped` | 通過 |

通常のSkip APIはoptional Nodeだけを対象にする。required Nodeのskipは理由入力と強い確認を伴う`override_gate`として別監査イベントを残す。

## 9. 実行アルゴリズム

1. Implement Nodeを`ready`にする。
2. SchedulerがCASでAttemptをclaimし、Implement SessionへNode入力を送信する。
3. Implementが構造化完了結果を返したらNodeを`succeeded`にする。
4. Code ReviewとVisual Judgeを同時に`ready`にする。
5. 各Reviewerを独立してclaim・実行する。一方の失敗で他方を中断しない。
6. 両Reviewerが終端したらGateを評価する。
7. blockingな`needs_changes`が1件以上あれば、findingを重複排除してImplement Sessionへ送り、新しいImplement Attemptを作る。
8. blocking findingがなく、required Reviewerが`pass`または許可された`skipped`ならWorkflowを`completed`にする。
9. `blocked`、構造化結果不正、送達不明、上限超過はWorkflowを`paused`にしてAttentionを作る。

Implement Attempt完了時の`finish_head + finish_fingerprint`を`review_subject`として固定する。Reviewer開始直前に現在値が`review_subject`と一致すること、並列Reviewer完了時に両者が同じ`review_subject`を参照したこと、修正結果をImplementへ戻す直前にも現在値が同じであることを検証する。差異があれば自動続行せず`pause_reason = 'workspace_drift'`にする。

fingerprintは、HEAD、tracked diffのraw bytes、untracked fileの相対pathとcontent hashから算出する。ignored fileは除外し、改行を正規化しない。これによりImplement自身の正当な変更はreview subjectへ含め、その後の外部変更だけをdriftとして検出する。

既定の最大修正サイクルは3回とする。上限到達時は自動続行せず`paused`にする。

## 10. 状態機械

### 10.1 Workflow状態

| 状態 | 意味 | 終端 |
| --- | --- | --- |
| `draft` | 設定中、未実行 | – |
| `ready` | 開始可能 | – |
| `running` | 1件以上のNodeが実行中、または次Nodeをdispatch可能 | – |
| `pause_requested` | 実行中Attemptの安全な終了後にPause予定 | – |
| `paused` | ユーザー操作または安全上の理由で停止 | – |
| `completed` | 必須Gateを通過 | ✓ |
| `failed` | 回復不能な内部不整合 | ✓ |
| `stopped` | ユーザーが停止 | ✓ |
| `detached` | 通常Taskへ戻され、履歴参照のみ | ✓ |

### 10.2 Attempt状態

| 状態 | 意味 | in-flight |
| --- | --- | --- |
| `pending` | 依存Node待ち | なし |
| `ready` | Schedulerがclaim可能 | なし |
| `creating_session` | Session作成要求の応答待ち | 不明 |
| `dispatching` | DBでclaim済み、prompt送信結果待ち | 不明 |
| `running` | prompt受理済み、応答待ち | あり |
| `succeeded` | 構造化結果を保存済み | なし |
| `failed` | 実行または結果読取失敗 | なし |
| `skipped` | ユーザーが明示的に省略 | なし |
| `stopped` | ユーザー停止 | なし |

Nodeの結果判定はAttempt状態と分離し、Node kind別unionとして保持する。

```ts
type WorkflowNodeOutcome =
  | { kind: "implement"; value: "completed" | "progress" | "blocked" }
  | {
      kind: "review";
      value: "pass" | "needs_changes" | "blocked" | "skipped";
    }
  | null;
```

`progress`は`Attempt.status = succeeded`として結果を保存し、Node attempt上限（既定10）未満なら同じImplement Sessionに次Attemptを作る。上限到達時は`pause_reason = 'node_attempt_limit'`でPauseする。

Attention待ちは永続Attempt状態にせず、`running` Attemptに紐付く未解決permission／questionからDTO上で導出する。回答後も`running`のまま結果読取を続ける。拒否、期限切れ、Pause、Stop時は対象requestを解決または失効させ、Node policyに従って`failed`またはWorkflow Pauseへ遷移する。

### 10.3 遷移表

| Workflow現在 | 契機 | 次 | 主な副作用 |
| --- | --- | --- | --- |
| `draft` | 設定valid | `ready` | definition snapshot確定 |
| `ready` | start | `running` | Implement Attemptを`ready`化 |
| `running` | pause・in-flightなし | `paused` | `pause_reason=user` |
| `running` | pause・in-flightあり | `pause_requested` | 新規dispatchを止める |
| `pause_requested` | 全in-flight終了 | `paused` | 結果保存後に停止 |
| `paused` | resume・再検証成功 | `running` | dependencyを再評価 |
| `running` | required Gate通過 | `completed` | 完了要約保存 |
| 非終端 | stop | `stopped` | best-effort abort |
| `paused`／終端 | detach | `detached` | primary Session選択、履歴保持 |

| Attempt現在 | 契機 | 次 | 主な副作用 |
| --- | --- | --- | --- |
| `pending` | dependency成立 | `ready` | 入力snapshot作成 |
| `ready` | Sessionなし・CAS claim | `creating_session` | 作成要求を1回だけ送る |
| `ready` | Sessionあり・CAS claim | `dispatching` | message境界保存 |
| `creating_session` | 作成応答成功 | `dispatching` | binding後にprompt送信 |
| `creating_session` | timeout／送達不明 | `failed` | 自動再作成せずWorkflow Pause |
| `dispatching` | prompt受理 | `running` | 送信時刻保存 |
| `dispatching` | 400／401／403／404等、未送達が証明された拒否 | `failed` | 設定修正待ちでWorkflow Pause |
| `dispatching` | 408／409／429／timeout／5xx／送達不明 | `failed` | 自動再送せずWorkflow Pause |
| `running` | 構造化成功結果 | `succeeded` | result／outcome保存 |
| `running` | 構造不正／境界消失／timeout | `failed` | Workflow Pause |
| `pending`／`ready` | optional skip | `skipped` | 理由と操作者を監査 |
| 非終端 | stop | `stopped` | best-effort abort |

Retryは終端Attemptを変更せず、新しいAttempt番号を`pending`または`ready`で作る。Nodeの表示状態は最新Attemptとdependencyから導出し、`workflow_node_runs`へ重複した状態列を持たない。

### 10.4 Pause／Stop

- `ready`だけの場合、Pauseは即時適用する。
- `running`中のPauseは`pause_requested`とし、現在Attemptの結果を保存してから止める。
- StopはWorkflowを`stopped`にし、in-flight Sessionへbest-effort abortを送る。
- Pause、Stop、通常Task変換の競合は`revision` CASで一つだけ成功させる。

## 11. 不変条件

- **W1**: 1 Workspaceにactive Workflow Runは最大1件。
- **W2**: 1 Node Runにactive Attemptは最大1件。
- **W3**: Workflow EdgeはDBの定義スナップショットを正とし、Session `parentID`や表示位置から推論しない。
- **W4**: NodeとSessionの対応を明示保存し、子Sessionの並び順から推論しない。
- **W5**: 初期リリースでWorkspaceへ書込み可能なWorkflow NodeはImplementだけ。
- **W6**: ReviewerはImplement Attempt成功後にのみ開始する。
- **W7**: 実行済みAttemptのAgent、モデル、指示、権限、入力、結果を後から上書きしない。
- **W8**: OpenCodeへのprompt送信は非冪等として扱う。送達不明時は自動再送せずPauseする。
- **W9**: すべての状態遷移は`revision` CASを通す。
- **W10**: 履歴・結果・screenshotが読めないことを空、成功、idleとみなさない。
- **W11**: Node設定は共通安全制約とAgent権限を拡張できない。
- **W12**: required Reviewerが`blocked`または結果不明のときWorkflowを完了にしない。
- **W13**: Workflow管理Sessionへの手動prompt／commandを検出したら`pause_reason = 'manual_send'`でPauseし、結果境界を自動推定し直さない。
- **W14**: `execution_mode = 'workflow'`中は同じWorkspaceでGoal Loopのcreate／resumeを`409`で拒否する。Workflowをdetachした後だけ利用可能にする。
- **W15**: Reviewer Sessionの更新時刻によってTaskのprimary Sessionを変更しない。
- **W16**: WorkspaceのHEAD／dirty tree fingerprintが期待値からdriftした状態でReviewer開始または修正再投入をしない。

## 12. 永続化

### 12.1 `workspaces`追加列

| 列 | 型 | 既定 | 用途 |
| --- | --- | --- | --- |
| `execution_mode` | TEXT NOT NULL | `'standard'` | `standard` \| `workflow` |
| `primary_session_id` | TEXT | `NULL` | Taskで既定表示・通常継続するSession |
| `revision` | INTEGER NOT NULL | `0` | 実行方式、primary、archive／merge等のCAS |

既存行の`primary_session_id`は、現行`latestBindings()`が返す最新bindingでbackfillする。以後`TaskSummary.sessionId`は最新`updated_at`ではなく`primary_session_id`を参照する。Reviewer bindingの作成・touchでprimaryを変更しない。

### 12.2 `workflow_runs`

| 列 | 用途 |
| --- | --- |
| `id` | Run ID |
| `workspace_id` | Task／Workspace |
| `template_key` | 初期値`ui_implementation_review` |
| `definition_snapshot` | Node／Edge／Gate定義JSON |
| `status` | Workflow状態 |
| `cycle_count` / `max_cycles` | 修正サイクル |
| `primary_node_key` | 通常へ戻す既定Node |
| `revision` | CAS |
| `pause_reason` / `error` | 機械判定値／表示文 |
| `created_at` / `updated_at` | 時刻 |

### 12.3 `workflow_node_runs`

| 列 | 用途 |
| --- | --- |
| `id` / `workflow_run_id` | Node Run識別 |
| `node_key` / `kind` | 固定Node識別と種類 |
| `config` | 次回Attempt向け設定JSON |
| `latest_attempt_no` | 最新試行番号 |
| `revision` | Node設定のCAS |
| `created_at` / `updated_at` | 時刻 |

`(workflow_run_id, node_key)`をUNIQUEにする。

### 12.4 `workflow_node_attempts`

| 列 | 用途 |
| --- | --- |
| `id` / `node_run_id` | Attempt識別 |
| `attempt_no` | Node内連番 |
| `opencode_session_id` | 明示的なSession対応 |
| `session_create_marker` | Session作成照合用のランダムな非秘密ID |
| `status` / `outcome` | 実行状態／Node kind別判定 |
| `config_snapshot` | Agent、resolved model、指示、権限 |
| `input` / `result` | 構造化JSON |
| `error` | 表示用エラー |
| `last_message_id` | 応答境界 |
| `base_head` / `start_head` / `finish_head` | Git境界 |
| `dirty_fingerprint` | 対象差分のdrift検出 |
| `revision` | CAS |
| `started_at` / `finished_at` | 時刻 |

`(node_run_id, attempt_no)`をUNIQUEにする。Sessionは既存`session_bindings`にも登録する。

### 12.5 `workflow_artifacts`

Diff要約、レビュー対象commit、screenshot一時参照などのmetadataをAttemptへ紐付ける。秘密情報、画像base64、DOM本文を監査用DBへ保存しない。

## 13. Schedulerと再起動復旧

- 既存Goal Loop SchedulerのCAS、送達不明、履歴境界、安全Pauseの考え方を再利用する。
- Goal Loopの単一Session逐次ロジック自体は流用しない。
- Schedulerは`ready` Attemptを個別にclaimする。Reviewerは独立claimするため部分成功を保持する。
- 同時tickや再起動による二重dispatchは`revision` CASで防ぐ。
- `dispatching`のまま再起動したAttemptは、Session履歴で送達を証明できた場合だけ`running`へ復旧する。証明できなければ`paused`相当のAttentionを作り、自動再送しない。
- Session作成前に`session_create_marker`をDBへ保存し、OpenCode Session titleへ同じランダムmarkerを含める。
- `creating_session`のまま再起動したAttemptは、同一directory、作成時刻範囲、title markerでSession一覧を照合し、候補がちょうど1件の場合だけbindingする。0件または複数件なら自動で新しいSessionを作らずPauseする。
- `creating_session`送達不明後のRetryは、既存Sessionの照合、孤立Sessionの破棄、またはユーザーによる手動attachが完了するまで拒否する。
- `running`復旧時は`last_message_id`より後の構造化結果だけを読む。
- Schedulerの例外本文から状態分岐せず、`pause_reason` enumを使用する。

## 14. API契約

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/tasks/:id/workflow` | 定義、Run、Node、Attempt要約取得 |
| `POST` | `/api/tasks/:id/workflow` | 通常TaskをWorkflowへ変換 |
| `PATCH` | `/api/tasks/:id/workflow` | start／pause／resume／stop／detach／reattach |
| `PATCH` | `/api/tasks/:id/workflow/nodes/:nodeKey` | 次回Node設定変更 |
| `POST` | `/api/tasks/:id/workflow/nodes/:nodeKey/retry` | 新しいAttempt作成 |
| `POST` | `/api/tasks/:id/workflow/nodes/:nodeKey/skip` | optional Nodeを明示skip |
| `GET` | `/api/tasks/:id/workflow/events` | Workflow状態のSSE取得 |

すべてのmutationは期待`revision`を受け取り、競合時は`409`を返して最新状態を再取得させる。未知フィールド、未知Node、無効な状態遷移、利用不能なAgent／モデル／権限昇格を拒否する。

revision bodyは`workspaceRevision`、`workflowRevision`、`nodeRevision`、`attemptRevision`を区別する。通常↔Workflow変換、primary変更、archive／merge／cleanupは`workspaceRevision`、Workflow全体操作は`workflowRevision`、Node設定は`workflowRevision + nodeRevision`、Retry／Stopは`workflowRevision + attemptRevision`を要求する。WorkspaceとWorkflowを同時変更するdetach等は両revisionを同一transactionで検証する。`409`は最新Workflow DTOを返す。

通常Taskへ戻す操作は`PATCH action=detach`と`primarySessionId`を使う。Workflow履歴を削除しない。

## 15. Attention集約

既存のpermission／questionはSession ID単位の正規ソースを維持する。

1. `workflow_node_attempts.opencode_session_id`でAttentionをNodeへ解決する。
2. Nodeごとの件数と種類をWorkflow DTOへ集約する。
3. Task行では全Nodeの承認待ち、質問待ち、エラーを集約表示する。
4. Task行のAttentionを選ぶとWorkflowタブを開き、対象Nodeを選択する。
5. Node Session内でさらにSubagentが起動した場合は、既存の子Session探索を使って親Nodeへ集約する。

同じrequestをSSEとREST fallbackの両方から受信しても、`sessionID + requestID`で重複排除する。

Visual JudgeでBrowser Bridgeを使う場合は次のように写像する。

| Browser Bridge code | Workflow処理 |
| --- | --- |
| `APPROVAL_REQUIRED` | running Attemptの派生Attentionとして待機 |
| `APPROVAL_DENIED` | `blocked`、Workflow Pause |
| `BROKER_UNAVAILABLE`／`EXTENSION_DISCONNECTED`／`NOT_PAIRED`／`TAB_NOT_SHARED` | `blocked`、接続手順を示してWorkflow Pause |
| `POLICY_BLOCKED` | `blocked`。policyを自動緩和しない |
| `STALE_REFERENCE` | snapshot再取得を1回だけ試行し、再失敗で`blocked`／Pause |
| `COMMAND_TIMEOUT` | `blocked`、自動再実行せずPause |
| `PAYLOAD_TOO_LARGE` | `failed`、対象縮小を求めてPause |
| `INVALID_REQUEST` | `failed`、Node設定または実装契約の修正待ちでPause |
| `PROTOCOL_MISMATCH` | `blocked`、Browser Bridge更新／再起動を案内してPause |

optional Nodeだけはユーザーが明示skipできる。artifactにはopaque referenceと期限だけを保存し、画像本体、DOM本文、入力値はDB・監査ログへ保存しない。

## 16. UI仕様

### 16.1 Sidebar

現行の`Project → Task`構造を維持し、NodeやSessionを左メニューへ常設しない。

Workflow Task行へ追加する情報:

- Workflow種別アイコンと代替テキスト
- 全体状態
- 完了Node数／全Node数
- 集約Attention
- 実行中Nodeの短いラベル

Task行選択時は前回の`Chat / Workflow / Diff`表示を復元する。Node別SessionはTask内から開く。

### 16.2 Task画面

Workflow Taskに`Chat / Workflow / Diff`タブを表示する。

- Chat: Node Session切替。会話を混在表示しない。
- Workflow: フロー、進捗、Node詳細、全体操作。
- Diff: Workspace全体の差分。Node成果物への絞込みは補助情報とし、Git差分の正規ソースを変えない。

通常TaskではWorkflowタブを隠す。

### 16.3 Workflowフロー

Nodeカードには次を表示する。

- Node名と役割
- 状態とAttention
- 現在処理または最新結果要約
- Todo進捗またはfinding件数
- token、時間、Diff要約
- resolved model
- Attempt番号

接続線だけに依存せず、Nodeカード内またはアクセシブルなリストに開始条件と戻り条件を表示する。

初期リリースは固定配置のため、CSS GridとSVG接続線で実装できる。任意接続を導入するまではReact Flow系依存を追加しない。

### 16.4 Node詳細

Desktopでは右パネル、tabletでは開閉パネル、mobileではSheet／Drawerで表示する。

- Agent、モデル、思考強度、権限、固有指示
- Session ID、開始・終了時刻、Attempt履歴
- 結果要約、finding、evidence、artifact
- Attentionへの回答
- Chatで開く、Retry、Skip、Stop

実行済み設定の編集時は`次回試行から適用`と表示する。

### 16.5 破壊的・状態変更操作

次は対象、影響、履歴保持、取消可否を示す確認を必要とする。

- Workflow Stop
- Workflow → 通常Task
- 実行結果を残したRetry
- optional ReviewerのSkip
- required ReviewerのGate override
- 未保存Node設定の破棄

既定フォーカスはキャンセルに置く。

## 17. Responsive

- **Desktop**: Sidebar、フロー、Node詳細を同時表示可能。
- **Tablet**: フローを主領域とし、Node詳細を開閉式右パネルにする。
- **Mobile**: 現行Sidebar Drawerを維持し、Workflowは縦のステップ一覧、Node詳細はSheet／Drawerにする。
- mobileでグラフの横スクロールを必須にしない。
- `Chat / Workflow / Diff`は狭幅で横スクロール可能なタブ列とする。
- composerがある画面にfixed pluginを追加しない。Workflow操作はTaskヘッダー、永続パネル、Drawer内へ置く。

## 18. Accessibility

- `Chat / Workflow / Diff`はtablist／tab／tabpanel semanticsを持つ。
- 視覚グラフと同じ内容を構造化リストとして提供する。
- Node選択はEnter／Spaceで操作でき、選択後もフォーカスを失わない。
- roving tabindexを使う場合、矢印キーでNode移動、Home／Endで端へ移動できる。
- Drawer／SheetはEscape、focus trap、起点へのfocus復帰を実装する。
- 状態、Attention、判定は色だけで表さない。
- 状態更新は開始、Pause、Attention、失敗、完了だけを`aria-live="polite"`で通知し、tokenやログの頻繁な更新を読み上げない。
- mutation失敗は`aria-live="assertive"`で通知する。
- キーボードだけで変換、開始、Pause、Retry、Attention回答、キャンセルを完了できる。

## 19. デザイン

プロジェクト直下に`DESIGN.md`がないため、`~/.config/opencode/DESIGN.md`を参照する。

- 色、spacing、角丸は既存CSS変数とDESIGN tokenを経由し、新しいハードコード色を追加しない。
- accentは選択、主要操作、focusに限定する。
- dangerは破壊的操作の文言と細い境界に限定する。
- Node状態はStatusBadgeの既存toneを優先し、状態ごとの派手なカード全面色を使わない。
- 面、余白、弱いseparatorで階層化し、Nodeカードの入れ子を増やしすぎない。

## 20. Loading・Empty・Error状態

| 状態 | 表示・操作 |
| --- | --- |
| Loading | Task、Workflow、Node詳細を独立ロードし、既存内容を全面的に消さない |
| Draft／Empty | 固定フロー、役割、開始条件、未設定項目を表示 |
| Running | 実行Nodeと並列Reviewerを明示し、設定は次回適用として編集可能 |
| Waiting attention | Node名、要求、影響、承認／回答を表示 |
| Paused | pause reason、保存済み結果、再開条件を表示 |
| Failed | Node単位の理由、時刻、Retryを表示し、他Node履歴を隠さない |
| Completed | 両Reviewer結果、最終Diff、cycle、token、時間を要約 |
| Engine unavailable | 自動再送せず、接続状態と安全な再同期操作を表示 |
| Conversion failed | 元の実行方式を維持し、部分Runを実行させない |

## 21. セキュリティと競合防止

- 初期リリースはImplementだけにwriteを許可し、Reviewerは読み取り専用Agent／permissionで実行する。
- Reviewerのprompt文だけをwrite禁止の根拠にしない。
- Browser Bridgeは既存の共有タブ、origin、approval、screenshotポリシーを維持する。
- ページ内容、review対象コード、外部出力は不信入力として扱い、Node設定やpermissionを変更させない。
- screenshot、秘密情報、DOM本文、入力値をWorkflow監査ログへ保存しない。
- モデル、Agent、permissionのNode設定はサーバー側で再検証する。
- Workflow実行中のarchive、delete、merge、cleanupは拒否するか、Pause／Stop完了後にWorkspaceとWorkflowのrevision CAS付きで実行する。
- Reviewer開始前と修正再投入前にHEAD／dirty fingerprintのdriftを検証する。
- 将来複数write Nodeを許可する場合は、Node別worktreeまたはpath ownershipと明示merge barrierを別仕様で導入する。

## 22. コストと上限

- Nodeごとにtoken、推定費用、時間を表示し、Workflow全体へ集約する。
- 開始確認に利用Node数、最大cycle、Auto／explicitモデルを表示する。
- 既定最大cycleは3。
- 同時実行Reviewerは2件まで。
- Node内Subagentの利用量は親Nodeへ集約し、可能なら内訳を表示する。
- 上限到達、rate limit、利用可能モデルなしは自動fallback規則で解決できる場合だけ続行し、それ以外はPauseする。

## 23. テスト・検証項目

### 23.1 Unit

- Workflow／Attemptの全状態遷移
- revision CAS競合
- Node依存解決と並列Reviewer ready化
- Gate判定とfinding集約
- max cycle停止
- model／Agent／permission解決とAttempt snapshot
- 通常↔Workflow変換validationとprimary Session固定
- AttentionのSession→Node→Task集約と重複排除
- Reviewerのwrite／subagent／browser deny強制
- Gate真理値、required override、optional skip
- Workspace drift検出
- 構造化結果不正、履歴境界消失、Session作成／prompt送達不明の安全Pause

### 23.2 Integration

- 通常Taskの既存SessionをImplementへ引き継ぐ
- Reviewer Sessionの遅延作成と`session_bindings`登録
- Reviewer bindingをtouchしてもprimary Sessionが変わらない
- Session作成timeout／再起動でも重複Sessionを自動作成しない
- 並列Reviewerの一方が失敗しても他方の結果を保持する
- 修正要求から同じImplement Sessionへ新Attemptを送る
- host再起動後の`dispatching`／`running`復旧
- Workflow→通常後もNode Sessionと履歴を参照できる
- Browser Bridge approval／denial／timeoutをVisual Judge Nodeへ集約する

### 23.3 UI

- Sidebarの通常Task回帰とWorkflow進捗／Attention
- Chat／Workflow／Diff切替
- Node選択、詳細、Attempt履歴、次回設定
- loading、draft、running、parallel、attention、paused、failed、completed
- 確認ダイアログとfocus復帰
- mobile／tablet／desktopの実画面
- keyboard操作とscreen reader向け構造

### 23.4 既存回帰

- Task作成、通常Chat、Goal Loop、NestedAgentPanel、Diff、Graph、Terminal
- GlobalAttentionProviderのSSE／REST fallback
- Archive、delete、merge、workspace cleanup
- model／agent／permission設定

検証はtypecheck、eslint、Vitest、既存hostへの短いhealth check、CIモードのPlaywrightに限定し、エージェントはdev serverや本番buildを起動しない。

## 24. 受入条件

1. 通常TaskのSidebar、Chat、Diff、Goal Loopに回帰がない。
2. Taskは`standard`と`workflow`を持ち、条件を満たす場合に相互変換できる。
3. 通常→Workflowで既存primary SessionがImplement Nodeへ引き継がれ、Reviewer Sessionの作成・更新ではprimaryが変わらない。
4. Workflow→通常で選択Sessionをprimaryにでき、Workflow履歴は削除されない。
5. Workflow TaskでChat／Workflow／Diffを切り替えられる。
6. SidebarはProject→Task構造を維持し、Node／Sessionを常設せず、Workflow進捗と集約Attentionを表示する。
7. Implement成功後にCode ReviewとVisual Judgeが独立Sessionで並列実行される。
8. Reviewer Sessionではwrite／Git mutation／bash／shell／terminalがserver-side拒否され、subagent／browser denyもNode設定どおり強制される。
9. blocking findingだけがImplement再試行を要求し、両required ReviewerがGateを通過した場合だけWorkflowが完了する。
10. 各NodeでAgent、モデル、思考強度、権限、固有指示を設定でき、実行済みAttemptは不変である。
11. Visual Judgeが必要な画像を取得できない場合、自動passせずPauseまたは明示skipになり、Browser Bridgeエラーが定義どおりAttention／blockedへ写像される。
12. Pause、Stop、Retry、Attention回答、再起動復旧、Session作成timeoutで重複Session／promptが自動作成・送信されない。
13. Workflow管理Sessionへの手動送信、Goal Loop同時実行、Workspace drift、実行中archive／mergeを検出して安全に拒否またはPauseする。
14. Desktop、tablet、mobileで主要操作が利用でき、mobileで横グラフ操作を必須としない。
15. キーボードだけでNode選択、詳細、変換、実行制御、Attention回答を完了できる。
16. token、費用、時間、Attempt、モデル解決結果をNode／Workflow単位で確認できる。

## 25. 将来拡張

初期リリースの運用実績と状態機械の安定を確認してから、次を別仕様で検討する。

1. Node追加・削除とEdge編集
2. DAG validationと条件Gate editor
3. Workflow Template保存・複製・Project共有
4. Node別worktreeとmerge Node
5. 人間承認Node、test Node、deploy Node
6. 複数Workflow Run比較
7. React Flow等を用いた自由配置、zoom、minimap

自由編集を導入しても、Task／WorkspaceがWorkflowを所有し、Node AttemptがSessionを所有する基本モデルは維持する。
