import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readProviderModelState,
  setProviderIcon,
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
    expect(readProviderModelState()).toEqual({
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
    });
  });

  it("also falls back to the defaults for malformed state", () => {
    const statePath = path.join(appData, "opencode-webui", "provider-model-state.json");
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
