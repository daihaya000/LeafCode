import { AUTO_MODEL_VALUE } from "@/lib/auto-model";
import { readAutoTaskRecord } from "@/lib/auto-task-record";
import { useModelConfigState } from "@/lib/hooks/use-model-config-state";

/**
 * TaskView のモデル/エージェント選択 state（REFACTORING_PLAN 5-b /
 * IMPROVEMENT 1-1）。共通実装は `lib/hooks/use-model-config-state`（HomeView
 * と共有）。プロバイダ/エージェント取得（fetch）は TaskView 側に残す。
 */
export function useTaskModelConfig(taskId: string) {
  // Seed Auto synchronously for tasks created from HomeView. Waiting for the
  // provider fetch leaves a render where the model is empty, allowing the
  // assistant-reply seeding effect to replace Auto with its resolved model.
  return useModelConfigState(() =>
    readAutoTaskRecord(taskId) ? AUTO_MODEL_VALUE : "",
  );
}
