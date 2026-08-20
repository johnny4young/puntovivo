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
