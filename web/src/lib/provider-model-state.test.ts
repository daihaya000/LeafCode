import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readProviderModelState,
  setProviderIcon,
  setModelPricing,
  setProviderModelDisabled,
  setProviderModelOrder,
} from "./provider-model-state";

describe("readProviderModelState defaults", () => {
  let appData: string;
  const previousAppData = process.env.APPDATA;

  beforeEach(() => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), "provider-model-state-"));
    process.env.APPDATA = appData;
  });

  afterEach(() => {
    fs.rmSync(appData, { recursive: true, force: true });
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
  });

  it("uses the requested provider and model defaults when state is absent", () => {
    const state = readProviderModelState();
    expect(state).toMatchObject({
      disabled: { "anthropic::claude-fable-5": true },
      providerOrder: ["openai", "anthropic"],
      modelOrder: {
        openai: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
        anthropic: [
          "claude-fable-5",
          "claude-opus-5",
          "claude-sonnet-5",
          "claude-haiku-4-5",
        ],
      },
      providerIcons: {},
      knownModelKeys: [],
      modelPricingDefaultsVersion: 2,
    });
    expect(state.modelPricing["ollama-cloud::glm-5.2"]).toEqual({
      input: 0.5026,
      output: 1.5796,
    });
    expect(state.modelPricing["qwen-cloud::qwen3.8-max"]).toEqual({
      input: 2,
      cachedInput: 0.25,
      cacheWrite: 2.5,
      output: 6,
    });
    expect(state.modelPricing["qwen-cloud::deepseek-v4-flash-0731"]).toEqual({
      input: 0.14,
      cachedInput: 0.0028,
      output: 0.28,
    });
  });

  it("migrates legacy state while preserving explicit pricing", () => {
    const statePath = path.join(appData, "leafcode", "provider-model-state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        disabled: {},
        providerOrder: [],
        modelOrder: {},
        providerIcons: {},
        modelPricing: { "ollama-cloud::glm-5.2": { input: 1, output: 2 } },
      }),
      "utf8",
    );

    const state = readProviderModelState();
    expect(state.modelPricing["ollama-cloud::glm-5.2"]).toEqual({
      input: 1,
      output: 2,
    });
    expect(state.modelPricing["ollama-cloud::kimi-k2.7-code"]).toEqual({
      input: 0.7,
      output: 3.5,
    });
    expect(state.modelPricing["qwen-cloud::glm-5.2"]).toEqual({
      input: 0.63,
      cachedInput: 0.0945,
      output: 1.98,
    });
    expect(state.modelPricingDefaultsVersion).toBe(2);
  });

  it("keeps a cleared default price cleared after migration", async () => {
    await setModelPricing("ollama-cloud::glm-5.2", undefined);

    expect(readProviderModelState().modelPricing["ollama-cloud::glm-5.2"]).toBeUndefined();
    expect(readProviderModelState().modelPricingDefaultsVersion).toBe(2);
  });

  it("also falls back to the defaults for malformed state", () => {
    const statePath = path.join(appData, "leafcode", "provider-model-state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{broken", "utf8");

    expect(readProviderModelState().disabled).toEqual({
      "anthropic::claude-fable-5": true,
    });
  });
});

describe("concurrent state mutations", () => {
  let appData: string;
  const previousAppData = process.env.APPDATA;

  beforeEach(() => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), "provider-model-state-"));
    process.env.APPDATA = appData;
  });

  afterEach(() => {
    fs.rmSync(appData, { recursive: true, force: true });
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
  });

  it("does not lose an update when two mutators race (read-modify-write without a lock would drop one)", async () => {
    // Regression: each mutator used to do its own unsynchronized
    // read-modify-write over the whole state file. Firing two concurrent
    // mutations that touch different fields used to let the second write
    // clobber the first's change because both read the pre-update state.
    await Promise.all([
      setProviderModelDisabled("openai::gpt-5.6-sol", true),
      setProviderModelOrder({ providerOrder: ["anthropic", "openai"] }),
      setProviderIcon("openai", "🤖"),
    ]);

    const state = readProviderModelState();
    expect(state.disabled["openai::gpt-5.6-sol"]).toBe(true);
    expect(state.providerOrder).toEqual(["anthropic", "openai"]);
    expect(state.providerIcons.openai).toBe("🤖");
  });
});
