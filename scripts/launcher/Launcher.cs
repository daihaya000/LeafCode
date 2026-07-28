// Native launcher for OpenCode WebUI.
//
// Compiled by scripts\build-launcher.bat (csc.exe, part of the .NET Framework
// that ships with Windows) into scripts\launcher\OpenCodeWebUI.exe with the
// project icon embedded as a Win32 resource. Its only job is to be a real
// .exe so:
//   - Explorer reliably offers "Pin to taskbar" on a shortcut to it (this verb
//     is inconsistent for shortcuts that target a .bat/.cmd script directly).
//   - Task Manager / Alt-Tab show a proper app name and icon instead of the
//     generic "cmd.exe" / "Command Prompt" entry.
//
// It does not reimplement start-webui.bat: it sets the console title, then
// runs start-webui.bat via cmd.exe in the same console (no extra window,
// since a console-subsystem child inherits the parent's console when stdio
// is not redirected and no new console is requested) and forwards its exit
// code.
using System;
using System.Diagnostics;
using System.IO;

internal static class Launcher
{
    private static int Main()
    {
        Console.Title = "OpenCode WebUI";

        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string repoRoot = Path.GetFullPath(Path.Combine(exeDir, "..", ".."));
        string batPath = Path.Combine(repoRoot, "start-webui.bat");

        if (!File.Exists(batPath))
        {
            Console.Error.WriteLine("start-webui.bat not found at: " + batPath);
            return 1;
        }

        ProcessStartInfo psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c \"" + batPath + "\"",
            WorkingDirectory = repoRoot,
            UseShellExecute = false,
        };

        using (Process p = Process.Start(psi))
        {
            p.WaitForExit();
            return p.ExitCode;
        }
    }
}
