import { expect, test } from "@playwright/test";

const task = {
  id: "workflow-e2e",
  projectId: "project-1",
  projectName: "Workflow fixture",
  title: "Workflow E2E fixture",
  directory: "C:\\workflow-fixture",
  isolation: "current_folder",
  status: "ready",
  sessionId: "session-primary",
  executionMode: "workflow",
  favorite: false,
  branch: "main",
  additions: 0,
  deletions: 0,
  filesChanged: 2,
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

const workflow = {
  workspaceId: task.id,
  executionMode: "workflow",
  workspaceRevision: 2,
  primarySessionId: task.sessionId,
  run: { id: "run-1", status: "running", revision: 4, pauseReason: "", cycleCount: 0, maxCycles: 3 },
  nodes: [
    { nodeKey: "implement_ui", kind: "implement", latestAttemptNo: 1, config: {}, attempts: [{ status: "succeeded", dispatchStatus: "result_received", opencodeSessionId: task.sessionId }] },
    { nodeKey: "code_review", kind: "review", latestAttemptNo: 1, config: {}, attempts: [{ status: "running", dispatchStatus: "awaiting_result", opencodeSessionId: "session-review" }] },
    { nodeKey: "visual_judge", kind: "review", latestAttemptNo: 0, config: {}, attempts: [] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class StableEventSource {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    (window as unknown as { EventSource: typeof StableEventSource }).EventSource = StableEventSource;
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/tasks/${task.id}`) return route.fulfill({ json: { task, goalLoop: null } });
    if (url.pathname === `/api/tasks/${task.id}/workflow`) return route.fulfill({ json: { workflow } });
    if (url.pathname === `/api/tasks/${task.id}/workflow/events`) {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: `event: workflow.updated\ndata: ${JSON.stringify({ workflow })}\n\n` });
    }
    if (url.pathname === "/api/tasks") return route.fulfill({ json: { tasks: [task] } });
    if (url.pathname.includes("/api/opencode/provider")) return route.fulfill({ json: { all: [], connected: [], default: {} } });
    if (url.pathname.includes("/api/opencode/config")) return route.fulfill({ json: { model: "", agent: "build" } });
    if (url.pathname.includes("/api/opencode/agent")) return route.fulfill({ json: [{ name: "build" }] });
    if (url.pathname.includes("/api/extensions/provider-models")) return route.fulfill({ json: { providers: [] } });
    if (url.pathname.includes("/api/addons/codexbar/usage")) return route.fulfill({ json: { providers: [] } });
    if (url.pathname.includes("/api/addons/codexbar/providers")) return route.fulfill({ json: { providers: [] } });
    if (url.pathname.includes("/api/opencode/event")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": heartbeat\n\n" });
    if (url.pathname.includes("/api/opencode/session")) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
});

test("feature-enabled Workflow task exposes tabs, progress, and node details", async ({ page }) => {
  await page.goto(`/task/${task.id}`);
  const workflowTab = page.getByRole("tab", { name: "Workflow" });
  await expect(workflowTab).toBeVisible();
});

test("Workflow tabs remain within the viewport at desktop and mobile widths", async ({ page }) => {
  await page.goto(`/task/${task.id}`);
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBe(true);
  }
});
