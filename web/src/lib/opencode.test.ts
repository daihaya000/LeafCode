import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// The host process may export OPENCODE_BASE_URL pointing at a live engine;
// pin the primary URL so discovery tests are deterministic. Imported
// dynamically after the env pin because opencode.ts reads it at module load.
vi.stubEnv("OPENCODE_BASE_URL", "http://127.0.0.1:4096");

let engineHealthyAt: typeof import("./opencode").engineHealthyAt;
let discoverEngineUrl: typeof import("./opencode").discoverEngineUrl;

beforeAll(async () => {
  ({ engineHealthyAt, discoverEngineUrl } = await import("./opencode"));
});

function healthResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  delete process.env.OPENCODE_PORT;
});

describe("engineHealthyAt", () => {
  it("accepts a live engine health payload", async () => {
    fetchMock.mockResolvedValueOnce(
      healthResponse(true, { healthy: true, version: "1.18.18" }),
    );
    await expect(engineHealthyAt("http://127.0.0.1:4096")).resolves.toBe(true);
  });

  it("rejects non-ok responses", async () => {
    fetchMock.mockResolvedValueOnce(healthResponse(false, {}));
    await expect(engineHealthyAt("http://127.0.0.1:4096")).resolves.toBe(false);
  });

  it("rejects a non-engine payload without a version", async () => {
    fetchMock.mockResolvedValueOnce(healthResponse(true, { healthy: true }));
    await expect(engineHealthyAt("http://127.0.0.1:4096")).resolves.toBe(false);
  });

  it("rejects an unrelated app that answers a plain 200", async () => {
    fetchMock.mockResolvedValueOnce(healthResponse(true, "not json"));
    await expect(engineHealthyAt("http://127.0.0.1:4096")).resolves.toBe(false);
  });

  it("rejects fetch failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connection refused"));
    await expect(engineHealthyAt("http://127.0.0.1:4096")).resolves.toBe(false);
  });
});

describe("discoverEngineUrl", () => {
  it("returns the primary URL when it is live", async () => {
    fetchMock.mockResolvedValueOnce(
      healthResponse(true, { healthy: true, version: "1" }),
    );
    await expect(discoverEngineUrl()).resolves.toBe("http://127.0.0.1:4096");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("scans fallback ports when the primary is dead", async () => {
    fetchMock
      .mockResolvedValueOnce(healthResponse(false, {}))
      .mockResolvedValueOnce(healthResponse(false, {}))
      .mockResolvedValueOnce(
        healthResponse(true, { healthy: true, version: "1" }),
      );
    await expect(discoverEngineUrl()).resolves.toBe("http://127.0.0.1:4098");
  });

  it("probes the primary once and starts the scan at 4097", async () => {
    fetchMock.mockResolvedValue(healthResponse(false, {}));
    await discoverEngineUrl();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toBe("http://127.0.0.1:4096/global/health");
    expect(
      urls.filter((u) => u === "http://127.0.0.1:4096/global/health"),
    ).toHaveLength(1);
    expect(urls[1]).toBe("http://127.0.0.1:4097/global/health");
  });

  it("starts the scan at OPENCODE_PORT", async () => {
    process.env.OPENCODE_PORT = "4105";
    fetchMock.mockResolvedValue(healthResponse(false, {}));
    await discoverEngineUrl();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[1]).toBe("http://127.0.0.1:4105/global/health");
    expect(urls[2]).toBe("http://127.0.0.1:4106/global/health");
  });

  it("returns the primary when nothing answers", async () => {
    fetchMock.mockResolvedValue(healthResponse(false, {}));
    await expect(discoverEngineUrl()).resolves.toBe("http://127.0.0.1:4096");
  });
});
