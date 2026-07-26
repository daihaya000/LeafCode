// Japanese display labels for well-known OpenCode skill packs/sub-skills.
// Based on agent-manager/public/lib/catalog-labels.mjs. Unknown skills fall
// back to their original id/name so custom local skills remain recognizable.

const SKILL_LABELS: Record<string, string> = {
  "reverse-skill": "リバース／セキュリティ研究ルーター",
  "insane-search": "遮断サイト適応アクセス",
  "ui-ux-pro-max": "UI/UX デザイン知能",
  "frontend-design": "フロントエンドデザイン指針",
  "ux-ui-agent-skills": "UX/UI エージェントスキル（デザインシステム）",
  "a11y-audit": "アクセシビリティ監査",
  "apply-aesthetic": "美的スタイル適用",
  brandkit: "ブランドキット",
  "design-code": "デザイン→コード実装",
  "design-component": "コンポーネント設計",
  "design-qa": "デザインQA",
  "design-review": "デザインレビュー",
  "design-tokens": "デザイントークン",
  "figma-integration": "Figma 連携",
  governance: "デザインガバナンス",
  "image-to-code": "画像→コード変換",
  "migrate-design-system": "デザインシステム移行",
  performance: "UI パフォーマンス",
  prototype: "プロトタイプ作成",
  redesign: "リデザイン",
  "token-build": "トークンビルド",
  "ux-writing": "UX ライティング",
  "ui-ux-agent-skill-system": "UI/UX スキルシステム（シニア）",
  "admin-ui-builder": "管理画面UI構築",
  "admin-ui-orchestrator": "管理画面UI統括",
  "agent-progress-visualizer": "エージェント進捗可視化",
  "concept-prototyper": "コンセプト試作",
  "cursor-reveal-hero": "カーソルリビール演出",
  "design-critic-skill": "デザイン批評",
  "design-feedback-collector": "デザインFB収集",
  "figma-apply-effects": "Figma エフェクト適用",
  "figma-assets-manager": "Figma アセット管理",
  "figma-canvas-editor": "Figma キャンバス編集",
  "figma-code-to-canvas": "コード→Figma反映",
  "figma-context-reader": "Figma コンテキスト読取",
  "figma-design-system-sync": "Figma デザインシステム同期",
  "figma-design-to-code-bridge": "Figma→コード変換",
  "figma-workflow-auditor": "Figma ワークフロー監査",
  "image-layer-alignment-validator": "画像レイヤー整合検証",
  "marketing-site-skill": "マーケLP構築",
  "pencil-design-bridge": "Pencil デザイン連携",
  "senior-figma-orchestrator": "Figma 統括（シニア）",
  "senior-ui-ux-orchestrator": "UI/UX 統括（シニア）",
  "stitch-design-bridge": "Stitch デザイン連携",
  "ui-ux-llm-product-architect": "UI/UX・LLMプロダクト設計",
  "ux-audit-skill": "UX 監査",
  "ux-journey-architect": "UXジャーニー設計",
  "visual-content-director": "ビジュアルコンテンツ統括",
  "webapp-ui-skill": "WebアプリUI構築",
  "website-to-hyperframes": "サイト→ハイパーフレーム化",
  "apk-reverse": "APK／Android 解析",
  "js-reverse": "フロントJS解析",
  "ida-reverse": "IDA バイナリ解析",
  radare2: "radare2 CLI 解析",
  "reverse-engineering": "汎用リバースエンジニアリング",
  "dotnet-reverse": ".NET 解析",
  "firmware-pentest": "ファームウェア／IoT 診断",
  "edr-bypass-re": "EDR 回避研究",
  "patch-diff-exploit": "パッチ差分／N-day",
  "pwn-chain": "pwn／エクスプロイト開発",
  "pentest-tools": "ペネトレーションテスト",
  "api-security": "API セキュリティ",
  "malware-analysis": "マルウェア解析",
  "mobile-reverse": "モバイル解析",
  "binary-diff": "バイナリ差分",
  "llm-security": "LLM セキュリティ",
  "supply-chain-security": "サプライチェーン／SBOM",
  "backend-development": "バックエンド開発",
  "api-design-principles": "API 設計原則",
  "architecture-patterns": "アーキテクチャパターン",
  "microservices-patterns": "マイクロサービス設計",
  "cqrs-implementation": "CQRS 実装",
  "event-store-design": "イベントストア設計",
  "projection-patterns": "プロジェクション設計",
  "saga-orchestration": "Saga オーケストレーション",
  "workflow-orchestration-patterns": "ワークフロー統括（Temporal）",
  "temporal-python-testing": "Temporal テスト（Python）",
  "database-design": "データベース設計",
  "postgresql-table-design": "PostgreSQL テーブル設計",
  "backend-api-security": "バックエンド API セキュリティ",
  "backend-security-coder": "セキュアバックエンド実装",
  "backend-architect": "バックエンドアーキテクト",
  "tdd-workflows": "TDD ワークフロー",
  "tdd-cycle": "TDD サイクル統括",
  "tdd-red": "TDD レッド（失敗テスト作成）",
  "tdd-green": "TDD グリーン（最小実装）",
  "tdd-refactor": "TDD リファクタ",
  "tdd-orchestrator": "TDD 統括",
  "code-reviewer": "コードレビュー",
  superpowers: "Superpowers（開発プロセス規律）",
  "using-superpowers": "スキルの使い方（入口）",
  brainstorming: "ブレインストーミング",
  "writing-plans": "実装計画の作成",
  "executing-plans": "計画の実行",
  "test-driven-development": "テスト駆動開発",
  "systematic-debugging": "系統的デバッグ",
  "requesting-code-review": "コードレビュー依頼",
  "receiving-code-review": "レビュー指摘の対応",
  "subagent-driven-development": "サブエージェント駆動開発",
  "dispatching-parallel-agents": "並列エージェント実行",
  "using-git-worktrees": "git worktree 活用",
  "finishing-a-development-branch": "開発ブランチの仕上げ",
  "verification-before-completion": "完了前の検証",
  "writing-skills": "スキルの作成",
  "debugging-code": "対話型デバッガ（DAP）",
  "debug-agent": "証拠ベースデバッグ（実行ログ）",
  "web-performance": "Web パフォーマンス診断",
};

function normalizeSkillKey(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  const raw = value.trim().replace(/\\/g, "/");
  const parts = raw.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function skillDisplayLabel(skill: {
  id?: string;
  name?: string;
  path?: string;
}): string {
  const key =
    normalizeSkillKey(skill.name) ||
    normalizeSkillKey(skill.id) ||
    normalizeSkillKey(skill.path);
  return SKILL_LABELS[key] ?? skill.name ?? key ?? "スキル";
}

export function skillHasJapaneseLabel(skill: {
  id?: string;
  name?: string;
  path?: string;
}): boolean {
  const key =
    normalizeSkillKey(skill.name) ||
    normalizeSkillKey(skill.id) ||
    normalizeSkillKey(skill.path);
  return key in SKILL_LABELS;
}
