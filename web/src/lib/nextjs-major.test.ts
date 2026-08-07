import { describe, expect, it } from "vitest";
import { installSpecForMajor, latestInMajor, majorOf } from "./nextjs-major";

describe("majorOf", () => {
  it("reads the major from plain and ranged versions", () => {
    expect(majorOf("15.5.20")).toBe(15);
    expect(majorOf("^16.3.0")).toBe(16);
    expect(majorOf("v15.0.0-canary.1")).toBe(15);
  });

  it("returns undefined for missing or unparsable input", () => {
    expect(majorOf(undefined)).toBeUndefined();
    expect(majorOf("")).toBeUndefined();
    expect(majorOf("latest")).toBeUndefined();
  });
});

describe("installSpecForMajor", () => {
  it("pins npm to the major so it cannot resolve the next one", () => {
    expect(installSpecForMajor(15)).toBe("next@15");
  });
});

describe("latestInMajor", () => {
  const versions = [
    "14.2.0",
    "15.5.20",
    "15.6.0",
    "15.6.1-canary.3",
    "15.10.0",
    "16.0.0",
    "16.3.0",
  ];

  it("picks the highest stable release inside the major", () => {
    expect(latestInMajor(versions, 15)).toBe("15.10.0");
    expect(latestInMajor(versions, 16)).toBe("16.3.0");
  });

  it("compares numerically, not lexically", () => {
    expect(latestInMajor(["15.9.0", "15.10.0"], 15)).toBe("15.10.0");
  });

  it("returns undefined when the major has no stable release", () => {
    expect(latestInMajor(versions, 17)).toBeUndefined();
    expect(latestInMajor(["17.0.0-canary.1"], 17)).toBeUndefined();
  });
});
