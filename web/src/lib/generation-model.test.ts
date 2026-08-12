import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERATION_MODEL_EFFORT_EVENT,
  GENERATION_MODEL_EFFORT_SETTING_KEY,
  GENERATION_MODEL_EVENT,
  GENERATION_MODEL_SETTING_KEY,
  readGenerationModel,
  readGenerationModelEffort,
  readGenerationModelEffortFromServer,
  readGenerationModelFromServer,
  writeGenerationModel,
  writeGenerationModelEffort,
  writeGenerationModelEffortToServer,
  writeGenerationModelToServer,
} from "./generation-model";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("./client", () => ({ getJson, sendJson }));

describe("generation-model storage", () => {
  beforeEach(() => {
    localStorage.clear();
    getJson.mockReset();
    sendJson.mockReset();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null when nothing is stored", () => {
    expect(readGenerationModel()).toBeNull();
    expect(readGenerationModelEffort()).toBeNull();
  });

  it("round-trips a stored value", () => {
    writeGenerationModel("openai::gpt-5");
    expect(localStorage.getItem("webui:generation-model")).toBe("openai::gpt-5");
    expect(readGenerationModel()).toBe("openai::gpt-5");
    writeGenerationModel(null);
    expect(readGenerationModel()).toBeNull();
  });

  it("round-trips a stored effort", () => {
    writeGenerationModelEffort("high");
    expect(localStorage.getItem("webui:generation-model-effort")).toBe("high");
    expect(readGenerationModelEffort()).toBe("high");
    writeGenerationModelEffort(null);
    expect(readGenerationModelEffort()).toBeNull();
  });

  it("uses a separate effort key", () => {
    writeGenerationModel("openai::gpt-5");
    writeGenerationModelEffort("low");
    expect(localStorage.getItem("webui:generation-model")).toBe("openai::gpt-5");
    expect(localStorage.getItem("webui:generation-model-effort")).toBe("low");
  });

  it("dispatches a CustomEvent on write", () => {
    const details: string[] = [];
    const onModel = (e: Event) =>
      details.push((e as CustomEvent<string>).detail);
    const onEffort = (e: Event) =>
      details.push((e as CustomEvent<string>).detail);
    window.addEventListener(GENERATION_MODEL_EVENT, onModel);
    window.addEventListener(GENERATION_MODEL_EFFORT_EVENT, onEffort);
    writeGenerationModel("openai::gpt-5");
    writeGenerationModelEffort("medium");
    window.removeEventListener(GENERATION_MODEL_EVENT, onModel);
    window.removeEventListener(GENERATION_MODEL_EFFORT_EVENT, onEffort);
    expect(details).toEqual(["openai::gpt-5", "medium"]);
  });

  it("reads the model from the server settings endpoint", async () => {
    getJson.mockResolvedValue({ value: "openai::gpt-5" });
    expect(await readGenerationModelFromServer()).toBe("openai::gpt-5");
    expect(getJson).toHaveBeenCalledWith(
      `/api/settings/${GENERATION_MODEL_SETTING_KEY}`,
    );
  });

  it("reads the effort from the server settings endpoint", async () => {
    getJson.mockResolvedValue({ value: "high" });
    expect(await readGenerationModelEffortFromServer()).toBe("high");
    expect(getJson).toHaveBeenCalledWith(
      `/api/settings/${GENERATION_MODEL_EFFORT_SETTING_KEY}`,
    );
  });

  it("returns null when the server has no effort", async () => {
    getJson.mockResolvedValue({ value: "" });
    expect(await readGenerationModelEffortFromServer()).toBeNull();
  });

  it("returns null on effort fetch failure", async () => {
    getJson.mockRejectedValue(new Error("network"));
    expect(await readGenerationModelEffortFromServer()).toBeNull();
  });

  it("writes the effort to the server settings endpoint", async () => {
    sendJson.mockResolvedValue({ ok: true });
    await writeGenerationModelEffortToServer("low");
    expect(sendJson).toHaveBeenCalledWith(
      "PUT",
      `/api/settings/${GENERATION_MODEL_EFFORT_SETTING_KEY}`,
      { value: "low" },
    );
  });

  it("writes the model to the server settings endpoint", async () => {
    sendJson.mockResolvedValue({ ok: true });
    await writeGenerationModelToServer("openai::gpt-5");
    expect(sendJson).toHaveBeenCalledWith(
      "PUT",
      `/api/settings/${GENERATION_MODEL_SETTING_KEY}`,
      { value: "openai::gpt-5" },
    );
  });

  it("swallows effort write errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sendJson.mockRejectedValue(new Error("network"));
    await expect(
      writeGenerationModelEffortToServer("low"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
