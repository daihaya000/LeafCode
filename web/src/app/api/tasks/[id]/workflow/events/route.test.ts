// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getWorkflowMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workflow-service", () => ({ getWorkflow: getWorkflowMock }));

import { GET } from "./route";

function workflowAt(revision: number) {
  return { workspaceRevision: revision, run: null } as never;
}

async function readFirstChunk(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe("GET /api/tasks/[id]/workflow/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes the initial snapshot on first connect for a brand-new workflow at revision 0", async () => {
    // Regression: Number("") is 0 (not NaN), so treating a missing
    // last-event-id header the same as `Number(header ?? "")` made revision 0
    // look already-seen and the first event was silently dropped.
    getWorkflowMock.mockReturnValue(workflowAt(0));
    const req = new Request("http://localhost/api/tasks/t1/workflow/events", { headers: { host: "127.0.0.1:3000" } });
    const res = await GET(req, { params: Promise.resolve({ id: "t1" }) });

    const chunk = await readFirstChunk(res);
    expect(chunk).toContain("event: workflow.updated");
    expect(chunk).toContain('"revision":0');
  });

  it("still suppresses a duplicate publish when last-event-id matches the current revision", async () => {
    getWorkflowMock.mockReturnValue(workflowAt(3));
    const req = new Request("http://localhost/api/tasks/t1/workflow/events", {
      headers: { host: "127.0.0.1:3000", "last-event-id": "3" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "t1" }) });

    const reader = res.body!.getReader();
    const raced = await Promise.race([
      reader.read().then(() => "event"),
      new Promise((r) => setTimeout(() => r("timeout"), 50)),
    ]);
    await reader.cancel();
    expect(raced).toBe("timeout");
  });
});
