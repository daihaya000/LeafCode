import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Open a native folder picker on the host machine (Windows).
 * Intended for localhost use — the dialog appears on the server desktop.
 */
export async function POST(req: NextRequest) {
  if (process.platform !== "win32") {
    return NextResponse.json(
      { error: "folder picker is only available on Windows" },
      { status: 501 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    initialPath?: string;
  } | null;

  const title = (body?.title || "プロジェクトフォルダを選択").replace(
    /'/g,
    "''",
  );
  let initial = "";
  if (body?.initialPath && typeof body.initialPath === "string") {
    const resolved = path.resolve(body.initialPath);
    if (fs.existsSync(resolved)) initial = resolved.replace(/'/g, "''");
  }
  if (!initial) {
    const home = os.homedir().replace(/'/g, "''");
    initial = home;
  }

  // STA is required for the Windows shell dialog. Use IFileOpenDialog with
  // FOS_PICKFOLDERS so the UI is the Explorer-style folder picker rather than
  // the older tree-only FolderBrowserDialog.
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$code = @"
using System;
using System.Runtime.InteropServices;

public static class ExplorerFolderPicker
{
  private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
  private const uint FOS_PICKFOLDERS = 0x00000020;
  private const uint FOS_FORCEFILESYSTEM = 0x00000040;
  private const uint FOS_PATHMUSTEXIST = 0x00000800;
  private const uint FOS_FILEMUSTEXIST = 0x00001000;
  private const uint SIGDN_FILESYSPATH = 0x80058000;
  private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
    IntPtr pbc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv
  );

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetProcessDPIAware();

  private static void EnableDpiAwareness()
  {
    try
    {
      SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    catch
    {
      try
      {
        SetProcessDPIAware();
      }
      catch
      {
        // Best effort only. If DPI APIs are unavailable, show the dialog anyway.
      }
    }

    try
    {
      SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    catch
    {
      // Best effort only. The process-level setting above is usually enough.
    }
  }

  public static string Pick(string title, string initialPath)
  {
    EnableDpiAwareness();
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_FILEMUSTEXIST);
    dialog.SetTitle(title);
    dialog.SetOkButtonLabel("フォルダーの選択");
    dialog.SetFileNameLabel("フォルダー:");

    if (!String.IsNullOrWhiteSpace(initialPath))
    {
      try
      {
        IShellItem folder;
        Guid shellItemId = typeof(IShellItem).GUID;
        SHCreateItemFromParsingName(initialPath, IntPtr.Zero, shellItemId, out folder);
        dialog.SetFolder(folder);
      }
      catch
      {
        // Ignore invalid initial folders and let Windows choose the default.
      }
    }

    int hr = dialog.Show(IntPtr.Zero);
    if (hr == ERROR_CANCELLED) return null;
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);

    IShellItem item;
    dialog.GetResult(out item);
    IntPtr displayName;
    item.GetDisplayName(SIGDN_FILESYSPATH, out displayName);
    try
    {
      return Marshal.PtrToStringUni(displayName);
    }
    finally
    {
      Marshal.FreeCoTaskMem(displayName);
    }
  }
}

[ComImport]
[Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
internal class FileOpenDialog { }

[ComImport]
[Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IFileOpenDialog
{
  [PreserveSig] int Show(IntPtr parent);
  void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
  void SetFileTypeIndex(uint iFileType);
  void GetFileTypeIndex(out uint piFileType);
  void Advise(IntPtr pfde, out uint pdwCookie);
  void Unadvise(uint dwCookie);
  void SetOptions(uint fos);
  void GetOptions(out uint pfos);
  void SetDefaultFolder(IShellItem psi);
  void SetFolder(IShellItem psi);
  void GetFolder(out IShellItem ppsi);
  void GetCurrentSelection(out IShellItem ppsi);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
  void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
  void GetResult(out IShellItem ppsi);
  void AddPlace(IShellItem psi, int fdap);
  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
  void Close(int hr);
  void SetClientGuid(ref Guid guid);
  void ClearClientData();
  void SetFilter(IntPtr pFilter);
  void GetResults(out IntPtr ppenum);
  void GetSelectedItems(out IntPtr ppsai);
}

[ComImport]
[Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellItem
{
  void BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
  void GetParent(out IShellItem ppsi);
  void GetDisplayName(uint sigdnName, out IntPtr ppszName);
  void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
  void Compare(IShellItem psi, uint hint, out int piOrder);
}
"@
Add-Type -TypeDefinition $code -Language CSharp
$selected = [ExplorerFolderPicker]::Pick('${title}', '${initial}')
if ($selected) { Write-Output $selected }
`;

  try {
    const selected = await runPowerShellSta(script);
    if (!selected) {
      return NextResponse.json({ cancelled: true });
    }
    if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) {
      return NextResponse.json(
        { error: "selected path is not a directory" },
        { status: 400 },
      );
    }
    return NextResponse.json({ path: selected, cancelled: false });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "folder picker failed",
      },
      { status: 500 },
    );
  }
}

// The picker waits for a human to click, but must not pin a worker forever if
// the dialog is orphaned (e.g. no interactive desktop). Slightly under the
// route's maxDuration so we return a clean error before the platform kills us.
const PICKER_TIMEOUT_MS = 290_000;

function runPowerShellSta(script: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: false,
        shell: false,
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      reject(new Error("folder picker timed out"));
    }, PICKER_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `powershell exited ${code}`));
        return;
      }
      const line = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      resolve(line || null);
    });
  });
}
