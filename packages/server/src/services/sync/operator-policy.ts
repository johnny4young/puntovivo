/** Fail closed at manual recovery surfaces; original transactional producers and retry stay separate. */
import { throwServerError } from '../../lib/errorCodes.js';
import { canUseOperatorSyncPayload } from './contract.js';

/** Tenant-bound payload presented to an operator recovery surface; never a domain command. */
export interface OperatorSyncPayload {
  tenantId: string;
  entityId: string;
  entityType: string;
  data: Record<string, unknown> | null | undefined;
}

export function canUseScopedOperatorSyncPayload(input: OperatorSyncPayload): boolean {
  return (
    canUseOperatorSyncPayload(input.entityType, input.data) &&
    (input.data?.id === undefined || input.data.id === input.entityId) &&
    (input.data?.tenantId === undefined || input.data.tenantId === input.tenantId)
  );
}

export function assertOperatorSyncPayload(input: OperatorSyncPayload): void {
  if (!canUseScopedOperatorSyncPayload(input)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SYNC_REMOTE_APPLY_BLOCKED',
      message: 'This recovery requires a verified atomic domain codec',
      details: { entityType: input.entityType },
    });
  }
}
