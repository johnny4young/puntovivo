/**
 * Diagnostics that are benign a few times per process run but would hide a
 * persistent failure if accepted without limit. classifyElectronStderrLine
 * accepts each line on its own; createElectronStderrClassifier also counts
 * them across one run and treats every occurrence past the limit as
 * unexpected, because repetition is exactly the signal a persistent failure
 * gives. Each limit is twice the largest count of the one benign run on record.
 */
// The macOS spell server lines this list used to accept are gone with the rule:
// Puntovivo turns Electron's builtin spellchecker off in window-config.ts, so the
// packaged app no longer asks that service to check typed text, and the v1.14.3
// release job logged none. They are blocking again on purpose, so a reappearance
// reports that the spellchecker came back instead of passing as known noise.
const BOUNDED_STDERR_DIAGNOSTICS = [
  {
    // Chromium's Process::SetPriority issues both calls for a child's task port
    // even when the first fails, so these arrive as a pair. The same run logged
    // the pair once, about 1.7 s after the embedded server stopped during app
    // quit and never while the app ran, consistent with re-prioritizing a
    // renderer or utility process that was already exiting (macos-26 release
    // runner, 2026-09-04, job 101069511807). The line numbers are pinned ON
    // PURPOSE to Chromium 150.0.7871.224 (Electron 43.4.1) so every rebase
    // forces a re-verification; any other kern result stays blocking. Both
    // lines share one budget: task policy failing for live children would
    // repeat the pair well past two.
    id: 'chromium-task-policy-teardown',
    description: 'Chromium task policy messages',
    limit: 4,
    patterns: [
      /^\[[^\]\r\n]+:ERROR:base\/process\/process_mac\.cc:53\] task_policy_set TASK_CATEGORY_POLICY: \(os\/kern\) invalid argument \(4\)$/,
      /^\[[^\]\r\n]+:ERROR:base\/process\/process_mac\.cc:98\] task_policy_set TASK_SUPPRESSION_POLICY: \(os\/kern\) invalid argument \(4\)$/,
    ],
  },
];

function boundedStderrDiagnostic(line) {
  return (
    BOUNDED_STDERR_DIAGNOSTICS.find(diagnostic =>
      diagnostic.patterns.some(pattern => pattern.test(line))
    ) ?? null
  );
}

/**
 * Classify Electron/Chromium stderr without disabling its diagnostic emitters.
 *
 * Chromium writes informational console forwarding and the remote-debugging
 * endpoint to stderr. Those records are still evidence, but they are not
 * failures. Everything else remains unexpected so E2E can fail instead of
 * turning a renderer/native warning into a green run.
 */
export function classifyElectronStderrLine(
  line,
  {
    allowPackagedCdpStartupDiagnostic = false,
    allowPackagedNetworkRaceDiagnostic = false,
  } = {}
) {
  if (
    line.length === 0 ||
    /^Debugger ending on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+$/i.test(line) ||
    line === 'For help, see: https://nodejs.org/learn/getting-started/debugging' ||
    line === 'Waiting for the debugger to disconnect...'
  ) {
    return 'lifecycle';
  }

  if (
    allowPackagedCdpStartupDiagnostic &&
    (/^\[[^\]\r\n]+:INFO:CONSOLE:2\] "Electron sandboxed_renderer\.bundle\.js script failed to run", source: node:electron\/js2c\/sandbox_bundle \(2\)$/.test(
      line
    ) ||
      /^\[[^\]\r\n]+:INFO:CONSOLE:2\] "TypeError: Cannot destructure property 'preloadScripts' of 'binding\.startupData' as it is null\.", source: node:electron\/js2c\/sandbox_bundle \(2\)$/.test(
        line
      ))
  ) {
    // Electron's CDP-only renderer context (42+) can miss the startup-data mojo
    // push introduced in 42.3.3. Packaged E2E proves the application's actual
    // preload bridge separately before accepting this exact harness diagnostic.
    return 'informational';
  }

  if (/^\[[^\]\r\n]+:INFO(?::[A-Z_]+)*:\d+\] /.test(line)) {
    // Electron forwards every renderer console method through Chromium's INFO
    // channel, including console.error and CSP/network failures. Severity in
    // the prefix alone is therefore insufficient: keep benign informational
    // chatter visible, but fail on adverse message content.
    return /\b(?:error|typeerror|referenceerror|syntaxerror|rangeerror|exception|fatal|crash(?:ed)?|warning|warn|failed|failure|violat(?:e|es|ed|ion)|refused|denied|cannot|not allowed|uncaught|unhandled|blocked|err_[a-z0-9_]+)\b/i.test(
      line
    )
      ? 'unexpected'
      : 'informational';
  }

  if (
    /^DevTools listening on ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[0-9a-f-]+$/i.test(line)
  ) {
    return 'informational';
  }

  if (
    /^\[[^\]\r\n]+:WARNING:media\/gpu\/vaapi\/vaapi_wrapper\.cc:1655\] drmGetDevices2\(\) has not found any devices$/.test(
      line
    )
  ) {
    // Chromium probes VA-API hardware video acceleration at startup; on a
    // GPU-less headless runner there is no DRM device to find and Chromium
    // simply runs without acceleration. First observed under Chromium 150
    // (Electron 43) on the ubuntu-latest packaged smoke; the line number is
    // pinned on purpose so a Chromium rebase forces re-verification.
    return 'informational';
  }

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} Puntovivo Helper\[\d+:\d+\] XPC error for connection com\.apple\.backupd\.sandbox\.xpc: Connection invalid$/.test(
      line
    )
  ) {
    // macOS logs this NSLog-format line from the ad-hoc-signed Helper when
    // the system backupd sandbox refuses an XPC connection the process never
    // needed; the app is unaffected. Observed on the macOS Sequoia 15 runner
    // under Electron 43 (the Tahoe 26 runner does not emit it). The exact
    // service name keeps every other XPC failure blocking. The helper is named
    // after productName in apps/desktop/electron-builder.yml; the policy test
    // reads it from there, so a rename fails that test instead of the mac smoke.
    return 'informational';
  }

  if (boundedStderrDiagnostic(line)) {
    // Accepted line by line here; a run classifier also enforces the limit
    // documented on BOUNDED_STDERR_DIAGNOSTICS.
    return 'informational';
  }

  if (
    /^\[[^\]\r\n]+:WARNING:net\/dns\/address_sorter_posix\.cc:458\] FromSockAddr failed on netmask$/.test(
      line
    )
  ) {
    // Chromium emits this while inventorying macOS/BSD interfaces when one
    // OS-provided netmask cannot be decoded. The source keeps the address with
    // its default prefix and continues normally. Keep the exact upstream
    // diagnostic visible without weakening the policy for any other warning.
    // The line number is pinned ON PURPOSE so every Chromium rebase forces a
    // human re-verification before re-accepting: 457 under Chromium 148
    // (Electron 42), re-verified at 458 under Chromium 150 (Electron 43).
    return 'informational';
  }

  if (
    allowPackagedNetworkRaceDiagnostic &&
    /^\[[^\]\r\n]+:WARNING:net\/spdy\/spdy_session\.cc:3154\] Received HEADERS for invalid stream [1-9]\d*$/.test(
      line
    )
  ) {
    // A response can arrive after Chromium has cancelled and removed its
    // HTTP/2 stream during packaged-harness shutdown. Chromium logs this exact
    // condition and returns; keep every neighboring SPDY warning blocking.
    return 'informational';
  }

  return 'unexpected';
}

/**
 * Classify the stderr of one process run. Lines are classified exactly as
 * classifyElectronStderrLine does, except that a bounded diagnostic becomes
 * unexpected once it repeats past its limit within this run. Create one
 * classifier per launched process so every run starts with a fresh budget.
 */
export function createElectronStderrClassifier(options = {}) {
  const counts = new Map();
  return {
    classify(line) {
      const classification = classifyElectronStderrLine(line, options);
      const diagnostic = classification === 'informational' ? boundedStderrDiagnostic(line) : null;
      if (!diagnostic) return classification;
      const count = (counts.get(diagnostic) ?? 0) + 1;
      counts.set(diagnostic, count);
      return count > diagnostic.limit ? 'unexpected' : classification;
    },
    exceededLimits() {
      return BOUNDED_STDERR_DIAGNOSTICS.filter(
        diagnostic => (counts.get(diagnostic) ?? 0) > diagnostic.limit
      ).map(diagnostic => ({
        id: diagnostic.id,
        description: diagnostic.description,
        count: counts.get(diagnostic),
        limit: diagnostic.limit,
      }));
    },
  };
}

export function classifyElectronStdoutLine(line) {
  try {
    const record = JSON.parse(line);
    if (
      record &&
      typeof record === 'object' &&
      typeof record.level === 'number' &&
      record.level >= 40
    ) {
      return 'unexpected';
    }
  } catch {
    // Non-JSON stdout remains visible evidence and is not a severity record.
  }

  return 'informational';
}
