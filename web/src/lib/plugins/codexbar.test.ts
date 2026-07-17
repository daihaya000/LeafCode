import { describe, expect, it } from "vitest";
import {
  clampPercent,
  emptyUsage,
  formatResetsIn,
  parseCodexBarSnapshot,
  providerLabel,
  usageTone,
  worstProvider,
} from "./codexbar";

const SAMPLE = {
  schema: "codexbar.usage-snapshot/v1",
  generatedAt: "2026-07-17T03:34:32.55Z",
  providers: [
    {
      opencodeProviderId: "openai",
      codexBarProviderId: "codex",
      usedPercent: 1,
      limited: false,
      maxed: false,
      resetsAt: "2026-07-24T01:44:16Z",
      updatedAt: "2026-07-17T03:34:32Z",
    },
    {
      opencodeProviderId: "cursor-acp",
      codexBarProviderId: "cursor",
      usedPercent: 100,
      limited: true,
      maxed: true,
      resetsAt: "2026-07-18T05:47:03Z",
      updatedAt: "2026-07-17T03:34:31Z",
    },
  ],
};

describe("parseCodexBarSnapshot", () => {
  it("parses a valid snapshot", () => {
    const u = parseCodexBarSnapshot(SAMPLE);
    expect(u.available).toBe(true);
    expect(u.schema).toBe("codexbar.usage-snapshot/v1");
    expect(u.providers).toHaveLength(2);
    expect(u.providers[0]).toMatchObject({
      id: "codex",
      opencodeId: "openai",
      usedPercent: 1,
      limited: false,
      maxed: false,
    });
    expect(u.providers[1]).toMatchObject({ id: "cursor", limited: true, maxed: true });
  });

  it("derives limited/maxed from usedPercent when flags absent", () => {
    const u = parseCodexBarSnapshot({
      providers: [{ codexBarProviderId: "claude", usedPercent: 95 }],
    });
    expect(u.providers[0].limited).toBe(true);
    expect(u.providers[0].maxed).toBe(false);
    const u2 = parseCodexBarSnapshot({
      providers: [{ codexBarProviderId: "claude", usedPercent: 99.9 }],
    });
    expect(u2.providers[0].maxed).toBe(true);
  });

  it("falls back to opencode id and 'unknown' for the provider id", () => {
    expect(parseCodexBarSnapshot({ providers: [{ opencodeProviderId: "foo" }] }).providers[0].id).toBe("foo");
    expect(parseCodexBarSnapshot({ providers: [{}] }).providers[0].id).toBe("unknown");
  });

  it("captures error and keeps usedPercent null", () => {
    const u = parseCodexBarSnapshot({
      providers: [{ codexBarProviderId: "ollama", error: "timeout" }],
    });
    expect(u.providers[0].error).toBe("timeout");
    expect(u.providers[0].usedPercent).toBeNull();
  });

  it("returns unavailable for non-objects and missing providers", () => {
    expect(parseCodexBarSnapshot(null).available).toBe(false);
    expect(parseCodexBarSnapshot("x").available).toBe(false);
    expect(parseCodexBarSnapshot({}).available).toBe(false);
    expect(parseCodexBarSnapshot({ providers: "nope" }).available).toBe(false);
  });

  it("skips non-object provider entries", () => {
    const u = parseCodexBarSnapshot({ providers: [null, 3, { codexBarProviderId: "codex" }] });
    expect(u.providers).toHaveLength(1);
    expect(u.providers[0].id).toBe("codex");
  });
});

describe("emptyUsage", () => {
  it("carries the reason and is unavailable", () => {
    const u = emptyUsage("nope");
    expect(u).toMatchObject({ available: false, reason: "nope", providers: [] });
  });
});

describe("providerLabel", () => {
  it("maps known ids and title-cases unknown ones", () => {
    expect(providerLabel("codex")).toBe("Codex");
    expect(providerLabel("opencode-go")).toBe("OpenCode");
    expect(providerLabel("mystery")).toBe("Mystery");
    expect(providerLabel("")).toBe("Unknown");
  });
});

describe("usageTone", () => {
  it("prioritizes error, then maxed/limited, then thresholds", () => {
    expect(usageTone({ usedPercent: 10, limited: false, maxed: false, error: "x" })).toBe("danger");
    expect(usageTone({ usedPercent: 10, limited: true, maxed: false, error: null })).toBe("danger");
    expect(usageTone({ usedPercent: 80, limited: false, maxed: false, error: null })).toBe("warn");
    expect(usageTone({ usedPercent: 20, limited: false, maxed: false, error: null })).toBe("ok");
    expect(usageTone({ usedPercent: null, limited: false, maxed: false, error: null })).toBe("ok");
  });
});

describe("clampPercent", () => {
  it("clamps to 0..100 and handles null/NaN", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(null)).toBe(0);
    expect(clampPercent(NaN)).toBe(0);
  });
});

describe("formatResetsIn", () => {
  const now = Date.parse("2026-07-17T00:00:00Z");
  it("formats minutes/hours/days and handles edges", () => {
    expect(formatResetsIn(null, now)).toBeNull();
    expect(formatResetsIn("not-a-date", now)).toBeNull();
    expect(formatResetsIn("2026-07-16T23:00:00Z", now)).toBe("まもなく");
    expect(formatResetsIn("2026-07-17T00:30:00Z", now)).toBe("30分後");
    expect(formatResetsIn("2026-07-17T05:00:00Z", now)).toBe("5時間後");
    expect(formatResetsIn("2026-07-19T00:00:00Z", now)).toBe("2日後");
    expect(formatResetsIn("2026-07-19T03:00:00Z", now)).toBe("2日3時間後");
  });
});

describe("worstProvider", () => {
  it("returns the highest usage or the first errored provider", () => {
    const u = parseCodexBarSnapshot(SAMPLE);
    expect(worstProvider(u)?.id).toBe("cursor");
    expect(worstProvider(emptyUsage("x"))).toBeNull();
    const withErr = parseCodexBarSnapshot({
      providers: [{ codexBarProviderId: "a", usedPercent: 10 }, { codexBarProviderId: "b", error: "boom" }],
    });
    expect(worstProvider(withErr)?.id).toBe("b");
  });
});
