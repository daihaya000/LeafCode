// Stdin protocol helper that holds Windows Job Objects for the tray host.
//
// The host cannot keep a job HANDLE in JS without FFI. This process owns the
// handles instead. When the host is TerminateProcess'd, this stdin pipe hits
// EOF and we CloseHandle every job, which fires JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
// and kills leftover children that still hold an inherited listen socket.
//
// Protocol (ASCII, one command per line):
//   CREATE <id>
//   ASSIGN <id> <pid>
//   TERMINATE <id>
//   CLOSE <id>
// Replies: READY (once), then OK or ERR <message>.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class JobHolder
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    private const uint PROCESS_SET_QUOTA = 0x0100;
    private const uint PROCESS_TERMINATE = 0x0001;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr hJob,
        int infoClass,
        IntPtr lpJobObjectInfo,
        uint cbJobObjectInfoLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private static readonly Dictionary<string, IntPtr> Jobs = new Dictionary<string, IntPtr>(
        StringComparer.Ordinal
    );

    public static int Main()
    {
        // OpenStandard* survives CREATE_NO_WINDOW (Node windowsHide: true).
        // Console.In can return EOF immediately when no console is attached.
        StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), Encoding.ASCII)
        {
            AutoFlush = true,
            NewLine = "\n",
        };
        StreamReader input = new StreamReader(Console.OpenStandardInput(), Encoding.ASCII, false);

        output.WriteLine("READY");

        string line;
        while ((line = input.ReadLine()) != null)
        {
            line = line.Trim();
            if (line.Length == 0)
            {
                continue;
            }
            try
            {
                Handle(line);
                output.WriteLine("OK");
            }
            catch (Exception ex)
            {
                output.WriteLine("ERR " + ex.Message.Replace('\r', ' ').Replace('\n', ' '));
            }
        }

        DropAll();
        return 0;
    }

    private static void Handle(string line)
    {
        string[] parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
        {
            throw new ArgumentException("empty command");
        }
        string cmd = parts[0].ToUpperInvariant();
        if (cmd == "CREATE" && parts.Length == 2)
        {
            Create(parts[1]);
            return;
        }
        if (cmd == "ASSIGN" && parts.Length == 3)
        {
            int pid;
            if (!int.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out pid) || pid <= 0)
            {
                throw new ArgumentException("pid must be a positive integer");
            }
            Assign(parts[1], pid);
            return;
        }
        if (cmd == "TERMINATE" && parts.Length == 2)
        {
            Terminate(parts[1]);
            return;
        }
        if (cmd == "CLOSE" && parts.Length == 2)
        {
            Close(parts[1]);
            return;
        }
        throw new ArgumentException("unknown command");
    }

    private static void Create(string id)
    {
        ValidateId(id);
        Close(id);
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw new InvalidOperationException("CreateJobObject failed " + Marshal.GetLastWin32Error());
        }
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)size))
            {
                int err = Marshal.GetLastWin32Error();
                CloseHandle(job);
                throw new InvalidOperationException("SetInformationJobObject failed " + err);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
        Jobs[id] = job;
    }

    private static void Assign(string id, int pid)
    {
        IntPtr job = Require(id);
        IntPtr process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid);
        if (process == IntPtr.Zero)
        {
            throw new InvalidOperationException("OpenProcess failed " + Marshal.GetLastWin32Error());
        }
        try
        {
            if (!AssignProcessToJobObject(job, process))
            {
                throw new InvalidOperationException("AssignProcessToJobObject failed " + Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            CloseHandle(process);
        }
    }

    private static void Terminate(string id)
    {
        IntPtr job;
        if (!Jobs.TryGetValue(id, out job) || job == IntPtr.Zero)
        {
            return;
        }
        TerminateJobObject(job, 1);
    }

    private static void Close(string id)
    {
        IntPtr job;
        if (!Jobs.TryGetValue(id, out job))
        {
            return;
        }
        Jobs.Remove(id);
        if (job != IntPtr.Zero)
        {
            CloseHandle(job);
        }
    }

    private static IntPtr Require(string id)
    {
        ValidateId(id);
        IntPtr job;
        if (!Jobs.TryGetValue(id, out job) || job == IntPtr.Zero)
        {
            throw new InvalidOperationException("unknown job " + id);
        }
        return job;
    }

    private static void ValidateId(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 32)
        {
            throw new ArgumentException("invalid job id");
        }
        for (int i = 0; i < id.Length; i++)
        {
            char c = id[i];
            bool ok =
                (c >= 'a' && c <= 'z') ||
                (c >= 'A' && c <= 'Z') ||
                (c >= '0' && c <= '9') ||
                c == '-' ||
                c == '_';
            if (!ok)
            {
                throw new ArgumentException("invalid job id");
            }
        }
    }

    private static void DropAll()
    {
        // TerminateJobObject first. Nested jobs (Node's test runner, LeafCode.exe)
        // often ignore KILL_ON_JOB_CLOSE on CloseHandle, which is what a
        // TerminateProcess of this helper would leave us with.
        List<string> ids = new List<string>(Jobs.Keys);
        foreach (string id in ids)
        {
            Terminate(id);
            Close(id);
        }
    }
}
