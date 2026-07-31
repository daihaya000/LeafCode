import { describe, expect, it, vi } from "vitest";
import { resolveScopedCwd } from "./pty-session";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/opencode", () => ({
  OPENCODE_BASE_URL: "http://127.0.0.1:4096",
}));

import {
  createConnectToken,
  createPtyWithShellCheck,
  engineWsUrl,
  PtyError,
} from "./pty-session";

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

describe("engineWsUrl", () => {
  // Regression: the WS URL used to point at the v2 surface
  // (`/api/pty/{id}/connect` + `location[directory]`) while create/token used
  // v1 (`/pty` + `directory`). The Engine scopes PTY sessions per API version,
  // so the v2 handler answered the upgrade with 404 and the browser only saw
  // an opaque 1006 close — the terminal stayed blank and looked like it kept
  // disconnecting.
  it("stays on the v1 surface used by create/token/remove", () => {
    const url = new URL(engineWsUrl("pty_1", "C:/proj", "tk-123"));
    expect(url.pathname).toBe("/pty/pty_1/connect");
    expect(url.pathname.startsWith("/api/")).toBe(false);
    expect(url.searchParams.get("ticket")).toBe("tk-123");
    expect(url.searchParams.get("directory")).toBe("C:/proj");
    expect(url.searchParams.get("location[directory]")).toBeNull();
  });

  it("upgrades the scheme to ws", () => {
    expect(engineWsUrl("pty_1", "C:/proj", "t").startsWith("ws://")).toBe(true);
  });

  it("encodes the pty id into the path", () => {
    const url = new URL(engineWsUrl("pty_a/b", "C:/proj", "t"));
    expect(url.pathname).toBe("/pty/pty_a%2Fb/connect");
  });
});

describe("createConnectToken", () => {
  // Regression: without `x-opencode-ticket: 1` the Engine rejects the request
  // with 403 PtyForbiddenError ("Invalid PTY connect token request"), so no
  // ticket is ever issued and the WebSocket can never be opened.
  it("sends the x-opencode-ticket header the Engine requires", async () => {
    mockFetchResponse(200, { ticket: "tk", expires_in: 60 });

    await createConnectToken("C:/proj", "pty_1");

    const [, init] = fetchMock.mock.calls.at(-1)!;
    const { headers, method } = init as {
      headers: Record<string, string>;
      method: string;
    };
    expect(headers["x-opencode-ticket"]).toBe("1");
    expect(method).toBe("POST");
  });

  it("normalizes the v2 `{ data: { ticket } }` envelope", async () => {
    mockFetchResponse(200, {
      location: {},
      data: { ticket: "tk2", expires_in: 30 },
    });

    const token = await createConnectToken("C:/proj", "pty_1");
    expect(token.ticket).toBe("tk2");
    expect(token.expires_in).toBe(30);
  });

  it("throws when the Engine returns no ticket", async () => {
    mockFetchResponse(200, { nope: true });

    await expect(
      createConnectToken("C:/proj", "pty_1"),
    ).rejects.toBeInstanceOf(PtyError);
  });
});
