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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
 * Draw a branded favicon ("C" glyph on a dark rounded square) with an optional
 * status dot, then swap it in via a dedicated <link rel="icon"> element.
 * No-op outside the browser or when canvas is unavailable.
 */
export function applyFaviconBadge(state: NotifyState): void {
  if (typeof document === "undefined") return;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#0b0b0c";
  roundRect(ctx, 0, 0, size, size, 14);
  ctx.fill();

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "bold 40px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("C", size / 2, size / 2 + 2);

  const color = badgeColor(state);
  if (color) {
    const cx = size - 16;
    const cy = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#0b0b0c"; // gap ring so the dot reads on any bg
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  try {
    ensureBadgeLink().href = canvas.toDataURL("image/png");
  } catch {
    // toDataURL can throw in locked-down contexts; ignore.
  }
}
