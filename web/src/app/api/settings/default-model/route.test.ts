import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn((): string | null => null),
  setSetting: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSetting, setSetting }));

import { GET, PUT } from "./route";

function putReq(body: unknown): Request {
  return new Request("http://localhost/api/settings/default-model", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/settings/default-model", () => {
  beforeEach(() => {
    getSetting.mockReset();
    setSetting.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("returns null when nothing is stored", async () => {
      getSetting.mockReturnValue(null);
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: null });
    });

    it("returns null when an empty string is stored", async () => {
      getSetting.mockReturnValue("");
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: null });
    });

    it("returns the stored value", async () => {
      getSetting.mockReturnValue("openai::gpt-5");
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: "openai::gpt-5" });
    });
  });

  describe("PUT", () => {
    it("stores a string value and returns ok", async () => {
      const res = await PUT(putReq({ value: "openai::gpt-5" }) as never);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(setSetting).toHaveBeenCalledWith("default-model", "openai::gpt-5");
    });

    it("stores an empty string when value is null", async () => {
      const res = await PUT(putReq({ value: null }) as never);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(setSetting).toHaveBeenCalledWith("default-model", "");
    });

    it("stores an empty string when value is an empty string", async () => {
      const res = await PUT(putReq({ value: "" }) as never);
      expect(res.status).toBe(200);
      expect(setSetting).toHaveBeenCalledWith("default-model", "");
    });

    it("rejects a non-string value with 400", async () => {
      const res = await PUT(putReq({ value: 123 }) as never);
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("rejects a missing value field with 400", async () => {
      const res = await PUT(putReq({}) as never);
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("rejects a non-object body with 400", async () => {
      const res = await PUT(
        new Request("http://localhost/api/settings/default-model", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: "not-json",
        }) as never,
      );
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("round-trips a value through PUT then GET", async () => {
      getSetting.mockReturnValue("anthropic::claude-sonnet-5");
      const putRes = await PUT(putReq({ value: "anthropic::claude-sonnet-5" }) as never);
      expect(putRes.status).toBe(200);
      const getRes = await GET();
      expect(await getRes.json()).toEqual({ value: "anthropic::claude-sonnet-5" });
    });
  });
});