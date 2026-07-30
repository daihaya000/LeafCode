import { NextRequest } from "next/server";
import { rejectUnlessLocal } from "@/lib/local-request";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { connectPty, PtyError } from "@/lib/pty-session";
import {
  deleteRelay,
  getRelay,
  releaseRelay,
  setRelay,
} from "@/lib/pty-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PTY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * GET /api/pty-session/[id]/stream?directory= — SSE stream of PTY output.
 *
 * The browser opens this as a long-lived SSE connection. The BFF opens a real
 * WebSocket to the Engine (`/api/pty/{id}/connect`) and forwards each received
 * message as an SSE `data:` event. Browser input goes through the sibling
 * `input` POST route, which shares the same in-process WebSocket via
 * `pty-relay.ts`.
 *
 * This avoids a custom Next.js server: Route Handlers can stream SSE via
 * ReadableStream but cannot accept HTTP Upgrade.
 */
export async function GET(req: NextRequest) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  const ptyId = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!PTY_ID_RE.test(ptyId)) {
    return new Response(JSON.stringify({ error: "invalid pty id" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const directory = req.nextUrl.searchParams.get("directory")?.trim() ?? "";
  if (!directory) {
    return new Response(JSON.stringify({ error: "directory is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const dirCheck = assertAllowedDirectory(directory);
  if (!dirCheck.ok) {
    return new Response(JSON.stringify({ error: dirCheck.error }), {
      status: dirCheck.status,
      headers: { "content-type": "application/json" },
    });
  }

  // Open (or reuse) the BFF→Engine WebSocket for this PTY.
  let relay = getRelay(ptyId);
  if (!relay) {
    let ws: WebSocket;
    try {
      ws = await connectPty(dirCheck.path, ptyId);
    } catch (err) {
      const status = err instanceof PtyError ? err.status : 500;
      const message = err instanceof Error ? err.message : "failed to connect";
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    relay = { ws, refcount: 0, listeners: new Set(), closed: false };
    setRelay(ptyId, relay);

    const onMessage = (ev: MessageEvent) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      for (const listener of relay!.listeners) {
        try { listener(data); } catch { /* ignore listener errors */ }
      }
    };
    const onClose = () => {
      relay!.closed = true;
      deleteRelay(ptyId);
      for (const listener of relay!.listeners) {
        try { listener(""); } catch { /* ignore */ }
      }
    };
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onClose);
  }
  relay.refcount += 1;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const listener = (data: string) => {
        // Empty data signals the Engine socket closed; end the SSE stream.
        if (data === "" && relay!.closed) {
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        // SSE frame: `data: <json>\n\n`. Payload is kept as a raw string;
        // xterm.js writes/reads UTF-8 strings so no base64 wrapping is needed
        // for typical terminal output.
        const payload = { t: "o", d: data };
        const frame = `data: ${JSON.stringify(payload)}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch { /* controller already closed */ }
      };
      relay!.listeners.add(listener);

      // Heartbeat to keep the connection alive through proxies.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch { /* closed */ }
      }, 15_000);

      // Cleanup when the browser disconnects.
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        relay!.listeners.delete(listener);
        releaseRelay(ptyId);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
