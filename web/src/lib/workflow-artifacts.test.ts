import { describe, expect, test } from "vitest";
import { mapBrowserBridgeError, validateWorkflowArtifact, isKnownBrowserBridgeCode } from "./workflow-artifacts";

const input = {
  workflowRunId: "run-1",
  kind: "screenshot" as const,
  label: "shared tab",
  opaqueRef: "ref_12_4",
  origin: "browser_bridge" as const,
};

describe("workflow artifacts", () => {
  test("accepts opaque screenshot references without image data", () => {
    expect(() => validateWorkflowArtifact(input)).not.toThrow();
    expect(() => validateWorkflowArtifact({ ...input, opaqueRef: "data:image/png;base64,AAAA" })).toThrow();
  });

  test("rejects an origin outside the known set (regression: origin wasn't validated at runtime)", () => {
    expect(() =>
      validateWorkflowArtifact({ ...input, origin: "not_a_real_origin" as never }),
    ).toThrow();
  });

  test("maps Browser Bridge outcomes to safe Workflow states", () => {
    expect(mapBrowserBridgeError("APPROVAL_REQUIRED")).toBe("attention");
    expect(mapBrowserBridgeError("TAB_NOT_SHARED")).toBe("blocked");
    expect(mapBrowserBridgeError("INVALID_REQUEST")).toBe("failed");
    expect(isKnownBrowserBridgeCode("PROTOCOL_MISMATCH")).toBe(true);
    expect(isKnownBrowserBridgeCode("UNKNOWN")).toBe(false);
  });
});
