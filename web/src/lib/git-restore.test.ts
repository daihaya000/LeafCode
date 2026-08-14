// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const mkdtempMock = vi.hoisted(() => vi.fn());
const renameMock = vi.hoisted(() => vi.fn());
const cpMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({
  mkdtemp: mkdtempMock,
  rename: renameMock,
  cp: cpMock,
  rm: rmMock,
}));

const isGitInstallMock = vi.hoisted(() => vi.fn());
vi.mock("./install-root", () => ({
  GITHUB_REPO_URL: "https://github.com/daihaya000/LeafCode.git",
  installationRoot: vi.fn(() => "C:\\fake-root"),
  isGitInstall: isGitInstallMock,
}));

const readGitRestoreProgressMock = vi.hoisted(() => vi.fn());
const writeGitRestoreProgressMock = vi.hoisted(() => vi.fn());
const writeUpdateRecordMock = vi.hoisted(() => vi.fn());
vi.mock("./install-state", () => ({
  readGitRestoreProgress: readGitRestoreProgressMock,
  writeGitRestoreProgress: writeGitRestoreProgressMock,
  writeUpdateRecord: writeUpdateRecordMock,
}));

import { isGitRestoreInFlight, runStartupGitRestore } from "./git-restore";

const ROOT = "C:\\fake-root";

type ExecCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

function mockGit(matcher: (args: string[]) => { stdout?: string; stderr?: string } | Error) {
  execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecCb) => {
    const result = matcher(args);
    if (result instanceof Error) cb(result);
    else cb(null, { stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
  });
}

/** Matches the happy path: clone -> verify -> detect branch -> reset -> rev-parse HEAD. */
function mockHappyPathGit(headCommit = "deadbeef") {
  mockGit((args) => {
    if (args.includes("clone")) return { stdout: "" };
    if (args.includes("--verify")) return { stdout: `${headCommit}\n` };
    if (args.includes("symbolic-ref") && args.includes("--short")) return { stdout: "master\n" };
    if (args[0] === "reset") return { stdout: "" };
    if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: `${headCommit}\n` };
    throw new Error(`unexpected git invocation: ${args.join(" ")}`);
  });
}

describe("runStartupGitRestore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENCODE_WEBUI_SKIP_GIT_RESTORE;
    mkdtempMock.mockResolvedValue("C:\\tmp\\opencode-webui-git-restore-xxx");
    renameMock.mockResolvedValue(undefined);
    cpMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.OPENCODE_WEBUI_SKIP_GIT_RESTORE;
  });

  it("does nothing when OPENCODE_WEBUI_SKIP_GIT_RESTORE=1", async () => {
    process.env.OPENCODE_WEBUI_SKIP_GIT_RESTORE = "1";
    await runStartupGitRestore(ROOT);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("marks a pre-existing git checkout as done without touching it", async () => {
    isGitInstallMock.mockReturnValue(true);
    readGitRestoreProgressMock.mockReturnValue(null);

    await runStartupGitRestore(ROOT);

    expect(execFileMock).not.toHaveBeenCalled();
    expect(writeGitRestoreProgressMock).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ phase: "done" }),
    );
  });

  it("short-circuits once phase is already done", async () => {
    isGitInstallMock.mockReturnValue(true);
    readGitRestoreProgressMock.mockReturnValue({ phase: "done", attemptCount: 1 });

    await runStartupGitRestore(ROOT);

    expect(execFileMock).not.toHaveBeenCalled();
    expect(writeGitRestoreProgressMock).not.toHaveBeenCalled();
  });

  it("skips retrying within the cooldown window after a failed attempt", async () => {
    isGitInstallMock.mockReturnValue(false);
    readGitRestoreProgressMock.mockReturnValue({
      attemptCount: 1,
      lastAttemptAt: new Date().toISOString(),
    });

    await runStartupGitRestore(ROOT);

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("clones fresh, moves .git into place, and resets when no .git exists", async () => {
    isGitInstallMock.mockReturnValue(false);
    readGitRestoreProgressMock.mockReturnValue(null);
    mockHappyPathGit();

    await runStartupGitRestore(ROOT);

    expect(mkdtempMock).toHaveBeenCalled();
    expect(renameMock).toHaveBeenCalled();
    expect(writeGitRestoreProgressMock).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ phase: "cloned", defaultBranch: "master" }),
    );
    expect(writeGitRestoreProgressMock).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ phase: "done" }),
    );
    expect(writeUpdateRecordMock).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ commit: "deadbeef", source: "git-restore" }),
    );
    const resetCall = execFileMock.mock.calls.find(([, args]) => args[0] === "reset");
    expect(resetCall?.[1]).toEqual(["reset", "--hard", "origin/master"]);
  });

  it("resumes from an interrupted reset without re-cloning", async () => {
    isGitInstallMock.mockReturnValue(true);
    readGitRestoreProgressMock.mockReturnValue({
      phase: "cloned",
      defaultBranch: "master",
      attemptCount: 1,
    });
    mockGit((args) => {
      if (args[0] === "reset") return { stdout: "" };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "cafebabe\n" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    await runStartupGitRestore(ROOT);

    expect(mkdtempMock).not.toHaveBeenCalled();
    const cloneCall = execFileMock.mock.calls.find(([, args]) => args.includes("clone"));
    expect(cloneCall).toBeUndefined();
    expect(writeGitRestoreProgressMock).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ phase: "done" }),
    );
  });

  it("falls back to copy+remove when rename reports EXDEV", async () => {
    isGitInstallMock.mockReturnValue(false);
    readGitRestoreProgressMock.mockReturnValue(null);
    renameMock.mockRejectedValueOnce(Object.assign(new Error("cross-device"), { code: "EXDEV" }));
    mockHappyPathGit();

    await runStartupGitRestore(ROOT);

    expect(cpMock).toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalled();
  });

  it("keeps phase at 'cloned' and records the error when reset --hard fails, without throwing", async () => {
    isGitInstallMock.mockReturnValue(false);
    readGitRestoreProgressMock.mockReturnValue(null);
    mockGit((args) => {
      if (args.includes("clone")) return { stdout: "" };
      if (args.includes("--verify")) return { stdout: "deadbeef\n" };
      if (args.includes("symbolic-ref") && args.includes("--short")) return { stdout: "master\n" };
      if (args[0] === "reset") return new Error("no space left on device");
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    await expect(runStartupGitRestore(ROOT)).resolves.toBeUndefined();

    expect(writeGitRestoreProgressMock).not.toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ phase: "done" }),
    );
    expect(writeGitRestoreProgressMock).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ lastError: expect.stringContaining("no space left") }),
    );
  });

  it("removes the scratch clone dir when the post-clone verify step fails", async () => {
    // Regression: cloneToTemp() only returned tmpDir on success, so a failure
    // in `rev-parse --verify` / `symbolic-ref` after a successful clone left
    // the scratch directory behind on every failed attempt.
    isGitInstallMock.mockReturnValue(false);
    readGitRestoreProgressMock.mockReturnValue(null);
    mockGit((args) => {
      if (args.includes("clone")) return { stdout: "" };
      if (args.includes("--verify")) return new Error("fatal: HEAD not found");
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    await runStartupGitRestore(ROOT);

    expect(rmMock).toHaveBeenCalledWith(
      "C:\\tmp\\opencode-webui-git-restore-xxx",
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(writeGitRestoreProgressMock).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ lastError: expect.stringContaining("HEAD not found") }),
    );
  });

  it("removes the scratch clone dir when moving .git into place fails", async () => {
    isGitInstallMock.mockReturnValue(false);
    readGitRestoreProgressMock.mockReturnValue(null);
    mockHappyPathGit();
    // A non-retryable error (moveGitDir only retries EBUSY/EPERM) so the
    // failure surfaces immediately instead of waiting through the retry delays.
    renameMock.mockRejectedValue(Object.assign(new Error("no such device"), { code: "ENODEV" }));

    await runStartupGitRestore(ROOT);

    expect(rmMock).toHaveBeenCalledWith(
      "C:\\tmp\\opencode-webui-git-restore-xxx",
      expect.objectContaining({ recursive: true, force: true }),
    );
  });

  it("guards against overlapping runs within the same process", async () => {
    isGitInstallMock.mockReturnValue(false);
    readGitRestoreProgressMock.mockReturnValue(null);
    let resolveClone!: () => void;
    const clonePending = new Promise<void>((r) => {
      resolveClone = r;
    });
    execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecCb) => {
      if (args.includes("clone")) {
        void clonePending.then(() => cb(null, { stdout: "", stderr: "" }));
        return;
      }
      if (args.includes("--verify")) return cb(null, { stdout: "deadbeef\n", stderr: "" });
      if (args.includes("symbolic-ref") && args.includes("--short")) return cb(null, { stdout: "master\n", stderr: "" });
      if (args[0] === "reset") return cb(null, { stdout: "", stderr: "" });
      if (args[0] === "rev-parse" && args[1] === "HEAD") return cb(null, { stdout: "deadbeef\n", stderr: "" });
      cb(new Error(`unexpected git invocation in overlap test: ${args.join(" ")}`));
    });

    const first = runStartupGitRestore(ROOT);
    expect(isGitRestoreInFlight()).toBe(true);
    const second = runStartupGitRestore(ROOT);
    resolveClone();
    await Promise.all([first, second]);

    const cloneCalls = execFileMock.mock.calls.filter(([, args]) => args.includes("clone"));
    expect(cloneCalls.length).toBe(1);
    expect(isGitRestoreInFlight()).toBe(false);
    expect(writeGitRestoreProgressMock).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ phase: "done" }),
    );
  });
});
