import { proxy } from "@/lib/opencode-proxy/proxy";

export { proxy } from "@/lib/opencode-proxy/proxy";
export { __clearGetResponseCacheForTest } from "@/lib/opencode-proxy/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Numeric literal required: Next.js rejects imported segment config.
// Keep in sync with IMAGE_SEND_ROUTE_MAX_DURATION_SEC.
export const maxDuration = 640;

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
