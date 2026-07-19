import { describe, expect, it } from "vitest";
import {
  SSE_HEARTBEAT_MS,
  SSE_SILENCE_MS,
  encodeSseHeartbeat,
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
});
