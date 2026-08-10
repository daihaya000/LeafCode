import {
  SessionBindingRow,
  WorkspaceJoinedRow,
  listWorkspacesJoined,
  primaryBindings,
} from "./db";
import { DirStat, dirStat } from "./dirstat";
import { OcError, ocServer } from "./oc-server";
import { SESSION_LIST_PATH, SESSION_STATUS_PATH } from "./opencode-paths";
import { restoreAllKnownProjects } from "./project-session-sync";
import { deriveTaskStatus } from "./task-status";
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
): Promise<MetaMap> {
  const metas: MetaMap = {};
  if (dirs.length === 0) return metas;
  await Promise.allSettled(
    dirs.map(async (dir) => {
      const sessions = await ocServer<
        {
          id: string;
          cost?: number;
          agent?: string;
          model?: { id?: string; providerID?: string; variant?: string };
        }[]
      >(dir, SESSION_LIST_PATH, { timeoutMs: 1500 });
      for (const s of sessions) {
        const meta: SessionMeta = {};
        if (typeof s.cost === "number") meta.cost = s.cost;
        if (typeof s.agent === "string") meta.agent = s.agent;
        if (typeof s.model?.providerID === "string")
          meta.providerID = s.model.providerID;
        if (typeof s.model?.id === "string") meta.modelID = s.model.id;
        if (typeof s.model?.variant === "string") meta.variant = s.model.variant;
        metas[s.id] = meta;
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
}> {
  restoreFromManifestsOnce();
  const workspaces = listWorkspacesJoined().filter(
    (w) => w.status !== "archived",
  );
  const bindings = primaryBindings();
  const dirs = [...new Set(workspaces.map((w) => w.absolute_path))];

  const [{ engineOk, statuses }, stats, metas] = await Promise.all([
    sessionStatusFor(dirs),
    Promise.all(dirs.map((d) => dirStat(d))),
    sessionMetaFor(dirs),
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
  return { tasks, engineOk };
}

export async function listArchivedTasks(): Promise<TaskSummary[]> {
  const workspaces = listWorkspacesJoined().filter(
    (ws) => ws.status === "archived",
  );
  if (workspaces.length === 0) return [];
  const bindings = primaryBindings();
  const dirs = [...new Set(workspaces.map((w) => w.absolute_path))];

  const [{ engineOk, statuses }, stats, metas] = await Promise.all([
    sessionStatusFor(dirs),
    Promise.all(dirs.map((d) => dirStat(d))),
    sessionMetaFor(dirs),
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
    sessionMetaFor([ws.absolute_path]),
  ]);
  const status = binding ? statuses[binding.opencode_session_id] : undefined;
  const meta = binding ? metas[binding.opencode_session_id] : undefined;
  return toTask(ws, binding, stat, status, engineOk, meta);
}
