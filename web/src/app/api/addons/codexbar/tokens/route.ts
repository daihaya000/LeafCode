// Next.js は route.ts 内の runtime/dynamic を静的解析するため、
// re-export ではなく直接宣言する（addons/codexbar/api/tokens.ts と一致させる）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { GET } from "@addons/codexbar/api/tokens";
