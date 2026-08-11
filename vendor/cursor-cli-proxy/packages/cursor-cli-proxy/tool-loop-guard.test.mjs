import assert from "node:assert/strict";
import { test } from "node:test";

// Unit tests must not hang agent shells forever (default node:test timeout is Infinity).
const TEST_TIMEOUT_MS = 10_000;

const { createToolLoopGuard } = await import("./index.js");

function call(name, args, id = `${name}-${JSON.stringify(args)}`) {
  return {
    id,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

test("blocks consecutive git status variants as the same exploration intent", { timeout: TEST_TIMEOUT_MS }, () => {
  const guard = createToolLoopGuard([], 2);
  assert.equal(guard.evaluate(call("bash", { command: "git status --short" })).triggered, false);
  assert.equal(guard.evaluate(call("bash", { command: "git status -sb" })).triggered, false);
  assert.equal(
    guard.evaluate(call("shell", { command: "cd C:/workspace && git status --short && git diff --stat" })).triggered,
    true,
  );
});

test("resets a successful repetition streak after a different tool intent", { timeout: TEST_TIMEOUT_MS }, () => {
  const guard = createToolLoopGuard([], 2);
  const status = call("bash", { command: "git status --short" });
  assert.equal(guard.evaluate(status).triggered, false);
  assert.equal(guard.evaluate(status).triggered, false);
  assert.equal(guard.evaluate(call("read", { path: "src/index.ts" })).triggered, false);
  assert.equal(guard.evaluate(status).triggered, false);
});

test("does not carry successful repeats across a new user turn", { timeout: TEST_TIMEOUT_MS }, () => {
  const messages = [
    { role: "user", content: "First task" },
    { role: "assistant", tool_calls: [call("bash", { command: "git status --short" }, "old-status")] },
    { role: "tool", tool_call_id: "old-status", content: "On branch main" },
    { role: "assistant", content: "Finished." },
    { role: "user", content: "Second task" },
  ];
  const guard = createToolLoopGuard(messages, 2);
  assert.equal(guard.evaluate(call("bash", { command: "git status -sb" })).triggered, false);
});

test("blocks repeated successful non-exploration calls after the normal limit", { timeout: TEST_TIMEOUT_MS }, () => {
  const guard = createToolLoopGuard([], 2);
  const toolCall = {
    id: "call-edit",
    function: {
      name: "edit",
      arguments: JSON.stringify({ path: "a.ts", old: "x", new: "y" }),
    },
  };

  assert.equal(guard.evaluate(toolCall).triggered, false);
  assert.equal(guard.evaluate(toolCall).triggered, false);
  assert.equal(guard.evaluate(toolCall).triggered, true);
});
