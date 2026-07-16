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

  // STA is required for WinForms dialogs
  const script = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${title}'
$dialog.SelectedPath = '${initial}'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
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
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", reject);
    child.on("close", (code) => {
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
