import { describe, expect, it, vi } from "vitest";
import { resolveScopedCwd } from "./pty-session";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/opencode", () => ({
  OPENCODE_BASE_URL: "http://127.0.0.1:4096",
}));

import { createPtyWithShellCheck, PtyError } from "./pty-session";

function mockFetchResponse(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe("resolveScopedCwd", () => {
  it("returns the directory itself when cwd is omitted", () => {
    const r = resolveScopedCwd("C:/proj");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cwd).toBeTruthy();
  });

  it("rejects explicit .. traversal", () => {
    const r = resolveScopedCwd("C:/proj", "C:/proj/../../etc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("rejects relative .. traversal", () => {
    const r = resolveScopedCwd("C:/proj", "../../etc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("rejects an absolute path outside the directory", () => {
    const r = resolveScopedCwd("C:/proj", "D:/elsewhere");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("accepts a subdirectory", () => {
    const r = resolveScopedCwd("C:/proj", "C:/proj/sub");
    expect(r.ok).toBe(true);
  });

  it("requires a directory", () => {
    const r = resolveScopedCwd("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("createPtyWithShellCheck", () => {
  it("accepts a PTY whose command is in the acceptable shell list", async () => {
    mockFetchResponse(200, {
      id: "pty_1",
      title: "bash",
      command: "/bin/bash",
      args: [],
      cwd: "C:/proj",
      status: "running",
      pid: 1234,
    });
    mockFetchResponse(200, [
      { path: "/bin/bash", name: "bash", acceptable: true },
      { path: "/bin/zsh", name: "zsh", acceptable: true },
    ]);

    const pty = await createPtyWithShellCheck("C:/proj", { cwd: "C:/proj" });
    expect(pty.id).toBe("pty_1");
  });

  it("rejects and removes a PTY whose command is not acceptable", async () => {
    mockFetchResponse(200, {
      id: "pty_2",
      title: "shell",
      command: "/usr/bin/danger",
      args: [],
      cwd: "C:/proj",
      status: "running",
      pid: 5678,
    });
    mockFetchResponse(200, [
      { path: "/bin/bash", name: "bash", acceptable: true },
    ]);
    // DELETE call to clean up the non-acceptable PTY
    mockFetchResponse(200, true);

    await expect(
      createPtyWithShellCheck("C:/proj", { cwd: "C:/proj" }),
    ).rejects.toThrow();
    // Verify a DELETE was made at some point
    const deleteCall = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "DELETE",
    );
    expect(deleteCall).toBeTruthy();
  });

  it("skips the check when /pty/shells is unavailable", async () => {
    mockFetchResponse(200, {
      id: "pty_3",
      title: "shell",
      command: "/bin/bash",
      args: [],
      cwd: "C:/proj",
      status: "running",
      pid: 9012,
    });
    // /pty/shells returns 404
    mockFetchResponse(404, { error: "not found" });

    const pty = await createPtyWithShellCheck("C:/proj", { cwd: "C:/proj" });
    expect(pty.id).toBe("pty_3");
  });

  it("skips the check when acceptable list is empty", async () => {
    mockFetchResponse(200, {
      id: "pty_4",
      title: "shell",
      command: "/bin/anything",
      args: [],
      cwd: "C:/proj",
      status: "running",
      pid: 3456,
    });
    mockFetchResponse(200, []);

    const pty = await createPtyWithShellCheck("C:/proj", { cwd: "C:/proj" });
    expect(pty.id).toBe("pty_4");
  });
});
