import fs from "node:fs";

/**
 * JSONC parsing helpers shared by the web UI (via `jsonc.d.mts` types) and the
 * CLI sync scripts (REFACTORING_PLAN P1-b / IMPROVEMENT 6-1).
 * Single source of truth: `web/src/lib/profiles/jsonc.ts` delegates here.
 */

export function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inStr = false;
  let strCh = "";
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") {
        out += c + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      out += c;
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strCh = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  // JSONC permits trailing commas, but JSON.parse does not.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function readJsonc(path) {
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(stripJsonc(raw));
}

export function writeJsonc(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
