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

  it("creates, selects, and saves a project agent", async () => {
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
      enabled: true,
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

    // Switch to agents tab
    fireEvent.click(screen.getByRole("tab", { name: "エージェント" }));
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/projects/project-1/agents"));

    const input = await screen.findByPlaceholderText("新しいエージェント名");
    fireEvent.change(input, { target: { value: "reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "エージェントを作成" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/projects/project-1/agents",
        expect.objectContaining({ name: "reviewer" }),
      ),
    );

    const editor = await screen.findByRole("textbox", { name: "エージェント「reviewer」の内容" });
    fireEvent.change(editor, { target: { value: "---\ndescription: Reviewer\n---\n" } });
    fireEvent.click(screen.getByRole("button", { name: "エージェントを保存" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/projects/project-1/agents/reviewer",
        { content: "---\ndescription: Reviewer\n---\n" },
      ),
    );
  });

  it("sets the effort variant for a project agent and saves it", async () => {
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
    const agent = {
      name: "reviewer",
      path: "C:\\repo\\.opencode\\agents\\reviewer.md",
      relativePath: ".opencode/agents/reviewer.md",
      exists: true,
      content: "---\ndescription: Reviewer\nmodel: openai/gpt-5\n---\n",
      enabled: true,
    };
    getJson.mockImplementation((path: string) => {
      if (path.endsWith("/agents")) {
        return Promise.resolve({
          project: { id: "project-1", name: "Fixture", rootPath: "C:\\repo" },
          agents: [agent],
        });
      }
      return Promise.resolve(filesResponse);
    });
    sendJson.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === "PUT" && url.includes("/agents/reviewer")) {
        const content = (body as { content?: string })?.content ?? "";
        return { ok: true, agent: { ...agent, content } };
      }
      return { ok: true };
    });

    render(<ProjectSettingsView projectId="project-1" />);

    fireEvent.click(screen.getByRole("tab", { name: "エージェント" }));
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/projects/project-1/agents"));

    expect(await screen.findByText("推論 effort")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "インテリジェンス" }));
    fireEvent.click(await screen.findByRole("option", { name: "xhigh" }));

    const editor = screen.getByRole("textbox", { name: "エージェント「reviewer」の内容" });
    expect((editor as HTMLTextAreaElement).value).toContain("variant: xhigh");

    fireEvent.click(screen.getByRole("button", { name: "エージェントを保存" }));
    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/projects/project-1/agents/reviewer",
        expect.objectContaining({
          content: expect.stringContaining("variant: xhigh"),
        }),
      ),
    );
  });

  it("sets the model for a project agent via the dropdown and saves it", async () => {
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
    const agent = {
      name: "reviewer",
      path: "C:\\repo\\.opencode\\agents\\reviewer.md",
      relativePath: ".opencode/agents/reviewer.md",
      exists: true,
      content: "---\ndescription: Reviewer\n---\n",
      enabled: true,
    };
    getJson.mockImplementation((path: string) => {
      if (path.endsWith("/provider-models")) {
        return Promise.resolve({
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              enabled: true,
              models: [{ id: "gpt-5", name: "GPT-5" }],
            },
          ],
        });
      }
      if (path.endsWith("/agents")) {
        return Promise.resolve({
          project: { id: "project-1", name: "Fixture", rootPath: "C:\\repo" },
          agents: [agent],
        });
      }
      return Promise.resolve(filesResponse);
    });
    sendJson.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === "PUT" && url.includes("/agents/reviewer")) {
        const content = (body as { content?: string })?.content ?? "";
        return { ok: true, agent: { ...agent, content } };
      }
      return { ok: true };
    });

    render(<ProjectSettingsView projectId="project-1" />);

    fireEvent.click(screen.getByRole("tab", { name: "エージェント" }));
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/projects/project-1/agents"));
    await screen.findByText("推論 effort");

    // Selecting a model enables the previously disabled effort dropdown.
    fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));
    fireEvent.click(await screen.findByRole("option", { name: "GPT-5" }));

    const editor = screen.getByRole("textbox", { name: "エージェント「reviewer」の内容" });
    expect((editor as HTMLTextAreaElement).value).toContain("model: openai/gpt-5");
    expect(
      (screen.getByRole("button", { name: "インテリジェンス" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "エージェントを保存" }));
    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/projects/project-1/agents/reviewer",
        expect.objectContaining({
          content: expect.stringContaining("model: openai/gpt-5"),
        }),
      ),
    );
  });

  it("toggles a project agent and syncs the editor draft", async () => {
    const agent = {
      name: "reviewer",
      path: "C:\\repo\\.opencode\\agents\\reviewer.md",
      relativePath: ".opencode/agents/reviewer.md",
      exists: true,
      content: "---\ndescription: Reviewer\n---\n",
      enabled: true,
    };
    getJson.mockImplementation((path: string) => {
      if (path.endsWith("/agents")) {
        return Promise.resolve({
          project: { id: "project-1", name: "Fixture", rootPath: "C:\\repo" },
          agents: [agent],
        });
      }
      return Promise.resolve({
        project: { id: "project-1", name: "Fixture", rootPath: "C:\\repo" },
        files: [],
      });
    });
    const disabled = {
      ...agent,
      enabled: false,
      content: "---\ndescription: Reviewer\ndisable: true\n---\n",
    };
    sendJson.mockResolvedValue({ ok: true, agent: disabled });

    render(<ProjectSettingsView projectId="project-1" />);
    fireEvent.click(screen.getByRole("tab", { name: "エージェント" }));

    const toggle = await screen.findByRole("switch", { name: "reviewer を無効化" });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "PATCH",
        "/api/projects/project-1/agents/reviewer",
        { enabled: false },
      ),
    );
    const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "エージェント「reviewer」の内容",
    });
    expect(editor.value).toBe(disabled.content);
    expect(screen.getByRole("switch", { name: "reviewer を有効化" })).toBeTruthy();
  });

  it("creates and saves a project skill", async () => {
    getJson.mockImplementation((path: string) => {
      if (path.endsWith("/skills")) {
        return Promise.resolve({
          project: { id: "project-1", name: "Fixture", rootPath: "C:\\repo" },
          skills: [],
        });
      }
      return Promise.resolve({
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
      });
    });
    const createdSkill = {
      name: "code-review",
      path: "C:\\repo\\.opencode\\skills\\code-review\\SKILL.md",
      relativePath: ".opencode/skills/code-review/SKILL.md",
      exists: true,
      content: "---\nname: code-review\ndescription: \"\"\n---\n\n# code-review\n",
    };
    sendJson.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === "POST" && url.endsWith("/skills")) {
        return { ok: true, skill: createdSkill };
      }
      if (method === "PUT" && url.includes("/skills/code-review")) {
        const content = (body as { content?: string })?.content ?? "";
        return { ok: true, skill: { ...createdSkill, content } };
      }
      return { ok: true };
    });

    render(<ProjectSettingsView projectId="project-1" />);
    fireEvent.click(screen.getByRole("tab", { name: "スキル" }));
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/projects/project-1/skills"));

    fireEvent.change(await screen.findByPlaceholderText("新しいスキル名"), {
      target: { value: "code-review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "スキルを作成" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/projects/project-1/skills",
        expect.objectContaining({ name: "code-review" }),
      ),
    );

    const editor = await screen.findByRole("textbox", { name: "スキル「code-review」の内容" });
    fireEvent.change(editor, { target: { value: "Updated skill" } });
    fireEvent.click(screen.getByRole("button", { name: "スキルを保存" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/projects/project-1/skills/code-review",
        { content: "Updated skill" },
      ),
    );
  });
});
