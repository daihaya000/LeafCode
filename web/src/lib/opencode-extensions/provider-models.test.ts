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
  addCustomProvider,
  deleteCustomProvider,
  __clearProviderResponseCacheForTest,
  __clearConfigRootCacheForTest,
  listConfiguredImageModels,
  listProviderModels,
  saveProviderModelOrder,
  setProviderIconOverride,
  setProviderModelEnabled,
  updateCustomProvider,
  upsertProviderEntry,
} from "./provider-models";

let data: string;

function statePath(): string {
  return path.join(data, "provider-model-state.json");
}

function readState(): {
  disabled: Record<string, true>;
  providerOrder?: string[];
  modelOrder?: Record<string, string[]>;
  providerIcons?: Record<string, string>;
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
  process.env.OPENCODE_CONFIG_DIR = data;
  fs.writeFileSync(path.join(data, "opencode.jsonc"), "{}\n");
  // These tests exercise explicit state transitions; keep new-profile defaults
  // covered separately by provider-model-state.test.ts.
  fs.writeFileSync(
    statePath(),
    JSON.stringify({ disabled: {}, providerOrder: [], modelOrder: {}, providerIcons: {} }),
  );
  h.ocServer.mockReset();
  h.ocServer.mockResolvedValue(MOCK_PROVIDER_RESPONSE);
  __clearProviderResponseCacheForTest();
  __clearConfigRootCacheForTest();
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
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

  it("forwards engine capabilities (attachment/input.image) onto each model", async () => {
    h.ocServer.mockResolvedValue({
      all: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-5": {
              name: "GPT-5",
              capabilities: {
                attachment: true,
                input: { image: true, text: true },
              },
              variants: { high: { disabled: false }, max: {} },
            },
            "gpt-4o": {
              name: "GPT-4o",
              capabilities: { input: { text: true } },
            },
          },
        },
      ],
      connected: ["openai"],
      default: {},
    });

    const providers = await listProviderModels();
    const openai = providers.find((p) => p.id === "openai")!;
    const gpt5 = openai.models.find((m) => m.id === "gpt-5")!;
    expect(gpt5.capabilities?.attachment).toBe(true);
    expect(gpt5.capabilities?.input?.image).toBe(true);
    expect(gpt5.variants).toMatchObject({
      high: { disabled: false },
      max: {},
    });
    const gpt4o = openai.models.find((m) => m.id === "gpt-4o")!;
    expect(gpt4o.capabilities?.attachment).toBeUndefined();
    expect(gpt4o.capabilities?.input?.image).toBeUndefined();
    expect(gpt4o.variants).toBeUndefined();
  });

  it("keeps the provider response cache across a module reload", async () => {
    await listProviderModels();
    expect(h.ocServer).toHaveBeenCalledTimes(1);

    // Next dev can re-evaluate this module between requests. The cache must
    // live on globalThis rather than in the module instance itself.
    vi.resetModules();
    const reloaded = await import("./provider-models");
    await reloaded.listProviderModels();

    expect(h.ocServer).toHaveBeenCalledTimes(1);
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

  it("includes configured providers that are not returned by the running server", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          custom: {
            name: "Custom AI",
            models: { "custom-model": { name: "Custom Model" } },
          },
        },
      }),
    );

    const providers = await listProviderModels();
    const custom = providers.find((provider) => provider.id === "custom");
    expect(custom).toMatchObject({
      name: "Custom AI",
      models: [{ id: "custom-model", name: "Custom Model", enabled: true }],
    });
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

describe("listProviderModels fast/old-generation default", () => {
  const GENERATIONS_RESPONSE = {
    all: [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5.6-sol": { name: "GPT-5.6 Sol" },
          "gpt-5.5": { name: "GPT-5.5" },
          "gpt-5.6-sol-fast": { name: "GPT-5.6 Sol Fast" },
          "gpt-5.4": { name: "GPT-5.4" },
        },
      },
    ],
    connected: ["openai"],
    default: { provider: "openai", model: "gpt-5.6-sol" },
  };

  it("grandfathers every currently-visible model on the first call (legacy state, no knownModelKeys)", async () => {
    // beforeEach already wrote a state file without `knownModelKeys`,
    // simulating a profile that existed before this feature shipped.
    h.ocServer.mockResolvedValue(GENERATIONS_RESPONSE);

    const providers = await listProviderModels();
    const openai = providers.find((p) => p.id === "openai")!;
    // None are auto-disabled: an old profile's already-visible models must
    // not flip from implicitly-enabled to disabled just from upgrading.
    expect(openai.models.every((m) => m.enabled)).toBe(true);

    const state = readState();
    expect(state.disabled).toEqual({});
  });

  it("marks the first-call models as known so future calls can apply the default rule", async () => {
    h.ocServer.mockResolvedValue(GENERATIONS_RESPONSE);
    await listProviderModels();

    const stateAfterFirstCall = JSON.parse(
      fs.readFileSync(statePath(), "utf8"),
    ) as { knownModelKeys?: string[] };
    expect(stateAfterFirstCall.knownModelKeys).toEqual(
      expect.arrayContaining([
        "openai::gpt-5.6-sol",
        "openai::gpt-5.5",
        "openai::gpt-5.6-sol-fast",
        "openai::gpt-5.4",
      ]),
    );
  });

  it("applies the fast/old-generation default only to models not yet known", async () => {
    // Simulate a profile that has already gone through the migration pass:
    // gpt-5.6-sol and gpt-5.5 are already known (and implicitly enabled).
    fs.writeFileSync(
      statePath(),
      JSON.stringify({
        disabled: {},
        providerOrder: [],
        modelOrder: {},
        providerIcons: {},
        knownModelKeys: ["openai::gpt-5.6-sol", "openai::gpt-5.5"],
      }),
    );
    h.ocServer.mockResolvedValue(GENERATIONS_RESPONSE);

    const providers = await listProviderModels();
    const openai = providers.find((p) => p.id === "openai")!;
    // Already-known models are untouched.
    expect(openai.models.find((m) => m.id === "gpt-5.6-sol")!.enabled).toBe(true);
    expect(openai.models.find((m) => m.id === "gpt-5.5")!.enabled).toBe(true);
    // Newly-seen fast variant and 2-generations-old model default off.
    expect(openai.models.find((m) => m.id === "gpt-5.6-sol-fast")!.enabled).toBe(
      false,
    );
    expect(openai.models.find((m) => m.id === "gpt-5.4")!.enabled).toBe(false);

    const state = readState();
    expect(state.disabled).toEqual({
      "openai::gpt-5.6-sol-fast": true,
      "openai::gpt-5.4": true,
    });
  });

  it("does not re-evaluate a model once it has been decided (toggling back on sticks)", async () => {
    fs.writeFileSync(
      statePath(),
      JSON.stringify({
        disabled: {},
        providerOrder: [],
        modelOrder: {},
        providerIcons: {},
        knownModelKeys: ["openai::gpt-5.6-sol", "openai::gpt-5.5"],
      }),
    );
    h.ocServer.mockResolvedValue(GENERATIONS_RESPONSE);

    await listProviderModels();
    // User explicitly re-enables the fast model the heuristic disabled.
    await setProviderModelEnabled("openai::gpt-5.6-sol-fast", true);

    const providers = await listProviderModels();
    const openai = providers.find((p) => p.id === "openai")!;
    expect(openai.models.find((m) => m.id === "gpt-5.6-sol-fast")!.enabled).toBe(
      true,
    );
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

describe("setProviderIconOverride", () => {
  it("sets an icon override for a built-in provider not present in config", async () => {
    await setProviderIconOverride("openai", "/icons/custom-openai.png");
    const state = readState();
    expect(state.providerIcons).toEqual({ openai: "/icons/custom-openai.png" });
  });

  it("accepts an http(s) URL", async () => {
    await setProviderIconOverride("anthropic", "https://example.com/icon.png");
    const state = readState();
    expect(state.providerIcons).toEqual({
      anthropic: "https://example.com/icon.png",
    });
  });

  it("clears the override when icon is null", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: {}, providerIcons: { openai: "/icons/old.png" } }),
    );

    await setProviderIconOverride("openai", null);
    const state = readState();
    expect(state.providerIcons).toEqual({});
  });

  it("rejects an icon that is neither an http(s) URL nor a leading-slash path", async () => {
    await expect(
      setProviderIconOverride("openai", "not-a-valid-icon"),
    ).rejects.toThrow();
  });

  it("rejects a provider id containing invalid characters", async () => {
    await expect(
      setProviderIconOverride("openai::gpt-5", "/icons/x.png"),
    ).rejects.toThrow();
  });
});

describe("addCustomProvider", () => {
  it("adds an OpenAI-compatible provider to opencode.jsonc", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
    );

    await addCustomProvider({
      id: "myprovider",
      name: "My Provider",
      baseURL: "https://api.example.com/v1",
      apiKeyEnv: "MY_PROVIDER_API_KEY",
      icon: "/icons/myprovider.png",
      models: [{ id: "my-model", name: "My Model" }],
    });

    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    expect(config.provider.myprovider).toMatchObject({
      npm: "@ai-sdk/openai-compatible",
      name: "My Provider",
      options: {
        baseURL: "https://api.example.com/v1",
        apiKey: "{env:MY_PROVIDER_API_KEY}",
      },
      models: { "my-model": { name: "My Model" } },
    });
    expect(readState().providerIcons).toEqual({ myprovider: "/icons/myprovider.png" });
  });

  it("updates an existing configured provider and its icon", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          myprovider: {
            npm: "@ai-sdk/openai-compatible",
            name: "Old Provider",
            options: { baseURL: "https://old.example.com/v1" },
            models: { old: { name: "Old" } },
          },
        },
      }),
    );

    await updateCustomProvider("myprovider", {
      id: "ignored",
      name: "New Provider",
      baseURL: "https://new.example.com/v1",
      apiKeyEnv: "NEW_KEY",
      icon: "https://example.com/icon.png",
      models: [{ id: "new", name: "New" }],
    });

    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    expect(config.provider.myprovider).toMatchObject({
      name: "New Provider",
      options: {
        baseURL: "https://new.example.com/v1",
        apiKey: "{env:NEW_KEY}",
      },
      models: { new: { name: "New" } },
    });
    expect(readState().providerIcons).toEqual({
      myprovider: "https://example.com/icon.png",
    });
  });

  it("accepts tagged model ids so local Ollama models can be registered", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
    );

    await addCustomProvider({
      id: "ollama-local",
      name: "Ollama",
      baseURL: "http://127.0.0.1:11434/v1",
      models: [{ id: "qwen2.5vl:7b" }],
    });

    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    expect(config.provider["ollama-local"].models["qwen2.5vl:7b"]).toMatchObject({
      name: "qwen2.5vl:7b",
    });
  });

  it("keeps image capability metadata that the edit form cannot express", async () => {
    // 回帰: フォーム経由の編集で attachment/modalities が消えると、VLモデルが
    // 画像非対応として扱われてしまう。
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          ollama: {
            name: "Ollama",
            options: { baseURL: "http://127.0.0.1:11434/v1" },
            models: {
              "qwen2.5vl:7b": {
                name: "qwen2.5vl:7b",
                attachment: true,
                modalities: { input: ["text", "image"], output: ["text"] },
                tool_call: false,
              },
            },
          },
        },
      }),
    );

    await updateCustomProvider("ollama", {
      id: "ollama",
      name: "Ollama (ローカル)",
      baseURL: "http://127.0.0.1:11434/v1",
      models: [{ id: "qwen2.5vl:7b" }, { id: "llama3:8b" }],
    });

    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    expect(config.provider.ollama.models["qwen2.5vl:7b"]).toEqual({
      name: "qwen2.5vl:7b",
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: false,
    });
    // 新規モデルには余計なフィールドを付けない。
    expect(config.provider.ollama.models["llama3:8b"]).toEqual({ name: "llama3:8b" });
  });

  it("rejects duplicate provider ids", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({ provider: { myprovider: { name: "Existing" } } }),
    );

    await expect(
      addCustomProvider({
        id: "myprovider",
        name: "My Provider",
        baseURL: "https://api.example.com/v1",
        models: [{ id: "my-model" }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("upsertProviderEntry / listConfiguredImageModels", () => {
  it("creates then overwrites the provider entry without a conflict error", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
    );

    await upsertProviderEntry("ollama", {
      name: "Ollama (ローカル)",
      options: { baseURL: "http://127.0.0.1:11434/v1" },
      models: { "llava:13b": { name: "llava:13b", attachment: true } },
    });
    await upsertProviderEntry("ollama", {
      name: "Ollama (ローカル)",
      options: { baseURL: "http://127.0.0.1:11434/v1" },
      models: {
        "qwen2.5vl:7b": {
          name: "qwen2.5vl:7b",
          attachment: true,
          modalities: { input: ["text", "image"], output: ["text"] },
        },
        "llama3:8b": { name: "llama3:8b" },
      },
    });

    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    // 再登録は差分マージではなく丸ごと置き換え。
    expect(Object.keys(config.provider.ollama.models)).toEqual([
      "qwen2.5vl:7b",
      "llama3:8b",
    ]);
  });

  it("lists only image-capable models declared in the config file", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          ollama: {
            name: "Ollama (ローカル)",
            models: {
              "qwen2.5vl:7b": { name: "qwen2.5vl:7b", attachment: true },
              "gemma3:4b": { modalities: { input: ["text", "image"] } },
              "llama3:8b": { name: "llama3:8b" },
            },
          },
        },
      }),
    );

    expect(listConfiguredImageModels()).toEqual([
      {
        value: "ollama::qwen2.5vl:7b",
        label: "qwen2.5vl:7b",
        group: "Ollama (ローカル)",
      },
      { value: "ollama::gemma3:4b", label: "gemma3:4b", group: "Ollama (ローカル)" },
    ]);
  });

  it("returns nothing when the config has no provider section", () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(path.join(data, "opencode.jsonc"), "{}\n");
    expect(listConfiguredImageModels()).toEqual([]);
  });
});

describe("deleteCustomProvider", () => {
  it("removes a configured provider entry from opencode.jsonc", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          myprovider: { name: "My Provider", models: { m: { name: "M" } } },
          other: { name: "Other", models: {} },
        },
      }),
    );

    await deleteCustomProvider("myprovider");

    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    expect(config.provider.myprovider).toBeUndefined();
    expect(config.provider.other).toBeDefined();
  });

  it("cleans up local state (disabled/order/icon) for the deleted provider", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({
        provider: { myprovider: { name: "My Provider", models: { m: { name: "M" } } } },
      }),
    );
    fs.writeFileSync(
      statePath(),
      JSON.stringify({
        disabled: { myprovider: true, "myprovider::m": true, openai: true },
        providerOrder: ["myprovider", "openai"],
        modelOrder: { myprovider: ["m"] },
        providerIcons: { myprovider: "/icons/myprovider.png", openai: "/icons/x.png" },
      }),
    );

    await deleteCustomProvider("myprovider");

    const state = readState();
    expect(state.disabled).toEqual({ openai: true });
    expect(state.providerOrder).toEqual(["openai"]);
    expect(state.modelOrder?.myprovider).toBeUndefined();
    expect(state.providerIcons).toEqual({ openai: "/icons/x.png" });
  });

  it("rejects deleting a built-in provider with no config entry", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(path.join(data, "opencode.jsonc"), "{}\n");

    await expect(deleteCustomProvider("openai")).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("rejects a provider id containing invalid characters", async () => {
    await expect(deleteCustomProvider("openai::gpt-5")).rejects.toThrow();
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
