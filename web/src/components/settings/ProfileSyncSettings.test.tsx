import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSyncSettings } from "./ProfileSyncSettings";

const h = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson: (...a: unknown[]) => h.getJson(...a),
  sendJson: (...a: unknown[]) => h.sendJson(...a),
}));

const syncData = {
  status: {
    master: {
      path: "C:/opencode.jsonc",
      exists: true,
      servers: ["mcp-server-1"],
      error: null,
    },
    codex: { path: "C:/codex/config.toml", exists: true },
    claude: { path: "C:/claude/settings.json", exists: true },
    cursor: { path: "C:/cursor/mcp.json", exists: true },
  },
  plan: {
    ok: true,
    masterServers: ["mcp-server-1"],
    targets: {
      codex: { exists: true, inSync: true, wouldChange: false, message: "同期済み" },
      claude: { exists: true, inSync: true, wouldChange: false, message: "同期済み" },
      cursor: { exists: true, inSync: true, wouldChange: false, message: "同期済み" },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getJson.mockResolvedValue(syncData);
  h.sendJson.mockResolvedValue({ ok: true, changedFiles: 0, targets: {} });
});

afterEach(() => {
  cleanup();
});

describe("ProfileSyncSettings", () => {
  it("shows a loading state before the status arrives", () => {
    h.getJson.mockImplementation(() => new Promise(() => undefined));
    render(<ProfileSyncSettings />);
    expect(screen.getByText("読み込み中…")).toBeTruthy();
  });

  it("renders the master and target rows after loading", async () => {
    render(<ProfileSyncSettings />);
    expect(
      await screen.findByText("マスター (OpenCode)"),
    ).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Cursor")).toBeTruthy();
    expect(screen.getByText("すべて同期済み")).toBeTruthy();
  });

  it("runs the sync and reports the result", async () => {
    h.sendJson.mockResolvedValue({
      ok: true,
      changedFiles: 2,
      targets: {
        codex: { exists: true, updated: true, message: "2 サーバー更新" },
      },
    });
    render(<ProfileSyncSettings />);
    await screen.findByText("マスター (OpenCode)");

    fireEvent.click(screen.getByRole("button", { name: /同期を実行|ファイルを同期/ }));
    await waitFor(() => {
      expect(h.sendJson).toHaveBeenCalledWith("POST", "/api/profiles/sync");
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "2 ファイルを更新しました",
    );
  });

  it("shows an error when the sync fails", async () => {
    h.sendJson.mockResolvedValue({ ok: false, error: "同期に失敗しました" });
    render(<ProfileSyncSettings />);
    await screen.findByText("マスター (OpenCode)");

    fireEvent.click(screen.getByRole("button", { name: /同期を実行|ファイルを同期/ }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "同期に失敗しました",
    );
  });

  it("opens a target file via the open button", async () => {
    render(<ProfileSyncSettings />);
    await screen.findByText("マスター (OpenCode)");

    fireEvent.click(screen.getAllByText("ファイルを開く")[0]);
    await waitFor(() => {
      expect(h.sendJson).toHaveBeenCalledWith("POST", "/api/profiles/open-target", {
        target: "sync-master",
        action: "open-file",
      });
    });
  });
});
