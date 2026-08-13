import type { TaskSummary } from "@/lib/types";

/**
 * Session metadata cache shared by the sidebar and the task view.
 *
 * The sidebar fetches the full task list (`/api/tasks`) at startup/poll, so
 * the latest N task summaries are warmed here for free. TaskView seeds its
 * header (title / status) from this cache on mount, making the first paint of
 * a recently-used task render without waiting on `/api/tasks/:id`.
 *
 * LRU-like: `remember` moves the entry to the tail; reads bump it as well;
 * the map is capped so warm data cannot grow unbounded.
 */
const TASK_CACHE_MAX = 24;

const taskSummaryCache = new Map<string, TaskSummary>();

export function rememberTaskSummary(task: TaskSummary) {
  taskSummaryCache.delete(task.id);
  taskSummaryCache.set(task.id, task);
  while (taskSummaryCache.size > TASK_CACHE_MAX) {
    const oldest = taskSummaryCache.keys().next().value;
    if (typeof oldest !== "string") break;
    taskSummaryCache.delete(oldest);
  }
}

export function readCachedTaskSummary(taskId: string): TaskSummary | null {
  const cached = taskSummaryCache.get(taskId);
  if (!cached) return null;
  taskSummaryCache.delete(taskId);
  taskSummaryCache.set(taskId, cached);
  return cached;
}

/**
 * Warm the cache with the most recently updated `count` tasks so TaskView can
 * paint their title/status instantly. Callers pass the task list exactly as it
 * comes back from `/api/tasks` (listing needed for status/cost); ordering is
 * derived here rather than assumed.
 */
export function prefetchTaskSummaries(tasks: TaskSummary[], count = 5): void {
  const recent = [...tasks]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, count);
  for (const task of recent) {
    rememberTaskSummary(task);
  }
}

export function __clearTaskSummaryCacheForTest(): void {
  taskSummaryCache.clear();
}