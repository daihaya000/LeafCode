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
  readDefaultModel: () => "",
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

  it("keeps the composer toolbar as two fixed rows (place + settings)", async () => {
    render(<HomeView />);

    const form = await screen.findByRole("form", { name: "タスク作成" });
    const toolbar = form.querySelector(":scope > div.px-3.pb-3");
    expect(toolbar).not.toBeNull();
    expect(toolbar?.className).toMatch(/\bflex\b/);
    expect(toolbar?.className).toMatch(/\bflex-col\b/);
    expect(toolbar?.className).not.toMatch(/\bgrid\b/);
    expect(toolbar?.className).not.toContain("xl:grid-cols-");
    expect(toolbar?.className).not.toMatch(/\bflex-wrap\b/);

    const rows = toolbar?.querySelectorAll(":scope > div");
    expect(rows?.length).toBe(2);

    const row1 = rows![0];
    const row2 = rows![1];
    expect(row1.className).toMatch(/\bflex\b/);
    expect(row1.className).toMatch(/justify-between/);
    expect(row2.className).toMatch(/\bflex\b/);

    // 1 段目: プロジェクト・作業場所・送信
    expect(row1.contains(screen.getByLabelText("プロジェクト"))).toBe(true);
    expect(row1.contains(screen.getByLabelText("作業場所"))).toBe(true);
    expect(row1.contains(screen.getByRole("button", { name: "タスク開始" }))).toBe(
      true,
    );

    // 2 段目: アクセスモード（モデル/知性/エージェントはモック次第で非表示可）
    expect(row2.contains(screen.getByLabelText("アクセスモード"))).toBe(true);

    const accessWrap = screen.getByLabelText("アクセスモード").closest("span");
    expect(accessWrap?.className).not.toContain("order-first");
    expect(accessWrap?.className).not.toContain("xl:order-none");
    expect(accessWrap?.className).not.toMatch(/max-w-\[/);
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

  it("persists 不許可 locally without a config write (applied at task creation)", async () => {
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
    )) as HTMLSelectElement;
    expect(select.value).toBe("allow");

    fireEvent.change(select, { target: { value: "deny" } });

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
});
