import { describe, expect, it, vi, afterEach } from "vitest";

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

import { logPtyEvent } from "./pty-audit";

describe("logPtyEvent", () => {
  afterEach(() => {
    logSpy.mockClear();
  });

  it("emits a single-line JSON audit entry with pty and event", () => {
    logPtyEvent("pty_1", "create", { directory: "C:/proj" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("pty-audit");
    const json = JSON.parse(line.replace(/^pty-audit /, ""));
    expect(json.pty).toBe("pty_1");
    expect(json.event).toBe("create");
    expect(json.directory).toBe("C:/proj");
  });

  it("omits directory/detail when not provided", () => {
    logPtyEvent("pty_2", "disconnect");
    const line = logSpy.mock.calls[0][0] as string;
    const json = JSON.parse(line.replace(/^pty-audit /, ""));
    expect(json.pty).toBe("pty_2");
    expect(json.event).toBe("disconnect");
    expect(json.directory).toBeUndefined();
    expect(json.detail).toBeUndefined();
  });

  it("includes detail when provided", () => {
    logPtyEvent("pty_3", "resize", { detail: "30x120" });
    const line = logSpy.mock.calls[0][0] as string;
    const json = JSON.parse(line.replace(/^pty-audit /, ""));
    expect(json.detail).toBe("30x120");
  });
});