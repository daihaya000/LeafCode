import { describe, expect, it } from "vitest";
import { deriveTaskStatus } from "./task-status";

const base = {
  workspaceStatus: "active",
  hasBinding: true,
  sessionStatus: undefined,
  engineOk: true,
  filesChanged: 0,
};

describe("deriveTaskStatus", () => {
  it("prioritizes orphaned workspace over everything", () => {
    expect(
      deriveTaskStatus({
        ...base,
        workspaceStatus: "orphaned",
        sessionStatus: { type: "busy" },
        filesChanged: 5,
      }),
    ).toBe("orphaned");
  });

  it("maps archived workspace to archived (not merged) (R12#2)", () => {
    expect(deriveTaskStatus({ ...base, workspaceStatus: "archived" })).toBe(
      "archived",
    );
  });

  it("is working when the session is busy", () => {
    expect(
      deriveTaskStatus({ ...base, sessionStatus: { type: "busy" } }),
    ).toBe("working");
  });

  it("is working when the session is retrying", () => {
    expect(
      deriveTaskStatus({ ...base, sessionStatus: { type: "retry" } }),
    ).toBe("working");
  });

  it("is unknown when a bound session exists but the engine is down", () => {
    expect(deriveTaskStatus({ ...base, engineOk: false })).toBe("unknown");
  });

  it("is ready when there are working-tree changes", () => {
    expect(deriveTaskStatus({ ...base, filesChanged: 3 })).toBe("ready");
  });

  it("is idle when nothing else applies", () => {
    expect(deriveTaskStatus(base)).toBe("idle");
  });

  it("treats idle session with no changes as idle", () => {
    expect(
      deriveTaskStatus({ ...base, sessionStatus: { type: "idle" } }),
    ).toBe("idle");
  });

  it("does not report unknown without a binding", () => {
    expect(
      deriveTaskStatus({ ...base, hasBinding: false, engineOk: false }),
    ).toBe("idle");
  });
});
