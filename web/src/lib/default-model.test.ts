import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_EFFORT_EVENT,
  DEFAULT_MODEL_EVENT,
  LAST_USED_MODEL_EVENT,
  readDefaultModel,
  readDefaultModelEffort,
  readDefaultModelEffortFromServer,
  readDefaultModelFromServer,
  readLastUsedModel,
  writeDefaultModel,
  writeDefaultModelEffort,
  writeDefaultModelEffortToServer,
  writeDefaultModelToServer,
  writeLastUsedModel,
} from "./default-model";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("./client", () => ({ getJson, sendJson }));

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

describe("default-model server sync", () => {
  beforeEach(() => {
    localStorage.clear();
    getJson.mockReset();
    sendJson.mockReset();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("readDefaultModelFromServer returns the server value", async () => {
    getJson.mockResolvedValue({ value: "openai::gpt-5" });
    expect(await readDefaultModelFromServer()).toBe("openai::gpt-5");
    expect(getJson).toHaveBeenCalledWith("/api/settings/default-model");
  });

  it("readDefaultModelFromServer returns null when server has no value", async () => {
    getJson.mockResolvedValue({ value: null });
    expect(await readDefaultModelFromServer()).toBeNull();
  });

  it("readDefaultModelFromServer returns null when server stores empty string", async () => {
    getJson.mockResolvedValue({ value: "" });
    expect(await readDefaultModelFromServer()).toBeNull();
  });

  it("readDefaultModelFromServer returns null on fetch failure", async () => {
    getJson.mockRejectedValue(new Error("network"));
    expect(await readDefaultModelFromServer()).toBeNull();
  });

  it("writeDefaultModelToServer sends PUT with the value", async () => {
    sendJson.mockResolvedValue({ ok: true });
    await writeDefaultModelToServer("openai::gpt-5");
    expect(sendJson).toHaveBeenCalledWith("PUT", "/api/settings/default-model", {
      value: "openai::gpt-5",
    });
  });

  it("writeDefaultModelToServer sends PUT with null", async () => {
    sendJson.mockResolvedValue({ ok: true });
    await writeDefaultModelToServer(null);
    expect(sendJson).toHaveBeenCalledWith("PUT", "/api/settings/default-model", {
      value: null,
    });
  });

  it("serializes overlapping writes so the latest value is sent last", async () => {
    let releaseFirst!: (value: unknown) => void;
    sendJson.mockImplementation((_method: string, _path: string, body: { value: string | null }) => {
      if (body.value === "first") {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve({ ok: true });
    });

    const first = writeDefaultModelToServer("first");
    await Promise.resolve();
    const second = writeDefaultModelToServer("second");
    await Promise.resolve();
    expect(sendJson).toHaveBeenCalledTimes(1);

    releaseFirst({ ok: true });
    await Promise.all([first, second]);
    expect(sendJson).toHaveBeenNthCalledWith(
      2,
      "PUT",
      "/api/settings/default-model",
      { value: "second" },
    );
  });

  it("writeDefaultModelToServer swallows fetch errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sendJson.mockRejectedValue(new Error("network"));
    await expect(writeDefaultModelToServer("openai::gpt-5")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("readDefaultModelFromServer waits for an in-flight write from this tab so a remount-triggered GET can't resurrect the value a pending Clear PUT is about to replace", async () => {
    let releasePut!: (value: unknown) => void;
    sendJson.mockImplementation(() =>
      new Promise((resolve) => {
        releasePut = resolve;
      }),
    );
    getJson.mockResolvedValue({ value: "openai::gpt-5" });

    // Simulates: user clicks Clear (fire-and-forget PUT queued), then
    // switches Settings tabs and back, remounting and re-fetching before
    // the PUT has landed.
    const write = writeDefaultModelToServer(null);
    const read = readDefaultModelFromServer();

    // The GET must not resolve until the queued PUT has settled.
    await Promise.resolve();
    await Promise.resolve();
    expect(getJson).not.toHaveBeenCalled();

    releasePut({ ok: true });
    await write;
    expect(await read).toBe("openai::gpt-5");
    expect(getJson).toHaveBeenCalledTimes(1);
  });
});

describe("default-model effort storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null when nothing is stored", () => {
    expect(readDefaultModelEffort()).toBeNull();
  });

  it("round-trips a stored effort", () => {
    writeDefaultModelEffort("high");
    expect(localStorage.getItem("webui:default-model-effort")).toBe("high");
    expect(readDefaultModelEffort()).toBe("high");
    writeDefaultModelEffort(null);
    expect(localStorage.getItem("webui:default-model-effort")).toBeNull();
    expect(readDefaultModelEffort()).toBeNull();
  });

  it("dispatches a CustomEvent with the effort on write", () => {
    const detail: string[] = [];
    const onEvent = (e: Event) =>
      detail.push((e as CustomEvent<string>).detail);
    window.addEventListener(DEFAULT_MODEL_EFFORT_EVENT, onEvent);
    writeDefaultModelEffort("medium");
    window.removeEventListener(DEFAULT_MODEL_EFFORT_EVENT, onEvent);
    expect(detail).toEqual(["medium"]);
  });

  it("uses a separate key from the default model", () => {
    writeDefaultModel("openai::gpt-5");
    writeDefaultModelEffort("low");
    expect(localStorage.getItem("webui:default-model")).toBe("openai::gpt-5");
    expect(localStorage.getItem("webui:default-model-effort")).toBe("low");
  });

  it("reads the effort from the server settings endpoint", async () => {
    getJson.mockResolvedValue({ value: "high" });
    expect(await readDefaultModelEffortFromServer()).toBe("high");
    expect(getJson).toHaveBeenCalledWith("/api/settings/default-model-effort");
  });

  it("returns null when the server has no effort", async () => {
    getJson.mockResolvedValue({ value: "" });
    expect(await readDefaultModelEffortFromServer()).toBeNull();
  });

  it("returns null on effort fetch failure", async () => {
    getJson.mockRejectedValue(new Error("network"));
    expect(await readDefaultModelEffortFromServer()).toBeNull();
  });

  it("writes the effort to the server settings endpoint", async () => {
    sendJson.mockResolvedValue({ ok: true });
    await writeDefaultModelEffortToServer("low");
    expect(sendJson).toHaveBeenCalledWith(
      "PUT",
      "/api/settings/default-model-effort",
      { value: "low" },
    );
  });

  it("swallows effort write errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sendJson.mockRejectedValue(new Error("network"));
    await expect(
      writeDefaultModelEffortToServer("low"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
