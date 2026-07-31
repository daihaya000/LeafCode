import { NextRequest } from "next/server";
import { rejectUnlessLocal } from "@/lib/local-request";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { connectPty, PtyError } from "@/lib/pty-session";
import { logPtyEvent } from "@/lib/pty-audit";
import {
  acquireRelay,
  decodePtyFrame,
  deleteRelay,
  releaseRelay,
  type PtyRelay,
  type PtyRelayEvent,
} from "@/lib/pty-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PTY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * GET /api/pty-session/stream?id=&directory= — SSE stream of PTY output.
 *
 * The browser opens this as a long-lived SSE connection. The BFF opens a real
 * WebSocket to the Engine (`/pty/{id}/connect`) and forwards each received
 * output frame as an SSE `data:` event. Browser input goes through the sibling
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

  // Open (or reuse) the BFF→Engine WebSocket for this PTY. acquireRelay
  // dedupes concurrent callers so a single PTY never gets two Engine sockets.
  let relay: PtyRelay | undefined;
  try {
    relay = await acquireRelay(
      ptyId,
      () => connectPty(dirCheck.path, ptyId),
      (r) => {
        // One decoder per relay so multi-byte UTF-8 split across frames is
        // reassembled instead of turning into replacement characters.
        const decoder = new TextDecoder("utf-8");
        const emit = (event: PtyRelayEvent) => {
          for (const listener of r.listeners) {
            try { listener(event); } catch { /* ignore listener errors */ }
          }
        };
        const onMessage = (ev: MessageEvent) => {
          const text = decodePtyFrame(ev.data, decoder);
          // `null` = meta/control frame; skip without disturbing the stream.
          if (text === null) return;
          emit({ type: "data", data: text });
        };
        const onClose = () => {
          if (r.closed) return;
          r.closed = true;
          deleteRelay(ptyId);
          logPtyEvent(ptyId, "disconnect", { directory: dirCheck.path });
          emit({ type: "close" });
        };
        r.ws.addEventListener("message", onMessage);
        r.ws.addEventListener("close", onClose);
        r.ws.addEventListener("error", onClose);
      },
    );
  } catch (err) {
    const status = err instanceof PtyError ? err.status : 500;
    const message = err instanceof Error ? err.message : "failed to connect";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  relay.refcount += 1;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Heartbeat to keep the connection alive through proxies. Created
      // before the listener so the close handler can clear it.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch { /* closed */ }
      }, 15_000);

      const listener = (event: PtyRelayEvent) => {
        if (event.type === "close") {
          // Sentinel so the client can tell a real PTY exit from a transient
          // network drop and stop its reconnect backoff accordingly.
          clearInterval(heartbeat);
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ t: "exit" })}\n\n`),
            );
          } catch { /* already closed */ }
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        // SSE frame: `data: <json>\n\n`. Payload is kept as a raw string;
        // xterm.js writes/reads UTF-8 strings so no base64 wrapping is needed
        // for typical terminal output.
        const payload = { t: "o", d: event.data };
        const frame = `data: ${JSON.stringify(payload)}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch { /* controller already closed */ }
      };
      relay!.listeners.add(listener);

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
