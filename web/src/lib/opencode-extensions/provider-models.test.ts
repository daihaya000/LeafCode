import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ocServer: vi.fn(),
  dataDir: "",
}));

vi.mock("@/lib/oc-server", () => ({
  ocServer: h.ocServer,
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/paths", () => ({
  dataDir: () => h.dataDir,
  ensureDataDir: () => undefined,
}));

import {
  listProviderModels,
  saveProviderModelOrder,
  setProviderModelEnabled,
} from "./provider-models";

let data: string;

function statePath(): string {
  return path.join(data, "provider-model-state.json");
}

function readState(): {
  disabled: Record<string, true>;
  providerOrder?: string[];
  modelOrder?: Record<string, string[]>;
} {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { disabled: {} };
  }
}

const MOCK_PROVIDER_RESPONSE = {
  all: [
    {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-5": { name: "GPT-5" },
        "gpt-5-mini": { name: "GPT-5 Mini" },
      },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-sonnet-4-5": { name: "Claude Sonnet 4.5" },
        "claude-haiku-4-5": { name: "Claude Haiku 4.5" },
      },
    },
    {
      id: "ollama",
      name: "Ollama",
      models: {
        "llama3": { name: "Llama 3" },
      },
    },
  ],
  connected: ["openai", "anthropic", "ollama"],
  default: { provider: "openai", model: "gpt-5" },
};

beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "provider-models-data-"));
  h.dataDir = data;
  h.ocServer.mockReset();
  h.ocServer.mockResolvedValue(MOCK_PROVIDER_RESPONSE);
});

afterEach(() => {
  fs.rmSync(data, { recursive: true, force: true });
});

describe("listProviderModels", () => {
  it("lists all connected providers with their models", async () => {
    const providers = await listProviderModels();
    expect(providers).toHaveLength(3);

    const openai = providers.find((p) => p.id === "openai")!;
    expect(openai.name).toBe("OpenAI");
    expect(openai.enabled).toBe(true);
    expect(openai.models).toHaveLength(2);
    expect(openai.models[0].id).toBe("gpt-5");
    expect(openai.models[0].enabled).toBe(true);
  });

  it("filters to connected providers when connected is non-empty", async () => {
    h.ocServer.mockResolvedValue({
      ...MOCK_PROVIDER_RESPONSE,
      connected: ["openai"],
    });
    const providers = await listProviderModels();
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("openai");
  });

  it("includes all providers when connected is empty", async () => {
    h.ocServer.mockResolvedValue({
      ...MOCK_PROVIDER_RESPONSE,
      connected: [],
    });
    const providers = await listProviderModels();
    expect(providers).toHaveLength(3);
  });

  it("marks a disabled provider and its models as disabled", async () => {
    // Pre-populate state with openai disabled.
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: { openai: true } }),
    );

    const providers = await listProviderModels();
    const openai = providers.find((p) => p.id === "openai")!;
    expect(openai.enabled).toBe(false);
    expect(openai.models.every((m) => !m.enabled)).toBe(true);
  });

  it("marks individual disabled models while provider stays enabled", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: { "openai::gpt-5-mini": true } }),
    );

    const providers = await listProviderModels();
    const openai = providers.find((p) => p.id === "openai")!;
    expect(openai.enabled).toBe(true);
    const mini = openai.models.find((m) => m.id === "gpt-5-mini")!;
    expect(mini.enabled).toBe(false);
    const gpt5 = openai.models.find((m) => m.id === "gpt-5")!;
    expect(gpt5.enabled).toBe(true);
  });

  it("sorts providers alphabetically by name", async () => {
    const providers = await listProviderModels();
    const names = providers.map((p) => p.name);
    expect(names).toEqual([...names].sort());
  });

  it("uses saved provider and model order before fallback sorting", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({
        disabled: {},
        providerOrder: ["ollama", "openai", "anthropic"],
        modelOrder: { openai: ["gpt-5-mini", "gpt-5"] },
      }),
    );

    const providers = await listProviderModels();
    expect(providers.map((provider) => provider.id)).toEqual([
      "ollama",
      "openai",
      "anthropic",
    ]);
    expect(providers.find((provider) => provider.id === "openai")!.models.map((model) => model.id)).toEqual([
      "gpt-5-mini",
      "gpt-5",
    ]);
  });

  it("returns empty list when no providers", async () => {
    h.ocServer.mockResolvedValue({
      all: [],
      connected: [],
      default: {},
    });
    const providers = await listProviderModels();
    expect(providers).toHaveLength(0);
  });

  it("handles missing state file gracefully", async () => {
    const providers = await listProviderModels();
    expect(providers).toHaveLength(3);
    expect(providers.every((p) => p.enabled)).toBe(true);
  });

  it("handles malformed state file gracefully", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fs.mkdirSync(data, { recursive: true });
      fs.writeFileSync(statePath(), "{ corrupted json");
      const providers = await listProviderModels();
      expect(providers).toHaveLength(3);
      expect(providers.every((p) => p.enabled)).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("setProviderModelEnabled", () => {
  it("disables a provider by writing to state file", async () => {
    await setProviderModelEnabled("openai", false);
    const state = readState();
    expect(state.disabled).toEqual({ openai: true });
  });

  it("enables a previously disabled provider by removing the key", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: { openai: true } }),
    );

    await setProviderModelEnabled("openai", true);
    const state = readState();
    expect(state.disabled).toEqual({});
  });

  it("disables a model by writing providerID::modelID key", async () => {
    await setProviderModelEnabled("openai::gpt-5-mini", false);
    const state = readState();
    expect(state.disabled).toEqual({ "openai::gpt-5-mini": true });
  });

  it("enables a previously disabled model by removing the key", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: { "openai::gpt-5-mini": true } }),
    );

    await setProviderModelEnabled("openai::gpt-5-mini", true);
    const state = readState();
    expect(state.disabled).toEqual({});
  });

  it("preserves other disabled entries when toggling one", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({
        disabled: { openai: true, "anthropic::claude-haiku-4-5": true },
      }),
    );

    await setProviderModelEnabled("openai", true);
    const state = readState();
    expect(state.disabled).toEqual({ "anthropic::claude-haiku-4-5": true });
  });
});

describe("saveProviderModelOrder", () => {
  it("persists provider and model order while preserving disabled entries", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: { openai: true } }),
    );

    await saveProviderModelOrder({
      providerOrder: ["anthropic", "openai"],
      modelOrder: { openai: ["gpt-5-mini", "gpt-5"] },
    });

    const state = readState();
    expect(state.disabled).toEqual({ openai: true });
    expect(state.providerOrder).toEqual(["anthropic", "openai"]);
    expect(state.modelOrder?.openai).toEqual(["gpt-5-mini", "gpt-5"]);
  });
});
