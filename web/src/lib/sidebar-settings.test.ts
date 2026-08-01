import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSidebarFromServer,
  writeSidebarToServer,
  type SidebarState,
} from "./sidebar-settings";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("./client", () => ({ getJson, sendJson }));

describe("sidebar-settings server sync", () => {
  beforeEach(() => {
    getJson.mockReset();
    sendJson.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readSidebarFromServer", () => {
    it("returns null fields when the server has no value", async () => {
      getJson.mockResolvedValue({ value: null });
      expect(await readSidebarFromServer()).toEqual({
        expanded: null,
        width: null,
        archivedExpanded: null,
      });
      expect(getJson).toHaveBeenCalledWith("/api/settings/sidebar");
    });

    it("returns null fields when the server stores an empty string", async () => {
      getJson.mockResolvedValue({ value: "" });
      expect(await readSidebarFromServer()).toEqual({
        expanded: null,
        width: null,
        archivedExpanded: null,
      });
    });

    it("parses a full sidebar JSON payload", async () => {
      const state: SidebarState = {
        expanded: ["prj1", "prj2"],
        width: 320,
        archivedExpanded: true,
      };
      getJson.mockResolvedValue({ value: JSON.stringify(state) });
      expect(await readSidebarFromServer()).toEqual(state);
    });

    it("coerces expanded entries to strings", async () => {
      getJson.mockResolvedValue({
        value: JSON.stringify({ expanded: [1, 2], width: 240, archivedExpanded: false }),
      });
      expect(await readSidebarFromServer()).toEqual({
        expanded: ["1", "2"],
        width: 240,
        archivedExpanded: false,
      });
    });

    it("returns null for width when the stored value is not a finite number", async () => {
      getJson.mockResolvedValue({
        value: JSON.stringify({ expanded: ["a"], width: "wide", archivedExpanded: false }),
      });
      const result = await readSidebarFromServer();
      expect(result.width).toBeNull();
      expect(result.expanded).toEqual(["a"]);
      expect(result.archivedExpanded).toBe(false);
    });

    it("returns null for archivedExpanded when the stored value is not a boolean", async () => {
      getJson.mockResolvedValue({
        value: JSON.stringify({ expanded: [], width: 240, archivedExpanded: "yes" }),
      });
      const result = await readSidebarFromServer();
      expect(result.archivedExpanded).toBeNull();
    });

    it("returns null fields when the stored value is not valid JSON", async () => {
      getJson.mockResolvedValue({ value: "not-json" });
      expect(await readSidebarFromServer()).toEqual({
        expanded: null,
        width: null,
        archivedExpanded: null,
      });
    });

    it("returns null fields on fetch failure", async () => {
      getJson.mockRejectedValue(new Error("network"));
      expect(await readSidebarFromServer()).toEqual({
        expanded: null,
        width: null,
        archivedExpanded: null,
      });
    });
  });

  describe("writeSidebarToServer", () => {
    it("sends PUT with the JSON-stringified state", async () => {
      sendJson.mockResolvedValue({ ok: true });
      const state: SidebarState = {
        expanded: ["prj1"],
        width: 280,
        archivedExpanded: false,
      };
      await writeSidebarToServer(state);
      expect(sendJson).toHaveBeenCalledWith("PUT", "/api/settings/sidebar", {
        value: JSON.stringify(state),
      });
    });

    it("serializes overlapping writes so the latest geometry is sent last", async () => {
      let releaseFirst!: (value: unknown) => void;
      sendJson.mockImplementation((_method: string, _path: string, payload: { value: string }) => {
        const state = JSON.parse(payload.value) as SidebarState;
        if (state.width === 280) {
          return new Promise((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve({ ok: true });
      });
      const first = writeSidebarToServer({
        expanded: ["prj1"],
        width: 280,
        archivedExpanded: false,
      });
      await Promise.resolve();
      const second = writeSidebarToServer({
        expanded: ["prj1", "prj2"],
        width: 360,
        archivedExpanded: true,
      });
      await Promise.resolve();
      expect(sendJson).toHaveBeenCalledTimes(1);

      releaseFirst({ ok: true });
      await Promise.all([first, second]);
      expect(sendJson).toHaveBeenNthCalledWith(
        2,
        "PUT",
        "/api/settings/sidebar",
        { value: JSON.stringify({ expanded: ["prj1", "prj2"], width: 360, archivedExpanded: true }) },
      );
    });

    it("swallows fetch errors", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      sendJson.mockRejectedValue(new Error("network"));
      await expect(
        writeSidebarToServer({ expanded: [], width: 240, archivedExpanded: true }),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });
});
