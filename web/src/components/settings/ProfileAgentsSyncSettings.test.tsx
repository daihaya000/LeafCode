import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileAgentsSyncSettings } from "./ProfileAgentsSyncSettings";

const h = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson: (...a: unknown[]) => h.getJson(...a),
  sendJson: (...a: unknown[]) => h.sendJson(...a),
}));

const syncStatus = {
  instructions: {
    master: { path: "C:/AGENTS.md", exists: true },
    claude: { path: "C:/claude/AGENTS.md", status: { kind: "ok", message: "同期済み" } },
    codex: { path: "C:/codex/AGENTS.md", status: { kind: "ok", message: "同期済み" } },
    cursor: { path: "C:/cursor/AGENTS.md", status: { kind: "ok", message: "同期済み" } },
  },
  skills: {
    opencodeRoot: { path: "C:/skills", exists: true, count: 3 },
    mirrors: {
      claude: { path: "C:/claude/skills", status: { kind: "ok", message: "同期済み" } },
    },
    hermes: { path: "C:/hermes.yaml", status: { kind: "ok", message: "同期済み" } },
  },
};

const agentsMd = { path: "C:/AGENTS.md", exists: true, content: "master content" };

beforeEach(() => {
  vi.clearAllMocks();
  h.getJson.mockImplementation(async (url: string) => {
    if (url.includes("/api/profiles/agents-sync")) return syncStatus;
    if (url.includes("/api/profiles/agents-md")) return agentsMd;
    throw new Error(`unexpected getJson: ${url}`);
  });
  h.sendJson.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

describe("ProfileAgentsSyncSettings", () => {
  it("shows a loading state before the status arrives", () => {
    h.getJson.mockImplementation(() => new Promise(() => undefined));
    render(<ProfileAgentsSyncSettings />);
    expect(screen.getByText("読み込み中…")).toBeTruthy();
  });

  it("renders the master row and the AGENTS.md editor after loading", async () => {
    render(<ProfileAgentsSyncSettings />);
    expect(
      await screen.findByText("マスター (OpenCode)"),
    ).toBeTruthy();
    expect(screen.getByLabelText("現在のプロファイルのAGENTS.md")).toHaveProperty(
      "value",
      "master content",
    );
    expect(screen.getByRole("button", { name: "AGENTS.mdを保存" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /同期を実行/ })).toBeTruthy();
    expect(screen.getByText(/playwright-cli-wrap/)).toBeTruthy();
    expect(screen.getByText(/ミラーしません/)).toBeTruthy();
  });

  it("saves the AGENTS.md content", async () => {
    render(<ProfileAgentsSyncSettings />);
    await screen.findByText("マスター (OpenCode)");

    fireEvent.change(screen.getByLabelText("現在のプロファイルのAGENTS.md"), {
      target: { value: "updated content" },
    });
    fireEvent.click(screen.getByRole("button", { name: "AGENTS.mdを保存" }));

    await waitFor(() => {
      expect(h.sendJson).toHaveBeenCalledWith(
        "PATCH",
        "/api/profiles/agents-md",
        { content: "updated content" },
      );
    });
  });

  it("runs the sync and reports the result", async () => {
    h.sendJson.mockResolvedValue({
      ok: true,
      instructions: { copied: 1, skipped: 2, errors: [] },
      skills: { created: 3, skipped: 0, errors: [] },
      hermes: { updated: 1, skipped: 0, errors: [] },
    });
    render(<ProfileAgentsSyncSettings />);
    await screen.findByText("マスター (OpenCode)");

    fireEvent.click(screen.getByRole("button", { name: /同期を実行/ }));
    await waitFor(() => {
      expect(h.sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/profiles/agents-sync",
      );
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "5 件を更新しました",
    );
  });

  it("shows an error when the sync reports failures", async () => {
    h.sendJson.mockResolvedValue({
      ok: false,
      instructions: { copied: 0, skipped: 0, errors: ["codex failed"] },
      skills: { created: 0, skipped: 0, errors: [] },
      hermes: { updated: 0, skipped: 0, errors: [] },
    });
    render(<ProfileAgentsSyncSettings />);
    await screen.findByText("マスター (OpenCode)");

    fireEvent.click(screen.getByRole("button", { name: /同期を実行/ }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "codex failed",
    );
  });
});
