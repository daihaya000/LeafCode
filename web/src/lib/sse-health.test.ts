import { describe, expect, it } from "vitest";
import {
  SSE_CONNECT_STALL_MS,
  SSE_HEARTBEAT_MS,
  SSE_SILENCE_MS,
  SSE_UPSTREAM_CONNECT_TIMEOUT_MS,
  encodeSseHeartbeat,
  isSseConnectStalled,
  isSseSilent,
  shouldPollWhileVisible,
} from "./sse-health";

describe("sse-health", () => {
  it("treats silence past the threshold as dead", () => {
    expect(isSseSilent(0, SSE_SILENCE_MS - 1)).toBe(false);
    expect(isSseSilent(0, SSE_SILENCE_MS)).toBe(true);
    expect(isSseSilent(1000, 1000 + SSE_SILENCE_MS)).toBe(true);
  });

  it("keeps heartbeat interval under silence threshold", () => {
    expect(SSE_HEARTBEAT_MS).toBeLessThan(SSE_SILENCE_MS);
    expect(SSE_SILENCE_MS / SSE_HEARTBEAT_MS).toBeGreaterThanOrEqual(2);
  });

  it("encodes a named heartbeat event for EventSource listeners", () => {
    expect(encodeSseHeartbeat()).toBe("event: heartbeat\ndata: {}\n\n");
  });

  it("only allows nested polling when the document is visible", () => {
    expect(shouldPollWhileVisible("visible")).toBe(true);
    expect(shouldPollWhileVisible("hidden")).toBe(false);
    expect(shouldPollWhileVisible("prerender")).toBe(false);
  });

  it("treats a connect attempt past the threshold as stalled", () => {
    expect(isSseConnectStalled(0, SSE_CONNECT_STALL_MS - 1)).toBe(false);
    expect(isSseConnectStalled(0, SSE_CONNECT_STALL_MS)).toBe(true);
    expect(isSseConnectStalled(1000, 1000 + SSE_CONNECT_STALL_MS)).toBe(true);
  });

  it("lets the BFF's upstream connect timeout fire before the client gives up", () => {
    // The BFF must be the one to turn a stalled engine into an error response;
    // the client-side guard only catches a wedged connection the BFF cannot see.
    expect(SSE_UPSTREAM_CONNECT_TIMEOUT_MS).toBeLessThan(SSE_CONNECT_STALL_MS);
  });

  it("keeps the upstream connect timeout inside the route's maxDuration", () => {
    // app/api/opencode/[...path]/route.ts `maxDuration` is at least 300s.
    expect(SSE_UPSTREAM_CONNECT_TIMEOUT_MS).toBeLessThan(300_000);
    expect(SSE_UPSTREAM_CONNECT_TIMEOUT_MS).toBeGreaterThan(SSE_HEARTBEAT_MS);
  });
});
