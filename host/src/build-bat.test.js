import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const source = readFileSync(join(repoRoot, "build.bat"), "utf8");
const webPackage = JSON.parse(readFileSync(join(repoRoot, "web", "package.json"), "utf8"));

test("build.bat runs the production WebUI guard before npm can modify web/.next", () => {
  const guard = source.indexOf("node scripts\\production-webui-build-guard.mjs --stop");
  const npmInstall = source.indexOf("call npm install");
  const nextBuild = source.indexOf("call npm run build");

  assert.ok(guard >= 0, "build.bat must stop a running WebUI through the guard");
  assert.ok(guard < npmInstall, "guard must run before dependency installation");
  assert.ok(guard < nextBuild, "guard must run before next build");
});

test("build.bat treats guard exit 10 as 'stopped, continue' and anything else as fatal", () => {
  const guard = source.indexOf("node scripts\\production-webui-build-guard.mjs --stop");
  const preamble = source.slice(guard, source.indexOf("call npm install"));

  assert.match(preamble, /set "GUARD_EXIT=%ERRORLEVEL%"/);
  assert.match(preamble, /if "%GUARD_EXIT%"=="10" set "RESTART_WEBUI=1"/);
  assert.match(
    preamble,
    /if not "%GUARD_EXIT%"=="0" if not "%GUARD_EXIT%"=="10" \(/,
    "exit codes other than 0/10 must cancel the build",
  );
  assert.match(preamble, /exit \/b 1/);
  assert.doesNotMatch(preamble, /if errorlevel 1/, "errorlevel N is a >=N test and would trap 10");
});

test("build.bat restarts the WebUI only after a successful build", () => {
  const restart = source.indexOf("node scripts\\production-webui-build-guard.mjs --restart");
  const buildOk = source.indexOf("Build OK");
  const buildIdCheck = source.indexOf('if not exist "web\\.next\\BUILD_ID"');

  assert.ok(restart >= 0, "build.bat must ask the host to start the WebUI again");
  assert.ok(buildIdCheck < restart, "restart must come after the BUILD_ID verification");
  assert.ok(buildOk < restart, "restart must come after the success message");
  assert.match(source.slice(buildOk, restart), /if "%RESTART_WEBUI%"=="1" \(/);
  assert.match(source, /:webui_stopped_hint/, "failure paths must tell the user the WebUI is down");
});

test("direct npm builds run the same production WebUI guard", () => {
  assert.match(webPackage.scripts.prebuild, /production-webui-build-guard\.mjs/);
});
