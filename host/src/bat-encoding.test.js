import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function listTrackedBatchFiles() {
  const output = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => /\.(bat|cmd)$/i.test(line))
    .map((line) => join(repoRoot, line));
}

const messageDir = join(repoRoot, "scripts", "setup-messages");

// setup.bat reads these straight off disk, so the on-disk listing is the
// authoritative one here (no git indirection).
function listMessageFileNames() {
  return readdirSync(messageDir).filter((name) => name.endsWith(".txt")).sort();
}

function findLineNumber(bytes, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (bytes[i] === 0x0a) {
      line += 1;
    }
  }
  return line;
}

function assertBufferIsAsciiOnly(bytes, filePath) {
  const name = filePath.slice(repoRoot.length + 1);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte > 0x7f) {
      const line = findLineNumber(bytes, i);
      assert.fail(
        `${name} contains a non-ASCII byte at offset ${i} (line ${line}): 0x${byte.toString(16).padStart(2, "0")}`,
      );
    }
  }
}

function assertNoBom(bytes, filePath) {
  const name = filePath.slice(repoRoot.length + 1);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    assert.fail(`${name} has a UTF-8 BOM`);
  }
  if (bytes.length >= 2) {
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
      assert.fail(`${name} has a UTF-16 BOM`);
    }
  }
}

function assertCrLfOnly(bytes, filePath) {
  const name = filePath.slice(repoRoot.length + 1);
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a && (i === 0 || bytes[i - 1] !== 0x0d)) {
      const line = findLineNumber(bytes, i);
      assert.fail(`${name} has a lone LF at offset ${i} (line ${line})`);
    }
  }
  if (bytes.length < 2 || bytes[bytes.length - 2] !== 0x0d || bytes[bytes.length - 1] !== 0x0a) {
    assert.fail(`${name} does not end with CRLF`);
  }
}

test("every tracked batch file is ASCII-only with CRLF line endings", () => {
  const files = listTrackedBatchFiles();
  assert.ok(files.length > 0, "expected at least one tracked .bat/.cmd file");

  for (const filePath of files) {
    const bytes = readFileSync(filePath);
    assertNoBom(bytes, filePath);
    assertBufferIsAsciiOnly(bytes, filePath);
    assertCrLfOnly(bytes, filePath);
  }
});

test("setup message files are UTF-8 without BOM and use CRLF", () => {
  const messageFiles = listMessageFileNames().map((name) => join(messageDir, name));
  assert.ok(messageFiles.length >= 10, `expected at least 10 setup message files, got ${messageFiles.length}`);

  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (const filePath of messageFiles) {
    const bytes = readFileSync(filePath);
    const name = filePath.slice(repoRoot.length + 1);

    assertNoBom(bytes, filePath);

    let text;
    assert.doesNotThrow(
      () => {
        text = decoder.decode(bytes);
      },
      (error) => (error instanceof TypeError ? true : false),
      `${name} is not valid UTF-8`,
    );

    assert.ok(
      bytes.some((byte) => byte > 0x7f),
      `${name} contains only ASCII bytes; Japanese message may be missing`,
    );

    assertCrLfOnly(bytes, filePath);

    const lines = text.split(/\r\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.length === 0 && i === lines.length - 1) {
        continue;
      }
      assert.ok(
        line.startsWith("[Setup] "),
        `${name} line ${i + 1} does not start with '[Setup] ': ${line}`,
      );
    }
  }
});

test("every setup.bat message key has a file and every file is referenced", () => {
  const setupPath = join(repoRoot, "setup.bat");
  const setupText = readFileSync(setupPath, "utf8");
  const lines = setupText.split(/\r\n/);

  const keys = new Set();
  const sayCallRe = /call\s+:say\s+([A-Za-z0-9._-]+)/g;
  const failCallRe = /call\s+:fail\s+\S+\s+"[^"]*"\s+([A-Za-z0-9._-]+)/g;

  for (const line of lines) {
    if (line.includes(":say") && !line.startsWith("call :say")) {
      continue;
    }
    if (line.includes("call :say %~3")) {
      continue;
    }
    let match;
    while ((match = sayCallRe.exec(line)) !== null) {
      keys.add(match[1]);
    }
    while ((match = failCallRe.exec(line)) !== null) {
      keys.add(match[1]);
    }
  }

  assert.ok(keys.size > 0, "expected at least one message key referenced in setup.bat");

  const messageKeys = listMessageFileNames().map((name) => name.slice(0, -".txt".length));

  for (const key of keys) {
    assert.ok(
      messageKeys.includes(key),
      `setup.bat references message key '${key}' but scripts/setup-messages/${key}.txt does not exist`,
    );
  }

  for (const key of messageKeys) {
    assert.ok(
      keys.has(key),
      `scripts/setup-messages/${key}.txt is not referenced by setup.bat`,
    );
  }
});
