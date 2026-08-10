import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  workspaces: [] as unknown[],
  bindings: new Map<string, unknown>(),
  ocResponses: {} as Record<string, unknown>,
  ocFail: new Set<string>(),
  ocCalls: [] as string[],
}));

vi.mock("./db", () => ({
  listWorkspacesJoined: () => h.workspaces,
  primaryBindings: () => h.bindings,
}));

vi.mock("./dirstat", () => ({
  dirStat: async () => ({
    git: true,
    branch: "main",
    additions: 0,
    deletions: 0,
    files: 0,
  }),
}));

vi.mock("./project-session-sync", () => ({
  restoreAllKnownProjects: () => undefined,
}));

vi.mock("./oc-server", async () => {
  const actual =
    await vi.importActual<typeof import("./oc-server")>("./oc-server");
  return {
    ...actual,
    ocServer: vi.fn(async (dir: string | null, path: string) => {
      const key = `${dir ?? ""}${path}`;
      h.ocCalls.push(key);
      if (h.ocFail.has(key)) throw new Error("engine unavailable");
      if (path === "/session/status") return {};
      if (path === "/global/health") return { healthy: true };
      return h.ocResponses[key] ?? [];
    }),
  };
});

import {
  __clearSessionEstimateCacheForTest,
  getTask,
  getTaskCost,
  listTasks,
} from "./task-service";

const WS = {
  id: "ws1",
  project_id: "prj1",
  project_name: "Repo",
  display_name: "Task title",
  absolute_path: "/repo",
  isolation: "current_folder" as const,
  base_branch: null,
  worktree_path: null,
  status: "active" as const,
  created_at: "2026-07-18T00:00:00Z",
};

const BINDING = {
  workspace_id: "ws1",
  opencode_session_id: "sess1",
  title: "Task title",
  updated_at: "2026-07-18T01:00:00Z",
};

beforeEach(() => {
  h.workspaces = [WS];
  h.bindings = new Map([["ws1", BINDING]]);
  h.ocResponses = {};
  h.ocFail = new Set();
  h.ocCalls = [];
  __clearSessionEstimateCacheForTest();
});

describe("listTasks cost aggregation", () => {
  it("returns an empty list and skips per-directory fan-out when no workspaces exist", async () => {
    h.workspaces = [];
    h.bindings = new Map();
    const { tasks, engineOk } = await listTasks();
    expect(tasks).toEqual([]);
    expect(engineOk).toBe(true);
    // Only the single /global/health call should reach the engine.
    expect(h.ocCalls).toEqual(["/global/health"]);
  });

  it("attaches Session.cost from /session to the bound task", async () => {
    h.ocResponses["/repo/session"] = [{ id: "sess1", cost: 0.1234 }];
    const { tasks } = await listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].cost).toBe(0.1234);
  });

  it("leaves cost undefined when the session list has no matching entry", async () => {
    h.ocResponses["/repo/session"] = [{ id: "other-session", cost: 5 }];
    const { tasks } = await listTasks();
    expect(tasks[0].cost).toBeUndefined();
  });

  it("leaves cost undefined (not throwing) when the /session call fails", async () => {
    h.ocFail.add("/repo/session");
    const { tasks } = await listTasks();
    expect(tasks[0].cost).toBeUndefined();
    expect(tasks[0].id).toBe("ws1");
  });

  it("leaves cost undefined when the task has no bound session", async () => {
    h.bindings = new Map();
    h.ocResponses["/repo/session"] = [{ id: "sess1", cost: 9 }];
    const { tasks } = await listTasks();
    expect(tasks[0].cost).toBeUndefined();
  });

  it("does not fetch transcripts for unbound sessions", async () => {
    h.bindings = new Map();
    h.ocResponses["/repo/session"] = [{
      id: "unbound-session",
      cost: 0,
      model: { id: "gpt-5.6-luna", providerID: "openai" },
      tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
    }];

    await listTasks();
    expect(h.ocCalls).not.toContain("/repo/session/unbound-session/message");
  });

  it("does not fetch the full transcript when Session.cost is unavailable", async () => {
    h.ocResponses["/repo/session"] = [{ id: "sess1", cost: 0 }];
    h.ocResponses["/repo/session/sess1/message"] = [{
      info: {
        id: "msg1",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.6-luna",
        tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
      },
      parts: [],
    }];

    const { tasks } = await listTasks();
    expect(tasks[0].cost).toBe(0);
    expect(h.ocCalls).not.toContain("/repo/session/sess1/message");
  });

  it("falls back to aggregate session tokens when the transcript is unavailable", async () => {
    h.ocResponses["/repo/session"] = [{
      id: "sess1",
      cost: 0,
      model: { id: "gpt-5.6-luna", providerID: "openai" },
      tokens: { input: 1_000_000, output: 100_000, reasoning: 0, cache: { read: 0, write: 0 } },
    }];

    const { tasks } = await listTasks();
    expect(tasks[0].cost).toBe(0.32);
    expect(h.ocCalls).toContain("/repo/session/sess1/message");
  });

  it("retries transcript estimation after a temporary fetch failure", async () => {
    h.ocResponses["/repo/session"] = [{
      id: "sess1",
      cost: 0,
      model: { id: "gpt-5.6-luna", providerID: "openai" },
      tokens: { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
    }];
    h.ocFail.add("/repo/session/sess1/message");

    await expect(listTasks()).resolves.toMatchObject({ tasks: [{ cost: 0.032 }] });

    h.ocFail.delete("/repo/session/sess1/message");
    h.ocResponses["/repo/session/sess1/message"] = [{
      info: {
        id: "terra-message",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.6-terra",
        cost: 0,
        tokens: { input: 100_000, output: 10_000, reasoning: 0 },
      },
      parts: [],
    }];

    await expect(listTasks()).resolves.toMatchObject({ tasks: [{ cost: 0.32 }] });
    expect(h.ocCalls.filter((call) => call === "/repo/session/sess1/message")).toHaveLength(2);
  });

  it("uses per-message model prices when a session switched models", async () => {
    h.ocResponses["/repo/session"] = [{
      id: "sess-mixed",
      cost: 0,
      model: { id: "gpt-5.6-luna", providerID: "openai" },
      tokens: { input: 300_000, output: 15_000, reasoning: 0, cache: { read: 0, write: 0 } },
    }];
    h.bindings = new Map([["ws1", { ...BINDING, opencode_session_id: "sess-mixed" }]]);
    h.ocResponses["/repo/session/sess-mixed/message"] = [
      {
        info: {
          id: "terra-message",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5.6-terra",
          cost: 0,
          tokens: { input: 100_000, output: 10_000, reasoning: 0 },
        },
        parts: [],
      },
      {
        info: {
          id: "luna-message",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5.6-luna",
          cost: 0,
          tokens: { input: 200_000, output: 5_000, reasoning: 0 },
        },
        parts: [],
      },
    ];

    const { tasks } = await listTasks();
    expect(tasks[0].cost).toBeCloseTo(0.366, 12);
    expect(h.ocCalls).toContain("/repo/session/sess-mixed/message");
  });

  it("reuses an unchanged exact transcript estimate", async () => {
    h.ocResponses["/repo/session"] = [{
      id: "sess-cached",
      cost: 0,
      model: { id: "gpt-5.6-luna", providerID: "openai" },
      tokens: { input: 1_000_000, output: 100_000, reasoning: 0, cache: { read: 0, write: 0 } },
    }];
    h.bindings = new Map([["ws1", { ...BINDING, opencode_session_id: "sess-cached" }]]);
    h.ocResponses["/repo/session/sess-cached/message"] = [{
      info: {
        id: "cached-message",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.6-luna",
        cost: 0,
        tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
      },
      parts: [],
    }];

    await listTasks();
    await listTasks();
    expect(h.ocCalls.filter((call) => call === "/repo/session/sess-cached/message")).toHaveLength(1);
  });
});

describe("getTask cost aggregation", () => {
  it("attaches Session.cost for the single task", async () => {
    h.ocResponses["/repo/session"] = [{ id: "sess1", cost: 2.5 }];
    const task = await getTask("ws1");
    expect(task?.cost).toBe(2.5);
  });

  it("reads a task cost from the lightweight session endpoint", async () => {
    h.ocResponses["/repo/session/sess1"] = { cost: 3.75 };
    await expect(getTaskCost("ws1")).resolves.toBe(3.75);
    expect(h.ocCalls).toContain("/repo/session/sess1");
    expect(h.ocCalls).not.toContain("/repo/session/sess1/message");
  });

  it("estimates a lightweight task cost from aggregate session tokens", async () => {
    h.ocResponses["/repo/session/sess1"] = {
      cost: 0,
      model: { id: "gpt-5.6-luna", providerID: "openai" },
      tokens: { input: 1_000_000, output: 100_000, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    await expect(getTaskCost("ws1")).resolves.toBe(0.32);
    expect(h.ocCalls).toContain("/repo/session/sess1/message");
  });

  it("uses per-message pricing for a mixed-model lightweight session", async () => {
    h.ocResponses["/repo/session/sess1"] = {
      cost: 0,
      model: { id: "gpt-5.6-luna", providerID: "openai" },
      tokens: { input: 300_000, output: 15_000, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    h.ocResponses["/repo/session/sess1/message"] = [
      {
        info: {
          id: "terra-message",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5.6-terra",
          cost: 0,
          tokens: { input: 100_000, output: 10_000, reasoning: 0 },
        },
        parts: [],
      },
      {
        info: {
          id: "luna-message",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5.6-luna",
          cost: 0,
          tokens: { input: 200_000, output: 5_000, reasoning: 0 },
        },
        parts: [],
      },
    ];

    await expect(getTaskCost("ws1")).resolves.toBeCloseTo(0.366, 12);
    expect(h.ocCalls).toContain("/repo/session/sess1/message");
  });
});

describe("listTasks agent/provider aggregation", () => {
  it("attaches agent and model provider/id from /session to the bound task", async () => {
    h.ocResponses["/repo/session"] = [
      {
        id: "sess1",
        cost: 0.5,
        agent: "build",
        model: { id: "claude-opus", providerID: "anthropic" },
      },
    ];
    const { tasks } = await listTasks();
    expect(tasks[0].agent).toBe("build");
    expect(tasks[0].providerID).toBe("anthropic");
    expect(tasks[0].modelID).toBe("claude-opus");
    // cost still flows through the same single fetch
    expect(tasks[0].cost).toBe(0.5);
  });

  it("leaves agent/provider/model undefined when the /session entry omits them", async () => {
    h.ocResponses["/repo/session"] = [{ id: "sess1", cost: 0.1 }];
    const { tasks } = await listTasks();
    expect(tasks[0].agent).toBeUndefined();
    expect(tasks[0].providerID).toBeUndefined();
    expect(tasks[0].modelID).toBeUndefined();
  });

  it("leaves agent/provider/model undefined when the /session call fails", async () => {
    h.ocFail.add("/repo/session");
    const { tasks } = await listTasks();
    expect(tasks[0].agent).toBeUndefined();
    expect(tasks[0].providerID).toBeUndefined();
    expect(tasks[0].modelID).toBeUndefined();
  });

  it("leaves agent/provider/model undefined when the task has no bound session", async () => {
    h.bindings = new Map();
    h.ocResponses["/repo/session"] = [
      {
        id: "sess1",
        agent: "build",
        model: { id: "claude-opus", providerID: "anthropic" },
      },
    ];
    const { tasks } = await listTasks();
    expect(tasks[0].agent).toBeUndefined();
    expect(tasks[0].providerID).toBeUndefined();
    expect(tasks[0].modelID).toBeUndefined();
  });
});

describe("getTask agent/provider aggregation", () => {
  it("attaches agent and model provider/id for the single task", async () => {
    h.ocResponses["/repo/session"] = [
      {
        id: "sess1",
        agent: "plan",
        model: { id: "gpt-5", providerID: "openai" },
      },
    ];
    const task = await getTask("ws1");
    expect(task?.agent).toBe("plan");
    expect(task?.providerID).toBe("openai");
    expect(task?.modelID).toBe("gpt-5");
  });
});

describe("listTasks archived filter", () => {
  it("excludes workspaces with status archived", async () => {
    h.workspaces = [
      { ...WS, id: "ws1", status: "active" },
      { ...WS, id: "ws2", status: "archived" },
    ];
    h.bindings = new Map();
    const { tasks } = await listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("ws1");
  });
});

describe("listArchivedTasks", () => {
  it("returns only archived workspaces as TaskSummary[]", async () => {
    h.workspaces = [
      { ...WS, id: "ws1", status: "active" },
      { ...WS, id: "ws2", status: "archived" },
    ];
    h.bindings = new Map();
    const { listArchivedTasks } = await import("./task-service");
    const tasks = await listArchivedTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("ws2");
  });

  it("returns empty array when no archived workspaces exist", async () => {
    h.workspaces = [{ ...WS, id: "ws1", status: "active" }];
    h.bindings = new Map();
    const { listArchivedTasks } = await import("./task-service");
    const tasks = await listArchivedTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks).toHaveLength(0);
  });
});
