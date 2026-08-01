import { beforeEach, describe, expect, it } from "vitest";
import { getJob, isBusy, resetJobs, startJob } from "./jobs";

beforeEach(() => {
  resetJobs();
});

function waitForDone(id: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const job = getJob(id);
      if (!job) return reject(new Error("job disappeared"));
      if (job.state !== "running") return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(check, 10);
    };
    check();
  });
}

describe("startJob", () => {
  it("transitions running → done and records progress", async () => {
    const job = startJob("duplicate", async (progress) => {
      progress.setTotal(10);
      progress.setCopied(5);
      progress.setCopied(10);
    });

    expect(job.state).toBe("running");
    expect(isBusy()).toBe(true);

    await waitForDone(job.id);

    const done = getJob(job.id)!;
    expect(done.state).toBe("done");
    expect(done.total).toBe(10);
    expect(done.copied).toBe(10);
    expect(done.finishedAt).toBeTypeOf("number");
    expect(isBusy()).toBe(false);
  });

  it("records a note when the run returns a string", async () => {
    const job = startJob("migrate", async () => "symlinks were dereferenced");
    await waitForDone(job.id);
    expect(getJob(job.id)!.note).toBe("symlinks were dereferenced");
  });

  it("transitions to error and captures the message", async () => {
    const job = startJob("duplicate", async () => {
      throw new Error("disk full");
    });
    await waitForDone(job.id);

    const failed = getJob(job.id)!;
    expect(failed.state).toBe("error");
    expect(failed.error).toBe("disk full");
    expect(isBusy()).toBe(false);
  });

  it("rejects a second concurrent job", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = startJob("duplicate", () => gate);
    expect(isBusy()).toBe(true);

    expect(() => startJob("migrate", async () => {})).toThrow(/進行中/);

    release();
    await waitForDone(first.id);
    expect(isBusy()).toBe(false);
  });

  it("allows a new job after the previous one finishes", async () => {
    const first = startJob("duplicate", async () => {});
    await waitForDone(first.id);

    const second = startJob("migrate", async () => {});
    await waitForDone(second.id);

    expect(getJob(second.id)!.state).toBe("done");
  });

  it("returns null for an unknown job id", () => {
    expect(getJob("nonexistent")).toBeNull();
  });
});
