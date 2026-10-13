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

import { createModuleLogger } from '../../logging/logger.js';
import type { ServerErrorCode } from '../../lib/errorCodes.js';

export interface ProviderErrorSummary {
  /** Error class name, e.g. `AI_APICallError`, `TimeoutError`. */
  name: string;
  /** HTTP status when the provider answered; absent for transport loss. */
  statusCode?: number;
  /** Node transport code from the cause chain, e.g. `ECONNREFUSED`. */
  code?: string;
}

/** Class names are identifiers; anything else may be attacker-controlled text. */
const SAFE_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
/** Node / undici transport codes (`ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`). */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_DEPTH = 4;

function safeToken(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function httpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

/**
 * Next link in the error chain. The AI SDK wraps exhausted retries in
 * `AI_RetryError`, which carries the provider answer in `lastError` rather
 * than `cause`; following it keeps the 429/5xx status in the summary.
 */
function nextInChain(record: Record<string, unknown>): unknown {
  return record.cause ?? record.lastError;
}

export function summarizeProviderError(error: unknown): ProviderErrorSummary {
  const summary: ProviderErrorSummary = {
    name: (error instanceof Error && safeToken(error.name, SAFE_NAME)) || 'UnknownError',
  };
  let current: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH && current && typeof current === 'object'; depth += 1) {
    const record = current as Record<string, unknown>;
    const status = httpStatus(record.statusCode ?? record.status);
    if (summary.statusCode === undefined && status !== undefined) summary.statusCode = status;
    const code = safeToken(record.code, SAFE_CODE);
    if (summary.code === undefined && code !== undefined) summary.code = code;
    current = nextInChain(record);
  }
  return summary;
}

const log = createModuleLogger('services/ai/provider-error');

/**
 * Log a provider failure with only bounded metadata: the summary above plus
 * caller-supplied identifiers. Never pass the raw error or prompt text here.
 */
export function logProviderFailure(
  error: unknown,
  meta: {
    tenantId: string;
    /** Same stable label persisted in `ai_audit_log.feature`. */
    feature: string;
    providerId: string;
    modelId: string;
    errorCode: ServerErrorCode;
  }
): void {
  log.warn({ provider: summarizeProviderError(error), ...meta }, 'AI provider call failed');
}
