import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_EVENT,
  LAST_USED_MODEL_EVENT,
  readDefaultModel,
  readLastUsedModel,
  writeDefaultModel,
  writeLastUsedModel,
} from "./default-model";

describe("default-model storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null when nothing is stored", () => {
    expect(readDefaultModel()).toBeNull();
  });

  it("round-trips a stored value", () => {
    writeDefaultModel("openai::gpt-5");
    expect(localStorage.getItem("webui:default-model")).toBe("openai::gpt-5");
    expect(readDefaultModel()).toBe("openai::gpt-5");
    writeDefaultModel(null);
    expect(localStorage.getItem("webui:default-model")).toBeNull();
    expect(readDefaultModel()).toBeNull();
  });

  it("dispatches a CustomEvent with the value on write", () => {
    const detail: string[] = [];
    const onEvent = (e: Event) =>
      detail.push((e as CustomEvent<string>).detail);
    window.addEventListener(DEFAULT_MODEL_EVENT, onEvent);
    writeDefaultModel("openai::gpt-5");
    window.removeEventListener(DEFAULT_MODEL_EVENT, onEvent);
    expect(detail).toEqual(["openai::gpt-5"]);
  });
});

describe("last-used-model storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null when nothing is stored", () => {
    expect(readLastUsedModel()).toBeNull();
  });

  it("round-trips a stored value", () => {
    writeLastUsedModel("anthropic::claude-sonnet-5");
    expect(localStorage.getItem("webui:last-used-model")).toBe(
      "anthropic::claude-sonnet-5",
    );
    expect(readLastUsedModel()).toBe("anthropic::claude-sonnet-5");
    writeLastUsedModel(null);
    expect(localStorage.getItem("webui:last-used-model")).toBeNull();
    expect(readLastUsedModel()).toBeNull();
  });

  it("uses a separate key from default-model", () => {
    writeDefaultModel("openai::gpt-5");
    writeLastUsedModel("anthropic::claude-sonnet-5");
    expect(localStorage.getItem("webui:default-model")).toBe("openai::gpt-5");
    expect(localStorage.getItem("webui:last-used-model")).toBe(
      "anthropic::claude-sonnet-5",
    );
  });

  it("dispatches a CustomEvent with the value on write", () => {
    const detail: string[] = [];
    const onEvent = (e: Event) =>
      detail.push((e as CustomEvent<string>).detail);
    window.addEventListener(LAST_USED_MODEL_EVENT, onEvent);
    writeLastUsedModel("anthropic::claude-sonnet-5");
    window.removeEventListener(LAST_USED_MODEL_EVENT, onEvent);
    expect(detail).toEqual(["anthropic::claude-sonnet-5"]);
  });
});