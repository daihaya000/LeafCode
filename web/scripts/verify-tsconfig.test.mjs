import assert from "node:assert/strict";
import test from "node:test";
import { relative } from "node:path";
import { cleanTsconfigIncludes, detectAbsoluteDistIncludes } from "./verify-tsconfig.mjs";

const externalDist = "C:\\Users\\test\\AppData\\Roaming\\opencode-webui\\web-build";
const webDir = "C:\\work\\repo\\web";
// What Next.js 15/16 actually writes for an external distDir: syntactically
// relative (leading `..`), but it resolves outside the web dir. See
// docs/specs and the start-webui.bat title fix commit for context.
const relativeEscapingDistEntry = `${relative(webDir, externalDist)}\\types\\**\\*.ts`;

function makeRead(config) {
  return async () => JSON.stringify(config);
}

function makeWrite(store) {
  return async (_, data) => {
    store.pushed = data;
  };
}

test("cleanTsconfigIncludes removes absolute distDir type include", async () => {
  const config = {
    include: [
      "next-env.d.ts",
      "**/*.ts",
      `${externalDist}/types/**/*.ts`.replace(/\//g, "\\"),
    ],
  };
  const store = {};
  const result = await cleanTsconfigIncludes({
    read: makeRead(config),
    write: makeWrite(store),
    tsconfigPath: "/tmp/tsconfig.json",
    webDir,
    distDir: externalDist,
  });
  assert.equal(result.changed, true);
  const next = JSON.parse(store.pushed);
  assert.deepEqual(next.include, [
    "next-env.d.ts",
    "**/*.ts",
    ".next/types/**/*.ts",
  ]);
});

test("cleanTsconfigIncludes removes a relative dotdot path that escapes into the distDir", async () => {
  const config = {
    include: ["next-env.d.ts", "**/*.ts", relativeEscapingDistEntry],
  };
  const store = {};
  const result = await cleanTsconfigIncludes({
    read: makeRead(config),
    write: makeWrite(store),
    tsconfigPath: "/tmp/tsconfig.json",
    webDir,
    distDir: externalDist,
  });
  assert.equal(result.changed, true);
  const next = JSON.parse(store.pushed);
  assert.deepEqual(next.include, [
    "next-env.d.ts",
    "**/*.ts",
    ".next/types/**/*.ts",
  ]);
});

test("detectAbsoluteDistIncludes flags a relative dotdot path that escapes into the distDir", async () => {
  const config = {
    include: ["next-env.d.ts", "**/*.ts", relativeEscapingDistEntry],
  };
  const offenders = await detectAbsoluteDistIncludes({
    read: makeRead(config),
    tsconfigPath: "/tmp/tsconfig.json",
    webDir,
    distDir: externalDist,
  });
  assert.deepEqual(offenders, [relativeEscapingDistEntry]);
});

test("cleanTsconfigIncludes leaves relative entries alone", async () => {
  const config = {
    include: [
      "next-env.d.ts",
      "**/*.ts",
      ".next/types/**/*.ts",
      ".next-e2e/types/**/*.ts",
    ],
  };
  const store = {};
  const result = await cleanTsconfigIncludes({
    read: makeRead(config),
    write: makeWrite(store),
    tsconfigPath: "/tmp/tsconfig.json",
    webDir,
    distDir: externalDist,
  });
  assert.equal(result.changed, false);
  assert.equal(store.pushed, undefined);
});

test("detectAbsoluteDistIncludes flags only absolute distDir type paths", async () => {
  const config = {
    include: [
      "next-env.d.ts",
      `${externalDist}/types/**/*.ts`.replace(/\//g, "\\"),
      ".next/types/**/*.ts",
      ".next-e2e/types/**/*.ts",
    ],
  };
  const offenders = await detectAbsoluteDistIncludes({
    read: makeRead(config),
    tsconfigPath: "/tmp/tsconfig.json",
    webDir,
    distDir: externalDist,
  });
  assert.equal(offenders.length, 1);
  assert.ok(offenders[0].includes("opencode-webui"));
});

test("detectAbsoluteDistIncludes returns empty when clean", async () => {
  const config = {
    include: [
      "next-env.d.ts",
      "**/*.ts",
      ".next/types/**/*.ts",
      ".next-e2e/types/**/*.ts",
    ],
  };
  const offenders = await detectAbsoluteDistIncludes({
    read: makeRead(config),
    tsconfigPath: "/tmp/tsconfig.json",
    webDir,
    distDir: externalDist,
  });
  assert.deepEqual(offenders, []);
});
