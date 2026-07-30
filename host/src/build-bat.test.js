import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const source = readFileSync(join(repoRoot, "build.bat"), "utf8");
const webPackage = JSON.parse(readFileSync(join(repoRoot, "web", "package.json"), "utf8"));

test("build.bat runs the production WebUI guard before npm can modify web/.next", () => {
  const guard = source.indexOf("node scripts\\production-webui-build-guard.mjs");
  const npmInstall = source.indexOf("call npm install");
  const nextBuild = source.indexOf("call npm run build");

  assert.ok(guard >= 0, "build.bat must run the guard to detect a running WebUI");
  assert.ok(guard < npmInstall, "guard must run before dependency installation");
  assert.ok(guard < nextBuild, "guard must run before next build");
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
    /Start the WebUI from the tray or start-webui\.bat to serve the new build\./,
  );
});

test("direct npm builds run the same production WebUI guard", () => {
  assert.match(webPackage.scripts.prebuild, /production-webui-build-guard\.mjs/);
});