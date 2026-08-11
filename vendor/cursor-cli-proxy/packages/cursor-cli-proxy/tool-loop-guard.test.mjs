import assert from "node:assert/strict";
import { test } from "node:test";

const { createToolLoopGuard } = await import("./index.js");

test("allows successful exploration calls up to the exploration limit", () => {
  const maxRepeat = 2;
  const explorationLimit = maxRepeat * 3;
  const guard = createToolLoopGuard([], maxRepeat);
  const toolCall = {
    id: "call-status",
    function: {
      name: "bash",
      arguments: JSON.stringify({ command: "git status --short" }),
    },
  };

  for (let i = 0; i < explorationLimit; i++) {
    assert.equal(
      guard.evaluate(toolCall).triggered,
      false,
      `exploration attempt ${i + 1} should be allowed`,
    );
  }
  assert.equal(guard.evaluate(toolCall).triggered, true);
});

test("blocks repeated successful non-exploration calls after the normal limit", () => {
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
