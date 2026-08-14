import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  mirrorDistDir,
  mirrorSlug,
  mirrorWebDir,
  resolveMirrorRoot,
  syncMirror,
} from "../../scripts/web-build-mirror.mjs";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "ocw-mirror-"));
  const install = join(root, "install");
  const mirror = join(root, "mirror");
  mkdirSync(join(install, "web", "src"), { recursive: true });
  mkdirSync(join(install, "web", "public"), { recursive: true });
  mkdirSync(join(install, "addons"), { recursive: true });
  writeFileSync(join(install, "web", "src", "app.ts"), "export const a = 1;\n");
  writeFileSync(join(install, "web", "tsconfig.json"), '{"compilerOptions":{}}\n');
  writeFileSync(join(install, "web", "public", "logo.svg"), "<svg/>\n");
  writeFileSync(join(install, "addons", "widget.tsx"), "export {};\n");
  return { root, install, mirror };
}

test("resolveMirrorRoot: explicit LEAFCODE_BUILD_DIR wins", () => {
  const env = { LEAFCODE_BUILD_DIR: join("C:", "tmp", "ocw-build") };
  assert.equal(resolveMirrorRoot(env, "C:\\repo"), resolve(env.LEAFCODE_BUILD_DIR));
});

test("resolveMirrorRoot: separates installations by path so two checkouts never collide", () => {
  const env = { LOCALAPPDATA: join("C:", "Users", "t", "AppData", "Local") };
  const a = resolveMirrorRoot(env, join("C:", "one", "OpenCodeWebUI"));
  const b = resolveMirrorRoot(env, join("C:", "two", "OpenCodeWebUI"));
  assert.notEqual(a, b);
  assert.ok(a.startsWith(join(env.LOCALAPPDATA, "opencode-webui", "build")));
});

test("mirrorSlug: case and slash differences of the same path give the same slug", () => {
  assert.equal(mirrorSlug("C:\\Repo\\OpenCodeWebUI"), mirrorSlug("c:/repo/opencodewebui"));
});

test("mirrorDistDir stays inside the mirrored project (the Turbopack constraint)", () => {
  const root = join("C:", "build", "ocw");
  assert.equal(mirrorDistDir(root), join(mirrorWebDir(root), ".next"));
  assert.ok(mirrorDistDir(root).startsWith(mirrorWebDir(root)));
});

test("syncMirror: hard-links sources and copies build-written paths", () => {
  const { install, mirror } = sandbox();
  const result = syncMirror({ installRoot: install, mirrorRoot: mirror });

  assert.ok(result.linked > 0);
  assert.equal(
    readFileSync(join(mirror, "web", "src", "app.ts"), "utf8"),
    "export const a = 1;\n",
  );

  // Linked file: one inode shared with the source.
  const src = statSync(join(install, "web", "src", "app.ts"));
  const linked = statSync(join(mirror, "web", "src", "app.ts"));
  assert.equal(linked.ino, src.ino);
  assert.ok(linked.nlink >= 2);

  // Copied file: a separate inode, so `next build` rewriting tsconfig.json in
  // the mirror cannot reach back into the installation.
  const tsconfigSrc = statSync(join(install, "web", "tsconfig.json"));
  const tsconfigMirror = statSync(join(mirror, "web", "tsconfig.json"));
  assert.notEqual(tsconfigMirror.ino, tsconfigSrc.ino);
  const publicSrc = statSync(join(install, "web", "public", "logo.svg"));
  const publicMirror = statSync(join(mirror, "web", "public", "logo.svg"));
  assert.notEqual(publicMirror.ino, publicSrc.ino);

  rmSync(join(mirror, ".."), { recursive: true, force: true });
});

test("syncMirror: a second run is incremental and refreshes only changed files", () => {
  const { install, mirror } = sandbox();
  syncMirror({ installRoot: install, mirrorRoot: mirror });

  writeFileSync(join(install, "web", "src", "app.ts"), "export const a = 2;\n");
  const second = syncMirror({ installRoot: install, mirrorRoot: mirror });

  assert.ok(second.unchanged > 0, "untouched files must not be relinked");
  assert.equal(
    readFileSync(join(mirror, "web", "src", "app.ts"), "utf8"),
    "export const a = 2;\n",
  );

  rmSync(join(mirror, ".."), { recursive: true, force: true });
});

test("syncMirror: prunes files the installation no longer has, but keeps the build output", () => {
  const { install, mirror } = sandbox();
  syncMirror({ installRoot: install, mirrorRoot: mirror });

  mkdirSync(join(mirror, "web", ".next"), { recursive: true });
  writeFileSync(join(mirror, "web", ".next", "BUILD_ID"), "abc\n");
  rmSync(join(install, "addons", "widget.tsx"));

  const result = syncMirror({ installRoot: install, mirrorRoot: mirror });
  assert.ok(result.removed > 0);
  assert.throws(() => statSync(join(mirror, "addons", "widget.tsx")));
  assert.equal(readFileSync(join(mirror, "web", ".next", "BUILD_ID"), "utf8"), "abc\n");

  rmSync(join(mirror, ".."), { recursive: true, force: true });
});

test("syncMirror: refuses a mirror inside the installation (it would mirror itself)", () => {
  const { install } = sandbox();
  assert.throws(
    () => syncMirror({ installRoot: install, mirrorRoot: join(install, "mirror") }),
    /must not live inside/,
  );
});
