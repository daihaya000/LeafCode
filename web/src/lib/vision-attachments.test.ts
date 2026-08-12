import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  root: "",
}));

vi.mock("./paths", () => ({
  dataDir: () => h.root,
  dbPath: () => path.join(h.root, "webui.db"),
  ensureDataDir: () => fs.mkdirSync(h.root, { recursive: true }),
}));

import {
  __resetVisionAttachmentPruneForTest,
  isVisionAttachmentId,
  readVisionAttachment,
  saveVisionAttachment,
} from "./vision-attachments";

// 1x1 transparent PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const roots: string[] = [];

beforeEach(() => {
  h.root = fs.mkdtempSync(path.join(os.tmpdir(), "webui-vision-"));
  roots.push(h.root);
  __resetVisionAttachmentPruneForTest();
});

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("saveVisionAttachment", () => {
  it("stores a png and reads it back with its mime", () => {
    const id = saveVisionAttachment(PNG, "image/png");
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    const read = readVisionAttachment(id!);
    expect(read?.mime).toBe("image/png");
    expect(read?.bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  });

  it("is content addressed, so a re-sent image reuses one file", () => {
    expect(saveVisionAttachment(PNG, "image/png")).toBe(
      saveVisionAttachment(PNG, "image/png"),
    );
    expect(fs.readdirSync(path.join(h.root, "vision-attachments"))).toHaveLength(1);
  });

  it("refuses script-capable and unknown formats", () => {
    expect(saveVisionAttachment("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "image/svg+xml"))
      .toBeNull();
    expect(saveVisionAttachment(PNG, "text/html")).toBeNull();
  });

  it("refuses empty payloads and malformed data urls", () => {
    expect(saveVisionAttachment("data:image/png;base64,", "image/png")).toBeNull();
    expect(saveVisionAttachment("not-a-data-url", "image/png")).toBeNull();
  });
});

describe("readVisionAttachment", () => {
  it("rejects ids that are not content hashes", () => {
    expect(isVisionAttachmentId("../../webui.db")).toBe(false);
    expect(readVisionAttachment("../../webui.db")).toBeNull();
    expect(readVisionAttachment("A".repeat(64))).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(readVisionAttachment("f".repeat(64))).toBeNull();
  });
});
