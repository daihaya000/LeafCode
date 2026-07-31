import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const SKIP_DIR_NAMES = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
]);

function listTrackedBatchFiles() {
  const output = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => /\.(bat|cmd)$/i.test(line))
    .map((line) => join(repoRoot, line));
}

/** Walk the working tree so untracked local bats cannot slip into a hand-zipped release. */
function listOnDiskBatchFiles(dir = repoRoot, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listOnDiskBatchFiles(full, out);
      continue;
    }
    if (/\.(bat|cmd)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const messageDir = join(repoRoot, "scripts", "setup-messages");

// scripts/start-webui.bat reads these straight off disk, so the on-disk
// listing is the authoritative one here (no git indirection).
function listMessageFileNames() {
  return readdirSync(messageDir).filter((name) => name.endsWith(".txt")).sort();
}

// git archive only ships tracked files, so the distribution-contract test
// must filter out untracked message files (e.g. a newly added file that the
// main agent has not committed yet). The on-disk test above still validates
// every file regardless of tracking status.
function listTrackedMessageFileNames() {
  const output = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  const prefix = "scripts/setup-messages/";
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix) && line.endsWith(".txt"))
    .map((line) => line.slice(prefix.length))
    .sort();
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

function relName(filePath) {
  return relative(repoRoot, filePath).split(sep).join("/");
}

function assertBufferIsAsciiOnly(bytes, filePath) {
  const name = relName(filePath);
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
  const name = relName(filePath);
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
  const name = relName(filePath);
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

function assertSafeBatchBytes(filePath) {
  const bytes = readFileSync(filePath);
  assertNoBom(bytes, filePath);
  assertBufferIsAsciiOnly(bytes, filePath);
  assertCrLfOnly(bytes, filePath);
}

/** Extract fenced ```bat / ```cmd blocks from markdown. */
function extractBatFences(markdownText) {
  const blocks = [];
  const re = /```(?:bat|cmd)\r?\n([\s\S]*?)```/gi;
  let match;
  while ((match = re.exec(markdownText)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function assertAsciiText(label, text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) {
      const line = text.slice(0, i).split(/\r?\n/).length;
      assert.fail(
        `${label} contains non-ASCII at line ${line}: U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
      );
    }
  }
}

test("every tracked batch file is ASCII-only with CRLF line endings", () => {
  const files = listTrackedBatchFiles();
  assert.ok(files.length > 0, "expected at least one tracked .bat/.cmd file");

  for (const filePath of files) {
    assertSafeBatchBytes(filePath);
  }
});

test("every on-disk batch file (including untracked) is ASCII-only with CRLF", () => {
  const files = listOnDiskBatchFiles();
  assert.ok(files.length > 0, "expected at least one on-disk .bat/.cmd file");

  for (const filePath of files) {
    assertSafeBatchBytes(filePath);
  }
});

test("setup message files are UTF-8 without BOM and use CRLF", () => {
  const messageFiles = listMessageFileNames().map((name) => join(messageDir, name));
  assert.ok(messageFiles.length >= 10, `expected at least 10 setup message files, got ${messageFiles.length}`);

  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (const filePath of messageFiles) {
    const bytes = readFileSync(filePath);
    const name = relName(filePath);

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
        line.startsWith("[OpenCode WebUI] "),
        `${name} line ${i + 1} does not start with '[OpenCode WebUI] ': ${line}`,
      );
    }
  }
});

test("every scripts/start-webui.bat message key has a file and every file is referenced", () => {
  const setupPath = join(repoRoot, "scripts", "start-webui.bat");
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

  assert.ok(keys.size > 0, "expected at least one message key referenced in scripts/start-webui.bat");

  const messageKeys = listMessageFileNames().map((name) => name.slice(0, -".txt".length));

  for (const key of keys) {
    assert.ok(
      messageKeys.includes(key),
      `scripts/start-webui.bat references message key '${key}' but scripts/setup-messages/${key}.txt does not exist`,
    );
  }

  for (const key of messageKeys) {
    assert.ok(
      keys.has(key),
      `scripts/setup-messages/${key}.txt is not referenced by scripts/start-webui.bat`,
    );
  }
});

test("README and docs ```bat/```cmd fences stay ASCII-only", () => {
  const markdownPaths = [
    join(repoRoot, "README.md"),
    join(repoRoot, "docs", "specs", "bat-encoding-safety.md"),
  ];

  for (const filePath of markdownPaths) {
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath, "utf8");
    const blocks = extractBatFences(text);
    for (let i = 0; i < blocks.length; i += 1) {
      assertAsciiText(`${relName(filePath)} bat fence #${i + 1}`, blocks[i]);
    }
  }
});

test("git archive ships batch files as ASCII + CRLF (distribution contract)", () => {
  const tracked = listTrackedBatchFiles().map((p) => relName(p));
  assert.ok(tracked.length > 0);

  const staging = mkdtempSync(join(tmpdir(), "ocw-encoding-archive-"));
  try {
    const tarPath = join(staging, "repo.tar");
    const extractDir = join(staging, "out");
    mkdirSync(extractDir, { recursive: true });

    execFileSync("git", ["archive", "--format=tar", "-o", tarPath, "HEAD"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execFileSync("tar", ["-xf", tarPath, "-C", extractDir], { stdio: "pipe" });

    for (const rel of tracked) {
      const archived = join(extractDir, ...rel.split("/"));
      assert.ok(existsSync(archived), `git archive missing ${rel}`);
      assertSafeBatchBytes(archived);
    }

    for (const name of listTrackedMessageFileNames()) {
      const archived = join(extractDir, "scripts", "setup-messages", name);
      assert.ok(existsSync(archived), `git archive missing setup-messages/${name}`);
      const bytes = readFileSync(archived);
      assertNoBom(bytes, archived);
      assertCrLfOnly(bytes, archived);
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});

test("quickaccess PowerShell scripts force UTF-8 stdout", () => {
  const source = readFileSync(join(repoRoot, "web", "src", "lib", "quickaccess.ts"), "utf8");
  assert.match(
    source,
    /UTF8Encoding|OutputEncoding\s*=\s*\[Console\]::OutputEncoding/,
    "quickaccess.ts must set PowerShell OutputEncoding to UTF-8",
  );
  assert.ok(
    source.includes("PS_UTF8"),
    "quickaccess.ts should share a PS_UTF8 preamble for JSON stdout",
  );
});
