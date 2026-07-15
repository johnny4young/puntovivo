/** ENG-123c — Shared launch-import safety contracts. */
import { TRPCError } from '@trpc/server';

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export function getImportSourceFormat(sourceName: string): 'csv' | 'xlsx' | 'unknown' {
  const normalized = sourceName.trim().toLocaleLowerCase('en-US');
  if (normalized.endsWith('.csv')) return 'csv';
  if (normalized.endsWith('.xlsx')) return 'xlsx';
  return 'unknown';
}

export function getSafeImportErrorMetadata(error: unknown): {
  errorCode?: string;
  errorType: string;
} {
  const errorType =
    error instanceof Error && SAFE_ERROR_TYPE.test(error.name) ? error.name : 'Error';
  let candidate: unknown = error;
  for (let depth = 0; depth < 2; depth += 1) {
    if (!candidate || typeof candidate !== 'object') break;
    if (
      'code' in candidate &&
      typeof candidate.code === 'string' &&
      SAFE_ERROR_CODE.test(candidate.code)
    ) {
      return { errorCode: candidate.code, errorType };
    }
    candidate = 'cause' in candidate ? candidate.cause : undefined;
  }
  return { errorType };
}

export function assertRealDataCommit(input: {
  confirmedRealData?: unknown;
  dataMode?: unknown;
}): void {
  if (input.dataMode !== 'real' || input.confirmedRealData !== true) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Demo imports are preview-only. Confirm real data before importing.',
    });
  }
}
