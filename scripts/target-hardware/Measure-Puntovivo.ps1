<#
.SYNOPSIS
Measures a packaged Puntovivo build on target hardware (a Celeron J1900 with
4 GB of RAM running Windows 10) and judges the run against the U1-U8 thresholds.

.DESCRIPTION
Windows PowerShell 5.1, no modules. Phases:

  install    Silently installs -Installer (per-user NSIS). With -Baseline it
             then restores that data snapshot over %APPDATA%\Puntovivo.
  baseline   Saves %APPDATA%\Puntovivo to the -Baseline zip (app closed).
  startup    Launches the app -Runs times and times launch -> login usable
             -> point of sale ready. The first run after a reboot is the cold start.
  sales      Launches (or attaches to) the app and times each sale you ring up,
             from the first scan to the closed charge. In this window press
             B at backup start and end, N for a note, Q to finish.
  soak       Samples for -Hours (or -Minutes). With -Drive a simulated cashier
             sells every -SaleEverySec seconds using codes from -Barcodes.
  summarize  Recomputes summary.json and verdict.md for an existing -RunDir.

Every phase writes into <OutDir>\<Label>: samples.csv (per process),
system.csv (per second), renderer.csv (IPC round trip and renderer lag),
markers.csv, sales.csv, startup.csv, meta.json, summary.json and verdict.md.

Exit codes: 0 every judged threshold passed, 1 a threshold failed,
2 the harness could not measure.

.EXAMPLE
.\Measure-Puntovivo.ps1 -Phase soak -Hours 8 -Drive -Barcodes C:\pv-measure\barcodes.txt -Label v1.17.1
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('install', 'baseline', 'startup', 'sales', 'soak', 'summarize')]
  [string]$Phase,
  [string]$Label,
  [double]$Hours = 8,
  [double]$Minutes = 0,
  [ValidateRange(1, 300)][int]$IntervalSec = 15,
  [string]$ProcessName = 'puntovivo',
  [string]$ExePath,
  [switch]$Drive,
  [string]$Barcodes,
  [ValidateRange(5, 3600)][int]$SaleEverySec = 60,
  [ValidateRange(1, 6)][int]$ItemsMin = 3,
  [ValidateRange(1, 6)][int]$ItemsMax = 6,
  [ValidateSet('auto', 'sendkeys', 'cdp')][string]$KeyInput = 'auto',
  [ValidateRange(1, 10)][int]$Runs = 3,
  [ValidateSet('pos', 'login')][string]$StopAt = 'pos',
  [string]$OutDir = 'C:\pv-measure\runs',
  [string]$RunDir,
  [string]$Installer,
  [string]$Baseline,
  [string]$TestProfile,
  [int]$CdpPort = 0,
  [switch]$CloseAtEnd,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
# Spanish Windows formats 1.5 as "1,5"; every number this script writes must not.
$Invariant = [System.Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentCulture = $Invariant
[System.Threading.Thread]::CurrentThread.CurrentUICulture = $Invariant
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$HarnessVersion = '1'

# .NET resolves relative paths against the process directory, not the PowerShell location.
function Resolve-UserPath([string]$path) {
  if (-not $path) { return $path }
  try { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path) } catch { return $path }
}
$OutDir = Resolve-UserPath $OutDir
$RunDir = Resolve-UserPath $RunDir
$Installer = Resolve-UserPath $Installer
$Baseline = Resolve-UserPath $Baseline
$TestProfile = Resolve-UserPath $TestProfile
$Barcodes = Resolve-UserPath $Barcodes
$ExePath = Resolve-UserPath $ExePath

# Starting points from the readiness design (decision D8). Fix the final values
# after the first J1900 run; disk type matters for U2 (HDD 20/s, SSD up to 50/s).
$Thresholds = [ordered]@{
  U1_gpuUtilityMb        = 1024
  U1_windowMin           = 10
  U2_pageReadsPerSec     = 20
  U2_consecutiveSec      = 2
  U2_minAvailMb          = 150
  U3_slopeMbPerHour      = 10
  U3_privateGrowthFactor = 1.5
  U3_minSoakHours        = 2
  U4_totalWorkingSetMb   = 1600
  U5_medianMs            = 3000
  U5_p95Ms               = 6000
  U6_coldMs              = 45000
  U6_warmMs              = 20000
  U7_freezeMs            = 1000
}

$Roles = @('main', 'renderer', 'gpu', 'utility', 'crashpad', 'other')
$CsvHeaders = @{
  'samples.csv'  = 't_ms,ts_utc,elapsed_s,label,phase,pid,role,subtype,working_set_mb,private_mb,cpu_pct,handles,threads,gpu_dedicated_mb,gpu_shared_mb'
  'system.csv'   = 't_ms,ts_utc,elapsed_s,label,phase,avail_mb,commit_mb,page_reads,pages_out,pagefile_pct,disk_queue,cpu_total_pct'
  'renderer.csv' = 't_ms,ts_utc,elapsed_s,label,phase,ipc_count,ipc_p50_ms,ipc_p99_ms,ipc_max_ms,ipc_errors,lag_max_ms,js_heap_mb,dom_nodes,visibility,route,cdp_ms'
  'markers.csv'  = 't_ms,ts_utc,elapsed_s,label,phase,kind,n,value,note'
  'sales.csv'    = 't_ms,ts_utc,label,phase,n,mode,input,items,duration_ms,charge_ms,status,note'
  'startup.csv'  = 't_ms,ts_utc,label,run,kind,uptime_s,login_ready_ms,pos_ready_ms,close_ms,forced_close'
}

# ---------------------------------------------------------------- utilities

function Get-NowMs { [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) }

function Format-Utc([long]$ms) {
  [DateTimeOffset]::FromUnixTimeMilliseconds($ms).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', $Invariant)
}

function Format-CsvValue($value) {
  if ($null -eq $value) { return '' }
  if ($value -is [double] -or $value -is [single] -or $value -is [decimal]) {
    $value = [double]$value
    if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return '' }
    return ([double]$value).ToString('0.###', $Invariant)
  }
  if ($value -is [bool]) { if ($value) { return 'true' } else { return 'false' } }
  $text = [string]$value
  if ($text -match '[",\r\n]') { return '"' + $text.Replace('"', '""') + '"' }
  return $text
}

function Write-JsonFile([string]$path, $object) {
  [System.IO.File]::WriteAllText($path, ($object | ConvertTo-Json -Depth 12), $Utf8)
}

function Read-JsonFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $text = [System.IO.File]::ReadAllText($path, $Utf8)
  return (ConvertFrom-Json $text)
}

function Read-CsvRows([string]$dir, [string]$name) {
  $path = Join-Path $dir $name
  if (-not (Test-Path -LiteralPath $path)) { return , @() }
  $rows = @(Import-Csv -LiteralPath $path -Encoding UTF8)
  return , $rows
}

function ConvertTo-Double($text) {
  if ($null -eq $text -or [string]$text -eq '') { return [double]::NaN }
  return [double]::Parse([string]$text, $Invariant)
}

function Get-Percentile([double[]]$sorted, [double]$p) {
  if ($sorted.Count -eq 0) { return [double]::NaN }
  $index = [Math]::Min($sorted.Count - 1, [Math]::Max(0, [int][Math]::Ceiling($p / 100 * $sorted.Count) - 1))
  return $sorted[$index]
}

function Round1($value) {
  if ($null -eq $value -or [string]$value -eq '') { return $null }
  $number = [double]$value
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $null }
  return [Math]::Round($number, 1)
}

function Get-Slope([double[]]$x, [double[]]$y) {
  $n = $x.Count
  if ($n -lt 3) { return [double]::NaN }
  $mx = ($x | Measure-Object -Average).Average
  $my = ($y | Measure-Object -Average).Average
  $num = 0.0; $den = 0.0
  for ($i = 0; $i -lt $n; $i++) {
    $num += ($x[$i] - $mx) * ($y[$i] - $my)
    $den += ($x[$i] - $mx) * ($x[$i] - $mx)
  }
  if ($den -eq 0) { return [double]::NaN }
  return $num / $den
}

function Get-DataDir {
  if ($TestProfile) { return $TestProfile }
  return (Join-Path $env:APPDATA 'Puntovivo')
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

# -------------------------------------------------------------- native helpers

function Initialize-Native {
  if ('PvNative' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PvNative {
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
  static extern uint PdhOpenQuery(string source, IntPtr user, out IntPtr query);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
  static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr user, out IntPtr counter);
  [DllImport("pdh.dll")]
  static extern uint PdhCollectQueryData(IntPtr query);
  [DllImport("pdh.dll")]
  static extern uint PdhGetFormattedCounterValue(IntPtr counter, uint format, IntPtr type, out FmtValue value);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
  static extern uint PdhGetFormattedCounterArray(IntPtr counter, uint format, ref uint size, out uint count, IntPtr buffer);

  [StructLayout(LayoutKind.Explicit)]
  struct FmtValue { [FieldOffset(0)] public uint Status; [FieldOffset(8)] public double Value; }

  const uint FMT = 0x00000200 | 0x00008000; // PDH_FMT_DOUBLE | PDH_FMT_NOCAP100
  static IntPtr query = IntPtr.Zero;
  static readonly List<IntPtr> counters = new List<IntPtr>();

  // Returns, per path, whether the counter exists on this machine.
  public static bool[] Open(string[] paths) {
    if (PdhOpenQuery(null, IntPtr.Zero, out query) != 0) throw new Exception("PdhOpenQuery failed");
    bool[] ok = new bool[paths.Length];
    counters.Clear();
    for (int i = 0; i < paths.Length; i++) {
      IntPtr c;
      ok[i] = PdhAddEnglishCounter(query, paths[i], IntPtr.Zero, out c) == 0;
      counters.Add(ok[i] ? c : IntPtr.Zero);
    }
    PdhCollectQueryData(query);
    return ok;
  }

  public static void Collect() { if (query != IntPtr.Zero) PdhCollectQueryData(query); }

  public static double Value(int i) {
    if (counters[i] == IntPtr.Zero) return double.NaN;
    FmtValue v;
    if (PdhGetFormattedCounterValue(counters[i], FMT, IntPtr.Zero, out v) != 0 || v.Status > 1) return double.NaN;
    return v.Value;
  }

  // Wildcard counter: instance name -> value.
  public static Dictionary<string, double> Values(int i) {
    var result = new Dictionary<string, double>();
    if (counters[i] == IntPtr.Zero) return result;
    uint size = 0, count = 0;
    uint status = PdhGetFormattedCounterArray(counters[i], FMT, ref size, out count, IntPtr.Zero);
    if (status != 0x800007D2 || size == 0) return result;
    IntPtr buffer = Marshal.AllocHGlobal((int)size);
    try {
      if (PdhGetFormattedCounterArray(counters[i], FMT, ref size, out count, buffer) != 0) return result;
      // PDH_FMT_COUNTERVALUE_ITEM_W is 24 bytes on x86 and x64.
      for (int k = 0; k < count; k++) {
        IntPtr item = new IntPtr(buffer.ToInt64() + k * 24);
        string name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(item));
        uint itemStatus = (uint)Marshal.ReadInt32(new IntPtr(item.ToInt64() + 8));
        double value = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(new IntPtr(item.ToInt64() + 16)));
        if (name != null && itemStatus <= 1) result[name] = value;
      }
    } finally { Marshal.FreeHGlobal(buffer); }
    return result;
  }

  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  public static uint ForegroundPid() {
    uint pid;
    GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    return pid;
  }

  // Windows only lets the foreground app hand focus over; a released Alt tap
  // lifts that lock. Used only while the target window is not already in front.
  public static bool Activate(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return false;
    if (GetForegroundWindow() == hwnd) return true;
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(hwnd);
    return GetForegroundWindow() == hwnd;
  }
}
'@
}

# ------------------------------------------------------------- CDP client

$script:Cdp = $null

function Get-HttpText([string]$url, [int]$timeoutMs = 2000) {
  $request = [System.Net.HttpWebRequest]::Create($url)
  $request.Timeout = $timeoutMs
  $request.ReadWriteTimeout = $timeoutMs
  $request.Proxy = $null
  $response = $request.GetResponse()
  try {
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), $Utf8)
    return $reader.ReadToEnd()
  } finally { $response.Close() }
}

function Close-Cdp {
  if ($script:Cdp) {
    try { $script:Cdp.Socket.Dispose() } catch { }
  }
  $script:Cdp = $null
}

function Connect-Cdp {
  if ($script:Cdp -and $script:Cdp.Socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) { return $true }
  Close-Cdp
  try { $targets = ConvertFrom-Json (Get-HttpText "http://127.0.0.1:$($script:Port)/json/list") } catch { return $false }
  $page = $null
  foreach ($target in $targets) {
    $url = [string]$target.url
    if ($target.type -eq 'page' -and $url.StartsWith('puntovivo-app:') -and $url -notlike '*customer-display*') { $page = $target; break }
  }
  if (-not $page) { return $false }
  $socket = New-Object System.Net.WebSockets.ClientWebSocket
  try {
    $cts = [System.Threading.CancellationTokenSource]::new(5000)
    $socket.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $cts.Token).Wait()
  } catch {
    $socket.Dispose()
    return $false
  }
  $script:Cdp = @{ Socket = $socket; NextId = 1 }
  return $true
}

function Send-CdpMessage([string]$method, $params) {
  $id = $script:Cdp.NextId
  $script:Cdp.NextId = $id + 1
  $json = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress
  $bytes = $Utf8.GetBytes($json)
  $cts = [System.Threading.CancellationTokenSource]::new(5000)
  $script:Cdp.Socket.SendAsync([System.ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).Wait()
  return $id
}

function Receive-CdpReply([int]$id, [int]$timeoutMs) {
  $deadline = (Get-NowMs) + $timeoutMs
  $buffer = New-Object byte[] 65536
  while ((Get-NowMs) -lt $deadline) {
    $stream = New-Object System.IO.MemoryStream
    $cts = [System.Threading.CancellationTokenSource]::new([int][Math]::Max(1, $deadline - (Get-NowMs)))
    do {
      $result = $script:Cdp.Socket.ReceiveAsync([System.ArraySegment[byte]]::new($buffer), $cts.Token).Result
      $stream.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)
    $message = ConvertFrom-Json ($Utf8.GetString($stream.ToArray()))
    if ($message.id -eq $id) { return $message }
  }
  throw 'CDP reply timed out'
}

function Invoke-Cdp([string]$method, $params, [int]$timeoutMs = 5000) {
  if (-not (Connect-Cdp)) { return $null }
  try {
    $id = Send-CdpMessage $method $params
    return (Receive-CdpReply $id $timeoutMs)
  } catch {
    # A cancelled receive aborts the socket; the next call reconnects.
    Close-Cdp
    return $null
  }
}

function Invoke-PageJs([string]$expression, [int]$timeoutMs = 5000) {
  $reply = Invoke-Cdp 'Runtime.evaluate' @{ expression = $expression; returnByValue = $true; awaitPromise = $true } $timeoutMs
  if (-not $reply -or $reply.error -or $reply.result.exceptionDetails) { return $null }
  return $reply.result.result.value
}

$ProbeJs = @'
(() => {
  if (window.__pvm) return 'present';
  const m = (window.__pvm = { ipc: [], err: 0, lag: 0, ev: [] });
  const ipc = async () => {
    for (;;) {
      const started = performance.now();
      try {
        await window.electron.getAppVersion();
        m.ipc.push(performance.now() - started);
      } catch (error) {
        m.err += 1;
      }
      if (m.ipc.length > 5000) m.ipc.splice(0, m.ipc.length - 5000);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  };
  if (window.electron && window.electron.getAppVersion) ipc();
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    m.lag = Math.max(m.lag, now - last - 100);
    last = now;
  }, 100);
  // A sale runs from the first line in an empty cart until the charge closes
  // with the cart emptied. Events: [kind, at, charge ms, sale ms, lines].
  let open = false;
  let openedAt = 0;
  let closedAt = 0;
  let startedAt = 0;
  let lines = 0;
  const cart = () => document.querySelectorAll('[data-testid^="sale-cart-item-"]').length;
  setInterval(() => {
    const now = !!document.getElementById('sale-payment-form');
    const items = cart();
    if (items > 0 && !startedAt) startedAt = Date.now();
    if (now && !open) {
      openedAt = Date.now();
      lines = items;
      m.ev.push(['charge_open', openedAt, 0, 0, lines]);
    }
    if (!now && open) closedAt = Date.now();
    if (closedAt && !now) {
      if (items === 0) {
        m.ev.push(['sale_done', closedAt, closedAt - openedAt, startedAt ? closedAt - startedAt : 0, lines]);
        closedAt = 0;
        startedAt = 0;
      } else if (Date.now() - closedAt > 2000) {
        m.ev.push(['charge_closed', closedAt, closedAt - openedAt, 0, items]);
        closedAt = 0;
      }
    }
    if (items === 0 && !now && !closedAt) startedAt = 0;
    open = now;
    if (m.ev.length > 500) m.ev.splice(0, m.ev.length - 500);
  }, 200);
  return 'installed';
})()
'@

$StatsJs = @'
(() => {
  const m = window.__pvm;
  if (!m) return null;
  const a = m.ipc.splice(0).sort((x, y) => x - y);
  const pick = p => (a.length ? a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))] : null);
  const out = {
    n: a.length,
    p50: pick(50),
    p99: pick(99),
    max: a.length ? a[a.length - 1] : null,
    err: m.err,
    lag: m.lag,
    heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    nodes: document.getElementsByTagName('*').length,
    visibility: document.visibilityState,
    route: location.hash.split('?')[0],
    ev: m.ev.splice(0),
  };
  m.err = 0;
  m.lag = 0;
  return out;
})()
'@

$StateJs = @'
(() => {
  const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const q = s => document.querySelector(s);
  const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visible).length;
  const active = document.activeElement ? document.activeElement.id : '';
  return {
    route: location.hash.split('?')[0],
    login: visible(q('#email')) || visible(q('[id^="setup-"]')),
    pos: visible(q('#sales-product-search-input')),
    active,
    payment: !!q('#sale-payment-form'),
    cart: document.querySelectorAll('[data-testid^="sale-cart-item-"]').length,
    dialogs,
    probe: !!window.__pvm,
  };
})()
'@

$HealthJs = @'
(async () => {
  try {
    const url = await window.electron.getServerUrl();
    const response = await fetch(url + '/api/health', { cache: 'no-store' });
    return response.ok;
  } catch (error) {
    return false;
  }
})()
'@

$RendererInfoJs = @'
(async () => ({
  appVersion: window.electron && window.electron.getAppVersion ? await window.electron.getAppVersion() : null,
  graphics: document.documentElement.dataset.graphics || 'full',
  hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemory: navigator.deviceMemory,
  userAgent: navigator.userAgent,
  screen: screen.width + 'x' + screen.height,
}))()
'@

# ------------------------------------------------------------ run folder

function Initialize-RunDir {
  if (-not $Label) { throw '-Label is required (for example -Label v1.17.1).' }
  if ($Label -notmatch '^[\w.\-]+$') { throw '-Label may contain letters, digits, dot, dash and underscore only.' }
  $dir = Join-Path $OutDir $Label
  if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir) }
  $meta = Read-JsonFile (Join-Path $dir 'meta.json')
  if ($meta -and $meta.phases -and ($meta.phases.PSObject.Properties.Name -contains $Phase)) {
    if (-not $Force) { throw "Run $Label already has a $Phase phase. Use another -Label, or -Force to replace that phase." }
    Remove-PhaseRows $dir $Phase
  }
  foreach ($name in $CsvHeaders.Keys) {
    $path = Join-Path $dir $name
    if (-not (Test-Path -LiteralPath $path)) { [System.IO.File]::WriteAllText($path, $CsvHeaders[$name] + "`r`n", $Utf8) }
  }
  return $dir
}

function Remove-PhaseRows([string]$dir, [string]$phaseName) {
  foreach ($name in $CsvHeaders.Keys) {
    $path = Join-Path $dir $name
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $lines = [System.IO.File]::ReadAllLines($path, $Utf8)
    $header = $lines[0].Split(',')
    $index = [Array]::IndexOf($header, 'phase')
    if ($name -eq 'startup.csv') {
      if ($phaseName -eq 'startup') { [System.IO.File]::WriteAllText($path, $lines[0] + "`r`n", $Utf8) }
      continue
    }
    if ($index -lt 0) { continue }
    $kept = New-Object System.Collections.Generic.List[string]
    $kept.Add($lines[0])
    for ($i = 1; $i -lt $lines.Length; $i++) {
      $fields = $lines[$i].Split(',')
      if ($fields.Length -gt $index -and $fields[$index] -eq $phaseName) { continue }
      $kept.Add($lines[$i])
    }
    [System.IO.File]::WriteAllText($path, ([string]::Join("`r`n", $kept) + "`r`n"), $Utf8)
  }
}

$script:Buffers = @{}

function Add-Row([string]$file, [object[]]$values) {
  if (-not $script:Buffers.ContainsKey($file)) { $script:Buffers[$file] = New-Object System.Collections.Generic.List[string] }
  $cells = foreach ($value in $values) { Format-CsvValue $value }
  $script:Buffers[$file].Add([string]::Join(',', [string[]]$cells))
}

function Save-Rows {
  foreach ($file in @($script:Buffers.Keys)) {
    $buffer = $script:Buffers[$file]
    if ($buffer.Count -eq 0) { continue }
    [System.IO.File]::AppendAllText((Join-Path $script:Dir $file), ([string]::Join("`r`n", $buffer) + "`r`n"), $Utf8)
    $buffer.Clear()
  }
}

function Get-Elapsed { [Math]::Round(((Get-NowMs) - $script:PhaseStart) / 1000, 1) }

function Add-Marker([string]$kind, $n = $null, $value = $null, [string]$note = '') {
  $now = Get-NowMs
  Add-Row 'markers.csv' @($now, (Format-Utc $now), (Get-Elapsed), $Label, $Phase, $kind, $n, $value, $note)
}

# --------------------------------------------------------------- machine

function Get-SafeCim([string]$class, [string]$namespace = 'root/cimv2') {
  try { return @(Get-CimInstance -ClassName $class -Namespace $namespace -ErrorAction Stop) } catch { return @() }
}

function Get-MachineInfo {
  $os = Get-SafeCim 'Win32_OperatingSystem' | Select-Object -First 1
  $cs = Get-SafeCim 'Win32_ComputerSystem' | Select-Object -First 1
  $cpu = Get-SafeCim 'Win32_Processor' | Select-Object -First 1
  $current = $null
  try { $current = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop } catch { }
  $video = foreach ($v in (Get-SafeCim 'Win32_VideoController')) {
    [ordered]@{ name = $v.Name; driver_version = $v.DriverVersion; driver_date = [string]$v.DriverDate; resolution = "$($v.CurrentHorizontalResolution)x$($v.CurrentVerticalResolution)" }
  }
  $disks = @()
  try {
    $disks = foreach ($d in (Get-PhysicalDisk -ErrorAction Stop)) {
      [ordered]@{ name = $d.FriendlyName; media_type = [string]$d.MediaType; bus_type = [string]$d.BusType; size_gb = [Math]::Round($d.Size / 1GB, 1) }
    }
  } catch { }
  $pagefiles = foreach ($p in (Get-SafeCim 'Win32_PageFileUsage')) {
    [ordered]@{ path = $p.Name; allocated_mb = $p.AllocatedBaseSize; peak_mb = $p.PeakUsage }
  }
  $antivirus = foreach ($a in (Get-SafeCim 'AntiVirusProduct' 'root/SecurityCenter2')) { $a.displayName }
  $power = ''
  try { $power = (& powercfg.exe /getactivescheme) -join ' ' } catch { }
  return [ordered]@{
    computer       = $env:COMPUTERNAME
    cpu            = if ($cpu) { $cpu.Name.Trim() } else { $null }
    logical_cores  = [Environment]::ProcessorCount
    ram_mb         = if ($cs) { [Math]::Round($cs.TotalPhysicalMemory / 1MB) } else { $null }
    windows        = if ($os) { $os.Caption } else { $null }
    windows_build  = if ($os) { $os.BuildNumber } else { $null }
    windows_release = if ($current) { [string]$current.DisplayVersion } else { $null }
    windows_ubr    = if ($current) { $current.UBR } else { $null }
    architecture   = if ($os) { $os.OSArchitecture } else { $null }
    last_boot_utc  = if ($os) { $os.LastBootUpTime.ToUniversalTime().ToString('o', $Invariant) } else { $null }
    video          = @($video)
    disks          = @($disks)
    pagefile_auto  = if ($cs) { $cs.AutomaticManagedPagefile } else { $null }
    pagefiles      = @($pagefiles)
    antivirus      = @($antivirus)
    power_scheme   = $power
    powershell     = $PSVersionTable.PSVersion.ToString()
  }
}

function Get-UptimeSeconds {
  $os = Get-SafeCim 'Win32_OperatingSystem' | Select-Object -First 1
  if (-not $os) { return $null }
  return [Math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds)
}

function Get-DbSizeMb {
  $db = Join-Path (Get-DataDir) 'data\local.db'
  if (-not (Test-Path -LiteralPath $db)) { return $null }
  $size = (Get-Item -LiteralPath $db).Length
  $wal = "$db-wal"
  if (Test-Path -LiteralPath $wal) { $size += (Get-Item -LiteralPath $wal).Length }
  return [Math]::Round($size / 1MB, 1)
}

function Update-Meta([hashtable]$phaseInfo) {
  $path = Join-Path $script:Dir 'meta.json'
  $meta = Read-JsonFile $path
  $phases = [ordered]@{}
  $renderer = $null
  if ($meta) {
    if ($meta.phases) { foreach ($p in $meta.phases.PSObject.Properties) { $phases[$p.Name] = $p.Value } }
    $renderer = $meta.renderer
  }
  $phases[$Phase] = $phaseInfo
  if ($script:RendererInfo) { $renderer = $script:RendererInfo }
  $out = [ordered]@{
    label           = $Label
    harness_version = $HarnessVersion
    updated_utc     = Format-Utc (Get-NowMs)
    machine         = $script:Machine
    build           = $script:Build
    renderer        = $renderer
    gpu_counters    = $script:GpuCounters
    test_profile    = [bool]$TestProfile
    thresholds      = $Thresholds
    phases          = $phases
  }
  Write-JsonFile $path $out
}

# ------------------------------------------------------------- processes

function Resolve-Exe {
  if ($ExePath) {
    if (-not (Test-Path -LiteralPath $ExePath)) { throw "No executable at $ExePath" }
    return (Resolve-Path -LiteralPath $ExePath).Path
  }
  $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
  foreach ($key in $keys) {
    foreach ($entry in @(Get-ItemProperty $key -ErrorAction SilentlyContinue)) {
      if (-not ($entry.PSObject.Properties.Name -contains 'DisplayName')) { continue }
      if ([string]$entry.DisplayName -notlike 'Puntovivo*') { continue }
      if (-not ($entry.PSObject.Properties.Name -contains 'InstallLocation')) { continue }
      $candidate = Join-Path ([string]$entry.InstallLocation) "$ProcessName.exe"
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  $found = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Filter "$ProcessName.exe" -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.FullName }
  throw 'Puntovivo is not installed. Run -Phase install -Installer <setup.exe>, or pass -ExePath.'
}

function Get-AppProcesses {
  return @(Get-CimInstance -ClassName Win32_Process -Filter "Name='$ProcessName.exe'" -ErrorAction SilentlyContinue)
}

function Get-Role([string]$commandLine) {
  if ($commandLine -notmatch '--type=([\w-]+)') { return @('main', '') }
  $type = $Matches[1]
  $subtype = ''
  if ($commandLine -match '--utility-sub-type=([\w.\-]+)') { $subtype = $Matches[1] }
  switch ($type) {
    'renderer' { return @('renderer', $subtype) }
    'gpu-process' { return @('gpu', $subtype) }
    'utility' { return @('utility', $subtype) }
    'crashpad-handler' { return @('crashpad', $subtype) }
    default { return @('other', $type) }
  }
}

function Stop-ProcessTree([int]$rootPid) {
  $children = @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId=$rootPid" -ErrorAction SilentlyContinue)
  foreach ($child in $children) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $rootPid -Force -ErrorAction SilentlyContinue
}

function Start-App([switch]$NoAttach) {
  $existing = Get-AppProcesses
  if ($existing.Count -gt 0) {
    if ($NoAttach) { throw 'Close Puntovivo (and check the tray): the startup phase must launch it itself.' }
    foreach ($p in $existing) {
      $cmd = [string]$p.CommandLine
      if ($cmd -notmatch '--type=' -and $cmd -match '--remote-debugging-port=(\d+)') {
        $script:Port = [int]$Matches[1]
        $script:MainPid = [int]$p.ProcessId
        $script:LaunchAt = Get-NowMs
        $script:Watching = $true
        Write-Host "Attached to the running Puntovivo (pid $($script:MainPid), DevTools port $($script:Port))."
        return
      }
    }
    throw 'Puntovivo is already running. Close it (and check the tray) so the harness can launch it with measurement enabled.'
  }
  $exe = Resolve-Exe
  if ($CdpPort -gt 0) { $script:Port = $CdpPort } else { $script:Port = Get-FreePort }
  $arguments = "--remote-debugging-port=$($script:Port) --remote-debugging-address=127.0.0.1"
  # An update downloaded mid-run would replace the build under measurement.
  $launchEnv = @{ AUTO_UPDATE = 'false'; PUNTOVIVO_E2E = $null; PUNTOVIVO_BIND_PORT = $null }
  if ($TestProfile) {
    if ($env:PUNTOVIVO_DB_KEY -notmatch '^[0-9a-fA-F]{64}$') { throw '-TestProfile needs a throwaway 64-hex PUNTOVIVO_DB_KEY in the environment.' }
    $arguments += " `"--user-data-dir=$TestProfile`""
    $launchEnv.PUNTOVIVO_E2E = '1'
    $launchEnv.PUNTOVIVO_BIND_PORT = [string](Get-FreePort)
  }
  # Start-Process uses ShellExecute, so the app inherits this environment but
  # not the console handles: it outlives the harness without a broken stdout.
  $saved = @{}
  foreach ($name in $launchEnv.Keys) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name)
    [Environment]::SetEnvironmentVariable($name, $launchEnv[$name])
  }
  Close-Cdp
  try {
    $script:LaunchAt = Get-NowMs
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $exe) -PassThru
    $null = $process.Handle
  } finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
  }
  $script:MainPid = $process.Id
  $script:Watching = $true
  Start-Sleep -Milliseconds 1500
  if ($process.HasExited) { throw "Puntovivo exited right after launch (code $($process.ExitCode)). Is another copy running?" }
}

function Stop-App([int]$graceSec = 120) {
  $script:Watching = $false
  $started = Get-NowMs
  $process = Get-Process -Id $script:MainPid -ErrorAction SilentlyContinue
  $forced = $false
  if ($process) {
    [void]$process.CloseMainWindow()
    $deadline = $started + $graceSec * 1000
    while (-not $process.HasExited -and (Get-NowMs) -lt $deadline) { Start-Sleep -Milliseconds 250; $process.Refresh() }
    if (-not $process.HasExited) {
      Stop-ProcessTree $script:MainPid
      $forced = $true
    }
  }
  $deadline = (Get-NowMs) + 15000
  while ((Get-AppProcesses).Count -gt 0 -and (Get-NowMs) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  foreach ($left in (Get-AppProcesses)) {
    if ([int]$left.ParentProcessId -eq $script:MainPid) { Stop-Process -Id $left.ProcessId -Force -ErrorAction SilentlyContinue; $forced = $true }
  }
  Close-Cdp
  return @{ ms = (Get-NowMs) - $started; forced = $forced }
}

function Test-MainAlive {
  $process = Get-Process -Id $script:MainPid -ErrorAction SilentlyContinue
  return ($null -ne $process -and -not $process.HasExited)
}

# --------------------------------------------------------------- sampling

$SystemCounters = @(
  '\Memory\Available MBytes',
  '\Memory\Committed Bytes',
  '\Memory\Page Reads/sec',
  '\Memory\Pages Output/sec',
  '\Paging File(_Total)\% Usage',
  '\PhysicalDisk(_Total)\Avg. Disk Queue Length',
  '\Processor(_Total)\% Processor Time',
  '\GPU Process Memory(*)\Dedicated Usage',
  '\GPU Process Memory(*)\Shared Usage'
)

function Initialize-Sampling {
  Initialize-Native
  $ok = [PvNative]::Open([string[]]$SystemCounters)
  $script:GpuCounters = [bool]($ok[7] -and $ok[8])
  if (-not $script:GpuCounters) { Write-Host 'GPU Process Memory counters are missing (driver without WDDM 2.x): gpu_*_mb columns stay empty; the gpu working set still counts.' }
  $missing = @()
  for ($i = 0; $i -lt 7; $i++) { if (-not $ok[$i]) { $missing += $SystemCounters[$i] } }
  if ($missing.Count -gt 0) { Write-Host ('Counters not available: ' + ($missing -join ', ')) }
  $script:RoleCache = @{}
  $script:CpuPrev = @{}
  $script:SelfPid = $PID
  $script:Sales = @{ ok = 0; failed = 0 }
  $script:LastStatus = @{}
}

function Invoke-SystemSample {
  [PvNative]::Collect()
  $now = Get-NowMs
  Add-Row 'system.csv' @($now, (Format-Utc $now), (Get-Elapsed), $Label, $Phase,
    [PvNative]::Value(0), ([PvNative]::Value(1) / 1MB), [PvNative]::Value(2), [PvNative]::Value(3),
    [PvNative]::Value(4), [PvNative]::Value(5), [PvNative]::Value(6))
  $script:LastStatus.avail = [PvNative]::Value(0)
  $script:LastStatus.pageReads = [PvNative]::Value(2)
}

function Get-GpuMemoryByPid {
  $byPid = @{}
  if (-not $script:GpuCounters) { return $byPid }
  foreach ($pair in @(@(7, 'dedicated'), @(8, 'shared'))) {
    $values = [PvNative]::Values($pair[0])
    foreach ($name in $values.Keys) {
      if ($name -notmatch '^pid_(\d+)_') { continue }
      $key = [int]$Matches[1]
      if (-not $byPid.ContainsKey($key)) { $byPid[$key] = @{ dedicated = 0.0; shared = 0.0 } }
      $byPid[$key][$pair[1]] += $values[$name] / 1MB
    }
  }
  return $byPid
}

function Invoke-ProcessSample {
  $now = Get-NowMs
  $gpu = Get-GpuMemoryByPid
  $totals = @{ total = 0.0 }
  $processes = @([System.Diagnostics.Process]::GetProcessesByName($ProcessName)) + @(Get-Process -Id $script:SelfPid)
  foreach ($process in $processes) {
    try {
      $procId = $process.Id
      if ($procId -eq $script:SelfPid) {
        $role = 'harness'; $subtype = ''
      } else {
        if (-not $script:RoleCache.ContainsKey($procId)) {
          $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
          if (-not $cim) { continue }
          $script:RoleCache[$procId] = Get-Role ([string]$cim.CommandLine)
        }
        $role = $script:RoleCache[$procId][0]; $subtype = $script:RoleCache[$procId][1]
      }
      $cpuMs = $process.TotalProcessorTime.TotalMilliseconds
      $cpuPct = $null
      if ($script:CpuPrev.ContainsKey($procId)) {
        $prev = $script:CpuPrev[$procId]
        $wall = $now - $prev[1]
        if ($wall -gt 0) { $cpuPct = 100.0 * ($cpuMs - $prev[0]) / ($wall * [Environment]::ProcessorCount) }
      }
      $script:CpuPrev[$procId] = @($cpuMs, $now)
      $ws = $process.WorkingSet64 / 1MB
      $private = $process.PrivateMemorySize64 / 1MB
      $dedicated = $null; $shared = $null
      if ($gpu.ContainsKey($procId)) { $dedicated = $gpu[$procId].dedicated; $shared = $gpu[$procId].shared }
      Add-Row 'samples.csv' @($now, (Format-Utc $now), (Get-Elapsed), $Label, $Phase, $procId, $role, $subtype,
        $ws, $private, $cpuPct, $process.HandleCount, $process.Threads.Count, $dedicated, $shared)
      if ($role -ne 'harness') {
        $totals.total += $ws
        if (-not $totals.ContainsKey($role)) { $totals[$role] = 0.0 }
        $totals[$role] += $ws
      }
    } catch { }
  }
  $script:LastStatus.memory = $totals
}

function Invoke-RendererSample {
  $now = Get-NowMs
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $stats = Invoke-PageJs $StatsJs
  $timer.Stop()
  if (-not $stats) {
    [void](Invoke-PageJs $ProbeJs)
    Add-Row 'renderer.csv' @($now, (Format-Utc $now), (Get-Elapsed), $Label, $Phase, 0, $null, $null, $null, $null, $null, $null, $null, '', '', $timer.ElapsedMilliseconds)
    return
  }
  Add-Row 'renderer.csv' @($now, (Format-Utc $now), (Get-Elapsed), $Label, $Phase, $stats.n, $stats.p50, $stats.p99, $stats.max,
    $stats.err, $stats.lag, $stats.heap, $stats.nodes, $stats.visibility, $stats.route, $timer.ElapsedMilliseconds)
  foreach ($item in @($stats.ev)) {
    if ($null -eq $item) { continue }
    $kind = [string]$item[0]
    $at = [long]$item[1]
    Add-Row 'markers.csv' @($at, (Format-Utc $at), [Math]::Round(($at - $script:PhaseStart) / 1000, 1), $Label, $Phase, $kind, $null, $item[2], 'renderer')
    # The simulated cashier times its own sales; a person's sales are timed here.
    if ($kind -eq 'sale_done' -and -not $Drive -and $Phase -ne 'startup' -and [long]$item[3] -gt 0) {
      $script:ManualCount++
      $from = $at - [long]$item[3]
      Add-Row 'sales.csv' @($from, (Format-Utc $from), $Label, $Phase, $script:ManualCount, 'manual', 'keyboard', $item[4], $item[3], $item[2], 'ok', '')
      $script:Sales.ok++
      Write-Host ("Sale {0}: {1:0.0} s from the first scan, {2:0.0} s to charge." -f $script:ManualCount, ([double]$item[3] / 1000), ([double]$item[2] / 1000))
    }
  }
  $script:LastStatus.ipc = $stats.p99
}

function Write-Status {
  $m = $script:LastStatus.memory
  if (-not $m) { return }
  $part = { param($role) if ($m.ContainsKey($role)) { '{0:0}' -f $m[$role] } else { '-' } }
  $line = '[{0}] main {1} | renderer {2} | gpu {3} | utility {4} | total {5:0} MB | free {6:0} MB | page reads {7:0.0}/s | ipc p99 {8} ms | sales {9} ok, {10} failed' -f `
    ([TimeSpan]::FromSeconds((Get-Elapsed)).ToString('hh\:mm\:ss')), (& $part 'main'), (& $part 'renderer'), (& $part 'gpu'), (& $part 'utility'),
    $m.total, $script:LastStatus.avail, $script:LastStatus.pageReads, $script:LastStatus.ipc, $script:Sales.ok, $script:Sales.failed
  Write-Host $line
}

# ------------------------------------------------------------------ loop

function Initialize-Keys {
  $script:KeysEnabled = $false
  try {
    [void][Console]::KeyAvailable
    [Console]::TreatControlCAsInput = $true
    $script:KeysEnabled = $true
  } catch { }
  $script:Quit = $false
  $script:ManualCount = 0
  $script:BackupOpen = $false
  $script:BackupCount = 0
}

function Read-Keys {
  if (-not $script:KeysEnabled) { return }
  while ([Console]::KeyAvailable) {
    $key = [Console]::ReadKey($true)
    $char = [char]::ToUpperInvariant($key.KeyChar)
    if ($key.Key -eq 'C' -and ($key.Modifiers -band [ConsoleModifiers]::Control)) { $char = 'Q' }
    switch ($char) {
      'B' {
        if ($script:BackupOpen) {
          Add-Marker 'backup_end' $script:BackupCount
          Write-Host "Backup $($script:BackupCount) finished."
        } else {
          $script:BackupCount++
          Add-Marker 'backup_start' $script:BackupCount
          Write-Host "Backup $($script:BackupCount) started. Press B again when it finishes."
        }
        $script:BackupOpen = -not $script:BackupOpen
      }
      'N' {
        $note = Read-Host 'Note'
        Add-Marker 'note' $null $null $note
      }
      'Q' { $script:Quit = $true }
    }
  }
}

function Start-Loop {
  $script:NextSystem = Get-NowMs
  $script:NextInterval = (Get-NowMs) + $IntervalSec * 1000
  $script:GoneAt = $null
}

function Invoke-Tick {
  $now = Get-NowMs
  if ($script:Recording -and $now -ge $script:NextSystem) {
    Invoke-SystemSample
    $script:NextSystem = [Math]::Max($script:NextSystem + 1000, $now + 500)
  }
  if ($script:Recording -and $now -ge $script:NextInterval) {
    Invoke-ProcessSample
    if ($script:Watching -and -not $script:GoneAt) { Invoke-RendererSample }
    Save-Rows
    Write-Status
    $script:NextInterval = [Math]::Max($script:NextInterval + $IntervalSec * 1000, $now + 1000)
  }
  Read-Keys
  if ($script:Watching -and -not $script:GoneAt -and -not (Test-MainAlive)) {
    $script:GoneAt = Get-NowMs
    Add-Marker 'process_gone' $null $script:MainPid
    Save-Rows
    Write-Host 'Puntovivo closed. Waiting 2 minutes before finishing.'
  }
}

function Wait-Page([scriptblock]$condition, [int]$timeoutMs, [int]$pollMs = 100) {
  $deadline = (Get-NowMs) + $timeoutMs
  while ((Get-NowMs) -lt $deadline) {
    Invoke-Tick
    if ($script:Quit -or $script:GoneAt) { return $null }
    $state = Invoke-PageJs $StateJs 3000
    if ($state -and (& $condition $state)) { return $state }
    Start-Sleep -Milliseconds $pollMs
  }
  return $null
}

function Save-RendererInfo {
  $info = Invoke-PageJs $RendererInfoJs
  if ($info) {
    $script:RendererInfo = $info
    if ($info.appVersion) { $script:Build.app_version = $info.appVersion }
  }
}

function Wait-Ready([string]$target, [int]$timeoutMs) {
  # Returns the ms since launch at which the target became usable, or $null.
  $started = Get-NowMs
  $probeInstalled = $false
  $healthy = $false
  while (((Get-NowMs) - $started) -lt $timeoutMs) {
    Invoke-Tick
    if ($script:Quit) { return $null }
    if ($script:GoneAt) { throw 'Puntovivo closed before it was ready.' }
    $state = Invoke-PageJs $StateJs 3000
    if ($state) {
      if (-not $probeInstalled) { $probeInstalled = [bool](Invoke-PageJs $ProbeJs) }
      $ready = if ($target -eq 'pos') { [bool]$state.pos } else { [bool]($state.login -or $state.pos) }
      if ($ready) {
        if (-not $healthy) { $healthy = [bool](Invoke-PageJs $HealthJs 5000) }
        if ($healthy) { return ((Get-NowMs) - $script:LaunchAt) }
      }
    }
    Start-Sleep -Milliseconds 100
  }
  return $null
}

# ------------------------------------------------------------------ cashier

function Read-Barcodes([string]$path) {
  if (-not $path) { throw '-Drive needs -Barcodes: a text file with one barcode per line, or a CSV with a barcode column.' }
  if (-not (Test-Path -LiteralPath $path)) { throw "Barcode file not found: $path" }
  $lines = @([System.IO.File]::ReadAllLines((Resolve-Path -LiteralPath $path).Path, $Utf8) | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -eq 0) { throw "Barcode file is empty: $path" }
  $codes = New-Object System.Collections.Generic.List[string]
  $separator = $null
  if ($lines[0].Contains(';')) { $separator = ';' } elseif ($lines[0].Contains(',')) { $separator = ',' }
  $column = 0
  $start = 0
  if ($separator) {
    $header = @($lines[0].Split($separator) | ForEach-Object { $_.Trim().Trim('"').ToLowerInvariant() })
    $column = -1
    for ($i = 0; $i -lt $header.Count; $i++) { if ($header[$i] -match '^(barcode|codigo_barras|codigo de barras|ean|upc)$') { $column = $i; break } }
    if ($column -lt 0) { throw "No barcode column in $path (expected a header named barcode)." }
    $start = 1
  }
  $short = 0
  for ($i = $start; $i -lt $lines.Count; $i++) {
    $value = $lines[$i]
    if ($separator) { $fields = $value.Split($separator); if ($fields.Count -le $column) { continue }; $value = $fields[$column] }
    $value = $value.Trim().Trim('"')
    if ($value -notmatch '^[0-9A-Za-z\-]+$') { continue }
    # The scanner listener needs six characters before it treats input as a scan.
    if ($value.Length -lt 6) { $short++; continue }
    if (-not $codes.Contains($value)) { $codes.Add($value) }
  }
  if ($short -gt 0) { Write-Host "$short codes shorter than 6 characters were skipped: the scanner listener ignores them." }
  if ($codes.Count -eq 0) { throw "No usable barcodes in $path." }
  return , $codes
}

function ConvertTo-SendKeys([string]$text) {
  $out = New-Object System.Text.StringBuilder
  foreach ($c in $text.ToCharArray()) {
    if ('+^%~(){}[]'.IndexOf($c) -ge 0) { [void]$out.Append('{').Append($c).Append('}') } else { [void]$out.Append($c) }
  }
  return $out.ToString()
}

function Get-CdpKeyEvents([string]$key, [int]$modifiers = 0) {
  $named = @{ Enter = @(13, "`r"); F1 = @(112, $null); F2 = @(113, $null); Escape = @(27, $null) }
  if ($named.ContainsKey($key)) {
    $vk = $named[$key][0]; $text = $named[$key][1]; $code = $key
  } else {
    $upper = $key.ToUpperInvariant()
    $vk = [int][char]$upper
    if ($key -match '^\d$') { $code = "Digit$key" } elseif ($key -match '^[A-Za-z]$') { $code = "Key$upper" } else { $code = '' }
    if ($key -eq '-') { $vk = 189; $code = 'Minus' }
    $text = if ($modifiers -eq 0) { $key } else { $null }
  }
  $down = @{ type = 'keyDown'; key = $key; code = $code; windowsVirtualKeyCode = $vk; nativeVirtualKeyCode = $vk; modifiers = $modifiers }
  if ($text) { $down.text = $text; $down.unmodifiedText = $text }
  $up = @{ type = 'keyUp'; key = $key; code = $code; windowsVirtualKeyCode = $vk; nativeVirtualKeyCode = $vk; modifiers = $modifiers }
  return @($down, $up)
}

function Send-CdpKeys([string[]]$keys, [int]$modifiers = 0) {
  if (-not (Connect-Cdp)) { return $false }
  try {
    # Pipelined like a scanner burst: every event is sent before any reply is read.
    $ids = New-Object System.Collections.Generic.List[int]
    foreach ($key in $keys) {
      foreach ($keyEvent in (Get-CdpKeyEvents $key $modifiers)) { $ids.Add((Send-CdpMessage 'Input.dispatchKeyEvent' $keyEvent)) }
    }
    foreach ($id in $ids) { [void](Receive-CdpReply $id 5000) }
    return $true
  } catch {
    Close-Cdp
    return $false
  }
}

function Get-MainWindow {
  $process = Get-Process -Id $script:MainPid -ErrorAction SilentlyContinue
  if (-not $process) { return [IntPtr]::Zero }
  return $process.MainWindowHandle
}

function Test-Foreground {
  $foreground = [int][PvNative]::ForegroundPid()
  if ($foreground -eq $script:MainPid) { return $true }
  if ([PvNative]::Activate((Get-MainWindow))) {
    Add-Marker 'focus_restored'
    return $true
  }
  Add-Marker 'focus_lost' $null $foreground
  return $false
}

# Sends one key chord. SendKeys goes through Windows input like a real
# keyboard; CDP input reaches only the Puntovivo page, never another window.
function Send-Keys([string]$sendKeysText, [string[]]$cdpKeys, [int]$cdpModifiers = 0) {
  if ($script:InputMode -eq 'sendkeys') {
    if (-not (Test-Foreground)) {
      $script:FocusFailures++
      if ($KeyInput -eq 'auto' -and $script:FocusFailures -ge 3) {
        $script:InputMode = 'cdp'
        Add-Marker 'input_fallback' $null $null 'cdp'
        Write-Host 'Puntovivo could not keep the foreground; the cashier continues through DevTools input.'
      } else {
        return $false
      }
    } else {
      $script:FocusFailures = 0
      [System.Windows.Forms.SendKeys]::SendWait($sendKeysText)
      return $true
    }
  }
  return (Send-CdpKeys $cdpKeys $cdpModifiers)
}

function Send-Code([string]$code) {
  $chars = @($code.ToCharArray() | ForEach-Object { [string]$_ }) + @('Enter')
  return (Send-Keys ((ConvertTo-SendKeys $code) + '{ENTER}') $chars)
}

function Reset-SalesScreen {
  for ($i = 0; $i -lt 3; $i++) {
    $state = Invoke-PageJs $StateJs 3000
    if (-not $state) { return $null }
    if ($state.route -ne '#/sales') { return $state }
    if ($state.dialogs -gt 0 -or $state.payment) { [void](Send-Keys '{ESC}' @('Escape')); Start-Sleep -Milliseconds 400; continue }
    if ($state.active -ne 'sales-product-search-input') { [void](Send-Keys '%p' @('p') 1); Start-Sleep -Milliseconds 300; continue }
    return $state
  }
  return (Invoke-PageJs $StateJs 3000)
}

function Invoke-DriveSale {
  $script:DriveCount++
  $n = $script:DriveCount
  $state = Reset-SalesScreen
  if (-not $state -or $state.route -ne '#/sales' -or $state.active -ne 'sales-product-search-input') {
    $route = ''
    if ($state) { $route = $state.route }
    Add-Marker 'drive_paused' $n $null "not ready on the sales screen ($route)"
    $script:DriveCount--
    return
  }
  $pool = @($script:Codes | Where-Object { -not $script:BadCodes.Contains($_) })
  if ($pool.Count -eq 0) { throw 'Every barcode failed to add a product; check the -Barcodes file against the catalog.' }
  $items = [Math]::Min($pool.Count, (Get-Random -Minimum $ItemsMin -Maximum ($ItemsMax + 1)))
  $picked = @($pool | Get-Random -Count $items)
  $started = Get-NowMs
  Add-Marker 'sale_start' $n $items 'drive'
  $status = 'ok'
  $note = ''
  $cart = [int]$state.cart
  $added = 0
  foreach ($code in $picked) {
    if (-not (Send-Code $code)) { $status = 'paused'; $note = 'focus lost'; break }
    $expected = $cart + 1
    $after = Wait-Page { param($s) $s.cart -ge $expected -or $s.dialogs -gt 0 } 10000
    if ($script:Quit -or $script:GoneAt) { $status = 'paused'; $note = 'stopped'; break }
    if ($after -and $after.cart -ge $expected) { $cart = [int]$after.cart; $added++; continue }
    [void]$script:BadCodes.Add($code)
    Add-Marker 'scan_miss' $n $null $code
    [void](Reset-SalesScreen)
  }
  $chargeAt = $null
  if ($status -eq 'ok' -and $added -eq 0) { $status = 'failed'; $note = 'no product added' }
  if ($status -eq 'ok') {
    $chargeAt = Get-NowMs
    [void](Send-Keys '{F2}' @('F2'))
    $open = Wait-Page { param($s) $s.payment -and $s.active -eq 'sale-payment-confirm' } 10000
    if (-not $open) { $open = Wait-Page { param($s) $s.payment } 2000 }
    if (-not $open) {
      $status = 'failed'; $note = 'payment did not open'
    } elseif ($open.active -eq 'sale-payment-confirm') {
      [void](Send-Keys '{ENTER}' @('Enter'))
    } else {
      [void](Send-Keys '{F1}' @('F1'))
    }
  }
  if ($status -eq 'ok') {
    $done = Wait-Page { param($s) -not $s.payment -and $s.cart -eq 0 } 30000
    if ($script:Quit -or $script:GoneAt) { $status = 'paused'; $note = 'stopped' }
    elseif (-not $done) { $status = 'timeout'; $note = 'sale did not complete in 30 s'; [void](Reset-SalesScreen) }
  }
  $ended = Get-NowMs
  $duration = $ended - $started
  $charge = $null
  if ($chargeAt) { $charge = $ended - $chargeAt }
  if ($status -eq 'paused') {
    Add-Marker 'drive_paused' $n $null $note
    $script:DriveCount--
    return
  }
  if ($status -eq 'timeout') { $duration = 30000 + ($chargeAt - $started) }
  Add-Marker 'sale_end' $n $duration $status
  Add-Row 'sales.csv' @($started, (Format-Utc $started), $Label, $Phase, $n, 'drive', $script:InputMode, $added, $duration, $charge, $status, $note)
  if ($status -eq 'ok') { $script:Sales.ok++ } else { $script:Sales.failed++ }
  Save-Rows
}

# ------------------------------------------------------------------- phases

function Invoke-Install {
  if (-not $Installer) { throw '-Phase install needs -Installer <Puntovivo-x.y.z-win-x64.exe>.' }
  if (-not (Test-Path -LiteralPath $Installer)) { throw "Installer not found: $Installer" }
  if ((Get-AppProcesses).Count -gt 0) { throw 'Close Puntovivo (and check the tray) before installing.' }
  Write-Host "Installing $Installer silently..."
  # Start-Process -Wait would also wait for an app the installer launches.
  $process = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru
  $null = $process.Handle
  if (-not $process.WaitForExit(600000)) { throw 'The installer did not finish in 10 minutes.' }
  if ($process.ExitCode -ne 0) { throw "The installer exited with code $($process.ExitCode)." }
  Start-Sleep -Seconds 3
  # Some installer builds launch the app when they finish.
  foreach ($p in (Get-AppProcesses)) {
    if ([string]$p.CommandLine -notmatch '--type=') {
      $script:MainPid = [int]$p.ProcessId
      [void](Stop-App 60)
    }
  }
  $exe = Resolve-Exe
  $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  Write-Host "Installed $version at $exe"
  if ($Baseline) { Restore-Baseline }
}

function Save-Baseline {
  if (-not $Baseline) { throw '-Phase baseline needs -Baseline <path to .zip>.' }
  if ((Get-AppProcesses).Count -gt 0) { throw 'Close Puntovivo (and check the tray) before saving the baseline.' }
  $data = Get-DataDir
  if (-not (Test-Path -LiteralPath $data)) { throw "No data folder at $data. Open Puntovivo once and set up the company first." }
  if ((Test-Path -LiteralPath $Baseline) -and -not $Force) { throw "$Baseline exists. Use -Force to replace it." }
  if (Test-Path -LiteralPath $Baseline) { Remove-Item -LiteralPath $Baseline -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($data, $Baseline, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  Write-Host ("Saved {0} ({1:0.0} MB) from {2}" -f $Baseline, ((Get-Item -LiteralPath $Baseline).Length / 1MB), $data)
}

function Restore-Baseline {
  if (-not (Test-Path -LiteralPath $Baseline)) { throw "Baseline not found: $Baseline" }
  if ((Get-AppProcesses).Count -gt 0) { throw 'Close Puntovivo before restoring the baseline.' }
  $data = Get-DataDir
  if (Test-Path -LiteralPath $data) {
    $aside = '{0}.before-{1}' -f $data, (Get-Date).ToString('yyyyMMdd-HHmmss', $Invariant)
    Move-Item -LiteralPath $data -Destination $aside
    Write-Host "Moved the current data to $aside (delete it once the comparison is done)."
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $Baseline).Path, $data)
  Write-Host "Restored $Baseline into $data"
}

function Initialize-Live {
  $script:Dir = Initialize-RunDir
  Initialize-Sampling
  Initialize-Keys
  $script:Machine = Get-MachineInfo
  $exe = Resolve-Exe
  $script:Build = [ordered]@{ exe = $exe; product_version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion; app_version = $null }
  $script:RendererInfo = $null
  $script:Watching = $false
  $script:Recording = $true
  $script:Completed = $false
  $script:PhaseStart = Get-NowMs
  $script:PhaseInfo = [ordered]@{ started_utc = Format-Utc $script:PhaseStart; interval_s = $IntervalSec; db_mb_start = Get-DbSizeMb }
  Start-Loop
  Write-Host "Run folder: $($script:Dir)"
}

function Complete-Live([hashtable]$extra) {
  Save-Rows
  $script:PhaseInfo.ended_utc = Format-Utc (Get-NowMs)
  $script:PhaseInfo.duration_s = Get-Elapsed
  $script:PhaseInfo.db_mb_end = Get-DbSizeMb
  if ($extra) { foreach ($k in $extra.Keys) { $script:PhaseInfo[$k] = $extra[$k] } }
  Update-Meta $script:PhaseInfo
  $script:Completed = $true
}

function Invoke-Startup {
  Initialize-Live
  $uptime = Get-UptimeSeconds
  if ($uptime -gt 1800) { Write-Host ("Windows has been up {0:0} minutes: run 1 is not a cold start. Reboot and wait 5 minutes for a cold start." -f ($uptime / 60)) }
  for ($run = 1; $run -le $Runs; $run++) {
    if ($run -gt 1) { $wait = (Get-NowMs) + 10000; while ((Get-NowMs) -lt $wait) { Invoke-Tick; Start-Sleep -Milliseconds 200 } }
    $kind = if ($run -eq 1) { 'cold' } else { 'warm' }
    $runUptime = Get-UptimeSeconds
    Start-App -NoAttach
    Add-Marker 'launch' $run
    Write-Host "Run ${run}: launched; waiting for the login screen..."
    $login = Wait-Ready 'login' 180000
    if ($null -eq $login) { throw "Run ${run}: the login screen did not become usable in 3 minutes." }
    Add-Marker 'login_ready' $run $login
    Write-Host ("Run {0}: login usable {1:0.0} s after launch." -f $run, ($login / 1000))
    Save-RendererInfo
    $pos = $null
    if ($StopAt -eq 'pos') {
      Write-Host 'Sign in now. The harness waits for the point of sale.'
      $pos = Wait-Ready 'pos' 600000
      if ($null -ne $pos) {
        Add-Marker 'pos_ready' $run $pos
        Write-Host ("Run {0}: point of sale ready {1:0.0} s after launch." -f $run, ($pos / 1000))
      }
    }
    $settle = (Get-NowMs) + 10000
    while ((Get-NowMs) -lt $settle) { Invoke-Tick; Start-Sleep -Milliseconds 200 }
    Invoke-ProcessSample
    Save-Rows
    $closed = Stop-App
    if ($closed.forced) { Add-Marker 'forced_close' $run $closed.ms }
    $now = Get-NowMs
    Add-Row 'startup.csv' @($now, (Format-Utc $now), $Label, $run, $kind, $runUptime, $login, $pos, $closed.ms, $closed.forced)
    Save-Rows
    Start-Loop
  }
  Complete-Live @{ runs = $Runs; stop_at = $StopAt }
}

function Invoke-Monitor([double]$durationMin) {
  Initialize-Live
  if ($Phase -eq 'sales' -and $durationMin -le 0 -and -not $script:KeysEnabled) { throw 'Without an interactive console, give the sales phase -Minutes.' }
  if ($Drive) {
    $script:Codes = Read-Barcodes $Barcodes
    $script:BadCodes = New-Object 'System.Collections.Generic.HashSet[string]'
    $script:DriveCount = 0
    $script:FocusFailures = 0
    $script:InputMode = if ($KeyInput -eq 'cdp') { 'cdp' } else { 'sendkeys' }
    if ($script:InputMode -eq 'sendkeys') { Add-Type -AssemblyName System.Windows.Forms }
    Write-Host "Simulated cashier: $($script:Codes.Count) barcodes, one sale every $SaleEverySec s, input $($script:InputMode)."
  }
  # The phase measures the open point of sale, not the sign-in.
  $script:Recording = $false
  Start-App
  Write-Host 'Waiting for the point of sale (sign in if asked)...'
  if ($null -eq (Wait-Ready 'pos' 900000)) { throw 'The point of sale did not open in 15 minutes.' }
  Save-RendererInfo
  if ($Phase -eq 'sales') { Write-Host 'Sell as usual: every sale is timed from its first scan.' }
  if ($script:KeysEnabled) { Write-Host 'Keys in this window: B backup start and end, N note, Q finish.' }
  $script:PhaseStart = Get-NowMs
  $script:PhaseInfo.started_utc = Format-Utc $script:PhaseStart
  $script:Recording = $true
  Start-Loop
  $end = if ($durationMin -gt 0) { $script:PhaseStart + [long]($durationMin * 60000) } else { [long]::MaxValue }
  $nextSale = (Get-NowMs) + 5000
  while ((Get-NowMs) -lt $end -and -not $script:Quit) {
    Invoke-Tick
    if ($script:GoneAt) {
      if (((Get-NowMs) - $script:GoneAt) -gt 120000) { break }
    } elseif ($Drive -and (Get-NowMs) -ge $nextSale) {
      $saleStarted = Get-NowMs
      Invoke-DriveSale
      $nextSale = [Math]::Max($nextSale + $SaleEverySec * 1000, $saleStarted + 2000)
    }
    Start-Sleep -Milliseconds 100
  }
  Invoke-ProcessSample
  if (-not $script:GoneAt) { Invoke-RendererSample }
  $extra = @{ sales_ok = $script:Sales.ok; sales_failed = $script:Sales.failed; drive = [bool]$Drive }
  if ($Drive) { $extra.input = $script:InputMode; $extra.bad_codes = @($script:BadCodes) }
  if ($CloseAtEnd -and -not $script:GoneAt) {
    $closed = Stop-App
    if ($closed.forced) { Add-Marker 'forced_close' $null $closed.ms }
  }
  Complete-Live $extra
}

# ---------------------------------------------------------------- summary

function New-Verdict([string]$id, [string]$rule, [string]$status, $value, $limit, [string]$detail) {
  return [ordered]@{ id = $id; rule = $rule; status = $status; value = $value; limit = $limit; detail = $detail }
}

function Get-RoleSeries($rows) {
  # t_ms -> per-role working set, total and private sums.
  $byTime = @{}
  foreach ($r in $rows) {
    if ($r.role -eq 'harness') { continue }
    $t = [long]$r.t_ms
    if (-not $byTime.ContainsKey($t)) { $byTime[$t] = @{ total = 0.0; private = 0.0; main = 0.0; renderer = 0.0; gpu = 0.0; utility = 0.0; crashpad = 0.0; other = 0.0 } }
    $ws = ConvertTo-Double $r.working_set_mb
    $byTime[$t][$r.role] += $ws
    $byTime[$t].total += $ws
    $byTime[$t].private += ConvertTo-Double $r.private_mb
  }
  $times = @($byTime.Keys | Sort-Object)
  return @{ times = $times; byTime = $byTime }
}

function Invoke-Summarize([string]$dir) {
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { throw "Run folder not found: $dir" }
  $meta = Read-JsonFile (Join-Path $dir 'meta.json')
  $samples = Read-CsvRows $dir 'samples.csv'
  $system = Read-CsvRows $dir 'system.csv'
  $renderer = Read-CsvRows $dir 'renderer.csv'
  $markers = Read-CsvRows $dir 'markers.csv'
  $sales = Read-CsvRows $dir 'sales.csv'
  $startup = Read-CsvRows $dir 'startup.csv'
  if (-not $meta -or ($samples.Count -eq 0 -and $startup.Count -eq 0 -and $sales.Count -eq 0)) {
    throw "Nothing to summarize in $dir (no meta.json or no measurements)."
  }
  $runLabel = [string]$meta.label
  $verdicts = New-Object System.Collections.Generic.List[object]
  $T = $Thresholds

  # Memory, from the soak when there is one.
  $soakRows = @($samples | Where-Object { $_.phase -eq 'soak' })
  $memoryRows = if ($soakRows.Count -gt 0) { $soakRows } else { $samples }
  $series = Get-RoleSeries $memoryRows
  $times = $series.times
  $memory = [ordered]@{ source_phase = $(if ($soakRows.Count -gt 0) { 'soak' } else { 'all' }); roles = [ordered]@{} }
  $durationH = 0.0
  if ($times.Count -gt 1) { $durationH = ($times[-1] - $times[0]) / 3600000.0 }
  $fromH = if ($durationH -ge $T.U3_minSoakHours) { 1.0 } else { $durationH / 4 }
  foreach ($role in @('main', 'renderer', 'gpu', 'utility', 'total')) {
    if ($times.Count -eq 0) { break }
    $values = @($times | ForEach-Object { $series.byTime[$_][$role] })
    $xs = New-Object System.Collections.Generic.List[double]
    $ys = New-Object System.Collections.Generic.List[double]
    $tail = New-Object System.Collections.Generic.List[double]
    for ($i = 0; $i -lt $times.Count; $i++) {
      $h = ($times[$i] - $times[0]) / 3600000.0
      if ($h -ge $fromH) { $xs.Add($h); $ys.Add($values[$i]) }
      if ($times[-1] - $times[$i] -le $T.U1_windowMin * 60000) { $tail.Add($values[$i]) }
    }
    $memory.roles[$role] = [ordered]@{
      start_mb        = Round1 $values[0]
      peak_mb         = Round1 (($values | Measure-Object -Maximum).Maximum)
      end_mb          = Round1 $values[-1]
      last10_mean_mb  = Round1 (($tail | Measure-Object -Average).Average)
      slope_mb_per_h  = Round1 (Get-Slope $xs.ToArray() $ys.ToArray())
    }
  }
  $memory.duration_h = [Math]::Round($durationH, 2)

  # U1: GPU + utility after the soak.
  if ($soakRows.Count -eq 0) {
    $verdicts.Add((New-Verdict 'U1' 'GPU + utility after the soak' 'SKIP' $null $T.U1_gpuUtilityMb 'no soak phase'))
  } elseif ($durationH * 60 -lt $T.U1_windowMin) {
    $verdicts.Add((New-Verdict 'U1' 'GPU + utility after the soak' 'SKIP' $null $T.U1_gpuUtilityMb 'soak shorter than the averaging window'))
  } else {
    $tail = @($times | Where-Object { $times[-1] - $_ -le $T.U1_windowMin * 60000 } | ForEach-Object { $series.byTime[$_].gpu + $series.byTime[$_].utility })
    $mean = ($tail | Measure-Object -Average).Average
    $status = if ($mean -gt $T.U1_gpuUtilityMb) { 'FAIL' } else { 'PASS' }
    $verdicts.Add((New-Verdict 'U1' 'GPU + utility after the soak' $status (Round1 $mean) $T.U1_gpuUtilityMb ("mean of the last {0} min after {1:0.0} h" -f $T.U1_windowMin, $durationH)))
  }

  # U2: paging during a sale, per-second samples inside each sale window.
  $sysT = New-Object System.Collections.Generic.List[long]
  $sysReads = New-Object System.Collections.Generic.List[double]
  $sysAvail = New-Object System.Collections.Generic.List[double]
  foreach ($row in $system) {
    $sysT.Add([long]$row.t_ms); $sysReads.Add((ConvertTo-Double $row.page_reads)); $sysAvail.Add((ConvertTo-Double $row.avail_mb))
  }
  $saleRows = @($sales | Where-Object { $_.status -eq 'ok' -or $_.status -eq 'timeout' } | Sort-Object { [long]$_.t_ms })
  if ($saleRows.Count -eq 0 -or $sysT.Count -eq 0) {
    $verdicts.Add((New-Verdict 'U2' 'Paging during a sale' 'SKIP' $null $T.U2_pageReadsPerSec 'no sales with system samples'))
  } else {
    $bad = 0; $worstReads = 0.0; $minAvail = [double]::MaxValue; $examples = @()
    # Rows are written in time order, so one pointer walks system.csv once for all sales.
    $cursor = 0
    foreach ($sale in $saleRows) {
      $from = [long]$sale.t_ms
      $to = $from + [long](ConvertTo-Double $sale.duration_ms)
      $run = 0; $failed = $false
      while ($cursor -lt $sysT.Count -and $sysT[$cursor] -lt $from) { $cursor++ }
      for ($k = $cursor; $k -lt $sysT.Count; $k++) {
        $s = @{ t = $sysT[$k]; reads = $sysReads[$k]; avail = $sysAvail[$k] }
        if ($s.t -gt $to + 1000) { break }
        if (-not [double]::IsNaN($s.reads)) {
          $worstReads = [Math]::Max($worstReads, $s.reads)
          if ($s.reads -gt $T.U2_pageReadsPerSec) { $run++ } else { $run = 0 }
          if ($run -ge $T.U2_consecutiveSec) { $failed = $true }
        }
        if (-not [double]::IsNaN($s.avail)) {
          $minAvail = [Math]::Min($minAvail, $s.avail)
          if ($s.avail -lt $T.U2_minAvailMb) { $failed = $true }
        }
      }
      if ($failed) { $bad++; if ($examples.Count -lt 5) { $examples += "$($sale.phase) sale $($sale.n)" } }
    }
    $status = if ($bad -gt 0) { 'FAIL' } else { 'PASS' }
    $minAvailOut = $null
    if ($minAvail -lt [double]::MaxValue) { $minAvailOut = Round1 $minAvail }
    $verdicts.Add((New-Verdict 'U2' 'Paging during a sale' $status $bad 0 ("{0} of {1} sales; worst {2:0.0} page reads/s; lowest free {3} MB {4}" -f $bad, $saleRows.Count, $worstReads, $minAvailOut, ($examples -join ', '))))
  }

  # U3: leak slope and private growth, soaks of two hours or more.
  if ($soakRows.Count -eq 0 -or $durationH -lt $T.U3_minSoakHours) {
    $verdicts.Add((New-Verdict 'U3' 'Leak' 'SKIP' $null $T.U3_slopeMbPerHour ("needs a soak of {0} h or more" -f $T.U3_minSoakHours)))
  } else {
    $worst = $null; $worstRole = ''
    foreach ($role in @('main', 'renderer', 'gpu', 'utility')) {
      $slope = $memory.roles[$role].slope_mb_per_h
      if ($null -ne $slope -and ($null -eq $worst -or $slope -gt $worst)) { $worst = $slope; $worstRole = $role }
    }
    $hourOne = $times | Where-Object { ($_ - $times[0]) -ge 3600000 } | Select-Object -First 1
    $privateStart = $series.byTime[$hourOne].private
    $privateEnd = $series.byTime[$times[-1]].private
    $growth = if ($privateStart -gt 0) { $privateEnd / $privateStart } else { [double]::NaN }
    $failed = ($null -ne $worst -and $worst -gt $T.U3_slopeMbPerHour) -or ($growth -gt $T.U3_privateGrowthFactor)
    $status = if ($failed) { 'FAIL' } else { 'PASS' }
    $verdicts.Add((New-Verdict 'U3' 'Leak' $status $worst $T.U3_slopeMbPerHour ("worst slope {0} MB/h ({1}); private {2:0} -> {3:0} MB (x{4:0.00})" -f $worst, $worstRole, $privateStart, $privateEnd, $growth)))
    $memory.private_hour1_mb = Round1 $privateStart
    $memory.private_end_mb = Round1 $privateEnd
  }

  # U4: total working set at any moment, every phase.
  $all = Get-RoleSeries $samples
  if ($all.times.Count -eq 0) {
    $verdicts.Add((New-Verdict 'U4' 'Total memory' 'SKIP' $null $T.U4_totalWorkingSetMb 'no process samples'))
  } else {
    $peak = ($all.times | ForEach-Object { $all.byTime[$_].total } | Measure-Object -Maximum).Maximum
    $status = if ($peak -gt $T.U4_totalWorkingSetMb) { 'FAIL' } else { 'PASS' }
    $verdicts.Add((New-Verdict 'U4' 'Total memory' $status (Round1 $peak) $T.U4_totalWorkingSetMb 'peak sum of every Puntovivo working set'))
    $memory.total_peak_mb = Round1 $peak
  }

  # U5: sale time. Simulated sales measure scan to receipt directly; manual ones include scanning.
  $driveSales = @($sales | Where-Object { $_.mode -eq 'drive' -and ($_.status -eq 'ok' -or $_.status -eq 'timeout') })
  $manual = @($sales | Where-Object { $_.mode -eq 'manual' -and $_.status -eq 'ok' })
  $judged = if ($driveSales.Count -gt 0) { $driveSales } else { $manual }
  $durations = [double[]]@($judged | ForEach-Object { ConvertTo-Double $_.duration_ms } | Sort-Object)
  $saleSummary = [ordered]@{
    drive_ok = @($sales | Where-Object { $_.mode -eq 'drive' -and $_.status -eq 'ok' }).Count
    drive_failed = @($sales | Where-Object { $_.mode -eq 'drive' -and $_.status -ne 'ok' }).Count
    manual = $manual.Count
    judged = $(if ($driveSales.Count -gt 0) { 'drive' } elseif ($manual.Count -gt 0) { 'manual' } else { $null })
    median_ms = Round1 (Get-Percentile $durations 50)
    p95_ms = Round1 (Get-Percentile $durations 95)
    max_ms = $(if ($durations.Count -gt 0) { Round1 $durations[-1] } else { $null })
  }
  $charges = [double[]]@($sales | Where-Object { $_.charge_ms -ne '' } | ForEach-Object { ConvertTo-Double $_.charge_ms } | Sort-Object)
  $saleSummary.charge_median_ms = Round1 (Get-Percentile $charges 50)
  $saleSummary.charge_p95_ms = Round1 (Get-Percentile $charges 95)
  if ($durations.Count -eq 0) {
    $verdicts.Add((New-Verdict 'U5' 'Sale time' 'SKIP' $null $T.U5_medianMs 'no sales'))
  } else {
    $failed = ($saleSummary.median_ms -gt $T.U5_medianMs) -or ($saleSummary.p95_ms -gt $T.U5_p95Ms)
    $status = if ($failed) { 'FAIL' } else { 'PASS' }
    $detail = "{0} {1} sales: median {2} ms, p95 {3} ms (limits {4} / {5})" -f $durations.Count, $saleSummary.judged, $saleSummary.median_ms, $saleSummary.p95_ms, $T.U5_medianMs, $T.U5_p95Ms
    if ($saleSummary.judged -eq 'manual') { $detail += '; manual times include scanning' }
    $verdicts.Add((New-Verdict 'U5' 'Sale time' $status $saleSummary.median_ms $T.U5_medianMs $detail))
  }

  # U6: startup.
  $cold = @($startup | Where-Object { $_.kind -eq 'cold' -and $_.login_ready_ms -ne '' })
  $warm = [double[]]@($startup | Where-Object { $_.kind -eq 'warm' -and $_.login_ready_ms -ne '' } | ForEach-Object { ConvertTo-Double $_.login_ready_ms } | Sort-Object)
  $startupSummary = [ordered]@{
    cold_login_ms = $(if ($cold.Count -gt 0) { ConvertTo-Double $cold[0].login_ready_ms } else { $null })
    cold_uptime_s = $(if ($cold.Count -gt 0) { $cold[0].uptime_s } else { $null })
    warm_login_median_ms = Round1 (Get-Percentile $warm 50)
    warm_login_max_ms = $(if ($warm.Count -gt 0) { $warm[-1] } else { $null })
    pos_ready_ms = @($startup | Where-Object { $_.pos_ready_ms -ne '' } | ForEach-Object { ConvertTo-Double $_.pos_ready_ms })
    forced_closes = @($startup | Where-Object { $_.forced_close -eq 'true' }).Count
  }
  if ($startup.Count -eq 0) {
    $verdicts.Add((New-Verdict 'U6' 'Startup' 'SKIP' $null $T.U6_coldMs 'no startup phase'))
  } else {
    $failed = ($null -ne $startupSummary.cold_login_ms -and $startupSummary.cold_login_ms -gt $T.U6_coldMs) -or
      ($null -ne $startupSummary.warm_login_median_ms -and $startupSummary.warm_login_median_ms -gt $T.U6_warmMs)
    $status = if ($failed) { 'FAIL' } else { 'PASS' }
    $detail = "cold {0} ms (limit {1}); warm median {2} ms (limit {3})" -f $startupSummary.cold_login_ms, $T.U6_coldMs, $startupSummary.warm_login_median_ms, $T.U6_warmMs
    if ($null -ne $startupSummary.cold_uptime_s -and [double]$startupSummary.cold_uptime_s -gt 1800) { $detail += '; run 1 was not right after a reboot' }
    $verdicts.Add((New-Verdict 'U6' 'Startup' $status $startupSummary.cold_login_ms $T.U6_coldMs $detail))
  }

  # U7: the window freezes during a backup, from the renderer IPC probe.
  $starts = @($markers | Where-Object { $_.kind -eq 'backup_start' })
  $ends = @($markers | Where-Object { $_.kind -eq 'backup_end' })
  $rendererRows = @($renderer | Where-Object { $_.ipc_count -ne '' -and [double]$_.ipc_count -gt 0 })
  $backup = [ordered]@{ windows = $starts.Count; worst_ms = $null }
  if ($starts.Count -eq 0) {
    $verdicts.Add((New-Verdict 'U7' 'Backup freeze' 'SKIP' $null $T.U7_freezeMs 'no backup marked with B'))
  } else {
    $intervalByPhase = @{}
    if ($meta.phases) {
      foreach ($p in $meta.phases.PSObject.Properties) { if ($p.Value.interval_s) { $intervalByPhase[$p.Name] = [double]$p.Value.interval_s * 1000 } }
    }
    $worst = 0.0
    for ($i = 0; $i -lt $starts.Count; $i++) {
      $from = [long]$starts[$i].t_ms
      $to = if ($i -lt $ends.Count) { [long]$ends[$i].t_ms } else { $from + 600000 }
      foreach ($r in $renderer) {
        $t = [long]$r.t_ms
        # Each renderer row covers the interval that ends at its timestamp.
        $intervalMs = 15000
        if ($intervalByPhase.ContainsKey([string]$r.phase)) { $intervalMs = $intervalByPhase[[string]$r.phase] }
        if ($t -lt $from -or ($t - $intervalMs) -gt $to) { continue }
        foreach ($v in @((ConvertTo-Double $r.ipc_max_ms), (ConvertTo-Double $r.lag_max_ms))) {
          if (-not [double]::IsNaN($v)) { $worst = [Math]::Max($worst, $v) }
        }
      }
    }
    $backup.worst_ms = Round1 $worst
    $status = if ($worst -gt $T.U7_freezeMs) { 'FAIL' } else { 'PASS' }
    $verdicts.Add((New-Verdict 'U7' 'Backup freeze' $status (Round1 $worst) $T.U7_freezeMs ("{0} backup window(s); worst IPC round trip or renderer lag" -f $starts.Count)))
  }

  # U8: stability over the soak.
  $gone = @($markers | Where-Object { $_.kind -eq 'process_gone' -and $_.phase -eq 'soak' })
  $gpuPids = @($soakRows | Where-Object { $_.role -eq 'gpu' } | ForEach-Object { $_.pid } | Sort-Object -Unique)
  if ($soakRows.Count -eq 0) {
    $verdicts.Add((New-Verdict 'U8' 'Stability' 'SKIP' $null 0 'no soak phase'))
  } else {
    $failed = ($gone.Count -gt 0) -or ($gpuPids.Count -gt 1)
    $status = if ($failed) { 'FAIL' } else { 'PASS' }
    $verdicts.Add((New-Verdict 'U8' 'Stability' $status ($gone.Count + [Math]::Max(0, $gpuPids.Count - 1)) 0 ("process_gone {0}; GPU process ids {1}" -f $gone.Count, ($gpuPids -join ' '))))
  }

  # Context that is not judged.
  $ipcP99 = [double[]]@($rendererRows | ForEach-Object { ConvertTo-Double $_.ipc_p99_ms } | Where-Object { -not [double]::IsNaN($_) } | Sort-Object)
  $ipcMax = [double[]]@($rendererRows | ForEach-Object { ConvertTo-Double $_.ipc_max_ms } | Where-Object { -not [double]::IsNaN($_) } | Sort-Object)
  $lag = [double[]]@($renderer | ForEach-Object { ConvertTo-Double $_.lag_max_ms } | Where-Object { -not [double]::IsNaN($_) } | Sort-Object)
  $heap = @($renderer | Where-Object { $_.js_heap_mb -ne '' })
  $harnessRows = @($samples | Where-Object { $_.role -eq 'harness' })
  $harnessCpu = @($harnessRows | Where-Object { $_.cpu_pct -ne '' } | ForEach-Object { ConvertTo-Double $_.cpu_pct })
  $summary = [ordered]@{
    label           = $runLabel
    harness_version = $HarnessVersion
    generated_utc   = Format-Utc (Get-NowMs)
    machine         = $meta.machine
    build           = $meta.build
    renderer_info   = $meta.renderer
    phases          = $meta.phases
    thresholds      = $Thresholds
    startup         = $startupSummary
    sales           = $saleSummary
    memory          = $memory
    system          = [ordered]@{
      min_avail_mb = Round1 (($system | Where-Object { $_.avail_mb -ne '' } | ForEach-Object { ConvertTo-Double $_.avail_mb } | Measure-Object -Minimum).Minimum)
      max_page_reads = Round1 (($system | Where-Object { $_.page_reads -ne '' } | ForEach-Object { ConvertTo-Double $_.page_reads } | Measure-Object -Maximum).Maximum)
      seconds_paging = @($system | Where-Object { $_.page_reads -ne '' -and (ConvertTo-Double $_.page_reads) -gt $T.U2_pageReadsPerSec }).Count
      seconds_sampled = $system.Count
    }
    renderer        = [ordered]@{
      ipc_samples = ($rendererRows | ForEach-Object { [double]$_.ipc_count } | Measure-Object -Sum).Sum
      ipc_p99_median_ms = Round1 (Get-Percentile $ipcP99 50)
      ipc_p99_worst_ms = $(if ($ipcP99.Count -gt 0) { Round1 $ipcP99[-1] } else { $null })
      ipc_max_ms = $(if ($ipcMax.Count -gt 0) { Round1 $ipcMax[-1] } else { $null })
      lag_max_ms = $(if ($lag.Count -gt 0) { Round1 $lag[-1] } else { $null })
      js_heap_start_mb = $(if ($heap.Count -gt 0) { Round1 (ConvertTo-Double $heap[0].js_heap_mb) } else { $null })
      js_heap_end_mb = $(if ($heap.Count -gt 0) { Round1 (ConvertTo-Double $heap[-1].js_heap_mb) } else { $null })
      backup = $backup
    }
    harness         = [ordered]@{
      cpu_avg_pct = $(if ($harnessCpu.Count -gt 0) { [Math]::Round(($harnessCpu | Measure-Object -Average).Average, 2) } else { $null })
      working_set_peak_mb = Round1 (($harnessRows | ForEach-Object { ConvertTo-Double $_.working_set_mb } | Measure-Object -Maximum).Maximum)
    }
    verdicts        = $verdicts.ToArray()
  }
  $failedCount = @($verdicts | Where-Object { $_.status -eq 'FAIL' }).Count
  $summary.result = if ($failedCount -gt 0) { 'FAIL' } else { 'PASS' }
  Write-JsonFile (Join-Path $dir 'summary.json') $summary

  $md = New-Object System.Collections.Generic.List[string]
  $md.Add("# Puntovivo on target hardware: $runLabel")
  $md.Add('')
  $md.Add(('Result: **{0}**. Build {1}; {2}; {3} MB RAM; {4} {5}.' -f $summary.result, $meta.build.product_version, $meta.machine.cpu, $meta.machine.ram_mb, $meta.machine.windows, $meta.machine.windows_release))
  $md.Add('')
  $md.Add('| Rule | Check | Result | Value | Limit | Detail |')
  $md.Add('| --- | --- | --- | ---: | ---: | --- |')
  foreach ($v in $verdicts) { $md.Add(('| {0} | {1} | {2} | {3} | {4} | {5} |' -f $v.id, $v.rule, $v.status, $v.value, $v.limit, ([string]$v.detail).Replace('|', '/'))) }
  [System.IO.File]::WriteAllText((Join-Path $dir 'verdict.md'), ([string]::Join("`r`n", $md) + "`r`n"), $Utf8)

  Write-Host ''
  foreach ($line in $md) { Write-Host $line }
  Write-Host ''
  Write-Host "Saved $(Join-Path $dir 'summary.json') and verdict.md"
  $script:FailedCount = $failedCount
}

# --------------------------------------------------------------------- main

$exitCode = 0
try {
  switch ($Phase) {
    'install' { Invoke-Install }
    'baseline' { Save-Baseline }
    'summarize' {
      if (-not $RunDir) { throw '-Phase summarize needs -RunDir <run folder>.' }
      Invoke-Summarize $RunDir
      if ($script:FailedCount -gt 0) { $exitCode = 1 }
    }
    default {
      if ($env:OS -ne 'Windows_NT') { throw "-Phase $Phase runs on Windows only." }
      try {
        switch ($Phase) {
          'startup' { Invoke-Startup }
          'sales' { Invoke-Monitor $Minutes }
          'soak' { if ($Minutes -gt 0) { Invoke-Monitor $Minutes } else { Invoke-Monitor ($Hours * 60) } }
        }
      } finally {
        # Keep what was measured so -Phase summarize can still judge it.
        if ($script:Dir -and $script:PhaseInfo -and -not $script:Completed) {
          $script:PhaseInfo.interrupted = $true
          Complete-Live $null
        }
        if ($CloseAtEnd -and $script:MainPid -and (Test-MainAlive)) { [void](Stop-App) }
      }
      Invoke-Summarize $script:Dir
      if ($script:FailedCount -gt 0) { $exitCode = 1 }
    }
  }
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.InvocationInfo) { Write-Host $_.InvocationInfo.PositionMessage }
  $exitCode = 2
}
exit $exitCode
