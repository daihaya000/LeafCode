import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({ existsSync: vi.fn() }));
const openMock = vi.hoisted(() => ({
  openFileReveal: vi.fn(),
  openFolder: vi.fn(),
}));
const syncEngineMock = vi.hoisted(() => ({
  profilePaths: vi.fn(() => ({
    opencode: "C:/profile/opencode.jsonc",
    codex: "C:/home/.codex/config.toml",
    claude: "C:/home/.claude/settings.json",
    cursor: "C:/home/.cursor/mcp.json",
  })),
}));
const agentsSyncEngineMock = vi.hoisted(() => ({
  agentsSyncPaths: vi.fn(() => ({
    masterMd: "C:/home/.config/opencode/AGENTS.md",
    claudeMd: "C:/home/.claude/CLAUDE.md",
    codexMd: "C:/home/.codex/AGENTS.md",
    opencodeSkills: "C:/home/.config/opencode/skills",
    claudeSkills: "C:/home/.claude/skills",
    codexSkills: "C:/home/.codex/skills",
    agentsSkills: "C:/home/.agents/skills",
    cursorMd: "C:/home/.cursor/AGENTS.md",
    cursorSkills: "C:/home/.cursor/skills",
    hermesConfig: "C:/home/.hermes/config.yaml",
  })),
}));

vi.mock("node:fs", () => ({ default: fsMock, ...fsMock }));
vi.mock("@/lib/profiles/open", () => openMock);
vi.mock("@/lib/profiles/sync-engine", () => syncEngineMock);
vi.mock("@/lib/profiles/agents-sync-engine", () => agentsSyncEngineMock);

import { POST } from "./route";

function localPost(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function remotePost(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { host: "192.168.1.50:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReturnValue(true);
});

describe("POST /api/profiles/open-target", () => {
  it("rejects non-local requests", async () => {
    const res = await POST(
      remotePost("http://lan.example.com/api/profiles/open-target", {
        target: "sync-master",
        action: "open-file",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an unknown target", async () => {
    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles/open-target", {
        target: "not-a-real-target",
        action: "open-file",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid action", async () => {
    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles/open-target", {
        target: "sync-master",
        action: "delete",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 when the resolved path does not exist", async () => {
    fsMock.existsSync.mockReturnValue(false);
    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles/open-target", {
        target: "sync-master",
        action: "open-file",
      }),
    );
    expect(res.status).toBe(409);
    expect(openMock.openFileReveal).not.toHaveBeenCalled();
  });

  it("reveals the resolved sync-master path as a file", async () => {
    openMock.openFileReveal.mockReturnValue(null);
    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles/open-target", {
        target: "sync-master",
        action: "open-file",
      }),
    );
    expect(res.status).toBe(200);
    expect(openMock.openFileReveal).toHaveBeenCalledWith("C:/profile/opencode.jsonc");
  });

  it("opens the resolved skills-claude path as a folder", async () => {
    openMock.openFolder.mockReturnValue(null);
    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles/open-target", {
        target: "skills-claude",
        action: "open-folder",
      }),
    );
    expect(res.status).toBe(200);
    expect(openMock.openFolder).toHaveBeenCalledWith("C:/home/.claude/skills");
  });

  it("reveals the resolved agents-hermes path as a file", async () => {
    openMock.openFileReveal.mockReturnValue(null);
    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles/open-target", {
        target: "agents-hermes",
        action: "open-file",
      }),
    );
    expect(res.status).toBe(200);
    expect(openMock.openFileReveal).toHaveBeenCalledWith("C:/home/.hermes/config.yaml");
  });

  it("returns 500 with the underlying error when opening fails", async () => {
    openMock.openFolder.mockReturnValue("boom");
    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles/open-target", {
        target: "skills-opencode",
        action: "open-folder",
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
  });
});
