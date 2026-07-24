/**
 * サブエージェント起動（task 権限）の許可 / 不許可設定。
 * `lib/access-mode.ts` の localStorage + CustomEvent 設計を踏襲する。
 * デフォルトは「許可」。
 */

export type SubagentPermission = "allow" | "deny";

const STORAGE_KEY = "webui:subagent-permission";

export const SUBAGENT_PERMISSION_EVENT = "webui:subagent-permission";

export const SUBAGENT_PERMISSION_OPTIONS: {
  value: SubagentPermission;
  label: string;
  title: string;
}[] = [
  {
    value: "allow",
    label: "許可",
    title: "サブエージェントの起動（task 権限）を許可します",
  },
  {
    value: "deny",
    label: "不許可",
    title: "サブエージェントの起動（task 権限）を自動で拒否します",
  },
];

export function readSubagentPermission(): SubagentPermission {
  if (typeof window === "undefined") return "allow";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "allow" || raw === "deny") return raw;
  } catch {
    /* ignore */
  }
  return "allow";
}

export function writeSubagentPermission(mode: SubagentPermission): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent(SUBAGENT_PERMISSION_EVENT, { detail: mode }),
    );
  } catch {
    /* ignore */
  }
}

export type PermissionAutoAction = "approve" | "reject" | "manual";

/**
 * 保留中の権限要求をどう自動処理するかの純粋判定。
 * - サブエージェント不許可 かつ `task` 権限 → "reject"（フルアクセスより優先）
 * - フルアクセス（それ以外） → "approve"
 * - どちらでもない → "manual"（手動カードで応答）
 * これにより task 以外の権限はサブエージェント設定の影響を受けない。
 */
export function permissionAutoAction(args: {
  permission: string;
  subagent: SubagentPermission;
  fullAccess: boolean;
}): PermissionAutoAction {
  if (args.subagent === "deny" && args.permission === "task") return "reject";
  if (args.fullAccess) return "approve";
  return "manual";
}

/**
 * GlobalAttention / AttentionBadge 用: ユーザーに見せるべき項目か。
 * 自動 approve/reject 対象は隠すが、自動処理に失敗した id は手動応答のため残す。
 */
export function isActionableAttentionPermission(
  permission: string,
  subagent: SubagentPermission,
  requestId: string,
  fullAccess: boolean,
  failedAutoIds: ReadonlySet<string>,
): boolean {
  const action = permissionAutoAction({
    permission,
    subagent,
    fullAccess,
  });
  if (action === "manual") return true;
  if (failedAutoIds.has(requestId)) return true;
  return false;
}
