import fsp from "node:fs/promises";
import path from "node:path";

/** Names skipped at any depth. */
export type ExcludeSet = ReadonlySet<string>;

/** Duplicating a profile drops git history so the copy cannot push to the original remote. */
export const DUPLICATE_EXCLUDES: ExcludeSet = new Set([".git"]);

/** Migrating relocates the same repository, so nothing is dropped. */
export const MIGRATE_EXCLUDES: ExcludeSet = new Set<string>();

export type CopyResult = {
  copied: number;
  /** True when at least one symlink had to be replaced by its contents. */
  dereferenced: boolean;
};

type CopyContext = {
  exclude: ExcludeSet;
  concurrency: number;
  onProgress?: (copied: number) => void;
  copied: number;
  dereferenced: boolean;
};

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const current = index;
        index += 1;
        if (current >= items.length) return;
        await fn(items[current]);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Count the entries a copy would produce (files + symlinks, not directories),
 * so progress has a meaningful denominator.
 */
export async function countEntries(
  src: string,
  exclude: ExcludeSet = new Set(),
): Promise<number> {
  let total = 0;
  const stack: string[] = [src];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (exclude.has(entry.name)) continue;
      if (entry.isSymbolicLink() || entry.isFile()) total += 1;
      else if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  return total;
}

function tick(ctx: CopyContext): void {
  ctx.copied += 1;
  ctx.onProgress?.(ctx.copied);
}

/**
 * Reproduce a symlink as a symlink.
 *
 * The real config keeps `node_modules/<pkg>` links pointing at
 * `~/.config/opencode/packages/<pkg>` — i.e. *through* the switchable link — so
 * preserving them keeps every copy resolving to whichever profile is active.
 * Only when the platform refuses to create links do we fall back to content.
 */
async function copySymlink(
  src: string,
  dest: string,
  ctx: CopyContext,
): Promise<void> {
  const linkTarget = await fsp.readlink(src);

  let pointsToDirectory = false;
  try {
    pointsToDirectory = (await fsp.stat(src)).isDirectory();
  } catch {
    // Broken link: recreate it verbatim as a file symlink.
  }

  try {
    await fsp.symlink(linkTarget, dest, pointsToDirectory ? "junction" : "file");
    tick(ctx);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES" && code !== "ENOSYS") throw err;
  }

  ctx.dereferenced = true;
  if (pointsToDirectory) {
    await copyDirectory(src, dest, ctx);
  } else {
    await fsp.copyFile(src, dest);
    tick(ctx);
  }
}

async function copyDirectory(
  src: string,
  dest: string,
  ctx: CopyContext,
): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const entries = (await fsp.readdir(src, { withFileTypes: true })).filter(
    (entry) => !ctx.exclude.has(entry.name),
  );

  const directories = entries.filter(
    (entry) => entry.isDirectory() && !entry.isSymbolicLink(),
  );
  const leaves = entries.filter(
    (entry) => !(entry.isDirectory() && !entry.isSymbolicLink()),
  );

  await mapWithConcurrency(leaves, ctx.concurrency, async (entry) => {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      await copySymlink(from, to, ctx);
    } else if (entry.isFile()) {
      await fsp.copyFile(from, to);
      tick(ctx);
    }
  });

  await mapWithConcurrency(directories, ctx.concurrency, async (entry) => {
    await copyDirectory(
      path.join(src, entry.name),
      path.join(dest, entry.name),
      ctx,
    );
  });
}

/**
 * Asynchronously copy a profile tree.
 *
 * Never uses `fs.cpSync`: a 17k-file copy would block the BFF event loop and
 * stall SSE streams and health checks.
 */
export async function copyTree(
  src: string,
  dest: string,
  options: {
    exclude?: ExcludeSet;
    onProgress?: (copied: number) => void;
    concurrency?: number;
  } = {},
): Promise<CopyResult> {
  const ctx: CopyContext = {
    exclude: options.exclude ?? new Set(),
    concurrency: options.concurrency ?? 8,
    onProgress: options.onProgress,
    copied: 0,
    dereferenced: false,
  };
  await copyDirectory(src, dest, ctx);
  return { copied: ctx.copied, dereferenced: ctx.dereferenced };
}

/**
 * Confirm a finished copy is usable before it is published as a profile.
 */
export async function verifyCopy(
  dest: string,
  copied: number,
  total: number,
): Promise<void> {
  if (copied < total) {
    throw new Error(
      `複製が不完全です（${copied} / ${total} 件）。コピー先を破棄しました。`,
    );
  }
  const markers = ["opencode.jsonc", "opencode.json", "agents", "agent", "skills"];
  for (const marker of markers) {
    try {
      await fsp.stat(path.join(dest, marker));
      return;
    } catch {
      // try the next marker
    }
  }
  throw new Error("複製先が OpenCode の設定ディレクトリとして認識できません。");
}
