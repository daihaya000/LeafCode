import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OC_PATH_TEMPLATES } from "./opencode-paths";

/**
 * `opencode-paths.ts` detects engine API drift by type-checking its templates
 * against `opencode-schema.d.ts`. That guarantee is only worth anything if the
 * generated `.d.ts` actually reflects the committed spec — a stale generated
 * file would happily keep validating endpoints the engine already removed.
 *
 * `npm run gen:types` is the only supported way to refresh it
 * (`openapi-typescript ../docs/opencode/openapi.json -o src/lib/opencode-schema.d.ts`).
 * Running the generator inside a unit test would be slow and would need the
 * dev dependency at test time, so instead this compares the *path surface* of
 * both files, which is the part `opencode-paths.ts` depends on.
 */

const SPEC_PATH = join(process.cwd(), "../docs/opencode/openapi.json");
const SCHEMA_PATH = join(process.cwd(), "src/lib/opencode-schema.d.ts");
const VERSION_PATH = join(process.cwd(), "../docs/opencode/VERSION");

function specPaths(): Set<string> {
  const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as {
    paths?: Record<string, unknown>;
  };
  return new Set(Object.keys(spec.paths ?? {}));
}

/**
 * Keys of the generated `paths` interface. They are emitted as quoted
 * properties at exactly four-space indentation inside `export interface paths`,
 * which is what lets this pick them out without parsing TypeScript.
 */
function generatedPaths(): Set<string> {
  const source = readFileSync(SCHEMA_PATH, "utf8");
  const start = source.indexOf("export interface paths {");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\nexport interface ", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);
  const out = new Set<string>();
  for (const m of body.matchAll(/^ {4}"([^"]+)": \{$/gm)) out.add(m[1]);
  return out;
}

describe("opencode-schema.d.ts freshness", () => {
  it("declares exactly the endpoints the committed OpenAPI spec declares", () => {
    const spec = specPaths();
    const generated = generatedPaths();
    // Sanity-check both extractors before comparing, so a parsing failure
    // cannot make the comparison pass with two empty sets.
    expect(spec.size).toBeGreaterThan(100);
    expect(generated.size).toBeGreaterThan(100);

    const missingFromTypes = [...spec].filter((p) => !generated.has(p)).sort();
    const extraInTypes = [...generated].filter((p) => !spec.has(p)).sort();
    // A non-empty diff means `opencode-schema.d.ts` is stale: run
    // `npm run gen:types` in `web/` and commit the result.
    expect({ missingFromTypes, extraInTypes }).toEqual({
      missingFromTypes: [],
      extraInTypes: [],
    });
  });

  it("keeps every path in the registry resolvable in the committed spec", () => {
    // The `satisfies keyof OcPaths` clause already checks this against the
    // generated types at compile time; this repeats it against the spec so the
    // registry cannot be validated purely by a stale generated file.
    const spec = specPaths();
    const unknown = Object.entries(OC_PATH_TEMPLATES)
      .filter(([, template]) => !spec.has(template))
      .map(([name, template]) => `${name} -> ${template}`);
    expect(unknown).toEqual([]);
  });

  it("records the engine version the spec was captured from", () => {
    // `docs/opencode/VERSION` is the human-readable baseline for "which
    // OpenCode CLI does this schema describe", used when deciding whether a
    // v1 endpoint is safe to drop.
    const version = readFileSync(VERSION_PATH, "utf8").trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
