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
 * Draw a branded favicon with an optional status dot, then swap it in via a
 * dedicated <link rel="icon"> element. The design mirrors the task-tray icon
 * (host/src/icon.json): a blue #2563eb rounded square with a white terminal
 * prompt glyph (">" chevron + "_" cursor). Geometry is the tray's 32px grid
 * scaled 2x to the 64px canvas. No-op outside the browser or when canvas is
 * unavailable.
 */
export function applyFaviconBadge(state: NotifyState): void {
  if (typeof document === "undefined") return;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Tray-blue rounded square background.
  ctx.fillStyle = "#2563eb";
  roundRect(ctx, 0, 0, size, size, 13);
  ctx.fill();

  // ">" chevron (tray: caps at (7.5,9.5)/(7.5,21.5), vertex at (14,15.5),
  // 5px stroke on the 32px grid).
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(15, 19);
  ctx.lineTo(28, 31);
  ctx.lineTo(15, 43);
  ctx.stroke();

  // "_" cursor (tray: x 14-23, y 19-23 on the 32px grid).
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 28, 38, 18, 8, 4);
  ctx.fill();

  const color = badgeColor(state);
  if (color) {
    const cx = size - 16;
    const cy = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff"; // gap ring so the dot reads on the blue tile
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
