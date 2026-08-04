import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_OPTIMIZE_EVENT,
  AUTO_ROUTE_OVERRIDES_EVENT,
  AUTO_SHOW_MODEL_EVENT,
  hasStoredAutoSetting,
  readAutoOptimizeMode,
  readAutoRouteOverrides,
  readAutoSettingsFromServer,
  readAutoShowModel,
  subscribeAutoSetting,
  writeAutoOptimizeMode,
  writeAutoRouteOverrides,
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

  it("reports whether a local choice exists", () => {
    expect(hasStoredAutoSetting("auto-optimize")).toBe(false);
    expect(hasStoredAutoSetting("auto-show-model")).toBe(false);

    writeAutoOptimizeMode("balanced");
    writeAutoShowModel(true);
    expect(hasStoredAutoSetting("auto-optimize")).toBe(true);
    expect(hasStoredAutoSetting("auto-show-model")).toBe(true);

    // Turning a toggle off removes the key, so "configured off" is
    // indistinguishable from "never configured" locally — the server snapshot
    // is what carries an explicit off.
    writeAutoShowModel(false);
    expect(hasStoredAutoSetting("auto-show-model")).toBe(false);
  });

  it("uses separate keys per toggle", () => {
    writeAutoShowModel(true);
    expect(localStorage.getItem("webui:auto-show-model")).toBe("1");
  });
});

describe("auto route overrides storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to {} when nothing is stored", () => {
    expect(readAutoRouteOverrides()).toEqual({});
  });

  it("round-trips a non-empty override map", () => {
    writeAutoRouteOverrides({ light: { costOrder: ["cheap"] } });
    expect(readAutoRouteOverrides()).toEqual({
      light: { costOrder: ["cheap"] },
    });
  });

  it("removes the key when written back to {}", () => {
    writeAutoRouteOverrides({ light: { costOrder: ["cheap"] } });
    writeAutoRouteOverrides({});
    expect(localStorage.getItem("webui:auto-route-overrides")).toBeNull();
    expect(readAutoRouteOverrides()).toEqual({});
  });

  it("falls back to {} for corrupted JSON", () => {
    localStorage.setItem("webui:auto-route-overrides", "{not json");
    expect(readAutoRouteOverrides()).toEqual({});
  });

  it("drops unknown fields via normalization on read", () => {
    localStorage.setItem(
      "webui:auto-route-overrides",
      JSON.stringify({ light: { costOrder: ["bogus"] }, extreme: {} }),
    );
    expect(readAutoRouteOverrides()).toEqual({});
  });

  it("dispatches a CustomEvent with the JSON payload on write", () => {
    expect(
      captureEvent(AUTO_ROUTE_OVERRIDES_EVENT, () =>
        writeAutoRouteOverrides({ heavy: { costOrder: null } }),
      ),
    ).toEqual([JSON.stringify({ heavy: { costOrder: null } })]);
  });

  it("reports whether a local choice exists", () => {
    expect(hasStoredAutoSetting("auto-route-overrides")).toBe(false);
    writeAutoRouteOverrides({ light: { costOrder: ["cheap"] } });
    expect(hasStoredAutoSetting("auto-route-overrides")).toBe(true);
  });
});

describe("auto setting subscriptions", () => {
  it("handles same-document and matching cross-tab events", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAutoSetting("auto-optimize", listener);

    window.dispatchEvent(new CustomEvent(AUTO_OPTIMIZE_EVENT));
    window.dispatchEvent(
      new StorageEvent("storage", { key: "webui:auto-show-model" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "webui:auto-optimize" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    window.dispatchEvent(new CustomEvent(AUTO_OPTIMIZE_EVENT));
    expect(listener).toHaveBeenCalledTimes(3);
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

  it("reads configured keys", async () => {
    serverValues({
      "auto-optimize": "balanced",
      "auto-show-model": "1",
    });
    expect(await readAutoSettingsFromServer()).toEqual({
      mode: "balanced",
      showModel: true,
    });
    expect(getJson).toHaveBeenCalledWith("/api/settings/auto-optimize");
    expect(getJson).toHaveBeenCalledWith("/api/settings/auto-show-model");
  });

  it("omits keys the server has not configured", async () => {
    serverValues({});
    expect(await readAutoSettingsFromServer()).toEqual({});
  });

  it("omits an invalid mode but keeps valid toggles", async () => {
    serverValues({ "auto-optimize": "balance", "auto-show-model": "1" });
    expect(await readAutoSettingsFromServer()).toEqual({ showModel: true });
  });

  it("reads and normalizes route overrides", async () => {
    serverValues({
      "auto-route-overrides": JSON.stringify({
        light: { costOrder: ["cheap", "bogus"] },
      }),
    });
    expect(await readAutoSettingsFromServer()).toEqual({
      routeOverrides: { light: { costOrder: ["cheap"] } },
    });
  });

  it("omits route overrides for corrupted JSON", async () => {
    serverValues({ "auto-route-overrides": "{not json" });
    expect(await readAutoSettingsFromServer()).toEqual({});
  });

  it("omits route overrides that normalize to empty", async () => {
    serverValues({ "auto-route-overrides": JSON.stringify({ extreme: {} }) });
    expect(await readAutoSettingsFromServer()).toEqual({});
  });

  it("swallows per-key request failures", async () => {
    getJson.mockImplementation((path: string) =>
      path.endsWith("auto-optimize")
        ? Promise.reject(new Error("network"))
        : Promise.resolve({ value: "1" }),
    );
    expect(await readAutoSettingsFromServer()).toEqual({
      showModel: true,
    });
  });

  it("sends PUT for a single setting", async () => {
    sendJson.mockResolvedValue({ ok: true });
    await writeAutoSettingToServer("auto-optimize", "intelligence");
    expect(sendJson).toHaveBeenCalledWith("PUT", "/api/settings/auto-optimize", {
      value: "intelligence",
    });
  });

  it("serializes overlapping writes for the same setting", async () => {
    let releaseFirst!: (value: unknown) => void;
    sendJson.mockImplementation((_method: string, path: string, body: { value: string }) => {
      if (path.endsWith("auto-show-model") && body.value === "first") {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve({ ok: true });
    });

    const first = writeAutoSettingToServer("auto-show-model", "first");
    await Promise.resolve();
    const second = writeAutoSettingToServer("auto-show-model", "second");
    await Promise.resolve();
    expect(sendJson).toHaveBeenCalledTimes(1);

    releaseFirst({ ok: true });
    await Promise.all([first, second]);
    expect(sendJson).toHaveBeenNthCalledWith(
      2,
      "PUT",
      "/api/settings/auto-show-model",
      { value: "second" },
    );
  });

  it("swallows a write failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendJson.mockRejectedValue(new Error("network"));
    await expect(
      writeAutoSettingToServer("auto-show-model", "1"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
