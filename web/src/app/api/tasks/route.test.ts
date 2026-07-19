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
});

describe("POST /api/tasks image attachments", () => {
  const image = {
    uri: "data:image/png;base64,iVBORw0KGgo=",
    mime: "image/png",
    name: "reference.png",
  };

  it("accepts an image-only task and forwards its file part to OpenCode", async () => {
    const { ocServer } = await import("@/lib/oc-server");
    (ocServer as ReturnType<typeof vi.fn>).mockClear();

    const res = await post({
      projectId: "project-1",
      prompt: "",
      isolation: "current_folder",
      files: [image],
    });

    expect(res.status).toBe(200);
    const calls = (ocServer as ReturnType<typeof vi.fn>).mock.calls;
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
    });
  });

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
