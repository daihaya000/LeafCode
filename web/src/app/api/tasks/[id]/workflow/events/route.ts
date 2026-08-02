import { createWorkflowSseEvent, encodeWorkflowHeartbeat, encodeWorkflowSseEvent } from "@/lib/workflow-events";
import { getWorkflow } from "@/lib/workflow-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Ctx): Promise<Response> {
  const { id } = await context.params;
  const initial = getWorkflow(id);
  if (!initial) return Response.json({ error: "task not found" }, { status: 404 });
  const encoder = new TextEncoder();
  let closed = false;
  const parsedLastEventId = Number(req.headers.get("last-event-id") ?? "");
  let lastRevision = Number.isFinite(parsedLastEventId) ? parsedLastEventId : -1;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try { controller.close(); } catch { /* client disconnected */ }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const publish = () => {
        if (closed) return;
        const workflow = getWorkflow(id);
        if (!workflow) return close(controller);
        const revision = workflow.run?.revision ?? workflow.workspaceRevision;
        if (revision === lastRevision) return;
        lastRevision = revision;
        controller.enqueue(encoder.encode(encodeWorkflowSseEvent(createWorkflowSseEvent(id, workflow))));
      };
      req.signal.addEventListener("abort", () => close(controller), { once: true });
      publish();
      pollTimer = setInterval(publish, 1000);
      heartbeatTimer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(encodeWorkflowHeartbeat()));
      }, 15_000);
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });
  return new Response(stream, { headers: {
    "Cache-Control": "no-cache, no-transform", Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no",
  } });
}
