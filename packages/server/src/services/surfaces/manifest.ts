/**
 * ENG-069 — Multi-surface POS shell manifest.
 *
 * A "surface" is a configured render target on top of the same
 * application bundle. POS Desktop is the existing UI shipping today
 * (sidebar + Header + main content area). The four NEW surfaces in
 * v1 each have their own layout chrome:
 *
 *   - POS Touch — touch-optimized layout for tablets.
 *   - KDS — fullscreen kitchen ticket queue (no sidebar / no Header).
 *   - Customer Display — second-monitor cart mirror (read-only).
 *   - Mobile Waiter — phone-width layout for waitstaff.
 *
 * Each surface gates behind a dedicated module id from
 * `services/modules/manifest.ts`. POS Desktop is the implicit default
 * and does NOT carry a module gate — the existing `/sales`, `/inventory`,
 * `/dashboard` etc routes keep rendering through `MainLayout` as today.
 *
 * The manifest is the SINGLE SOURCE OF TRUTH. Adding a surface =
 * (a) append the id to `SURFACE_IDS`, (b) add the SURFACES_MANIFEST
 * entry, (c) add the module id (already gated by the modules manifest's
 * own exhaustiveness), (d) add i18n strings for `surfaces.<i18nKey>.*`.
 *
 * Mirrors the ENG-068 module manifest pattern. ENG-039 (Mexico
 * restaurant vertical) plugs real workflows into the existing shells
 * without forking the App component or introducing bespoke routing.
 *
 * @module services/surfaces/manifest
 */

import { type ModuleId, MODULES_MANIFEST } from '../modules/manifest.js';

/**
 * Closed list of surface ids. Compile-time exhaustiveness via
 * `Record<SurfaceId, SurfaceDescriptor>` blocks any forgotten arm.
 */
export const SURFACE_IDS = [
  'pos-desktop',
  'pos-touch',
  'kds',
  'customer-display',
  'mobile-waiter',
] as const;

export type SurfaceId = (typeof SURFACE_IDS)[number];

/**
 * Role gate convention. `cashierOrAbove` is the standard cashier+
 * manager+ admin set. `managerOrAbove` raises the floor to manager.
 * `adminOnly` is reserved. v1 puts every surface at `cashierOrAbove`
 * because new roles (kitchen, waiter) come with ENG-039.
 */
export type SurfaceRoleSet = 'cashierOrAbove' | 'managerOrAbove' | 'adminOnly';

export interface SurfaceDescriptor {
  id: SurfaceId;
  /**
   * The module gating this surface. `null` when the surface is the
   * implicit default (POS Desktop). Every other surface gates behind
   * a module id from MODULES_MANIFEST.
   */
  moduleId: ModuleId | null;
  /** Default route the surface mounts on. No trailing slash. */
  defaultRoute: string;
  /** Lowest role the surface accepts. */
  defaultRoleSet: SurfaceRoleSet;
  /**
   * Suffix under the `surfaces.*` i18n namespace. The renderer reads
   * `surfaces.<i18nKey>.label` and `surfaces.<i18nKey>.description`.
   */
  i18nKey: string;
}

/**
 * Exhaustive surface descriptors. TypeScript's `Record<SurfaceId, ...>`
 * shape forces every entry of `SURFACE_IDS` to land here.
 */
export const SURFACES_MANIFEST: Record<SurfaceId, SurfaceDescriptor> = {
  'pos-desktop': {
    id: 'pos-desktop',
    moduleId: null,
    defaultRoute: '/dashboard',
    defaultRoleSet: 'cashierOrAbove',
    i18nKey: 'posDesktop',
  },
  'pos-touch': {
    id: 'pos-touch',
    moduleId: 'pos-touch',
    defaultRoute: '/touch',
    defaultRoleSet: 'cashierOrAbove',
    i18nKey: 'posTouch',
  },
  'kds': {
    id: 'kds',
    moduleId: 'kds',
    defaultRoute: '/kds',
    defaultRoleSet: 'cashierOrAbove',
    i18nKey: 'kds',
  },
  'customer-display': {
    id: 'customer-display',
    moduleId: 'customer-display',
    defaultRoute: '/customer-display',
    defaultRoleSet: 'cashierOrAbove',
    i18nKey: 'customerDisplay',
  },
  'mobile-waiter': {
    id: 'mobile-waiter',
    moduleId: 'mobile-waiter',
    defaultRoute: '/m',
    defaultRoleSet: 'cashierOrAbove',
    i18nKey: 'mobileWaiter',
  },
};

const SURFACE_ID_SET: ReadonlySet<string> = new Set(SURFACE_IDS);

/** Type guard for runtime ingress. */
export function isSurfaceId(value: unknown): value is SurfaceId {
  return typeof value === 'string' && SURFACE_ID_SET.has(value);
}

/**
 * Defensive cross-manifest check: every non-null `moduleId` MUST exist
 * in the modules manifest. Called at module load time so a typo lights
 * up the test suite immediately, not at request time.
 */
export function assertSurfaceManifestIntegrity(): void {
  for (const id of SURFACE_IDS) {
    const descriptor = SURFACES_MANIFEST[id];
    if (descriptor.moduleId === null) continue;
    if (!(descriptor.moduleId in MODULES_MANIFEST)) {
      throw new Error(
        `surfaces manifest: surface ${id} references unknown module ${descriptor.moduleId}`,
        {
          cause: {
            manifest: 'surfaces',
            surfaceId: id,
            unknownModuleId: descriptor.moduleId,
          },
        }
      );
    }
  }
}
// Run the integrity check at module import time so test runs and the
// boot sequence catch a bad manifest immediately.
assertSurfaceManifestIntegrity();
