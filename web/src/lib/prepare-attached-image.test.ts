/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREPARE_IMAGE_SKIP_BYTES,
  prepareAttachedImage,
} from "./prepare-attached-image";

function stubCanvas(blob: Blob) {
  const ctx = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => {
    cb(blob);
  });
}

describe("prepareAttachedImage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 4000,
        height: 3000,
        close: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the original data URL for small images under the skip threshold", async () => {
    const file = new File([new Uint8Array(64)], "tiny.png", { type: "image/png" });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 100,
        height: 80,
        close: vi.fn(),
      })),
    );
    Object.defineProperty(file, "size", { value: PREPARE_IMAGE_SKIP_BYTES - 1 });

    const prepared = await prepareAttachedImage(file);
    expect(prepared.mime).toBe("image/png");
    expect(prepared.uri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("re-encodes oversized photos as jpeg", async () => {
    const jpegBytes = new Uint8Array(2_000);
    stubCanvas(new Blob([jpegBytes], { type: "image/jpeg" }));
    const huge = new Uint8Array(PREPARE_IMAGE_SKIP_BYTES + 50_000);
    const file = new File([huge], "photo.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: huge.length });

    const prepared = await prepareAttachedImage(file);
    expect(prepared.mime).toBe("image/jpeg");
    expect(prepared.uri.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(prepared.name).toBe("photo.jpg");
  });
});
