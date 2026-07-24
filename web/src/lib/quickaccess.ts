import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type QuickAccessEntry = { name: string; path: string };

const CACHE_MS = 30_000;
const POWERSHELL_TIMEOUT_MS = 2_000;
let cache: { at: number; entries: QuickAccessEntry[] } | null = null;
let pending: Promise<QuickAccessEntry[]> | null = null;

function sameKey(p: string): string {
  return path.resolve(p).toLowerCase();
}

/** Extract existing directory paths from a Windows Jump List (UTF-16LE). */
function pathsFromJumplist(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return [];
  }
  const text = buf.toString("utf16le");
  const re =
    /[A-Za-z]:\\(?:[^<>:"|?*\u0000-\u001f]+\\)*[^<>:"|?*\u0000-\u001f]*/g;
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const p = m[0].replace(/\\+$/, "");
    if (p.length < 3) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) found.push(p);
    } catch {
      /* skip */
    }
  }
  return found;
}

function resolveLnkTargets(linksDir: string): QuickAccessEntry[] {
  if (!fs.existsSync(linksDir)) return [];
  // R33付記: WScript.Shell via PowerShell is the reliable way to resolve .lnk on Windows
  // This is a synchronous fallback when listLinksFolder() fails
  try {
    const files = fs.readdirSync(linksDir).filter(f => f.endsWith('.lnk'));
    if (files.length === 0) return [];
    
    const script = `
$sh = New-Object -ComObject WScript.Shell
$out = @()
Get-ChildItem -LiteralPath '${linksDir.replace(/'/g, "''")}' -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $sc = $sh.CreateShortcut($_.FullName)
    $t = $sc.TargetPath
    if ($t -and (Test-Path -LiteralPath $t -PathType Container)) {
      $out += [pscustomobject]@{ name = $_.BaseName; path = $t }
    }
  } catch {}
}
if (-not $out -or @($out).Count -eq 0) { Write-Output '[]' }
elseif (@($out).Count -eq 1) { Write-Output ('[' + ($out | ConvertTo-Json -Compress) + ']') }
else { $out | ConvertTo-Json -Compress }
`;
    
    const result = execSync(`powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout: POWERSHELL_TIMEOUT_MS,
    });
    
    const data = JSON.parse(result.trim());
    if (!Array.isArray(data)) return [];
    
    return data
      .map((x: { name?: string; path?: string }) => x.name && x.path ? { name: x.name, path: path.resolve(x.path) } : null)
      .filter((x: QuickAccessEntry | null): x is QuickAccessEntry => x !== null);
  } catch {
    return [];
  }
}

function runPsJson(script: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, shell: false },
    );
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("quick access PowerShell timed out"));
    }, POWERSHELL_TIMEOUT_MS);
    timer.unref?.();

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
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : []);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

async function listLinksFolder(): Promise<QuickAccessEntry[]> {
  const linksDir = path.join(os.homedir(), "Links").replace(/'/g, "''");
  const script = `
$out = @()
$dir = '${linksDir}'
if (Test-Path -LiteralPath $dir) {
  $sh = New-Object -ComObject WScript.Shell
  Get-ChildItem -LiteralPath $dir -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $sc = $sh.CreateShortcut($_.FullName)
      $t = $sc.TargetPath
      if ($t -and (Test-Path -LiteralPath $t -PathType Container)) {
        $out += [pscustomobject]@{ name = $_.BaseName; path = $t }
      }
    } catch {}
  }
}
if (-not $out -or @($out).Count -eq 0) { Write-Output '[]' }
elseif (@($out).Count -eq 1) { Write-Output ('[' + ($out | ConvertTo-Json -Compress) + ']') }
else { $out | ConvertTo-Json -Compress }
`;
  try {
    const data = await runPsJson(script);
    if (!Array.isArray(data)) return [];
    return data
      .map((x) => x as { name?: string; path?: string })
      .filter((x) => x.name && x.path)
      .map((x) => ({ name: x.name!, path: path.resolve(x.path!) }));
  } catch {
    return resolveLnkTargets(path.join(os.homedir(), "Links"));
  }
}

/**
 * Windows Explorer Quick Access ≈ pinned Links + Quick Access jump list folders.
 */
export async function listQuickAccess(): Promise<QuickAccessEntry[]> {
  if (process.platform !== "win32") return [];
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.entries;
  if (pending) return pending;

  pending = (async () => {
    const seen = new Set<string>();
    const entries: QuickAccessEntry[] = [];

    const push = (name: string, dir: string) => {
      try {
        const resolved = path.resolve(dir);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          return;
        }
        const key = sameKey(resolved);
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({ name: name || path.basename(resolved) || resolved, path: resolved });
      } catch {
        /* skip */
      }
    };

    // Pinned favorites (Links) first — closest to "ピン留め"
    for (const e of await listLinksFolder()) {
      push(e.name, e.path);
    }

    // Quick Access / Home frequent+pinned destinations jumplist
    const qaJumplist = path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "Microsoft",
      "Windows",
      "Recent",
      "AutomaticDestinations",
      "f01b4d95cf55d32a.automaticDestinations-ms",
    );
    for (const p of pathsFromJumplist(qaJumplist)) {
      push(path.basename(p) || p, p);
    }

    cache = { at: Date.now(), entries };
    return entries;
  })().finally(() => {
    pending = null;
  });

  return pending;
}
