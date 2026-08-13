import { describe, expect, it } from "vitest";
import { unwrapOcData } from "./oc-server";

describe("unwrapOcData", () => {
  it("passes bare arrays through", () => {
    expect(unwrapOcData([{ id: "a" }])).toEqual([{ id: "a" }]);
  });

  it("unwraps v2 { data: [] } envelopes", () => {
    expect(unwrapOcData({ data: [{ id: "b" }] })).toEqual([{ id: "b" }]);
  });

  it("returns [] for null / non-array payloads", () => {
    expect(unwrapOcData(null)).toEqual([]);
    expect(unwrapOcData(undefined)).toEqual([]);
    expect(unwrapOcData({ data: "nope" })).toEqual([]);
    expect(unwrapOcData({ data: null })).toEqual([]);
    expect(unwrapOcData({})).toEqual([]);
    expect(unwrapOcData("nope")).toEqual([]);
  });

  it("preserves element types", () => {
    const result = unwrapOcData<{ id: string }>({ data: [{ id: "c" }] });
    expect(result[0]?.id).toBe("c");
  });
});
