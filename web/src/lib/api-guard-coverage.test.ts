import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_API_ROUTES } from "./api-guard";

/**
 * Default-deny enforcement.
 *
 * Every `/api/**` route handler must call a guard before doing work. Adding a
 * route without one previously left it open to the whole LAN — this test is what
 * stops that regressing, so treat a failure here as a security bug, not a lint
 * nit. If a new route genuinely must be public, add it to `PUBLIC_API_ROUTES`
 * with a comment explaining why.
 */

const repoRoot = join(__dirname, "..", "..", "..");
const webRoot = join(repoRoot, "web");

const HANDLER_RE =
  /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/g;

function routeFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "web/src/app/api/**/route.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => !f.endsWith(".test.ts"));
}

function routeName(rel: string): string {
  return rel.replace("web/src/app/api/", "/api/").replace("/route.ts", "");
}

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/**
 * Some routes only re-export a handler that lives outside `web/src`, e.g.
 * `export { GET } from "@addons/codexbar/api/usage"`. The guard has to be in the
 * implementation, so resolve and read that file too. Same for re-exports
 * through the `@/lib/` alias (e.g. the thin `/api/opencode/[...path]` route
 * that re-exports `proxy` from `@/lib/opencode-proxy/proxy`).
 */
function withReExportedSources(rel: string, text: string): string {
  let combined = text;
  const tryRead = (candidate: string): boolean => {
    try {
      combined += readFileSync(candidate, "utf8");
      return true;
    } catch {
      return false;
    }
  };
  for (const m of text.matchAll(
    /export\s*\{[^}]*\}\s*from\s*["']@addons\/([^"']+)["']/g,
  )) {
    for (const ext of [".ts", ".tsx"]) {
      if (tryRead(join(repoRoot, "addons", m[1] + ext))) break;
    }
  }
  for (const m of text.matchAll(
    /export\s*\{[^}]*\}\s*from\s*["']@\/lib\/([^"']+)["']/g,
  )) {
    for (const ext of [".ts", ".tsx"]) {
      if (tryRead(join(webRoot, "src", "lib", m[1] + ext))) break;
    }
  }
  return combined;
}

describe("API guard coverage", () => {
  const files = routeFiles();

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("guards every route that is not explicitly public", () => {
    const publicRoutes = new Set<string>(PUBLIC_API_ROUTES);
    const unguarded: string[] = [];

    for (const rel of files) {
      const route = routeName(rel);
      if (publicRoutes.has(route)) continue;
      const text = withReExportedSources(rel, read(rel));
      const guarded =
        text.includes("requireAuthorized") || text.includes("requireHostMachine");
      if (!guarded) unguarded.push(route);
    }

    expect(unguarded).toEqual([]);
  });

  it("declares a guard call for each exported handler", () => {
    const publicRoutes = new Set<string>(PUBLIC_API_ROUTES);
    const suspicious: string[] = [];

    for (const rel of files) {
      const route = routeName(rel);
      if (publicRoutes.has(route)) continue;
      const text = withReExportedSources(rel, read(rel));

      const handlers = [...text.matchAll(HANDLER_RE)].map((m) => m[1]);
      const guardCalls = [
        ...text.matchAll(/require(?:Authorized|HostMachine)\s*\(/g),
      ].length;

      // Handlers may share one implementation (`export const GET = proxy`), so
      // one guard call can legitimately cover several exports. What must never
      // happen is exported handlers with no guard call at all.
      const distinctImpls = new Set(
        [...text.matchAll(/export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*=\s*(\w+)/g)].map(
          (m) => m[1],
        ),
      );
      const functionHandlers = [
        ...text.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/g),
      ].length;
      const needed = functionHandlers + distinctImpls.size;

      if (handlers.length > 0 && guardCalls < needed) {
        suspicious.push(`${route}: ${guardCalls} guard call(s) for ${needed} implementation(s)`);
      }
    }

    expect(suspicious).toEqual([]);
  });

  it("keeps the public allowlist small and intentional", () => {
    // Growing this list silently is how default-deny erodes.
    expect([...PUBLIC_API_ROUTES].sort()).toEqual([
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/session",
      "/api/health",
      "/api/theme",
    ]);
  });

  it("routes the OpenCode catch-all proxy through the guard", () => {
    // Highest-value target: an unguarded proxy here is remote code execution,
    // because the agent runs shell commands on the host. The route is a thin
    // re-export of `@/lib/opencode-proxy/proxy`, so resolve that source too.
    const rel = "web/src/app/api/opencode/[...path]/route.ts";
    const text = withReExportedSources(rel, read(rel));
    expect(text).toContain("requireAuthorized");
    const guardAt = text.indexOf("requireAuthorized(req)");
    const paramsAt = text.indexOf("await context.params");
    expect(guardAt).toBeGreaterThan(0);
    // The guard must run before any request handling.
    expect(guardAt).toBeLessThan(paramsAt);
  });

  it("does not leave the old loopback-only helpers in route files", () => {
    // `rejectUnlessLocal*` skips the CSRF check, so routes must use the shared
    // gate instead.
    const stale: string[] = [];
    for (const rel of files) {
      const text = read(rel);
      if (/rejectUnlessLocal(?:OrAuthenticated|OrPrivateNetwork)?\s*\(/.test(text)) {
        stale.push(routeName(rel));
      }
    }
    expect(stale).toEqual([]);
  });
});

describe("web root sanity", () => {
  it("resolves the web directory", () => {
    expect(() => readFileSync(join(webRoot, "package.json"), "utf8")).not.toThrow();
  });
});
