import { test } from "node:test";
import assert from "node:assert/strict";

const { computeTimeoutMs, isRetryableError, chatCompletionChunks } = await import("./index.mjs");

test("computeTimeoutMs falls back to the default when unset", () => {
  assert.equal(computeTimeoutMs({}), 120_000);
});

test("computeTimeoutMs honors a valid override", () => {
  assert.equal(computeTimeoutMs({ COMMANDCODE_CLI_TIMEOUT_MS: "5000" }), 5000);
});

test("computeTimeoutMs ignores invalid overrides", () => {
  assert.equal(computeTimeoutMs({ COMMANDCODE_CLI_TIMEOUT_MS: "not-a-number" }), 120_000);
  assert.equal(computeTimeoutMs({ COMMANDCODE_CLI_TIMEOUT_MS: "0" }), 120_000);
  assert.equal(computeTimeoutMs({ COMMANDCODE_CLI_TIMEOUT_MS: "-1" }), 120_000);
});

test("isRetryableError matches transient upstream blips", () => {
  assert.equal(isRetryableError("API server encountered an error"), true);
  assert.equal(isRetryableError("please try again later"), true);
  assert.equal(isRetryableError("network error: ECONNRESET"), true);
});

test("isRetryableError does not match timeouts or generic failures", () => {
  // A timeout is our own doing (we killed the process); retrying just makes
  // the caller wait 2x as long for the same hang.
  assert.equal(isRetryableError("CommandCode CLI timed out after 120000ms"), false);
  assert.equal(isRetryableError("aborted"), false);
  assert.equal(isRetryableError("command not found"), false);
  assert.equal(isRetryableError(undefined), false);
});

test("chatCompletionChunks ends the stream with a finish_reason so clients see the turn as complete", () => {
  const chunks = chatCompletionChunks("chatcmpl-1", "hello");
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].choices[0].delta.content, "hello");
  assert.equal(chunks[0].choices[0].finish_reason, null);
  assert.equal(chunks[1].choices[0].finish_reason, "stop");
  assert.deepEqual(chunks[1].choices[0].delta, {});
  for (const chunk of chunks) {
    assert.equal(chunk.id, "chatcmpl-1");
    assert.equal(chunk.object, "chat.completion.chunk");
  }
});
