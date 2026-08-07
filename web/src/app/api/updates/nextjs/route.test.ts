// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  execFileSync: vi.fn(() => ""),
}));

const readFileSyncMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ readFileSync: readFileSyncMock, existsSync: existsSyncMock }));

vi.mock("@/lib/install-root", () => ({
  installationRoot: vi.fn(() => "C:\\fake-root"),
}));

const resolveNpmCliMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/npm-cli", () => ({ resolveNpmCli: resolveNpmCliMock }));

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
  return new NextRequest("http://localhost/api/updates/nextjs", {
    method: "POST",
    headers: { host: "localhost:3000" },
  });
}

type NextjsPostBody = {
  ok: boolean;
  version?: string;
  error?: string;
  stdout?: string;
  stderr?: string;
};

describe("POST /api/updates/nextjs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveNpmCliMock.mockReturnValue("C:\\node\\node_modules\\npm\\bin\\npm-cli.js");
    // The route needs the installed major before it can build the install spec.
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).includes("node_modules")) return JSON.stringify({ version: "15.5.20" });
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
  });

  it("installs the newest release within the installed major and reports the version", async () => {
    mockExec((args) => {
      expect(args).toEqual(["C:\\node\\node_modules\\npm\\bin\\npm-cli.js", "install", "next@15"]);
      return { stdout: "added next@15.6.0\n", stderr: "" };
    });
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).includes("node_modules")) return JSON.stringify({ version: "15.6.0" });
      throw new Error("ENOENT");
    });

    const res = await POST(localRequest());
    const body = (await res.json()) as NextjsPostBody;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.version).toBe("15.6.0");
    expect(body.stdout).toContain("next@15.6.0");
  });

  it("reports npm install failures with stdout/stderr", async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecCb) => {
      const err = Object.assign(new Error("npm ERR! network"), {
        stdout: "",
        stderr: "npm ERR! network timeout\n",
        code: 1,
      });
      cb(err);
    });

    const res = await POST(localRequest());
    const body = (await res.json()) as NextjsPostBody;
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.stderr).toContain("network timeout");
  });

  it("returns 500 without executing npm when npm-cli.js cannot be resolved", async () => {
    resolveNpmCliMock.mockImplementation(() => {
      throw new Error("npm-cli.js が見つかりませんでした。Node.js を npm 込みで再インストールしてください。");
    });

    const res = await POST(localRequest());
    const body = (await res.json()) as NextjsPostBody;
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("npm-cli.js");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("falls back to the declared range in package.json when node_modules is unreadable", async () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).includes("node_modules")) throw new Error("ENOENT");
      return JSON.stringify({ dependencies: { next: "15.5.20" } });
    });
    mockExec((args) => {
      expect(args[2]).toBe("next@15");
      return { stdout: "", stderr: "" };
    });

    const res = await POST(localRequest());
    expect(res.status).toBe(200);
  });

  it("never crosses a major: an installed Next 16 stays on 16", async () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).includes("node_modules")) return JSON.stringify({ version: "16.3.0" });
      throw new Error("ENOENT");
    });
    mockExec((args) => {
      expect(args[2]).toBe("next@16");
      return { stdout: "", stderr: "" };
    });

    const res = await POST(localRequest());
    expect(res.status).toBe(200);
  });

  it("returns 500 without executing npm when the current version cannot be determined", async () => {
    readFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const res = await POST(localRequest());
    const body = (await res.json()) as NextjsPostBody;
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects non-loopback callers (local-only guard)", async () => {
    const req = new NextRequest("http://localhost/api/updates/nextjs", {
      method: "POST",
      headers: { host: "192.168.0.5:3000" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
