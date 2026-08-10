import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  project: undefined as { id: string; name: string; root_path: string } | undefined,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => h.project,
    }),
  }),
}));

import { GET as LIST_GET, POST } from "./route";
import { DELETE, GET, PUT } from "./[name]/route";

let root: string;

function localRequest(url: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://127.0.0.1:3000${url}`, {
    method,
    headers: { host: "127.0.0.1:3000" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "project-agents-"));
  h.project = { id: "project-1", name: "Fixture", root_path: root };
});

afterEach(() => {
  h.project = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("/api/projects/[id]/agents", () => {
  it("lists existing agent definition files", async () => {
    const dir = path.join(root, ".opencode", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "reviewer.md"), "---\nmode: subagent\n---\n");

    const response = await LIST_GET(localRequest("/api/projects/project-1/agents"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      agents: { name: string; relativePath: string; content: string }[];
    };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].name).toBe("reviewer");
    expect(body.agents[0].content).toBe("---\nmode: subagent\n---\n");
  });

  it("creates a new agent via POST", async () => {
    const response = await POST(
      localRequest("/api/projects/project-1/agents", "POST", {
        name: "summarizer",
        content: "---\nmode: subagent\n---\n",
      }),
      { params: Promise.resolve({ id: "project-1" }) },
    );
    expect(response.status).toBe(200);
    expect(
      fs.existsSync(path.join(root, ".opencode", "agents", "summarizer.md")),
    ).toBe(true);
  });

  it("rejects invalid agent names", async () => {
    const response = await POST(
      localRequest("/api/projects/project-1/agents", "POST", {
        name: "../outside",
        content: "no",
      }),
      { params: Promise.resolve({ id: "project-1" }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("/api/projects/[id]/agents/[name]", () => {
  it("reads a specific agent", async () => {
    const dir = path.join(root, ".opencode", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "researcher.md"), "# Researcher\n");

    const response = await GET(
      localRequest("/api/projects/project-1/agents/researcher"),
      { params: Promise.resolve({ id: "project-1", name: "researcher" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { agent: { content: string } };
    expect(body.agent.content).toBe("# Researcher\n");
  });

  it("updates an agent via PUT", async () => {
    const dir = path.join(root, ".opencode", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "planner.md"), "old");

    const response = await PUT(
      localRequest("/api/projects/project-1/agents/planner", "PUT", {
        content: "new content",
      }),
      { params: Promise.resolve({ id: "project-1", name: "planner" }) },
    );
    expect(response.status).toBe(200);
    expect(fs.readFileSync(path.join(dir, "planner.md"), "utf8")).toBe("new content");
  });

  it("deletes an agent via DELETE", async () => {
    const dir = path.join(root, ".opencode", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "temp-agent.md"), "x");

    const response = await DELETE(
      localRequest("/api/projects/project-1/agents/temp-agent", "DELETE"),
      { params: Promise.resolve({ id: "project-1", name: "temp-agent" }) },
    );
    expect(response.status).toBe(200);
    expect(fs.existsSync(path.join(dir, "temp-agent.md"))).toBe(false);
  });
});