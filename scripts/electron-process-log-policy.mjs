/**
 * Classify Electron/Chromium stderr without disabling its diagnostic emitters.
 *
 * Chromium writes informational console forwarding and the remote-debugging
 * endpoint to stderr. Those records are still evidence, but they are not
 * failures. Everything else remains unexpected so E2E can fail instead of
 * turning a renderer/native warning into a green run.
 */
export function classifyElectronStderrLine(line) {
  if (
    line.length === 0 ||
    /^Debugger ending on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+$/i.test(line) ||
    line === 'For help, see: https://nodejs.org/learn/getting-started/debugging' ||
    line === 'Waiting for the debugger to disconnect...'
  ) {
    return 'lifecycle';
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
