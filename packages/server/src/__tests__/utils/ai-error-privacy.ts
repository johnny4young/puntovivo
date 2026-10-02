import { TRPCError } from '@trpc/server';
import { expect } from 'vitest';
import { formatTrpcError } from '../../trpc/init.js';

/** Checks the public formatter payload, including the development stack, for a diagnostic canary. */
export function expectNoPublicDiagnostic(error: unknown, canary: string): void {
  expect(error).toBeInstanceOf(TRPCError);
  const failure = error as TRPCError;
  const formatted = formatTrpcError({
    error: failure,
    shape: {
      message: failure.message,
      code: -32603,
      data: {
        code: failure.code,
        httpStatus: 500,
        ...(failure.stack === undefined ? {} : { stack: failure.stack }),
      },
    },
  });
  expect(formatted.data.errorDetails).toBeNull();
  expect(JSON.stringify(formatted)).not.toContain(canary);
}
