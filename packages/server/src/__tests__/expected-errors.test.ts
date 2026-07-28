import { describe, expect, it } from 'vitest';
import {
  classifyExpectedTrpcControlFlow,
  isExpectedMissingRefresh,
} from '../trpc/expected-errors.js';

describe('isExpectedMissingRefresh', () => {
  const missingRefresh = {
    code: 'UNAUTHORIZED',
    cause: { errorCode: 'AUTH_REFRESH_INVALID' },
  };

  it('accepts the structural error shape emitted across a bundled runtime boundary', () => {
    expect(isExpectedMissingRefresh('auth.refresh', missingRefresh, { cookies: {} })).toBe(true);
  });

  it.each([
    'Refresh session is invalid or missing',
    'Refresh session is invalid or missing: Refresh session is invalid or missing',
  ])('accepts the exact bundled message when the custom cause is flattened: %s', message => {
    expect(
      isExpectedMissingRefresh('auth.refresh', { code: 'UNAUTHORIZED', message }, { cookies: {} })
    ).toBe(true);
  });

  it('keeps a supplied invalid refresh cookie on the incident path', () => {
    expect(
      isExpectedMissingRefresh('auth.refresh', missingRefresh, {
        cookies: { puntovivo_refresh: 'invalid-token' },
      })
    ).toBe(false);
  });

  it.each([
    ['other procedure', 'auth.login', missingRefresh],
    ['other code', 'auth.refresh', { code: 'FORBIDDEN', cause: missingRefresh.cause }],
    [
      'other domain error',
      'auth.refresh',
      { code: 'UNAUTHORIZED', cause: { errorCode: 'AUTH_INVALID_CREDENTIALS' } },
    ],
    [
      'other unauthorized message',
      'auth.refresh',
      { code: 'UNAUTHORIZED', message: 'User not found or disabled' },
    ],
    ['primitive error', 'auth.refresh', 'unauthorized'],
  ])('rejects %s', (_label, path, error) => {
    expect(isExpectedMissingRefresh(path, error, { cookies: {} })).toBe(false);
  });
});

describe('classifyExpectedTrpcControlFlow', () => {
  it.each([
    'PARSE_ERROR',
    'BAD_REQUEST',
    'UNAUTHORIZED',
    'PAYMENT_REQUIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'METHOD_NOT_SUPPORTED',
    'CONFLICT',
    'PRECONDITION_FAILED',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'UNPROCESSABLE_CONTENT',
    'TOO_MANY_REQUESTS',
    'CLIENT_CLOSED_REQUEST',
  ])('classifies %s as an expected client rejection', code => {
    expect(classifyExpectedTrpcControlFlow('products.create', { code }, { cookies: {} })).toEqual({
      code,
      reason: 'client_rejection',
    });
  });

  it.each([
    'INTERNAL_SERVER_ERROR',
    'NOT_IMPLEMENTED',
    'TIMEOUT',
    'BAD_GATEWAY',
    'SERVICE_UNAVAILABLE',
    'GATEWAY_TIMEOUT',
  ])('keeps %s on the incident path', code => {
    expect(
      classifyExpectedTrpcControlFlow('products.create', { code }, { cookies: {} })
    ).toBeNull();
  });

  it('classifies an absent refresh cookie separately from other client rejections', () => {
    expect(
      classifyExpectedTrpcControlFlow(
        'auth.refresh',
        {
          code: 'UNAUTHORIZED',
          cause: { errorCode: 'AUTH_REFRESH_INVALID' },
        },
        { cookies: {} }
      )
    ).toEqual({
      code: 'UNAUTHORIZED',
      reason: 'missing_refresh_cookie',
    });
  });

  it('keeps a supplied invalid refresh cookie on the incident path', () => {
    expect(
      classifyExpectedTrpcControlFlow(
        'auth.refresh',
        {
          code: 'UNAUTHORIZED',
          cause: { errorCode: 'AUTH_REFRESH_INVALID' },
        },
        { cookies: { puntovivo_refresh: 'invalid-token' } }
      )
    ).toBeNull();
  });

  it('does not classify unknown or malformed errors', () => {
    expect(
      classifyExpectedTrpcControlFlow('products.create', { code: 'CUSTOM_FAILURE' }, undefined)
    ).toBeNull();
    expect(
      classifyExpectedTrpcControlFlow('products.create', new Error('boom'), undefined)
    ).toBeNull();
  });
});
