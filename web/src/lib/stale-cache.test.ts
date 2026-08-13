import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  invalidatePrefix,
  policyForPath,
  readCached,
  resetStaleCacheForTests,
  writeCache,
} from "./stale-cache";

describe("policyForPath", () => {
  it("returns a policy for cached read-only endpoints", () => {
    expect(policyForPath("/api/projects")).toBeDefined();
    expect(policyForPath("/api/projects/archived")).toBeDefined();
    expect(policyForPath("/api/projects/p1/settings")).toBeDefined();
    expect(policyForPath("/api/settings/webui.some.key")).toBeDefined();
    expect(policyForPath("/api/workspaces")).toBeDefined();
    expect(policyForPath("/api/analytics/model-ranking")).toBeDefined();
    expect(policyForPath("/api/opencode/provider")).toBeDefined();
    expect(policyForPath("/api/extensions/agents")).toBeDefined();
    expect(policyForPath("/api/extensions/plugins/p1")).toBeDefined();
    expect(policyForPath("/api/auth/config")).toBeDefined();
    expect(policyForPath("/api/health")).toBeDefined();
  });

  it("stays undefined for dynamic endpoints", () => {
    expect(policyForPath("/api/tasks")).toBeUndefined();
    expect(policyForPath("/api/tasks/p1/workflow")).toBeUndefined();
    expect(policyForPath("/api/tasks/p1/cost")).toBeUndefined();
    expect(policyForPath("/api/access")).toBeUndefined();
    expect(policyForPath("/api/auth/session")).toBeUndefined();
    expect(policyForPath("/api/git/branches")).toBeUndefined();
    expect(policyForPath("/api/browse/dirs")).toBeUndefined();
    expect(policyForPath("/api/files/content")).toBeUndefined();
    expect(policyForPath("/api/updates/status")).toBeUndefined();
    expect(policyForPath("/api/addons/codexbar/usage")).toBeUndefined();
  });

  it("excludes dynamic sub-paths of cached prefixes", () => {
    expect(policyForPath("/api/profiles/jobs/j1")).toBeUndefined();
    expect(policyForPath("/api/profiles")).toBeDefined();
    expect(policyForPath("/api/profiles/settings")).toBeDefined();
    expect(policyForPath("/api/extensions/agent-files/a1")).toBeUndefined();
    expect(policyForPath("/api/extensions/skills/s1")).toBeDefined();
  });
});

describe("readCached / writeCache", () => {
  const policy = { freshMs: 30_000, staleMs: 600_000, persist: false };

  beforeEach(() => {
    localStorage.clear();
    resetStaleCacheForTests()
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns written entries and drops expired ones", () => {
    writeCache("http://localhost/api/projects", { projects: [] }, policy);
    expect(readCached("http://localhost/api/projects", policy)).toEqual({
      data: { projects: [] },
      at: expect.any(Number),
    });
  });

  it("returns undefined for unknown keys", () => {
    expect(readCached("http://localhost/api/projects", policy)).toBeUndefined();
  });

  it("does not write undefined payloads", () => {
    writeCache("http://localhost/api/health", undefined, policy);
    expect(readCached("http://localhost/api/health", policy)).toBeUndefined();
  });
});

describe("persistence", () => {
  const policy = { freshMs: 30_000, staleMs: 600_000, persist: true };

  beforeEach(() => {
    localStorage.clear();
    invalidatePrefix("/");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("restores persisted entries into memory on read", () => {
    writeCache("http://localhost/api/workspaces", { workspaces: [] }, policy);
    expect(readCached("http://localhost/api/workspaces", policy)).toBeDefined();
  });

  it("skips corrupt persisted entries", () => {
    localStorage.setItem("webui.stale-cache.v1.http://localhost/api/x", "{nope");
    expect(readCached("http://localhost/api/x", policy)).toBeUndefined();
  });
});

describe("invalidatePrefix", () => {
  const policy = { freshMs: 30_000, staleMs: 600_000, persist: true };

  beforeEach(() => {
    localStorage.clear();
    invalidatePrefix("/");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("drops memory and persisted entries sharing the prefix", () => {
    writeCache("http://localhost/api/projects", { projects: [] }, policy);
    writeCache("http://localhost/api/projects/archived", { projects: [] }, policy);
    writeCache("http://localhost/api/workspaces", { workspaces: [] }, policy);

    invalidatePrefix("/api/projects");

    expect(readCached("http://localhost/api/projects", policy)).toBeUndefined();
    expect(
      readCached("http://localhost/api/projects/archived", policy),
    ).toBeUndefined();
    expect(readCached("http://localhost/api/workspaces", policy)).toBeDefined();
    expect(
      localStorage.getItem(
        "webui.stale-cache.v1.http://localhost/api/projects",
      ),
    ).toBeNull();
  });

  it("ignores empty or root prefixes", () => {
    writeCache("http://localhost/api/health", { ok: true }, policy);
    invalidatePrefix("");
    invalidatePrefix("/");
    expect(readCached("http://localhost/api/health", policy)).toBeDefined();
  });
});
