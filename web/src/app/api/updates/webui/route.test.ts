// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const mkdtempMock = vi.hoisted(() => vi.fn());
const readdirMock = vi.hoisted(() => vi.fn());
const cpMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({
  mkdtemp: mkdtempMock,
  readdir: readdirMock,
  cp: cpMock,
  rm: rmMock,
  writeFile: writeFileMock,
}));

const isGitInstallMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/install-root", () => ({
  GITHUB_REPO: "daihaya000/LeafCode",
  GITHUB_REPO_URL: "https://github.com/daihaya000/LeafCode.git",
  installationRoot: vi.fn(() => "C:\\fake-root"),
  isGitInstall: isGitInstallMock,
}));

const resolveRemoteHeadMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github-remote", () => ({ resolveRemoteHead: resolveRemoteHeadMock }));

const isGitRestoreInFlightMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/git-restore", () => ({ isGitRestoreInFlight: isGitRestoreInFlightMock }));

const writeUpdateRecordMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/install-state", () => ({ writeUpdateRecord: writeUpdateRecordMock }));

import { POST } from "./route";

type ExecCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

function mockExec(matcher: (args: string[]) => { stdout?: string; stderr?: string } | Error) {
  execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecCb) => {
    const result = matcher(args);
    if (result instanceof Error) cb(result);
    else cb(null, { stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
  });
}

function localRequest(): NextRequest {
  return new NextRequest("http://localhost/api/updates/webui", {
    method: "POST",
    headers: { host: "localhost:3000" },
  });
}

type WebuiPostBody = {
  ok: boolean;
  mode?: string;
  result?: { source?: string; tag?: string };
  stdout?: string;
  stderr?: string;
  error?: string;
};

describe("POST /api/updates/webui", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGitRestoreInFlightMock.mockReturnValue(false);
    mkdtempMock.mockResolvedValue("C:\\tmp\\opencode-webui-update-xxx");
    cpMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    readdirMock.mockResolvedValue([{ name: "LeafCode-master", isDirectory: () => true }]);
  });

  it("returns 503 while the startup git restore is in flight", async () => {
    isGitRestoreInFlightMock.mockReturnValue(true);
    const res = await POST(localRequest());
    expect(res.status).toBe(503);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("runs `git pull --ff-only` when .git exists", async () => {
    isGitInstallMock.mockReturnValue(true);
    mockExec((args) => {
      if (args[0] === "pull") return { stdout: "Already up to date.\n", stderr: "" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const res = await POST(localRequest());
    const body = (await res.json()) as WebuiPostBody;
    expect(res.status).toBe(200);
    expect(body.mode).toBe("git");
    expect(body.stdout).toContain("Already up to date");
  });

  it("reports git pull failures with the command's stdout/stderr", async () => {
    isGitInstallMock.mockReturnValue(true);
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecCb) => {
      const err = Object.assign(new Error("fatal: not possible to fast-forward"), {
        stdout: "",
        stderr: "fatal: not possible to fast-forward, aborting.\n",
        code: 128,
      });
      cb(err);
    });

    const res = await POST(localRequest());
    const body = (await res.json()) as WebuiPostBody;
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.stderr).toContain("fast-forward");
  });

  it("downloads a release asset when GitHub has one, without touching the local version record", async () => {
    isGitInstallMock.mockReturnValue(false);
    global.fetch = vi.fn(async (url: string | URL) => {
      if (String(url).includes("releases/latest")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: "v1.2.3",
            assets: [{ name: "webui.zip", browser_download_url: "https://example.invalid/webui.zip" }],
          }),
        } as Response;
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    }) as unknown as typeof fetch;
    mockExec(() => ({ stdout: "" })); // Expand-Archive via powershell.exe

    const res = await POST(localRequest());
    const body = (await res.json()) as WebuiPostBody;
    expect(res.status).toBe(200);
    expect(body.mode).toBe("release");
    expect(body.result?.source).toBe("release-asset");
    expect(resolveRemoteHeadMock).not.toHaveBeenCalled();
    expect(writeUpdateRecordMock).not.toHaveBeenCalled();
  });

  it("falls back to the resolved default-branch commit and records it when there's no release", async () => {
    isGitInstallMock.mockReturnValue(false);
    resolveRemoteHeadMock.mockResolvedValue({ branch: "master", commit: "deadbeefcafebabe" });
    global.fetch = vi.fn(async (url: string | URL) => {
      if (String(url).includes("releases/latest")) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      expect(String(url)).toContain("zip/deadbeefcafebabe");
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    }) as unknown as typeof fetch;
    mockExec(() => ({ stdout: "" }));

    const res = await POST(localRequest());
    const body = (await res.json()) as WebuiPostBody;
    expect(res.status).toBe(200);
    expect(body.result?.source).toBe("default-branch");
    expect(writeUpdateRecordMock).toHaveBeenCalledWith(
      "C:\\fake-root",
      expect.objectContaining({ commit: "deadbeefcafebabe", source: "zip-update" }),
    );
  });
});
