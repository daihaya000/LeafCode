import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

import { DELETE, PATCH, PUT } from "./route";
import { GET } from "../route";

let data: string;

function statePath(): string {
  return path.join(data, "provider-model-state.json");
}

function readState(): { disabled: Record<string, true> } {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { disabled: {} };
  }
}

function patch(key: string, body: unknown): Promise<Response> {
  return PATCH(
    new NextRequest(
      `http://localhost/api/extensions/provider-models/${encodeURIComponent(key)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
    { params: Promise.resolve({ key }) },
  );
}

function put(key: string, body: unknown): Promise<Response> {
  return PUT(
    new NextRequest(
      `http://localhost/api/extensions/provider-models/${encodeURIComponent(key)}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
    { params: Promise.resolve({ key }) },
  );
}

function del(key: string): Promise<Response> {
  return DELETE(
    new NextRequest(
      `http://localhost/api/extensions/provider-models/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    ),
    { params: Promise.resolve({ key }) },
  );
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
  ],
  connected: ["openai"],
  default: { provider: "openai", model: "gpt-5" },
};

beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "api-provider-models-patch-"));
  h.dataDir = data;
  process.env.OPENCODE_CONFIG_DIR = data;
  // These tests exercise explicit state transitions; keep new-profile defaults
  // covered separately by provider-model-state.test.ts.
  fs.writeFileSync(
    statePath(),
    JSON.stringify({ disabled: {}, providerOrder: [], modelOrder: {}, providerIcons: {} }),
  );
  h.ocServer.mockReset();
  h.ocServer.mockResolvedValue(MOCK_PROVIDER_RESPONSE);
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(data, { recursive: true, force: true });
});

describe("PATCH /api/extensions/provider-models/[key]", () => {
  it("disables a provider", async () => {
    const res = await patch("openai", { enabled: false });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });

    const state = readState();
    expect(state.disabled).toEqual({ openai: true });
  });

  it("enables a previously disabled provider", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: { openai: true } }),
    );

    const res = await patch("openai", { enabled: true });
    expect(res.status).toBe(200);

    const state = readState();
    expect(state.disabled).toEqual({});
  });

  it("disables a model", async () => {
    const res = await patch("openai::gpt-5-mini", { enabled: false });
    expect(res.status).toBe(200);

    const state = readState();
    expect(state.disabled).toEqual({ "openai::gpt-5-mini": true });
  });

  it("enables a previously disabled model", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: { "openai::gpt-5-mini": true } }),
    );

    const res = await patch("openai::gpt-5-mini", { enabled: true });
    expect(res.status).toBe(200);

    const state = readState();
    expect(state.disabled).toEqual({});
  });

  it("returns 400 for non-boolean enabled", async () => {
    const res = await patch("openai", { enabled: "yes" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing body", async () => {
    const res = await patch("openai", {});
    expect(res.status).toBe(400);
  });

  it("reflects the toggle in the GET listing", async () => {
    // Disable a model.
    await patch("openai::gpt-5-mini", { enabled: false });

    const res = await GET();
    const body = (await res.json()) as {
      providers: { id: string; models: { id: string; enabled: boolean }[] }[];
    };
    const openai = body.providers.find((p) => p.id === "openai")!;
    const mini = openai.models.find((m) => m.id === "gpt-5-mini")!;
    expect(mini.enabled).toBe(false);
    const gpt5 = openai.models.find((m) => m.id === "gpt-5")!;
    expect(gpt5.enabled).toBe(true);
  });

  it("handles URL-encoded keys", async () => {
    const res = await patch("openai%3A%3Agpt-5-mini", { enabled: false });
    expect(res.status).toBe(200);

    const state = readState();
    expect(state.disabled).toEqual({ "openai::gpt-5-mini": true });
  });

  it("sets an icon override for a built-in provider via { icon }", async () => {
    const res = await patch("openai", { icon: "/icons/custom.png" });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });

    const state = readState() as { providerIcons?: Record<string, string> };
    expect(state.providerIcons).toEqual({ openai: "/icons/custom.png" });
  });

  it("clears an icon override when icon is null", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ disabled: {}, providerIcons: { openai: "/icons/old.png" } }),
    );

    const res = await patch("openai", { icon: null });
    expect(res.status).toBe(200);

    const state = readState() as { providerIcons?: Record<string, string> };
    expect(state.providerIcons).toEqual({});
  });

  it("returns 400 for an invalid icon value", async () => {
    const res = await patch("openai", { icon: "not-a-valid-icon" });
    expect(res.status).toBe(400);
  });

  it("updates a configured provider", async () => {
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          custom: {
            name: "Old",
            options: { baseURL: "https://old.example.com/v1" },
            models: { old: { name: "Old Model" } },
          },
        },
      }),
    );

    const res = await put("custom", {
      name: "New",
      baseURL: "https://new.example.com/v1",
      apiKeyEnv: "CUSTOM_KEY",
      icon: "/icons/custom.png",
      models: [{ id: "new", name: "New Model" }],
    });

    expect(res.status).toBe(200);
    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    expect(config.provider.custom).toMatchObject({
      name: "New",
      options: {
        baseURL: "https://new.example.com/v1",
        apiKey: "{env:CUSTOM_KEY}",
      },
      models: { new: { name: "New Model" } },
    });
    expect(readState()).toMatchObject({
      providerIcons: { custom: "/icons/custom.png" },
    });
  });
});

describe("DELETE /api/extensions/provider-models/[key]", () => {
  it("removes a configured provider from opencode.jsonc", async () => {
    fs.writeFileSync(
      path.join(data, "opencode.jsonc"),
      JSON.stringify({
        provider: { custom: { name: "Custom", models: { m: { name: "M" } } } },
      }),
    );

    const res = await del("custom");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, requiresRestart: true });

    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    expect(config.provider?.custom).toBeUndefined();
  });

  it("returns 404 (not-found) for a built-in provider with no config entry", async () => {
    fs.writeFileSync(path.join(data, "opencode.jsonc"), "{}\n");

    const res = await del("openai");
    expect(res.status).toBe(404);
  });
});
