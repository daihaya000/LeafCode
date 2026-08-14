import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { getSetting } = vi.hoisted(() => ({
  getSetting: vi.fn((): string | null => null),
}));

vi.mock("@/lib/db", () => ({ getSetting }));

import {
  DEFAULT_WORKFLOW_GRAPH_EDIT_ENABLED,
  DEFAULT_WORKFLOW_GRAPH_ENABLED,
  DEFAULT_WORKFLOW_MODE_ENABLED,
  WORKFLOW_MODE_SETTING_KEY,
  isWorkflowModeEnabled,
  resolveWorkflowModeEnabled,
  resolveWorkflowModeServer,
} from "./workflow-feature";

describe("resolveWorkflowModeEnabled", () => {
  test("keeps graph rollout defaults disabled", () => {
    expect(DEFAULT_WORKFLOW_GRAPH_ENABLED).toBe(false);
    expect(DEFAULT_WORKFLOW_GRAPH_EDIT_ENABLED).toBe(false);
  });

  test.each([
    ["true", true],
    [" TRUE ", true],
    ["1", true],
    ["false", false],
    [" FALSE ", false],
    ["0", false],
    ["invalid", false],
    [undefined, DEFAULT_WORKFLOW_MODE_ENABLED],
  ])("resolves %s to %s", (raw, expected) => {
    expect(resolveWorkflowModeEnabled(raw)).toBe(expected);
  });

  test("supports an explicit default for future rollout", () => {
    expect(resolveWorkflowModeEnabled(undefined, true)).toBe(true);
    expect(resolveWorkflowModeEnabled("invalid", true)).toBe(true);
  });
});

describe("resolveWorkflowModeServer", () => {
  beforeEach(() => {
    getSetting.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("reads the settings table first", () => {
    getSetting.mockReturnValue("1");
    expect(resolveWorkflowModeServer()).toBe(true);
    expect(getSetting).toHaveBeenCalledWith(WORKFLOW_MODE_SETTING_KEY);
  });

  test("falls back to the env var when no DB row exists", () => {
    getSetting.mockReturnValue(null);
    vi.stubEnv("LEAFCODE_WORKFLOW_MODE", "true");
    expect(resolveWorkflowModeServer()).toBe(true);
  });

  test("defaults to off when neither DB nor env is set", () => {
    getSetting.mockReturnValue(null);
    delete process.env.LEAFCODE_WORKFLOW_MODE;
    delete process.env.NEXT_PUBLIC_LEAFCODE_WORKFLOW_MODE;
    expect(resolveWorkflowModeServer()).toBe(false);
  });
});

describe("isWorkflowModeEnabled", () => {
  beforeEach(() => {
    getSetting.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("reads the settings table lazily", () => {
    getSetting.mockReturnValue("1");
    expect(isWorkflowModeEnabled()).toBe(true);
    getSetting.mockReturnValue("");
    expect(isWorkflowModeEnabled()).toBe(false);
  });
});
