/** `operations` covers an approval waiting or a register handoff received. */
export type CompanionInvalidationScope = 'sales' | 'operations' | 'day_close';

export interface CompanionRealtimeBroadcaster {
  broadcast(eventName: string, data: unknown, tenantId: string): void;
}

/** Emit no business payload: the client must re-read its tenant-safe snapshot. */
export function broadcastCompanionInvalidation(input: {
  sse: CompanionRealtimeBroadcaster | null | undefined;
  tenantId: string;
  scope: CompanionInvalidationScope;
  now?: Date;
}): void {
  input.sse?.broadcast(
    'companion.invalidated',
    {
      scope: input.scope,
      changedAt: (input.now ?? new Date()).toISOString(),
    },
    input.tenantId
  );
}

/** Best effort: a failed live refresh never fails the command that caused it. */
export function tryBroadcastCompanionInvalidation(input: {
  sse: CompanionRealtimeBroadcaster | null | undefined;
  tenantId: string;
  scope: CompanionInvalidationScope;
  log?: { warn: (details: object, message: string) => void } | undefined;
}): void {
  try {
    broadcastCompanionInvalidation(input);
  } catch (error) {
    input.log?.warn(
      { err: error, scope: input.scope },
      'companion invalidation failed (non-blocking)'
    );
  }
}
