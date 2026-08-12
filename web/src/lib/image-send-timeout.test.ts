import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IMAGE_ANALYSIS_SEND_TIMEOUT_MS,
  IMAGE_SEND_ROUTE_MAX_DURATION_SEC,
  IMAGE_SEND_SETUP_SLACK_MS,
  NEW_TASK_SEND_TIMEOUT_MS,
  SESSION_PROMPT_ASYNC_TIMEOUT_MS,
  VISION_ANALYSIS_TIMEOUT_DEFAULT_MS,
  VISION_ANALYSIS_TIMEOUT_MAX_MS,
  VISION_ANALYSIS_TIMEOUT_MIN_MS,
  clampVisionAnalysisTimeoutMs,
} from "./image-send-timeout";

const here = dirname(fileURLToPath(import.meta.url));

describe("image-send timeout budget", () => {
  it("covers the settings VL maximum plus setup slack", () => {
    expect(IMAGE_ANALYSIS_SEND_TIMEOUT_MS).toBe(
      VISION_ANALYSIS_TIMEOUT_MAX_MS + IMAGE_SEND_SETUP_SLACK_MS,
    );
    expect(IMAGE_ANALYSIS_SEND_TIMEOUT_MS).toBeGreaterThan(VISION_ANALYSIS_TIMEOUT_MAX_MS);
  });

  it("keeps prompt_async accept wait above ocServer's 10s default", () => {
    expect(SESSION_PROMPT_ASYNC_TIMEOUT_MS).toBeGreaterThan(10_000);
    expect(SESSION_PROMPT_ASYNC_TIMEOUT_MS).toBe(90_000);
  });

  it("gives new tasks enough time for provision and slash commands", () => {
    expect(NEW_TASK_SEND_TIMEOUT_MS).toBeGreaterThan(SESSION_PROMPT_ASYNC_TIMEOUT_MS);
    expect(NEW_TASK_SEND_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });

  it("keeps the route maxDuration above the client image-send budget", () => {
    expect(IMAGE_SEND_ROUTE_MAX_DURATION_SEC).toBe(
      Math.ceil(IMAGE_ANALYSIS_SEND_TIMEOUT_MS / 1000) + 10,
    );
    expect(IMAGE_SEND_ROUTE_MAX_DURATION_SEC * 1000).toBeGreaterThan(
      IMAGE_ANALYSIS_SEND_TIMEOUT_MS,
    );
  });

  it("exports maxDuration as a numeric literal in Next.js route modules", () => {
    const expected = `export const maxDuration = ${IMAGE_SEND_ROUTE_MAX_DURATION_SEC};`;
    const routes = [
      join(here, "../app/api/opencode/[...path]/route.ts"),
      join(here, "../app/api/tasks/route.ts"),
    ];
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain(expected);
      expect(source, file).not.toMatch(
        /export const maxDuration = IMAGE_SEND_ROUTE_MAX_DURATION_SEC/,
      );
    }
  });

  it("clamps vision analysis timeouts to the settings range", () => {
    expect(clampVisionAnalysisTimeoutMs(Number.NaN)).toBe(VISION_ANALYSIS_TIMEOUT_DEFAULT_MS);
    expect(clampVisionAnalysisTimeoutMs(-1)).toBe(VISION_ANALYSIS_TIMEOUT_DEFAULT_MS);
    expect(clampVisionAnalysisTimeoutMs(1_000)).toBe(VISION_ANALYSIS_TIMEOUT_MIN_MS);
    expect(clampVisionAnalysisTimeoutMs(999_999)).toBe(VISION_ANALYSIS_TIMEOUT_MAX_MS);
    expect(clampVisionAnalysisTimeoutMs(180_000)).toBe(180_000);
  });
});
