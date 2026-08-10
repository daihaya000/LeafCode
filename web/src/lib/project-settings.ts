export const PROJECT_SETTING_FILES = [
  {
    key: "AGENTS.md",
    label: "AGENTS.md",
    description: "OpenCodeなどのエージェントへ渡すプロジェクト固有の指示",
  },
  {
    key: "CLAUDE.md",
    label: "CLAUDE.md",
    description: "Claude Code向けのプロジェクト固有の指示",
  },
  {
    key: "GEMINI.md",
    label: "GEMINI.md",
    description: "Gemini CLI向けのプロジェクト固有の指示",
  },
  {
    key: ".github/copilot-instructions.md",
    label: "Copilot instructions",
    description: "GitHub Copilot向けのリポジトリ指示",
  },
  {
    key: "opencode.json",
    label: "opencode.json",
    description: "OpenCodeのプロジェクト設定（JSON）",
  },
  {
    key: "opencode.jsonc",
    label: "opencode.jsonc",
    description: "OpenCodeのプロジェクト設定（コメント付きJSON）",
  },
] as const;

export type ProjectSettingFileKey = (typeof PROJECT_SETTING_FILES)[number]["key"];

export function isProjectSettingFileKey(value: unknown): value is ProjectSettingFileKey {
  return (
    typeof value === "string" &&
    PROJECT_SETTING_FILES.some((file) => file.key === value)
  );
}

export type ProjectSettingFileDto = {
  key: ProjectSettingFileKey;
  label: string;
  description: string;
  exists: boolean;
  content: string;
};
