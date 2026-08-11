import assert from "node:assert/strict";
import { test } from "node:test";

// Unit tests must not hang agent shells forever (default node:test timeout is Infinity).
const TEST_TIMEOUT_MS = 10_000;

const { buildOpenCodeResumeHeaders, recordResumeChatId, resolvePromptForBackend } = await import("./index.js");

const baseInput = {
  backend: "cursor-agent",
  model: "auto",
  tools: [],
  subagentNames: [],
  workspaceDirectory: "C:/cursor-proxy-session-resume-test",
  sessionId: "opencode-session-main",
};

test("enables session resume by default", { timeout: TEST_TIMEOUT_MS }, () => {
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

test("uses an incremental prompt after a captured session id", { timeout: TEST_TIMEOUT_MS }, () => {
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

test("isolates Cursor chat ids by OpenCode session id", { timeout: TEST_TIMEOUT_MS }, () => {
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

test("isolates concurrent title and primary agent resume state", { timeout: TEST_TIMEOUT_MS }, () => {
  const messages = [{ role: "user", content: "Implement the feature" }];
  const titleHeaders = buildOpenCodeResumeHeaders(baseInput.sessionId, "title");
  const primaryHeaders = buildOpenCodeResumeHeaders(baseInput.sessionId, "build");
  const title = resolvePromptForBackend({
    ...baseInput,
    agentFingerprint: titleHeaders["x-opencode-agent-fingerprint"],
    messages,
  });
  const primary = resolvePromptForBackend({
    ...baseInput,
    agentFingerprint: primaryHeaders["x-opencode-agent-fingerprint"],
    messages,
  });

  recordResumeChatId(
    primary.sessionKey,
    "cursor-chat-primary",
    primary.recordContentPrefix,
    primary.toolFingerprint,
    primary.subagentFingerprint,
  );
  // Title generation starts in parallel and can finish after the primary
  // request, so its late result must not overwrite the primary resume state.
  recordResumeChatId(
    title.sessionKey,
    "cursor-chat-title",
    title.recordContentPrefix,
    title.toolFingerprint,
    title.subagentFingerprint,
  );

  const nextPrimary = resolvePromptForBackend({
    ...baseInput,
    agentFingerprint: primaryHeaders["x-opencode-agent-fingerprint"],
    messages: [
      ...messages,
      { role: "assistant", content: "The feature is ready." },
      { role: "user", content: "Now run the tests" },
    ],
  });

  assert.equal(primaryHeaders["x-opencode-session-id"], baseInput.sessionId);
  assert.match(primaryHeaders["x-opencode-agent-fingerprint"], /^[a-f0-9]{32}$/);
  assert.notEqual(titleHeaders["x-opencode-agent-fingerprint"], primaryHeaders["x-opencode-agent-fingerprint"]);
  assert.notEqual(title.sessionKey, primary.sessionKey);
  assert.equal(nextPrimary.resumeChatId, "cursor-chat-primary");
  assert.equal(nextPrimary.usedIncremental, true);
});

test("starts a fresh chat when an image turn cannot be reduced to an incremental prompt", { timeout: TEST_TIMEOUT_MS }, () => {
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

test("does not cache resume state without an OpenCode session id", { timeout: TEST_TIMEOUT_MS }, () => {
  const result = resolvePromptForBackend({
    ...baseInput,
    sessionId: "",
    messages: [{ role: "user", content: "No session identity" }],
  });
  assert.equal(result.sessionKey, undefined);
  assert.equal(result.resumeChatId, undefined);
});

test("allows explicit opt-out of session resume", { timeout: TEST_TIMEOUT_MS }, () => {
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
