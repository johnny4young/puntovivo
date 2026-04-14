import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  extractServerErrorCode,
  translateServerError,
} from './translateServerError';

/**
 * A minimal `t`-shaped function that records its calls so tests can assert
 * the helper resolves keys from the expected namespace. Keeps tests free of
 * any i18next bootstrap.
 */
function makeFakeT(map: Record<string, string>): TFunction {
  const t = ((key: string): string => map[key] ?? key) as unknown as TFunction;
  return t;
}

describe('extractServerErrorCode', () => {
  it('returns the code from `data.errorCode` (typical tRPC client shape)', () => {
    const error = { data: { errorCode: 'AUTH_INVALID_CREDENTIALS' } };
    expect(extractServerErrorCode(error)).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns the code from `shape.data.errorCode` (serialized variants)', () => {
    const error = { shape: { data: { errorCode: 'AUTH_USER_DISABLED' } } };
    expect(extractServerErrorCode(error)).toBe('AUTH_USER_DISABLED');
  });

  it('returns the code from a flat `errorCode` field (test fixtures)', () => {
    const error = { errorCode: 'AUTH_TENANT_DISABLED' };
    expect(extractServerErrorCode(error)).toBe('AUTH_TENANT_DISABLED');
  });

  it('returns null when the code is unknown / unrecognized', () => {
    expect(extractServerErrorCode({ data: { errorCode: 'NOT_A_REAL_CODE' } })).toBeNull();
  });

  it('returns null when there is no errorCode field anywhere', () => {
    expect(extractServerErrorCode({ data: {} })).toBeNull();
    expect(extractServerErrorCode(new Error('boom'))).toBeNull();
    expect(extractServerErrorCode(null)).toBeNull();
    expect(extractServerErrorCode('string')).toBeNull();
  });
});

describe('translateServerError', () => {
  const fallback = 'Something went wrong (fallback)';

  it('returns the translated message for a known errorCode', () => {
    const t = makeFakeT({
      'errors:server.AUTH_INVALID_CREDENTIALS': 'Correo o contraseña incorrectos.',
    });
    const result = translateServerError(
      { data: { errorCode: 'AUTH_INVALID_CREDENTIALS' }, message: 'Email or password is incorrect' },
      t,
      fallback
    );
    expect(result).toBe('Correo o contraseña incorrectos.');
  });

  it('falls back to the server English message when the code is unknown', () => {
    const t = makeFakeT({});
    const error = new Error('Something specific from the server');
    const result = translateServerError(error, t, fallback);
    expect(result).toBe('Something specific from the server');
  });

  it('falls back to the fallback string when neither code nor message is present', () => {
    const t = makeFakeT({});
    expect(translateServerError({}, t, fallback)).toBe(fallback);
    expect(translateServerError(null, t, fallback)).toBe(fallback);
    expect(translateServerError(undefined, t, fallback)).toBe(fallback);
  });

  it('prefers the translated code over the English server message', () => {
    const t = makeFakeT({
      'errors:server.AUTH_USER_DISABLED': 'Tu cuenta ha sido deshabilitada.',
    });
    const error = {
      data: { errorCode: 'AUTH_USER_DISABLED' },
      message: 'Your account has been disabled. Please contact an administrator.',
    };
    expect(translateServerError(error, t, fallback)).toBe(
      'Tu cuenta ha sido deshabilitada.'
    );
  });

  it('falls back to the server message when the translation key is missing', () => {
    const t = makeFakeT({});
    const error = {
      data: { errorCode: 'AUTH_USER_DISABLED' },
      message: 'Your account has been disabled. Please contact an administrator.',
    };

    expect(translateServerError(error, t, fallback)).toBe(
      'Your account has been disabled. Please contact an administrator.'
    );
  });

  it('handles object-shaped errors without an Error prototype', () => {
    const t = makeFakeT({});
    const error = { message: 'Plain object error' };
    expect(translateServerError(error, t, fallback)).toBe('Plain object error');
  });

  it('ignores empty / whitespace-only server messages and uses fallback', () => {
    const t = makeFakeT({});
    expect(translateServerError({ message: '   ' }, t, fallback)).toBe(fallback);
    expect(translateServerError(new Error('   '), t, fallback)).toBe(fallback);
  });
});
