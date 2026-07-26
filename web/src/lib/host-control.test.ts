import { describe, expect, it } from "vitest";
import { hostRestartPath, hostVoiceInputPath } from "@/lib/host-control";

describe("hostRestartPath", () => {
  it("maps targets to control paths", () => {
    expect(hostRestartPath("webui")).toBe("/restart/webui");
    expect(hostRestartPath("opencode")).toBe("/restart/opencode");
    expect(hostRestartPath("all")).toBe("/restart/all");
  });
});

describe("hostVoiceInputPath", () => {
  it("maps to the host voice-input control path", () => {
    expect(hostVoiceInputPath()).toBe("/voice-input");
  });
});
