# docs/specs — 仕様書と実装ステータスの管理（IMPROVEMENT 8-5）

`docs/specs/` はリポジトリの**機能仕様書**を置く場所。実装状況が追えるよう、
各仕様の冒頭に**実装ステータスバッジ**を必ず記載する。

## ステータスバッジのルール

各仕様の最初の見出し（`# タイトル`）の直下に、次の 1 行を置く:

```
> 実装ステータス: ✅ 実装済み / 🔶 一部実装 / ⬜ 未実装（参照: `path/to/file.ts`）
```

| バッジ | 意味 | 判断基準 |
|--------|------|---------|
| ✅ 実装済み | 仕様の内容がすべて実装され、テストで保護されている | コード + テストの存在を確認 |
| 🔶 一部実装 | 主要部分は実装済みだが、仕様の一部が未達 | 未達項目をバッジ行に併記する |
| ⬜ 未実装 | 仕様のみで実装がない（計画・設計段階） | コード未存在を確認 |

- バッジ行の更新は**実装と同一コミット**で行う（実装がステータスに追いつくのを防ぐ）
- 移行系（`opencode-api-v2-migration.md` 等）は「どこまで進んだか」を併記する
- 新規仕様を追加するときは、最初からバッジ行を付ける

## 仕様一覧（2026-08-16 時点・31 本）

各仕様の冒頭見出し（# タイトル）を収集した一覧。ステータスは各ファイルの
バッジ行を参照すること。

| ファイル | タイトル |
|----------|---------|
| [agent-enable-toggle.md](agent-enable-toggle.md) | 設定のエージェントタブでエージェントの有効化/無効化 |
| [agent-monitor.md](agent-monitor.md) | エージェント監視(並行実行の可視化と制御) |
| [auto-model-cursor-router.md](auto-model-cursor-router.md) | WebUI Auto モード: Cursor Router 相当への拡張 |
| [auto-model-selection-taskview.md](auto-model-selection-taskview.md) | WebUI Auto モデル選択: TaskView follow-up 対応（追補） |
| [auto-model-selection.md](auto-model-selection.md) | WebUI Auto モデル選択モード（コスト最適・コーディング特化） |
| [auto-route-candidates.md](auto-route-candidates.md) | WebUI Auto モード: 候補リスト方式ルーティングへの刷新 |
| [bat-encoding-safety.md](bat-encoding-safety.md) | setup.bat が文字化け／エンコードで実行できない問題の恒久対策 |
| [browser-bridge-mcp.md](browser-bridge-mcp.md) | Browser Bridge MCP 仕様 |
| [browser-bridge-stale-tab-cleanup.md](browser-bridge-stale-tab-cleanup.md) | Browser Bridge 共有タブのクリーンアップ仕様 |
| [collaboration-awareness.md](collaboration-awareness.md) | 並行セッション相互認識 |
| [command-elapsed-timeout.md](command-elapsed-timeout.md) | コマンド実行の経過時間表示とタイムアウト仕様 |
| [goal-loop.md](goal-loop.md) | ループ 状態機械の定義と監査是正 |
| [hang-watchdog-server-side.md](hang-watchdog-server-side.md) | ハング検知・自動再開のサーバー側監視化 仕様 |
| [host-log-viewer.md](host-log-viewer.md) | 設定「全般」タブにホストログのライブ表示を追加 |
| [last-used-model-default.md](last-used-model-default.md) | 新規セッションのアクティブモデルを最後に使用したモデルにする |
| [launcher-early-failure-visibility.md](launcher-early-failure-visibility.md) | exe早期失敗時の可視化と動作条件の明文化 |
| [local-voice-output.md](local-voice-output.md) | ローカル音声出力（Kokoro / Fish Audio S2）実装計画 |
| [memory-layer.md](memory-layer.md) | メモリ層(セッション横断の永続記憶) |
| [node-workflow-mode.md](node-workflow-mode.md) | ノードワークフローモード仕様 |
| [non-latin1-directory-path.md](non-latin1-directory-path.md) | 非 Latin-1 文字（日本語など）を含むワークスペースパスの対応 |
| [opencode-api-v2-migration.md](opencode-api-v2-migration.md) | OpenCode エンジン API v2 (beta) への移行準備 |
| [opencode-config-profiles.md](opencode-config-profiles.md) | グローバル OpenCode 設定のプロファイル切替 |
| [private-network-project-picker.md](private-network-project-picker.md) | 単一利用者プライベートネットワークのプロジェクト選択 |
| [pty-interactive-terminal.md](pty-interactive-terminal.md) | PTY 対話ターミナル |
| [remote-authz.md](remote-authz.md) | リモート認証・認可基盤 |
| [remote-project-picker.md](remote-project-picker.md) | リモートプロジェクトフォルダ選択 |
| [security-remediation-plan.md](security-remediation-plan.md) | セキュリティ修正計画 |
| [self-improvement-loop.md](self-improvement-loop.md) | 自己改善ループ(振り返りエージェント + 改善Inbox) |
| [session-activity-ledger.md](session-activity-ledger.md) | セッション活動台帳（Session Activity Ledger）— 並行セッションの状況把握強化 |
| [setup-start-webui-merge.md](setup-start-webui-merge.md) | setup.bat を廃止して start-webui.bat へ統合する |
| [workflow-graph-editor.md](workflow-graph-editor.md) | Workflow Graph Editor 仕様 |
