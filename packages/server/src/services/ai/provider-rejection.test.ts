import { APICallError, RetryError } from 'ai';
import { describe, expect, it } from 'vitest';

import { isDefinitiveProviderRejection } from './provider-rejection.js';

function apiError(statusCode: number | undefined, cause?: unknown): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://provider.invalid/v1',
    requestBodyValues: {},
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(cause !== undefined ? { cause } : {}),
  });
}

function transport(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

describe('isDefinitiveProviderRejection', () => {
  it.each([400, 401, 403, 404, 422, 429])('treats a %i answer as not billed', status => {
    expect(isDefinitiveProviderRejection(apiError(status))).toBe(true);
  });

  it.each([402, 408, 409, 413, 499, 500, 502, 503, 529])('keeps a %i answer uncertain', status => {
    expect(isDefinitiveProviderRejection(apiError(status))).toBe(false);
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'CERT_HAS_EXPIRED'])(
    'treats %s (request never sent) as not billed',
    code => {
      expect(isDefinitiveProviderRejection(transport(code))).toBe(true);
      expect(isDefinitiveProviderRejection(apiError(undefined, transport(code)))).toBe(true);
    }
  );

  it.each(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ETIMEDOUT'])(
    'keeps %s (request may have been sent) uncertain',
    code => {
      expect(isDefinitiveProviderRejection(transport(code))).toBe(false);
    }
  );

  it('never treats our own abort or deadline as definitive', () => {
    const abort = Object.assign(new Error('aborted'), {
      name: 'AbortError',
      cause: transport('ECONNREFUSED'),
    });
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(isDefinitiveProviderRejection(abort)).toBe(false);
    expect(isDefinitiveProviderRejection(timeout)).toBe(false);
    expect(isDefinitiveProviderRejection(new Error('plain'))).toBe(false);
    expect(isDefinitiveProviderRejection('string failure')).toBe(false);
  });

  it('reads the decisive error of an SDK retry wrapper', () => {
    const wrap = (lastError: unknown) =>
      new RetryError({
        message: 'retries exhausted',
        reason: 'maxRetriesExceeded',
        errors: [lastError],
      });
    expect(isDefinitiveProviderRejection(wrap(apiError(429)))).toBe(true);
    expect(isDefinitiveProviderRejection(wrap(apiError(503)))).toBe(false);
  });
});
