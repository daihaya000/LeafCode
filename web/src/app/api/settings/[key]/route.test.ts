import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn((): string | null => null),
  setSetting: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSetting, setSetting }));

import { GET, PUT } from "./route";

function putReq(body: unknown, key = "default-model"): Request {
  return new Request(`http://localhost/api/settings/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(key: string) {
  return { params: Promise.resolve({ key }) };
}

describe("/api/settings/[key]", () => {
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
      const res = await GET(new Request("http://localhost/api/settings/default-model") as never, ctx("default-model"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: null });
    });

    it("returns null when an empty string is stored", async () => {
      getSetting.mockReturnValue("");
      const res = await GET(new Request("http://localhost/api/settings/default-model") as never, ctx("default-model"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: null });
    });

    it("returns the stored value for default-model", async () => {
      getSetting.mockReturnValue("openai::gpt-5");
      const res = await GET(new Request("http://localhost/api/settings/default-model") as never, ctx("default-model"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: "openai::gpt-5" });
    });

    it("returns the stored sidebar JSON string", async () => {
      const json = JSON.stringify({
        expanded: ["prj1"],
        width: 300,
        archivedExpanded: true,
      });
      getSetting.mockReturnValue(json);
      const res = await GET(new Request("http://localhost/api/settings/sidebar") as never, ctx("sidebar"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: json });
    });

    it("returns the stored sidepanel-width", async () => {
      getSetting.mockReturnValue("520");
      const res = await GET(new Request("http://localhost/api/settings/sidepanel-width") as never, ctx("sidepanel-width"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: "520" });
    });

    it("rejects an unknown key with 400", async () => {
      const res = await GET(new Request("http://localhost/api/settings/evil") as never, ctx("evil"));
      expect(res.status).toBe(400);
      expect(getSetting).not.toHaveBeenCalled();
    });
  });

  describe("PUT", () => {
    it("stores a string value and returns ok for default-model", async () => {
      const res = await PUT(putReq({ value: "openai::gpt-5" }) as never, ctx("default-model"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(setSetting).toHaveBeenCalledWith("default-model", "openai::gpt-5");
    });

    it("stores an empty string when value is null", async () => {
      const res = await PUT(putReq({ value: null }) as never, ctx("default-model"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(setSetting).toHaveBeenCalledWith("default-model", "");
    });

    it("stores an empty string when value is an empty string", async () => {
      const res = await PUT(putReq({ value: "" }) as never, ctx("default-model"));
      expect(res.status).toBe(200);
      expect(setSetting).toHaveBeenCalledWith("default-model", "");
    });

    it("stores the sidebar JSON string under the sidebar key", async () => {
      const json = JSON.stringify({
        expanded: ["prj1", "prj2"],
        width: 280,
        archivedExpanded: false,
      });
      const res = await PUT(putReq({ value: json }, "sidebar") as never, ctx("sidebar"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(setSetting).toHaveBeenCalledWith("sidebar", json);
    });

    it("stores the sidepanel-width string", async () => {
      const res = await PUT(putReq({ value: "520" }, "sidepanel-width") as never, ctx("sidepanel-width"));
      expect(res.status).toBe(200);
      expect(setSetting).toHaveBeenCalledWith("sidepanel-width", "520");
    });

    it("clamps an oversized sidepanel-width", async () => {
      const res = await PUT(putReq({ value: "9999" }, "sidepanel-width") as never, ctx("sidepanel-width"));
      expect(res.status).toBe(200);
      expect(setSetting).toHaveBeenCalledWith("sidepanel-width", "900");
    });

    it("rejects malformed default-model", async () => {
      const res = await PUT(putReq({ value: "not-a-model" }) as never, ctx("default-model"));
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("rejects malformed sidebar JSON", async () => {
      const res = await PUT(putReq({ value: "{not-json" }, "sidebar") as never, ctx("sidebar"));
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("rejects a non-string value with 400", async () => {
      const res = await PUT(putReq({ value: 123 }) as never, ctx("default-model"));
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("rejects an object value with 400", async () => {
      const res = await PUT(putReq({ value: { a: 1 } }) as never, ctx("sidebar"));
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("rejects a missing value field with 400", async () => {
      const res = await PUT(putReq({}) as never, ctx("default-model"));
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
        ctx("default-model"),
      );
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("rejects an unknown key with 400", async () => {
      const res = await PUT(putReq({ value: "x" }, "evil") as never, ctx("evil"));
      expect(res.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalled();
    });

    it("round-trips a value through PUT then GET", async () => {
      getSetting.mockReturnValue("anthropic::claude-sonnet-5");
      const putRes = await PUT(putReq({ value: "anthropic::claude-sonnet-5" }) as never, ctx("default-model"));
      expect(putRes.status).toBe(200);
      const getRes = await GET(new Request("http://localhost/api/settings/default-model") as never, ctx("default-model"));
      expect(await getRes.json()).toEqual({ value: "anthropic::claude-sonnet-5" });
    });
  });
});

describe("/api/settings/[key] auto mode settings", () => {
  beforeEach(() => {
    getSetting.mockReset();
    setSetting.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function getReq(key: string) {
    return GET(
      new Request(`http://localhost/api/settings/${key}`) as never,
      ctx(key),
    );
  }

  describe("auto-optimize", () => {
    for (const mode of ["cost", "balanced", "intelligence"]) {
      it(`stores ${mode}`, async () => {
        const res = await PUT(
          putReq({ value: mode }, "auto-optimize") as never,
          ctx("auto-optimize"),
        );
        expect(res.status).toBe(200);
        expect(setSetting).toHaveBeenCalledWith("auto-optimize", mode);
      });
    }

    it("returns the stored mode", async () => {
      getSetting.mockReturnValue("intelligence");
      const res = await getReq("auto-optimize");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ value: "intelligence" });
    });

    it("treats an empty string as unset", async () => {
      const res = await PUT(
        putReq({ value: "" }, "auto-optimize") as never,
        ctx("auto-optimize"),
      );
      expect(res.status).toBe(200);
      expect(setSetting).toHaveBeenCalledWith("auto-optimize", "");
    });

    for (const bad of ["balance", "COST", "auto", "cheap"]) {
      it(`rejects ${bad} with 400`, async () => {
        const res = await PUT(
          putReq({ value: bad }, "auto-optimize") as never,
          ctx("auto-optimize"),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: "auto-optimize must be cost, balanced or intelligence",
        });
        expect(setSetting).not.toHaveBeenCalled();
      });
    }
  });

  for (const key of ["auto-show-model"]) {
    describe(key, () => {
      it("stores 1", async () => {
        const res = await PUT(putReq({ value: "1" }, key) as never, ctx(key));
        expect(res.status).toBe(200);
        expect(setSetting).toHaveBeenCalledWith(key, "1");
      });

      it("treats an empty string as unset", async () => {
        const res = await PUT(putReq({ value: "" }, key) as never, ctx(key));
        expect(res.status).toBe(200);
        expect(setSetting).toHaveBeenCalledWith(key, "");
      });

      it("returns the stored value", async () => {
        getSetting.mockReturnValue("1");
        const res = await getReq(key);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ value: "1" });
      });

      it("returns null when unset", async () => {
        getSetting.mockReturnValue(null);
        const res = await getReq(key);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ value: null });
      });

      for (const bad of ["0", "true", "on", "yes"]) {
        it(`rejects ${bad} with 400`, async () => {
          const res = await PUT(putReq({ value: bad }, key) as never, ctx(key));
          expect(res.status).toBe(400);
          expect(await res.json()).toEqual({
            error: `${key} must be 1 or empty`,
          });
          expect(setSetting).not.toHaveBeenCalled();
        });
      }
    });
  }
});
