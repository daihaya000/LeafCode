import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MARKDOWN_BYTES = 1_048_576;

function normalizeWindowsNamespace(value: string): string {
  if (value.slice(0, 8).toLowerCase() === "\\\\?\\unc\\") {
    return `\\\\${value.slice(8)}`;
  }
  return value.startsWith("\\\\?\\") ? value.slice(4) : value;
}

function isUnder(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function GET(request: NextRequest) {
  const directory = request.nextUrl.searchParams.get("directory");
  const requested = request.nextUrl.searchParams.get("path");

  if (!directory || !requested) {
    return errorResponse("directory and path are required", 400);
  }

  const checked = assertAllowedDirectory(directory);
  if (!checked.ok) {
    return errorResponse(checked.error, checked.status);
  }

  let workspace: string;
  try {
    workspace = fs.realpathSync.native(checked.path);
  } catch {
    return errorResponse("project directory was not found", 404);
  }

  const normalizedDirectory = normalizeWindowsNamespace(checked.path);
  const lexical = path.resolve(
    normalizedDirectory,
    normalizeWindowsNamespace(requested),
  );
  if (
    !isUnder(normalizedDirectory, lexical) ||
    path.extname(lexical).toLowerCase() !== ".md"
  ) {
    return errorResponse("Markdown path is outside the project", 403);
  }

  let real: string;
  try {
    real = fs.realpathSync.native(lexical);
  } catch {
    return errorResponse("Markdown file was not found", 404);
  }

  if (
    !isUnder(
      normalizeWindowsNamespace(workspace),
      normalizeWindowsNamespace(real),
    ) ||
    path.extname(real).toLowerCase() !== ".md"
  ) {
    return errorResponse("Markdown path is outside the project", 403);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    return errorResponse("Markdown file was not found", 404);
  }
  if (!stat.isFile()) {
    return errorResponse("Markdown path is not a file", 400);
  }
  if (stat.size > MAX_MARKDOWN_BYTES) {
    return errorResponse("Markdown file is too large", 413);
  }

  try {
    const buffer = fs.readFileSync(real);
    if (buffer.byteLength > MAX_MARKDOWN_BYTES) {
      return errorResponse("Markdown file is too large", 413);
    }
    return NextResponse.json({
      name: path.basename(lexical),
      content: buffer.toString("utf8"),
    });
  } catch {
    return errorResponse("Markdown file was not found", 404);
  }
}
