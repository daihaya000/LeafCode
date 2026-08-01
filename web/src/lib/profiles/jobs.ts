import { randomBytes } from "node:crypto";

export type JobKind = "duplicate" | "migrate";
export type JobState = "running" | "done" | "error";

export type Job = {
  id: string;
  kind: JobKind;
  state: JobState;
  copied: number;
  total: number;
  /** Non-fatal remark, e.g. symlinks had to be dereferenced. */
  note?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

export type JobProgress = {
  setTotal: (total: number) => void;
  setCopied: (copied: number) => void;
};

/** Jobs live in memory only; a WebUI restart forgets them by design. */
const jobs = new Map<string, Job>();
const MAX_RETAINED_JOBS = 20;
let runningJobId: string | null = null;

export function isBusy(): boolean {
  return runningJobId !== null;
}

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}

/** Test helper: drop all state between cases. */
export function resetJobs(): void {
  jobs.clear();
  runningJobId = null;
}

function prune(): void {
  if (jobs.size <= MAX_RETAINED_JOBS) return;
  const finished = Array.from(jobs.values())
    .filter((job) => job.state !== "running")
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  while (jobs.size > MAX_RETAINED_JOBS && finished.length > 0) {
    jobs.delete(finished.shift()!.id);
  }
}

/**
 * Start a background copy job.
 *
 * Only one job may run at a time: concurrent copies would race on the same
 * profile directories and make progress meaningless. The returned job is
 * available immediately so the caller can hand the id to the client.
 */
export function startJob(
  kind: JobKind,
  run: (progress: JobProgress) => Promise<string | void>,
): Job {
  if (runningJobId !== null) {
    throw new Error("別の処理が進行中です。完了してから再試行してください。");
  }

  const job: Job = {
    id: randomBytes(8).toString("hex"),
    kind,
    state: "running",
    copied: 0,
    total: 0,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  runningJobId = job.id;

  const progress: JobProgress = {
    setTotal: (total) => {
      job.total = total;
    },
    setCopied: (copied) => {
      job.copied = copied;
    },
  };

  void (async () => {
    try {
      const note = await run(progress);
      job.state = "done";
      if (typeof note === "string" && note) job.note = note;
    } catch (err) {
      job.state = "error";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.finishedAt = Date.now();
      runningJobId = null;
      prune();
    }
  })();

  return job;
}
