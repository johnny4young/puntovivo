<#
.SYNOPSIS
Compares two Measure-Puntovivo.ps1 runs of different builds on the same machine.

.DESCRIPTION
Reads <A>\summary.json and <B>\summary.json and writes compare.md (one row per
metric: A, B, difference, percent and verdict) plus compare-curves.csv (minute
by minute main and GPU working set during each soak) into the B folder.

A metric is a regression when B is worse by more than 10 % and 20 MB (memory)
or by more than 15 % (times), and by more than the noise. Pass -Noise with a
second run of A, measured the same way, to set that noise. A threshold that
goes from PASS in A to FAIL in B is always a regression.

Exit codes: 0 no regression, 1 at least one regression, 2 could not compare.

.EXAMPLE
.\Compare-Runs.ps1 -A C:\pv-measure\runs\v1.17.1 -B C:\pv-measure\runs\v1.18.0 -Noise C:\pv-measure\runs\v1.17.1-again
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$A,
  [Parameter(Mandatory = $true)][string]$B,
  [string]$Noise,
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'
$Invariant = [System.Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentCulture = $Invariant
[System.Threading.Thread]::CurrentThread.CurrentUICulture = $Invariant
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Resolve-UserPath([string]$path) {
  if (-not $path) { return $path }
  try { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path) } catch { return $path }
}
$A = Resolve-UserPath $A
$B = Resolve-UserPath $B
$Noise = Resolve-UserPath $Noise
$OutDir = Resolve-UserPath $OutDir

$Metrics = @(
  @{ name = 'Main working set, peak (MB)'; path = 'memory.roles.main.peak_mb'; kind = 'memory' }
  @{ name = 'Main working set, end (MB)'; path = 'memory.roles.main.end_mb'; kind = 'memory' }
  @{ name = 'Renderer working set, peak (MB)'; path = 'memory.roles.renderer.peak_mb'; kind = 'memory' }
  @{ name = 'Renderer working set, end (MB)'; path = 'memory.roles.renderer.end_mb'; kind = 'memory' }
  @{ name = 'GPU working set, peak (MB)'; path = 'memory.roles.gpu.peak_mb'; kind = 'memory' }
  @{ name = 'GPU working set, end (MB)'; path = 'memory.roles.gpu.end_mb'; kind = 'memory' }
  @{ name = 'Utility working set, peak (MB)'; path = 'memory.roles.utility.peak_mb'; kind = 'memory' }
  @{ name = 'Total working set, peak (MB)'; path = 'memory.total_peak_mb'; kind = 'memory' }
  @{ name = 'Total working set, last 10 min (MB)'; path = 'memory.roles.total.last10_mean_mb'; kind = 'memory' }
  @{ name = 'Main slope (MB/h)'; path = 'memory.roles.main.slope_mb_per_h'; kind = 'slope' }
  @{ name = 'Renderer slope (MB/h)'; path = 'memory.roles.renderer.slope_mb_per_h'; kind = 'slope' }
  @{ name = 'GPU slope (MB/h)'; path = 'memory.roles.gpu.slope_mb_per_h'; kind = 'slope' }
  @{ name = 'Utility slope (MB/h)'; path = 'memory.roles.utility.slope_mb_per_h'; kind = 'slope' }
  @{ name = 'Lowest free memory (MB)'; path = 'system.min_avail_mb'; kind = 'memory'; higherIsBetter = $true }
  @{ name = 'Seconds paging over the U2 rate'; path = 'system.seconds_paging'; kind = 'count' }
  @{ name = 'Cold start to login (ms)'; path = 'startup.cold_login_ms'; kind = 'time' }
  @{ name = 'Warm start to login, median (ms)'; path = 'startup.warm_login_median_ms'; kind = 'time' }
  @{ name = 'Sale, median (ms)'; path = 'sales.median_ms'; kind = 'time' }
  @{ name = 'Sale, p95 (ms)'; path = 'sales.p95_ms'; kind = 'time' }
  @{ name = 'Charge to done, median (ms)'; path = 'sales.charge_median_ms'; kind = 'time' }
  @{ name = 'IPC round trip p99, median interval (ms)'; path = 'renderer.ipc_p99_median_ms'; kind = 'time' }
  @{ name = 'IPC round trip, worst (ms)'; path = 'renderer.ipc_max_ms'; kind = 'time' }
  @{ name = 'Renderer lag, worst (ms)'; path = 'renderer.lag_max_ms'; kind = 'time' }
  @{ name = 'Backup freeze, worst (ms)'; path = 'renderer.backup.worst_ms'; kind = 'time' }
)

function Read-Summary([string]$dir) {
  $path = Join-Path $dir 'summary.json'
  if (-not (Test-Path -LiteralPath $path)) { throw "No summary.json in $dir. Run Measure-Puntovivo.ps1 -Phase summarize -RunDir $dir first." }
  return (ConvertFrom-Json ([System.IO.File]::ReadAllText($path, $Utf8)))
}

function Get-Value($summary, [string]$path) {
  $node = $summary
  foreach ($part in $path.Split('.')) {
    if ($null -eq $node) { return $null }
    if (-not ($node.PSObject.Properties.Name -contains $part)) { return $null }
    $node = $node.$part
  }
  if ($null -eq $node -or [string]$node -eq '') { return $null }
  return [double]$node
}

function Format-Number($value) {
  if ($null -eq $value) { return '' }
  return ([double]$value).ToString('0.#', $Invariant)
}

function Get-Verdict([hashtable]$metric, $before, $after, $repeat) {
  if ($null -eq $before -or $null -eq $after) { return 'n/a' }
  $worse = $after - $before
  if ($metric.higherIsBetter) { $worse = -$worse }
  $pct = 0.0
  if ($before -ne 0) { $pct = 100.0 * $worse / [Math]::Abs($before) } elseif ($worse -ne 0) { $pct = 100.0 * [Math]::Sign($worse) }
  $tolerance = 0.0
  if ($null -ne $repeat) { $tolerance = [Math]::Abs($repeat - $before) }
  $better = -$worse
  switch ($metric.kind) {
    'memory' {
      if ($worse -gt $tolerance -and $worse -gt 20 -and $pct -gt 10) { return 'regression' }
      if ($better -gt $tolerance -and $better -gt 20 -and -$pct -gt 10) { return 'improvement' }
    }
    'time' {
      if ($worse -gt $tolerance -and $pct -gt 15) { return 'regression' }
      if ($better -gt $tolerance -and -$pct -gt 15) { return 'improvement' }
    }
    'slope' {
      if ($worse -gt [Math]::Max($tolerance, 5)) { return 'regression' }
      if ($better -gt [Math]::Max($tolerance, 5)) { return 'improvement' }
    }
    'count' {
      if ($worse -gt $tolerance -and $worse -gt 5 -and $pct -gt 15) { return 'regression' }
      if ($better -gt $tolerance -and $better -gt 5 -and -$pct -gt 15) { return 'improvement' }
    }
  }
  return 'no change'
}

function Get-SoakCurves([string]$dir) {
  # minute -> @{ main; gpu }, averaged over the samples taken in that minute.
  $path = Join-Path $dir 'samples.csv'
  $curves = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $curves }
  $byTime = @{}
  foreach ($row in (Import-Csv -LiteralPath $path -Encoding UTF8)) {
    if ($row.phase -ne 'soak' -or ($row.role -ne 'main' -and $row.role -ne 'gpu')) { continue }
    $t = [long]$row.t_ms
    if (-not $byTime.ContainsKey($t)) { $byTime[$t] = @{ main = 0.0; gpu = 0.0 } }
    $byTime[$t][$row.role] += [double]::Parse($row.working_set_mb, $Invariant)
  }
  if ($byTime.Count -eq 0) { return $curves }
  $times = @($byTime.Keys | Sort-Object)
  $sums = @{}
  foreach ($t in $times) {
    $minute = [int][Math]::Floor(($t - $times[0]) / 60000)
    if (-not $sums.ContainsKey($minute)) { $sums[$minute] = @{ main = 0.0; gpu = 0.0; n = 0 } }
    $sums[$minute].main += $byTime[$t].main
    $sums[$minute].gpu += $byTime[$t].gpu
    $sums[$minute].n += 1
  }
  foreach ($minute in $sums.Keys) {
    $s = $sums[$minute]
    $curves[$minute] = @{ main = $s.main / $s.n; gpu = $s.gpu / $s.n }
  }
  return $curves
}

$exitCode = 0
try {
  $summaryA = Read-Summary $A
  $summaryB = Read-Summary $B
  $summaryN = $null
  if ($Noise) { $summaryN = Read-Summary $Noise }
  if (-not $OutDir) { $OutDir = $B }

  $regressions = 0
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# $($summaryA.label) vs $($summaryB.label)")
  $lines.Add('')
  $machine = $summaryB.machine
  $lines.Add(('Machine: {0}, {1} MB RAM, {2} {3}. Noise run: {4}.' -f $machine.cpu, $machine.ram_mb, $machine.windows, $machine.windows_release, $(if ($summaryN) { $summaryN.label } else { 'none' })))
  if ($summaryA.machine.computer -ne $summaryB.machine.computer) { $lines.Add(''); $lines.Add('**Warning:** the two runs come from different machines.') }
  $lines.Add('')
  $lines.Add('| Metric | A | B | Difference | % | Verdict |')
  $lines.Add('| --- | ---: | ---: | ---: | ---: | --- |')
  # PowerShell names are case-insensitive: $a here would overwrite the -A parameter.
  foreach ($metric in $Metrics) {
    $valueA = Get-Value $summaryA $metric.path
    $valueB = Get-Value $summaryB $metric.path
    $valueN = $null
    if ($summaryN) { $valueN = Get-Value $summaryN $metric.path }
    $verdict = Get-Verdict $metric $valueA $valueB $valueN
    if ($verdict -eq 'regression') { $regressions++ }
    $diff = $null; $pct = ''
    if ($null -ne $valueA -and $null -ne $valueB) {
      $diff = $valueB - $valueA
      if ($valueA -ne 0) { $pct = (100.0 * $diff / [Math]::Abs($valueA)).ToString('+0;-0;0', $Invariant) + ' %' }
    }
    $lines.Add(('| {0} | {1} | {2} | {3} | {4} | {5} |' -f $metric.name, (Format-Number $valueA), (Format-Number $valueB), (Format-Number $diff), $pct, $verdict))
  }

  $lines.Add('')
  $lines.Add('| Rule | A | B | Verdict |')
  $lines.Add('| --- | --- | --- | --- |')
  $rulesA = @{}
  foreach ($v in @($summaryA.verdicts)) { $rulesA[$v.id] = $v }
  foreach ($v in @($summaryB.verdicts)) {
    $before = if ($rulesA.ContainsKey($v.id)) { $rulesA[$v.id].status } else { 'n/a' }
    $verdict = 'no change'
    if ($before -eq 'PASS' -and $v.status -eq 'FAIL') { $verdict = 'regression'; $regressions++ }
    elseif ($before -eq 'FAIL' -and $v.status -eq 'PASS') { $verdict = 'improvement' }
    elseif ($before -ne $v.status) { $verdict = 'not comparable' }
    $lines.Add(('| {0} {1} | {2} | {3} | {4} |' -f $v.id, $v.rule, $before, $v.status, $verdict))
  }

  $curvesA = Get-SoakCurves $A
  $curvesB = Get-SoakCurves $B
  $minutes = @(@($curvesA.Keys) + @($curvesB.Keys) | Sort-Object -Unique)
  $csv = New-Object System.Collections.Generic.List[string]
  $csv.Add('minute,a_main_mb,b_main_mb,a_gpu_mb,b_gpu_mb')
  foreach ($minute in $minutes) {
    $cells = @($minute)
    foreach ($pair in @(@($curvesA, 'main'), @($curvesB, 'main'), @($curvesA, 'gpu'), @($curvesB, 'gpu'))) {
      if ($pair[0].ContainsKey($minute)) { $cells += ([double]$pair[0][$minute][$pair[1]]).ToString('0.#', $Invariant) } else { $cells += '' }
    }
    $csv.Add([string]::Join(',', [string[]]$cells))
  }
  $lines.Add('')
  if ($minutes.Count -gt 0) {
    $lines.Add('Minute-by-minute main and GPU working set: compare-curves.csv. A different slope matters more than the final value.')
  } else {
    $lines.Add('Neither run has a soak, so there are no minute-by-minute curves.')
  }
  $lines.Add('')
  $lines.Add(('Result: {0} regression(s).' -f $regressions))

  if (-not (Test-Path -LiteralPath $OutDir)) { [void](New-Item -ItemType Directory -Path $OutDir) }
  [System.IO.File]::WriteAllText((Join-Path $OutDir 'compare.md'), ([string]::Join("`r`n", $lines) + "`r`n"), $Utf8)
  if ($minutes.Count -gt 0) {
    [System.IO.File]::WriteAllText((Join-Path $OutDir 'compare-curves.csv'), ([string]::Join("`r`n", $csv) + "`r`n"), $Utf8)
  }
  foreach ($line in $lines) { Write-Host $line }
  Write-Host ''
  Write-Host "Saved $(Join-Path $OutDir 'compare.md')"
  if ($regressions -gt 0) { $exitCode = 1 }
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 2
}
exit $exitCode
