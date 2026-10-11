$ErrorActionPreference = 'Stop'
$root = Join-Path $PWD 'release/windows-lifecycle'
New-Item -ItemType Directory -Force $root | Out-Null
# Observe visible console windows throughout the actual packaged App lifecycle.
# Existing runner consoles are excluded; every new one is recorded with its owner.
Add-Type @'
using System;
using System.Text;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
public static class ConsoleWatch {
  delegate bool Callback(IntPtr h, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder name, int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  static volatile bool stopped;
  static Task task;
  static HashSet<IntPtr> seen = new HashSet<IntPtr>();
  static void Scan(string root, bool baseline) {
    EnumWindows((h, data) => {
      var name = new StringBuilder(256); GetClassName(h, name, 256);
      if (IsWindowVisible(h) && (name.ToString() == "ConsoleWindowClass" || name.ToString() == "CASCADIA_HOSTING_WINDOW_CLASS") && seen.Add(h) && !baseline) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        string phase = File.Exists(Path.Combine(root,"phase.txt")) ? File.ReadAllText(Path.Combine(root,"phase.txt")) : "background";
        File.AppendAllText(Path.Combine(root,"consoles.txt"), phase + " pid=" + pid + " class=" + name + Environment.NewLine);
      }
      return true;
    }, IntPtr.Zero);
  }
  public static void Start(string root) { Scan(root, true); task = Task.Run(() => { while (!stopped) { Scan(root, false); Thread.Sleep(50); } }); }
  public static void Stop() { stopped = true; if (task != null) task.Wait(); }
}
'@
$driver = $null
try {
  $driver = Start-Process tauri-driver -ArgumentList @('--native-driver', $env:CLAUDE_DESK_EDGE_DRIVER) -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root/driver.log" -RedirectStandardError "$root/driver-error.log"
  [ConsoleWatch]::Start($root)
  node tests/windows-lifecycle.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Packaged lifecycle test failed' }
  [ConsoleWatch]::Stop()
  $consoles = @(Get-Content "$root/consoles.txt" -ErrorAction SilentlyContinue)
  if ($consoles | Where-Object { $_ -like 'background*' }) { throw "Unexpected background console: $consoles" }
  if (-not ($consoles | Where-Object { $_ -like 'allow-terminal*' })) { throw 'Open Terminal did not produce a visible terminal' }
  $remaining = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*tests*fixtures*claude-session.mjs*' -or $_.Name -eq 'claude-desk.exe' }
  if ($remaining) { throw "App/Claude fixture leaked after normal exit: $($remaining.ProcessId)" }
  Write-Host 'PASS only explicit Open Terminal showed a console; no App/session process remained after exit'
} finally {
  [ConsoleWatch]::Stop()
  if ($driver -and -not $driver.HasExited) { Stop-Process $driver.Id -Force }
}
