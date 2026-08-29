export type CompanionInvalidationScope = 'sales' | 'day_close';

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
