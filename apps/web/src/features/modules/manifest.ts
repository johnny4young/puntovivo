/**
 * ENG-068 — Renderer-side mirror of the server's module manifest.
 *
 * The server lives in `packages/server/src/services/modules/manifest.ts`
 * and is the single source of truth. This file ships a STRUCTURAL
 * mirror so the renderer doesn't pull in drizzle/server runtime just
 * to know which module ids exist.
 *
 * Drift protection: when a module is added or removed, the server
 * router's tRPC types flow into `getEffective` (response shape) and
 * `setActive` (input refine), so the editor flags any renderer that
 * references a stale id. The smoke test in Phase 4 also double-reads
 * the server's effective state to confirm parity.
 */

export const CLIENT_MODULE_IDS = [
  'copilot',
  'operations-center',
  'quotations',
  'anomaly-detection',
  'semantic-search',
  // ENG-069 — surface modules. Each ships defaultEnabled=false so the
  // renderer never flashes a new sidebar entry on cold boot for
  // existing tenants. Operators flip them on per tenant via
  // /company?tab=modules.
  'pos-touch',
  'kds',
  'customer-display',
  'mobile-waiter',
  // ENG-070 — public events foundation. Default OFF; admins flip on
  // when they want the tenant's critical commands to populate
  // webhook_outbox. v1 ships the contract + projector + outbox; the
  // HTTP delivery worker arrives in ENG-070b.
  'events-api',
] as const;

export type ClientModuleId = (typeof CLIENT_MODULE_IDS)[number];

/**
 * Defaults applied when the renderer hasn't yet received the
 * `modules.getEffective` response. Mirrors the server's
 * `MODULES_MANIFEST[id].defaultEnabled` so the renderer never flashes
 * a hidden route during boot.
 */
export const CLIENT_MODULE_DEFAULTS: Record<ClientModuleId, boolean> = {
  copilot: true,
  'operations-center': true,
  quotations: true,
  'anomaly-detection': true,
  'semantic-search': true,
  // ENG-069 — surface modules opt-in.
  'pos-touch': false,
  'kds': false,
  'customer-display': false,
  'mobile-waiter': false,
  // ENG-070 — public events module opt-in.
  'events-api': false,
};

export function isClientModuleId(value: string): value is ClientModuleId {
  return (CLIENT_MODULE_IDS as readonly string[]).includes(value);
}
