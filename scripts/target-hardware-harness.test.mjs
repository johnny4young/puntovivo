import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.join(root, 'scripts', 'target-hardware');
const MEASURE = path.join(kit, 'Measure-Puntovivo.ps1');
const COMPARE = path.join(kit, 'Compare-Runs.ps1');

// Windows PowerShell 5.1 is the target; pwsh runs the same logic elsewhere.
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const probe = spawnSync(shell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
  encoding: 'utf8',
});
const available = probe.status === 0;
if (!available && process.env.CI) {
  throw new Error(`${shell} is required in CI to test the target-hardware harness`);
}
const skip = available ? false : `${shell} is not installed`;

const work = mkdtempSync(path.join(tmpdir(), 'pv-harness-test-'));
after(() => rmSync(work, { recursive: true, force: true }));

function run(script, args) {
  const result = spawnSync(
    shell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    { encoding: 'utf8', timeout: 120_000 }
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

function csv(header, rows) {
  return `${[header, ...rows.map(row => row.join(','))].join('\r\n')}\r\n`;
}

/** A three-hour soak plus startup runs, shaped by the overrides. */
function writeRun(name, o) {
  const dir = path.join(work, name);
  mkdirSync(dir);
  const iso = t => new Date(t).toISOString();
  writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({
      label: name,
      harness_version: '1',
      machine: {
        computer: 'TILL-01',
        cpu: 'Intel(R) Celeron(R) CPU J1900 @ 1.99GHz',
        ram_mb: 3990,
        windows: 'Microsoft Windows 10 Pro',
        windows_release: '22H2',
      },
      build: { product_version: o.version },
      phases: { startup: { interval_s: 15 }, soak: { interval_s: 60, duration_s: 10_800 } },
    })
  );

  const samples = [];
  for (let i = 0; i <= 180; i++) {
    const t = T0 + i * 60_000;
    const h = (i * 60_000) / HOUR;
    const gpuPid = o.gpuRestart && i > 90 ? 2002 : 2001;
    const rows = [
      [1000, 'main', 300],
      [1001, 'renderer', 150 + o.rendererSlope * h],
      [gpuPid, 'gpu', o.gpu],
      [1003, 'utility', o.utility],
      [9000, 'harness', 70],
    ];
    for (const [pid, role, ws] of rows) {
      samples.push([
        t,
        iso(t),
        i * 60,
        name,
        'soak',
        pid,
        role,
        '',
        ws,
        ws * 1.2,
        0.5,
        300,
        20,
        '',
        '',
      ]);
    }
  }
  writeFileSync(
    path.join(dir, 'samples.csv'),
    csv(
      't_ms,ts_utc,elapsed_s,label,phase,pid,role,subtype,working_set_mb,private_mb,cpu_pct,handles,threads,gpu_dedicated_mb,gpu_shared_mb',
      samples
    )
  );

  const sales = [];
  const system = [];
  for (let n = 1; n <= 10; n++) {
    const t = T0 + n * 600_000;
    sales.push([t, iso(t), name, 'soak', n, 'drive', 'sendkeys', 4, 1800 + n * 80, 900, 'ok', '']);
    for (let s = 0; s < 3; s++) {
      const reads = n === 3 ? o.pagingReads : 1;
      system.push([
        t + s * 1000,
        iso(t + s * 1000),
        0,
        name,
        'soak',
        900,
        2500,
        reads,
        0,
        30,
        0.2,
        40,
      ]);
    }
  }
  writeFileSync(
    path.join(dir, 'sales.csv'),
    csv('t_ms,ts_utc,label,phase,n,mode,input,items,duration_ms,charge_ms,status,note', sales)
  );
  writeFileSync(
    path.join(dir, 'system.csv'),
    csv(
      't_ms,ts_utc,elapsed_s,label,phase,avail_mb,commit_mb,page_reads,pages_out,pagefile_pct,disk_queue,cpu_total_pct',
      system
    )
  );

  const renderer = [];
  for (let i = 1; i <= 180; i++) {
    const t = T0 + i * 60_000;
    const max = o.backupFreeze && i === 61 ? o.backupFreeze : 10;
    renderer.push([
      t,
      iso(t),
      i * 60,
      name,
      'soak',
      240,
      2,
      3,
      max,
      0,
      20,
      40,
      3000,
      'visible',
      '#/sales',
      4,
    ]);
  }
  writeFileSync(
    path.join(dir, 'renderer.csv'),
    csv(
      't_ms,ts_utc,elapsed_s,label,phase,ipc_count,ipc_p50_ms,ipc_p99_ms,ipc_max_ms,ipc_errors,lag_max_ms,js_heap_mb,dom_nodes,visibility,route,cdp_ms',
      renderer
    )
  );

  const markers = [];
  if (o.backupFreeze) {
    markers.push([T0 + HOUR, iso(T0 + HOUR), 3600, name, 'soak', 'backup_start', 1, '', '']);
    markers.push([
      T0 + HOUR + 30_000,
      iso(T0 + HOUR + 30_000),
      3630,
      name,
      'soak',
      'backup_end',
      1,
      '',
      '',
    ]);
  }
  writeFileSync(
    path.join(dir, 'markers.csv'),
    csv('t_ms,ts_utc,elapsed_s,label,phase,kind,n,value,note', markers)
  );

  writeFileSync(
    path.join(dir, 'startup.csv'),
    csv('t_ms,ts_utc,label,run,kind,uptime_s,login_ready_ms,pos_ready_ms,close_ms,forced_close', [
      [T0 - HOUR, iso(T0 - HOUR), name, 1, 'cold', 400, o.cold, '', 3000, 'false'],
      [
        T0 - HOUR + 60_000,
        iso(T0 - HOUR + 60_000),
        name,
        2,
        'warm',
        460,
        15_000,
        '',
        3000,
        'false',
      ],
      [
        T0 - HOUR + 120_000,
        iso(T0 - HOUR + 120_000),
        name,
        3,
        'warm',
        520,
        16_000,
        '',
        3000,
        'false',
      ],
    ])
  );
  return dir;
}

const healthy = {
  version: '1.17.1',
  rendererSlope: 0,
  gpu: 400,
  utility: 200,
  gpuRestart: false,
  pagingReads: 1,
  backupFreeze: 0,
  cold: 30_000,
};
const runA = writeRun('build-a', healthy);
const runB = writeRun('build-b', {
  version: '1.18.0',
  rendererSlope: 20,
  gpu: 650,
  utility: 400,
  gpuRestart: true,
  pagingReads: 30,
  backupFreeze: 1500,
  cold: 50_000,
});

test('build-desktop runs the harness self-test on the Windows installer under PowerShell 5.1', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'build-desktop.yml'),
    'utf8'
  );
  const job = workflow.slice(workflow.indexOf('\n  harness-win:'));
  assert.ok(job.length > 1, 'expected a harness-win job');
  assert.match(
    workflow,
    /\n {6}harness:\n {8}description: [^\n]+\n {8}type: boolean\n {8}default: false/u
  );
  assert.match(job, /needs: \[verify-candidate, build-win\]/u);
  assert.match(job, /if: \$\{\{ inputs\.harness && inputs\.win && !inputs\.validate_only \}\}/u);
  assert.match(job, /timeout-minutes: \d+/u);
  assert.match(job, /name: desktop-win-\$\{\{ needs\.verify-candidate\.outputs\.short_sha \}\}/u);
  assert.match(
    job,
    /shell: powershell\n/u,
    'the target till runs Windows PowerShell 5.1, not pwsh'
  );
  for (const phase of ['install', 'startup', 'soak']) {
    assert.match(job, new RegExp(`'-Phase', '${phase}'`, 'u'));
  }
  assert.match(job, /'-Drive'/u);
  assert.match(job, /Compare-Runs\.ps1/u);
  assert.match(job, /ci-fixture\.mjs check|'check', '--run'/u);
  assert.match(job, /name: target-hardware-selftest-/u);
});

function statuses(dir) {
  const summary = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  return Object.fromEntries(summary.verdicts.map(verdict => [verdict.id, verdict.status]));
}

test('both scripts are ASCII and use Windows PowerShell 5.1 syntax only', { skip }, () => {
  for (const script of [MEASURE, COMPARE]) {
    const bytes = readFileSync(script);
    const offset = bytes.findIndex(byte => byte > 127);
    // Windows PowerShell reads a file without a BOM as ANSI, so non-ASCII text breaks.
    assert.equal(offset, -1, `${path.basename(script)} has a non-ASCII byte at ${offset}`);
  }
  const check = `
    $bad = @()
    foreach ($file in $args) {
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
      foreach ($e in $errors) { $bad += "$file parse: $($e.Message)" }
      $found = $ast.FindAll({ param($n)
        $type = $n.GetType().Name
        if ($type -eq 'TernaryExpressionAst' -or $type -eq 'PipelineChainAst') { return $true }
        if ($type -eq 'BinaryExpressionAst' -and [string]$n.Operator -eq 'QuestionQuestion') { return $true }
        if ($type -eq 'AssignmentStatementAst' -and [string]$n.Operator -eq 'QuestionQuestionEquals') { return $true }
        if ($n.PSObject.Properties['NullConditional'] -and $n.NullConditional) { return $true }
        if ($type -eq 'CommandParameterAst' -and @('AsHashtable','AdditionalChildPath','AsByteStream','Parallel','SkipCertificateCheck','NoProxy') -contains $n.ParameterName) { return $true }
        return $false
      }, $true)
      foreach ($n in $found) { $bad += "$file line $($n.Extent.StartLineNumber): PowerShell 7 only: $($n.Extent.Text)" }
    }
    $bad
    if ($bad.Count -gt 0) { exit 1 }`;
  const quoted = [MEASURE, COMPARE].map(file => `'${file.replaceAll("'", "''")}'`).join(' ');
  const result = spawnSync(
    shell,
    ['-NoProfile', '-NonInteractive', '-Command', `& { ${check} } ${quoted}`],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('summarize judges a healthy run as passing', { skip }, () => {
  const { code, out } = run(MEASURE, ['-Phase', 'summarize', '-RunDir', runA]);
  assert.equal(code, 0, out);
  assert.deepEqual(statuses(runA), {
    U1: 'PASS',
    U2: 'PASS',
    U3: 'PASS',
    U4: 'PASS',
    U5: 'PASS',
    U6: 'PASS',
    U7: 'SKIP',
    U8: 'PASS',
  });
  assert.match(readFileSync(path.join(runA, 'verdict.md'), 'utf8'), /Result: \*\*PASS\*\*/u);
});

test('summarize fails every threshold the run breaks', { skip }, () => {
  const { code, out } = run(MEASURE, ['-Phase', 'summarize', '-RunDir', runB]);
  assert.equal(code, 1, out);
  assert.deepEqual(statuses(runB), {
    U1: 'FAIL',
    U2: 'FAIL',
    U3: 'FAIL',
    U4: 'PASS',
    U5: 'PASS',
    U6: 'FAIL',
    U7: 'FAIL',
    U8: 'FAIL',
  });
  const summary = JSON.parse(readFileSync(path.join(runB, 'summary.json'), 'utf8'));
  assert.equal(summary.memory.roles.renderer.slope_mb_per_h, 20);
  assert.equal(summary.sales.drive_ok, 10);
  assert.equal(summary.harness.working_set_peak_mb, 70);
});

test('summarize refuses a folder with nothing measured', { skip }, () => {
  const empty = path.join(work, 'empty');
  mkdirSync(empty);
  const { code, out } = run(MEASURE, ['-Phase', 'summarize', '-RunDir', empty]);
  assert.equal(code, 2, out);
  assert.match(out, /Nothing to summarize/u);
  assert.equal(existsSync(path.join(empty, 'summary.json')), false);
});

test(
  'compare flags the regressions of build B and nothing for a run against itself',
  { skip },
  () => {
    const out = path.join(work, 'compare-ab');
    const regression = run(COMPARE, ['-A', runA, '-B', runB, '-OutDir', out]);
    assert.equal(regression.code, 1, regression.out);
    const report = readFileSync(path.join(out, 'compare.md'), 'utf8');
    assert.match(report, /\| Renderer slope \(MB\/h\) \| 0 \| 20 \| 20 \| {2}\| regression \|/u);
    assert.match(report, /\| U1 GPU \+ utility after the soak \| PASS \| FAIL \| regression \|/u);
    assert.match(report, /\| Sale, median \(ms\) \| [\d.]+ \| [\d.]+ \| 0 \| 0 % \| no change \|/u);
    const curves = readFileSync(path.join(out, 'compare-curves.csv'), 'utf8')
      .trim()
      .split(/\r?\n/u);
    assert.equal(curves[0], 'minute,a_main_mb,b_main_mb,a_gpu_mb,b_gpu_mb');
    assert.equal(curves.length, 182);

    const same = run(COMPARE, ['-A', runA, '-B', runA, '-OutDir', path.join(work, 'compare-aa')]);
    assert.equal(same.code, 0, same.out);
    assert.match(same.out, /Result: 0 regression\(s\)\./u);
  }
);

test('compare stops when a run has no summary', { skip }, () => {
  const missing = path.join(work, 'no-summary');
  mkdirSync(missing);
  const { code, out } = run(COMPARE, ['-A', runA, '-B', missing]);
  assert.equal(code, 2, out);
  assert.match(out, /No summary\.json/u);
});
