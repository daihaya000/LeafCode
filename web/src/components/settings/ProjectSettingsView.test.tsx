import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSettingsView } from "./ProjectSettingsView";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ getJson, sendJson }));
vi.mock("@/components/shell/MobileMenuHeader", () => ({
  MobileMenuHeader: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectSettingsView", () => {
  it("loads, switches, and saves project setting files", async () => {
    getJson.mockResolvedValue({
      project: { id: "project-1", name: "Fixture", rootPath: "C:\\repo" },
      files: [
        {
          key: "AGENTS.md",
          label: "AGENTS.md",
          description: "Agent instructions",
          exists: true,
          content: "Existing agents",
        },
        {
          key: "CLAUDE.md",
          label: "CLAUDE.md",
          description: "Claude instructions",
          exists: false,
          content: "",
        },
      ],
    });
    sendJson.mockResolvedValue({ ok: true });

    render(<ProjectSettingsView projectId="project-1" />);

    expect(await screen.findByDisplayValue("Existing agents")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /CLAUDE\.md/ }));
    const editor = screen.getByRole("textbox", { name: "CLAUDE.mdの内容" });
    fireEvent.change(editor, { target: { value: "Claude project rules" } });
    fireEvent.click(screen.getByRole("button", { name: "CLAUDE.mdを保存" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "PATCH",
        "/api/projects/project-1/settings",
        { file: "CLAUDE.md", content: "Claude project rules" },
      ),
    );
    expect(await screen.findByText("CLAUDE.mdを保存しました")).toBeTruthy();
  });
});
