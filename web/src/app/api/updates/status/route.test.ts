// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const readFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ readFileSync: readFileSyncMock }));

const isGitInstallMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/install-root", () => ({
  GITHUB_REPO: "daihaya000/LeafCode",
  GITHUB_REPO_URL: "https://github.com/daihaya000/LeafCode.git",
  installationRoot: vi.fn(() => "C:\\fake-root"),
  isGitInstall: isGitInstallMock,
}));

const resolveRemoteHeadMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github-remote", () => ({ resolveRemoteHead: resolveRemoteHeadMock }));

const readUpdateRecordMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/install-state", () => ({ readUpdateRecord: readUpdateRecordMock }));

vi.mock("@/lib/opencode", () => ({ OPENCODE_BASE_URL: "http://127.0.0.1:4096" }));

import { GET } from "./route";

type ExecCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

function mockGit(matcher: (args: string[]) => { stdout?: string; stderr?: string } | Error) {
  execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecCb) => {
    const result = matcher(args);
    if (result instanceof Error) cb(result);
    else cb(null, { stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
  });
}

function localRequest(): NextRequest {
  return new NextRequest("http://localhost/api/updates/status", { headers: { host: "localhost:3000" } });
}

type StatusBody = {
  webui: { available: boolean; current?: string; latest?: string; error?: string };
  nextjs: { available: boolean; current?: string; latest?: string; error?: string };
};

describe("GET /api/updates/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({}) }) as unknown as typeof fetch;
    readFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
  });

  it("rejects non-loopback callers (local-only guard)", async () => {
    const req = new NextRequest("http://localhost/api/updates/status", {
      headers: { host: "192.168.0.5:3000" },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("case A: .git with a tracked upstream compares against it and flags old-version regression", async () => {
    isGitInstallMock.mockReturnValue(true);
    mockGit((args) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "aaa1111\n" };
      if (args.includes("@{upstream}")) return { stdout: "origin/master\n" };
      if (args[0] === "ls-remote") return { stdout: "bbb2222\trefs/heads/master\n" };
      if (args[0] === "merge-base") return { stdout: "" };
      if (args[0] === "log") return { stdout: "" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const res = await GET(localRequest());
    const body = (await res.json()) as StatusBody;
    expect(body.webui.available).toBe(true);
    expect(body.webui.current).toBe("aaa1111");
    expect(body.webui.latest).toBe("bbb2222");
  });

  it("case B: .git without a usable upstream falls back to the hardcoded repo URL", async () => {
    isGitInstallMock.mockReturnValue(true);
    mockGit((args) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "aaa1111\n" };
      if (args.includes("@{upstream}")) return new Error("fatal: no upstream configured");
      if (args[0] === "fetch") return { stdout: "" };
      if (args[0] === "rev-parse" && args[1] === "FETCH_HEAD") return { stdout: "ccc3333\n" };
      if (args[0] === "merge-base") return { stdout: "" };
      if (args[0] === "log") return { stdout: "" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const res = await GET(localRequest());
    const body = (await res.json()) as StatusBody;
    expect(body.webui.available).toBe(true);
    expect(body.webui.current).toBe("aaa1111");
    expect(body.webui.latest).toBe("ccc3333");
  });

  it("case C: no .git but a recorded commit compares against the resolved remote head", async () => {
    isGitInstallMock.mockReturnValue(false);
    readUpdateRecordMock.mockReturnValue({ commit: "old0000", fetchedAt: "t", source: "zip-update" });
    resolveRemoteHeadMock.mockResolvedValue({ branch: "master", commit: "new1111" });

    const res = await GET(localRequest());
    const body = (await res.json()) as StatusBody;
    expect(body.webui.available).toBe(true);
    expect(body.webui.current).toBe("old0000");
    expect(body.webui.latest).toBe("new1111");
  });

  it("case C: reports no update when the recorded commit matches the remote head", async () => {
    isGitInstallMock.mockReturnValue(false);
    readUpdateRecordMock.mockReturnValue({ commit: "same000", fetchedAt: "t", source: "zip-update" });
    resolveRemoteHeadMock.mockResolvedValue({ branch: "master", commit: "same000" });

    const res = await GET(localRequest());
    const body = (await res.json()) as StatusBody;
    expect(body.webui.available).toBe(false);
  });

  it("case D: no .git and no recorded version reports unavailable with an explanatory error", async () => {
    isGitInstallMock.mockReturnValue(false);
    readUpdateRecordMock.mockReturnValue(null);

    const res = await GET(localRequest());
    const body = (await res.json()) as StatusBody;
    expect(body.webui.available).toBe(false);
    expect(body.webui.error).toContain("バージョン情報");
    expect(resolveRemoteHeadMock).not.toHaveBeenCalled();
  });

  describe("nextjs field", () => {
    beforeEach(() => {
      isGitInstallMock.mockReturnValue(false);
      readUpdateRecordMock.mockReturnValue(null);
    });

    /** Abbreviated packument shape: the route picks the newest stable release
     *  inside the installed major from this version list. */
    function mockRegistryVersions(...published: string[]) {
      const versions = Object.fromEntries(published.map((v) => [v, {}]));
      global.fetch = vi.fn(async (url: string | URL) => {
        if (String(url).includes("registry.npmjs.org/next")) {
          return { json: async () => ({ versions }) } as Response;
        }
        return { json: async () => ({}) } as Response;
      }) as unknown as typeof fetch;
    }

    it("reports available when the installed next version is older than the registry latest", async () => {
      readFileSyncMock.mockImplementation((path: string) => {
        if (String(path).includes("node_modules")) return JSON.stringify({ version: "15.5.20" });
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });
      mockRegistryVersions("15.5.20", "15.6.0");

      const res = await GET(localRequest());
      const body = (await res.json()) as StatusBody;
      expect(body.nextjs.available).toBe(true);
      expect(body.nextjs.current).toBe("15.5.20");
      expect(body.nextjs.latest).toBe("15.6.0");
    });

    it("ignores releases from a newer major (the update button cannot install them)", async () => {
      readFileSyncMock.mockImplementation((path: string) => {
        if (String(path).includes("node_modules")) return JSON.stringify({ version: "15.5.20" });
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });
      mockRegistryVersions("15.5.20", "16.0.0", "16.3.0");

      const res = await GET(localRequest());
      const body = (await res.json()) as StatusBody;
      expect(body.nextjs.available).toBe(false);
      expect(body.nextjs.latest).toBe("15.5.20");
    });

    it("falls back to the declared package.json range when node_modules is unreadable", async () => {
      readFileSyncMock.mockImplementation((path: string) => {
        if (String(path).includes("node_modules")) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return JSON.stringify({ dependencies: { next: "15.5.20" } });
      });
      mockRegistryVersions("15.5.20");

      const res = await GET(localRequest());
      const body = (await res.json()) as StatusBody;
      expect(body.nextjs.current).toBe("15.5.20");
      expect(body.nextjs.available).toBe(false);
    });

    it("reports unavailable with an explanatory error when the version cannot be determined at all", async () => {
      readFileSyncMock.mockImplementation(() => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const res = await GET(localRequest());
      const body = (await res.json()) as StatusBody;
      expect(body.nextjs.available).toBe(false);
      expect(body.nextjs.error).toContain("Next.js");
    });

    it("reports unavailable when the registry lookup fails", async () => {
      readFileSyncMock.mockImplementation((path: string) => {
        if (String(path).includes("node_modules")) return JSON.stringify({ version: "15.5.20" });
        throw new Error("ENOENT");
      });
      global.fetch = vi.fn(async (url: string | URL) => {
        if (String(url).includes("registry.npmjs.org/next")) throw new Error("network down");
        return { json: async () => ({}) } as Response;
      }) as unknown as typeof fetch;

      const res = await GET(localRequest());
      const body = (await res.json()) as StatusBody;
      expect(body.nextjs.available).toBe(false);
      expect(body.nextjs.current).toBe("15.5.20");
      expect(body.nextjs.error).toBeTruthy();
    });
  });
});
