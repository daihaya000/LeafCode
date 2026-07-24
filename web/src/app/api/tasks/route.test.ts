import { describe, expect, it, vi } from "vitest";
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

vi.mock("@/lib/opencode-task-permission", () => ({
  setAgentTaskPermission: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/tasks variant validation", () => {
  it("applies the selected agent task permission before the first prompt", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    const { setAgentTaskPermission } = await import("@/lib/opencode-task-permission");
    (ocServer as ReturnType<typeof vi.fn>).mockClear();
    (setAgentTaskPermission as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      agent: "build",
      subagentPermission: "deny",
    });

    expect(res.status).toBe(200);
    expect(setAgentTaskPermission).toHaveBeenCalledWith("C:\\repo", "build", "deny");
    const promptIndex = (ocServer as ReturnType<typeof vi.fn>).mock.calls.findIndex(
      (call) => String(call[1]).includes("/prompt_async"),
    );
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    // The permission helper must finish before this call, otherwise OpenCode
    // could execute task immediately under a pre-existing allow rule.
    expect((setAgentTaskPermission as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
      .toBeLessThan((ocServer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[promptIndex]);
  });

  it("returns 400 when subagentPermission is specified but agent is undefined", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      subagentPermission: "deny",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/execution agent|required/i);
  });

  it("returns 400 when subagentPermission is specified but agent is not a string", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      agent: 42,
      subagentPermission: "deny",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/execution agent|required/i);
  });

  it("returns 400 when subagentPermission is specified but agent is only whitespace", async () => {
    const res = await post({
      projectId: "project-1",
      prompt: "hello",
      isolation: "current_folder",
      agent: "   ",
      subagentPermission: "allow",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/execution agent|required/i);
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

  it("rejects image submission when the selected agent model is undefined", async () => {
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
