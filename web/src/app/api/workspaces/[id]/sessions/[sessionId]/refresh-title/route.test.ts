import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  ocServer,
  getWorkspace,
  listSessionBindings,
  updateSessionTitle,
  persistProjectSessions,
} = vi.hoisted(() => ({
  ocServer: vi.fn(),
  getWorkspace: vi.fn(),
  listSessionBindings: vi.fn(),
  updateSessionTitle: vi.fn(),
  persistProjectSessions: vi.fn(),
}));

vi.mock("@/lib/oc-server", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/oc-server")>("@/lib/oc-server");
  return { ...actual, ocServer };
});
vi.mock("@/lib/db", () => ({
  getWorkspace,
  listSessionBindings,
  updateSessionTitle,
}));
vi.mock("@/lib/project-session-sync", () => ({ persistProjectSessions }));

import { POST } from "./route";
import { OcError } from "@/lib/oc-server";

const WS = { id: "ws1", project_id: "prj1", absolute_path: "/repo" };
const BINDING = {
  workspace_id: "ws1",
  opencode_session_id: "sess1",
  title: "old",
  updated_at: "t0",
};

function ctx() {
  return { params: Promise.resolve({ id: "ws1", sessionId: "sess1" }) };
}
function req() {
  return new Request("http://x", { headers: { host: "127.0.0.1:3000" }, method: "POST" }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockReturnValue(WS);
  listSessionBindings.mockReturnValue([BINDING]);
  updateSessionTitle.mockReturnValue(true);
});

describe("POST refresh-title", () => {
  it("404 when workspace missing", async () => {
    getWorkspace.mockReturnValue(undefined);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("404 when session not bound to workspace", async () => {
    listSessionBindings.mockReturnValue([
      { ...BINDING, opencode_session_id: "other" },
    ]);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("422 when conversation has no usable text", async () => {
    ocServer.mockImplementation(async (_dir: string, path: string) => {
      if (path === "/session/sess1/message") return [];
      throw new Error("unexpected " + path);
    });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(422);
  });

  it("generates title, cleans temp before patch, updates original + db + manifest", async () => {
    const calls: string[] = [];
    let titlePrompt: Record<string, unknown> | undefined;
    ocServer.mockImplementation(
      async (
        _dir: string,
        path: string,
        init?: { method?: string; body?: Record<string, unknown> },
      ) => {
        calls.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/session/sess1/message" && init?.method === undefined)
          return [
            {
              info: { id: "m1", role: "user", providerID: "p", modelID: "m" },
              parts: [
                {
                  id: "x",
                  messageID: "m1",
                  type: "text",
                  text: "hello world",
                },
              ],
            },
          ];
        if (path === "/session" && init?.method === "POST")
          return { id: "temp1" };
        if (path === "/experimental/tool/ids")
          return ["bash", "edit", "read", "write", "grep"];
        if (path === "/session/temp1/message" && init?.method === "POST") {
          titlePrompt = init.body;
          return {
            info: { id: "a1", role: "assistant" },
            parts: [{ id: "y", messageID: "a1", type: "text", text: "会話の要約" }],
          };
        }
        if (path === "/session/temp1" && init?.method === "DELETE") return true;
        if (path === "/session/sess1" && init?.method === "PATCH")
          return { id: "sess1", title: "会話の要約" };
        throw new Error("unexpected " + path);
      },
    );

    const res = await POST(req(), ctx());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.title).toBe("会話の要約");
    expect(titlePrompt?.system).toContain("日本語タイトル");
    expect(titlePrompt?.tools).toEqual({
      bash: false,
      edit: false,
      read: false,
      write: false,
      grep: false,
    });
    const delIdx = calls.indexOf("DELETE /session/temp1");
    const patchIdx = calls.indexOf("PATCH /session/sess1");
    expect(delIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeGreaterThan(delIdx);
    expect(updateSessionTitle).toHaveBeenCalledWith("ws1", "sess1", "会話の要約");
    expect(persistProjectSessions).toHaveBeenCalledWith("prj1");
  });

  it.each([
    ["request failure", new Error("tool ids unavailable")],
    ["empty array", []],
    ["non-array response", { bash: true }],
  ])(
    "fails closed when tool IDs have %s and does not send the title message",
    async (_caseName, toolIds) => {
      ocServer.mockImplementation(
        async (_dir: string, path: string, init?: { method?: string }) => {
          if (path === "/session/sess1/message" && init?.method === undefined)
            return [
              {
                info: { id: "m1", role: "user", providerID: "p", modelID: "m" },
                parts: [{ id: "x", messageID: "m1", type: "text", text: "hi" }],
              },
            ];
          if (path === "/session" && init?.method === "POST")
            return { id: "temp1" };
          if (path === "/experimental/tool/ids") {
            if (toolIds instanceof Error) throw toolIds;
            return toolIds;
          }
          if (path === "/session/temp1" && init?.method === "DELETE") return true;
          throw new Error("unexpected " + path);
        },
      );

      const res = await POST(req(), ctx());

      expect(res.status).toBe(502);
      expect(
        ocServer.mock.calls.some(
          ([, path, init]) =>
            path === "/session/temp1/message" && init?.method === "POST",
        ),
      ).toBe(false);
      expect(updateSessionTitle).not.toHaveBeenCalled();
      expect(persistProjectSessions).not.toHaveBeenCalled();
    },
  );

  it("normalizes tool ID OcError 404 to 502 without sending the title message", async () => {
    ocServer.mockImplementation(
      async (_dir: string, path: string, init?: { method?: string }) => {
        if (path === "/session/sess1/message" && init?.method === undefined)
          return [
            {
              info: { id: "m1", role: "user", providerID: "p", modelID: "m" },
              parts: [{ id: "x", messageID: "m1", type: "text", text: "hi" }],
            },
          ];
        if (path === "/session" && init?.method === "POST")
          return { id: "temp1" };
        if (path === "/experimental/tool/ids")
          throw new OcError("tool ids not found", 404);
        if (path === "/session/temp1" && init?.method === "DELETE") return true;
        throw new Error("unexpected " + path);
      },
    );

    const res = await POST(req(), ctx());

    expect(res.status).toBe(502);
    expect(
      ocServer.mock.calls.some(
        ([, path, init]) =>
          path === "/session/temp1/message" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("fails and does not patch original when temp cleanup fails", async () => {
    ocServer.mockImplementation(
      async (_dir: string, path: string, init?: { method?: string }) => {
        if (path === "/session/sess1/message" && init?.method === undefined)
          return [
            {
              info: { id: "m1", role: "user", providerID: "p", modelID: "m" },
              parts: [{ id: "x", messageID: "m1", type: "text", text: "hi" }],
            },
          ];
        if (path === "/session" && init?.method === "POST")
          return { id: "temp1" };
        if (path === "/session/temp1/message" && init?.method === "POST")
          return {
            info: { id: "a1", role: "assistant" },
            parts: [{ id: "y", messageID: "a1", type: "text", text: "T" }],
          };
        if (path === "/session/temp1" && init?.method === "DELETE")
          throw new Error("cleanup boom");
        throw new Error("unexpected " + path);
      },
    );
    const res = await POST(req(), ctx());
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(updateSessionTitle).not.toHaveBeenCalled();
  });
});
