import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFaviconBadge, badgeColor } from "./favicon-badge";

describe("badgeColor", () => {
  it("returns red for attention", () => {
    expect(badgeColor("attention")).toBe("#ef4444");
  });

  it("returns amber for working", () => {
    expect(badgeColor("working")).toBe("#f59e0b");
  });

  it("returns null for idle (no dot)", () => {
    expect(badgeColor("idle")).toBeNull();
  });
});

interface DrawRecord {
  fills: string[];
  strokes: { style: string; width: number }[];
  fillTexts: string[];
}

function makeFakeCanvas(record: DrawRecord, withContext = true) {
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    closePath() {},
    fill() {
      record.fills.push(String(this.fillStyle));
    },
    stroke() {
      record.strokes.push({ style: String(this.strokeStyle), width: this.lineWidth });
    },
    fillText(text: string) {
      record.fillTexts.push(text);
    },
  };
  return {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === "2d" && withContext ? ctx : null),
    toDataURL: () => "data:image/png;base64,fake",
  };
}

describe("applyFaviconBadge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelector('link[rel="icon"][data-badge="1"]')?.remove();
  });

  function mockCanvas(fake: ReturnType<typeof makeFakeCanvas>) {
    const orig = document.createElement.bind(document);
    return vi
      .spyOn(document, "createElement")
      .mockImplementation(
        (tag: string, options?: ElementCreationOptions) =>
          tag.toLowerCase() === "canvas"
            ? (fake as unknown as HTMLCanvasElement)
            : orig(tag, options),
      );
  }

  it("draws the tray-matching tile (blue bg, white prompt glyph) for idle", () => {
    const record: DrawRecord = { fills: [], strokes: [], fillTexts: [] };
    mockCanvas(makeFakeCanvas(record));

    applyFaviconBadge("idle");

    // Blue tray tile first, then the white "_" cursor; no status dot.
    expect(record.fills).toEqual(["#2563eb", "#ffffff"]);
    // ">" chevron as a thick white stroke; the legacy "C" fillText is gone.
    expect(record.strokes).toEqual([{ style: "#ffffff", width: 10 }]);
    expect(record.fillTexts).toEqual([]);
    // The rendered tile is swapped in via the dedicated badge link.
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"][data-badge="1"]',
    );
    expect(link?.href).toBe("data:image/png;base64,fake");
  });

  it("adds a white gap ring and colored dot for attention", () => {
    const record: DrawRecord = { fills: [], strokes: [], fillTexts: [] };
    mockCanvas(makeFakeCanvas(record));

    applyFaviconBadge("attention");

    expect(record.fills).toEqual([
      "#2563eb", // tile
      "#ffffff", // "_" cursor
      "#ffffff", // dot gap ring
      "#ef4444", // dot
    ]);
  });

  it("is a no-op when canvas 2d context is unavailable", () => {
    const record: DrawRecord = { fills: [], strokes: [], fillTexts: [] };
    mockCanvas(makeFakeCanvas(record, false));

    expect(() => applyFaviconBadge("working")).not.toThrow();
    expect(record.fills).toEqual([]);
    expect(
      document.querySelector('link[rel="icon"][data-badge="1"]'),
    ).toBeNull();
  });
});
