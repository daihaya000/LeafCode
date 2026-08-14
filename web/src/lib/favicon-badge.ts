export type NotifyState = "attention" | "working" | "idle";

/** Badge dot color for a notification state, or null when no dot should show. */
export function badgeColor(state: NotifyState): string | null {
  switch (state) {
    case "attention":
      return "#ef4444"; // red-500
    case "working":
      return "#f59e0b"; // amber-500
    default:
      return null;
  }
}

function ensureBadgeLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][data-badge="1"]',
  );
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.setAttribute("data-badge", "1");
    document.head.appendChild(link);
  }
  return link;
}

/**
 * Draw a branded favicon with an optional status dot, then swap it in via a
 * dedicated <link rel="icon"> element. The base artwork is the shared brand
 * icon (web/public/icon-192.png, generated from icon/LeafCode.png by
 * scripts/gen-icons.mjs). The status dot is drawn in the top-right corner
 * with a white gap ring so it reads on any artwork. No-op outside the
 * browser or when canvas is unavailable.
 */
export function applyFaviconBadge(state: NotifyState): void {
  if (typeof document === "undefined") return;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // The brand artwork is a rounded-corner tile already; scale it to fill.
  const img = new Image();
  img.src = "/icon-192.png";
  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, size, size);
  } else {
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      drawBadgeDot(ctx, size, state);
      try {
        ensureBadgeLink().href = canvas.toDataURL("image/png");
      } catch {
        // toDataURL can throw in locked-down contexts; ignore.
      }
    };
    return;
  }

  drawBadgeDot(ctx, size, state);
  try {
    ensureBadgeLink().href = canvas.toDataURL("image/png");
  } catch {
    // toDataURL can throw in locked-down contexts; ignore.
  }
}

function drawBadgeDot(
  ctx: CanvasRenderingContext2D,
  size: number,
  state: NotifyState,
): void {
  const color = badgeColor(state);
  if (!color) return;
  const cx = size - 16;
  const cy = 16;
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff"; // gap ring so the dot reads on the tile
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
