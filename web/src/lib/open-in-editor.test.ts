import { describe, expect, it, vi } from "vitest";
import type { OpenEditorIo } from "./open-in-editor";
import { findVscodeLauncher, openInEditor } from "./open-in-editor";

function fakeIo(overrides: Partial<OpenEditorIo> = {}): {
  io: OpenEditorIo;
  spawn: ReturnType<typeof vi.fn>;
  existsSync: ReturnType<typeof vi.fn>;
  spawnSync: ReturnType<typeof vi.fn>;
} {
  const spawn = vi.fn(() => undefined);
  const existsSync = vi.fn(() => false);
  const spawnSync = vi.fn(() => ({ status: 1, stdout: "" }));
  return {
    io: { spawn, existsSync, spawnSync, ...overrides },
    spawn,
    existsSync,
    spawnSync,
  };
}

describe("findVscodeLauncher", () => {
  it("prefers Code.exe from a standard install path", () => {
    const { io, existsSync } = fakeIo();
    existsSync.mockImplementation((p: string) => p.endsWith("Microsoft VS Code\\Code.exe"));
    const launcher = findVscodeLauncher(io);
    expect(launcher).toMatch(/Microsoft VS Code[\\/]Code\.exe$/i);
  });

  it("falls back to the code CLI on PATH", () => {
    const { io, spawnSync } = fakeIo();
    spawnSync.mockReturnValue({ status: 0, stdout: "C:\\fake\\bin\\code.exe\r\n" });
    expect(findVscodeLauncher(io)).toBe("C:\\fake\\bin\\code.exe");
  });

  it("returns null when VSCode is not installed", () => {
    const { io } = fakeIo();
    expect(findVscodeLauncher(io)).toBeNull();
  });
});

describe("openInEditor", () => {
  it("opens the repository folder with the target file activated via Code.exe", () => {
    const { io, existsSync, spawn } = fakeIo();
    existsSync.mockImplementation((p: string) => p.endsWith("Code.exe"));
    const result = openInEditor({ directory: "C:\\repo", file: "C:\\repo\\src\\a.ts" }, io);
    expect(result).toEqual({ editor: "vscode" });
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/Code\.exe$/i),
      ["C:\\repo", "--goto", "C:\\repo\\src\\a.ts"],
      { shell: false },
    );
  });

  it("runs a code.cmd shim through the shell with quoted args", () => {
    const { io, spawnSync, spawn } = fakeIo();
    spawnSync.mockReturnValue({ status: 0, stdout: "C:\\fake\\bin\\code.cmd\r\n" });
    openInEditor({ directory: "C:\\repo dir", file: "C:\\repo dir\\a b.ts" }, io);
    expect(spawn).toHaveBeenCalledWith(
      '"C:\\fake\\bin\\code.cmd" "C:\\repo dir" --goto "C:\\repo dir\\a b.ts"',
      [],
      { shell: true },
    );
  });

  it("falls back to the OS default handler when VSCode is not installed", () => {
    const { io, spawn } = fakeIo();
    const result = openInEditor({ directory: "C:\\repo", file: "C:\\repo\\a.ts" }, io);
    expect(result).toEqual({ editor: "default" });
    if (process.platform === "win32") {
      expect(spawn).toHaveBeenCalledWith("cmd.exe", ["/c", `start "" "C:\\repo\\a.ts"`], {});
    } else if (process.platform === "darwin") {
      expect(spawn).toHaveBeenCalledWith("open", ["C:\\repo\\a.ts"], {});
    } else {
      expect(spawn).toHaveBeenCalledWith("xdg-open", ["C:\\repo\\a.ts"], {});
    }
  });
});
