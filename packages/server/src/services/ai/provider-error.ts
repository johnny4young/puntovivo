/**
 * Bounded, privacy-safe description of an untrusted provider failure.
 *
 * Provider SDK errors carry the outbound request body (prompts with tenant
 * business data), response bodies, URLs and headers as enumerable fields.
 * Pino's default `err` serializer copies every enumerable field into the log
 * record, so a raw provider error must never be logged. Log this summary.
 *
 * @module services/ai/provider-error
 */

export interface ProviderErrorSummary {
  /** Error class name, e.g. `AI_APICallError`, `TimeoutError`. */
  name: string;
  /** HTTP status when the provider answered; absent for transport loss. */
  statusCode?: number;
  /** Node transport code from the cause chain, e.g. `ECONNREFUSED`. */
  code?: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

function safeToken(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : undefined;
}

export function summarizeProviderError(error: unknown): ProviderErrorSummary {
  const summary: ProviderErrorSummary = {
    name: (error instanceof Error && safeToken(error.name)) || 'UnknownError',
  };
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const record = current as Record<string, unknown>;
    const status = record.statusCode ?? record.status;
    if (
      summary.statusCode === undefined &&
      typeof status === 'number' &&
      Number.isInteger(status)
    ) {
      summary.statusCode = status;
    }
    const code = safeToken(record.code);
    if (summary.code === undefined && code) summary.code = code;
    current = record.cause;
  }
  return summary;
}
