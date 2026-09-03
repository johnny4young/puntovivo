/** Synchronous invalidation boundary; kitchen data is fetched through the scoped tRPC board. */
export interface KdsSseBroadcaster {
  broadcast(eventName: string, data: unknown, tenantId: string): void;
}
