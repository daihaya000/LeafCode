import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type OpenEditorResult = { editor: "vscode" } | { editor: "default" };

/** Injectable I/O so unit tests never touch real processes / the filesystem. */
export type OpenEditorIo = {
  existsSync(p: string): boolean;
  spawnSync(cmd: string, args: string[]): { status: number | null; stdout: string };
  spawn(cmd: string, args: string[], opts: { shell?: boolean }): unknown;
};

export const defaultOpenEditorIo: OpenEditorIo = {
  existsSync: (p) => fs.existsSync(p),
  spawnSync: (cmd, args) => {
    const r = spawnSync(cmd, args, { windowsHide: true, encoding: "utf8" });
    return { status: r.status, stdout: r.stdout ?? "" };
  },
  spawn: (cmd, args, opts) => {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: opts.shell,
    });
    child.on("error", () => undefined);
    child.unref();
    return child;
  },
};

function vscodeCandidates(): string[] {
  if (process.platform !== "win32") return [];
  const dirs = [
    process.env.LOCALAPPDATA,
    process.env["ProgramFiles"],
    process.env["ProgramFiles(x86)"],
  ];
  return dirs
    .filter((d): d is string => Boolean(d))
    .map((d) => path.join(d, "Microsoft VS Code", "Code.exe"));
}

/**
 * Locate the VSCode CLI entry. The `code` shim may be a .cmd (Windows) or a
 * shell script that needs a shell, while `Code.exe` accepts the same
 * command-line args directly, so a direct Code.exe hit is preferred.
 */
export function findVscodeLauncher(io: OpenEditorIo = defaultOpenEditorIo): string | null {
  for (const c of vscodeCandidates()) {
    if (io.existsSync(c)) return c;
  }
  const which = io.spawnSync(process.platform === "win32" ? "where" : "which", ["code"]);
  if (which.status === 0) {
    const line = which.stdout.split(/\r?\n/).find((l) => l.trim());
    if (line?.trim()) return line.trim();
  }
  return null;
}

/**
 * Open a file in the editor:
 * - VSCode (detected via Code.exe / `code` CLI): open the repository folder and
 *   activate the target file tab (`<folder> --goto <file>`). VSCode reuses an
 *   existing window when the folder is already open.
 * - otherwise: the OS default handler (`start` / `open` / `xdg-open`).
 */
export function openInEditor(
  input: { directory: string; file: string },
  io: OpenEditorIo = defaultOpenEditorIo,
): OpenEditorResult {
  const vscode = findVscodeLauncher(io);
  if (vscode) {
    const exe = vscode.toLowerCase().endsWith(".exe");
    if (exe) {
      io.spawn(vscode, [input.directory, "--goto", input.file], { shell: false });
    } else {
      // Shell shim (code.cmd / code): quote every argv element because
      // shell:true joins them with spaces without escaping.
      const quoted = (s: string) => `"${s}"`;
      io.spawn(
        `${quoted(vscode)} ${quoted(input.directory)} --goto ${quoted(input.file)}`,
        [],
        { shell: true },
      );
    }
    return { editor: "vscode" };
  }
  if (process.platform === "win32") {
    io.spawn("cmd.exe", ["/c", `start "" "${input.file}"`], {});
  } else if (process.platform === "darwin") {
    io.spawn("open", [input.file], {});
  } else {
    io.spawn("xdg-open", [input.file], {});
  }
  return { editor: "default" };
}
