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

import { GET, PATCH } from "./route";

let root: string;

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

function localRequest(method = "GET", body?: unknown) {
  return new NextRequest("http://127.0.0.1:3000/api/projects/project-1/settings", {
    method,
    headers: { host: "127.0.0.1:3000" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "project-settings-"));
  h.project = { id: "project-1", name: "Fixture", root_path: root };
});

afterEach(() => {
  h.project = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("/api/projects/[id]/settings", () => {
  it("lists existing and creatable project setting files", async () => {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Project instructions\n");

    const response = await GET(localRequest(), context());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: { name: string };
      files: { key: string; exists: boolean; content: string }[];
    };
    expect(body.project.name).toBe("Fixture");
    expect(body.files.find((file) => file.key === "AGENTS.md")).toMatchObject({
      exists: true,
      content: "# Project instructions\n",
    });
    expect(body.files.find((file) => file.key === "CLAUDE.md")).toMatchObject({
      exists: false,
      content: "",
    });
  });

  it("creates nested allowlisted files", async () => {
    const response = await PATCH(
      localRequest("PATCH", {
        file: ".github/copilot-instructions.md",
        content: "Use strict TypeScript.\n",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(
      fs.readFileSync(path.join(root, ".github", "copilot-instructions.md"), "utf8"),
    ).toBe("Use strict TypeScript.\n");
  });

  it("rejects arbitrary paths and oversized content", async () => {
    const traversal = await PATCH(
      localRequest("PATCH", { file: "../outside.md", content: "no" }),
      context(),
    );
    expect(traversal.status).toBe(400);

    const oversized = await PATCH(
      localRequest("PATCH", { file: "AGENTS.md", content: "x".repeat(2 * 1024 * 1024 + 1) }),
      context(),
    );
    expect(oversized.status).toBe(413);
  });

  it("returns 404 for an unknown project", async () => {
    h.project = undefined;
    expect((await GET(localRequest(), context("missing"))).status).toBe(404);
  });
});
