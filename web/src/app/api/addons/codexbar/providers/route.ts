// Next.js は route.ts 内の runtime/dynamic を静的解析するため、
// re-export ではなく直接宣言する（addons/codexbar/api/providers.ts と一致させる）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { GET, PUT } from "@addons/codexbar/api/providers";
