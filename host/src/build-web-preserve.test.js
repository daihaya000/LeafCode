import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  discardPreviousBuild,
  previousBuildDir,
  restorePreviousBuild,
  stashPreviousBuild,
} from "../../scripts/build-web.mjs";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test("previousBuildDir uses a .prev sibling of the dist directory", () => {
  assert.equal(previousBuildDir("C:\\mirror\\web\\.next"), "C:\\mirror\\web\\.next.prev");
});

test("stashPreviousBuild moves an existing BUILD_ID aside and restorePreviousBuild puts it back", () => {
  const root = mkdtempSync(join(tmpdir(), "ocw-build-preserve-"));
  try {
    const distDir = join(root, ".next");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "BUILD_ID"), "good-build\n");

    assert.equal(stashPreviousBuild(distDir), true);
    assert.equal(readFileSync(join(previousBuildDir(distDir), "BUILD_ID"), "utf8"), "good-build\n");

    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "partial"), "failed\n");
    assert.equal(restorePreviousBuild(distDir), true);
    assert.equal(readFileSync(join(distDir, "BUILD_ID"), "utf8"), "good-build\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discardPreviousBuild removes the stashed copy after a successful rebuild", () => {
  const root = mkdtempSync(join(tmpdir(), "ocw-build-discard-"));
  try {
    const distDir = join(root, ".next");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "BUILD_ID"), "old\n");
    assert.equal(stashPreviousBuild(distDir), true);
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "BUILD_ID"), "new\n");
    assert.equal(discardPreviousBuild(distDir), true);
    assert.equal(restorePreviousBuild(distDir), false);
    assert.equal(readFileSync(join(distDir, "BUILD_ID"), "utf8"), "new\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build-web.mjs restores a previous production build when rebuild fails", () => {
  const source = readFileSync(join(repoRoot, "scripts", "build-web.mjs"), "utf8");
  assert.match(source, /stashPreviousBuild\(mirror\.distDir\)/);
  assert.match(source, /restorePreviousBuild\(mirror\.distDir\)/);
  assert.match(source, /discardPreviousBuild\(mirror\.distDir\)/);
  assert.doesNotMatch(
    source,
    /rmSync\(mirror\.distDir, \{ recursive: true, force: true \}\);\s*let status = run/,
    "must not delete .next before stashing the previous build",
  );
});

test("host spawnWeb continues with an existing BUILD_ID when a stale rebuild fails", () => {
  const source = readFileSync(join(repoRoot, "host", "src", "index.js"), "utf8");
  assert.match(source, /rebuildReason === 'stale' && hasBuild/);
  assert.match(source, /continuing with the existing production build/);
});
