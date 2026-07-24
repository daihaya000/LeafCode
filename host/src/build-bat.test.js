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

  assert.ok(guard >= 0, "build.bat must invoke the running-WebUI guard");
  assert.ok(guard < npmInstall, "guard must run before dependency installation");
  assert.ok(guard < nextBuild, "guard must run before next build");
  assert.match(source.slice(guard, npmInstall), /if errorlevel 1/);
});

test("direct npm builds run the same production WebUI guard", () => {
  assert.match(webPackage.scripts.prebuild, /production-webui-build-guard\.mjs/);
});
