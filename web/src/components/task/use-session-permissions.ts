import { useState } from "react";
import { readAccessMode, type AccessMode } from "@/lib/access-mode";
import {
  readSubagentPermission,
  type SubagentPermission,
} from "@/lib/subagent-permission";
import {
  readSkillPermission,
  type SkillPermission,
} from "@/lib/skill-permission";

/**
 * TaskView のセッション権限 state（REFACTORING_PLAN 5-b / IMPROVEMENT 1-1）。
 * accessMode / subagentPermission / skillPermission とその保存中フラグ、
 * 権限再確認のリトライ・表示用 tick を集約する。
 * 保存処理（changeAccessMode 等）は fetch と task に依存するため TaskView 側に残す。
 */
export function useSessionPermissions() {
  const [accessMode, setAccessMode] = useState<AccessMode>(() => readAccessMode());
  const [accessModeSaving, setAccessModeSaving] = useState(false);
  const [subagentPermission, setSubagentPermission] = useState<SubagentPermission>(
    () => readSubagentPermission(),
  );
  const [subagentPermissionSaving, setSubagentPermissionSaving] = useState(false);
  const [skillPermission, setSkillPermission] = useState<SkillPermission>(
    () => readSkillPermission(),
  );
  const [skillPermissionSaving, setSkillPermissionSaving] = useState(false);
  const [accessEnsureRetry, setAccessEnsureRetry] = useState(0);
  const [permissionTick, setPermissionTick] = useState(0);

  return {
    accessMode,
    setAccessMode,
    accessModeSaving,
    setAccessModeSaving,
    subagentPermission,
    setSubagentPermission,
    subagentPermissionSaving,
    setSubagentPermissionSaving,
    skillPermission,
    setSkillPermission,
    skillPermissionSaving,
    setSkillPermissionSaving,
    accessEnsureRetry,
    setAccessEnsureRetry,
    permissionTick,
    setPermissionTick,
  };
}
