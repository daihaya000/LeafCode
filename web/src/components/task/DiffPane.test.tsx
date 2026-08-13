import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffPane } from "./DiffPane";
import type { DiffFilesPayload } from "@/lib/types";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
}));

function payload(label: string): DiffFilesPayload {
  return {
    git: true,
    branch: "main",
    additions: 1,
    deletions: 0,
    files: [
      {
        path: `src/${label}.ts`,
        additions: 1,
        deletions: 0,
        binary: false,
        untracked: false,
        hunks: [],
      },
    ],
  };
}

function mockMetaApisResponse(url: string) {
  if (String(url).includes("/api/diff/files")) {
    return Promise.resolve(payload("file"));
  }
  if (String(url).includes("/api/git/branches")) {
    return Promise.resolve({
      branches: [],
      current: "main",
      defaultTarget: "main",
      upstream: "origin/main",
      ahead: 2,
      remotes: ["origin"],
      hasRemote: true,
    });
  }
  if (String(url).includes("/api/git/pr")) {
    return Promise.resolve({ available: false });
  }
  if (String(url).includes("/api/workspaces/")) {
    return Promise.resolve({
      sessions: [
        { opencodeSessionId: "session-current", title: "実装担当" },
        { opencodeSessionId: "session-other", title: "レビュー担当" },
      ],
    });
  }
  return Promise.resolve({});
}

function mockMetaApis() {
  getJson.mockImplementation(mockMetaApisResponse);
}

describe("DiffPane directory race", () => {
  beforeEach(() => {
    getJson.mockReset();
    sendJson.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("drops a stale diff response after the directory changes", async () => {
    let resolveOld: (value: DiffFilesPayload) => void = () => undefined;
    const oldPending = new Promise<DiffFilesPayload>((resolve) => {
      resolveOld = resolve;
    });
    let diffCalls = 0;
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        diffCalls += 1;
        if (diffCalls === 1) return oldPending;
        return Promise.resolve(payload("new"));
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({
          branches: [],
          current: "main",
          defaultTarget: "main",
        });
      }
      if (String(url).includes("/api/git/pr")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({});
    });

    const { rerender } = render(
      <DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    rerender(<DiffPane directory="/repo-b" workspaceId="ws-b" refreshKey={0} />);
    await screen.findByText("new.ts");

    await act(async () => {
      resolveOld(payload("stale"));
      await Promise.resolve();
    });

    expect(screen.queryByText("stale.ts")).toBeNull();
    expect(screen.getByText("new.ts")).toBeTruthy();
  });

  it("flags a file not touched by this session's tool calls when touchedPaths is non-empty", async () => {
    mockMetaApis();
    render(
      <DiffPane
        directory="/repo-a"
        workspaceId="ws-a"
        refreshKey={0}
        touchedPaths={new Set(["src/other.ts"])}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "表示するセッションの変更" }), {
      target: { value: "external" },
    });
    await screen.findByText("file.ts");
    expect(screen.getByText("セッション外?")).toBeTruthy();
  });

  it("does not flag files as external when touchedPaths includes them", async () => {
    mockMetaApis();
    render(
      <DiffPane
        directory="/repo-a"
        workspaceId="ws-a"
        refreshKey={0}
        touchedPaths={new Set(["src/file.ts"])}
      />,
    );
    await screen.findByText("file.ts");
    expect(screen.queryByText("セッション外?")).toBeNull();
  });

  it("does not flag anything as external when touchedPaths is omitted or empty", async () => {
    mockMetaApis();
    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    await screen.findByText("file.ts");
    expect(screen.queryByText("セッション外?")).toBeNull();
  });

  it("shows the current session identity and filters changes by session ownership", async () => {
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        return Promise.resolve({
          ...payload("current"),
          files: [
            payload("current").files[0],
            { ...payload("current").files[0], path: "src/external.ts" },
          ],
        });
      }
      if (String(url).includes("/api/workspaces/")) {
        return Promise.resolve({
          sessions: [
            { opencodeSessionId: "session-current", title: "実装担当" },
            { opencodeSessionId: "session-other", title: "レビュー担当" },
          ],
        });
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({ branches: [], current: "main", defaultTarget: "main" });
      }
      if (String(url).includes("/api/git/pr")) return Promise.resolve({ available: false });
      return Promise.resolve({});
    });

    render(
      <DiffPane
        directory="/repo-a"
        workspaceId="ws-a"
        sessionId="session-current"
        refreshKey={0}
        touchedPaths={new Set(["src/current.ts"])}
      />,
    );
    await screen.findByText("実装担当");
    expect(screen.getByText("session-current")).toBeTruthy();
    expect(screen.getByText(/レビュー担当/)).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "表示するセッションの変更" }), {
      target: { value: "external" },
    });
    expect(screen.queryByText("current.ts")).toBeNull();
    expect(screen.getByText("external.ts")).toBeTruthy();
  });

  it("starts each changed file minimized", async () => {
    mockMetaApis();
    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    const fileToggle = await screen.findByRole("button", {
      name: "src/file.ts の差分を展開",
    });

    expect(fileToggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("distinguishes an empty filter from a repository with no changes", async () => {
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        return Promise.resolve({
          ...payload("file"),
          files: [
            payload("file").files[0],
            {
              path: "new.txt",
              additions: 1,
              deletions: 0,
              binary: false,
              untracked: false,
              hunks: [],
            },
          ],
        });
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({ branches: [], current: "main", defaultTarget: "main" });
      }
      if (String(url).includes("/api/git/pr")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({});
    });

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    await screen.findByText("file.ts");

    fireEvent.change(screen.getByRole("combobox", { name: "表示する変更の種類" }), {
      target: { value: "untracked" },
    });

    expect(await screen.findByText("新規ファイルはありません")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "すべて表示" }));
    expect(screen.getByText("file.ts")).toBeTruthy();
  });

  it("shows all git changes by default even when the current session touched different files", async () => {
    // Regression: task badge shows 変更あり (git has changes) but the Diff
    // tab showed nothing because sessionFilter defaulted to "current" and the
    // changes came from another source (並列セッション前提). The file list
    // must default to all changes so the Diff tab agrees with the badge.
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        return Promise.resolve({
          ...payload("file"),
          files: [
            payload("file").files[0],
            { ...payload("file").files[0], path: "src/external.ts" },
          ],
        });
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({ branches: [], current: "main", defaultTarget: "main" });
      }
      if (String(url).includes("/api/git/pr")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({});
    });

    render(
      <DiffPane
        directory="/repo-a"
        workspaceId="ws-a"
        refreshKey={0}
        touchedPaths={new Set(["src/current.ts"])}
      />,
    );
    await screen.findByText("file.ts");
    expect(screen.getByText("external.ts")).toBeTruthy();
    expect(screen.queryByText("変更はありません")).toBeNull();
  });

  it("explains when the current-session filter hides changes and reveals them via すべて表示", async () => {
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        return Promise.resolve({
          ...payload("file"),
          files: [
            payload("file").files[0],
            { ...payload("file").files[0], path: "src/external.ts" },
          ],
        });
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({ branches: [], current: "main", defaultTarget: "main" });
      }
      if (String(url).includes("/api/git/pr")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({});
    });

    render(
      <DiffPane
        directory="/repo-a"
        workspaceId="ws-a"
        refreshKey={0}
        touchedPaths={new Set(["src/current.ts"])}
      />,
    );
    await screen.findByText("file.ts");

    fireEvent.change(screen.getByRole("combobox", { name: "表示するセッションの変更" }), {
      target: { value: "current" },
    });

    expect(
      await screen.findByText("このセッションが変更したファイルはありません（別セッション・外部の変更があります）"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "すべて表示" }));
    expect(screen.getByText("external.ts")).toBeTruthy();
    expect(screen.getByText("file.ts")).toBeTruthy();
  });

  it("does not commit via Enter when no paths are selected", async () => {
    mockMetaApis();
    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    await screen.findByText("file.ts");

    expect(screen.getByRole("button", { name: "Commit パネル" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Merge パネル" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "PR パネル" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Commit/i }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /file\.ts をコミット対象にする/ }),
    );
    const input = screen.getByPlaceholderText(/コミットメッセージ/);
    fireEvent.change(input, { target: { value: "msg" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendJson).not.toHaveBeenCalled();
  });

  it("ignores a second commit while the first request is pending", async () => {
    mockMetaApis();
    let resolveCommit!: (value: unknown) => void;
    sendJson.mockImplementation((method: string, url: string) => {
      if (method === "POST" && url === "/api/git/commit") {
        return new Promise((resolve) => {
          resolveCommit = resolve;
        });
      }
      return Promise.resolve({});
    });

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    await screen.findByText("file.ts");
    fireEvent.click(screen.getByRole("button", { name: /Commit/i }));
    fireEvent.change(screen.getByPlaceholderText(/コミットメッセージ/), {
      target: { value: "msg" },
    });

    const commit = screen.getByRole("button", { name: /コミット \(1\)/ });
    fireEvent.click(commit);
    fireEvent.click(commit);

    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(commit.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      resolveCommit({});
      await Promise.resolve();
    });
  });

  it("disables Push while there are uncommitted changes", async () => {
    mockMetaApis();
    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    await screen.findByText("file.ts");

    const pushBtn = screen.getByRole("button", {
      name: "現在のブランチをプッシュ",
    }) as HTMLButtonElement;
    expect(pushBtn.disabled).toBe(true);
    expect(pushBtn.getAttribute("title")).toBe("先にコミットしてください");
  });

  it("enables Push when there are no uncommitted changes and ahead > 0", async () => {
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        return Promise.resolve({
          git: true,
          branch: "main",
          additions: 0,
          deletions: 0,
          files: [],
        });
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({
          branches: [],
          current: "main",
          defaultTarget: "main",
          upstream: "origin/main",
          ahead: 2,
          remotes: ["origin"],
          hasRemote: true,
        });
      }
      if (String(url).includes("/api/git/pr")) {
        return Promise.resolve({ available: false });
      }
      if (String(url).includes("/api/workspaces/")) {
        return Promise.resolve({ sessions: [] });
      }
      return Promise.resolve({});
    });

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    const pushBtn = await screen.findByRole("button", {
      name: "現在のブランチをプッシュ",
    }) as HTMLButtonElement;
    expect(pushBtn.disabled).toBe(false);
    expect(pushBtn.textContent).toContain("Push (2)");
  });

  it("disables Push when there is no remote", async () => {
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        return Promise.resolve({
          git: true,
          branch: "main",
          additions: 0,
          deletions: 0,
          files: [],
        });
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({
          branches: [],
          current: "main",
          defaultTarget: "main",
          upstream: null,
          ahead: -1,
          remotes: [],
          hasRemote: false,
        });
      }
      if (String(url).includes("/api/git/pr")) {
        return Promise.resolve({ available: false });
      }
      if (String(url).includes("/api/workspaces/")) {
        return Promise.resolve({ sessions: [] });
      }
      return Promise.resolve({});
    });

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    const pushBtn = await screen.findByRole("button", {
      name: "現在のブランチをプッシュ",
    }) as HTMLButtonElement;
    expect(pushBtn.disabled).toBe(true);
    expect(pushBtn.getAttribute("title")).toBe("リモートが設定されていません");
  });

  it("calls /api/git/push on click when enabled", async () => {
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        return Promise.resolve({
          git: true,
          branch: "main",
          additions: 0,
          deletions: 0,
          files: [],
        });
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({
          branches: [],
          current: "main",
          defaultTarget: "main",
          upstream: "origin/main",
          ahead: 1,
          remotes: ["origin"],
          hasRemote: true,
        });
      }
      if (String(url).includes("/api/git/pr")) {
        return Promise.resolve({ available: false });
      }
      if (String(url).includes("/api/workspaces/")) {
        return Promise.resolve({ sessions: [] });
      }
      return Promise.resolve({});
    });
    sendJson.mockImplementation((method: string, url: string) => {
      if (method === "POST" && url === "/api/git/push") {
        return Promise.resolve({ ok: true, summary: "main -> origin/main" });
      }
      return Promise.resolve({});
    });

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    const pushBtn = await screen.findByRole("button", {
      name: "現在のブランチをプッシュ",
    });
    fireEvent.click(pushBtn);
    await act(async () => {
      await Promise.resolve();
    });
    expect(sendJson).toHaveBeenCalledWith(
      "POST",
      "/api/git/push",
      expect.objectContaining({ directory: "/repo-a", setUpstream: false }),
    );
  });

  it("opens a file in the editor via /api/files/open", async () => {
    mockMetaApis();
    sendJson.mockImplementation((method: string, url: string) => {
      if (method === "POST" && url === "/api/files/open") {
        return Promise.resolve({ ok: true, editor: "vscode" });
      }
      return Promise.resolve({});
    });

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "src/file.ts をエディタで開く" }),
    );
    await screen.findByText("VSCode で開きました: src/file.ts");

    expect(sendJson).toHaveBeenCalledWith("POST", "/api/files/open", {
      directory: "/repo-a",
      path: "src/file.ts",
    });
  });

  it("reports the default editor when VSCode is unavailable", async () => {
    mockMetaApis();
    sendJson.mockImplementation((method: string, url: string) => {
      if (method === "POST" && url === "/api/files/open") {
        return Promise.resolve({ ok: true, editor: "default" });
      }
      return Promise.resolve({});
    });

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "src/file.ts をエディタで開く" }),
    );
    expect(
      await screen.findByText("既定のエディタで開きました: src/file.ts"),
    ).toBeTruthy();
  });

  it("deletes a file via /api/git/rm after confirmation and refreshes the diff", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockMetaApis();
    let diffCalls = 0;
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) diffCalls += 1;
      return mockMetaApisResponse(url);
    });

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "src/file.ts を削除" }),
    );
    await screen.findByText("削除しました: src/file.ts");

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("src/file.ts"),
    );
    expect(sendJson).toHaveBeenCalledWith("POST", "/api/git/rm", {
      directory: "/repo-a",
      path: "src/file.ts",
    });
    expect(diffCalls).toBe(2);
    confirmSpy.mockRestore();
  });

  it("does not delete when the confirmation is declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockMetaApis();

    render(<DiffPane directory="/repo-a" workspaceId="ws-a" refreshKey={0} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "src/file.ts を削除" }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendJson).not.toHaveBeenCalledWith("POST", "/api/git/rm", expect.anything());
    confirmSpy.mockRestore();
  });

  it("calls onFilesCountChange with the visible file count", async () => {
    const onFilesCountChange = vi.fn();
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        return Promise.resolve({
          git: true,
          branch: "main",
          additions: 0,
          deletions: 0,
          files: [
            { path: "src/a.ts", additions: 1, deletions: 0, binary: false, untracked: false, hunks: [] },
            { path: "src/b.ts", additions: 1, deletions: 0, binary: false, untracked: false, hunks: [] },
          ],
        });
      }
      return mockMetaApisResponse(url);
    });

    render(
      <DiffPane
        directory="/repo-a"
        workspaceId="ws-a"
        refreshKey={0}
        touchedPaths={new Set(["src/a.ts"])}
        onFilesCountChange={onFilesCountChange}
      />,
    );
    await screen.findByText("a.ts");

    // Initial render: sessionFilter = "all", so both files are visible.
    expect(onFilesCountChange).toHaveBeenLastCalledWith(2);

    // Switch to "current" session filter → only a.ts visible.
    fireEvent.change(screen.getByRole("combobox", { name: "表示するセッションの変更" }), {
      target: { value: "current" },
    });
    await screen.findByText("a.ts");
    expect(onFilesCountChange).toHaveBeenLastCalledWith(1);

    // Switch to "external" session filter → only b.ts visible.
    fireEvent.change(screen.getByRole("combobox", { name: "表示するセッションの変更" }), {
      target: { value: "external" },
    });
    await screen.findByText("b.ts");
    expect(onFilesCountChange).toHaveBeenLastCalledWith(1);
  });
});
