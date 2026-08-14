import { useState } from "react";
import {
  type AutoCandidateProvider,
  type AutoOptimizeMode,
  type AutoProviderUsage,
  type AutoRouteConfig,
} from "@/lib/auto-model";
import {
  readAutoOptimizeMode,
  readAutoRouteConfig,
  readAutoShowModel,
} from "@/lib/auto-settings";
import { type AutoTaskRecord } from "@/lib/auto-task-record";

/**
 * TaskView の Auto 機能 state（REFACTORING_PLAN 5-b / IMPROVEMENT 1-1）。
 * Auto レコード・通知・解決入力・最適化ポリシー・ルーティング上書き・
 * モデル名表示・再試行失敗 ID を集約する。解決処理（fetch）は TaskView 側に残す。
 */
export function useAutoTask() {
  const [autoRecord, setAutoRecord] = useState<AutoTaskRecord | null>(null);
  const [autoRetryNotice, setAutoRetryNotice] = useState<string | null>(null);
  /** Transient chip for a follow-up Auto resolution (addendum spec §6). */
  const [autoFollowUpNotice, setAutoFollowUpNotice] = useState<string | null>(
    null,
  );
  /**
   * Inputs for the client-side Auto resolution (addendum spec §3). Snapshot
   * of the provider fetch: the *unfiltered* provider list (chooseAutoModel
   * applies the connected filter itself) plus a disabled record derived from
   * the extensions DTO. Null until the fetch succeeds → Auto sends fail with
   * a visible error instead of guessing.
   */
  const [autoInputs, setAutoInputs] = useState<{
    providers: AutoCandidateProvider[];
    connected?: string[];
    disabled: Record<string, true>;
    usage?: AutoProviderUsage;
  } | null>(null);
  /** Auto "Optimize For" policy; shared with HomeView and Settings. */
  const [autoOptimize, setAutoOptimize] = useState<AutoOptimizeMode>(() =>
    readAutoOptimizeMode(),
  );
  /** Per-tier routing config; shared with HomeView and Settings. */
  const [routeConfig, setRouteConfig] = useState<AutoRouteConfig>(() =>
    readAutoRouteConfig(),
  );
  /**
   * Whether to name the model Auto picked. Off by default (Cursor parity), so
   * the composer stays quiet unless the user opts in from Settings.
   */
  const [autoShowModel, setAutoShowModel] = useState(() => readAutoShowModel());
  const [autoReplyFailedIds, setAutoReplyFailedIds] = useState<Set<string>>(
    () => new Set(),
  );

  return {
    autoRecord,
    setAutoRecord,
    autoRetryNotice,
    setAutoRetryNotice,
    autoFollowUpNotice,
    setAutoFollowUpNotice,
    autoInputs,
    setAutoInputs,
    autoOptimize,
    setAutoOptimize,
    routeConfig,
    setRouteConfig,
    autoShowModel,
    setAutoShowModel,
    autoReplyFailedIds,
    setAutoReplyFailedIds,
  };
}
