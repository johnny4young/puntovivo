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
};

export function isClientModuleId(value: string): value is ClientModuleId {
  return (CLIENT_MODULE_IDS as readonly string[]).includes(value);
}
