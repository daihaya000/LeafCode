import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  clampThreshold,
  DEFAULT_TOKEN_SAVING_MODE,
  DEFAULT_TOKEN_SAVING_THRESHOLD,
  isTokenSavingMode,
  MAX_TOKEN_SAVING_THRESHOLD,
  MIN_TOKEN_SAVING_THRESHOLD,
  readTokenSavingMode,
  readTokenSavingThreshold,
  shouldAutoCompact,
  tokenSavingModeLabel,
  writeTokenSavingMode,
  writeTokenSavingThreshold,
} = await import("./token-saving-settings");

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("isTokenSavingMode", () => {
  it("accepts the three valid modes", () => {
    expect(isTokenSavingMode("off")).toBe(true);
    expect(isTokenSavingMode("suggest")).toBe(true);
    expect(isTokenSavingMode("auto")).toBe(true);
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isTokenSavingMode("on")).toBe(false);
    expect(isTokenSavingMode(42)).toBe(false);
    expect(isTokenSavingMode(null)).toBe(false);
    expect(isTokenSavingMode(undefined)).toBe(false);
  });
});

describe("clampThreshold", () => {
  it("returns the default for non-finite values", () => {
    expect(clampThreshold(NaN)).toBe(DEFAULT_TOKEN_SAVING_THRESHOLD);
    expect(clampThreshold(Infinity)).toBe(DEFAULT_TOKEN_SAVING_THRESHOLD);
  });

  it("clamps below the minimum", () => {
    expect(clampThreshold(10)).toBe(MIN_TOKEN_SAVING_THRESHOLD);
    expect(clampThreshold(0)).toBe(MIN_TOKEN_SAVING_THRESHOLD);
  });

  it("clamps above the maximum", () => {
    expect(clampThreshold(99)).toBe(MAX_TOKEN_SAVING_THRESHOLD);
    expect(clampThreshold(200)).toBe(MAX_TOKEN_SAVING_THRESHOLD);
  });

  it("rounds to the nearest integer within range", () => {
    expect(clampThreshold(80.4)).toBe(80);
    expect(clampThreshold(80.6)).toBe(81);
    expect(clampThreshold(75)).toBe(75);
  });
});

describe("readTokenSavingMode", () => {
  it("defaults to off when nothing is stored", () => {
    expect(readTokenSavingMode()).toBe(DEFAULT_TOKEN_SAVING_MODE);
    expect(DEFAULT_TOKEN_SAVING_MODE).toBe("off");
  });

  it("reads a stored valid mode", () => {
    localStorage.setItem("webui:token-saving", "auto");
    expect(readTokenSavingMode()).toBe("auto");
  });

  it("falls back to off for a corrupted value", () => {
    localStorage.setItem("webui:token-saving", "bogus");
    expect(readTokenSavingMode()).toBe("off");
  });
});

describe("writeTokenSavingMode", () => {
  it("writes the mode to localStorage", () => {
    writeTokenSavingMode("suggest");
    expect(localStorage.getItem("webui:token-saving")).toBe("suggest");
  });

  it("dispatches a custom event", () => {
    const listener = vi.fn();
    window.addEventListener("webui:token-saving", listener);
    writeTokenSavingMode("auto");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("webui:token-saving", listener);
  });
});

describe("readTokenSavingThreshold", () => {
  it("defaults to 80 when nothing is stored", () => {
    expect(readTokenSavingThreshold()).toBe(DEFAULT_TOKEN_SAVING_THRESHOLD);
    expect(DEFAULT_TOKEN_SAVING_THRESHOLD).toBe(80);
  });

  it("reads a stored valid threshold", () => {
    localStorage.setItem("webui:token-saving-threshold", "85");
    expect(readTokenSavingThreshold()).toBe(85);
  });

  it("clamps a stored out-of-range threshold", () => {
    localStorage.setItem("webui:token-saving-threshold", "10");
    expect(readTokenSavingThreshold()).toBe(MIN_TOKEN_SAVING_THRESHOLD);
  });
});

describe("writeTokenSavingThreshold", () => {
  it("writes the clamped threshold to localStorage", () => {
    writeTokenSavingThreshold(99);
    expect(localStorage.getItem("webui:token-saving-threshold")).toBe(
      String(MAX_TOKEN_SAVING_THRESHOLD),
    );
  });
});

describe("tokenSavingModeLabel", () => {
  it("returns Japanese labels for each mode", () => {
    expect(tokenSavingModeLabel("off")).toBe("オフ");
    expect(tokenSavingModeLabel("suggest")).toBe("提案");
    expect(tokenSavingModeLabel("auto")).toBe("自動");
  });
});

describe("shouldAutoCompact", () => {
  const base = {
    mode: "auto" as const,
    usagePct: 80,
    threshold: 80,
    sessionIdle: true,
    hasPendingInput: false,
    now: 100_000,
    cooldownUntil: 0,
  };

  it("allows auto compact at or above the threshold", () => {
    expect(shouldAutoCompact(base)).toBe(true);
    expect(shouldAutoCompact({ ...base, usagePct: 90 })).toBe(true);
  });

  it("does not compact below the threshold or in non-auto modes", () => {
    expect(shouldAutoCompact({ ...base, usagePct: 79 })).toBe(false);
    expect(shouldAutoCompact({ ...base, mode: "suggest" })).toBe(false);
    expect(shouldAutoCompact({ ...base, mode: "off" })).toBe(false);
  });

  it("does not compact while busy or awaiting input", () => {
    expect(shouldAutoCompact({ ...base, sessionIdle: false })).toBe(false);
    expect(shouldAutoCompact({ ...base, hasPendingInput: true })).toBe(false);
  });

  it("respects cooldown", () => {
    expect(shouldAutoCompact({ ...base, cooldownUntil: 100_001 })).toBe(false);
    expect(shouldAutoCompact({ ...base, cooldownUntil: 100_000 })).toBe(true);
  });

  it("clamps an invalid threshold before comparing", () => {
    expect(shouldAutoCompact({ ...base, threshold: 5, usagePct: 70 })).toBe(true);
    expect(shouldAutoCompact({ ...base, threshold: 99, usagePct: 95 })).toBe(true);
    expect(shouldAutoCompact({ ...base, threshold: 99, usagePct: 94 })).toBe(false);
  });
});
