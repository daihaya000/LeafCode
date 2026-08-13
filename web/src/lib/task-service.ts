import {
  SessionBindingRow,
  WorkspaceJoinedRow,
  listWorkspacesJoined,
  primaryBindings,
} from "./db";
import { DirStat, dirStat } from "./dirstat";
import { OcError, ocServer } from "./oc-server";
import {
  SESSION_LIST_PATH,
  SESSION_STATUS_PATH,
  activeSessionGetPath,
} from "./opencode-paths";
import { restoreAllKnownProjects } from "./project-session-sync";
import { deriveTaskStatus } from "./task-status";
import {
  estimateSessionCostWithCache,
  SESSION_COST_FETCH_CONCURRENCY,
  type SessionEntry,
  type SessionUsage,
} from "./task-cost";
export { __clearSessionEstimateCacheForTest } from "./task-cost";
import type { SessionStatus, TaskSummary } from "./types";

type StatusMap = Record<string, SessionStatus>;

/** Per-session metadata collected from a single /session listing. */
type SessionMeta = {
  cost?: number;
  agent?: string;
  providerID?: string;
  modelID?: string;
  variant?: string;
};
type MetaMap = Record<string, SessionMeta>;


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
      const map = await ocServer<StatusMap>(dir, SESSION_STATUS_PATH, {
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
 * Fetch each directory's OpenCode session list once and collect per-session
 * metadata (cumulative `Session.cost`, bound `Session.agent`, and the current
 * `Session.model` provider/id) into a sessionId → SessionMeta map. A single
 * /session call feeds all fields — no double fetching. Best-effort: a
 * directory whose engine call fails simply contributes no entries, same
 * tolerance as sessionStatusFor.
 */
async function sessionMetaFor(
  dirs: string[],
  trackedSessionIds: ReadonlySet<string>,
): Promise<MetaMap> {
  const metas: MetaMap = {};
  if (dirs.length === 0) return metas;
  await Promise.allSettled(
    dirs.map(async (dir) => {
      const sessions = await ocServer<SessionEntry[]>(dir, SESSION_LIST_PATH, {
        timeoutMs: 1500,
      });
      const estimateCandidates: Array<{
        session: SessionEntry;
        meta: SessionMeta;
      }> = [];
      for (const s of sessions) {
        const meta: SessionMeta = {};
        if (typeof s.cost === "number" && Number.isFinite(s.cost) && s.cost >= 0) {
          meta.cost = s.cost;
        }
        if (typeof s.agent === "string") meta.agent = s.agent;
        if (typeof s.model?.providerID === "string")
          meta.providerID = s.model.providerID;
        if (typeof s.model?.id === "string") meta.modelID = s.model.id;
        if (typeof s.model?.variant === "string") meta.variant = s.model.variant;
        if ((meta.cost ?? 0) <= 0 && trackedSessionIds.has(s.id)) {
          estimateCandidates.push({ session: s, meta });
        }
        metas[s.id] = meta;
      }

      // Fetch transcript-based estimates in small parallel batches. The old
      // loop awaited each /message call before starting the next one, so a
      // directory with many zero-cost sessions made task listing grow with
      // the sum of all transcript latencies.
      for (
        let i = 0;
        i < estimateCandidates.length;
        i += SESSION_COST_FETCH_CONCURRENCY
      ) {
        await Promise.all(
          estimateCandidates
            .slice(i, i + SESSION_COST_FETCH_CONCURRENCY)
            .map(async ({ session, meta }) => {
              const estimated = await estimateSessionCostWithCache(dir, session);
              if (estimated !== null) meta.cost = estimated;
            }),
        );
      }
    }),
  );
  return metas;
}

function toTask(
  ws: WorkspaceJoinedRow,
  binding: SessionBindingRow | undefined,
  stat: DirStat,
  sessionStatus: SessionStatus | undefined,
  engineOk: boolean,
  meta: SessionMeta | undefined,
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
    executionMode: ws.execution_mode,
    favorite: binding?.favorite === 1,
    branch: stat.branch,
    additions: stat.additions,
    deletions: stat.deletions,
    filesChanged: stat.files,
    cost: meta?.cost,
    agent: meta?.agent,
    providerID: meta?.providerID,
    modelID: meta?.modelID,
    variant: meta?.variant,
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
  archivedCount: number;
}> {
  restoreFromManifestsOnce();
  const allWorkspaces = listWorkspacesJoined();
  const archivedCount = allWorkspaces.filter(
    (w) => w.status === "archived",
  ).length;
  const workspaces = allWorkspaces.filter(
    (w) => w.status !== "archived",
  );
  const bindings = primaryBindings();
  const dirs = [...new Set(workspaces.map((w) => w.absolute_path))];

  // Fast path for a fresh install / empty task list: skip the per-directory
  // /session + /session/status fan-out (each round-trips to the OpenCode
  // engine) and only confirm the engine is reachable. Cuts the Home boot API
  // call from ~340ms to a single /global/health check when no workspaces exist.
  if (dirs.length === 0) {
    return { tasks: [], engineOk: await globalEngineOk(), archivedCount };
  }

  const [{ engineOk, statuses }, stats, metas] = await Promise.all([
    sessionStatusFor(dirs),
    Promise.all(dirs.map((d) => dirStat(d))),
    sessionMetaFor(
      dirs,
      new Set([...bindings.values()].map((binding) => binding.opencode_session_id)),
    ),
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
      binding ? metas[binding.opencode_session_id] : undefined,
    );
  });

  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { tasks, engineOk, archivedCount };
}

export async function listArchivedTasks(): Promise<TaskSummary[]> {
  const workspaces = listWorkspacesJoined().filter(
    (ws) => ws.status === "archived",
  );
  if (workspaces.length === 0) return [];
  const bindings = primaryBindings();
  const dirs = [...new Set(workspaces.map((w) => w.absolute_path))];

  // Archived sidebar rows do not need live session or transcript metadata.
  // The task view fetches full details after navigation, so only local git
  // data is needed here for the branch label.
  const stats = await Promise.all(dirs.map((d) => dirStat(d)));
  const statByDir = new Map(dirs.map((d, i) => [d, stats[i]]));

  const tasks = workspaces.map((ws) => {
    const binding = bindings.get(ws.id);
    return toTask(
      ws,
      binding,
      statByDir.get(ws.absolute_path) ?? EMPTY_STAT,
      undefined,
      true,
      undefined,
    );
  });

  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return tasks;
}

export async function getTask(id: string): Promise<TaskSummary | null> {
  const ws = listWorkspacesJoined().find((w) => w.id === id);
  if (!ws) return null;
  const binding = primaryBindings().get(ws.id);
  // Reuse sessionStatusFor so engineOk here matches listTasks exactly: a
  // non-503 API error still means the engine is up. The previous inline fetch
  // treated any /session/status failure as engineOk=false, which made a single
  // task view flip to "unknown" while the task list showed the real status.
  const [stat, { engineOk, statuses }, metas] = await Promise.all([
    dirStat(ws.absolute_path, 3000),
    sessionStatusFor([ws.absolute_path]),
    sessionMetaFor(
      [ws.absolute_path],
      new Set(binding ? [binding.opencode_session_id] : []),
    ),
  ]);
  const status = binding ? statuses[binding.opencode_session_id] : undefined;
  const meta = binding ? metas[binding.opencode_session_id] : undefined;
  return toTask(ws, binding, stat, status, engineOk, meta);
}

/** Fetch only the authoritative cumulative cost for a task session. */
export async function getTaskCost(id: string): Promise<number | undefined> {
  const ws = listWorkspacesJoined().find((w) => w.id === id);
  if (!ws) return undefined;
  const binding = primaryBindings().get(id);
  if (!binding) return undefined;
  let session: SessionUsage;
  try {
    session = await ocServer<SessionUsage>(
      ws.absolute_path,
      activeSessionGetPath(binding.opencode_session_id),
      { timeoutMs: 1500 },
    );
  } catch {
    // Live cost polling is best-effort. A busy/slow engine must not surface a
    // 408 from `/api/tasks/:id/cost` or flood the host log; clients keep the
    // last known cost (TaskView / Sidebar already ignore refresh failures).
    return undefined;
  }
  const reportedCost =
    typeof session.cost === "number" && Number.isFinite(session.cost) && session.cost >= 0
      ? session.cost
      : undefined;
  if (reportedCost !== undefined && reportedCost > 0) return reportedCost;
  return (
    (await estimateSessionCostWithCache(ws.absolute_path, {
      ...session,
      id: binding.opencode_session_id,
    })) ?? reportedCost
  );
}
