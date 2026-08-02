import { expect, test } from "@playwright/test";

const task = {
  id: "workflow-graph-e2e",
  projectId: "project-graph",
  projectName: "Graph fixture",
  title: "Graph E2E fixture",
  directory: "C:\\workflow-graph-fixture",
  isolation: "current_folder",
  status: "ready",
  sessionId: "session-primary",
  executionMode: "workflow",
  favorite: false,
  branch: "main",
  additions: 0,
  deletions: 0,
  filesChanged: 0,
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

const workflow = {
  workspaceId: task.id,
  executionMode: "workflow",
  workspaceRevision: 2,
  primarySessionId: task.sessionId,
  run: { id: "graph-run-1", status: "running", revision: 4, pauseReason: "", cycleCount: 0, maxCycles: 3 },
  nodes: [
    { nodeKey: "implement_ui", kind: "implement", latestAttemptNo: 1, config: {}, attempts: [{ status: "succeeded", dispatchStatus: "result_received", opencodeSessionId: task.sessionId }] },
    { nodeKey: "code_review", kind: "review", latestAttemptNo: 1, config: {}, attempts: [{ status: "running", dispatchStatus: "awaiting_result", opencodeSessionId: "session-review" }] },
    { nodeKey: "visual_judge", kind: "review", latestAttemptNo: 0, config: {}, attempts: [] },
    { nodeKey: "review_gate", kind: "control", latestAttemptNo: 0, config: {}, attempts: [] },
  ],
};

const graph = {
  id: "graph-e2e-1",
  workspaceId: task.id,
  schemaVersion: "workflow-graph-v1",
  graphRevision: 3,
  registryVersion: "workflow-node-registry-v1",
  nodes: [
    { id: "implement_ui", type: "opencode.implement_ui", typeVersion: 1, label: "Implement UI", position: { x: 0, y: 0 }, config: {}, disabled: false },
    { id: "code_review", type: "opencode.code_review", typeVersion: 1, label: "Code Review", position: { x: 300, y: 0 }, config: {}, disabled: false },
    { id: "visual_judge", type: "opencode.visual_judge", typeVersion: 1, label: "Visual Judge", position: { x: 300, y: 160 }, config: {}, disabled: false },
    { id: "review_gate", type: "control.review_gate", typeVersion: 1, label: "Review Gate", position: { x: 600, y: 80 }, config: {}, disabled: false },
  ],
  edges: [
    { id: "i-code", source: "implement_ui", sourceHandle: "result", target: "code_review", targetHandle: "implementation", kind: "dependency" },
    { id: "i-visual", source: "implement_ui", sourceHandle: "result", target: "visual_judge", targetHandle: "implementation", kind: "dependency" },
    { id: "code-gate", source: "code_review", sourceHandle: "result", target: "review_gate", targetHandle: "code_review", kind: "control" },
    { id: "visual-gate", source: "visual_judge", sourceHandle: "result", target: "review_gate", targetHandle: "visual_judge", kind: "control" },
  ],
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
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
    if (url.pathname === `/api/tasks/${task.id}/workflow/graph`) return route.fulfill({ json: { graph } });
    if (url.pathname === `/api/tasks/${task.id}/workflow`) return route.fulfill({ json: { workflow } });
    if (url.pathname === `/api/tasks/${task.id}/workflow/events`) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": heartbeat\n\n" });
    if (url.pathname === "/api/tasks") return route.fulfill({ json: { tasks: [task] } });
    if (url.pathname.includes("/api/opencode/provider")) return route.fulfill({ json: { all: [], connected: [], default: {} } });
    if (url.pathname.includes("/api/opencode/config")) return route.fulfill({ json: { model: "", agent: "build" } });
    if (url.pathname.includes("/api/opencode/agent")) return route.fulfill({ json: [{ name: "build" }] });
    if (url.pathname.includes("/api/extensions/provider-models")) return route.fulfill({ json: { providers: [] } });
    if (url.pathname.includes("/api/addons/codexbar/")) return route.fulfill({ json: { providers: [] } });
    return route.fulfill({ json: {} });
  });
});

test("renders Graph Draft and keeps it within the viewport", async ({ page }) => {
  await page.goto(`/task/${task.id}`);
  await expect(page.getByRole("heading", { name: "Workflow Graph" })).toBeVisible();
  await expect(page.getByTestId("workflow-graph-canvas")).toBeVisible();
  await expect(page.getByRole("region", { name: "Graph Editor" })).toHaveCount(0);
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
