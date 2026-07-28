import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeView } from "./HomeView";

const { getJson, sendJson, push, timedFetch } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
  push: vi.fn(),
  timedFetch: vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/client", () => ({ getJson, sendJson, timedFetch }));
vi.mock("@/lib/events", () => ({ notifyTasksChanged: vi.fn() }));
vi.mock("@/lib/access-mode", () => ({
  ACCESS_MODE_OPTIONS: [
    { value: "ask", label: "確認する", title: "" },
    { value: "full", label: "フルアクセス", title: "" },
  ],
  readAccessMode: () => "ask",
  writeAccessMode: vi.fn(),
}));
vi.mock("@/lib/default-model", () => ({
  readDefaultModel: () => {
    const v = localStorage.getItem("webui:default-model");
    return typeof v === "string" && v.length > 0 ? v : null;
  },
  readDefaultModelFromServer: () => Promise.resolve(null),
  writeDefaultModel: (value: string | null) => {
    if (value) {
      localStorage.setItem("webui:default-model", value);
    } else {
      localStorage.removeItem("webui:default-model");
    }
  },
  readLastUsedModel: () => {
    const v = localStorage.getItem("webui:last-used-model");
    return typeof v === "string" && v.length > 0 ? v : null;
  },
  writeLastUsedModel: (value: string | null) => {
    if (value) {
      localStorage.setItem("webui:last-used-model", value);
    } else {
      localStorage.removeItem("webui:last-used-model");
    }
  },
}));
vi.mock("@/components/shell/ShellContext", () => ({
  useShellMobileNav: () => ({
    mobileNavOpen: false,
    openMobileNav: vi.fn(),
    closeMobileNav: vi.fn(),
  }),
}));

describe("HomeView image attachments", () => {
  beforeEach(() => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "project-1",
              name: "Project",
              rootPath: "/repo",
              favorite: false,
            },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ engineOk: true });
      if (path === "/api/git/branches") {
        return Promise.resolve({
          branches: ["main"],
          defaultTarget: "main",
          current: "main",
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({ taskId: "task-1" });
    timedFetch.mockReset();
    timedFetch.mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps a mobile nav menu entry that controls the drawer", async () => {
    render(<HomeView />);
    const menu = await screen.findByLabelText("メニュー");
    expect(menu.getAttribute("aria-controls")).toBe("mobile-nav");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["ctrlKey", "metaKey"])("starts a task only with %s+Enter", async (modifier) => {
    render(<HomeView />);
    const prompt = screen.getByRole("combobox", { name: "タスクの説明" });
    const submit = screen.getByRole("button", { name: "タスク開始" });
    fireEvent.change(prompt, { target: { value: "keyboard task" } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));

    fireEvent.keyDown(prompt, { key: "Enter", [modifier]: true });

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/tasks",
        expect.objectContaining({ prompt: "keyboard task" }),
      ),
    );
  });

  it("does not start a task on Enter or Shift+Enter", () => {
    render(<HomeView />);
    const prompt = screen.getByRole("combobox", { name: "タスクの説明" });
    fireEvent.change(prompt, { target: { value: "keyboard task" } });

    fireEvent.keyDown(prompt, { key: "Enter" });
    fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });

    expect(sendJson).not.toHaveBeenCalled();
  });

  it("submits an image selected without a text prompt", async () => {
    timedFetch.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  vision: {
                    name: "Vision",
                    capabilities: { input: { image: true } },
                  },
                },
              },
            ],
            connected: ["openai"],
            default: { openai: "vision" },
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    render(<HomeView />);

    const image = new File(["image"], "reference.png", {
      type: "image/png",
    });
    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, { target: { files: [image] } });

    expect(await screen.findByRole("img", { name: "reference.png" })).toBeTruthy();
    await screen.findByLabelText("モデル");
    const submit = screen.getByRole("button", {
      name: "タスク開始",
    }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/tasks",
        expect.objectContaining({
          projectId: "project-1",
          prompt: "",
          files: [
            expect.objectContaining({ mime: "image/png", name: "reference.png" }),
          ],
        }),
      ),
    );
  });

  it("blocks image submission to an unknown model (capability undefined)", async () => {
    render(<HomeView />);

    const image = new File(["image"], "unknown.png", { type: "image/png" });
    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, { target: { files: [image] } });
    expect(await screen.findByRole("img", { name: "unknown.png" })).toBeTruthy();

    const submit = screen.getByRole("button", { name: "タスク開始" });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(sendJson).not.toHaveBeenCalled();
    });
  });

  it("keeps the image attachment button visible but disabled for image-unsupported models", async () => {
    timedFetch.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  text: { name: "Text", capabilities: { input: { image: false } } },
                },
              },
            ],
            connected: ["openai"],
            default: { openai: "text" },
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<HomeView />);

    const attach = await screen.findByRole("button", { name: "画像を添付" });
    expect(attach).toBeTruthy();
    expect((attach as HTMLButtonElement).disabled).toBe(true);
    expect(attach.getAttribute("title")).toBe(
      "選択中のモデルは画像入力に対応していません",
    );
  });

  it("blocks image submission when the selected agent model lacks image capability", async () => {
    timedFetch.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  vision: { capabilities: { input: { image: true } } },
                  "text-agent": { capabilities: { input: { image: false } } },
                },
              },
            ],
            connected: ["openai"],
            default: { openai: "vision" },
          }),
        });
      }
      if (path === "/api/opencode/agent") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              name: "text-agent",
              model: { providerID: "openai", modelID: "text-agent" },
            },
          ],
        });
      }
      return Promise.resolve({ ok: false });
    });
    render(<HomeView />);

    await waitFor(() => {
      expect((screen.getByLabelText("エージェント") as HTMLSelectElement).value).toBe(
        "text-agent",
      );
      expect((screen.getByLabelText("モデル") as HTMLSelectElement).value).toBe(
        "openai::vision",
      );
    });
    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: { files: [new File(["image"], "agent-text.png", { type: "image/png" })] },
    });
    const submit = screen.getByRole("button", { name: "タスク開始" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => {
      expect(sendJson).not.toHaveBeenCalled();
    });
  });

  it("previews multiple images and removes one independently", async () => {
    render(<HomeView />);

    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: {
        files: [
          new File(["first"], "first.png", { type: "image/png" }),
          new File(["second"], "second.png", { type: "image/png" }),
        ],
      },
    });

    expect(await screen.findByRole("img", { name: "first.png" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "second.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "first.pngを削除" }));
    expect(screen.queryByRole("img", { name: "first.png" })).toBeNull();
    expect(screen.getByRole("img", { name: "second.png" })).toBeTruthy();
  });

  it("labels the prompt and keeps attachment removal visible on keyboard focus", async () => {
    render(<HomeView />);

    expect(await screen.findByLabelText("タスクの説明")).toBeTruthy();
    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: { files: [new File(["image"], "keyboard.png", { type: "image/png" })] },
    });
    const remove = await screen.findByRole("button", { name: "keyboard.pngを削除" });
    expect(remove.className).toContain("focus-visible:opacity-100");
  });

  it("adds an image pasted into the prompt", async () => {
    render(<HomeView />);

    const image = new File(["image"], "pasted.png", { type: "image/png" });
    fireEvent.paste(
      screen.getByPlaceholderText("タスクを説明してください…（Ctrl+Enter で開始）"),
      {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => image,
            },
          ],
        },
      },
    );

    expect(await screen.findByRole("img", { name: "pasted.png" })).toBeTruthy();
  });

  it("disables attachment controls while submitting and preserves attachments after failure", async () => {
    timedFetch.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  vision: {
                    name: "Vision",
                    capabilities: { input: { image: true } },
                  },
                },
              },
            ],
            connected: ["openai"],
            default: { openai: "vision" },
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    let rejectRequest: (reason: Error) => void = () => undefined;
    sendJson.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    render(<HomeView />);

    const prompt = screen.getByPlaceholderText(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    fireEvent.change(prompt, { target: { value: "describe this" } });
    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: { files: [new File(["image"], "failed.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("img", { name: "failed.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => {
      expect(
        (screen.getByLabelText("画像を添付") as HTMLButtonElement).disabled,
      ).toBe(true);
      expect((prompt as HTMLTextAreaElement).readOnly).toBe(true);
    });
    fireEvent.paste(prompt, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => new File(["image"], "during-submit.png", { type: "image/png" }),
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("img", { name: "during-submit.png" })).toBeNull();
    rejectRequest(new Error("network failed"));

    expect((await screen.findByRole("alert")).textContent).toContain("network failed");
    expect((prompt as HTMLTextAreaElement).value).toBe("describe this");
    expect(screen.getByRole("img", { name: "failed.png" })).toBeTruthy();
  });

  it("matches the session composer toolbar layout", async () => {
    render(<HomeView />);

    const form = await screen.findByRole("form", { name: "タスク作成" });
    const toolbar = form.querySelector(":scope > div.pt-1");
    expect(toolbar).not.toBeNull();
    expect(toolbar?.className).toMatch(/\bflex\b/);
    expect(toolbar?.className).toMatch(/\bitems-center\b/);
    expect(toolbar?.className).not.toMatch(/\bgrid\b/);
    expect(toolbar?.className).not.toContain("xl:grid-cols-");
    expect(toolbar?.className).not.toMatch(/\bflex-wrap\b/);

    const rows = toolbar?.querySelectorAll(":scope > div");
    expect(rows?.length).toBe(1);

    const controlRow = rows![0];
    expect(controlRow.className).toMatch(/\bflex\b/);
    expect(controlRow.className).toMatch(/overflow-x-auto/);

    const projectSelect = screen.getByLabelText("プロジェクト");
    const branchSelect = screen.getByLabelText("作業場所");
    expect(form.contains(projectSelect)).toBe(false);
    expect(form.contains(branchSelect)).toBe(false);
    expect(projectSelect.parentElement?.parentElement?.className).toMatch(/\bmb-3\b/);
    expect(branchSelect.parentElement?.parentElement?.className).toMatch(/\bmb-3\b/);
    expect(controlRow.contains(projectSelect)).toBe(false);
    expect(controlRow.contains(branchSelect)).toBe(false);
    expect(controlRow.contains(screen.getByLabelText("アクセスモード"))).toBe(true);

    expect(toolbar?.contains(screen.getByRole("button", { name: "タスク開始" }))).toBe(
      true,
    );

    const accessTrigger = screen.getByLabelText("アクセスモード");
    const accessWrap = accessTrigger.parentElement;
    const skillTrigger = screen.getByLabelText("スキル");
    const skillWrap = skillTrigger.parentElement;
    const subagentTrigger = screen.getByLabelText("サブエージェント");
    const subagentWrap = subagentTrigger.parentElement;
    expect(accessWrap?.className).not.toContain("order-first");
    expect(accessWrap?.className).not.toContain("xl:order-none");
    expect(accessWrap?.className).toContain("shrink-0");
    expect(accessWrap?.compareDocumentPosition(skillWrap!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(skillWrap?.compareDocumentPosition(subagentWrap!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  describe("HomeView voice input", () => {
    let mockRecognition: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
      _dispatch: (type: string, ...args: unknown[]) => void;
    };

    beforeEach(() => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      mockRecognition = {
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        addEventListener: vi.fn(
          (type: string, handler: (...args: unknown[]) => void) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(handler);
          },
        ),
        removeEventListener: vi.fn(
          (type: string, handler: (...args: unknown[]) => void) => {
            listeners.get(type)?.delete(handler);
          },
        ),
        _dispatch(type: string, ...args: unknown[]) {
          for (const handler of listeners.get(type) ?? []) {
            handler(...args);
          }
        },
      };
      // Wrap the mock in a constructor so `new Ctor()` works (see
      // use-voice-input.test.ts for the same pattern).
      function MockCtor() {
        return mockRecognition;
      }
      vi.stubGlobal("webkitSpeechRecognition", MockCtor);
      vi.stubGlobal("SpeechRecognition", undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("renders the mic button when SpeechRecognition is supported", async () => {
      render(<HomeView />);
      expect(await screen.findByRole("button", { name: "音声入力" })).toBeTruthy();
    });

    it("appends transcript to the prompt on stop", async () => {
      render(<HomeView />);
      const micBtn = await screen.findByRole("button", { name: "音声入力" });

      // Start listening
      fireEvent.click(micBtn);
      act(() => mockRecognition._dispatch("start"));

      // Simulate final result (shape matches use-voice-input.test.ts: each
      // result is array-like with a numeric-index alternative plus isFinal).
      act(() =>
        mockRecognition._dispatch("result", {
          resultIndex: 0,
          results: [{ 0: { transcript: "hello world" }, isFinal: true }],
        }),
      );

      // Stop listening (button label changes). stop() resolves on `end`.
      fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));
      await act(async () => {
        mockRecognition._dispatch("end");
        await Promise.resolve();
      });

      const textarea = screen.getByRole("combobox", {
        name: "タスクの説明",
      }) as HTMLTextAreaElement;
      expect(textarea.value).toBe("hello world");
    });

    it("does not append a trailing space when the transcript is empty", async () => {
      render(<HomeView />);
      const prompt = screen.getByPlaceholderText(
        "タスクを説明してください…（Ctrl+Enter で開始）",
      ) as HTMLTextAreaElement;
      fireEvent.change(prompt, { target: { value: "hello" } });

      const micBtn = await screen.findByRole("button", { name: "音声入力" });

      // Start listening
      fireEvent.click(micBtn);
      act(() => mockRecognition._dispatch("start"));

      // Simulate a final result with an empty transcript.
      act(() =>
        mockRecognition._dispatch("result", {
          resultIndex: 0,
          results: [{ 0: { transcript: "" }, isFinal: true }],
        }),
      );

      // Stop listening (button label changes). stop() resolves on `end`.
      fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));
      await act(async () => {
        mockRecognition._dispatch("end");
        await Promise.resolve();
      });

      expect(prompt.value).toBe("hello");
    });

    it("disables the mic button while submitting", async () => {
      let rejectRequest: (reason: Error) => void = () => undefined;
      sendJson.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectRequest = reject;
          }),
      );
      render(<HomeView />);

      const prompt = screen.getByPlaceholderText(
        "タスクを説明してください…（Ctrl+Enter で開始）",
      );
      fireEvent.change(prompt, { target: { value: "test" } });
      const submit = screen.getByRole("button", {
        name: "タスク開始",
      }) as HTMLButtonElement;
      // Wait for the async project load so submit is actually enabled
      // (matches the pattern used by the other HomeView submit tests).
      await waitFor(() => expect(submit.disabled).toBe(false));
      fireEvent.click(submit);

      await waitFor(() => {
        expect(
          (screen.getByRole("button", { name: "音声入力" }) as HTMLButtonElement)
            .disabled,
        ).toBe(true);
      });

      rejectRequest(new Error("network failed"));
    });
  });
});

describe("HomeView subagent permission", () => {
  beforeEach(() => {
    localStorage.clear();
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            { id: "project-1", name: "Project", rootPath: "/repo", favorite: false },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ engineOk: true });
      if (path === "/api/git/branches") {
        return Promise.resolve({
          branches: ["main"],
          defaultTarget: "main",
          current: "main",
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({ taskId: "task-1" });
    timedFetch.mockReset();
    timedFetch.mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("persists 禁止 locally without a config write (applied at task creation)", async () => {
    timedFetch.mockImplementation((input: string) => {
      if (input.endsWith("/agent")) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ name: "build" }],
        });
      }
      return Promise.resolve({ ok: false });
    });
    render(<HomeView />);
    await screen.findByLabelText("エージェント");
    const select = (await screen.findByLabelText(
      "サブエージェント",
    )) as HTMLButtonElement;
    expect(select.value).toBe("allow");

    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "禁止" }));

    await waitFor(() =>
      expect(localStorage.getItem("webui:subagent-permission")).toBe("deny"),
    );
    expect(select.value).toBe("deny");
    // Home has no live session; enforcement happens in POST /api/tasks, so the
    // toggle must not perform a standalone permission write.
    expect(sendJson).not.toHaveBeenCalledWith(
      "POST",
      "/api/subagent-permission",
      expect.anything(),
    );

    const skillSelect = screen.getByLabelText("スキル") as HTMLButtonElement;
    expect(skillSelect.value).toBe("allow");
    fireEvent.click(skillSelect);
    fireEvent.click(screen.getByRole("option", { name: "禁止" }));
    await waitFor(() =>
      expect(localStorage.getItem("webui:skill-permission")).toBe("deny"),
    );
    expect(skillSelect.value).toBe("deny");
    expect(sendJson).not.toHaveBeenCalledWith(
      "POST",
      "/api/skill-permission",
      expect.anything(),
    );
  });

  it("sends subagentPermission on submit even when no agent is selected", async () => {
    // Regression: /api/opencode/agent returns no agents here (default mock:
    // `{ ok: false }`), so the agent selector never renders and `agent` stays
    // "". subagentPermission is session-scoped, not agent-scoped, so it must
    // still reach POST /api/tasks — otherwise "禁止" has no effect on the
    // new session's first prompt.
    render(<HomeView />);
    const select = (await screen.findByLabelText(
      "サブエージェント",
    )) as HTMLButtonElement;
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "禁止" }));
    await waitFor(() =>
      expect(localStorage.getItem("webui:subagent-permission")).toBe("deny"),
    );

    const prompt = screen.getByPlaceholderText(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    fireEvent.change(prompt, { target: { value: "hello" } });
    const submit = screen.getByRole("button", {
      name: "タスク開始",
    }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/tasks",
        expect.objectContaining({ subagentPermission: "deny" }),
      ),
    );
    const [, , sentBody] = sendJson.mock.calls.find(
      ([, path]) => path === "/api/tasks",
    )!;
    expect(sentBody.agent).toBeUndefined();
  });
});

describe("HomeView last-used model", () => {
  beforeEach(() => {
    localStorage.clear();
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "project-1",
              name: "Project",
              rootPath: "/repo",
              favorite: false,
            },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ engineOk: true });
      if (path === "/api/git/branches") {
        return Promise.resolve({
          branches: ["main"],
          defaultTarget: "main",
          current: "main",
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({ taskId: "task-1" });
    timedFetch.mockReset();
    timedFetch.mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("preselects the last-used model when it is an available option", async () => {
    localStorage.setItem("webui:last-used-model", "openai::gpt-5");
    timedFetch.mockImplementation((input: string) => {
      if (input.endsWith("/provider")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  "gpt-5": { name: "GPT-5" },
                  vision: { name: "Vision" },
                },
              },
            ],
            connected: ["openai"],
            default: { openai: "vision" },
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    render(<HomeView />);

    const select = (await screen.findByLabelText(
      "モデル",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("openai::gpt-5");
    });
  });

  it("falls back to the provider default when last-used is not available", async () => {
    localStorage.setItem("webui:last-used-model", "mystery::ghost");
    timedFetch.mockImplementation((input: string) => {
      if (input.endsWith("/provider")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: { vision: { name: "Vision" } },
              },
            ],
            connected: ["openai"],
            default: { openai: "vision" },
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    render(<HomeView />);

    const select = (await screen.findByLabelText(
      "モデル",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("openai::vision");
    });
  });

  it("records the model actually submitted as last-used on success", async () => {
    timedFetch.mockImplementation((input: string) => {
      if (input.endsWith("/provider")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  vision: {
                    name: "Vision",
                    capabilities: { input: { image: false } },
                  },
                },
              },
            ],
            connected: ["openai"],
            default: { openai: "vision" },
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    render(<HomeView />);

    const prompt = screen.getByPlaceholderText(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    fireEvent.change(prompt, { target: { value: "hello" } });
    const submit = screen.getByRole("button", {
      name: "タスク開始",
    }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(localStorage.getItem("webui:last-used-model")).toBe(
        "openai::vision",
      ),
    );
  });
});

describe("HomeView engine health polling", () => {
  beforeEach(() => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "project-1",
              name: "Project",
              rootPath: "/repo",
              favorite: false,
            },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ engineOk: false });
      if (path === "/api/git/branches") {
        return Promise.resolve({
          branches: ["main"],
          defaultTarget: "main",
          current: "main",
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({ taskId: "task-1" });
    timedFetch.mockReset();
    timedFetch.mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows the engine-not-connected warning and self-clears once engineOk flips to true", async () => {
    let engineOk = false;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "project-1",
              name: "Project",
              rootPath: "/repo",
              favorite: false,
            },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ engineOk });
      if (path === "/api/git/branches") {
        return Promise.resolve({
          branches: ["main"],
          defaultTarget: "main",
          current: "main",
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<HomeView />);

    // Initial fetch reports engine down -> warning banner appears.
    const warning = await screen.findByText("エンジン未接続。設定またはトレイから OpenCode を再起動してください。");
    expect(warning).toBeTruthy();

    // Engine becomes reachable; next 3s poll tick should clear the warning.
    engineOk = true;
    await waitFor(
      () =>
        expect(
          screen.queryByText("エンジン未接続。設定またはトレイから OpenCode を再起動してください。"),
        ).toBeNull(),
      { timeout: 8000 },
    );
  }, 15000);

  it("pauses engine health polling while the tab is hidden and resumes on visibility", async () => {
    vi.useFakeTimers();
    render(<HomeView />);

    // Flush the initial load promises (refreshProjects + refreshEngine).
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(
      screen.getByText("エンジン未接続。設定またはトレイから OpenCode を再起動してください。"),
    ).toBeTruthy();

    const tasksCallsBefore = getJson.mock.calls.filter(
      ([p]) => p === "/api/tasks",
    ).length;

    // Hide the tab — polling should stop.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance well past several poll intervals — no new /api/tasks calls.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 3); });
    const tasksCallsWhileHidden = getJson.mock.calls.filter(
      ([p]) => p === "/api/tasks",
    ).length;
    expect(tasksCallsWhileHidden).toBe(tasksCallsBefore);

    // Show the tab — an immediate refresh fires and polling resumes.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const tasksCallsAfterVisible = getJson.mock.calls.filter(
      ([p]) => p === "/api/tasks",
    ).length;
    expect(tasksCallsAfterVisible).toBeGreaterThan(tasksCallsWhileHidden);
  });
});

describe("HomeView goal loop toggle", () => {
  beforeEach(() => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "project-1",
              name: "Project",
              rootPath: "/repo",
              favorite: false,
            },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ engineOk: true });
      if (path === "/api/git/branches") {
        return Promise.resolve({
          branches: ["main"],
          defaultTarget: "main",
          current: "main",
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({ taskId: "task-1", sessionId: "ses-1" });
    timedFetch.mockReset();
    timedFetch.mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the goal loop control as a compact toolbar pill, not a standalone card", async () => {
    render(<HomeView />);

    const toggle = await screen.findByRole("button", {
      name: "Goalループで継続実行",
    });
    // The pill lives in the scrolling control row next to the other selects.
    const controlRow = screen
      .getByLabelText("アクセスモード")
      .closest("div.overflow-x-auto");
    expect(controlRow?.contains(toggle)).toBe(true);
    expect(toggle.className).toContain("h-8");
    expect(toggle.className).toContain("shrink-0");
    // No checkbox card taking a full row while the loop is off.
    expect(
      screen.queryByRole("checkbox", { name: "Goalループで継続実行" }),
    ).toBeNull();
  });

  it("reveals goal loop settings only after the pill is turned on", async () => {
    render(<HomeView />);

    const toggle = await screen.findByRole("button", {
      name: "Goalループで継続実行",
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("承認条件")).toBeNull();
    expect(screen.queryByLabelText("最大ターン数")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("承認条件")).toBeTruthy();
    expect(screen.getByLabelText("最大ターン数")).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("承認条件")).toBeNull();
  });

  it("starts a goal loop with the entered acceptance and max turns", async () => {
    render(<HomeView />);

    const toggle = await screen.findByRole("button", {
      name: "Goalループで継続実行",
    });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("承認条件"), {
      target: { value: "テストが通る\n\nlint が通る" },
    });
    fireEvent.change(screen.getByLabelText("最大ターン数"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "バグを直す" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() =>
      expect(
        sendJson.mock.calls.some(([, p]) => p === "/api/tasks/task-1/goal-loop"),
      ).toBe(true),
    );
    const call = sendJson.mock.calls.find(
      ([, p]) => p === "/api/tasks/task-1/goal-loop",
    );
    expect(call?.[2]).toMatchObject({
      goal: "バグを直す",
      acceptance: ["テストが通る", "lint が通る"],
      maxTurns: 4,
    });
  });

  it("does not start a goal loop when the pill is off", async () => {
    render(<HomeView />);

    await screen.findByRole("button", { name: "Goalループで継続実行" });
    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "バグを直す" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(
      sendJson.mock.calls.some(([, p]) => String(p).endsWith("/goal-loop")),
    ).toBe(false);
  });
});

describe("HomeView auto model", () => {
  const decision = {
    providerID: "anthropic",
    modelID: "claude-haiku-4-5",
    variant: "minimal" as const,
    tier: "light" as const,
    reason: "短い質問タスクのため低コストモデルを選択しました",
    escalation: {
      providerID: "anthropic",
      modelID: "claude-opus-5",
      variant: "high" as const,
    },
  };

  /** Provider payload with one image-capable and one text-only model. */
  function providerPayload(imageCapable = true) {
    return {
      ok: true,
      json: async () => ({
        all: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-haiku-4-5": {
                name: "Haiku",
                variants: { minimal: {}, low: {}, high: {} },
                capabilities: { input: { image: imageCapable } },
              },
              "claude-opus-5": {
                name: "Opus",
                variants: { medium: {}, high: {} },
                capabilities: { input: { image: false } },
              },
            },
          },
        ],
        connected: ["anthropic"],
        default: { anthropic: "claude-opus-5" },
      }),
    };
  }

  function mockProvider(imageCapable = true, agents?: unknown) {
    timedFetch.mockImplementation((input: string) => {
      if (input.endsWith("/provider")) {
        return Promise.resolve(providerPayload(imageCapable));
      }
      if (input.endsWith("/agent") && agents) {
        return Promise.resolve({ ok: true, json: async () => agents });
      }
      return Promise.resolve({ ok: false });
    });
  }

  /** Open the model menu and pick the Auto entry. */
  async function selectAuto() {
    const trigger = await screen.findByLabelText("モデル");
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("option", { name: /Auto（コスト最適）/ }),
    );
    await waitFor(() =>
      expect((trigger as HTMLButtonElement).value).toBe("auto"),
    );
  }

  function taskBody() {
    const call = sendJson.mock.calls.find(([, path]) => path === "/api/tasks");
    return call?.[2] as Record<string, unknown> | undefined;
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            { id: "project-1", name: "Project", rootPath: "/repo", favorite: false },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ engineOk: true });
      if (path === "/api/git/branches") {
        return Promise.resolve({
          branches: ["main"],
          defaultTarget: "main",
          current: "main",
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      autoDecision: decision,
    });
    timedFetch.mockReset();
    timedFetch.mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("puts the Auto entry at the very top of the model menu", async () => {
    mockProvider();
    render(<HomeView />);

    const trigger = await screen.findByLabelText("モデル");
    await waitFor(() =>
      expect((trigger as HTMLButtonElement).value).toBe("anthropic::claude-opus-5"),
    );
    fireEvent.click(trigger);

    const options = await screen.findAllByRole("option");
    expect(options[0].textContent).toContain("Auto（コスト最適）");
    // Group headings are plain divs; the Auto group must precede the provider.
    const listbox = screen.getByRole("listbox", { name: "モデル" });
    const headings = Array.from(
      listbox.querySelectorAll("div.font-semibold"),
    ).map((node) => node.textContent);
    expect(headings[0]).toBe("Auto");
    expect(headings).toContain("Anthropic");
  });

  it("hides the intelligence selector while Auto is selected", async () => {
    mockProvider();
    render(<HomeView />);

    await waitFor(() =>
      expect(screen.getByLabelText("インテリジェンス")).toBeTruthy(),
    );
    await selectAuto();
    expect(screen.queryByLabelText("インテリジェンス")).toBeNull();
  });

  it("sends auto: true without model or variant", async () => {
    mockProvider();
    render(<HomeView />);
    await selectAuto();

    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "この関数は何が問題なの" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => expect(taskBody()).toBeDefined());
    const body = taskBody()!;
    expect(body.auto).toBe(true);
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("variant");
  });

  it("keeps sending the manual model when Auto is not selected", async () => {
    mockProvider();
    render(<HomeView />);
    await waitFor(() =>
      expect((screen.getByLabelText("モデル") as HTMLButtonElement).value).toBe(
        "anthropic::claude-opus-5",
      ),
    );

    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => expect(taskBody()).toBeDefined());
    const body = taskBody()!;
    expect(body).not.toHaveProperty("auto");
    expect(body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-5",
    });
  });

  it("allows an image submission under Auto when any model supports images", async () => {
    mockProvider(true);
    render(<HomeView />);
    await selectAuto();

    const input = screen.getByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: { files: [new File(["i"], "shot.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("img", { name: "shot.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => expect(taskBody()).toBeDefined());
    expect(taskBody()!.auto).toBe(true);
  });

  it("blocks an image submission under Auto when no model supports images", async () => {
    mockProvider(false);
    render(<HomeView />);
    await selectAuto();

    const input = screen.getByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: { files: [new File(["i"], "shot.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("img", { name: "shot.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "画像入力に対応していない",
    );
    expect(sendJson).not.toHaveBeenCalled();
  });

  it("stores 'auto' as last-used and hands the decision to the task view", async () => {
    mockProvider(true, [{ name: "build" }]);
    render(<HomeView />);
    await screen.findByLabelText("エージェント");
    await selectAuto();

    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "この関数は何が問題なの" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/task/task-1"));
    expect(localStorage.getItem("webui:last-used-model")).toBe("auto");
    const stored = JSON.parse(
      sessionStorage.getItem("webui:auto-task:task-1") ?? "null",
    );
    expect(stored).toEqual({
      decision,
      prompt: "この関数は何が問題なの",
      agent: "build",
    });
  });

  it("omits the retry prompt when an image is attached", async () => {
    mockProvider(true);
    render(<HomeView />);
    await selectAuto();

    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "これは何" },
    });
    const input = screen.getByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: { files: [new File(["i"], "shot.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("img", { name: "shot.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const stored = JSON.parse(
      sessionStorage.getItem("webui:auto-task:task-1") ?? "null",
    );
    expect(stored).toEqual({ decision });
  });

  it("stores nothing when the response carries no decision", async () => {
    sendJson.mockResolvedValue({ taskId: "task-1", sessionId: "ses-1" });
    mockProvider();
    render(<HomeView />);
    await selectAuto();

    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "これは何" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sessionStorage.getItem("webui:auto-task:task-1")).toBeNull();
  });

  it("restores Auto as the initial selection from last-used", async () => {
    localStorage.setItem("webui:last-used-model", "auto");
    mockProvider();
    render(<HomeView />);

    const trigger = await screen.findByLabelText("モデル");
    await waitFor(() =>
      expect((trigger as HTMLButtonElement).value).toBe("auto"),
    );
    expect(trigger.textContent).toContain("Auto（コスト最適）");
  });

  it("passes the resolved model and variant to the goal loop", async () => {
    mockProvider();
    render(<HomeView />);
    await selectAuto();

    fireEvent.click(
      await screen.findByRole("button", { name: "Goalループで継続実行" }),
    );
    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "この関数は何が問題なの" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() =>
      expect(
        sendJson.mock.calls.some(
          ([, path]) => path === "/api/tasks/task-1/goal-loop",
        ),
      ).toBe(true),
    );
    const loopBody = sendJson.mock.calls.find(
      ([, path]) => path === "/api/tasks/task-1/goal-loop",
    )?.[2] as Record<string, unknown>;
    expect(loopBody.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-haiku-4-5",
    });
    expect(loopBody.variant).toBe("minimal");
  });

  it("omits the goal loop model when Auto produced no decision", async () => {
    sendJson.mockResolvedValue({ taskId: "task-1", sessionId: "ses-1" });
    mockProvider();
    render(<HomeView />);
    await selectAuto();

    fireEvent.click(
      await screen.findByRole("button", { name: "Goalループで継続実行" }),
    );
    fireEvent.change(screen.getByLabelText("タスクの説明"), {
      target: { value: "これは何" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() =>
      expect(
        sendJson.mock.calls.some(
          ([, path]) => path === "/api/tasks/task-1/goal-loop",
        ),
      ).toBe(true),
    );
    const loopBody = sendJson.mock.calls.find(
      ([, path]) => path === "/api/tasks/task-1/goal-loop",
    )?.[2] as Record<string, unknown>;
    expect(loopBody).not.toHaveProperty("model");
    expect(loopBody).not.toHaveProperty("variant");
  });
});
