import { describe, expect, it } from "vitest";
import { extractSessionTouchedPaths } from "./session-touched-files";
import type { MessageWithParts } from "./types";

const DIR = "C:\\repo\\project";

function toolMsg(id: string, input: Record<string, unknown>): MessageWithParts {
  return {
    info: { id, role: "assistant" },
    parts: [
      {
        id: `${id}-p1`,
        messageID: id,
        type: "tool",
        tool: "edit",
        state: { status: "completed", input },
      },
    ],
  };
}

describe("extractSessionTouchedPaths", () => {
  it("extracts a repo-relative path from an absolute filePath input", () => {
    const messages = [toolMsg("m1", { filePath: "C:\\repo\\project\\web\\src\\a.ts" })];
    const touched = extractSessionTouchedPaths(messages, DIR);
    expect(touched.has("web/src/a.ts")).toBe(true);
  });

  it("falls back to file_path and path fields", () => {
    const messages = [
      toolMsg("m1", { file_path: `${DIR}\\b.ts` }),
      toolMsg("m2", { path: `${DIR}\\c.ts` }),
    ];
    const touched = extractSessionTouchedPaths(messages, DIR);
    expect(touched.has("b.ts")).toBe(true);
    expect(touched.has("c.ts")).toBe(true);
  });

  it("ignores non-tool parts and tool calls without a path field", () => {
    const messages: MessageWithParts[] = [
      { info: { id: "m1", role: "assistant" }, parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }] },
      toolMsg("m2", { command: "npm test" }),
    ];
    expect(extractSessionTouchedPaths(messages, DIR).size).toBe(0);
  });

  it("returns an empty set when directory is empty", () => {
    const messages = [toolMsg("m1", { filePath: "C:\\repo\\project\\a.ts" })];
    expect(extractSessionTouchedPaths(messages, "").size).toBe(0);
  });

  it("collects paths across multiple messages", () => {
    const messages = [
      toolMsg("m1", { filePath: `${DIR}\\a.ts` }),
      toolMsg("m2", { filePath: `${DIR}\\sub\\b.ts` }),
    ];
    const touched = extractSessionTouchedPaths(messages, DIR);
    expect([...touched].sort()).toEqual(["a.ts", "sub/b.ts"]);
  });
});
