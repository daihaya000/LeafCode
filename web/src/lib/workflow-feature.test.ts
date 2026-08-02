import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_WORKFLOW_MODE_ENABLED,
  isWorkflowModeEnabled,
  resolveWorkflowModeEnabled,
} from "./workflow-feature";

describe("resolveWorkflowModeEnabled", () => {
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

describe("isWorkflowModeEnabled", () => {
  const previous = process.env.OPENCODE_WEBUI_WORKFLOW_MODE;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (previous === undefined) delete process.env.OPENCODE_WEBUI_WORKFLOW_MODE;
    else process.env.OPENCODE_WEBUI_WORKFLOW_MODE = previous;
  });

  test("reads the current environment value lazily", () => {
    vi.stubEnv("OPENCODE_WEBUI_WORKFLOW_MODE", "true");
    expect(isWorkflowModeEnabled()).toBe(true);
    vi.stubEnv("OPENCODE_WEBUI_WORKFLOW_MODE", "false");
    expect(isWorkflowModeEnabled()).toBe(false);
  });
});
