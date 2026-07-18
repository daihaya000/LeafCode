import { describe, expect, it } from "vitest";
import { hostRestartPath } from "@/lib/host-control";

describe("hostRestartPath", () => {
  it("maps targets to control paths", () => {
    expect(hostRestartPath("webui")).toBe("/restart/webui");
    expect(hostRestartPath("opencode")).toBe("/restart/opencode");
    expect(hostRestartPath("all")).toBe("/restart/all");
  });
});
