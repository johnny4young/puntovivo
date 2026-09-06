import { TRPCClientError } from '@trpc/client';

/** Locked verification state; retryAt is an epoch-millisecond operator cooldown, not a grant. */
export interface AuthBootstrapRecovery {
  kind: 'throttled' | 'unavailable';
  retryAt: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function isUnauthorizedAuthFailure(error: unknown): boolean {
  const data = record(record(error).data);
  return (
    data.code === 'UNAUTHORIZED' ||
    data.httpStatus === 401 ||
    (error instanceof TRPCClientError &&
      error.message === 'You must be logged in to perform this action')
  );
}

/** Read only safe transport metadata, never display raw server/error messages. */
export function authBootstrapRecovery(error: unknown, now = Date.now()): AuthBootstrapRecovery {
  const data = record(record(error).data);
  const throttled =
    data.httpStatus === 429 ||
    data.code === 'TOO_MANY_REQUESTS' ||
    data.errorCode === 'AUTH_RATE_LIMIT_EXCEEDED';
  let retryAfter: string | null = null;
  try {
    const response = record(record(error).meta).response;
    if (response instanceof Response) retryAfter = response.headers.get('retry-after');
  } catch {
    // Serialized Store Hub errors have no Response. The server remains the
    // authority; a conservative minute is only an operator retry affordance.
  }
  let retryAt = now + (throttled ? 60_000 : 0);
  if (retryAfter !== null) {
    const seconds = /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
    const httpDate = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      retryAfter
    );
    const deadline =
      seconds === null ? (httpDate ? Date.parse(retryAfter) : Number.NaN) : now + seconds * 1_000;
    if (Number.isFinite(deadline) && deadline >= 0) retryAt = Math.max(now, deadline);
  }
  return { kind: throttled ? 'throttled' : 'unavailable', retryAt };
}

/** Device custody may only move through an authenticated parking/handoff transaction. */
export function isDeviceIdentityChanged(error: unknown): boolean {
  return record(record(error).data).errorCode === 'AUTH_IDENTITY_CHANGED';
}
