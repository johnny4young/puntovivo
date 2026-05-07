/**
 * ENG-069 — Renderer-side mirror of the server's surfaces manifest.
 *
 * The server lives in `packages/server/src/services/surfaces/manifest.ts`
 * and is the single source of truth. This file ships a STRUCTURAL
 * mirror so the renderer can reference SurfaceId values + each
 * surface's gating module without pulling drizzle/server runtime
 * into the bundle.
 *
 * Drift protection: when a surface is added or removed, the server
 * router's `surfaces.list` response shape flows through tRPC types
 * into the renderer; the editor flags any consumer that references
 * a stale id. Smoke tests in Phase 4 also double-read the server's
 * canonical surface list to confirm parity.
 */

import type { ClientModuleId } from '@/features/modules/manifest';

export const CLIENT_SURFACE_IDS = [
  'pos-desktop',
  'pos-touch',
  'kds',
  'customer-display',
  'mobile-waiter',
] as const;

export type ClientSurfaceId = (typeof CLIENT_SURFACE_IDS)[number];

export interface ClientSurfaceDescriptor {
  id: ClientSurfaceId;
  /** Module gating this surface. `null` for the implicit POS Desktop default. */
  moduleId: ClientModuleId | null;
  defaultRoute: string;
  i18nKey: string;
}

/**
 * Mirror of the server `SURFACES_MANIFEST`. Stays in sync with the
 * server file by review + parity test in Phase 1.
 */
export const CLIENT_SURFACES_MANIFEST: Record<
  ClientSurfaceId,
  ClientSurfaceDescriptor
> = {
  'pos-desktop': {
    id: 'pos-desktop',
    moduleId: null,
    defaultRoute: '/dashboard',
    i18nKey: 'posDesktop',
  },
  'pos-touch': {
    id: 'pos-touch',
    moduleId: 'pos-touch',
    defaultRoute: '/touch',
    i18nKey: 'posTouch',
  },
  'kds': {
    id: 'kds',
    moduleId: 'kds',
    defaultRoute: '/kds',
    i18nKey: 'kds',
  },
  'customer-display': {
    id: 'customer-display',
    moduleId: 'customer-display',
    defaultRoute: '/customer-display',
    i18nKey: 'customerDisplay',
  },
  'mobile-waiter': {
    id: 'mobile-waiter',
    moduleId: 'mobile-waiter',
    defaultRoute: '/m',
    i18nKey: 'mobileWaiter',
  },
};

export function isClientSurfaceId(value: string): value is ClientSurfaceId {
  return (CLIENT_SURFACE_IDS as readonly string[]).includes(value);
}
