import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSideWidthFromServer, writeSideWidthToServer } from "./sidepanel-settings";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("./client", () => ({ getJson, sendJson }));

describe("sidepanel-settings server sync", () => {
  beforeEach(() => {
    getJson.mockReset();
    sendJson.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readSideWidthFromServer", () => {
    it("returns the stored numeric width", async () => {
      getJson.mockResolvedValue({ value: "520" });
      expect(await readSideWidthFromServer()).toBe(520);
      expect(getJson).toHaveBeenCalledWith("/api/settings/sidepanel-width");
    });

    it("returns null when the server has no value", async () => {
      getJson.mockResolvedValue({ value: null });
      expect(await readSideWidthFromServer()).toBeNull();
    });

    it("returns null when the server stores an empty string", async () => {
      getJson.mockResolvedValue({ value: "" });
      expect(await readSideWidthFromServer()).toBeNull();
    });

    it("returns null when the stored value is not a finite number", async () => {
      getJson.mockResolvedValue({ value: "wide" });
      expect(await readSideWidthFromServer()).toBeNull();
    });

    it("returns null on fetch failure", async () => {
      getJson.mockRejectedValue(new Error("network"));
      expect(await readSideWidthFromServer()).toBeNull();
    });
  });

  describe("writeSideWidthToServer", () => {
    it("sends PUT with the width as a string", async () => {
      sendJson.mockResolvedValue({ ok: true });
      await writeSideWidthToServer(520);
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/sidepanel-width",
        { value: "520" },
      );
    });

    it("swallows fetch errors", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      sendJson.mockRejectedValue(new Error("network"));
      await expect(writeSideWidthToServer(520)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });
});