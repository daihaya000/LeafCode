import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
