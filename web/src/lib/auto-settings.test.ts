import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_IMPOSE_EVENT,
  AUTO_OPTIMIZE_EVENT,
  AUTO_SHOW_MODEL_EVENT,
  readAutoImpose,
  readAutoOptimizeMode,
  readAutoSettingsFromServer,
  readAutoShowModel,
  writeAutoImpose,
  writeAutoOptimizeMode,
  writeAutoSettingToServer,
  writeAutoShowModel,
} from "./auto-settings";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("./client", () => ({ getJson, sendJson }));

function captureEvent(name: string, act: () => void): string[] {
  const detail: string[] = [];
  const onEvent = (e: Event) => detail.push((e as CustomEvent<string>).detail);
  window.addEventListener(name, onEvent);
  act();
  window.removeEventListener(name, onEvent);
  return detail;
}

describe("auto optimize mode storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to cost when nothing is stored", () => {
    expect(readAutoOptimizeMode()).toBe("cost");
  });

  it("round-trips every mode", () => {
    for (const mode of ["cost", "balanced", "intelligence"] as const) {
      writeAutoOptimizeMode(mode);
      expect(localStorage.getItem("webui:auto-optimize")).toBe(mode);
      expect(readAutoOptimizeMode()).toBe(mode);
    }
  });

  it("falls back to cost for a corrupted value", () => {
    localStorage.setItem("webui:auto-optimize", "balance");
    expect(readAutoOptimizeMode()).toBe("cost");
  });

  it("falls back to cost for an empty value", () => {
    localStorage.setItem("webui:auto-optimize", "");
    expect(readAutoOptimizeMode()).toBe("cost");
  });

  it("falls back to cost when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });
    expect(readAutoOptimizeMode()).toBe("cost");
    vi.unstubAllGlobals();
  });

  it("dispatches a CustomEvent with the mode on write", () => {
    expect(
      captureEvent(AUTO_OPTIMIZE_EVENT, () =>
        writeAutoOptimizeMode("intelligence"),
      ),
    ).toEqual(["intelligence"]);
  });

  it("does not throw when localStorage write is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
      clear: () => {},
    });
    expect(() => writeAutoOptimizeMode("balanced")).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("auto boolean toggles", () => {
  const cases = [
    {
      name: "show model",
      key: "webui:auto-show-model",
      event: AUTO_SHOW_MODEL_EVENT,
      read: readAutoShowModel,
      write: writeAutoShowModel,
    },
    {
      name: "impose auto",
      key: "webui:auto-impose",
      event: AUTO_IMPOSE_EVENT,
      read: readAutoImpose,
      write: writeAutoImpose,
    },
  ];

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  for (const c of cases) {
    describe(c.name, () => {
      it("defaults to false", () => {
        expect(c.read()).toBe(false);
      });

      it("round-trips on and off", () => {
        c.write(true);
        expect(localStorage.getItem(c.key)).toBe("1");
        expect(c.read()).toBe(true);
        c.write(false);
        expect(localStorage.getItem(c.key)).toBeNull();
        expect(c.read()).toBe(false);
      });

      it("treats any non-1 value as false", () => {
        for (const raw of ["0", "true", "on", ""]) {
          localStorage.setItem(c.key, raw);
          expect(c.read()).toBe(false);
        }
      });

      it("dispatches a CustomEvent on write", () => {
        expect(captureEvent(c.event, () => c.write(true))).toEqual(["1"]);
        expect(captureEvent(c.event, () => c.write(false))).toEqual([""]);
      });
    });
  }

  it("uses separate keys per toggle", () => {
    writeAutoShowModel(true);
    expect(localStorage.getItem("webui:auto-show-model")).toBe("1");
    expect(localStorage.getItem("webui:auto-impose")).toBeNull();
    expect(readAutoImpose()).toBe(false);
  });
});

describe("auto settings server sync", () => {
  beforeEach(() => {
    localStorage.clear();
    getJson.mockReset();
    sendJson.mockReset();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function serverValues(values: Record<string, string | null>) {
    getJson.mockImplementation((path: string) => {
      const key = path.replace("/api/settings/", "");
      return Promise.resolve({ value: values[key] ?? null });
    });
  }

  it("reads all three keys", async () => {
    serverValues({
      "auto-optimize": "balanced",
      "auto-show-model": "1",
      "auto-impose": "1",
    });
    expect(await readAutoSettingsFromServer()).toEqual({
      mode: "balanced",
      showModel: true,
      impose: true,
    });
    expect(getJson).toHaveBeenCalledWith("/api/settings/auto-optimize");
    expect(getJson).toHaveBeenCalledWith("/api/settings/auto-show-model");
    expect(getJson).toHaveBeenCalledWith("/api/settings/auto-impose");
  });

  it("omits keys the server has not configured", async () => {
    serverValues({});
    expect(await readAutoSettingsFromServer()).toEqual({});
  });

  it("omits an invalid mode but keeps valid toggles", async () => {
    serverValues({ "auto-optimize": "balance", "auto-show-model": "1" });
    expect(await readAutoSettingsFromServer()).toEqual({ showModel: true });
  });

  it("reports a stored non-1 toggle as explicitly off", async () => {
    serverValues({ "auto-impose": "0" });
    expect(await readAutoSettingsFromServer()).toEqual({ impose: false });
  });

  it("swallows per-key request failures", async () => {
    getJson.mockImplementation((path: string) =>
      path.endsWith("auto-optimize")
        ? Promise.reject(new Error("network"))
        : Promise.resolve({ value: "1" }),
    );
    expect(await readAutoSettingsFromServer()).toEqual({
      showModel: true,
      impose: true,
    });
  });

  it("sends PUT for a single setting", async () => {
    sendJson.mockResolvedValue({ ok: true });
    await writeAutoSettingToServer("auto-optimize", "intelligence");
    expect(sendJson).toHaveBeenCalledWith("PUT", "/api/settings/auto-optimize", {
      value: "intelligence",
    });
  });

  it("swallows a write failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendJson.mockRejectedValue(new Error("network"));
    await expect(
      writeAutoSettingToServer("auto-impose", "1"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
