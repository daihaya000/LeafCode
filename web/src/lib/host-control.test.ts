import { afterEach, describe, expect, it } from "vitest";
import {
  hostLogsPath,
  hostRestartPath,
  hostVoiceInputPath,
  resolveHostControlUrl,
} from "@/lib/host-control";

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

describe("hostLogsPath", () => {
  it("returns the bare path when since is null", () => {
    expect(hostLogsPath(null)).toBe("/logs");
  });

  it("appends the since query when a finite number is given", () => {
    expect(hostLogsPath(42)).toBe("/logs?since=42");
    expect(hostLogsPath(0)).toBe("/logs?since=0");
  });

  it("falls back to the bare path for non-finite since", () => {
    expect(hostLogsPath(Number.NaN)).toBe("/logs");
  });
});

describe("resolveHostControlUrl", () => {
  const prev = process.env.OPENCODE_WEBUI_HOST_CONTROL_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.OPENCODE_WEBUI_HOST_CONTROL_URL;
    else process.env.OPENCODE_WEBUI_HOST_CONTROL_URL = prev;
  });

  it("accepts loopback env URLs", () => {
    process.env.OPENCODE_WEBUI_HOST_CONTROL_URL = "http://127.0.0.1:18765/";
    expect(resolveHostControlUrl()).toBe("http://127.0.0.1:18765");
  });

  it("rejects non-loopback env URLs and falls back to default", () => {
    process.env.OPENCODE_WEBUI_HOST_CONTROL_URL = "http://192.168.0.50:18765";
    expect(resolveHostControlUrl()).toBe("http://127.0.0.1:18765");
  });
});
