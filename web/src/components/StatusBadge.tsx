import { Badge } from "@/components/ui";
import type { TaskStatus } from "@/lib/types";

const STATUS_META: Record<
  TaskStatus,
  { label: string; tone: "neutral" | "working" | "success" | "warning" | "danger"; pulse?: boolean }
> = {
  working: { label: "実行中", tone: "working", pulse: true },
  ready: { label: "変更あり", tone: "success" },
  idle: { label: "クリーン", tone: "neutral" },
  error: { label: "エラー", tone: "danger" },
  orphaned: { label: "要復旧", tone: "warning" },
  merged: { label: "マージ済", tone: "success" },
  unknown: { label: "不明", tone: "neutral" },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.unknown;
  return (
    <Badge tone={meta.tone} pulse={meta.pulse}>
      {meta.label}
    </Badge>
  );
}

export const ISOLATIONS = [
  { value: "git_worktree", label: "Worktree（分離）" },
  { value: "current_folder", label: "そのまま" },
  { value: "temporary_copy", label: "一時コピー" },
  { value: "devcontainer", label: "Dev Container" },
] as const;

export function isolationLabel(value: string): string {
  return ISOLATIONS.find((i) => i.value === value)?.label ?? value;
}
