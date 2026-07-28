import type { Part } from "./types";

const IMAGE_MIME_RE = /^image\//i;

/** True when a part renders as an inline image thumbnail (mirrors PartView's "file" case). */
export function isImageFilePart<T extends Pick<Part, "type" | "url" | "mime">>(
  part: T,
): part is T & { url: string } {
  return part.type === "file" && Boolean(part.url) && IMAGE_MIME_RE.test(part.mime ?? "");
}

export type PartRenderGroup<T> =
  | { kind: "images"; key: string; items: T[] }
  | { kind: "single"; key: string; item: T };

/**
 * Groups consecutive image-attachment parts so callers can render them in a
 * flex-wrap row instead of one-per-row (PartView renders each part as its own
 * block-level element).
 */
export function groupImagePartsForRender<
  T extends { id: string; type: string; url?: string; mime?: string },
>(parts: T[]): PartRenderGroup<T>[] {
  const groups: PartRenderGroup<T>[] = [];
  for (const part of parts) {
    if (isImageFilePart(part)) {
      const last = groups[groups.length - 1];
      if (last && last.kind === "images") {
        last.items.push(part);
        continue;
      }
      groups.push({ kind: "images", key: `img-${part.id}`, items: [part] });
    } else {
      groups.push({ kind: "single", key: part.id, item: part });
    }
  }
  return groups;
}
