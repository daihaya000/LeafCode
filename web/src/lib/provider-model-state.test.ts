import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProviderModelState } from "./provider-model-state";

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
