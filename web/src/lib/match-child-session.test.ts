import { describe, expect, it } from "vitest";
import {
  collectTaskCallIds,
  extractSessionIdFromMetadata,
  isTaskToolName,
  matchChildSession,
  messageHasTimelineParts,
} from "./match-child-session";

describe("isTaskToolName", () => {
  it("matches task tools", () => {
    expect(isTaskToolName("task")).toBe(true);
    expect(isTaskToolName("Task")).toBe(true);
    expect(isTaskToolName("call_task_tool")).toBe(true);
    expect(isTaskToolName("bash")).toBe(false);
  });
});

describe("extractSessionIdFromMetadata", () => {
  it("reads common session id keys", () => {
    expect(extractSessionIdFromMetadata({ sessionID: "s1" })).toBe("s1");
    expect(extractSessionIdFromMetadata({ sessionId: "s2" })).toBe("s2");
    expect(extractSessionIdFromMetadata({ session_id: "s3" })).toBe("s3");
    expect(extractSessionIdFromMetadata({ nested: { sessionID: "no" } })).toBe(
      null,
    );
    expect(extractSessionIdFromMetadata(null)).toBe(null);
  });
});

describe("collectTaskCallIds", () => {
  it("collects task callIDs in appearance order", () => {
    const ids = collectTaskCallIds([
      {
        parts: [
          { type: "text", text: "hi" },
          { type: "tool", tool: "bash", callID: "b1" },
          { type: "tool", tool: "task", callID: "t1" },
        ],
      },
      {
        parts: [{ type: "tool", tool: "call_task", callID: "t2" }],
      },
    ]);
    expect(ids).toEqual(["t1", "t2"]);
  });
});

describe("matchChildSession", () => {
  const children = [
    { id: "c-aaa", title: "Explore auth" },
    { id: "c-bbb", title: "Write tests" },
  ];

  it("prefers sticky id when still present", () => {
    expect(
      matchChildSession(
        children,
        {
          callID: "t1",
          siblingTaskCallIds: ["t1", "t2"],
          input: { description: "Write tests" },
        },
        "c-aaa",
      ),
    ).toBe("c-aaa");
  });

  it("prefers explicit metadata over sticky id", () => {
    expect(
      matchChildSession(
        children,
        {
          callID: "t1",
          siblingTaskCallIds: ["t1", "t2"],
          metadata: { sessionID: "c-bbb" },
        },
        "c-aaa",
      ),
    ).toBe("c-bbb");
  });

  it("matches explicit metadata session id", () => {
    expect(
      matchChildSession(children, {
        callID: "t2",
        siblingTaskCallIds: ["t1", "t2"],
        metadata: { sessionID: "c-bbb" },
      }),
    ).toBe("c-bbb");
  });

  it("matches unique title from description", () => {
    expect(
      matchChildSession(children, {
        callID: "t1",
        siblingTaskCallIds: ["t1", "t2"],
        input: { description: "Write tests" },
      }),
    ).toBe("c-bbb");
  });

  it("does not guess from sibling index when title is ambiguous", () => {
    expect(
      matchChildSession(children, {
        callID: "t1",
        siblingTaskCallIds: ["t1", "t2"],
        input: { description: "Ambiguous" },
      }),
    ).toBe(null);
    expect(
      matchChildSession(children, {
        callID: "t2",
        siblingTaskCallIds: ["t1", "t2"],
        input: { description: "Ambiguous" },
      }),
    ).toBe(null);
  });

  it("returns the sole child when no metadata/title match", () => {
    expect(
      matchChildSession([{ id: "only" }], {
        callID: "t1",
        siblingTaskCallIds: ["t1"],
      }),
    ).toBe("only");
  });

  it("returns null when unresolved", () => {
    expect(
      matchChildSession([], {
        callID: "t1",
        siblingTaskCallIds: ["t1"],
      }),
    ).toBe(null);
  });
});

describe("messageHasTimelineParts", () => {
  it("detects renderable parts", () => {
    expect(
      messageHasTimelineParts([
        { type: "step-start" },
        { type: "tool" },
      ]),
    ).toBe(true);
    expect(
      messageHasTimelineParts([
        { type: "step-finish" },
      ]),
    ).toBe(false);
  });
});
