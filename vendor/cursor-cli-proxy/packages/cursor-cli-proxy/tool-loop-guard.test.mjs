import assert from "node:assert/strict";
import { test } from "node:test";

const { createToolLoopGuard } = await import("./index.js");

test("blocks repeated successful exploration calls after the normal limit", () => {
  const guard = createToolLoopGuard([], 2);
  const toolCall = {
    id: "call-status",
    function: {
      name: "bash",
      arguments: JSON.stringify({ command: "git status --short" }),
    },
  };

  assert.equal(guard.evaluate(toolCall).triggered, false);
  assert.equal(guard.evaluate(toolCall).triggered, false);
  assert.equal(guard.evaluate(toolCall).triggered, true);
});
