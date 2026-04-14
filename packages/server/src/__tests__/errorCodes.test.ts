/**
 * Unit tests for the server error code helper and tRPC error formatter
 * integration.
 *
 * @module __tests__/errorCodes.test
 */

import { describe, expect, it } from 'vitest';
import { TRPCError, type TRPCDefaultErrorShape } from '@trpc/server';
import { ZodError, z } from 'zod';
import { formatTrpcError } from '../trpc/init.js';
import {
  ServerErrorWithCode,
  SERVER_ERROR_CODES,
  throwServerError,
} from '../lib/errorCodes.js';

function makeShape(): TRPCDefaultErrorShape {
  return {
    message: 'placeholder',
    code: -32600,
    data: {
      code: 'BAD_REQUEST',
      httpStatus: 400,
      path: 'auth.login',
    },
  };
}

describe('errorCodes helper', () => {
  it('throwServerError throws a TRPCError with the matching trpc code and message', () => {
    let caught: unknown;
    try {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcError = caught as TRPCError;
    expect(trpcError.code).toBe('UNAUTHORIZED');
    expect(trpcError.message).toBe('Email or password is incorrect');
  });

  it('throwServerError attaches a ServerErrorWithCode cause carrying the stable code', () => {
    let caught: unknown;
    try {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'AUTH_PASSWORD_POLICY',
        message: 'Password too short',
        details: { errors: ['min length 12'] },
      });
    } catch (err) {
      caught = err;
    }

    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    const codedCause = cause as ServerErrorWithCode;
    expect(codedCause.errorCode).toBe('AUTH_PASSWORD_POLICY');
    expect(codedCause.details).toEqual({ errors: ['min length 12'] });
  });

  it('SERVER_ERROR_CODES exposes every auth-domain code as a string constant', () => {
    // Sanity-check the enum-like object so a code rename surfaces the
    // affected sites in one place rather than in every router that throws.
    const expected = [
      'AUTH_INVALID_CREDENTIALS',
      'AUTH_USER_DISABLED',
      'AUTH_TENANT_DISABLED',
      'AUTH_REFRESH_INVALID',
      'AUTH_USER_NOT_FOUND',
      'AUTH_CURRENT_PASSWORD_INCORRECT',
      'AUTH_PASSWORD_POLICY',
    ];
    for (const code of expected) {
      expect(SERVER_ERROR_CODES).toHaveProperty(code, code);
    }
  });
});

describe('formatTrpcError (i18n-aware tRPC error formatter)', () => {
  it('attaches the stable errorCode + details when cause is ServerErrorWithCode', () => {
    const cause = new ServerErrorWithCode(
      'AUTH_PASSWORD_POLICY',
      'Password too short',
      { errors: ['min length 12'] }
    );

    const formatted = formatTrpcError({
      shape: makeShape(),
      error: { cause },
    });

    expect(formatted.data.errorCode).toBe('AUTH_PASSWORD_POLICY');
    expect(formatted.data.errorDetails).toEqual({ errors: ['min length 12'] });
    expect(formatted.data.zodError).toBeNull();
  });

  it('attaches zodError when cause is ZodError and leaves errorCode null', () => {
    const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
    let zodError: ZodError | null = null;
    try {
      schema.parse({ email: '', password: '' });
    } catch (err) {
      zodError = err as ZodError;
    }
    expect(zodError).toBeInstanceOf(ZodError);

    const formatted = formatTrpcError({
      shape: makeShape(),
      error: { cause: zodError },
    });

    expect(formatted.data.errorCode).toBeNull();
    expect(formatted.data.zodError).not.toBeNull();
    expect(formatted.data.zodError?.fieldErrors.email).toBeDefined();
  });

  it('returns null errorCode and zodError for plain causes (e.g. raw Error)', () => {
    const formatted = formatTrpcError({
      shape: makeShape(),
      error: { cause: new Error('boom') },
    });

    expect(formatted.data.errorCode).toBeNull();
    expect(formatted.data.errorDetails).toBeNull();
    expect(formatted.data.zodError).toBeNull();
  });

  it('preserves the original shape fields (httpStatus, path, code)', () => {
    const shape = makeShape();
    const formatted = formatTrpcError({
      shape,
      error: { cause: undefined },
    });

    expect(formatted.message).toBe(shape.message);
    expect(formatted.code).toBe(shape.code);
    expect(formatted.data.code).toBe(shape.data.code);
    expect(formatted.data.httpStatus).toBe(shape.data.httpStatus);
    expect(formatted.data.path).toBe(shape.data.path);
  });
});
