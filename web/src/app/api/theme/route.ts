import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * Runtime theme tokens.
 *
 * `/api/theme?name=oyster` serves `web/themes/<name>.json` from disk on every
 * request, so editing the JSON applies on the next page reload without a
 * rebuild (`next start` re-reads the file). The CSS class in `globals.css`
 * stays as the pre-JS fallback; this endpoint is the live source of truth
 * once the page has hydrated.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whitelist of theme names that may be read from `web/themes/`. */
const THEME_NAMES = new Set(["oyster"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "";
  if (!THEME_NAMES.has(name)) {
    return NextResponse.json({ error: "unknown theme" }, { status: 404 });
  }
  try {
    const file = path.join(process.cwd(), "themes", `${name}.json`);
    const raw = await readFile(file, "utf8");
    return new NextResponse(raw, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "theme not found" }, { status: 404 });
  }
}
