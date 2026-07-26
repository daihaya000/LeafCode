import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { TaskSummary } from "@/lib/types";
import { TaskView } from "./TaskView";

const {
  getJson,
  notifyTasksChanged,
  sendJson,
  useSessionStream,
  slashCommands,
  setExtras,
  setActiveScope,
  copyText,
  diffPaneRefreshKeys,
  sessionActionsCompact,
} = vi.hoisted(() => ({
  getJson: vi.fn(),
  notifyTasksChanged: vi.fn(),
  sendJson: vi.fn(),
  useSessionStream: vi.fn(),
  slashCommands: [] as { name: string }[],
  setExtras: vi.fn(),
  setActiveScope: vi.fn(),
  copyText: vi.fn(),
  diffPaneRefreshKeys: [] as number[],
  sessionActionsCompact: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  ocJson: vi.fn(),
  sendJson,
  timedFetch: (input: RequestInfo | URL) => fetch(input),
}));

vi.mock("@/lib/clipboard", () => ({ copyText }));

vi.mock("@/lib/events", () => ({ notifyTasksChanged }));

vi.mock("@/lib/currency", () => ({
  formatCost: (cost: number) => `cost $${cost.toFixed(4)}`,
  formatCostValue: (cost: number) => `$${cost.toFixed(4)}`,
  useCostDisplayPrefs: () => ({
    currency: "USD",
    rateMode: "manual",
    usdJpyRate: 150,
  }),
}));

vi.mock("@/lib/useSessionStream", () => ({ useSessionStream }));

vi.mock("@/lib/useSlashCommands", () => ({
  useSlashCommands: () => slashCommands,
}));

vi.mock("@/lib/default-model", () => ({
  DEFAULT_MODEL_EVENT: "webui:default-model",
  readDefaultModel: () => null,
  readDefaultModelFromServer: () => Promise.resolve(null),
  writeDefaultModel: vi.fn(),
  writeLastUsedModel: vi.fn(),
}));

vi.mock("@/components/shell/ShellContext", () => ({
  useShellExtras: () => ({ setExtras }),
  useShellSetActiveScope: () => setActiveScope,
  useShellMobileNav: () => ({
    mobileNavOpen: false,
    openMobileNav: vi.fn(),
    closeMobileNav: vi.fn(),
  }),
}));

vi.mock("@/components/AccessModeSelect", () => ({ AccessModeSelect: () => null }));
vi.mock("@/components/SubagentPermissionSelect", () => ({ SubagentPermissionSelect: () => null }));
vi.mock("@/components/IntelligenceSelect", () => ({ IntelligenceSelect: () => null }));
vi.mock("@/components/StatusBadge", () => ({ StatusBadge: () => null }));
vi.mock("./DiffPane", () => ({
  DiffPane: ({ refreshKey }: { refreshKey: number }) => {
    diffPaneRefreshKeys.push(refreshKey);
    return null;
  },
}));
vi.mock("./FileTreePanel", () => ({ FileTreePanel: () => null }));
vi.mock("./GraphPanel", () => ({ GraphPanel: () => null }));
vi.mock("./PartView", () => ({ PartView: () => null }));
vi.mock("./PermissionCard", () => ({ PermissionCard: () => null }));
vi.mock("./PtyPanel", () => ({ PtyPanel: () => <div data-testid="pty-panel" /> }));
vi.mock("./QuestionCard", () => ({ QuestionCard: () => null }));
vi.mock("./SessionActions", () => ({
  CompactButton: () => <button type="button" aria-label="コンパクト">コンパクト</button>,
  MessageRevertButton: () => null,
  useSessionActions: () => ({
    busy: null,
    error: null,
    compact: sessionActionsCompact,
    revert: () => {},
    unrevert: () => {},
  }),
}));
vi.mock("./SessionSwitcher", () => ({
  SessionSwitcher: ({ onSwitch }: { onSwitch: () => void }) => (
    <div data-testid="session-switcher">
      <select aria-label="セッション切替"><option value="sess1">Session 1</option></select>
      <button type="button" aria-label="新セッション" onClick={onSwitch}>追加</button>
    </div>
  ),
}));

let taskStatus: TaskSummary["status"];
let taskResponseCosts: number[];
let taskSessionId: string;

function task(cost: number): TaskSummary {
  return {
    id: "ws1",
    projectId: "prj1",
    projectName: "Repo",
    title: "Task title",
    directory: "/repo",
    isolation: "current_folder",
    status: taskStatus,
    sessionId: taskSessionId,
    branch: "main",
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    cost,
    createdAt: "2026-07-18T00:00:00Z",
    updatedAt: "2026-07-18T00:00:00Z",
  };
}

function setVisible(visible: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
}

async function flushTaskLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("TaskView", () => {
  beforeEach(() => {
    taskStatus = "working";
    taskResponseCosts = [0.1, 0.2];
    taskSessionId = "sess1";
    diffPaneRefreshKeys.length = 0;
    copyText.mockResolvedValue(true);
    slashCommands.length = 0;
    setVisible(true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    useSessionStream.mockReturnValue({
      messages: [],
      visibleMessages: [],
      status: { type: "busy" },
      permissions: [],
      questions: [],
      todos: [],
      revert: null,
      connection: "live",
      sessionError: null,
      loaded: true,
      abort: vi.fn(),
      refreshTodos: vi.fn(),
      rejectQuestion: vi.fn(),
      replyPermission: vi.fn(),
      replyQuestion: vi.fn(),
      resync: vi.fn(),
      sendPrompt: vi.fn(),
      sendCommand: vi.fn(),
    });
    getJson.mockImplementation((path: string) => {
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      return Promise.resolve({ task: task(taskResponseCosts.shift() ?? 0.2) });
    });
    sendJson.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps a single mobile menu button while the task is loading", () => {
    render(<TaskView taskId="ws1" />);

    const menus = screen.getAllByLabelText("メニュー");
    expect(menus).toHaveLength(1);
    expect(menus[0].getAttribute("aria-controls")).toBe("mobile-nav");
    expect(menus[0].getAttribute("aria-expanded")).toBe("false");
    expect(menus[0].className).toContain("h-11");
    expect(menus[0].className).toContain("w-11");
  });

  it("keeps a mobile menu button when loading the task fails", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      return Promise.reject(new Error("task unavailable"));
    });
    render(<TaskView taskId="ws1" />);

    await screen.findByText("task unavailable");
    const menus = screen.getAllByLabelText("メニュー");
    expect(menus).toHaveLength(1);
    expect(menus[0].getAttribute("aria-controls")).toBe("mobile-nav");
    expect(menus[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("renders a single mobile menu button in the conversation header", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const menus = screen.getAllByLabelText("メニュー");
    expect(menus).toHaveLength(1);
    const [menu] = menus;
    expect(menu.getAttribute("aria-controls")).toBe("mobile-nav");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps unsent composer drafts per switched session", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });

    const view = render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const textarea = screen.getByRole("combobox", {
      name: "フォローアップを送信",
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "draft for session 1" } });
    expect(textarea.value).toBe("draft for session 1");

    taskSessionId = "sess2";
    view.rerender(<TaskView taskId="ws2" />);
    await flushTaskLoad();
    expect(textarea.value).toBe("");

    fireEvent.change(textarea, { target: { value: "draft for session 2" } });
    expect(textarea.value).toBe("draft for session 2");

    taskSessionId = "sess1";
    view.rerender(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    expect(textarea.value).toBe("draft for session 1");
  });

  it("keeps a newly created todo plan collapsed while working on mobile", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      todos: [{ id: "todo-1", content: "実装する", status: "in_progress" }],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.getByRole("button", { name: /プラン 0\/1/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByText("実装する")).toBeNull();
  });

  it("calls compact from the mobile kebab menu", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    fireEvent.click(screen.getByLabelText("メニューを開く"));
    const menu = screen.getByRole("menu", { name: "タスクその他操作" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "コンテキスト圧縮" }));

    expect(sessionActionsCompact).toHaveBeenCalledTimes(1);
  });

  it("refreshes the header cost while the current task is working", async () => {
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("累計 $0.2000")).toBeTruthy();
    // 3 calls: 1 initial sidepanel-width (DB migration) + 1 task load + 1 poll.
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("does not poll when the current task is idle", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    // 2 calls: 1 sidepanel-width (DB migration) + 1 task load. No polls.
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("auto-rejects task permission when subagent is denied, leaving others manual", async () => {
    localStorage.setItem("webui:subagent-permission", "deny");
    try {
      const replyPermission = vi.fn().mockResolvedValue(undefined);
      useSessionStream.mockReturnValue({
        ...useSessionStream(),
        permissions: [
          {
            id: "perm-task",
            version: "v2",
            sessionID: "sess1",
            permission: "task",
            patterns: [],
            receivedAt: 1,
          },
          {
            id: "perm-edit",
            version: "v2",
            sessionID: "sess1",
            permission: "edit",
            patterns: [],
            receivedAt: 2,
          },
        ],
        replyPermission,
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // task permission is auto-rejected (deny takes priority over full access)
      expect(replyPermission).toHaveBeenCalledWith(
        expect.objectContaining({ id: "perm-task", permission: "task" }),
        "reject",
      );
      // other permissions are untouched by the subagent setting (no auto reply)
      const calls = replyPermission.mock.calls;
      expect(calls.every((c) => c[0]?.id === "perm-task")).toBe(true);
      expect(calls.every((c) => c[1] === "reject")).toBe(true);
    } finally {
      localStorage.removeItem("webui:subagent-permission");
    }
  });

  it("polls when the current task is idle but the session is busy", async () => {
    taskStatus = "idle";
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // 3 calls: 1 sidepanel-width (DB migration) + 1 task load + 1 poll.
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("polls while the current session is retrying", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "retry" },
    });
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // 3 calls: 1 sidepanel-width (DB migration) + 1 task load + 1 poll.
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("notifies task changes when the stream status type changes", async () => {
    taskStatus = "idle";
    vi.useFakeTimers();
    const view = render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(notifyTasksChanged).toHaveBeenCalledTimes(1);

    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "retry" },
    });
    await act(async () => {
      view.rerender(<TaskView taskId="ws1" />);
    });
    expect(notifyTasksChanged).toHaveBeenCalledTimes(2);

    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    await act(async () => {
      view.rerender(<TaskView taskId="ws1" />);
    });

    expect(notifyTasksChanged).toHaveBeenCalledTimes(3);
  });

  it("refreshes immediately when a working task becomes visible", async () => {
    setVisible(false);
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();
    setVisible(true);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(screen.getByText("累計 $0.2000")).toBeTruthy();
    // 3 calls: 1 sidepanel-width (DB migration) + 1 task load + 1 visibility refresh.
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("keeps the current header cost when a working-task refresh fails", async () => {
    let taskCalls = 0;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      taskCalls += 1;
      // Initial load succeeds; the first poll refresh fails.
      if (taskCalls === 1) return Promise.resolve({ task: task(0.1) });
      return Promise.reject(new Error("offline"));
    });
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("累計 $0.1000")).toBeTruthy();
    expect(screen.queryByText("offline")).toBeNull();
  });

  it.each([
    ["a normal prompt", "hello", "sendPrompt"],
    ["a slash command", "/review args", "sendCommand"],
  ])("touches activity before %s and notifies afterward", async (_label, text, method) => {
    taskStatus = "idle";
    if (method === "sendCommand") slashCommands.push({ name: "review" });
    const events: string[] = [];
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    streamMock.sendPrompt.mockImplementation(async () => {
      events.push("send");
    });
    streamMock.sendCommand.mockImplementation(async () => {
      events.push("send");
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    notifyTasksChanged.mockClear();
    const activity = deferred<void>();
    sendJson.mockImplementation(() =>
      activity.promise.then(() => {
        events.push("activity");
      }),
    );
    events.length = 0;

    fireEvent.change(screen.getByRole("combobox", { name: "フォローアップを送信" }), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(streamMock[method]).not.toHaveBeenCalled();

    activity.resolve(undefined);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendJson).toHaveBeenCalledWith("POST", "/api/tasks/ws1/activity", {
      sessionId: "sess1",
    });
    expect(events).toEqual(["activity", "send"]);
    expect(streamMock[method]).toHaveBeenCalledTimes(1);
    if (method === "sendCommand") {
      expect(streamMock.sendCommand).toHaveBeenCalledWith(
        "review",
        "args",
        expect.any(Object),
      );
      expect(streamMock.sendPrompt).not.toHaveBeenCalled();
    } else {
      expect(streamMock.sendPrompt).toHaveBeenCalledWith(
        "hello",
        expect.any(Object),
      );
      expect(streamMock.sendCommand).not.toHaveBeenCalled();
    }
    expect(notifyTasksChanged).toHaveBeenCalledTimes(1);
  });

  it("continues sending when the activity request fails", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    const sendPrompt = streamMock.sendPrompt;
    // Only the activity-touch call fails; the sidepanel-width DB write must
    // still succeed so it doesn't emit a noisy warning unrelated to this test.
    sendJson.mockImplementation((method: string, url: string) => {
      if (url === "/api/settings/sidepanel-width") return Promise.resolve(undefined);
      return Promise.reject(new Error("activity unavailable"));
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    notifyTasksChanged.mockClear();

    fireEvent.change(screen.getByRole("combobox", { name: "フォローアップを送信" }), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendPrompt).toHaveBeenCalledWith("hello", expect.any(Object));
    expect(notifyTasksChanged).toHaveBeenCalledTimes(1);
  });

  it("does not block sending for more than 5 seconds when activity hangs", async () => {
    taskStatus = "idle";
    vi.useFakeTimers();
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    sendJson.mockReturnValue(new Promise<void>(() => {}));
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    fireEvent.change(screen.getByRole("combobox", { name: "フォローアップを送信" }), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(streamMock.sendPrompt).toHaveBeenCalledWith("hello", expect.any(Object));
  });

  it("blocks image submission to an unknown model in TaskView (capability undefined)", async () => {
    taskStatus = "idle";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/opencode/provider")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              all: [
                {
                  id: "openai",
                  name: "OpenAI",
                  models: {
                    "known-text": {
                      name: "Known Text",
                      capabilities: { input: { image: false }, attachment: false },
                    },
                  },
                },
              ],
              connected: ["openai"],
              default: { openai: "known-text" },
            }),
          });
        }
        return Promise.resolve({ ok: false });
      }),
    );
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    useSessionStream.mockReturnValue({
      ...streamMock,
      visibleMessages: [],
    });

    const view = render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    sendJson.mockClear();

    const modelSelect = await screen.findByLabelText("モデル");
    fireEvent.change(modelSelect, {
      target: { value: "openai::unknown-vision" },
    });

    const image = new File(["img"], "unknown-task.png", { type: "image/png" });
    const input = view.container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { files: [image] } });
    expect(await screen.findByRole("img", { name: "unknown-task.png" })).toBeTruthy();

    const submit = screen.getByRole("button", { name: "送信" });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(sendJson).not.toHaveBeenCalled();
      expect(streamMock.sendPrompt).not.toHaveBeenCalled();
    });
  });

  it("sends an image follow-up to a model with explicit image capability", async () => {
    taskStatus = "idle";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes("/api/opencode/provider")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              all: [{
                id: "openai",
                name: "OpenAI",
                models: {
                  vision: {
                    name: "Vision",
                    capabilities: { input: { image: true }, attachment: false },
                  },
                },
              }],
              connected: ["openai"],
              default: { openai: "vision" },
            }),
          });
        }
        return Promise.resolve({ ok: false });
      }),
    );
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    const view = render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const image = new File(["img"], "vision-task.png", { type: "image/png" });
    const input = view.container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { files: [image] } });
    expect(await screen.findByRole("img", { name: "vision-task.png" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "フォローアップを送信" }), {
      target: { value: "describe this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => {
      expect(streamMock.sendPrompt).toHaveBeenCalledWith(
        "describe this",
        expect.objectContaining({
          model: { providerID: "openai", modelID: "vision" },
          files: [expect.objectContaining({ mime: "image/png", name: "vision-task.png" })],
        }),
      );
    });
  });

  it("touches activity before approving a plan", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    const sendPrompt = streamMock.sendPrompt;
    const events: string[] = [];
    sendPrompt.mockImplementation(async () => events.push("send"));
    useSessionStream.mockReturnValue({
      ...streamMock,
      status: { type: "idle" },
      visibleMessages: [{
        info: {
          id: "plan-1",
          role: "assistant",
          agent: "plan",
          time: { completed: 1 },
        },
        parts: [{ id: "plan-text", type: "text", text: "/repo/plan.md" }],
      }],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    notifyTasksChanged.mockClear();
    const activity = deferred<void>();
    sendJson.mockImplementation(() =>
      activity.promise.then(() => {
        events.push("activity");
      }),
    );
    events.length = 0;

    const planCard = await screen.findByRole("region", { name: "計画書: plan.md" });
    fireEvent.click(within(planCard).getByRole("button", { name: "承認して実装" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(sendPrompt).not.toHaveBeenCalled();

    activity.resolve(undefined);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(events).toEqual(["activity", "send"]);
    expect(sendPrompt).toHaveBeenCalledWith(
      expect.stringContaining("この計画を承認します"),
      { agent: "build" },
    );
    expect(notifyTasksChanged).toHaveBeenCalledTimes(1);
  });

  it("shows the plan card expanded with its document on desktop", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({
      ...streamMock,
      visibleMessages: [{
        info: {
          id: "plan-1",
          role: "assistant",
          agent: "plan",
          time: { completed: 1 },
        },
        parts: [{ id: "plan-text", type: "text", text: "/repo/plan.md" }],
      }],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const card = await screen.findByRole("region", { name: "計画書: plan.md" });
    expect(
      within(card).getByRole("button", { name: "plan.md" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(within(card).getByText("計画本文")).toBeTruthy();
  });

  it("stops polling after idle even when the completion refresh fails", async () => {
    let taskCalls = 0;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      taskCalls += 1;
      if (taskCalls === 1) return Promise.resolve({ task: task(0.1) });
      return Promise.reject(new Error("offline"));
    });
    vi.useFakeTimers();
    const view = render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    await act(async () => {
      view.rerender(<TaskView taskId="ws1" />);
      await Promise.resolve();
    });

    // Initial load + one failed poll refresh while working.
    expect(taskCalls).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(taskCalls).toBe(2);
  });

  it("ignores an older task refresh after a newer refresh completes", async () => {
    let resolveInitial: ((value: { task: TaskSummary }) => void) | undefined;
    let taskCalls = 0;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      taskCalls += 1;
      // Initial load stays pending; the first poll refresh resolves with 0.2.
      if (taskCalls === 1) {
        return new Promise<{ task: TaskSummary }>((resolve) => {
          resolveInitial = resolve;
        });
      }
      return Promise.resolve({ task: task(0.2) });
    });
    const view = render(<TaskView taskId="ws1" />);

    await act(async () => {
      await Promise.resolve();
    });
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    view.rerender(<TaskView taskId="ws1" />);

    expect(await screen.findByText("累計 $0.2000")).toBeTruthy();
    await act(async () => {
      resolveInitial?.({ task: task(0.1) });
      await Promise.resolve();
    });

    expect(screen.getByText("累計 $0.2000")).toBeTruthy();
  });

  it("consolidates assistant model and turn cost into the response header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/opencode/provider")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              all: [{
                id: "openai",
                name: "OpenAI",
                models: { "gpt-5.6-sol": { name: "GPT-5.6 Sol" } },
              }],
              connected: ["openai"],
              default: { openai: "gpt-5.6-sol" },
            }),
          });
        }
        return Promise.resolve({ ok: false });
      }),
    );
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      messages: [{
        info: {
          id: "assistant-1",
          role: "assistant",
          agent: "build",
          providerID: "openai",
          modelID: "gpt-5.6-sol",
          cost: 0.25,
          time: { created: 1 },
        },
        parts: [{ id: "text-1", type: "text", text: "回答" }],
      }],
      visibleMessages: [{
        info: {
          id: "assistant-1",
          role: "assistant",
          agent: "build",
          providerID: "openai",
          modelID: "gpt-5.6-sol",
          cost: 0.25,
          time: { created: 1 },
        },
        parts: [{ id: "text-1", type: "text", text: "回答" }],
      }],
    });

    render(<TaskView taskId="ws1" />);
    // Scope to the response header (aria-label from Task 1's MessageMetaHeader):
    // the model label also legitimately renders in the composer's model selector.
    const header = await screen.findByLabelText("応答メタデータ");
    await within(header).findByText("GPT-5.6 Sol");
    expect(within(header).getByText("cost $0.2500")).toBeTruthy();
    expect(screen.queryByText("build")).toBeNull();
    expect(screen.getAllByText("cost $0.2500")).toHaveLength(1);
  });

  it("moves copy, resync, session switching, and terminal into the kebab menu", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByTitle("作業パスをコピー")).toBeNull();
    expect(screen.queryByTitle("再同期")).toBeNull();
    expect(screen.queryByTitle("ターミナル")).toBeNull();
    expect(screen.queryByTestId("session-switcher")).toBeNull();
    expect(screen.getByRole("button", { name: "コンパクト" })).toBeTruthy();
    expect(screen.getByTitle("ファイルツリー")).toBeTruthy();
    expect(screen.getByTitle("グラフ")).toBeTruthy();
    expect(screen.getByTitle("Diff パネル")).toBeTruthy();

    const trigger = screen.getByRole("button", { name: "メニューを開く" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "タスクその他操作" });
    expect(within(menu).getByRole("menuitem", { name: "作業パスをコピー" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "再同期" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "セッションを切り替え・追加" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "ターミナル" })).toBeTruthy();
    expect(within(menu).queryByRole("combobox")).toBeNull();
    expect(within(menu).queryByRole("button")).toBeNull();
    expect(within(menu).queryByRole("dialog")).toBeNull();

    getJson.mockClear();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "セッションを切り替え・追加" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "セッションを切り替え・追加" });
    const select = within(dialog).getByRole("combobox", { name: "セッション切替" });
    const create = within(dialog).getByRole("button", { name: "新セッション" });
    await waitFor(() => expect(document.activeElement).toBe(select));
    create.focus();
    const tab = createEvent.keyDown(create, { key: "Tab" });
    fireEvent(create, tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(select);
    const shiftTab = createEvent.keyDown(select, { key: "Tab", shiftKey: true });
    fireEvent(select, shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(create);

    fireEvent.click(create);
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/tasks/ws1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    const resync = screen.getByRole("menuitem", { name: "再同期" });
    fireEvent.click(resync);
    expect(streamMock.resync).toHaveBeenCalledTimes(1);
    expect(diffPaneRefreshKeys).toContain(1);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "ターミナル" }));
    expect(screen.getByTestId("pty-panel")).toBeTruthy();
  });

  it("closes the session dialog with Escape or a backdrop click and restores trigger focus", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    const trigger = screen.getByRole("button", { name: "メニューを開く" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "セッションを切り替え・追加" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "セッションを切り替え・追加" }));
    fireEvent.click(screen.getByRole("presentation"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not offer session switching without a task session", async () => {
    taskStatus = "idle";
    getJson.mockResolvedValue({ task: { ...task(0.1), sessionId: null } });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    expect(
      screen.queryByRole("menuitem", { name: "セッションを切り替え・追加" }),
    ).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables resync while the stream is working", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({ ...streamMock, status: { type: "busy" } });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    const resync = screen.getByRole("menuitem", { name: "再同期" });
    expect(resync.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(resync);
    expect(streamMock.resync).not.toHaveBeenCalled();
  });

  it("shows the copied check icon from the kebab for 1.5 seconds", async () => {
    taskStatus = "idle";
    vi.useFakeTimers();
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "作業パスをコピー" }));
    await act(async () => { await Promise.resolve(); });
    expect(copyText).toHaveBeenCalledWith("/repo");

    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    const copiedItem = screen.getByRole("menuitem", { name: "作業パスをコピー" });
    expect(copiedItem.querySelector("svg.lucide-check")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByRole("menuitem", { name: "作業パスをコピー" }).querySelector("svg.lucide-copy")).toBeTruthy();
  });

  it("keeps stop and CompactButton in the header while moving the session switcher", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.getAllByRole("button", { name: "停止" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "コンパクト" })).toBeTruthy();
    expect(screen.queryByTestId("session-switcher")).toBeNull();
  });

  it("moves compact into the kebab and removes the stop button on mobile", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const header = document.querySelector("header");
    expect(header).toBeTruthy();
    expect(within(header as HTMLElement).queryByRole("button", { name: "停止" })).toBeNull();
    expect(within(header as HTMLElement).queryByRole("button", { name: "コンパクト" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    const menu = screen.getByRole("menu", { name: "タスクその他操作" });
    expect(within(menu).getByRole("menuitem", { name: "コンテキスト圧縮" })).toBeTruthy();
  });

  it("exposes stop in the kebab when working on mobile", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    taskStatus = "working";
    useSessionStream.mockReturnValue({
      messages: [],
      visibleMessages: [],
      status: { type: "busy" },
      permissions: [],
      questions: [],
      todos: [],
      revert: null,
      connection: "live",
      sessionError: null,
      loaded: true,
      abort: vi.fn(),
      refreshTodos: vi.fn(),
      rejectQuestion: vi.fn(),
      replyPermission: vi.fn(),
      replyQuestion: vi.fn(),
      resync: vi.fn(),
      sendPrompt: vi.fn(),
      sendCommand: vi.fn(),
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const header = document.querySelector("header");
    expect(header).toBeTruthy();
    expect(within(header as HTMLElement).queryByRole("button", { name: "停止" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    const menu = screen.getByRole("menu", { name: "タスクその他操作" });
    expect(within(menu).getAllByRole("menuitem", { name: "停止" }).length).toBe(1);
  });

  it("keeps files, graph, and diff in the kebab below lg while terminal stays there", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    taskStatus = "idle";
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByTitle("ファイルツリー")).toBeNull();
    expect(screen.queryByTitle("グラフ")).toBeNull();
    expect(screen.queryByTitle("Diff パネル")).toBeNull();
    expect(screen.queryByTitle("ターミナル")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    const menu = screen.getByRole("menu", { name: "タスクその他操作" });
    expect(within(menu).getByRole("menuitem", { name: "ファイルツリー" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "グラフ" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Diff パネル" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "ターミナル" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "ターミナル" }));
    expect(screen.getByTestId("pty-panel")).toBeTruthy();
  });
});

describe("TaskView voice input", () => {
  let mockRecognition: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    _dispatch: (type: string, ...args: unknown[]) => void;
  };

  beforeEach(() => {
    taskStatus = "idle";
    taskResponseCosts = [0.1];
    slashCommands.length = 0;
    setVisible(true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    useSessionStream.mockReturnValue({
      messages: [],
      visibleMessages: [],
      status: { type: "idle" },
      permissions: [],
      questions: [],
      todos: [],
      revert: null,
      connection: "live",
      sessionError: null,
      loaded: true,
      abort: vi.fn(),
      refreshTodos: vi.fn(),
      rejectQuestion: vi.fn(),
      replyPermission: vi.fn(),
      replyQuestion: vi.fn(),
      resync: vi.fn(),
      sendPrompt: vi.fn(),
      sendCommand: vi.fn(),
    });
    getJson.mockResolvedValue({ task: task(0.1) });
    sendJson.mockResolvedValue(undefined);

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
    function MockCtor() {
      return mockRecognition;
    }
    vi.stubGlobal("webkitSpeechRecognition", MockCtor);
    vi.stubGlobal("SpeechRecognition", undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the mic button when SpeechRecognition is supported", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    expect(await screen.findByRole("button", { name: "音声入力" })).toBeTruthy();
  });

  it("appends transcript to the input on stop", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    const micBtn = await screen.findByRole("button", { name: "音声入力" });

    // Start listening
    fireEvent.click(micBtn);
    act(() => mockRecognition._dispatch("start"));

    // Simulate final result
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "follow up text" }, isFinal: true }],
      }),
    );

    // Stop listening. stop() resolves on `end`.
    fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));
    await act(async () => {
      mockRecognition._dispatch("end");
      await Promise.resolve();
    });

    const textarea = screen.getByRole("combobox", {
      name: "フォローアップを送信",
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("follow up text");
  });

  it("disables the mic button while composer is locked", async () => {
    taskStatus = "working";
    useSessionStream.mockReturnValue({
      messages: [],
      visibleMessages: [],
      status: { type: "busy" },
      permissions: [],
      questions: [],
      todos: [],
      revert: null,
      connection: "live",
      sessionError: null,
      loaded: true,
      abort: vi.fn(),
      refreshTodos: vi.fn(),
      rejectQuestion: vi.fn(),
      replyPermission: vi.fn(),
      replyQuestion: vi.fn(),
      resync: vi.fn(),
      sendPrompt: vi.fn(),
      sendCommand: vi.fn(),
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const micBtn = await screen.findByRole("button", { name: "音声入力" });
    expect((micBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not change existing input when transcript is empty", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    // Set an existing input value first
    const textarea = screen.getByRole("combobox", {
      name: "フォローアップを送信",
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "existing text" } });
    expect(textarea.value).toBe("existing text");

    const micBtn = await screen.findByRole("button", { name: "音声入力" });
    fireEvent.click(micBtn);
    act(() => mockRecognition._dispatch("start"));

    // Simulate an empty transcript (regression: guard `if (!text) return;`)
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "" }, isFinal: true }],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));
    await act(async () => {
      mockRecognition._dispatch("end");
      await Promise.resolve();
    });

    expect(textarea.value).toBe("existing text");
  });

  it("disables the mic button when no session is created yet (Important 5)", async () => {
    // Task has no sessionId yet — composer controls are disabled, so the mic
    // button must be disabled too even though the task itself is idle.
    getJson.mockImplementation(() =>
      Promise.resolve({ task: { ...task(0.1), sessionId: null } }),
    );
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const micBtn = await screen.findByRole("button", { name: "音声入力" });
    expect((micBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows NextAction when idle, loaded, with messages and no attention", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
      visibleMessages: [
        {
          info: { id: "m1", role: "user" },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "hello" }],
        },
      ],
      loaded: true,
      permissions: [],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.getByLabelText("次の指示を提案")).toBeTruthy();
  });

  it("does not show NextAction when working", async () => {
    taskStatus = "working";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "busy" },
      visibleMessages: [
        {
          info: { id: "m1", role: "user" },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "hello" }],
        },
      ],
      loaded: true,
      permissions: [],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByLabelText("次の指示を提案")).toBeNull();
  });

  it("does not show NextAction when no messages", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
      visibleMessages: [],
      loaded: true,
      permissions: [],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByLabelText("次の指示を提案")).toBeNull();
  });

  it("does not show NextAction when attention is pending", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
      visibleMessages: [
        {
          info: { id: "m1", role: "user" },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "hello" }],
        },
      ],
      loaded: true,
      permissions: [
        {
          id: "perm-1",
          version: "v1",
          sessionID: "sess1",
          permission: "bash",
          patterns: [],
          receivedAt: Date.now(),
        },
      ],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByLabelText("次の指示を提案")).toBeNull();
  });
});
