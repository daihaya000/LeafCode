import {
  SessionBindingRow,
  WorkspaceJoinedRow,
  latestBindings,
  listWorkspacesJoined,
} from "./db";
import { DirStat, dirStat } from "./dirstat";
import { OcError, ocServer } from "./oc-server";
import { deriveTaskStatus } from "./task-status";
import type { SessionStatus, TaskSummary } from "./types";

type StatusMap = Record<string, SessionStatus>;

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

function toTask(
  ws: WorkspaceJoinedRow,
  binding: SessionBindingRow | undefined,
  stat: DirStat,
  sessionStatus: SessionStatus | undefined,
  engineOk: boolean,
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
    createdAt: ws.created_at,
    updatedAt: binding?.updated_at ?? ws.created_at,
  };
}

export async function listTasks(): Promise<{
  tasks: TaskSummary[];
  engineOk: boolean;
}> {
  const workspaces = listWorkspacesJoined();
  const bindings = latestBindings();
  const dirs = [...new Set(workspaces.map((w) => w.absolute_path))];

  const [{ engineOk, statuses }, stats] = await Promise.all([
    sessionStatusFor(dirs),
    Promise.all(dirs.map((d) => dirStat(d))),
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
    );
  });

  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { tasks, engineOk };
}

export async function getTask(id: string): Promise<TaskSummary | null> {
  const ws = listWorkspacesJoined().find((w) => w.id === id);
  if (!ws) return null;
  const binding = latestBindings().get(ws.id);
  const [stat, statusResult] = await Promise.all([
    dirStat(ws.absolute_path, 3000),
    binding
      ? ocServer<StatusMap>(ws.absolute_path, "/session/status", {
          timeoutMs: 1500,
        }).then(
          (m) => ({ ok: true as const, status: m[binding.opencode_session_id] }),
          () => ({ ok: false as const, status: undefined }),
        )
      : Promise.resolve({ ok: true as const, status: undefined }),
  ]);
  return toTask(ws, binding, stat, statusResult.status, statusResult.ok);
}
