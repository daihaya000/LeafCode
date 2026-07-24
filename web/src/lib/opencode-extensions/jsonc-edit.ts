import fs from "node:fs";
import path from "node:path";
import {
  applyEdits,
  modify,
  parse,
  parseTree,
  type FormattingOptions,
  type Node,
} from "jsonc-parser";
import { ExtensionsError } from "./safe-move";

/**
 * In-process serialization for global config updates. Concurrent toggles
 * (two browser tabs) must not overwrite each other: every mutation runs
 * inside this chain and re-reads the file under the lock.
 *
 * Single-file config mutations must use `updateConfigFile`, which enforces
 * the "re-read → minimal JSONC edit → atomic write" cycle inside the lock.
 * `withConfigLock` is only for transactions that span the config file and
 * the extension state file (configured plugin toggles); those must perform
 * every read inside the locked section as well.
 */
let configLockChain: Promise<unknown> = Promise.resolve();

export function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = configLockChain.then(() => fn());
  configLockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Atomic read-modify-write of a config file under the process lock:
 * re-read the file fresh, apply `mutate` (a minimal JSONC text edit that
 * preserves comments and formatting), and write back atomically only when
 * the content actually changed. Reading before the lock is impossible by
 * construction, so concurrent updates cannot clobber each other.
 */
export async function updateConfigFile(
  filePath: string,
  mutate: (content: string) => string,
): Promise<void> {
  await withConfigLock(async () => {
    const content = readConfigContent(filePath);
    const next = mutate(content);
    if (next === content) return;
    await atomicWriteFile(filePath, next);
  });
}

export function readConfigContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ExtensionsError("config", "OpenCode の設定ファイルが見つかりません");
    }
    throw new ExtensionsError("config", "OpenCode の設定ファイルを読み込めません");
  }
}

/** Write `content` atomically: temp file in the same directory + rename. */
export async function atomicWriteFile(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.promises.writeFile(tmp, content, "utf8");
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    if (err instanceof ExtensionsError) throw err;
    throw new ExtensionsError("io", "設定ファイルを書き込めません");
  }
}

/** Parse JSONC (comments/trailing commas allowed) into plain values. */
export function parseJsoncConfig(content: string): Record<string, unknown> {
  const parsed = parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExtensionsError("config", "OpenCode の設定ファイルが不正です");
  }
  return parsed as Record<string, unknown>;
}

/** Detect indentation/EOL from existing content so edits match the file. */
export function detectFormatting(content: string): FormattingOptions {
  let tabSize = 2;
  let insertSpaces = true;
  const m = /\r?\n([\t ]+)\S/.exec(content);
  if (m) {
    if (m[1].startsWith("\t")) {
      insertSpaces = false;
      tabSize = 1;
    } else {
      tabSize = Math.min(m[1].length, 8) || 2;
    }
  }
  return { insertSpaces, tabSize, eol: content.includes("\r\n") ? "\r\n" : "\n" };
}

function requireMcpEntry(
  content: string,
  name: string,
): Record<string, unknown> {
  const root = parseJsoncConfig(content);
  const mcp = root.mcp;
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) {
    throw new ExtensionsError("not-found", "MCP サーバーが設定されていません");
  }
  const entry = (mcp as Record<string, unknown>)[name];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ExtensionsError("not-found", "指定の MCP サーバーが見つかりません");
  }
  return entry as Record<string, unknown>;
}

/**
 * Flip only `mcp[name].enabled`, preserving every comment and formatting
 * detail elsewhere (minimal text edit via jsonc-parser).
 */
export function setMcpEnabledInContent(
  content: string,
  name: string,
  enabled: boolean,
): string {
  const entry = requireMcpEntry(content, name);
  if (entry.enabled !== false && enabled) return content; // already enabled
  if (entry.enabled === false && !enabled) return content; // already disabled
  const edits = modify(content, ["mcp", name, "enabled"], enabled, {
    formattingOptions: detectFormatting(content),
  });
  return applyEdits(content, edits);
}

export function getPluginArray(content: string): unknown[] | null {
  const root = parseJsoncConfig(content);
  if (root.plugin === undefined) return null;
  if (!Array.isArray(root.plugin)) {
    throw new ExtensionsError("config", "plugin 設定が不正です");
  }
  return root.plugin;
}

function findPluginArrayNode(tree: Node | undefined): Node | undefined {
  if (!tree || tree.type !== "object") return undefined;
  const prop = tree.children?.find(
    (c) => c.type === "property" && c.children?.[0]?.value === "plugin",
  );
  return prop?.children?.[1];
}

/** Whitespace prefix of the line containing `offset`. */
function linePrefixOf(content: string, offset: number): string {
  let start = offset;
  while (start > 0 && content[start - 1] !== "\n") start -= 1;
  const m = /^[\t ]*/.exec(content.slice(start, offset));
  return m ? m[0] : "";
}

/**
 * Remove `plugin[index]` with a direct minimal edit computed from the AST.
 * jsonc-parser's `modify` re-serializes the neighboring element on removal,
 * which would expand inline tuples; this never touches neighbor text, so
 * their formatting survives. Comments attached to the removed entry itself
 * (between it and a neighbor) may be dropped — everything else is kept.
 */
export function removePluginEntryInContent(
  content: string,
  index: number,
): { content: string; removed: unknown } {
  const arr = getPluginArray(content);
  if (!arr || index < 0 || index >= arr.length) {
    throw new ExtensionsError("not-found", "指定のプラグインが見つかりません");
  }
  const removed = arr[index];
  const arrNode = findPluginArrayNode(parseTree(content));
  const children = arrNode?.children ?? [];
  const el = arrNode?.type === "array" ? children[index] : undefined;
  if (!arrNode || arrNode.type !== "array" || !el) {
    throw new ExtensionsError("config", "plugin 設定が不正です");
  }

  let edit: { offset: number; length: number; content: string };
  if (children.length === 1) {
    // Empty the array body: `[ ... ]` → `[]`.
    edit = { offset: arrNode.offset + 1, length: arrNode.length - 2, content: "" };
  } else if (index < children.length - 1) {
    // Drop the element plus its trailing comma/whitespace up to the next.
    const next = children[index + 1];
    edit = { offset: el.offset, length: next.offset - el.offset, content: "" };
  } else {
    // Last element: drop the leading comma region after the previous element.
    const prev = children[index - 1];
    const start = prev.offset + prev.length;
    edit = { offset: start, length: el.offset + el.length - start, content: "" };
  }
  return { content: applyEdits(content, [edit]), removed };
}

/**
 * Insert `value` into the `plugin` array at `index` (clamped), shifting
 * later elements. jsonc-parser's `modify` replaces at existing array
 * indexes, so insertion is done with a direct minimal edit computed from
 * the AST — comments and formatting outside the insertion point survive.
 */
export function insertPluginEntryInContent(
  content: string,
  index: number,
  value: unknown,
): string {
  const valueText = JSON.stringify(value);
  const fmt = detectFormatting(content);
  const eol = fmt.eol ?? "\n";
  const oneLevel = fmt.insertSpaces === false ? "\t" : " ".repeat(fmt.tabSize ?? 2);

  const tree = parseTree(content);
  const arrNode = findPluginArrayNode(tree);

  if (!arrNode) {
    // No `plugin` key (or root missing): let modify create the structure.
    const edits = modify(content, ["plugin"], [value], {
      formattingOptions: fmt,
    });
    return applyEdits(content, edits);
  }
  if (arrNode.type !== "array") {
    throw new ExtensionsError("config", "plugin 設定が不正です");
  }

  const children = arrNode.children ?? [];
  const clamped = Math.max(0, Math.min(index, children.length));

  if (children.length === 0) {
    // `[]` → `[\n<indent>value\n<base>]`
    const base = linePrefixOf(content, arrNode.offset);
    const edit = {
      offset: arrNode.offset + 1,
      length: 0,
      content: `${eol}${base}${oneLevel}${valueText}${eol}${base}`,
    };
    return applyEdits(content, [edit]);
  }

  if (clamped >= children.length) {
    const last = children[children.length - 1];
    const indent = linePrefixOf(content, last.offset);
    const edit = {
      offset: last.offset + last.length,
      length: 0,
      content: `,${eol}${indent}${valueText}`,
    };
    return applyEdits(content, [edit]);
  }

  const target = children[clamped];
  const indent = linePrefixOf(content, target.offset);
  const edit = {
    offset: target.offset,
    length: 0,
    content: `${valueText},${eol}${indent}`,
  };
  return applyEdits(content, [edit]);
}
