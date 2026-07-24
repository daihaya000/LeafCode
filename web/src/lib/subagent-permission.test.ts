import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isActionableAttentionPermission,
  permissionAutoAction,
  readSubagentPermission,
  writeSubagentPermission,
  SUBAGENT_PERMISSION_EVENT,
} from "./subagent-permission";

describe("subagent-permission storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to allow when nothing is stored", () => {
    expect(readSubagentPermission()).toBe("allow");
  });

  it("round-trips a stored value", () => {
    writeSubagentPermission("deny");
    expect(localStorage.getItem("webui:subagent-permission")).toBe("deny");
    expect(readSubagentPermission()).toBe("deny");
    writeSubagentPermission("allow");
    expect(readSubagentPermission()).toBe("allow");
  });

  it("falls back to allow for an invalid stored value", () => {
    localStorage.setItem("webui:subagent-permission", "bogus");
    expect(readSubagentPermission()).toBe("allow");
  });

  it("dispatches a CustomEvent with the mode on write", () => {
    const detail: string[] = [];
    const onEvent = (e: Event) =>
      detail.push((e as CustomEvent<string>).detail);
    window.addEventListener(SUBAGENT_PERMISSION_EVENT, onEvent);
    writeSubagentPermission("deny");
    window.removeEventListener(SUBAGENT_PERMISSION_EVENT, onEvent);
    expect(detail).toEqual(["deny"]);
  });
});

describe("permissionAutoAction", () => {
  it("rejects task permission when subagent is denied (priority over full access)", () => {
    expect(
      permissionAutoAction({
        permission: "task",
        subagent: "deny",
        fullAccess: false,
      }),
    ).toBe("reject");
    expect(
      permissionAutoAction({
        permission: "task",
        subagent: "deny",
        fullAccess: true,
      }),
    ).toBe("reject");
  });

  it("leaves non-task permissions unchanged when subagent is denied", () => {
    expect(
      permissionAutoAction({
        permission: "edit",
        subagent: "deny",
        fullAccess: false,
      }),
    ).toBe("manual");
    // full access still approves other permissions while task is denied
    expect(
      permissionAutoAction({
        permission: "edit",
        subagent: "deny",
        fullAccess: true,
      }),
    ).toBe("approve");
  });

  it("does not reject task permission when subagent is allowed", () => {
    expect(
      permissionAutoAction({
        permission: "task",
        subagent: "allow",
        fullAccess: false,
      }),
    ).toBe("manual");
    expect(
      permissionAutoAction({
        permission: "task",
        subagent: "allow",
        fullAccess: true,
      }),
    ).toBe("approve");
  });
});

describe("isActionableAttentionPermission", () => {
  it("hides auto-approve and auto-reject permissions unless they failed", () => {
    const failed = new Set<string>();
    expect(
      isActionableAttentionPermission("bash", "allow", "p1", true, failed),
    ).toBe(false);
    expect(
      isActionableAttentionPermission("task", "deny", "p2", false, failed),
    ).toBe(false);
    expect(
      isActionableAttentionPermission("bash", "allow", "p3", false, failed),
    ).toBe(true);
  });

  it("keeps failed auto-replies actionable for manual fallback", () => {
    const failed = new Set(["p_fail"]);
    expect(
      isActionableAttentionPermission("bash", "allow", "p_fail", true, failed),
    ).toBe(true);
    expect(
      isActionableAttentionPermission("task", "deny", "p_fail", true, failed),
    ).toBe(true);
  });
});
