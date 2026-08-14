import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const { ocServer, runGit } = vi.hoisted(() => ({ ocServer: vi.fn(), runGit: vi.fn() }));
vi.mock("./oc-server", async () => {
  const actual = await vi.importActual<typeof import("./oc-server")>("./oc-server");
  return { ...actual, ocServer };
});
vi.mock("./git", () => ({ runGit }));
const { browserBrokerFetch } = vi.hoisted(() => ({ browserBrokerFetch: vi.fn() }));
vi.mock("./browser-bridge", () => ({ browserBrokerFetch }));

const dataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-workflow-e2e-"));
const previousAppData = process.env.APPDATA;
process.env.APPDATA = dataDir;
process.env.OPENCODE_WEBUI_WORKFLOW_MODE = "true";
process.env.OPENCODE_WEBUI_BROWSER_BROKER_TOKEN = "x".repeat(40);

const { bindSession, createWorkspace, getDb, getWorkspace, upsertProject } = await import("./db");
const { createWorkflow, getWorkflow, updateWorkflow } = await import("./workflow-service");
const { getOrMaterializeWorkflowGraph } = await import("./workflow-graph-repository");
const { saveWorkflowArtifact, verifyBrowserBridgeScreenshot, workflowArtifactsForPrompt } = await import("./workflow-artifacts");
const { runWorkflowSchedulerTick } = await import("./workflow-scheduler");

let broker: http.Server;
let brokerUrl = "";
const responses = new Map<string, unknown[]>();
let reviewerNumber = 0;

function resultMessage(marker: string, id: string, value: object) {
  return [{
    info: { id, role: "assistant", time: { created: 10, completed: 20 }, tokens: { total: 10, input: 4, output: 4, reasoning: 2 }, cost: 0.01 },
    parts: [{ id: `${id}-part`, messageID: id, type: "text", text: `<!-- webui-workflow-result:${marker} -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` }],
  }];
}

function setupWorkspace(id: string): number {
  const project = upsertProject({ name: id, rootPath: dataDir });
  createWorkspace({ id, projectId: project.id, displayName: id, absolutePath: dataDir, isolation: "current_folder" });
  bindSession(id, `primary-${id}`, "Implement");
  return getWorkspace(id)!.revision;
}

beforeAll(async () => {
  broker = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ tabs: [{ id: "tab-e2e", origin: "https://preview.test", title: "Preview" }] }));
  });
  await new Promise<void>((resolve) => broker.listen(0, "127.0.0.1", resolve));
  const address = broker.address();
  if (!address || typeof address === "string") throw new Error("broker did not start");
  brokerUrl = `http://127.0.0.1:${address.port}`;
  process.env.OPENCODE_WEBUI_BROWSER_BROKER = brokerUrl;
  browserBrokerFetch.mockImplementation((requestPath: string, init?: RequestInit) =>
    fetch(`${brokerUrl}${requestPath}`, { method: init?.method, headers: init?.headers, body: init?.body }),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  responses.clear();
  reviewerNumber = 0;
  runGit.mockImplementation(async (_directory: string, args: string[]) =>
    args[0] === "rev-parse" ? { code: 0, stdout: "head-e2e\n", stderr: "" } : { code: 0, stdout: " M src/App.tsx\n", stderr: "" },
  );
  ocServer.mockImplementation(async (_directory: string, requestPath: string, init?: { method?: string }) => {
    if (requestPath === "/session" && init?.method === "POST") {
      reviewerNumber += 1;
      return { id: `reviewer-${reviewerNumber}` };
    }
    const match = /\/session\/([^/]+)\/message$/.exec(requestPath);
    if (match) return responses.get(decodeURIComponent(match[1])) ?? [];
    return {};
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => broker.close(() => resolve()));
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  delete process.env.OPENCODE_WEBUI_BROWSER_BROKER;
  delete process.env.OPENCODE_WEBUI_BROWSER_BROKER_TOKEN;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Workflow full execution integration", () => {
  test("runs Implement, parallel reviewers, feedback loop, and final Gate with a Browser Bridge artifact", async () => {
    const workspaceId = "workflow-full-e2e";
    const workspaceRevision = setupWorkspace(workspaceId);
    createWorkflow({ workspaceId, workspaceRevision, taskContext: { goal: "Build UI", acceptance: ["renders"], constraints: [] } });
    updateWorkflow({ workspaceId, action: "start", workflowRevision: 0 });

    await runWorkflowSchedulerTick();
    let workflow = getWorkflow(workspaceId)!;
    const implement = workflow.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts.at(-1)!;
    const firstImplementResponse = resultMessage(implement.promptMarker!, "implement-1", { status: "completed", summary: "implemented", evidence: ["tests"] });
    responses.set(implement.opencodeSessionId!, firstImplementResponse);
    await runWorkflowSchedulerTick();

    workflow = getWorkflow(workspaceId)!;
    const visualJudge = workflow.nodes.find((node) => node.nodeKey === "visual_judge")!.attempts.at(-1)!;
    const verifiedTab = await verifyBrowserBridgeScreenshot({ tabId: "tab-e2e", opaqueRef: "browser-bridge:tab-e2e", expectedOrigin: "https://preview.test" });
    saveWorkflowArtifact({ workflowRunId: workflow.run!.id, nodeAttemptId: visualJudge.id, kind: "screenshot", label: verifiedTab.title, opaqueRef: "browser-bridge:tab-e2e", origin: "browser_bridge", metadata: { tabId: "tab-e2e", origin: verifiedTab.origin } });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM workflow_artifacts WHERE workflow_run_id = ?").get(workflow.run!.id)).toEqual({ count: 1 });
    expect(workflowArtifactsForPrompt(workflow.run!.id)).toHaveLength(1);
    await runWorkflowSchedulerTick();
    const firstDispatchWorkflow = getWorkflow(workspaceId)!;
    expect(firstDispatchWorkflow.run?.status, `${firstDispatchWorkflow.run?.pauseReason} ${JSON.stringify(firstDispatchWorkflow.nodes)}`).toBe("running");
    const dispatchedCodeReview = firstDispatchWorkflow.nodes.find((node) => node.nodeKey === "code_review")!.attempts.at(-1)!;
    const dispatchedVisualJudge = firstDispatchWorkflow.nodes.find((node) => node.nodeKey === "visual_judge")!.attempts.at(-1)!;
    responses.set(dispatchedCodeReview.opencodeSessionId!, resultMessage(dispatchedCodeReview.promptMarker!, "review-1", { verdict: "needs_changes", summary: "fix spacing", evidence: ["review"], findings: [{ id: "spacing", severity: "major", title: "Fix spacing", detail: "Update the layout." }] }));
    responses.set(dispatchedVisualJudge.opencodeSessionId!, resultMessage(dispatchedVisualJudge.promptMarker!, "visual-1", { verdict: "pass", summary: "looks good", evidence: ["screenshot"], findings: [] }));
    await runWorkflowSchedulerTick();

    workflow = getWorkflow(workspaceId)!;
    expect(workflow.run?.status, workflow.run?.pauseReason).toBe("running");
    const retryImplement = workflow.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts.at(-1)!;
    expect(retryImplement.attemptNo, `${workflow.run?.pauseReason} ${JSON.stringify(workflow.nodes.map((node) => [node.nodeKey, node.attempts.at(-1)?.status, node.attempts.at(-1)?.result]))}`).toBe(2);
    await runWorkflowSchedulerTick();
    const dispatchedRetry = getWorkflow(workspaceId)!.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts.at(-1)!;
    responses.set(dispatchedRetry.opencodeSessionId!, [...firstImplementResponse, ...resultMessage(dispatchedRetry.promptMarker!, "implement-2", { status: "completed", summary: "fixed", evidence: ["tests"] })]);
    await runWorkflowSchedulerTick();
    workflow = getWorkflow(workspaceId)!;
    await runWorkflowSchedulerTick();
    workflow = getWorkflow(workspaceId)!;
    const dispatchedSecondCode = workflow.nodes.find((node) => node.nodeKey === "code_review")!.attempts.at(-1)!;
    const dispatchedSecondVisual = workflow.nodes.find((node) => node.nodeKey === "visual_judge")!.attempts.at(-1)!;
    responses.set(dispatchedSecondCode.opencodeSessionId!, resultMessage(dispatchedSecondCode.promptMarker!, "review-2", { verdict: "pass", summary: "pass", evidence: ["tests"], findings: [] }));
    responses.set(dispatchedSecondVisual.opencodeSessionId!, resultMessage(dispatchedSecondVisual.promptMarker!, "visual-2", { verdict: "pass", summary: "pass", evidence: ["screenshot"], findings: [] }));
    await runWorkflowSchedulerTick();

    const finalWorkflow = getWorkflow(workspaceId)!;
    expect(finalWorkflow.run?.status, `${finalWorkflow.run?.pauseReason} ${JSON.stringify(finalWorkflow.nodes.map((node) => [node.nodeKey, node.attempts.at(-1)?.status, node.attempts.at(-1)?.result]))}`).toBe("completed");
    expect(getWorkflow(workspaceId)!.nodes.find((node) => node.nodeKey === "code_review")!.attempts).toHaveLength(2);
    expect(getWorkflow(workspaceId)!.nodes.find((node) => node.nodeKey === "visual_judge")!.attempts).toHaveLength(2);
  });

  test("runs the same path through a published v2 snapshot and Executor Registry", async () => {
    const workspaceId = "workflow-v2-e2e";
    const workspaceRevision = setupWorkspace(workspaceId);
    const created = createWorkflow({ workspaceId, workspaceRevision, taskContext: { goal: "Build UI", acceptance: ["renders"], constraints: [] } });
    getOrMaterializeWorkflowGraph(workspaceId);
    updateWorkflow({ workspaceId, action: "start", workflowRevision: created.run!.revision, workspaceRevision: created.workspaceRevision });

    await runWorkflowSchedulerTick();
    let workflow = getWorkflow(workspaceId)!;
    const implement = workflow.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts.at(-1)!;
    responses.set(implement.opencodeSessionId!, resultMessage(implement.promptMarker!, "v2-implement", { status: "completed", summary: "implemented", evidence: ["tests"] }));
    await runWorkflowSchedulerTick();
    workflow = getWorkflow(workspaceId)!;
    const visual = workflow.nodes.find((node) => node.nodeKey === "visual_judge")!.attempts.at(-1)!;
    saveWorkflowArtifact({ workflowRunId: workflow.run!.id, nodeAttemptId: visual.id, kind: "screenshot", label: "v2 preview", opaqueRef: "browser-bridge:tab-e2e", origin: "browser_bridge", metadata: { tabId: "tab-e2e", origin: "https://preview.test" } });
    await runWorkflowSchedulerTick();
    workflow = getWorkflow(workspaceId)!;
    const code = workflow.nodes.find((node) => node.nodeKey === "code_review")!.attempts.at(-1)!;
    const visualJudge = workflow.nodes.find((node) => node.nodeKey === "visual_judge")!.attempts.at(-1)!;
    responses.set(code.opencodeSessionId!, resultMessage(code.promptMarker!, "v2-code", { verdict: "pass", summary: "pass", evidence: ["tests"], findings: [] }));
    responses.set(visualJudge.opencodeSessionId!, resultMessage(visualJudge.promptMarker!, "v2-visual", { verdict: "pass", summary: "pass", evidence: ["screenshot"], findings: [] }));
    await runWorkflowSchedulerTick();

    const finalWorkflow = getWorkflow(workspaceId)!;
    expect(finalWorkflow.run?.status, finalWorkflow.run?.pauseReason).toBe("completed");
    expect(finalWorkflow.run?.definitionSnapshot).toMatchObject({ schemaVersion: "workflow-execution-v2" });
    expect(finalWorkflow.nodes.find((node) => node.nodeKey === "review_gate")?.attempts.at(-1)).toMatchObject({ status: "succeeded", opencodeSessionId: null });
  });
});
