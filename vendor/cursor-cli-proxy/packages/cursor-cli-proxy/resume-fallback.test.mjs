import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

const {
  createBunChildWithResumeFallback,
  createNodeChildWithResumeFallback,
} = await import("./index.js");

function fakeNodeChild({ stdout = "", stderr = "", code = 0 }) {
  const events = new EventEmitter();
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  queueMicrotask(() => {
    if (stdout) stdoutStream.write(stdout);
    if (stderr) stderrStream.write(stderr);
    stdoutStream.end();
    stderrStream.end();
    events.emit("close", code);
  });
  return {
    stdout: stdoutStream,
    stderr: stderrStream,
    on: events.on.bind(events),
    kill() {},
  };
}

function fakeBunChild({ stdout = "", stderr = "", code = 0 }) {
  const encoder = new TextEncoder();
  const stream = (text) => new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return {
    stdout: stream(stdout),
    stderr: stream(stderr),
    exited: Promise.resolve(code),
    kill() {},
  };
}

test("Node child retries once without resume and with the full prompt", async () => {
  const calls = [];
  const attempts = [
    { stderr: "session not found", code: 1 },
    { stdout: "retry succeeded", code: 0 },
  ];
  let retries = 0;
  const child = createNodeChildWithResumeFallback({
    backend: "cursor-agent",
    model: "auto",
    prompt: "incremental prompt",
    retryPrompt: "full prompt",
    workspaceDirectory: "C:/workspace",
    resumeChatId: "expired-chat",
    onResumeRetry: () => {
      retries += 1;
    },
  }, {
    createChild(input) {
      calls.push(input);
      return fakeNodeChild(attempts[calls.length - 1]);
    },
  });

  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0);
  assert.equal(await stdoutPromise, "retry succeeded");
  assert.equal(await stderrPromise, "");
  assert.equal(retries, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].prompt, "full prompt");
  assert.equal(calls[1].resumeChatId, undefined);
});

test("Node child retries even when resume printed partial stdout", async () => {
  const calls = [];
  const attempts = [
    { stdout: "banner\n", stderr: "session not found", code: 1 },
    { stdout: "retry succeeded", code: 0 },
  ];
  let retries = 0;
  const child = createNodeChildWithResumeFallback({
    backend: "cursor-agent",
    model: "auto",
    prompt: "incremental prompt",
    retryPrompt: "full prompt",
    workspaceDirectory: "C:/workspace",
    resumeChatId: "expired-chat",
    onResumeRetry: () => {
      retries += 1;
    },
  }, {
    createChild(input) {
      calls.push(input);
      return fakeNodeChild(attempts[calls.length - 1]);
    },
  });

  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0);
  assert.equal(await stdoutPromise, "retry succeeded");
  assert.equal(await stderrPromise, "");
  assert.equal(retries, 1);
  assert.equal(calls.length, 2);
});

test("Bun child retries once without resume and with the full prompt", async () => {
  const calls = [];
  const attempts = [
    { stderr: "chat expired", code: 1 },
    { stdout: "retry succeeded", code: 0 },
  ];
  let retries = 0;
  const child = createBunChildWithResumeFallback({
    backend: "cursor-agent",
    model: "auto",
    prompt: "incremental prompt",
    retryPrompt: "full prompt",
    workspaceDirectory: "C:/workspace",
    resumeChatId: "expired-chat",
    onResumeRetry: () => {
      retries += 1;
    },
  }, {
    createChild(input) {
      calls.push(input);
      return fakeBunChild(attempts[calls.length - 1]);
    },
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(code, 0);
  assert.equal(stdout, "retry succeeded");
  assert.equal(stderr, "");
  assert.equal(retries, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].prompt, "full prompt");
  assert.equal(calls[1].resumeChatId, undefined);
});

test("Bun child discards partial resume stdout before retry", async () => {
  const calls = [];
  const attempts = [
    { stdout: "stale banner", stderr: "chat expired", code: 1 },
    { stdout: "retry succeeded", code: 0 },
  ];
  const child = createBunChildWithResumeFallback({
    backend: "cursor-agent",
    model: "auto",
    prompt: "incremental prompt",
    retryPrompt: "full prompt",
    workspaceDirectory: "C:/workspace",
    resumeChatId: "expired-chat",
  }, {
    createChild(input) {
      calls.push(input);
      return fakeBunChild(attempts[calls.length - 1]);
    },
  });

  const [stdout, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  assert.equal(code, 0);
  assert.equal(stdout, "retry succeeded");
  assert.equal(calls.length, 2);
});
