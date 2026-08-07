import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const source = readFileSync(join(repoRoot, "build.bat"), "utf8");
const webPackage = JSON.parse(readFileSync(join(repoRoot, "web", "package.json"), "utf8"));

test("build.bat runs the production WebUI guard before anything can replace the served build", () => {
  const guard = source.indexOf("node scripts\\production-webui-build-guard.mjs");
  const npmInstall = source.indexOf("call npm install");
  const build = source.indexOf("call node scripts\\build-web.mjs");

  assert.ok(guard >= 0, "build.bat must run the guard to detect a running WebUI");
  assert.ok(guard < npmInstall, "guard must run before dependency installation");
  assert.ok(guard < build, "guard must run before the build");
  // build-web.mjs would otherwise run the guard a second time.
  assert.match(source, /build-web\.mjs --skip-guard/);
});

test("build.bat does not stop or restart the WebUI automatically", () => {
  // The guard must be called without --stop/--restart so it never stops the
  // running WebUI. A running WebUI must cause the build to cancel, not a silent
  // server shutdown that crashes the browser.
  assert.doesNotMatch(
    source,
    /production-webui-build-guard\.mjs\s+--stop/,
    "build.bat must not pass --stop to the guard",
  );
  assert.doesNotMatch(
    source,
    /production-webui-build-guard\.mjs\s+--restart/,
    "build.bat must not pass --restart to the guard",
  );
  assert.doesNotMatch(
    source,
    /RESTART_WEBUI/,
    "build.bat must not track a restart flag",
  );
  assert.doesNotMatch(
    source,
    /:webui_stopped_hint/,
    "build.bat must not carry the old stopped-hint label",
  );
});

test("build.bat cancels with a clear message when the guard fails", () => {
  const guard = source.indexOf("node scripts\\production-webui-build-guard.mjs");
  const cancel = source.indexOf('Build cancelled. Stop the running production WebUI');
  assert.ok(guard >= 0, "guard must be invoked");
  assert.ok(cancel > guard, "cancel message must follow the guard invocation");
});

test("build.bat tells the user to start the WebUI after a successful build", () => {
  assert.match(
    source,
    /Start the WebUI from the tray or OpenCodeWebUI\.exe to serve the new build\./,
  );
});

test("direct npm builds go through the mirror entry point", () => {
  assert.match(webPackage.scripts.build, /build-web\.mjs/);
});

test("build.bat resolves NEXT_DIST_DIR via web-build-mirror.mjs before the build and checks %NEXT_DIST_DIR%\\BUILD_ID", () => {
  const distDirResolve = source.indexOf("node scripts\\web-build-mirror.mjs --dist-dir");
  const build = source.indexOf("call node scripts\\build-web.mjs");
  assert.ok(distDirResolve >= 0, "build.bat must resolve the dist dir via web-build-mirror.mjs");
  assert.ok(build >= 0, "build.bat must build through scripts\\build-web.mjs");
  assert.ok(distDirResolve < build, "dist dir resolution must run before the build");
  assert.ok(
    source.includes('if not exist "%NEXT_DIST_DIR%\\BUILD_ID"'),
    "final BUILD_ID check must use %NEXT_DIST_DIR%\\BUILD_ID",
  );
  assert.ok(
    !source.includes('if not exist "web\\.next\\BUILD_ID"'),
    "build.bat must not check web\\.next\\BUILD_ID for the production output",
  );
  // The mirror carries its own node_modules, so the old NODE_PATH fallback
  // for an external distDir must be gone.
  assert.ok(
    !source.includes('set "NODE_PATH='),
    "build.bat must not set NODE_PATH any more",
  );
});