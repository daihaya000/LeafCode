import assert from "node:assert/strict";
import test from "node:test";
import { resolve, join, sep } from "node:path";
import { resolveProductionDistDir } from "../../scripts/web-dist-dir.mjs";

test("resolveProductionDistDir: explicit OPENCODE_WEBUI_DIST_DIR wins and resolves to absolute", () => {
  const env = { OPENCODE_WEBUI_DIST_DIR: "some/relative/path" };
  const result = resolveProductionDistDir(env);
  // A relative value resolves to an absolute path against cwd.
  assert.equal(result, resolve("some/relative/path"));
  assert.ok(result.includes(sep), "expected an absolute path with a separator");
});

test("resolveProductionDistDir: explicit absolute OPENCODE_WEBUI_DIST_DIR is used as-is", () => {
  const abs = join(resolve("/"), "opt", "ocw", "web-build");
  const env = { OPENCODE_WEBUI_DIST_DIR: abs };
  assert.equal(resolveProductionDistDir(env), resolve(abs));
});

test("resolveProductionDistDir: APPDATA falls back to appdata/opencode-webui/web-build", () => {
  const env = { APPDATA: join("C:", "Users", "test", "AppData", "Roaming") };
  assert.equal(
    resolveProductionDistDir(env),
    join(env.APPDATA, "opencode-webui", "web-build"),
  );
});

test("resolveProductionDistDir: no APPDATA + webDir falls back to webDir/.next", () => {
  const webDir = join("C:", "repo", "web");
  const env = {};
  assert.equal(resolveProductionDistDir(env, webDir), join(webDir, ".next"));
});

test("resolveProductionDistDir: neither APPDATA nor webDir falls back to '.next'", () => {
  assert.equal(resolveProductionDistDir({}), ".next");
});

test("resolveProductionDistDir: empty/whitespace env values are ignored (not treated as set)", () => {
  // OPENCODE_WEBUI_DIST_DIR that is empty or whitespace falls through to APPDATA.
  const env = {
    OPENCODE_WEBUI_DIST_DIR: "   ",
    APPDATA: join("C:", "Users", "test", "AppData", "Roaming"),
  };
  assert.equal(
    resolveProductionDistDir(env),
    join(env.APPDATA, "opencode-webui", "web-build"),
  );
  // Empty APPDATA also falls through to webDir.
  const env2 = { OPENCODE_WEBUI_DIST_DIR: "", APPDATA: "  " };
  const webDir = join("C:", "repo", "web");
  assert.equal(resolveProductionDistDir(env2, webDir), join(webDir, ".next"));
});

test("resolveProductionDistDir: defaults to process.env when called with no args", () => {
  // Should not throw and should return a string.
  const result = resolveProductionDistDir();
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});
