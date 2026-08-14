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
  drawImages: number;
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
    drawImage() {
      record.drawImages += 1;
    },
  };
  return {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === "2d" && withContext ? ctx : null),
    toDataURL: () => "data:image/png;base64,fake",
  };
}

/**
 * The artwork image loads asynchronously in real browsers; in jsdom it never
 * gains a natural size, so applyFaviconBadge always takes the onload path.
 * This helper swaps globalThis.Image for a controllable stub and returns a
 * fireLoad() trigger plus a restore() cleanup.
 */
function captureImage() {
  let onload: (() => void) | null = null;
  const fakeImage = {
    src: "",
    complete: false,
    naturalWidth: 0,
    get onload() {
      return onload;
    },
    set onload(fn: (() => void) | null) {
      onload = fn;
    },
  };
  const spy = vi
    .spyOn(globalThis, "Image")
    .mockImplementation(() => fakeImage as unknown as HTMLImageElement);
  return {
    fireLoad: () => onload?.(),
    restore: () => spy.mockRestore(),
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

  it("draws the brand artwork with no status dot for idle (onload path)", () => {
    const record: DrawRecord = { fills: [], strokes: [], drawImages: 0 };
    const img = captureImage();
    mockCanvas(makeFakeCanvas(record));

    applyFaviconBadge("idle");
    expect(record.drawImages).toBe(0); // artwork not loaded yet

    img.fireLoad();
    expect(record.drawImages).toBe(1); // artwork drawn
    expect(record.fills).toEqual([]); // no dot for idle

    img.restore();
  });

  it("adds a white gap ring and colored dot for attention", () => {
    const record: DrawRecord = { fills: [], strokes: [], drawImages: 0 };
    const img = captureImage();
    mockCanvas(makeFakeCanvas(record));

    applyFaviconBadge("attention");
    img.fireLoad();

    expect(record.drawImages).toBe(1);
    expect(record.fills).toEqual(["#ffffff", "#ef4444"]);
    img.restore();
  });

  it("draws the amber dot for working once the image loads", () => {
    const record: DrawRecord = { fills: [], strokes: [], drawImages: 0 };
    const img = captureImage();
    mockCanvas(makeFakeCanvas(record));

    applyFaviconBadge("working");
    expect(record.drawImages).toBe(0);

    img.fireLoad();
    expect(record.drawImages).toBe(1);
    expect(record.fills).toEqual(["#ffffff", "#f59e0b"]);
    img.restore();
  });

  it("is a no-op when canvas 2d context is unavailable", () => {
    const record: DrawRecord = { fills: [], strokes: [], drawImages: 0 };
    const img = captureImage();
    mockCanvas(makeFakeCanvas(record, false));

    expect(() => applyFaviconBadge("working")).not.toThrow();
    expect(record.drawImages).toBe(0);
    expect(
      document.querySelector('link[rel="icon"][data-badge="1"]'),
    ).toBeNull();
    img.restore();
  });
});
