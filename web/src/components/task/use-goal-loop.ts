import { useState } from "react";
import type { GoalLoopDto } from "@/lib/goal-loop";

/**
 * TaskView の Goal Loop フォーム state（REFACTORING_PLAN 5-b / IMPROVEMENT 1-1）。
 * ループ行・有効化・承認条件・最大ターン・完走モード・送信中フラグ・エラーを
 * 集約する。起動・更新の副作用（fetch）は TaskView 側に残す。
 */
export function useGoalLoop() {
  const [goalLoop, setGoalLoop] = useState<GoalLoopDto | null>(null);
  const [goalLoopEnabled, setGoalLoopEnabled] = useState(false);
  const [goalLoopAcceptance, setGoalLoopAcceptance] = useState("");
  const [goalLoopMaxTurns, setGoalLoopMaxTurns] = useState(10);
  const [goalLoopForceFullRun, setGoalLoopForceFullRun] = useState(false);
  const [goalLoopBusy, setGoalLoopBusy] = useState(false);
  const [goalLoopError, setGoalLoopError] = useState<string | null>(null);

  return {
    goalLoop,
    setGoalLoop,
    goalLoopEnabled,
    setGoalLoopEnabled,
    goalLoopAcceptance,
    setGoalLoopAcceptance,
    goalLoopMaxTurns,
    setGoalLoopMaxTurns,
    goalLoopForceFullRun,
    setGoalLoopForceFullRun,
    goalLoopBusy,
    setGoalLoopBusy,
    goalLoopError,
    setGoalLoopError,
  };
}
