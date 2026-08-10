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

  it("creates, selects, and saves a project subagent", async () => {
    const agentsResponse = {
      project: { id: "project-1", name: "Fixture", rootPath: "C:\\repo" },
      agents: [],
    };
    const filesResponse = {
      project: { id: "project-1", name: "Fixture", rootPath: "C:\\repo" },
      files: [
        {
          key: "AGENTS.md",
          label: "AGENTS.md",
          description: "Agent instructions",
          exists: true,
          content: "Existing",
        },
      ],
    };
    getJson.mockImplementation((path: string) => {
      if (path.endsWith("/agents")) return Promise.resolve(agentsResponse);
      return Promise.resolve(filesResponse);
    });
    const createdAgent = {
      name: "reviewer",
      path: "C:\\repo\\.opencode\\agents\\reviewer.md",
      relativePath: ".opencode/agents/reviewer.md",
      exists: true,
      content: "---\ndescription: \"\"\nmode: subagent\nmodel: openai/gpt-5\n---\n",
    };
    sendJson.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === "POST" && url.endsWith("/agents")) {
        return { ok: true, agent: createdAgent };
      }
      if (method === "PUT" && url.includes("/agents/reviewer")) {
        const content = (body as { content?: string })?.content ?? "";
        return { ok: true, agent: { ...createdAgent, content } };
      }
      return { ok: true };
    });

    render(<ProjectSettingsView projectId="project-1" />);

    // Switch to subagents tab
    fireEvent.click(screen.getByRole("tab", { name: "サブエージェント" }));
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/projects/project-1/agents"));

    const input = await screen.findByPlaceholderText("新しいエージェント名");
    fireEvent.change(input, { target: { value: "reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "サブエージェントを作成" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/projects/project-1/agents",
        expect.objectContaining({ name: "reviewer" }),
      ),
    );

    const editor = await screen.findByRole("textbox", { name: "サブエージェント「reviewer」の内容" });
    fireEvent.change(editor, { target: { value: "---\ndescription: Reviewer\n---\n" } });
    fireEvent.click(screen.getByRole("button", { name: "サブエージェントを保存" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/projects/project-1/agents/reviewer",
        { content: "---\ndescription: Reviewer\n---\n" },
      ),
    );
  });
});