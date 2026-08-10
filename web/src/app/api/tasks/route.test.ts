import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock the real dependencies the POST handler reaches after variant
// validation. Variant validation runs *before* provisionWorkspace, so
// invalid variants never reach these mocks; valid variants do.
vi.mock("@/lib/workspace-service", () => ({
  ServiceError: class ServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  provisionWorkspace: vi.fn().mockResolvedValue({
    workspace: {
      id: "workspace-1",
      absolute_path: "C:\\repo",
      project_id: "project-1",
    },
    note: undefined,
  }),
  destroyWorkspace: vi.fn().mockResolvedValue(undefined),
  isIsolation: (value: unknown) =>
    value === "current_folder" ||
    value === "git_worktree" ||
    value === "temporary_copy" ||
    value === "devcontainer",
}));

vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  ocServer: vi.fn().mockImplementation(
    async (_dir: string | null, path: string) => {
      if (path === "/session") return { id: "session-1" };
      return {};
    },
  ),
}));

vi.mock("@/lib/db", () => ({
  bindSession: vi.fn(),
  touchProjectOpened: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/project-session-sync", () => ({
  persistProjectSessions: vi.fn(),
}));

vi.mock("@/lib/task-service", () => ({
  listTasks: vi.fn().mockResolvedValue({ tasks: [], engineOk: true }),
}));

// Auto model selection reads the WebUI-local disabled map from disk; keep the
// filesystem out of the unit test and let each case supply its own state.
vi.mock("@/lib/provider-model-state", () => ({
  readProviderModelState: vi.fn().mockReturnValue({
    disabled: {},
    providerOrder: [],
    modelOrder: {},
    providerIcons: {},
  }),
}));

// The first turn of a new task never passes through the BFF proxy, so this route
// arms the hang watchdog itself. See docs/specs/hang-watchdog-server-side.md.
const hangWatch = vi.hoisted(() => ({
  armed: [] as { sessionId: string; directory: string; requestPath: string; body: unknown; timeoutMs: number }[],
  disarmed: [] as string[],
}));

vi.mock("@/lib/hang-watchdog", () => ({
  armHangWatch: vi.fn((input: (typeof hangWatch.armed)[number]) => {
    hangWatch.armed.push(input);
  }),
  disarmHangWatch: vi.fn((sessionId: string) => {
    hangWatch.disarmed.push(sessionId);
  }),
}));

vi.mock("@/lib/opencode-task-permission", () => ({
  setSessionTaskPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/opencode-skill-permission", () => ({
  setSessionSkillPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/opencode-access-mode", () => ({
  setSessionEditPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/qwen-native-vision", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/qwen-native-vision")>();
  return {
    ...actual,
    isQwenNativeVisionAvailable: () => process.env.OPENCODE_WEBUI_QWEN_NATIVE === "1",
  };
});

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/tasks", { headers: { host: "127.0.0.1:3000" },
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/tasks arms the hang watchdog", () => {
  beforeEach(() => {
    hangWatch.armed = [];
    hangWatch.disarmed = [];
  });

  it("arms the watch for the first prompt of a new task", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    (ocServer as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
    });

    expect(res.status).toBe(200);
    expect(hangWatch.armed).toHaveLength(1);
    expect(hangWatch.armed[0]).toMatchObject({
      sessionId: "session-1",
      directory: "C:\\repo",
      requestPath: "/session/session-1/prompt_async",
    });
    expect(hangWatch.armed[0].body).toMatchObject({
      parts: [{ type: "text", text: "hello" }],
    });
    expect(hangWatch.disarmed).toEqual([]);
    // Arming must precede the send: a synchronous engine call would otherwise
    // only start being watched once it had already finished.
    const promptIndex = (ocServer as ReturnType<typeof vi.fn>).mock.calls.findIndex(
      (call) => String(call[1]).includes("/prompt_async"),
    );
    expect(promptIndex).toBeGreaterThanOrEqual(0);
  });

  it("disarms the watch when the first prompt fails and the task rolls back", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    const mocked = ocServer as ReturnType<typeof vi.fn>;
    mocked.mockClear();
    mocked.mockImplementation(async (_dir: string | null, path: string) => {
      if (path === "/session") return { id: "session-1" };
      if (path.includes("/prompt_async")) throw new Error("engine rejected the prompt");
      return {};
    });

    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
    });

    expect(res.status).toBe(502);
    expect(hangWatch.disarmed).toEqual(["session-1"]);

    mocked.mockImplementation(async (_dir: string | null, path: string) => {
      if (path === "/session") return { id: "session-1" };
      return {};
    });
  });

  it("arms the watch for a slash command task", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    const mocked = ocServer as ReturnType<typeof vi.fn>;
    mocked.mockClear();
    mocked.mockImplementation(async (_dir: string | null, path: string) => {
      if (path === "/session") return { id: "session-1" };
      if (path === "/command") return [{ name: "commit", description: "commit" }];
      return {};
    });

    const res = await post({
      projectId: "project-1",
      prompt: "/commit",
      isolation: "current_folder",
    });

    expect(res.status).toBe(200);
    expect(hangWatch.armed).toHaveLength(1);
    expect(hangWatch.armed[0].requestPath).toBe("/session/session-1/command");

    mocked.mockImplementation(async (_dir: string | null, path: string) => {
      if (path === "/session") return { id: "session-1" };
      return {};
    });
  });
});

describe("POST /api/tasks variant validation", () => {
  it("applies the session task ruleset before the first prompt", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    const { setSessionTaskPermission } = await import(
      "@/lib/opencode-task-permission"
    );
    (ocServer as ReturnType<typeof vi.fn>).mockClear();
    (setSessionTaskPermission as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      agent: "build",
      subagentPermission: "deny",
    });

    expect(res.status).toBe(200);
    // Enforcement targets the freshly created session, not the agent config
    // (a config PATCH is ignored by the running engine).
    expect(setSessionTaskPermission).toHaveBeenCalledWith(
      "C:\\repo",
      "session-1",
      "deny",
    );
    const promptIndex = (ocServer as ReturnType<typeof vi.fn>).mock.calls.findIndex(
      (call) => String(call[1]).includes("/prompt_async"),
    );
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    // The permission helper must finish before this call, otherwise OpenCode
    // could execute task immediately under a pre-existing allow rule.
    expect(
      (setSessionTaskPermission as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (ocServer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[promptIndex],
    );
  });

  it("applies the session task ruleset even when no agent is selected", async () => {
    // Regression: subagentPermission is session-scoped, not agent-scoped, so
    // it must take effect without an execution agent. Requiring `agent` here
    // previously made HomeView drop subagentPermission from the request
    // whenever the user hadn't picked an agent, silently leaving "不許可"
    // without effect on the new session's first prompt.
    const { setSessionTaskPermission } = await import(
      "@/lib/opencode-task-permission"
    );
    (setSessionTaskPermission as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      subagentPermission: "deny",
    });

    expect(res.status).toBe(200);
    expect(setSessionTaskPermission).toHaveBeenCalledWith(
      "C:\\repo",
      "session-1",
      "deny",
    );
  });

  it("returns 400 when agent is provided but not a string, regardless of subagentPermission", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      agent: 42,
      subagentPermission: "deny",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/agent/i);
  });

  it("returns 400 when agent is only whitespace, regardless of subagentPermission", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      agent: "   ",
      subagentPermission: "allow",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/agent/i);
  });

  it("applies the session skill ruleset before the first prompt", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    const { setSessionSkillPermission } = await import(
      "@/lib/opencode-skill-permission"
    );
    (ocServer as ReturnType<typeof vi.fn>).mockClear();
    (setSessionSkillPermission as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      agent: "build",
      skillPermission: "deny",
    });

    expect(res.status).toBe(200);
    expect(setSessionSkillPermission).toHaveBeenCalledWith(
      "C:\\repo",
      "session-1",
      "deny",
    );
    const promptIndex = (ocServer as ReturnType<typeof vi.fn>).mock.calls.findIndex(
      (call) => String(call[1]).includes("/prompt_async"),
    );
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(
      (setSessionSkillPermission as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (ocServer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[promptIndex],
    );
  });

  it("returns 400 for an invalid skillPermission", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      agent: "build",
      skillPermission: "invalid",
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid skill permission/i);
  });

  it("applies the session skill ruleset even when no agent is selected", async () => {
    // Regression: skillPermission is session-scoped, not agent-scoped, so it
    // must take effect without an execution agent (mirrors subagentPermission).
    const { setSessionSkillPermission } = await import(
      "@/lib/opencode-skill-permission"
    );
    (setSessionSkillPermission as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      skillPermission: "deny",
    });

    expect(res.status).toBe(200);
    expect(setSessionSkillPermission).toHaveBeenCalledWith(
      "C:\\repo",
      "session-1",
      "deny",
    );
  });

  it("applies the session edit ruleset before the first prompt", async () => {
    // Regression: 確認する was client-only, and OpenCode's default ruleset
    // allows `edit`, so apply_patch / edit / write on the first prompt never
    // produced a permission event and ran with no approval card.
    const { ocServer } = await import("@/lib/oc-server");
    const { setSessionEditPermission } = await import("@/lib/opencode-access-mode");
    (ocServer as ReturnType<typeof vi.fn>).mockClear();
    (setSessionEditPermission as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      accessMode: "ask",
    });

    expect(res.status).toBe(200);
    expect(setSessionEditPermission).toHaveBeenCalledWith(
      "C:\\repo",
      "session-1",
      "ask",
    );
    const promptIndex = (ocServer as ReturnType<typeof vi.fn>).mock.calls.findIndex(
      (call) => String(call[1]).includes("/prompt_async"),
    );
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(
      (setSessionEditPermission as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (ocServer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[promptIndex],
    );
  });

  it("returns 400 for an invalid accessMode", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      accessMode: "allow",
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid access mode/i);
  });

  it("accepts request without variant", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
    });
    expect(res.status).not.toBe(400);
  });

  it("accepts variant 'high'", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: "high",
    });
    expect(res.status).not.toBe(400);
  });

  it("accepts variant 'low'", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: "low",
    });
    expect(res.status).not.toBe(400);
  });

  it("accepts variant 'medium'", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: "medium",
    });
    expect(res.status).not.toBe(400);
  });

  it("accepts variant 'xhigh'", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: "xhigh",
    });
    expect(res.status).not.toBe(400);
  });

  it("returns 400 for variant 'turbo'", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: "turbo",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid variant");
  });

  it("returns 400 for variant number", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: 42,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for variant object", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: { high: true },
    });
    expect(res.status).toBe(400);
  });

  it("does not call provisionWorkspace for invalid variant", async () => {
    const { provisionWorkspace } = await import("@/lib/workspace-service");
    (provisionWorkspace as ReturnType<typeof vi.fn>).mockClear();
    await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: "turbo",
    });
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("forwards variant to prompt_async when valid", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    (ocServer as ReturnType<typeof vi.fn>).mockClear();
    await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      variant: "high",
    });
    const calls = (ocServer as ReturnType<typeof vi.fn>).mock.calls;
    const promptCall = calls.find((c) =>
      String(c[1]).includes("/prompt_async"),
    );
    expect(promptCall).toBeDefined();
    const body = promptCall?.[2]?.body as Record<string, unknown>;
    expect(body.variant).toBe("high");
  });

  it("omits variant from prompt_async when not supplied", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    (ocServer as ReturnType<typeof vi.fn>).mockClear();
    await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
    });
    const calls = (ocServer as ReturnType<typeof vi.fn>).mock.calls;
    const promptCall = calls.find((c) =>
      String(c[1]).includes("/prompt_async"),
    );
    expect(promptCall).toBeDefined();
    const body = promptCall?.[2]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("variant");
  });

  it("sends known slash commands via session.command", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    (ocServer as ReturnType<typeof vi.fn>).mockImplementation(
      async (_dir: string | null, path: string) => {
        if (path === "/session") return { id: "session-1" };
        if (path === "/command") {
          return [{ name: "init", template: "init", hints: [] }];
        }
        return {};
      },
    );
    (ocServer as ReturnType<typeof vi.fn>).mockClear();
    await post({
      projectId: "project-1",
      prompt: "/init",
      isolation: "current_folder",
      variant: "high",
    });
    const calls = (ocServer as ReturnType<typeof vi.fn>).mock.calls;
    const commandCall = calls.find((c) =>
      String(c[1]).includes("/command") && String(c[1]).includes("/session/"),
    );
    const promptCall = calls.find((c) =>
      String(c[1]).includes("/prompt_async"),
    );
    expect(commandCall).toBeDefined();
    expect(promptCall).toBeUndefined();
    expect(commandCall?.[2]?.body).toMatchObject({
      command: "init",
      arguments: "",
      variant: "high",
    });
  });
});

describe("POST /api/tasks image attachments", () => {
  const image = {
    uri: "data:image/png;base64,iVBORw0KGgo=",
    mime: "image/png",
    name: "reference.png",
  };

  async function mockOpenCodeProvider(providerResult: unknown, agentResult: unknown = []) {
    const { ocServer } = await import("@/lib/oc-server");
    (ocServer as ReturnType<typeof vi.fn>).mockImplementation(
      async (_dir: string | null, path: string) => {
        if (path === "/provider") {
          if (providerResult instanceof Error) throw providerResult;
          return providerResult;
        }
        if (path === "/agent") return agentResult;
        if (path === "/session") return { id: "session-1" };
        if (path === "/command") return [];
        return {};
      },
    );
    (ocServer as ReturnType<typeof vi.fn>).mockClear();
    return ocServer as ReturnType<typeof vi.fn>;
  }

  function providerWithModel(
    modelID: string,
    capabilities?: { attachment?: boolean; input?: { image?: boolean } },
  ) {
    return {
      all: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            [modelID]: {
              name: modelID,
              ...(capabilities ? { capabilities } : {}),
            },
          },
        },
      ],
      connected: ["openai"],
      default: { openai: modelID },
    };
  }

  function expectNoOpenCodeTaskStart(calls: unknown[][]) {
    expect(
      calls.filter((call) => {
        const path = String(call[1]);
        return (
          path === "/session" ||
          path.includes("/prompt_async") ||
          path.includes("/command")
        );
      }),
    ).toEqual([]);
  }

  it("accepts an image-only task and forwards its file part to OpenCode", async () => {
    const ocServer = await mockOpenCodeProvider(
      providerWithModel("vision", { input: { image: true } }),
    );

    const res = await post({
      projectId: "project-1",
      prompt: "",
      isolation: "current_folder",
      model: { providerID: "openai", modelID: "vision" },
      files: [image],
    });

    expect(res.status).toBe(200);
    const calls = ocServer.mock.calls;
    const sessionCall = calls.find((c) => c[1] === "/session");
    expect(sessionCall?.[2]?.body).toEqual({ title: "画像タスク" });
    const promptCall = calls.find((c) =>
      String(c[1]).includes("/prompt_async"),
    );
    expect(promptCall?.[2]?.body).toEqual({
      parts: [
        { type: "text", text: "" },
        {
          type: "file",
          url: image.uri,
          mime: image.mime,
          filename: image.name,
        },
      ],
      model: { providerID: "openai", modelID: "vision" },
    });
  });

  it("rejects an image submission when connected is explicitly empty", async () => {
    const ocServer = await mockOpenCodeProvider({
      ...providerWithModel("vision", { input: { image: true } }),
      connected: [],
    });

    const res = await post({
      projectId: "project-1",
      prompt: "describe this",
      isolation: "current_folder",
      model: { providerID: "openai", modelID: "vision" },
      files: [image],
    });

    expect(res.status).toBe(400);
    expectNoOpenCodeTaskStart(ocServer.mock.calls);
  });

  it("allows an image submission when connected is omitted by a legacy provider", async () => {
    const ocServer = await mockOpenCodeProvider({
      ...providerWithModel("vision", { input: { image: true } }),
      connected: undefined,
    });

    const res = await post({
      projectId: "project-1",
      prompt: "describe this",
      isolation: "current_folder",
      model: { providerID: "openai", modelID: "vision" },
      files: [image],
    });

    expect(res.status).toBe(200);
    expect(
      ocServer.mock.calls.find((c) => String(c[1]).includes("/prompt_async")),
    ).toBeDefined();
  });

  it("allows image submission when attachment capability is explicitly true", async () => {
    const ocServer = await mockOpenCodeProvider(
      providerWithModel("attachment-model", { attachment: true }),
    );

    const res = await post({
      projectId: "project-1",
      prompt: "describe this",
      isolation: "current_folder",
      model: { providerID: "openai", modelID: "attachment-model" },
      files: [image],
    });

    expect(res.status).toBe(200);
    expect(
      ocServer.mock.calls.find((c) => String(c[1]).includes("/prompt_async")),
    ).toBeDefined();
  });

  it("rejects image submission when the selected agent model lacks image capability", async () => {
    const ocServer = await mockOpenCodeProvider(
      {
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
      },
      [
        {
          name: "text-agent",
          model: { providerID: "openai", modelID: "text-agent" },
        },
      ],
    );

    const res = await post({
      projectId: "project-1",
      prompt: "describe this",
      isolation: "current_folder",
      model: { providerID: "openai", modelID: "vision" },
      agent: "text-agent",
      files: [image],
    });

    expect(res.status).toBe(400);
    expectNoOpenCodeTaskStart(ocServer.mock.calls);
  });

  it("falls back to the request model when the selected agent has no configured model", async () => {
    // The agent carries no per-agent model, so image capability must be
    // decided by the model explicitly selected in the request instead of
    // fail-closing. The request model is image-capable, so the task starts.
    const ocServer = await mockOpenCodeProvider(
      providerWithModel("vision", { input: { image: true } }),
      [{ name: "unconfigured-agent" }],
    );

    const res = await post({
      projectId: "project-1",
      prompt: "describe this",
      isolation: "current_folder",
      model: { providerID: "openai", modelID: "vision" },
      agent: "unconfigured-agent",
      files: [image],
    });

    expect(res.status).toBe(200);
    expect(
      ocServer.mock.calls.find((c) => String(c[1]).includes("/prompt_async")),
    ).toBeDefined();
  });

  it("rejects image submission when an agent without a model falls back to a non-image request model", async () => {
    // The agent has no per-agent model, so the request model is used. That
    // model lacks image capability, so the submission is still rejected.
    const ocServer = await mockOpenCodeProvider(
      providerWithModel("text-only", { input: { image: false } }),
      [{ name: "unconfigured-agent" }],
    );

    const res = await post({
      projectId: "project-1",
      prompt: "describe this",
      isolation: "current_folder",
      model: { providerID: "openai", modelID: "text-only" },
      agent: "unconfigured-agent",
      files: [image],
    });

    expect(res.status).toBe(400);
    expectNoOpenCodeTaskStart(ocServer.mock.calls);
  });

  it("does not provision a workspace when image capability is not explicit", async () => {
    const ocServer = await mockOpenCodeProvider(
      providerWithModel("text-only", { input: { image: false } }),
    );
    const { provisionWorkspace } = await import("@/lib/workspace-service");
    (provisionWorkspace as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "describe this",
      isolation: "current_folder",
      model: { providerID: "openai", modelID: "text-only" },
      files: [image],
    });

    expect(res.status).toBe(400);
    expect(provisionWorkspace).not.toHaveBeenCalled();
    expectNoOpenCodeTaskStart(ocServer.mock.calls);
  });

  it.each([
    [
      "image false and attachment false",
      providerWithModel("text-only", {
        input: { image: false },
        attachment: false,
      }),
      { providerID: "openai", modelID: "text-only" },
    ],
    [
      "capability undefined",
      providerWithModel("unreported"),
      { providerID: "openai", modelID: "unreported" },
    ],
    [
      "provider retrieval failure",
      new Error("provider unavailable"),
      { providerID: "openai", modelID: "vision" },
    ],
    [
      "unknown model",
      providerWithModel("known-vision", { input: { image: true } }),
      { providerID: "openai", modelID: "unknown-vision" },
    ],
  ])(
    "rejects image submission unless model capability is explicitly true: %s",
    async (_case, providerResult, model) => {
      const ocServer = await mockOpenCodeProvider(providerResult);

      const res = await post({
        projectId: "project-1",
        prompt: "describe this",
        isolation: "current_folder",
        model,
        files: [image],
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: expect.stringMatching(/image|画像|capability|対応/),
      });
      expectNoOpenCodeTaskStart(ocServer.mock.calls);
    },
  );

  it("rejects image files whose declared MIME type does not match the data URL", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "",
      isolation: "current_folder",
      files: [
        {
          uri: "data:image/jpeg;base64,/9j/4AAQ",
          mime: "image/png",
        },
      ],
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid files" });
  });
});

describe("POST /api/tasks auto model selection", () => {
  const CHEAP = "claude-haiku-4-5";
  const MID = "claude-sonnet-5";
  const PREMIUM = "claude-opus-5";

  /** Short question → light, work instruction → standard, リファクタ → heavy. */
  const LIGHT_PROMPT = "この関数は何が問題なの";
  const STANDARD_PROMPT = "ログを追加して";
  const HEAVY_PROMPT = "この辺をまとめてリファクタして";

  const image = {
    uri: "data:image/png;base64,iVBORw0KGgo=",
    mime: "image/png",
    name: "reference.png",
  };

  function providerFixture(
    models?: Record<string, Record<string, unknown>>,
  ) {
    return {
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: models ?? {
            [CHEAP]: {
              variants: { minimal: {}, low: {}, medium: {}, high: {} },
            },
            [MID]: { variants: { low: {}, medium: {}, high: {} } },
            [PREMIUM]: { variants: { medium: {}, high: {} } },
          },
        },
      ],
      connected: ["anthropic"],
    };
  }

  async function mockOc(
    overrides: {
      provider?: unknown;
      agents?: unknown;
      commands?: unknown;
    } = {},
  ) {
    const { ocServer } = await import("@/lib/oc-server");
    const fn = ocServer as ReturnType<typeof vi.fn>;
    fn.mockImplementation(async (_dir: string | null, path: string) => {
      if (path === "/provider") return overrides.provider ?? providerFixture();
      if (path === "/agent") return overrides.agents ?? [];
      if (path === "/session") return { id: "session-1" };
      if (path === "/command") return overrides.commands ?? [];
      return {};
    });
    fn.mockClear();
    return fn;
  }

  async function setDisabled(disabled: Record<string, true>) {
    const { readProviderModelState } = await import(
      "@/lib/provider-model-state"
    );
    (readProviderModelState as ReturnType<typeof vi.fn>).mockReturnValue({
      disabled,
      providerOrder: [],
      modelOrder: {},
      providerIcons: {},
    });
  }

  beforeEach(async () => {
    await setDisabled({});
    const { provisionWorkspace } = await import("@/lib/workspace-service");
    (provisionWorkspace as ReturnType<typeof vi.fn>).mockClear();
  });

  function promptBodyOf(fn: ReturnType<typeof vi.fn>) {
    const call = fn.mock.calls.find((c) =>
      String(c[1]).includes("/prompt_async"),
    );
    return call?.[2]?.body as Record<string, unknown> | undefined;
  }

  it("forwards the resolved model and variant to prompt_async", async () => {
    const ocServer = await mockOc();

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(res.status).toBe(200);
    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "anthropic", modelID: CHEAP },
      variant: "minimal",
    });
  });

  it("picks a cheap model with a low effort for a standard prompt in cost mode", async () => {
    const ocServer = await mockOc();

    await post({
      projectId: "project-1",
      prompt: STANDARD_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "anthropic", modelID: CHEAP },
      variant: "low",
    });
  });

  it("picks the strongest model with a medium effort for a heavy prompt", async () => {
    const ocServer = await mockOc();

    await post({
      projectId: "project-1",
      prompt: HEAVY_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "anthropic", modelID: PREMIUM },
      variant: "medium",
    });
  });

  it("honours the WebUI-local disabled map", async () => {
    const ocServer = await mockOc();
    await setDisabled({ [`anthropic::${CHEAP}`]: true });

    await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    // Cheap band is empty after filtering, so light falls back to mid.
    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "anthropic", modelID: MID },
    });
  });

  it("sends the resolved model as a provider/model string for slash commands", async () => {
    const ocServer = await mockOc({
      commands: [{ name: "init", template: "init", hints: [] }],
    });

    const res = await post({
      projectId: "project-1",
      prompt: "/init",
      isolation: "current_folder",
      auto: true,
    });

    expect(res.status).toBe(200);
    const commandCall = ocServer.mock.calls.find(
      (c) =>
        String(c[1]).includes("/command") && String(c[1]).includes("/session/"),
    );
    expect(commandCall?.[2]?.body).toMatchObject({
      command: "init",
      arguments: "",
      model: `anthropic/${CHEAP}`,
      variant: "low",
    });
    expect(promptBodyOf(ocServer)).toBeUndefined();
  });

  it("returns the decision in the success response", async () => {
    await mockOc();

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoDecision).toEqual({
      providerID: "anthropic",
      modelID: CHEAP,
      variant: "minimal",
      tier: "light",
      mode: "cost",
      reason: "短い質問タスクのためコスト優先で選択しました",
      escalation: {
        providerID: "anthropic",
        modelID: PREMIUM,
        variant: "high",
      },
    });
  });

  it("omits autoDecision when auto is not requested", async () => {
    await mockOc();

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      model: { providerID: "anthropic", modelID: MID },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("autoDecision");
  });

  it("does not fetch /provider when auto is not requested", async () => {
    const ocServer = await mockOc();

    await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      model: { providerID: "anthropic", modelID: MID },
    });

    expect(
      ocServer.mock.calls.filter((c) => c[1] === "/provider"),
    ).toEqual([]);
  });

  it("returns 400 for a non-boolean auto", async () => {
    await mockOc();
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: "yes",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid auto" });
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("accepts auto: false as a plain manual request", async () => {
    const ocServer = await mockOc();

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: false,
      model: { providerID: "anthropic", modelID: MID },
    });

    expect(res.status).toBe(200);
    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "anthropic", modelID: MID },
    });
    expect(await res.json()).not.toHaveProperty("autoDecision");
  });

  it("returns 400 when auto and model are combined", async () => {
    await mockOc();
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      model: { providerID: "anthropic", modelID: MID },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "auto and model are mutually exclusive",
    });
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("allows auto with an empty model object", async () => {
    // Only providerID / modelID presence conflicts with auto.
    await mockOc();

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      model: {},
    });

    expect(res.status).toBe(200);
  });

  it("uses CodexBar usage to avoid a limited provider", async () => {
    const ocServer = await mockOc({
      provider: {
        all: [
          {
            id: "anthropic",
            models: { [CHEAP]: { variants: { minimal: {} } } },
          },
          {
            id: "openai",
            models: { "gpt-5-mini": { variants: { minimal: {} } } },
          },
        ],
        connected: ["anthropic", "openai"],
      },
    });

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      codexBarUsage: {
        anthropic: { usedPercent: 10, limited: true },
        openai: { usedPercent: 80, limited: false },
      },
    });

    expect(res.status).toBe(200);
    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "openai", modelID: "gpt-5-mini" },
    });
  });

  it("returns 400 when auto and variant are combined", async () => {
    await mockOc();
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      variant: "high",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "variant cannot be set with auto",
    });
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("accepts auto with an empty variant string", async () => {
    await mockOc();

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      variant: "",
    });

    expect(res.status).toBe(200);
  });

  it("returns 400 without provisioning when no candidate model exists", async () => {
    const ocServer = await mockOc({ provider: { all: [], connected: [] } });
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(
      /Auto で選択可能なモデルがありません/,
    );
    expect(provisionWorkspace).not.toHaveBeenCalled();
    expect(
      ocServer.mock.calls.filter((c) => c[1] === "/session"),
    ).toEqual([]);
  });

  it("returns 400 when provider reports an explicit empty connected list", async () => {
    await mockOc({ provider: { ...providerFixture(), connected: [] } });
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(res.status).toBe(400);
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("keeps an omitted connected field compatible with legacy responses", async () => {
    const ocServer = await mockOc({
      provider: { ...providerFixture(), connected: undefined },
    });

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(res.status).toBe(200);
    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "anthropic", modelID: CHEAP },
    });
  });

  it("returns 400 without provisioning when every model is disabled", async () => {
    await mockOc();
    await setDisabled({ anthropic: true });
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(res.status).toBe(400);
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("skips the selection when the chosen agent pins its own model", async () => {
    const ocServer = await mockOc({
      agents: [
        { name: "pinned", model: { providerID: "anthropic", modelID: MID } },
      ],
    });

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      agent: "pinned",
    });

    expect(res.status).toBe(200);
    // OpenCode applies the agent model itself, so no model / variant is sent.
    const body = promptBodyOf(ocServer);
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("variant");
    expect(body).toMatchObject({ agent: "pinned" });
    expect(await res.json()).not.toHaveProperty("autoDecision");
    // The selection never ran, so /provider is not consulted either.
    expect(
      ocServer.mock.calls.filter((c) => c[1] === "/provider"),
    ).toEqual([]);
  });

  it("still selects a model for an agent without a pinned model", async () => {
    const ocServer = await mockOc({ agents: [{ name: "unconfigured" }] });

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      agent: "unconfigured",
    });

    expect(res.status).toBe(200);
    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "anthropic", modelID: CHEAP },
      variant: "minimal",
      agent: "unconfigured",
    });
    expect((await res.json()).autoDecision).toMatchObject({ modelID: CHEAP });
  });

  it("selects only from image-capable models when files are attached", async () => {
    const ocServer = await mockOc({
      provider: providerFixture({
        [CHEAP]: { variants: { minimal: {} } },
        [MID]: {
          variants: { low: {}, high: {} },
          capabilities: { input: { image: true } },
        },
      }),
    });

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      files: [image],
    });

    expect(res.status).toBe(200);
    expect(promptBodyOf(ocServer)).toMatchObject({
      model: { providerID: "anthropic", modelID: MID },
      variant: "low",
    });
    expect((await res.json()).autoDecision.reason).toBe(
      "短い質問タスクのためコスト優先で選択しました（画像対応モデルに限定）（該当コスト帯に候補がなく別コスト帯へフォールバック）",
    );
  });

  it("returns 400 when files are attached and no model supports images", async () => {
    await mockOc({
      provider: providerFixture({
        [CHEAP]: { variants: { minimal: {} } },
        [MID]: { capabilities: { input: { image: false } } },
      }),
    });
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
      files: [image],
    });

    expect(res.status).toBe(400);
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("analyzes an image natively before sending it to an Auto-selected text model", async () => {
    const previousNative = process.env.OPENCODE_WEBUI_QWEN_NATIVE;
    process.env.OPENCODE_WEBUI_QWEN_NATIVE = "1";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "A native Qwen analysis." } }] }),
        { status: 200 },
      ),
    );
    try {
      const ocServer = await mockOc({
        provider: providerFixture({
          [CHEAP]: { variants: { minimal: {} } },
          [MID]: { capabilities: { input: { image: false } } },
        }),
      });

      const res = await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        auto: true,
        files: [image],
      });

      expect(res.status).toBe(200);
      expect(promptBodyOf(ocServer)).toMatchObject({
        model: { providerID: "anthropic", modelID: CHEAP },
        parts: [
          {
            type: "text",
            text: expect.stringContaining("A native Qwen analysis."),
          },
        ],
      });
    } finally {
      fetchMock.mockRestore();
      if (previousNative === undefined) delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;
      else process.env.OPENCODE_WEBUI_QWEN_NATIVE = previousNative;
    }
  });

  it("returns 502 without provisioning when /provider is unavailable", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    (ocServer as ReturnType<typeof vi.fn>).mockImplementation(
      async (_dir: string | null, path: string) => {
        if (path === "/provider") throw new Error("provider unavailable");
        if (path === "/session") return { id: "session-1" };
        return {};
      },
    );
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    // Distinct from the "no candidate after filtering" 400 case just above:
    // the provider list itself could not be fetched, so the message points
    // at retrying rather than at provider/model settings.
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(
      /プロバイダ情報を取得できませんでした/,
    );
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("returns 503 without provisioning when /provider times out", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    const { OcError } = await import("@/lib/oc-server");
    (ocServer as ReturnType<typeof vi.fn>).mockImplementation(
      async (_dir: string | null, path: string) => {
        if (path === "/provider") {
          throw new OcError("OpenCode engine が10秒でタイムアウトしました", 503);
        }
        if (path === "/session") return { id: "session-1" };
        return {};
      },
    );
    const { provisionWorkspace } = await import("@/lib/workspace-service");

    const res = await post({
      projectId: "project-1",
      prompt: LIGHT_PROMPT,
      isolation: "current_folder",
      auto: true,
    });

    expect(res.status).toBe(503);
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  describe("autoOptimize", () => {
    /**
     * Fixture efforts: cheap has minimal/low/medium/high, mid has
     * low/medium/high, premium has medium/high (no max), so the tables below
     * also exercise "requested effort not declared" fallbacks.
     */
    const expected = {
      cost: {
        light: [CHEAP, "minimal"],
        standard: [CHEAP, "low"],
        heavy: [PREMIUM, "medium"],
      },
      balanced: {
        light: [CHEAP, "low"],
        standard: [MID, "medium"],
        heavy: [PREMIUM, "high"],
      },
      intelligence: {
        light: [MID, "medium"],
        standard: [PREMIUM, "high"],
        heavy: [PREMIUM, "high"],
      },
    } as const;

    const promptFor = {
      light: LIGHT_PROMPT,
      standard: STANDARD_PROMPT,
      heavy: HEAVY_PROMPT,
    } as const;

    for (const mode of ["cost", "balanced", "intelligence"] as const) {
      for (const tier of ["light", "standard", "heavy"] as const) {
        const [modelID, variant] = expected[mode][tier];
        it(`${mode} + ${tier} resolves ${modelID} at ${variant}`, async () => {
          const ocServer = await mockOc();

          const res = await post({
            projectId: "project-1",
            prompt: promptFor[tier],
            isolation: "current_folder",
            auto: true,
            autoOptimize: mode,
          });

          expect(res.status).toBe(200);
          expect(promptBodyOf(ocServer)).toMatchObject({
            model: { providerID: "anthropic", modelID },
            variant,
          });
        });
      }
    }

    it("defaults to cost when autoOptimize is omitted", async () => {
      const ocServer = await mockOc();

      await post({
        projectId: "project-1",
        prompt: STANDARD_PROMPT,
        isolation: "current_folder",
        auto: true,
      });

      expect(promptBodyOf(ocServer)).toMatchObject({
        model: { providerID: "anthropic", modelID: CHEAP },
        variant: "low",
      });
    });

    it("echoes the mode on autoDecision", async () => {
      await mockOc();

      const res = await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        auto: true,
        autoOptimize: "intelligence",
      });

      const body = await res.json();
      expect(body.autoDecision).toMatchObject({
        mode: "intelligence",
        modelID: MID,
        tier: "light",
        reason: "短い質問タスクのため知能優先で選択しました",
      });
    });

    it.each(["bogus", "balance", "COST", "", 1, null, true])(
      "rejects autoOptimize %p with 400 before provisioning",
      async (value) => {
        await mockOc();
        const { provisionWorkspace } = await import("@/lib/workspace-service");

        const res = await post({
          projectId: "project-1",
          prompt: LIGHT_PROMPT,
          isolation: "current_folder",
          auto: true,
          autoOptimize: value,
        });

        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({
          error: "invalid autoOptimize",
        });
        expect(provisionWorkspace).not.toHaveBeenCalled();
      },
    );

    it("rejects autoOptimize without auto before provisioning", async () => {
      await mockOc();
      const { provisionWorkspace } = await import("@/lib/workspace-service");

      const res = await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        model: { providerID: "anthropic", modelID: MID },
        autoOptimize: "balanced",
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: "autoOptimize requires auto",
      });
      expect(provisionWorkspace).not.toHaveBeenCalled();
    });

    it("bumps the tier when three or more images are attached", async () => {
      const visionModels = {
        [CHEAP]: {
          variants: { minimal: {}, low: {}, medium: {}, high: {} },
          capabilities: { input: { image: true } },
        },
        [MID]: {
          variants: { low: {}, medium: {}, high: {} },
          capabilities: { input: { image: true } },
        },
        [PREMIUM]: {
          variants: { medium: {}, high: {} },
          capabilities: { input: { image: true } },
        },
      };

      const oneImage = await mockOc({
        provider: providerFixture(visionModels),
      });
      await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        auto: true,
        files: [image],
      });
      // light stays light below the attachment threshold.
      expect(promptBodyOf(oneImage)).toMatchObject({
        model: { providerID: "anthropic", modelID: CHEAP },
      });

      const threeImages = await mockOc({
        provider: providerFixture(visionModels),
      });
      await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        auto: true,
        files: [image, image, image],
      });
      // Three attachments bump light → standard, but cost mode still prefers
      // the cheap image-capable model.
      expect(promptBodyOf(threeImages)).toMatchObject({
        model: { providerID: "anthropic", modelID: CHEAP },
      });
    });
  });

  describe("autoRouteOverrides", () => {
    it("overrides the cost order for the matching tier", async () => {
      const ocServer = await mockOc();

      // cost + light preset prefers cheap; force premium via override.
      const res = await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        auto: true,
        autoOptimize: "cost",
        autoRouteOverrides: { light: { costOrder: ["premium", "mid", "cheap"] } },
      });

      expect(res.status).toBe(200);
      expect(promptBodyOf(ocServer)).toMatchObject({
        model: { providerID: "anthropic", modelID: PREMIUM },
      });
    });

    it("overrides the variant order for the matching tier", async () => {
      const ocServer = await mockOc();

      const res = await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        auto: true,
        autoOptimize: "cost",
        autoRouteOverrides: { light: { variantOrder: ["high"] } },
      });

      expect(res.status).toBe(200);
      expect(promptBodyOf(ocServer)).toMatchObject({
        model: { providerID: "anthropic", modelID: CHEAP },
        variant: "high",
      });
    });

    it("leaves tiers with no override on the preset", async () => {
      const ocServer = await mockOc();

      // Override targets `heavy`; the light-tier prompt must stay unaffected.
      const res = await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        auto: true,
        autoOptimize: "cost",
        autoRouteOverrides: { heavy: { costOrder: null } },
      });

      expect(res.status).toBe(200);
      expect(promptBodyOf(ocServer)).toMatchObject({
        model: { providerID: "anthropic", modelID: CHEAP },
      });
    });

    it("drops unknown tiers/entries instead of rejecting", async () => {
      const ocServer = await mockOc();

      const res = await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        auto: true,
        autoOptimize: "cost",
        autoRouteOverrides: {
          extreme: { costOrder: ["cheap"] },
          light: { costOrder: ["bogus"] },
        },
      });

      // The malformed override normalizes to {}, so the cost preset applies.
      expect(res.status).toBe(200);
      expect(promptBodyOf(ocServer)).toMatchObject({
        model: { providerID: "anthropic", modelID: CHEAP },
      });
    });

    it("rejects autoRouteOverrides without auto before provisioning", async () => {
      await mockOc();
      const { provisionWorkspace } = await import("@/lib/workspace-service");

      const res = await post({
        projectId: "project-1",
        prompt: LIGHT_PROMPT,
        isolation: "current_folder",
        model: { providerID: "anthropic", modelID: MID },
        autoRouteOverrides: { light: { costOrder: null } },
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: "autoRouteOverrides requires auto",
      });
      expect(provisionWorkspace).not.toHaveBeenCalled();
    });
  });

});
