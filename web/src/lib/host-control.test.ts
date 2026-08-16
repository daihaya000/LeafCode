import { afterEach, describe, expect, it } from "vitest";
import {
  hostAllowFirewallPath,
  hostLogsPath,
  hostRestartPath,
  hostShutdownPath,
  hostVoiceInputPath,
  resolveHostControlUrl,
} from "@/lib/host-control";
import {
  resolveHostControlUrl as resolveShared,
} from "../../../scripts/lib/host-control.mjs";
import * as buildGuard from "../../../scripts/production-webui-build-guard.mjs";

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

describe("hostAllowFirewallPath", () => {
  it("maps to the host allow-firewall control path", () => {
    expect(hostAllowFirewallPath()).toBe("/allow-firewall");
  });
});

describe("hostShutdownPath", () => {
  it("maps to the host shutdown control path", () => {
    expect(hostShutdownPath()).toBe("/shutdown");
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
  const prev = process.env.LEAFCODE_HOST_CONTROL_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.LEAFCODE_HOST_CONTROL_URL;
    else process.env.LEAFCODE_HOST_CONTROL_URL = prev;
  });

  it("accepts loopback env URLs", () => {
    process.env.LEAFCODE_HOST_CONTROL_URL = "http://127.0.0.1:18765/";
    expect(resolveHostControlUrl()).toBe("http://127.0.0.1:18765");
  });

  it("rejects non-loopback env URLs and falls back to default", () => {
    process.env.LEAFCODE_HOST_CONTROL_URL = "http://192.168.0.50:18765";
    expect(resolveHostControlUrl()).toBe("http://127.0.0.1:18765");
  });
});

describe("shared host-control (scripts/lib/host-control.mjs, DI)", () => {
  const env = { LEAFCODE_HOST_CONTROL_URL: undefined, APPDATA: "C:\\appdata" };
  const fileExists = (content: string) => ({
    exists: (p: string) => p.endsWith("host-control.json"),
    read: () => content,
  });

  it("web resolveHostControlUrl delegates to the shared implementation", () => {
    expect(resolveHostControlUrl).toBe(resolveShared);
  });

  it("production-webui-build-guard loads and uses the shared implementation", () => {
    expect(typeof buildGuard.inspectProductionWebUi).toBe("function");
    expect("resolveHostControlUrl" in buildGuard).toBe(false);
  });

  it("accepts loopback env URLs (trailing slash stripped)", () => {
    expect(
      resolveShared({ env: { ...env, LEAFCODE_HOST_CONTROL_URL: "http://127.0.0.1:18765/" } }),
    ).toBe("http://127.0.0.1:18765");
  });

  it("rejects non-loopback env URLs (was silently accepted by the build guard)", () => {
    expect(
      resolveShared({ env: { ...env, LEAFCODE_HOST_CONTROL_URL: "http://192.168.0.50:18765" } }),
    ).toBe("http://127.0.0.1:18765");
  });

  it("rejects non-http protocols", () => {
    expect(
      resolveShared({ env: { ...env, LEAFCODE_HOST_CONTROL_URL: "file:///C:/x" } }),
    ).toBe("http://127.0.0.1:18765");
  });

  it("accepts a loopback URL from the control file", () => {
    const { exists, read } = fileExists(JSON.stringify({ url: "http://localhost:9999/" }));
    expect(resolveShared({ env, exists, read })).toBe("http://localhost:9999");
  });

  it("rejects a non-loopback URL from the control file and uses the port", () => {
    const { exists, read } = fileExists(JSON.stringify({ url: "http://10.0.0.8:9999", port: 5555 }));
    expect(resolveShared({ env, exists, read })).toBe("http://127.0.0.1:5555");
  });

  it("falls back to http://127.0.0.1:port when the file only has a port", () => {
    const { exists, read } = fileExists(JSON.stringify({ port: 4242 }));
    expect(resolveShared({ env, exists, read })).toBe("http://127.0.0.1:4242");
  });

  it("returns the default for invalid JSON", () => {
    const { exists, read } = fileExists("not json");
    expect(resolveShared({ env, exists, read })).toBe("http://127.0.0.1:18765");
  });

  it("returns the default when no env and no file", () => {
    expect(resolveShared({ env, exists: () => false })).toBe("http://127.0.0.1:18765");
  });
});
