import assert from "node:assert/strict";
import { test } from "node:test";

const { recordResumeChatId, resolvePromptForBackend } = await import("./index.js");

const baseInput = {
  backend: "cursor-agent",
  model: "auto",
  tools: [],
  subagentNames: [],
  workspaceDirectory: "C:/cursor-proxy-session-resume-test",
  sessionId: "opencode-session-main",
};

test("enables session resume by default", () => {
  const previous = process.env.CURSOR_ACP_SESSION_RESUME;
  delete process.env.CURSOR_ACP_SESSION_RESUME;
  try {
    const result = resolvePromptForBackend({
      ...baseInput,
      model: "auto-default",
      messages: [{ role: "user", content: "Use the default resume policy" }],
    });
    assert.ok(result.sessionKey);
    assert.equal(result.usedIncremental, false);
  } finally {
    if (previous === undefined) delete process.env.CURSOR_ACP_SESSION_RESUME;
    else process.env.CURSOR_ACP_SESSION_RESUME = previous;
  }
});

test("uses an incremental prompt after a captured session id", () => {
  const previous = process.env.CURSOR_ACP_SESSION_RESUME;
  process.env.CURSOR_ACP_SESSION_RESUME = "true";
  try {
    const first = resolvePromptForBackend({
      ...baseInput,
      messages: [{ role: "user", content: "Implement the feature" }],
    });
    assert.equal(first.usedIncremental, false);
    assert.ok(first.sessionKey);

    recordResumeChatId(
      first.sessionKey,
      "chat-session-resume-test",
      first.recordContentPrefix,
      first.toolFingerprint,
      first.subagentFingerprint,
    );

    const next = resolvePromptForBackend({
      ...baseInput,
      messages: [
        { role: "user", content: "Implement the feature" },
        { role: "assistant", content: "The feature is ready." },
        { role: "user", content: "Now run the tests" },
      ],
    });
    assert.equal(next.usedIncremental, true);
    assert.equal(next.resumeChatId, "chat-session-resume-test");
    assert.equal(next.prompt, "Now run the tests");
  } finally {
    if (previous === undefined) delete process.env.CURSOR_ACP_SESSION_RESUME;
    else process.env.CURSOR_ACP_SESSION_RESUME = previous;
  }
});

test("isolates Cursor chat ids by OpenCode session id", () => {
  const first = resolvePromptForBackend({
    ...baseInput,
    sessionId: "opencode-session-a",
    messages: [{ role: "user", content: "Review this workspace" }],
  });
  recordResumeChatId(
    first.sessionKey,
    "cursor-chat-a",
    first.recordContentPrefix,
    first.toolFingerprint,
    first.subagentFingerprint,
  );

  const otherSession = resolvePromptForBackend({
    ...baseInput,
    sessionId: "opencode-session-b",
    messages: [{ role: "user", content: "Review this workspace" }],
  });
  assert.notEqual(otherSession.sessionKey, first.sessionKey);
  assert.equal(otherSession.resumeChatId, undefined);
  assert.equal(otherSession.usedIncremental, false);
});

test("starts a fresh chat when an image turn cannot be reduced to an incremental prompt", () => {
  const first = resolvePromptForBackend({
    ...baseInput,
    sessionId: "opencode-session-image",
    messages: [{ role: "user", content: "Inspect the image" }],
  });
  recordResumeChatId(
    first.sessionKey,
    "cursor-chat-image",
    first.recordContentPrefix,
    first.toolFingerprint,
    first.subagentFingerprint,
  );

  const next = resolvePromptForBackend({
    ...baseInput,
    sessionId: "opencode-session-image",
    messages: [
      { role: "user", content: "Inspect the image" },
      { role: "assistant", content: "Send the next image." },
      {
        role: "user",
        content: [
          { type: "text", text: "Here it is" },
          { type: "image_url", image_url: { url: "https://example.test/image.png" } },
        ],
      },
    ],
  });
  assert.equal(next.resumeChatId, undefined);
  assert.equal(next.usedIncremental, false);
  assert.match(next.prompt, /ASSISTANT: Send the next image\./);
});

test("does not cache resume state without an OpenCode session id", () => {
  const result = resolvePromptForBackend({
    ...baseInput,
    sessionId: "",
    messages: [{ role: "user", content: "No session identity" }],
  });
  assert.equal(result.sessionKey, undefined);
  assert.equal(result.resumeChatId, undefined);
});

test("allows explicit opt-out of session resume", () => {
  const previous = process.env.CURSOR_ACP_SESSION_RESUME;
  process.env.CURSOR_ACP_SESSION_RESUME = "false";
  try {
    const result = resolvePromptForBackend({
      ...baseInput,
      messages: [{ role: "user", content: "Keep the full prompt" }],
    });
    assert.equal(result.usedIncremental, false);
    assert.equal(result.sessionKey, undefined);
  } finally {
    if (previous === undefined) delete process.env.CURSOR_ACP_SESSION_RESUME;
    else process.env.CURSOR_ACP_SESSION_RESUME = previous;
  }
});
