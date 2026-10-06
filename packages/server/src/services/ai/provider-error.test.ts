import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';

import { summarizeProviderError } from './provider-error.js';

describe('summarizeProviderError', () => {
  it('keeps only the error class and HTTP status of a provider answer', () => {
    const error = new APICallError({
      message: 'rate limited for statement REF-SECRET-42',
      url: 'https://provider.example/v1/messages?key=secret-key',
      requestBodyValues: { prompt: 'tender 125000 for customer Ana Secreta' },
      statusCode: 429,
      responseBody: '{"error":"secret-response-body"}',
      isRetryable: true,
    });

    const summary = summarizeProviderError(error);

    expect(summary).toEqual({ name: 'AI_APICallError', statusCode: 429 });
    expect(JSON.stringify(summary)).not.toMatch(/secret|Secreta|REF-|125000/i);
  });

  it('reports a transport code from the cause chain without its message', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.7:443 secret-host'), {
      code: 'ECONNREFUSED',
    });
    const error = new TypeError('fetch failed', { cause });

    expect(summarizeProviderError(error)).toEqual({ name: 'TypeError', code: 'ECONNREFUSED' });
  });

  it('never echoes untrusted names, codes or non-errors', () => {
    const hostile = Object.assign(new Error('x'), {
      name: 'Bad name with prompt text and spaces',
      code: 'customer=Ana Secreta',
    });

    expect(summarizeProviderError(hostile)).toEqual({ name: 'UnknownError' });
    expect(summarizeProviderError('raw provider string')).toEqual({ name: 'UnknownError' });
  });
});
