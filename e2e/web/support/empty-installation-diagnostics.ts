/**
 * Safe context for failures in the isolated empty-installation forwarding seam.
 * Raw Playwright route errors can echo request cookies, so callers must never
 * include the original error message, URL query, or headers in test output.
 */
export interface EmptyInstallationForwardingFailure {
  method: string;
  requestUrl: string;
  error: unknown;
  childExitCode: number | null;
  childSignalCode: string | null;
  childConnected: boolean;
  stderrBytes: number;
}

const TRANSPORT_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ERR_ABORTED',
  'ABORT_ERR',
] as const;

/** Summarize only allowlisted, non-secret diagnostic fields. */
export function describeEmptyInstallationForwardingFailure(
  context: EmptyInstallationForwardingFailure
): string {
  let procedure = 'other-api';
  try {
    const pathname = new URL(context.requestUrl).pathname;
    procedure = /^\/api\/trpc\/([A-Za-z0-9._-]+)$/.exec(pathname)?.[1] ?? procedure;
  } catch {
    // An invalid URL is itself diagnostic; do not echo the original string.
  }

  const method = /^(GET|POST|PUT|PATCH|DELETE)$/.test(context.method) ? context.method : 'OTHER';
  const errorText = context.error instanceof Error ? context.error.message : '';
  const transport = TRANSPORT_CODES.find(code => errorText.includes(code)) ?? 'unknown';
  const exit = Number.isInteger(context.childExitCode) ? context.childExitCode : 'running';
  const signal =
    context.childSignalCode && /^SIG[A-Z0-9]+$/.test(context.childSignalCode)
      ? context.childSignalCode
      : 'none';
  const stderrBytes =
    Number.isSafeInteger(context.stderrBytes) && context.stderrBytes >= 0 ? context.stderrBytes : 0;

  return `Empty installation API forwarding failed: ${method} ${procedure}; transport=${transport}; childExit=${exit}; childSignal=${signal}; childConnected=${context.childConnected}; stderrBytes=${stderrBytes}`;
}
