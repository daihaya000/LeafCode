export type CommitFileInfo = {
  path: string;
  untracked: boolean;
};

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Longest shared directory prefix (segment-wise) across paths, "" if none. */
function commonDir(paths: string[]): string {
  if (paths.length === 0) return "";
  const dirs = paths.map((p) => {
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(0, i).split("/") : [];
  });
  const first = dirs[0];
  let end = first.length;
  for (const segs of dirs.slice(1)) {
    let k = 0;
    while (k < end && k < segs.length && segs[k] === first[k]) k += 1;
    end = k;
  }
  return first.slice(0, end).join("/");
}

/**
 * Deterministic commit-message suggestion from the set of changed files.
 * Imperative, sentence-case (matches repo style). Empty when no files.
 */
export function suggestCommitMessage(files: CommitFileInfo[]): string {
  if (files.length === 0) return "";
  const verb = files.every((f) => f.untracked) ? "Add" : "Update";

  if (files.length === 1) {
    return `${verb} ${basename(files[0].path)}`;
  }

  const dir = commonDir(files.map((f) => f.path));
  return dir
    ? `${verb} ${files.length} files in ${dir}`
    : `${verb} ${files.length} files`;
}
