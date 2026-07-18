import {
  SessionBindingRow,
  WorkspaceJoinedRow,
  latestBindings,
  listWorkspacesJoined,
} from "./db";
import { DirStat, dirStat } from "./dirstat";
import { OcError, ocServer } from "./oc-server";
import { restoreAllKnownProjects } from "./project-session-sync";
import { deriveTaskStatus } from "./task-status";
import type { SessionStatus, TaskSummary } from "./types";

type StatusMap = Record<string, SessionStatus>;
type CostMap = Record<string, number>;

const EMPTY_STAT: DirStat = {
  git: false,
  branch: null,
  additions: 0,
  deletions: 0,
  files: 0,
};

async function globalEngineOk(): Promise<boolean> {
  try {
    const health = await ocServer<{ healthy?: boolean }>(null, "/global/health", {
      timeoutMs: 1500,
    });
    return Boolean(health.healthy);
  } catch {
    return false;
  }
}

async function sessionStatusFor(dirs: string[]): Promise<{
  engineOk: boolean;
  statuses: StatusMap;
}> {
  const statuses: StatusMap = {};
  if (dirs.length === 0) {
    return { engineOk: await globalEngineOk(), statuses };
  }
  let engineOk = false;
  const results = await Promise.allSettled(
    dirs.map(async (dir) => {
      const map = await ocServer<StatusMap>(dir, "/session/status", {
        timeoutMs: 1500,
      });
      engineOk = true;
      Object.assign(statuses, map);
    }),
  );
  if (!engineOk) {
    // API errors (non-503) still mean the engine itself is up
    engineOk = results.some(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof OcError &&
        r.reason.status !== 503,
    );
  }
  return { engineOk, statuses };
}

/**
 * Fetch each directory's OpenCode session list and collect `Session.cost`
 * (the cumulative USD cost OpenCode itself tracks per session) into a
 * sessionId → cost map. Best-effort: a directory whose engine call fails
 * simply contributes no cost entries, same tolerance as sessionStatusFor.
 */
async function sessionCostFor(dirs: string[]): Promise<CostMap> {
  const costs: CostMap = {};
  if (dirs.length === 0) return costs;
  await Promise.allSettled(
    dirs.map(async (dir) => {
      const sessions = await ocServer<{ id: string; cost?: number }[]>(
        dir,
        "/session",
        { timeoutMs: 1500 },
      );
      for (const s of sessions) {
        if (typeof s.cost === "number") costs[s.id] = s.cost;
      }
    }),
  );
  return costs;
}

function toTask(
  ws: WorkspaceJoinedRow,
  binding: SessionBindingRow | undefined,
  stat: DirStat,
  sessionStatus: SessionStatus | undefined,
  engineOk: boolean,
  cost: number | undefined,
): TaskSummary {
  const status = deriveTaskStatus({
    workspaceStatus: ws.status,
    hasBinding: Boolean(binding),
    sessionStatus,
    engineOk,
    filesChanged: stat.files,
  });

  return {
    id: ws.id,
    projectId: ws.project_id,
    projectName: ws.project_name,
    title: binding?.title || ws.display_name,
    directory: ws.absolute_path,
    isolation: ws.isolation,
    status,
    sessionId: binding?.opencode_session_id ?? null,
    branch: stat.branch,
    additions: stat.additions,
    deletions: stat.deletions,
    filesChanged: stat.files,
    cost,
    createdAt: ws.created_at,
    updatedAt: binding?.updated_at ?? ws.created_at,
  };
}

/**
 * On the first task listing after a (re)start, pull any sessions recorded in
 * project-local manifests back into the DB. Idempotent + memoized per process
 * so it costs nothing on subsequent polls.
 */
let restoredOnce = false;
function restoreFromManifestsOnce(): void {
  if (restoredOnce) return;
  restoredOnce = true;
  try {
    restoreAllKnownProjects();
  } catch {
    /* best-effort; never block task listing */
  }
}

export async function listTasks(): Promise<{
  tasks: TaskSummary[];
  engineOk: boolean;
}> {
  restoreFromManifestsOnce();
  const workspaces = listWorkspacesJoined();
  const bindings = latestBindings();
  const dirs = [...new Set(workspaces.map((w) => w.absolute_path))];

  const [{ engineOk, statuses }, stats, costs] = await Promise.all([
    sessionStatusFor(dirs),
    Promise.all(dirs.map((d) => dirStat(d))),
    sessionCostFor(dirs),
  ]);
  const statByDir = new Map(dirs.map((d, i) => [d, stats[i]]));

  const tasks = workspaces.map((ws) => {
    const binding = bindings.get(ws.id);
    return toTask(
      ws,
      binding,
      statByDir.get(ws.absolute_path) ?? EMPTY_STAT,
      binding ? statuses[binding.opencode_session_id] : undefined,
      engineOk,
      binding ? costs[binding.opencode_session_id] : undefined,
    );
  });

  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { tasks, engineOk };
}

export async function getTask(id: string): Promise<TaskSummary | null> {
  const ws = listWorkspacesJoined().find((w) => w.id === id);
  if (!ws) return null;
  const binding = latestBindings().get(ws.id);
  // Reuse sessionStatusFor so engineOk here matches listTasks exactly: a
  // non-503 API error still means the engine is up. The previous inline fetch
  // treated any /session/status failure as engineOk=false, which made a single
  // task view flip to "unknown" while the task list showed the real status.
  const [stat, { engineOk, statuses }, costs] = await Promise.all([
    dirStat(ws.absolute_path, 3000),
    sessionStatusFor([ws.absolute_path]),
    sessionCostFor([ws.absolute_path]),
  ]);
  const status = binding ? statuses[binding.opencode_session_id] : undefined;
  const cost = binding ? costs[binding.opencode_session_id] : undefined;
  return toTask(ws, binding, stat, status, engineOk, cost);
}
