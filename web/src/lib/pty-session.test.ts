import { describe, expect, it } from "vitest";
import { resolveScopedCwd } from "./pty-session";

describe("resolveScopedCwd", () => {
  it("returns the directory itself when cwd is omitted", () => {
    const r = resolveScopedCwd("C:/proj");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cwd).toBeTruthy();
  });

  it("rejects explicit .. traversal", () => {
    const r = resolveScopedCwd("C:/proj", "C:/proj/../../etc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("rejects relative .. traversal", () => {
    const r = resolveScopedCwd("C:/proj", "../../etc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("rejects an absolute path outside the directory", () => {
    const r = resolveScopedCwd("C:/proj", "D:/elsewhere");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("accepts a subdirectory", () => {
    const r = resolveScopedCwd("C:/proj", "C:/proj/sub");
    expect(r.ok).toBe(true);
  });

  it("requires a directory", () => {
    const r = resolveScopedCwd("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});
