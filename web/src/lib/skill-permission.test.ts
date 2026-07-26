import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSkillPermission,
  writeSkillPermission,
  SKILL_PERMISSION_EVENT,
} from "./skill-permission";

describe("skill-permission storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to allow when nothing is stored", () => {
    expect(readSkillPermission()).toBe("allow");
  });

  it("round-trips a stored value", () => {
    writeSkillPermission("deny");
    expect(localStorage.getItem("webui:skill-permission")).toBe("deny");
    expect(readSkillPermission()).toBe("deny");
    writeSkillPermission("allow");
    expect(readSkillPermission()).toBe("allow");
  });

  it("falls back to allow for an invalid stored value", () => {
    localStorage.setItem("webui:skill-permission", "bogus");
    expect(readSkillPermission()).toBe("allow");
  });

  it("dispatches a CustomEvent with the mode on write", () => {
    const detail: string[] = [];
    const onEvent = (e: Event) =>
      detail.push((e as CustomEvent<string>).detail);
    window.addEventListener(SKILL_PERMISSION_EVENT, onEvent);
    writeSkillPermission("deny");
    window.removeEventListener(SKILL_PERMISSION_EVENT, onEvent);
    expect(detail).toEqual(["deny"]);
  });
});
