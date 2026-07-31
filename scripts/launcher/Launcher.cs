// Native launcher for OpenCode WebUI.
//
// The compiled OpenCodeWebUI.exe lives at the repository root and is the
// single entry point for the app (double-click / shortcut / taskbar pin).
// It is tracked in git so a fresh clone can start without building anything
// first; scripts\build-launcher.bat regenerates it from this source with the
// project icon embedded as a Win32 resource (csc.exe ships with the .NET
// Framework on Windows). Being a real .exe at a stable location is what lets
// Explorer reliably offer "Pin to taskbar" on a shortcut to it (this verb is
// inconsistent for shortcuts that target a .bat/.cmd script directly), and
// what makes Task Manager / Alt-Tab show a proper app name and icon instead
// of the generic "cmd.exe" / "Command Prompt" entry.
//
// It does not reimplement the setup/start logic: it sets the console title,
// then runs scripts\start-webui.bat (winget / Node.js / OpenCode / dependency
// setup, then the tray host) via cmd.exe in the same console (no extra
// window, since a console-subsystem child inherits the parent's console when
// stdio is not redirected and no new console is requested) and forwards its
// exit code. scripts\start-webui.bat also watches this exe's build inputs
// and quietly rebuilds it when they are newer, so fixes to this file take
// effect on the next launch without a manual build step.
//
// Any failure that happens here, before scripts\start-webui.bat can run its
// own pause_if_interactive, pauses on Console.In.ReadLine() (see Fail())
// instead of exiting immediately, so a double-click launch's console window
// does not flash and close before the error message can be read.
using System;
using System.Diagnostics;
using System.IO;

internal static class Launcher
{
    private static int Main()
    {
        try
        {
            Console.Title = "OpenCode WebUI";

            // The exe is committed at the repository root, so its own directory
            // is the repo root and the internal batch lives under scripts\.
            string repoRoot = AppDomain.CurrentDomain.BaseDirectory;
            string batPath = Path.Combine(repoRoot, "scripts", "start-webui.bat");

            if (!File.Exists(batPath))
            {
                Console.Error.WriteLine("scripts\\start-webui.bat not found at: " + batPath);
                // This exe is a thin entry point, not a standalone program: it
                // only works when kept inside a full clone of the repository
                // (scripts\, host\, web\ alongside it). Copying just the exe
                // elsewhere is the most common way to hit this, so say so
                // directly instead of leaving the user with a bare path.
                Console.Error.WriteLine(
                    "This exe only works from inside a full clone of the OpenCodeWebUI " +
                    "repository (the scripts, host, and web folders must sit next to it). " +
                    "If you copied only OpenCodeWebUI.exe somewhere else, re-clone the " +
                    "repository and run the exe from its root instead.");
                return Fail(1);
            }

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                // Prefix the quoted batch path with CALL. If the command passed to
                // cmd /c starts with a quote, cmd strips that quote pair before it
                // parses metacharacters. A repo path containing '&' then gets split
                // into separate commands and the launcher can exit without running
                // the batch file. CALL keeps the path's quotes intact while cmd
                // parses the command.
                Arguments = "/d /c call \"" + batPath + "\"",
                WorkingDirectory = repoRoot,
                UseShellExecute = false,
            };

            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            // Anything thrown above (e.g. Process.Start failing because
            // cmd.exe cannot be launched) would otherwise print a stack trace
            // and exit before a double-click launch's freshly created console
            // window can be read. Report it plainly and pause instead.
            Console.Error.WriteLine("OpenCodeWebUI.exe failed to start: " + ex.Message);
            return Fail(1);
        }
    }

    /// <summary>
    /// Keeps the console window open on early failures - those that happen
    /// before scripts\start-webui.bat runs and can use its own
    /// pause_if_interactive - so a double-click launch does not just flash
    /// and close before the error above can be read. Set
    /// OPENCODE_WEBUI_NONINTERACTIVE=1 to skip waiting (same variable name
    /// and meaning as start-webui.bat's pause_if_interactive). Automated
    /// tests spawn this exe with stdin already closed/at EOF, so
    /// Console.In.ReadLine() returns immediately there and never blocks them.
    /// </summary>
    private static int Fail(int code)
    {
        if (Environment.GetEnvironmentVariable("OPENCODE_WEBUI_NONINTERACTIVE") != "1")
        {
            Console.Error.WriteLine("Press Enter to close this window...");
            Console.In.ReadLine();
        }
        return code;
    }
}
