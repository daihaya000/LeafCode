import { describe, expect, test } from "vitest";
import {
  createWorkflowSseEvent,
  encodeWorkflowHeartbeat,
  encodeWorkflowSseEvent,
} from "./workflow-events";

const workflow = {
  workspaceId: "workspace-1",
  executionMode: "workflow",
  workspaceRevision: 4,
  primarySessionId: "session-1",
  run: { revision: 7 },
} as never;

describe("workflow events", () => {
  test("creates a named event with the workflow revision as SSE id", () => {
    const event = createWorkflowSseEvent("workspace-1", workflow);
    expect(event).toMatchObject({ id: "7", event: "workflow.updated", data: { revision: 7 } });
    expect(encodeWorkflowSseEvent(event)).toContain("event: workflow.updated\n");
    expect(encodeWorkflowSseEvent(event)).toContain('"workspaceId":"workspace-1"');
  });

  test("encodes heartbeat as an SSE comment", () => {
    expect(encodeWorkflowHeartbeat()).toBe(": heartbeat\n\n");
  });
});
